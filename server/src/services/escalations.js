/**
 * Escalations and activity logging.
 *
 * Every hand-off from an agent to a human goes through `raiseEscalation`, so
 * the Approval Center has one source rather than four. Every meaningful agent
 * action goes through `logActivity`, so the live feed reflects what actually
 * ran rather than being written at a handful of call sites that drifted apart.
 */
import { supabase, dbReady } from '../db/client.js';

const RISK_BY_TYPE = {
  escalate_to_human: 'high',
  objection_detected: 'high',
  opt_out: 'high',
  agent_error: 'high',
  needs_review: 'medium',
  needs_human: 'medium',
  conflict: 'medium',
  agent_degraded: 'low',
};

/**
 * Writes an escalation, de-duplicating against an identical pending one so a
 * worker sweep cannot flood the queue with the same item.
 */
export async function raiseEscalation({
  campaignId,
  prospectId,
  campaignProspectId = null,
  sourceAgent,
  escalationType,
  reason,
  proposedAction = null,
  proposedPayload = null,
  prospectName = null,
  campaignName = null,
  riskLevel = null,
}) {
  if (!dbReady) return null;

  const { data: existing } = await supabase
    .from('escalations')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('prospect_id', prospectId)
    .eq('escalation_type', escalationType)
    .eq('status', 'pending')
    .limit(1);

  if (existing?.length) return existing[0].id;

  const { data, error } = await supabase
    .from('escalations')
    .insert({
      campaign_id: campaignId,
      prospect_id: prospectId,
      campaign_prospect_id: campaignProspectId,
      source_agent: sourceAgent,
      escalation_type: escalationType,
      reason,
      proposed_action: proposedAction ?? reason,
      proposed_payload: proposedPayload,
      prospect_name: prospectName,
      campaign_name: campaignName,
      risk_level: riskLevel ?? RISK_BY_TYPE[escalationType] ?? 'low',
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[escalations] insert failed:', error.message);
    return null;
  }
  return data.id;
}

export async function logActivity({
  campaignId,
  prospectId = null,
  agentName,
  engine = null,
  action,
  outcome = null,
  status = 'success',
  prospectName = null,
  prospectCompany = null,
  metadata = {},
}) {
  if (!dbReady) return null;
  const { data, error } = await supabase
    .from('activities')
    .insert({
      campaign_id: campaignId,
      prospect_id: prospectId,
      agent_name: agentName,
      engine,
      action,
      outcome: outcome ?? action,
      status,
      prospect_name: prospectName,
      prospect_company: prospectCompany,
      metadata,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[activities] insert failed:', error.message);
    return null;
  }
  return data.id;
}

/**
 * States in which a campaign is actually working a prospect, rather than
 * merely holding them on a list. The distinction matters: appearing in two
 * campaigns' source lists is normal and harmless, and flagging it as a
 * conflict would halt outreach on almost every prospect. A conflict is two
 * campaigns *acting* on the same person.
 */
const ACTIVELY_WORKED = ['qualified', 'strategy_planned', 'contacted', 'engaged', 'meeting', 'opportunity'];

/**
 * Detects the case the brief calls out: the same prospect being worked by more
 * than one live campaign at the same time. Called before a sequence is planned,
 * so a duplicate is caught before any message goes out rather than after.
 */
export async function detectConflicts(prospectId) {
  if (!dbReady) return null;

  const { data: rows, error } = await supabase
    .from('campaign_prospects')
    .select('campaign_id, state, last_touch_at, total_touches, campaigns(name, status)')
    .eq('prospect_id', prospectId);

  if (error) {
    console.error('[conflicts] could not read memberships:', error.message);
    return null;
  }
  if (!rows) return null;

  const activeElsewhere = rows.filter(
    (r) => r.campaigns?.status === 'live' && ACTIVELY_WORKED.includes(r.state)
  );

  if (activeElsewhere.length < 2) return null;

  const { data: existing } = await supabase
    .from('conflicts')
    .select('id')
    .eq('prospect_id', prospectId)
    .eq('status', 'pending')
    .limit(1);

  if (existing?.length) return existing[0].id;

  const { data: prospect } = await supabase
    .from('prospects')
    .select('first_name, last_name, company_name')
    .eq('id', prospectId)
    .maybeSingle();

  const mostRecent = activeElsewhere
    .filter((r) => r.last_touch_at)
    .sort((a, b) => new Date(b.last_touch_at) - new Date(a.last_touch_at))[0];

  const { data, error: insertErr } = await supabase
    .from('conflicts')
    .insert({
      prospect_id: prospectId,
      campaign_ids: activeElsewhere.map((r) => r.campaign_id),
      rule: 'multi_campaign_touch',
      status: 'pending',
      prospect_name:
        [prospect?.first_name, prospect?.last_name].filter(Boolean).join(' ') || 'Unknown prospect',
      last_touch: mostRecent?.last_touch_at ?? null,
      contact_count: activeElsewhere.reduce((s, r) => s + (r.total_touches ?? 0), 0),
      next_action: `${activeElsewhere.length} live campaigns are targeting this prospect`,
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[conflicts] insert failed:', insertErr.message);
    return null;
  }
  return data.id;
}

/**
 * True when an unresolved conflict blocks outreach for this prospect in this
 * campaign. The orchestrator checks this before sending, so a conflict pauses
 * the prospect rather than being noticed after the duplicate email went out.
 */
export async function hasBlockingConflict(prospectId, campaignId) {
  if (!dbReady) return false;
  const { data } = await supabase
    .from('conflicts')
    .select('id, campaign_ids, resolved_campaign_id, status')
    .eq('prospect_id', prospectId)
    .eq('status', 'pending')
    .limit(5);

  if (!data?.length) return false;
  return data.some((c) => (c.campaign_ids ?? []).includes(campaignId));
}
