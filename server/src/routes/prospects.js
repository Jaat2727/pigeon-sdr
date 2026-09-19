import express from 'express';
import { supabase, unwrap, unwrapSoft } from '../db/client.js';
import { asyncHandler, notFound, badRequest, parseLimit } from '../lib/http.js';
import { mapProspectListItem, mapProspectDetail } from '../services/mappers.js';
import { advance, advanceUntilBlocked } from '../orchestrator/index.js';

const router = express.Router();

/**
 * GET /prospects
 * Query params: campaignId, status (funnel state), score (high|medium|low),
 * q (name/company/email search), limit.
 *
 * Funnel state is read from campaign_prospects, never from prospects, because
 * the same person can be qualified in one campaign and rejected in another.
 */
router.get('/', asyncHandler(async (req, res) => {
  const { campaignId, status, score, q } = req.query;

  let query = supabase
    .from('campaign_prospects')
    .select('*, prospects(*), campaigns(id, name, colour)')
    .limit(parseLimit(req.query.limit, 500, 2000));

  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (status) query = query.eq('state', status);
  if (score === 'high') query = query.gte('fit_score', 70);
  if (score === 'medium') query = query.gte('fit_score', 45).lt('fit_score', 70);
  if (score === 'low') query = query.lt('fit_score', 45);

  const rows = unwrapSoft(await query, [], 'campaign_prospects');

  let mapped = rows.map((cp) => mapProspectListItem(cp, cp.prospects, cp.campaigns));

  if (q) {
    const needle = String(q).toLowerCase();
    mapped = mapped.filter((p) =>
      [p.first_name, p.last_name, p.company, p.email, p.role]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }

  mapped.sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
  res.json(mapped);
}));

/**
 * GET /prospects/:id
 * Full profile with provenance, facts and the chronological agent timeline.
 * `?campaignId=` picks which campaign's view to show when the prospect is in
 * more than one; otherwise the most recently updated one wins. The old version
 * used `.single()` here and threw whenever a prospect appeared twice.
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const prospect = unwrapSoft(
    await supabase.from('prospects').select('*').eq('id', req.params.id).maybeSingle(),
    null,
    'prospects'
  );
  if (!prospect) throw notFound(`Prospect ${req.params.id} does not exist`);

  let cpQuery = supabase
    .from('campaign_prospects')
    .select('*, campaigns(*)')
    .eq('prospect_id', req.params.id)
    .order('updated_at', { ascending: false });

  if (req.query.campaignId) cpQuery = cpQuery.eq('campaign_id', req.query.campaignId);

  const memberships = unwrapSoft(await cpQuery, [], 'campaign_prospects');
  const cp = memberships[0] ?? null;

  const runsQuery = supabase
    .from('agent_runs')
    .select('*')
    .eq('prospect_id', req.params.id)
    .order('created_at', { ascending: true });

  const messagesQuery = supabase
    .from('messages')
    .select('*')
    .eq('prospect_id', req.params.id)
    .order('created_at', { ascending: true });

  const [runsRes, messagesRes, promptsRes] = await Promise.all([
    cp ? runsQuery.eq('campaign_id', cp.campaign_id) : runsQuery,
    cp ? messagesQuery.eq('campaign_id', cp.campaign_id) : messagesQuery,
    cp
      ? supabase.from('prompt_versions').select('id, version, agent_name').eq('campaign_id', cp.campaign_id)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const detail = mapProspectDetail({
    prospect,
    campaignProspect: cp,
    campaign: cp?.campaigns ?? null,
    runs: unwrapSoft(runsRes, [], 'agent_runs'),
    messages: unwrapSoft(messagesRes, [], 'messages'),
    promptVersions: unwrapSoft(promptsRes, [], 'prompt_versions'),
  });

  // Every campaign this person appears in, so the UI can show that a prospect
  // is being worked by more than one at once.
  detail.campaign_memberships = memberships.map((m) => ({
    campaign_id: m.campaign_id,
    campaign_name: m.campaigns?.name ?? null,
    campaign_colour: m.campaigns?.colour ?? null,
    campaign_status: m.campaigns?.status ?? null,
    state: m.state,
    fit_score: m.fit_score,
    icp_verdict: m.icp_verdict,
  }));

  res.json(detail);
}));

/**
 * POST /prospects/:id/advance
 * Runs the pipeline for this prospect. `?all=true` keeps stepping until it
 * blocks, which is what the demo uses to take one prospect from discovered to
 * contacted in a single click.
 */
router.post('/:id/advance', asyncHandler(async (req, res) => {
  const campaignId = req.body?.campaign_id ?? req.query.campaignId;
  if (!campaignId) throw badRequest('campaign_id is required — a prospect advances within one campaign');

  if (req.body?.all === true || req.query.all === 'true') {
    res.json({ prospect_id: req.params.id, steps: await advanceUntilBlocked(campaignId, req.params.id) });
    return;
  }

  res.json({ prospect_id: req.params.id, ...(await advance(campaignId, req.params.id)) });
}));

/**
 * POST /prospects/:id/reply
 * Records an inbound reply and hands it to the Conversation agent. In
 * production this is what an inbound email or SMS webhook calls; in the demo
 * it is how a reply is injected to show the conversation half of the system.
 */
router.post('/:id/reply', asyncHandler(async (req, res) => {
  const { campaign_id: campaignId, body, channel = 'email', subject = null } = req.body ?? {};
  if (!campaignId) throw badRequest('campaign_id is required');
  if (!body || !String(body).trim()) throw badRequest('body is required');

  const cp = unwrapSoft(
    await supabase
      .from('campaign_prospects')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('prospect_id', req.params.id)
      .maybeSingle(),
    null,
    'campaign_prospects'
  );
  if (!cp) throw notFound('That prospect is not part of that campaign');

  unwrap(
    await supabase
      .from('messages')
      .insert({
        campaign_id: campaignId,
        prospect_id: req.params.id,
        campaign_prospect_id: cp.id,
        direction: 'inbound',
        channel,
        subject,
        body,
        received_at: new Date().toISOString(),
      })
      .select('id')
      .single(),
    'messages insert'
  );

  await supabase
    .from('campaign_prospects')
    .update({ state: 'replied', next_action_at: new Date().toISOString() })
    .eq('id', cp.id);

  res.status(201).json({
    prospect_id: req.params.id,
    ...(await advance(campaignId, req.params.id)),
  });
}));

export default router;
