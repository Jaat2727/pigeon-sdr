/**
 * The gate — four levels of stopping, checked before every autonomous action.
 *
 *   Global kill switch  stops everything, everywhere.
 *   Channel pause       stops one channel across all campaigns.
 *   Agent pause         stops one agent, globally or for one campaign.
 *   Campaign status     stops one campaign.
 *
 * On top of those it enforces the exclusion rules from the database rather than
 * from the model: the suppression list, recent-contact cooldown, and daily
 * send limits. That distinction matters — a model can be talked out of a rule,
 * a SQL predicate cannot.
 *
 * Every check returns `{ allowed, reason, level }` so the caller can log why an
 * action did not happen, which is what makes a paused campaign legible in the
 * UI instead of just silent.
 */
import { supabase, unwrapSoft } from '../db/client.js';
import { normaliseChannels } from '../services/mappers.js';

const RECENT_CONTACT_DAYS = 30;

function deny(reason, level, detail = null) {
  return { allowed: false, reason, level, detail };
}
const ALLOW = { allowed: true, reason: null, level: null, detail: null };

/** Reads the single system_control row, tolerating a missing table. */
export async function getSystemControl() {
  const res = await supabase
    .from('system_control')
    .select('*')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  const row = unwrapSoft(res, null, 'system_control');
  return {
    id: row?.id ?? 1,
    kill_switch: Boolean(row?.kill_switch),
    channel_pauses: row?.channel_pauses ?? { email: false, linkedin: false, sms: false, voice: false },
    agent_pauses: row?.agent_pauses ?? {},
    updated_at: row?.updated_at ?? null,
  };
}

/**
 * @param {object} args
 * @param {string} args.campaignId
 * @param {string} [args.prospectId]
 * @param {string} [args.channel]   only checked for actions that send something
 * @param {string} [args.agentName] only checked when invoking an agent
 * @param {boolean} [args.isOutbound] true when the action contacts the prospect
 */
export async function isActionAllowed({
  campaignId,
  prospectId = null,
  channel = null,
  agentName = null,
  isOutbound = false,
}) {
  // 1 · Global kill switch and global channel/agent pauses
  const control = await getSystemControl();

  if (control.kill_switch) {
    return deny('kill_switch_active', 'global');
  }
  if (channel && control.channel_pauses?.[channel]) {
    return deny(`channel_paused_${channel}`, 'channel');
  }
  if (agentName && control.agent_pauses?.[agentName]) {
    return deny(`agent_paused_${agentName}`, 'agent');
  }

  // 2 · Campaign status, per-campaign agent switches, and channel configuration
  const campaignRes = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();

  const campaign = unwrapSoft(campaignRes, null, 'campaigns');
  if (!campaign) return deny('campaign_not_found', 'campaign');

  if (campaign.status !== 'live') {
    return deny(`campaign_${campaign.status ?? 'unknown'}`, 'campaign');
  }

  if (agentName && campaign.agents && campaign.agents[agentName] === false) {
    return deny(`agent_disabled_for_campaign_${agentName}`, 'agent');
  }

  if (channel) {
    const { array: enabled } = normaliseChannels(campaign);
    if (!enabled.includes(channel)) {
      return deny(`channel_disabled_${channel}`, 'campaign');
    }
  }

  // 3 · Exclusion rules, enforced from the database
  if (prospectId) {
    const prospectRes = await supabase
      .from('prospects')
      .select('id, email, phone, company_domain, is_existing_customer')
      .eq('id', prospectId)
      .maybeSingle();

    const prospect = unwrapSoft(prospectRes, null, 'prospects');
    if (!prospect) return deny('prospect_not_found', 'prospect');

    if (prospect.is_existing_customer) {
      return deny('existing_customer', 'prospect');
    }

    // Build the suppression filter from non-null identifiers only. Including a
    // null here produces `email.eq.null`, which PostgREST rejects — the reason
    // the previous version of this check failed on any prospect missing a phone.
    const filters = [];
    if (prospect.email) filters.push(`email.eq.${prospect.email}`);
    if (prospect.phone) filters.push(`phone.eq.${prospect.phone}`);
    if (prospect.company_domain) filters.push(`domain.eq.${prospect.company_domain}`);

    if (filters.length) {
      const supRes = await supabase
        .from('suppression_list')
        .select('id, reason')
        .or(filters.join(','))
        .limit(1);
      const suppressed = unwrapSoft(supRes, [], 'suppression_list');
      if (suppressed.length) {
        return deny('suppressed', 'prospect', suppressed[0].reason);
      }
    }

    // Recent contact from any other campaign
    if (isOutbound) {
      const since = new Date(Date.now() - RECENT_CONTACT_DAYS * 86400000).toISOString();
      const recentRes = await supabase
        .from('messages')
        .select('id, campaign_id, created_at')
        .eq('prospect_id', prospectId)
        .eq('direction', 'outbound')
        .neq('campaign_id', campaignId)
        .gte('created_at', since)
        .limit(1);
      const recent = unwrapSoft(recentRes, [], 'messages');
      if (recent.length) {
        return deny('contacted_by_another_campaign_recently', 'prospect', recent[0].campaign_id);
      }
    }
  }

  // 4 · Daily send limit, counted from messages actually sent today
  if (isOutbound) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const sentRes = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('direction', 'outbound')
      .gte('created_at', startOfDay.toISOString());

    const sentToday = sentRes.count ?? 0;
    const limit = campaign.daily_limit ?? 50;
    if (sentToday >= limit) {
      return deny('daily_limit_reached', 'campaign', `${sentToday}/${limit}`);
    }

    if (channel && campaign.channel_limits?.[channel] != null) {
      const chanRes = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('channel', channel)
        .eq('direction', 'outbound')
        .gte('created_at', startOfDay.toISOString());
      const chanSent = chanRes.count ?? 0;
      if (chanSent >= campaign.channel_limits[channel]) {
        return deny(`channel_daily_limit_${channel}`, 'channel', `${chanSent}/${campaign.channel_limits[channel]}`);
      }
    }
  }

  return ALLOW;
}

/**
 * Human-readable version of a gate result, used in activity rows and API
 * responses so an operator sees "Campaign is paused" rather than a code.
 */
export function explainGate(result) {
  if (!result || result.allowed) return 'Allowed';
  const messages = {
    kill_switch_active: 'The global kill switch is engaged — all autonomous activity is stopped.',
    campaign_paused: 'This campaign is paused, so no agents run for it.',
    campaign_draft: 'This campaign is still a draft and is not permitted to send outreach.',
    campaign_completed: 'This campaign is completed and no longer acts autonomously.',
    campaign_archived: 'This campaign is archived.',
    campaign_not_found: 'The campaign no longer exists.',
    suppressed: 'This prospect is on the suppression list.',
    existing_customer: 'This prospect is already a customer and is excluded from outreach.',
    prospect_not_found: 'The prospect no longer exists.',
    daily_limit_reached: 'The campaign has reached its daily send limit.',
    contacted_by_another_campaign_recently:
      'Another campaign contacted this prospect within the last 30 days.',
  };
  if (messages[result.reason]) return messages[result.reason];
  if (result.reason?.startsWith('channel_paused_')) {
    return `The ${result.reason.replace('channel_paused_', '')} channel is paused globally.`;
  }
  if (result.reason?.startsWith('channel_disabled_')) {
    return `The ${result.reason.replace('channel_disabled_', '')} channel is not enabled for this campaign.`;
  }
  if (result.reason?.startsWith('channel_daily_limit_')) {
    return `The ${result.reason.replace('channel_daily_limit_', '')} channel has hit its daily limit.`;
  }
  if (result.reason?.startsWith('agent_paused_')) {
    return `The ${result.reason.replace('agent_paused_', '')} agent is paused globally.`;
  }
  if (result.reason?.startsWith('agent_disabled_for_campaign_')) {
    return `The ${result.reason.replace('agent_disabled_for_campaign_', '')} agent is switched off for this campaign.`;
  }
  return result.reason ?? 'Blocked';
}

export default isActionAllowed;
