/**
 * Metrics service.
 *
 * Every number returned here is counted from a table. The previous version
 * estimated several of them in JavaScript (`researched = total * 0.75`,
 * `messages_sent = contacted * 3`), which meant the dashboard could show
 * traffic that had never happened. Anything that genuinely cannot be measured
 * yet returns 0 and the UI renders an empty state, which is the honest answer.
 *
 * The one modelled figure is pipeline value, because deal size is a business
 * assumption rather than an observation. Its per-stage assumptions are declared
 * in PIPELINE_ASSUMPTIONS and returned alongside the number so nobody reads it
 * as measured revenue.
 */
import { supabase, unwrapSoft } from '../db/client.js';
import { FUNNEL_STAGES } from './mappers.js';

export const PIPELINE_ASSUMPTIONS = {
  meeting_value_usd: 50000,
  opportunity_value_usd: 80000,
  note: 'Modelled figure. Assumed value per booked meeting and per open opportunity, not measured revenue.',
};

const POSITIVE_INTENTS = ['interested', 'meeting_request', 'referral'];
const NEGATIVE_INTENTS = ['not_interested', 'opt_out', 'objection', 'wrong_person', 'bounce'];

function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function emptyFunnel() {
  return Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
}

/**
 * Working states that are not themselves funnel stages, mapped to the furthest
 * stage the prospect demonstrably reached. Without this, a prospect sitting in
 * `strategy_planned` counted only as discovered, so the funnel showed fewer
 * researched prospects than it showed qualified ones.
 */
const STATE_TO_STAGE = {
  strategy_planned: 'qualified',
  replied: 'contacted',
  needs_review: 'researched',
  rejected: 'researched',
  suppressed: 'contacted',
  stopped: 'researched',
};

/**
 * Counts prospects per funnel stage. A prospect that has reached a later stage
 * is counted in every stage it passed through, so the funnel reads as a funnel
 * rather than as a set of disjoint buckets.
 */
export function buildFunnel(campaignProspects) {
  const funnel = emptyFunnel();

  for (const cp of campaignProspects) {
    const stage = FUNNEL_STAGES.includes(cp.state) ? cp.state : STATE_TO_STAGE[cp.state];
    const idx = stage ? FUNNEL_STAGES.indexOf(stage) : 0;

    for (let i = 0; i <= Math.max(idx, 0); i += 1) funnel[FUNNEL_STAGES[i]] += 1;
  }

  return funnel;
}

async function fetchCampaignData(campaignId) {
  const filterCp = supabase.from('campaign_prospects').select('id, state, fit_score, icp_verdict, updated_at');
  const filterMsg = supabase.from('messages').select('id, direction, channel, intent, sentiment, created_at');
  const filterRuns = supabase
    .from('agent_runs')
    .select('id, status, cost_usd, latency_ms, tokens_in, tokens_out, created_at, agent_name, engine');
  const filterEsc = supabase.from('escalations').select('id, status');

  const [cps, messages, runs, escalations] = await Promise.all([
    campaignId ? filterCp.eq('campaign_id', campaignId) : filterCp,
    campaignId ? filterMsg.eq('campaign_id', campaignId) : filterMsg,
    campaignId ? filterRuns.eq('campaign_id', campaignId) : filterRuns,
    campaignId
      ? filterEsc.eq('campaign_id', campaignId).eq('status', 'pending')
      : filterEsc.eq('status', 'pending'),
  ]);

  return {
    campaignProspects: unwrapSoft(cps, [], 'campaign_prospects'),
    messages: unwrapSoft(messages, [], 'messages'),
    runs: unwrapSoft(runs, [], 'agent_runs'),
    escalations: unwrapSoft(escalations, [], 'escalations'),
  };
}

export async function computeCampaignMetrics(campaignId) {
  const { campaignProspects, messages, runs, escalations } = await fetchCampaignData(campaignId);
  const todayIso = startOfUtcDay();

  const total = campaignProspects.length;
  const funnel = buildFunnel(campaignProspects);

  const qualified = campaignProspects.filter((p) => p.icp_verdict === 'qualify').length;
  const needsReview = campaignProspects.filter((p) => p.icp_verdict === 'needs_review').length;
  const rejected = campaignProspects.filter((p) => p.icp_verdict === 'reject').length;
  const meetings = campaignProspects.filter((p) => p.state === 'meeting').length;
  const opportunities = campaignProspects.filter((p) => p.state === 'opportunity').length;

  const outbound = messages.filter((m) => m.direction === 'outbound');
  const inbound = messages.filter((m) => m.direction === 'inbound');
  const positive = inbound.filter(
    (m) => POSITIVE_INTENTS.includes(m.intent) || m.sentiment === 'positive'
  ).length;
  const negative = inbound.filter(
    (m) => NEGATIVE_INTENTS.includes(m.intent) || m.sentiment === 'negative'
  ).length;

  const runsToday = runs.filter((r) => r.created_at >= todayIso);
  const spendToday = runsToday.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const spendTotal = runs.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const failures = runs.filter((r) => r.status === 'error').length;
  const degraded = runs.filter((r) => r.status === 'degraded').length;
  const successRate = runs.length > 0 ? Math.round(((runs.length - failures) / runs.length) * 100) : 0;

  const messagesSent = outbound.length;
  const replies = inbound.length;
  const responseRate = messagesSent > 0 ? ((replies / messagesSent) * 100).toFixed(1) : '0.0';
  const meetingRate = replies > 0 ? ((meetings / replies) * 100).toFixed(1) : '0.0';

  // Progress is how far through the funnel the campaign has pushed its
  // prospects, not an arbitrary percentage.
  const contacted = funnel.contacted;
  const progress = total > 0 ? Math.round((contacted / total) * 100) : 0;

  return {
    total_prospects: total,
    qualified_prospects: qualified,
    needs_review_prospects: needsReview,
    rejected_prospects: rejected,

    messages_sent: messagesSent,
    replies,
    positive_replies: positive,
    negative_replies: negative,
    meetings,
    meetings_booked: meetings,
    opportunities,

    response_rate: responseRate,
    meeting_rate: meetingRate,
    progress,
    funnel,

    pipeline_value:
      meetings * PIPELINE_ASSUMPTIONS.meeting_value_usd +
      opportunities * PIPELINE_ASSUMPTIONS.opportunity_value_usd,
    pipeline_assumptions: PIPELINE_ASSUMPTIONS,

    spend_today: Number(spendToday.toFixed(4)),
    spend_total: Number(spendTotal.toFixed(4)),
    agent_runs_today: runsToday.length,
    agent_runs_total: runs.length,
    agent_failures: failures,
    agent_degraded_runs: degraded,
    agent_success_rate: successRate,

    escalations: escalations.length,
    pending_approvals: escalations.length,
  };
}

export async function computeGlobalMetrics() {
  const [campaignsRes, conflictsRes] = await Promise.all([
    supabase.from('campaigns').select('id, status'),
    supabase.from('conflicts').select('id, status').eq('status', 'pending'),
  ]);

  const campaigns = unwrapSoft(campaignsRes, [], 'campaigns');
  const conflicts = unwrapSoft(conflictsRes, [], 'conflicts');
  const metrics = await computeCampaignMetrics(null);

  const live = campaigns.filter((c) => c.status === 'live');

  return {
    live_campaigns: live.length,
    total_campaigns: campaigns.length,
    paused_campaigns: campaigns.filter((c) => c.status === 'paused').length,
    draft_campaigns: campaigns.filter((c) => c.status === 'draft').length,

    active_prospects: metrics.total_prospects - metrics.rejected_prospects,
    total_prospects: metrics.total_prospects,
    qualified_prospects: metrics.qualified_prospects,

    messages_sent: metrics.messages_sent,
    replies: metrics.replies,
    meetings_booked: metrics.meetings_booked,
    pipeline_value: metrics.pipeline_value,
    pipeline_assumptions: PIPELINE_ASSUMPTIONS,

    agent_success_rate: metrics.agent_success_rate,
    agent_runs_total: metrics.agent_runs_total,
    pending_approvals: metrics.pending_approvals,
    conflicts: conflicts.length,
  };
}

/** Per-channel breakdown, counted from the messages table. */
export async function computeChannelMetrics(campaignId = null) {
  const query = supabase.from('messages').select('direction, channel, intent, sentiment');
  const res = campaignId ? await query.eq('campaign_id', campaignId) : await query;
  const messages = unwrapSoft(res, [], 'messages');

  const channels = ['email', 'linkedin', 'sms', 'voice'];
  return channels.map((channel) => {
    const forChannel = messages.filter((m) => m.channel === channel);
    const sent = forChannel.filter((m) => m.direction === 'outbound').length;
    const replied = forChannel.filter((m) => m.direction === 'inbound').length;
    const meetings = forChannel.filter(
      (m) => m.direction === 'inbound' && m.intent === 'meeting_request'
    ).length;
    return {
      channel,
      sent,
      replied,
      meetings,
      reply_rate: sent > 0 ? Number(((replied / sent) * 100).toFixed(1)) : 0,
    };
  });
}

/** Per-agent performance, counted from agent_runs. */
export async function computeAgentPerformance(campaignId = null) {
  const query = supabase
    .from('agent_runs')
    .select('agent_name, engine, status, cost_usd, latency_ms, created_at');
  const res = campaignId ? await query.eq('campaign_id', campaignId) : await query;
  const runs = unwrapSoft(res, [], 'agent_runs');
  const todayIso = startOfUtcDay();

  const byAgent = new Map();
  for (const run of runs) {
    if (!byAgent.has(run.agent_name)) {
      byAgent.set(run.agent_name, {
        agent_name: run.agent_name,
        runs: 0, runs_today: 0, failures: 0, failures_today: 0,
        degraded: 0, cost: 0, latency_total: 0, last_run_at: null,
        engines: new Set(),
      });
    }
    const a = byAgent.get(run.agent_name);
    a.runs += 1;
    a.cost += Number(run.cost_usd ?? 0);
    a.latency_total += Number(run.latency_ms ?? 0);
    if (run.engine) a.engines.add(run.engine);
    if (run.status === 'error') a.failures += 1;
    if (run.status === 'degraded') a.degraded += 1;
    if (run.created_at >= todayIso) {
      a.runs_today += 1;
      if (run.status === 'error') a.failures_today += 1;
    }
    if (!a.last_run_at || run.created_at > a.last_run_at) a.last_run_at = run.created_at;
  }

  return [...byAgent.values()].map((a) => ({
    agent_name: a.agent_name,
    runs: a.runs,
    runs_today: a.runs_today,
    failures: a.failures,
    failures_today: a.failures_today,
    degraded_runs: a.degraded,
    success_rate: a.runs > 0 ? Math.round(((a.runs - a.failures) / a.runs) * 100) : 0,
    cost: Number(a.cost.toFixed(4)),
    avg_latency_ms: a.runs > 0 ? Math.round(a.latency_total / a.runs) : 0,
    last_run_at: a.last_run_at,
    engines_used: [...a.engines],
  }));
}

export async function computeCosts() {
  const [runsRes, campaignsRes] = await Promise.all([
    supabase.from('agent_runs').select('campaign_id, cost_usd, latency_ms, tokens_in, tokens_out, created_at'),
    supabase.from('campaigns').select('id, name, colour'),
  ]);

  const runs = unwrapSoft(runsRes, [], 'agent_runs');
  const campaigns = unwrapSoft(campaignsRes, [], 'campaigns');
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
  const todayIso = startOfUtcDay();

  const totalSpend = runs.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const todayRuns = runs.filter((r) => r.created_at >= todayIso);
  const spendToday = todayRuns.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const avgLatency =
    runs.length > 0 ? Math.round(runs.reduce((s, r) => s + Number(r.latency_ms ?? 0), 0) / runs.length) : 0;
  const totalTokens = runs.reduce((s, r) => s + Number(r.tokens_in ?? 0) + Number(r.tokens_out ?? 0), 0);

  const byCampaign = new Map();
  for (const run of runs) {
    const key = run.campaign_id ?? 'unassigned';
    if (!byCampaign.has(key)) {
      byCampaign.set(key, {
        campaign_id: run.campaign_id,
        campaign_name: nameById.get(run.campaign_id) ?? 'Unassigned',
        spend: 0,
        runs: 0,
      });
    }
    const c = byCampaign.get(key);
    c.spend += Number(run.cost_usd ?? 0);
    c.runs += 1;
  }

  return {
    total_spend: Number(totalSpend.toFixed(4)),
    spend_today: Number(spendToday.toFixed(4)),
    avg_latency_ms: avgLatency,
    total_runs: runs.length,
    runs_today: todayRuns.length,
    total_tokens: totalTokens,
    by_campaign: [...byCampaign.values()].map((c) => ({ ...c, spend: Number(c.spend.toFixed(4)) })),
  };
}
