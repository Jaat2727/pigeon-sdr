/**
 * GET /attention
 *
 * The dashboard's "Needs Your Attention" panel. It was previously aliased onto
 * the escalations router, which returned a bare array while the panel expected
 * `{ items, summary }` — so the panel rendered empty no matter how many items
 * were waiting.
 *
 * Items are merged from three sources and ranked, newest and highest-risk
 * first, so the one thing a manager should look at is at the top.
 */
import express from 'express';
import { supabase, unwrapSoft } from '../db/client.js';
import { asyncHandler, parseLimit } from '../lib/http.js';
import { getAgentName } from '../agents/registry.js';

const router = express.Router();

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

const RISK_BY_TYPE = {
  escalate_to_human: 'high',
  objection_detected: 'high',
  opt_out: 'high',
  needs_review: 'medium',
  needs_human: 'medium',
  agent_degraded: 'low',
};

router.get('/', asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 12, 50);

  const [escRes, conflictRes, degradedRes] = await Promise.all([
    supabase
      .from('escalations')
      .select('*, prospects(first_name, last_name, company_name), campaigns(name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('conflicts')
      .select('*, prospects(first_name, last_name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('agent_runs')
      .select('id, agent_name, campaign_id, error_message, created_at, campaigns(name)')
      .eq('status', 'degraded')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const escalations = unwrapSoft(escRes, [], 'escalations');
  const conflicts = unwrapSoft(conflictRes, [], 'conflicts');
  const degraded = unwrapSoft(degradedRes, [], 'agent_runs');

  const items = [];

  for (const e of escalations) {
    // `join` yields '' for a missing name, so `||` is the correct operator.
    const prospectName =
      e.prospect_name ||
      [e.prospects?.first_name, e.prospects?.last_name].filter(Boolean).join(' ') ||
      'a prospect';
    items.push({
      id: `escalation:${e.id}`,
      source_id: e.id,
      type: 'approval',
      priority: e.risk_level ?? RISK_BY_TYPE[e.escalation_type] ?? 'low',
      title: `${getAgentName(e.source_agent)} needs a decision on ${prospectName}`,
      description: (e.proposed_action ?? e.reason ?? '').slice(0, 220),
      campaign: e.campaign_name ?? e.campaigns?.name ?? null,
      campaign_id: e.campaign_id,
      prospect_id: e.prospect_id,
      created_at: e.created_at,
      action_url: '/review-queue',
    });
  }

  for (const c of conflicts) {
    const prospectName =
      c.prospect_name ||
      [c.prospects?.first_name, c.prospects?.last_name].filter(Boolean).join(' ') ||
      'A prospect';
    items.push({
      id: `conflict:${c.id}`,
      source_id: c.id,
      type: 'conflict',
      priority: 'medium',
      title: `${prospectName} is targeted by ${(c.campaign_ids ?? []).length} live campaigns`,
      description:
        'Two or more live campaigns are working this prospect at once. Decide which one keeps them before the next touch goes out.',
      campaign: null,
      prospect_id: c.prospect_id,
      created_at: c.created_at,
      action_url: '/conflicts',
    });
  }

  // One rolled-up item per agent that fell back, rather than one per run.
  const degradedByAgent = new Map();
  for (const run of degraded) {
    if (!degradedByAgent.has(run.agent_name)) degradedByAgent.set(run.agent_name, { count: 0, run });
    degradedByAgent.get(run.agent_name).count += 1;
  }
  for (const [agentName, { count, run }] of degradedByAgent) {
    items.push({
      id: `degraded:${agentName}`,
      source_id: run.id,
      type: 'escalation',
      priority: 'low',
      title: `${getAgentName(agentName)} is running on the local engine`,
      description:
        `${count} recent run(s) fell back because the DronaHQ call did not return usable output. ` +
        `Latest reason: ${(run.error_message ?? 'unknown').slice(0, 160)}`,
      campaign: run.campaigns?.name ?? null,
      campaign_id: run.campaign_id,
      created_at: run.created_at,
      action_url: '/agents',
    });
  }

  items.sort((a, b) => {
    const byPriority = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
    if (byPriority !== 0) return byPriority;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  res.json({
    items: items.slice(0, limit),
    summary: {
      total: items.length,
      approvals: items.filter((i) => i.type === 'approval').length,
      conflicts: items.filter((i) => i.type === 'conflict').length,
      escalations: items.filter((i) => i.type === 'escalation').length,
      high: items.filter((i) => i.priority === 'high').length,
      medium: items.filter((i) => i.priority === 'medium').length,
      low: items.filter((i) => i.priority === 'low').length,
    },
  });
}));

export default router;
