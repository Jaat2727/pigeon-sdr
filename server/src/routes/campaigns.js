import express from 'express';
import { supabase, unwrap, unwrapSoft } from '../db/client.js';
import { asyncHandler, notFound, badRequest, parseLimit } from '../lib/http.js';
import { mapCampaign, mapActivity, mapProspectListItem, mapPromptVersion, normaliseChannels } from '../services/mappers.js';
import { computeCampaignMetrics } from '../services/metrics.js';
import { AGENT_REGISTRY, getAgent } from '../agents/registry.js';
import { advance } from '../orchestrator/index.js';
import { getSystemControl } from '../orchestrator/gate.js';

const router = express.Router();

const VALID_STATUSES = ['draft', 'live', 'paused', 'completed', 'archived'];

/**
 * Columns the API is allowed to write. Anything else in the request body is
 * dropped rather than passed to Postgres, so a stray field from the UI cannot
 * produce a 500 and a renamed column cannot be written by accident.
 */
const WRITABLE = new Set([
  'name', 'description', 'colour', 'status', 'owner', 'target_audience',
  'geography', 'target_roles', 'company_size', 'industry', 'exclusion_criteria',
  'icp_criteria', 'research_focus', 'sample_profiles', 'outreach_policy',
  'messaging_policy', 'objective_and_policy', 'channels', 'enabled_channels',
  'channel_limits', 'daily_limit', 'agents', 'working_hours', 'approval_required',
  'prospect_source', 'never_contact',
]);

const toArrayField = (value) => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
};

function sanitiseCampaignBody(body = {}) {
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (!WRITABLE.has(key)) continue;
    out[key] = value;
  }

  // The wizard sends these as comma-separated text; the columns are text[].
  for (const key of ['geography', 'target_roles', 'industry', 'never_contact']) {
    const arr = toArrayField(out[key]);
    if (arr !== undefined) out[key] = arr;
  }

  // Keep the object and array forms of channels in sync whichever one arrived.
  if (out.channels !== undefined || out.enabled_channels !== undefined) {
    const { object, array } = normaliseChannels(out);
    out.channels = object;
    out.enabled_channels = array;
  }

  if (out.status !== undefined && !VALID_STATUSES.includes(out.status)) {
    throw badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return out;
}

async function loadCampaign(id) {
  const row = unwrapSoft(
    await supabase.from('campaigns').select('*, campaign_reps(rep_id)').eq('id', id).maybeSingle(),
    null,
    'campaigns'
  );
  if (!row) throw notFound(`Campaign ${id} does not exist`);
  return row;
}

/* ── list ───────────────────────────────────────────────────────────── */

// GET /campaigns — every campaign with its measured metrics attached.
router.get('/', asyncHandler(async (req, res) => {
  const rows = unwrap(
    await supabase
      .from('campaigns')
      .select('*, campaign_reps(rep_id)')
      .order('created_at', { ascending: false }),
    'campaigns'
  );

  const withMetrics = await Promise.all(
    (rows ?? []).map(async (row) => mapCampaign(row, { metrics: await computeCampaignMetrics(row.id) }))
  );

  res.json(withMetrics);
}));

// POST /campaigns
router.post('/', asyncHandler(async (req, res) => {
  const payload = sanitiseCampaignBody(req.body);
  if (!payload.name) throw badRequest('A campaign needs a name');

  const row = unwrap(
    await supabase
      .from('campaigns')
      .insert({ status: 'draft', ...payload })
      .select('*, campaign_reps(rep_id)')
      .single(),
    'campaigns insert'
  );

  // Seed an empty prompt version per agent so the Prompts screen is usable
  // immediately rather than showing an empty state for every tab.
  const seeds = AGENT_REGISTRY.filter((a) => a.id === 'system' || a.callable).map((a) => ({
    campaign_id: row.id,
    agent_name: a.id,
    version: 1,
    is_active: true,
    author: req.body.owner ?? 'System',
    content:
      a.id === 'system'
        ? `You are the SDR system for the campaign "${row.name}".\n\n${req.body.prompt_content ?? ''}`.trim()
        : `${a.description}\n\nCampaign: ${row.name}\nICP: ${payload.target_audience ?? 'not specified'}`,
  }));

  const { error: promptErr } = await supabase.from('prompt_versions').insert(seeds);
  if (promptErr) console.warn('[campaigns] prompt seeding skipped:', promptErr.message);

  res.status(201).json(mapCampaign(row));
}));

/* ── single campaign ────────────────────────────────────────────────── */

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await loadCampaign(req.params.id);
  res.json(mapCampaign(row, { metrics: await computeCampaignMetrics(row.id) }));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const payload = sanitiseCampaignBody(req.body);
  if (Object.keys(payload).length === 0) throw badRequest('No writable fields in the request body');

  const row = unwrap(
    await supabase
      .from('campaigns')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*, campaign_reps(rep_id)')
      .single(),
    'campaigns update'
  );

  res.json(mapCampaign(row));
}));

// POST /campaigns/:id/status — pause, resume, complete, archive.
router.post('/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body ?? {};
  if (!VALID_STATUSES.includes(status)) {
    throw badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const control = await getSystemControl();
  if (status === 'live' && control.kill_switch) {
    throw badRequest(
      'The global kill switch is engaged. Release it before bringing a campaign live.'
    );
  }

  const row = unwrap(
    await supabase
      .from('campaigns')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*, campaign_reps(rep_id)')
      .single(),
    'campaigns status'
  );

  // Pausing stops scheduled work for this campaign only. Prospect state and
  // conversation history are kept, so resuming picks up where it left off —
  // and no other campaign is affected.
  if (status !== 'live') {
    await supabase
      .from('campaign_prospects')
      .update({ next_action_at: null })
      .eq('campaign_id', req.params.id);
  } else {
    await supabase
      .from('campaign_prospects')
      .update({ next_action_at: new Date().toISOString() })
      .eq('campaign_id', req.params.id)
      .is('next_action_at', null)
      .in('state', ['discovered', 'researched', 'qualified', 'strategy_planned']);
  }

  await supabase.from('activities').insert({
    campaign_id: req.params.id,
    agent_name: 'system',
    action: `Campaign ${status}`,
    outcome: `An operator set this campaign to ${status}`,
    status: 'success',
    metadata: { status },
  });

  res.json(mapCampaign(row, { metrics: await computeCampaignMetrics(row.id) }));
}));

// POST /campaigns/:id/duplicate — copies config and prompts, never prospects.
router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const source = await loadCampaign(req.params.id);
  // Drop identity and timestamps; everything else is copied to the variant.
  const { id: _id, created_at: _c, updated_at: _u, campaign_reps: _r, ...rest } = source;

  const copy = unwrap(
    await supabase
      .from('campaigns')
      .insert({
        ...rest,
        name: req.body?.name ?? `${source.name} (Variant)`,
        status: 'draft',
      })
      .select()
      .single(),
    'campaigns duplicate'
  );

  const prompts = unwrapSoft(
    await supabase.from('prompt_versions').select('*').eq('campaign_id', source.id).eq('is_active', true),
    [],
    'prompt_versions'
  );

  if (prompts.length) {
    await supabase.from('prompt_versions').insert(
      prompts.map((p) => ({
        campaign_id: copy.id,
        agent_name: p.agent_name,
        version: 1,
        is_active: true,
        author: p.author,
        content: p.content,
      }))
    );
  }

  const reps = source.campaign_reps ?? [];
  if (reps.length) {
    await supabase
      .from('campaign_reps')
      .insert(reps.map((r) => ({ campaign_id: copy.id, rep_id: r.rep_id })));
  }

  res.status(201).json(mapCampaign(copy));
}));

/* ── campaign sub-resources ─────────────────────────────────────────── */

router.get('/:id/metrics', asyncHandler(async (req, res) => {
  res.json(await computeCampaignMetrics(req.params.id));
}));

router.get('/:id/activity', asyncHandler(async (req, res) => {
  const rows = unwrapSoft(
    await supabase
      .from('activities')
      .select('*, campaigns(name, colour)')
      .eq('campaign_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(parseLimit(req.query.limit, 60)),
    [],
    'activities'
  );
  res.json(rows.map(mapActivity));
}));

router.get('/:id/prospects', asyncHandler(async (req, res) => {
  const campaign = await loadCampaign(req.params.id);
  const rows = unwrapSoft(
    await supabase
      .from('campaign_prospects')
      .select('*, prospects(*)')
      .eq('campaign_id', req.params.id)
      .order('fit_score', { ascending: false, nullsFirst: false })
      .limit(parseLimit(req.query.limit, 500, 2000)),
    [],
    'campaign_prospects'
  );
  res.json(rows.map((cp) => mapProspectListItem(cp, cp.prospects, campaign)));
}));

/**
 * GET /campaigns/:id/agents
 * Per-campaign agent panel: enabled switch, engine badge, and run counts
 * restricted to this campaign.
 */
router.get('/:id/agents', asyncHandler(async (req, res) => {
  const campaign = await loadCampaign(req.params.id);
  const control = await getSystemControl();

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const runs = unwrapSoft(
    await supabase
      .from('agent_runs')
      .select('agent_name, status, engine, created_at')
      .eq('campaign_id', req.params.id),
    [],
    'agent_runs'
  );

  const campaignAgents = campaign.agents ?? {};

  res.json(
    AGENT_REGISTRY.filter((a) => a.id !== 'system').map((agent) => {
      const forAgent = runs.filter((r) => r.agent_name === agent.id);
      const today = forAgent.filter((r) => r.created_at >= startOfDay.toISOString());
      const failures = today.filter((r) => r.status === 'error').length;
      return {
        id: agent.id,
        key: agent.id,
        name: agent.name,
        engine: forAgent[0]?.engine ?? agent.engine,
        description: agent.description,
        enabled: campaignAgents[agent.id] ?? true,
        paused: Boolean(control.agent_pauses?.[agent.id]),
        runs_today: today.length,
        runs_total: forAgent.length,
        failures_today: failures,
        degraded_today: today.filter((r) => r.status === 'degraded').length,
        success_rate: today.length ? Math.round(((today.length - failures) / today.length) * 100) : 0,
      };
    })
  );
}));

/* ── prompts ────────────────────────────────────────────────────────── */

router.get('/:id/prompts', asyncHandler(async (req, res) => {
  const rows = unwrapSoft(
    await supabase
      .from('prompt_versions')
      .select('*')
      .eq('campaign_id', req.params.id)
      .order('agent_name', { ascending: true })
      .order('version', { ascending: false }),
    [],
    'prompt_versions'
  );
  res.json(rows.map(mapPromptVersion));
}));

/**
 * POST /campaigns/:id/prompts — save a new version of one agent's prompt.
 * Versions are per agent, per campaign, and a new version is never auto-
 * activated: editing a prompt must not silently change a live campaign's
 * behaviour.
 */
router.post('/:id/prompts', asyncHandler(async (req, res) => {
  const { agent_name: agentName, content, author } = req.body ?? {};
  const agent = getAgent(agentName);
  if (!agent) {
    throw badRequest(
      `agent_name must be a known agent id. Received "${agentName}".`,
      { valid: AGENT_REGISTRY.map((a) => a.id) }
    );
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw badRequest('content is required and cannot be empty');
  }

  const existing = unwrapSoft(
    await supabase
      .from('prompt_versions')
      .select('version')
      .eq('campaign_id', req.params.id)
      .eq('agent_name', agent.id)
      .order('version', { ascending: false })
      .limit(1),
    [],
    'prompt_versions'
  );

  const row = unwrap(
    await supabase
      .from('prompt_versions')
      .insert({
        campaign_id: req.params.id,
        agent_name: agent.id,
        version: (existing[0]?.version ?? 0) + 1,
        is_active: false,
        author: author ?? 'Operator',
        content,
      })
      .select()
      .single(),
    'prompt_versions insert'
  );

  res.status(201).json(mapPromptVersion(row));
}));

/* ── manual pipeline trigger ────────────────────────────────────────── */

/**
 * POST /campaigns/:id/run
 * Advances up to `limit` prospects one step each. This is what the demo runs
 * on, so the pipeline can be driven from the UI without leaving the background
 * worker burning budget between takes.
 *
 * Prospects whose next touch is scheduled for later are reported as scheduled
 * rather than pushed, so clicking Run repeatedly cannot fire a whole sequence
 * back to back. `force: true` overrides that for a demo that needs to show the
 * second and third touches without waiting three days.
 */
router.post('/:id/run', asyncHandler(async (req, res) => {
  const campaign = await loadCampaign(req.params.id);
  if (campaign.status !== 'live') {
    throw badRequest(`Campaign is ${campaign.status}. Set it live before running the pipeline.`);
  }

  const limit = parseLimit(req.body?.limit, 3, 25);
  const force = req.body?.force === true;

  const rows = unwrapSoft(
    await supabase
      .from('campaign_prospects')
      .select('prospect_id, state, next_action_at')
      .eq('campaign_id', campaign.id)
      .in('state', ['discovered', 'researched', 'qualified', 'strategy_planned', 'replied', 'contacted', 'engaged'])
      .order('updated_at', { ascending: true })
      .limit(limit),
    [],
    'campaign_prospects'
  );

  const results = [];
  for (const row of rows) {
    results.push({
      prospect_id: row.prospect_id,
      from_state: row.state,
      ...(await advance(campaign.id, row.prospect_id, { force })),
    });
  }

  const count = (status) => results.filter((r) => r.status === status).length;

  res.json({
    campaign_id: campaign.id,
    forced: force,
    processed: results.length,
    advanced: count('advanced'),
    scheduled: count('scheduled'),
    escalated: count('escalated'),
    blocked: count('blocked'),
    errors: count('error'),
    results,
  });
}));

export default router;
