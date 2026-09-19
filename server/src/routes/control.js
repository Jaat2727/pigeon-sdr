/**
 * System control — the four levels of stopping, and the worker switch.
 *
 * All four write to the single `system_control` row (or, for campaign status,
 * to the campaign). Nothing here is cached: the gate reads the same row on
 * every action, so a kill switch takes effect on the next agent call rather
 * than on the next deploy.
 */
import express from 'express';
import { supabase, unwrap } from '../db/client.js';
import { asyncHandler, badRequest } from '../lib/http.js';
import { getSystemControl } from '../orchestrator/gate.js';
import { AGENT_REGISTRY, getAgent } from '../agents/registry.js';
import { startWorker, stopWorker, isWorkerRunning, sweepOnce, workerStats } from '../worker/index.js';
import { logActivity } from '../services/escalations.js';

const router = express.Router();

const CHANNELS = ['email', 'linkedin', 'sms', 'voice'];

/** Ensures the single control row exists, then applies a patch to it. */
async function patchControl(patch) {
  const existing = await supabase.from('system_control').select('id').limit(1).maybeSingle();
  if (!existing.data) {
    unwrap(
      await supabase
        .from('system_control')
        .insert({
          id: 1,
          kill_switch: false,
          channel_pauses: { email: false, linkedin: false, sms: false, voice: false },
          agent_pauses: {},
          ...patch,
        })
        .select()
        .single(),
      'system_control insert'
    );
    return getSystemControl();
  }

  unwrap(
    await supabase
      .from('system_control')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.data.id)
      .select()
      .single(),
    'system_control update'
  );

  return getSystemControl();
}

// GET /control
router.get('/', asyncHandler(async (req, res) => {
  const control = await getSystemControl();
  res.json({ ...control, worker: { running: isWorkerRunning(), ...workerStats } });
}));

/**
 * POST /control/kill — level 4, the global kill switch.
 * Engaging it also clears every scheduled next action, so nothing fires the
 * moment it is released; releasing it does not auto-resume anything.
 */
router.post('/kill', asyncHandler(async (req, res) => {
  const enabled = Boolean(req.body?.enabled ?? req.body?.engaged);
  const control = await patchControl({ kill_switch: enabled });

  if (enabled) {
    await supabase
      .from('campaign_prospects')
      .update({ next_action_at: null })
      .not('next_action_at', 'is', null);
  }

  await logActivity({
    campaignId: null,
    agentName: 'system',
    action: enabled ? 'Global kill switch engaged' : 'Global kill switch released',
    outcome: enabled
      ? 'All autonomous activity stopped across every campaign and channel'
      : 'Autonomous activity is permitted again. Campaigns resume individually.',
    status: enabled ? 'blocked' : 'success',
    metadata: { kill_switch: enabled },
  });

  res.json(control);
}));

// POST /control/channel — level 3, pause one channel everywhere.
router.post('/channel', asyncHandler(async (req, res) => {
  const { channel, paused } = req.body ?? {};
  if (!CHANNELS.includes(channel)) {
    throw badRequest(`channel must be one of: ${CHANNELS.join(', ')}`);
  }

  const current = await getSystemControl();
  const control = await patchControl({
    channel_pauses: { ...current.channel_pauses, [channel]: Boolean(paused) },
  });

  await logActivity({
    campaignId: null,
    agentName: 'system',
    action: `Channel ${paused ? 'paused' : 'resumed'}: ${channel}`,
    outcome: `The ${channel} channel is now ${paused ? 'paused' : 'active'} across all campaigns`,
    status: 'success',
    metadata: { channel, paused: Boolean(paused) },
  });

  res.json(control);
}));

// POST /control/agent — level 2, pause one agent everywhere.
router.post('/agent', asyncHandler(async (req, res) => {
  const { agent, paused } = req.body ?? {};
  const known = getAgent(agent);
  if (!known) {
    throw badRequest('agent must be a known agent id', { valid: AGENT_REGISTRY.map((a) => a.id) });
  }

  const current = await getSystemControl();
  const control = await patchControl({
    agent_pauses: { ...current.agent_pauses, [known.id]: Boolean(paused) },
  });

  await logActivity({
    campaignId: null,
    agentName: known.id,
    action: `Agent ${paused ? 'paused' : 'resumed'}: ${known.name}`,
    outcome: `${known.name} is now ${paused ? 'paused' : 'active'}. Other agents continue as configured.`,
    status: 'success',
    metadata: { agent: known.id, paused: Boolean(paused) },
  });

  res.json(control);
}));

/* ── worker ─────────────────────────────────────────────────────────── */

router.get('/worker', asyncHandler(async (req, res) => {
  res.json({ running: isWorkerRunning(), ...workerStats });
}));

router.post('/worker', asyncHandler(async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const changed = enabled ? startWorker() : stopWorker();
  res.json({ running: isWorkerRunning(), changed, ...workerStats });
}));

// POST /control/worker/sweep — run one sweep now, without leaving it on.
router.post('/worker/sweep', asyncHandler(async (req, res) => {
  res.json(await sweepOnce());
}));

export default router;
