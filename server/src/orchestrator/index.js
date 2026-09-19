/**
 * Orchestrator.
 *
 * `advance(campaignId, prospectId)` moves one prospect one step. The state
 * machine lives here and nowhere else — agents classify and write, the
 * orchestrator decides what happens next. That split is what lets a prompt
 * change alter tone without altering control flow.
 *
 *   discovered      → research        → researched
 *   researched      → icp_fitment     → qualified | rejected | needs_review
 *   qualified       → outreach_strategy → strategy_planned
 *   strategy_planned→ personalisation → contacted
 *   contacted       → followup_timing → contacted (next touch) | stopped
 *   replied         → conversation    → engaged | meeting | opportunity | rejected
 *
 * Rules that hold at every step:
 *   · The gate is checked before the step, and again with the channel before
 *     anything is sent.
 *   · Enrichment is cached per prospect with a staleness window, so resuming a
 *     paused campaign does not re-research anybody.
 *   · Agent 3 returns day offsets; converting those to timestamps happens here.
 *   · Every escalation from any agent lands in the escalations table.
 */
import { supabase, dbReady, unwrapSoft } from '../db/client.js';
import { callAgent } from '../agents/client.js';
import { runLocalEngine } from '../agents/localEngine.js';
import { isActionAllowed, explainGate } from './gate.js';
import { retrieveForStep } from '../services/knowledge.js';
import { raiseEscalation, logActivity, detectConflicts, hasBlockingConflict } from '../services/escalations.js';
import { normaliseChannels, resolveProspectFields } from '../services/mappers.js';

const ENRICHMENT_TTL_DAYS = 14;

function isEnrichmentFresh(prospect) {
  const data = prospect?.enriched_data;
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return false;
  if (!prospect.enriched_at) return false;
  const age = Date.now() - new Date(prospect.enriched_at).getTime();
  return age < ENRICHMENT_TTL_DAYS * 86400000;
}

function prospectDisplay(prospect) {
  const f = resolveProspectFields(prospect);
  return { name: f.name.value ?? 'Unknown prospect', company: f.company.value ?? null };
}

async function loadContext(campaignId, prospectId) {
  const res = await supabase
    .from('campaign_prospects')
    .select('*, campaigns(*), prospects(*)')
    .eq('campaign_id', campaignId)
    .eq('prospect_id', prospectId)
    .maybeSingle();

  const cp = unwrapSoft(res, null, 'campaign_prospects');
  if (!cp) return null;
  return { cp, campaign: cp.campaigns, prospect: cp.prospects };
}

async function activePromptVersion(campaignId, agentName) {
  const res = await supabase
    .from('prompt_versions')
    .select('id, version, content')
    .eq('campaign_id', campaignId)
    .eq('agent_name', agentName)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return unwrapSoft(res, null, 'prompt_versions');
}

async function systemPrompt(campaignId) {
  const res = await supabase
    .from('prompt_versions')
    .select('content')
    .eq('campaign_id', campaignId)
    .eq('agent_name', 'system')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return unwrapSoft(res, null, 'prompt_versions')?.content ?? null;
}

async function updateCampaignProspect(campaignId, prospectId, updates) {
  const { error } = await supabase
    .from('campaign_prospects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .eq('prospect_id', prospectId);
  if (error) console.error('[orchestrator] campaign_prospects update failed:', error.message);
}

/**
 * Turns Agent 3's day offsets into real timestamps anchored on now.
 *
 * Later touches roll off a weekend onto the next working day. The opening
 * touch does not: it is due the moment the sequence is planned, and deferring
 * it to Monday would mean a campaign set live on a Saturday does nothing until
 * Monday, which is not what "live" should mean.
 */
export function scheduleSequence(sequence, from = new Date()) {
  return (sequence ?? []).map((step) => {
    const offset = step.day_offset ?? 0;
    const when = new Date(from.getTime() + offset * 86400000);

    if (offset > 0) {
      const day = when.getUTCDay();
      if (day === 6) when.setUTCDate(when.getUTCDate() + 2);
      if (day === 0) when.setUTCDate(when.getUTCDate() + 1);
    }

    return { ...step, scheduled_at: when.toISOString() };
  });
}

/**
 * Advances one prospect by one step.
 * @returns {Promise<{status, state?, reason?, engine?, degraded?}>}
 */
export async function advance(campaignId, prospectId, { force = false } = {}) {
  if (!dbReady) return { status: 'skipped', reason: 'database_not_configured' };

  const ctx = await loadContext(campaignId, prospectId);
  if (!ctx) return { status: 'skipped', reason: 'prospect_not_in_campaign' };

  const { cp, campaign, prospect } = ctx;
  const state = cp.state ?? 'discovered';
  const display = prospectDisplay(prospect);
  const { array: enabledChannels } = normaliseChannels(campaign);

  const STEP_BY_STATE = {
    discovered: 'research',
    researched: 'icp_fitment',
    qualified: 'outreach_strategy',
    strategy_planned: 'personalisation',
    contacted: 'followup_timing',
    engaged: 'followup_timing',
    replied: 'conversation',
  };

  const agentName = STEP_BY_STATE[state];
  if (!agentName) {
    return { status: 'idle', reason: `no_action_for_state_${state}`, state };
  }

  // A prospect mid-sequence has a scheduled next touch. Honour it unless the
  // caller explicitly forces, so a manual run cannot fire a campaign's whole
  // sequence back to back in one click.
  if (!force && cp.next_action_at && new Date(cp.next_action_at) > new Date()) {
    return {
      status: 'scheduled',
      state,
      reason: 'next_touch_not_due',
      detail: `The next touch for this prospect is scheduled for ${cp.next_action_at}.`,
      next_action_at: cp.next_action_at,
    };
  }

  // Gate before doing anything. Sending steps are re-checked with the channel.
  if (!force) {
    const gate = await isActionAllowed({ campaignId, prospectId, agentName });
    if (!gate.allowed) {
      return { status: 'blocked', reason: gate.reason, detail: explainGate(gate), state };
    }
  }

  const promptVersion = await activePromptVersion(campaignId, agentName);
  const sysPrompt = await systemPrompt(campaignId);

  const campaignPolicy = {
    name: campaign.name,
    icp_criteria: campaign.icp_criteria,
    exclusion_criteria: campaign.exclusion_criteria,
    research_focus: campaign.research_focus,
    outreach_policy: campaign.outreach_policy,
    messaging_policy: campaign.messaging_policy,
    target_roles: campaign.target_roles ?? [],
    industry: campaign.industry ?? [],
    geography: campaign.geography ?? [],
    company_size: campaign.company_size ?? '',
    enabled_channels: enabledChannels,
    working_hours: campaign.working_hours ?? {},
  };

  const baseMeta = {
    campaign_id: campaignId,
    prospect_id: prospectId,
    campaign_prospect_id: cp.id,
    prompt_version_id: promptVersion?.id ?? null,
  };

  const withHarness = (payload) => ({
    ...payload,
    _system_prompt: sysPrompt,
    _agent_prompt: promptVersion?.content ?? null,
  });

  try {
    switch (agentName) {
      /* ── research ─────────────────────────────────────────────────── */
      case 'research': {
        // Cached enrichment: skip straight to scoring rather than paying for
        // a second research call on a resumed campaign.
        if (isEnrichmentFresh(prospect) && !force) {
          await updateCampaignProspect(campaignId, prospectId, { state: 'researched' });
          return { status: 'advanced', state: 'researched', reason: 'enrichment_cache_hit' };
        }

        const result = await callAgent(
          'research',
          withHarness({
            prospect: { stub: prospect },
            campaign: { research_focus: campaignPolicy.research_focus, name: campaign.name },
          }),
          { ...baseMeta, localPayload: { stub: prospect } }
        );

        if (!result.success) return { status: 'error', reason: result.error, state };

        await supabase
          .from('prospects')
          .update({
            enriched_data: result.output,
            enriched_at: new Date().toISOString(),
            enrichment_stale_after: new Date(Date.now() + ENRICHMENT_TTL_DAYS * 86400000).toISOString(),
            research_confidence: result.output.confidence ?? null,
            fields_not_found: result.output.fields_not_found ?? [],
          })
          .eq('id', prospectId);

        await updateCampaignProspect(campaignId, prospectId, { state: 'researched' });

        await logActivity({
          campaignId,
          prospectId,
          agentName: 'research',
          engine: result.engine,
          action: 'Enriched prospect profile',
          outcome: `Researched ${display.name}${display.company ? ` at ${display.company}` : ''}`,
          status: result.degraded ? 'degraded' : 'success',
          prospectName: display.name,
          prospectCompany: display.company,
          metadata: {
            fields_not_found: result.output.fields_not_found?.length ?? 0,
            confidence: result.output.confidence,
            engine: result.engine,
          },
        });

        return { status: 'advanced', state: 'researched', engine: result.engine, degraded: result.degraded };
      }

      /* ── ICP fitment ──────────────────────────────────────────────── */
      case 'icp_fitment': {
        const enriched = prospect.enriched_data ?? null;
        const chunks = await retrieveForStep({
          campaignId,
          agentName: 'icp_fitment',
          context: `${campaignPolicy.icp_criteria} ${JSON.stringify(enriched ?? prospect)}`,
        });

        const result = await callAgent(
          'icp_fitment',
          withHarness({
            prospect: { enriched_profile: enriched ?? prospect },
            campaign: {
              icp_criteria: campaignPolicy.icp_criteria,
              exclusion_criteria: campaignPolicy.exclusion_criteria,
              target_roles: campaignPolicy.target_roles,
              industry: campaignPolicy.industry,
              company_size: campaignPolicy.company_size,
              sample_profiles: campaign.sample_profiles ?? [],
            },
            retrieved_knowledge: chunks,
          }),
          {
            ...baseMeta,
            retrieved_chunks: chunks,
            localPayload: { enriched_profile: enriched ?? prospect, campaign: campaignPolicy },
          }
        );

        if (!result.success) return { status: 'error', reason: result.error, state };

        const verdict = result.output.verdict;
        const nextState =
          verdict === 'qualify' ? 'qualified' : verdict === 'reject' ? 'rejected' : 'needs_review';

        await updateCampaignProspect(campaignId, prospectId, {
          state: nextState,
          icp_verdict: verdict,
          icp_confidence: result.output.confidence,
          icp_result: result.output,
          fit_score: result.output.fit_score,
          next_action_at: nextState === 'qualified' ? new Date().toISOString() : null,
        });

        if (verdict === 'needs_review') {
          await raiseEscalation({
            campaignId,
            prospectId,
            campaignProspectId: cp.id,
            sourceAgent: 'icp_fitment',
            escalationType: 'needs_review',
            reason: result.output.reasoning,
            proposedAction:
              `Score ${result.output.fit_score}/100 with ${result.output.confidence} confidence. ` +
              `${result.output.reasoning} ` +
              (result.output.missing_data?.length
                ? `Missing data: ${result.output.missing_data.join(', ')}.`
                : ''),
            proposedPayload: result.output,
            prospectName: display.name,
            campaignName: campaign.name,
          });
        }

        await logActivity({
          campaignId,
          prospectId,
          agentName: 'icp_fitment',
          engine: result.engine,
          action: `ICP verdict: ${verdict}`,
          outcome: `${verdict === 'qualify' ? 'Qualified' : verdict === 'reject' ? 'Rejected' : 'Flagged for review'} ${display.name} at ${result.output.fit_score}/100`,
          status: result.degraded ? 'degraded' : 'success',
          prospectName: display.name,
          prospectCompany: display.company,
          metadata: {
            verdict,
            fit_score: result.output.fit_score,
            confidence: result.output.confidence,
            reason: result.output.reasoning,
            engine: result.engine,
          },
        });

        return { status: 'advanced', state: nextState, engine: result.engine, degraded: result.degraded };
      }

      /* ── outreach strategy ────────────────────────────────────────── */
      case 'outreach_strategy': {
        await detectConflicts(prospectId);
        if (await hasBlockingConflict(prospectId, campaignId)) {
          await updateCampaignProspect(campaignId, prospectId, { next_action_at: null });
          return { status: 'blocked', reason: 'unresolved_conflict', state };
        }

        const historyRes = await supabase
          .from('messages')
          .select('direction, channel, intent, created_at, campaign_id')
          .eq('prospect_id', prospectId)
          .order('created_at', { ascending: true });
        const contactHistory = unwrapSoft(historyRes, [], 'messages');

        const chunks = await retrieveForStep({
          campaignId,
          agentName: 'outreach_strategy',
          context: `${campaignPolicy.outreach_policy} ${JSON.stringify(prospect.enriched_data ?? {})}`,
        });

        const localPayload = {
          enriched_profile: prospect.enriched_data ?? prospect,
          icp_result: cp.icp_result ?? {},
          campaign: campaignPolicy,
          contact_history: contactHistory,
        };

        const result = await callAgent(
          'outreach_strategy',
          withHarness({
            prospect: {
              enriched_profile: localPayload.enriched_profile,
              icp_result: localPayload.icp_result,
              contact_history: contactHistory,
            },
            campaign: {
              outreach_policy: campaignPolicy.outreach_policy,
              enabled_channels: enabledChannels,
              working_hours: campaignPolicy.working_hours,
            },
            retrieved_knowledge: chunks,
          }),
          { ...baseMeta, retrieved_chunks: chunks, localPayload }
        );

        if (!result.success) return { status: 'error', reason: result.error, state };

        const plan = scheduleSequence(result.output.sequence);

        if (!result.output.should_contact || plan.length === 0) {
          await updateCampaignProspect(campaignId, prospectId, {
            state: 'stopped',
            should_contact: false,
            no_contact_reason: result.output.no_contact_reason,
            next_action_at: null,
          });
          return { status: 'advanced', state: 'stopped', engine: result.engine };
        }

        await updateCampaignProspect(campaignId, prospectId, {
          state: 'strategy_planned',
          outreach_plan: plan,
          sequence: plan,
          current_step: 0,
          priority: result.output.priority,
          should_contact: true,
          no_contact_reason: null,
          next_action_at: plan[0].scheduled_at,
        });

        if (result.output.escalate_to_human) {
          await raiseEscalation({
            campaignId,
            prospectId,
            campaignProspectId: cp.id,
            sourceAgent: 'outreach_strategy',
            escalationType: 'escalate_to_human',
            reason: result.output.escalation_reason,
            proposedAction:
              `Planned a ${plan.length}-touch sequence starting on ${plan[0].channel}. ` +
              `Held for review because: ${result.output.escalation_reason}`,
            proposedPayload: result.output,
            prospectName: display.name,
            campaignName: campaign.name,
          });
        }

        await logActivity({
          campaignId,
          prospectId,
          agentName: 'outreach_strategy',
          engine: result.engine,
          action: 'Planned outreach sequence',
          outcome: `${plan.length}-touch ${plan.map((s) => s.channel).join(' → ')} sequence for ${display.name}`,
          status: result.degraded ? 'degraded' : 'success',
          prospectName: display.name,
          prospectCompany: display.company,
          metadata: { priority: result.output.priority, steps: plan.length, reason: result.output.reasoning },
        });

        return { status: 'advanced', state: 'strategy_planned', engine: result.engine, degraded: result.degraded };
      }

      /* ── personalisation and send ─────────────────────────────────── */
      case 'personalisation': {
        const plan = cp.outreach_plan ?? cp.sequence ?? [];
        const stepIndex = cp.current_step ?? 0;
        const step = plan[stepIndex];

        if (!step) {
          await updateCampaignProspect(campaignId, prospectId, { state: 'contacted', next_action_at: null });
          return { status: 'advanced', state: 'contacted', reason: 'sequence_exhausted' };
        }

        // Second gate pass, this time with the channel and as an outbound action.
        const sendGate = await isActionAllowed({
          campaignId,
          prospectId,
          channel: step.channel,
          agentName: 'personalisation',
          isOutbound: true,
        });
        if (!sendGate.allowed && !force) {
          await logActivity({
            campaignId,
            prospectId,
            agentName: 'personalisation',
            action: 'Send blocked',
            outcome: explainGate(sendGate),
            status: 'blocked',
            prospectName: display.name,
            prospectCompany: display.company,
            metadata: { reason: sendGate.reason, level: sendGate.level, channel: step.channel },
          });
          return { status: 'blocked', reason: sendGate.reason, detail: explainGate(sendGate), state };
        }

        const repRes = await supabase
          .from('campaign_reps')
          .select('reps(*)')
          .eq('campaign_id', campaignId)
          .limit(1)
          .maybeSingle();
        const rep = unwrapSoft(repRes, null, 'campaign_reps')?.reps ?? null;

        const threadRes = await supabase
          .from('messages')
          .select('direction, channel, subject, body, intent, created_at')
          .eq('prospect_id', prospectId)
          .eq('campaign_id', campaignId)
          .order('created_at', { ascending: true });
        const threadHistory = unwrapSoft(threadRes, [], 'messages');

        const chunks = await retrieveForStep({
          campaignId,
          agentName: 'personalisation',
          context: `${step.angle ?? ''} ${campaignPolicy.messaging_policy} ${JSON.stringify(prospect.enriched_data ?? {})}`,
        });

        const localPayload = {
          enriched_profile: prospect.enriched_data ?? prospect,
          current_step: step,
          campaign: campaignPolicy,
          retrieved_knowledge: chunks,
          rep,
        };

        const result = await callAgent(
          'personalisation',
          withHarness({
            prospect: { enriched_profile: localPayload.enriched_profile, thread_history: threadHistory },
            outreach: { current_step: step },
            campaign: { messaging_policy: campaignPolicy.messaging_policy },
            retrieved_knowledge: chunks,
            rep: { identity: rep?.full_name ?? 'Sales team', title: rep?.title ?? null },
          }),
          {
            ...baseMeta,
            retrieved_chunks: chunks,
            localPayload,
            coerceContext: step.channel,
          }
        );

        if (!result.success) return { status: 'error', reason: result.error, state };

        if (result.output.needs_human) {
          await raiseEscalation({
            campaignId,
            prospectId,
            campaignProspectId: cp.id,
            sourceAgent: 'personalisation',
            escalationType: 'needs_human',
            reason: result.output.needs_human_reason,
            proposedAction: result.output.needs_human_reason,
            proposedPayload: result.output,
            prospectName: display.name,
            campaignName: campaign.name,
          });
          await updateCampaignProspect(campaignId, prospectId, { next_action_at: null });
          await logActivity({
            campaignId,
            prospectId,
            agentName: 'personalisation',
            engine: result.engine,
            action: 'Held message for human review',
            outcome: result.output.needs_human_reason,
            status: 'escalated',
            prospectName: display.name,
            prospectCompany: display.company,
            metadata: { step: stepIndex + 1, channel: step.channel },
          });
          return { status: 'escalated', state, reason: 'needs_human' };
        }

        const { error: msgErr } = await supabase.from('messages').insert({
          campaign_id: campaignId,
          prospect_id: prospectId,
          campaign_prospect_id: cp.id,
          direction: 'outbound',
          channel: result.output.channel,
          step_number: stepIndex + 1,
          subject: result.output.subject,
          body: result.output.body,
          personalisation_used: result.output.personalisation_used,
          knowledge_used: result.output.knowledge_used,
          cta: result.output.cta,
          needs_human: false,
          agent_run_id: result.agentRunId,
          prompt_version_id: promptVersion?.id ?? null,
          sent_at: new Date().toISOString(),
        });
        if (msgErr) console.error('[orchestrator] message insert failed:', msgErr.message);

        // Follow-up timing decides when the next touch goes out.
        const timing = runLocalEngine('followup_timing', {
          sequence: plan,
          current_step: stepIndex,
          last_touch_at: new Date().toISOString(),
          working_hours: campaignPolicy.working_hours,
        });

        await updateCampaignProspect(campaignId, prospectId, {
          state: 'contacted',
          current_step: stepIndex + 1,
          total_touches: (cp.total_touches ?? 0) + 1,
          last_touch_at: new Date().toISOString(),
          next_action_at: timing.next_action_at,
        });

        await logActivity({
          campaignId,
          prospectId,
          agentName: 'personalisation',
          engine: result.engine,
          action: `Sent ${result.output.channel} message`,
          outcome: `Touch ${stepIndex + 1} sent to ${display.name} on ${result.output.channel}`,
          status: result.degraded ? 'degraded' : 'success',
          prospectName: display.name,
          prospectCompany: display.company,
          metadata: {
            step: stepIndex + 1,
            channel: result.output.channel,
            subject: result.output.subject,
            knowledge_sources: (result.output.knowledge_used ?? []).map((k) => k.source),
            next_action_at: timing.next_action_at,
          },
        });

        return { status: 'advanced', state: 'contacted', engine: result.engine, degraded: result.degraded };
      }

      /* ── follow-up timing ─────────────────────────────────────────── */
      case 'followup_timing': {
        const plan = cp.outreach_plan ?? cp.sequence ?? [];
        const stepIndex = (cp.current_step ?? 1) - 1;

        const timing = runLocalEngine('followup_timing', {
          sequence: plan,
          current_step: stepIndex,
          last_touch_at: cp.last_touch_at,
          working_hours: campaignPolicy.working_hours,
        });

        if (!timing.should_continue) {
          await updateCampaignProspect(campaignId, prospectId, { state: 'stopped', next_action_at: null });
          await logActivity({
            campaignId,
            prospectId,
            agentName: 'followup_timing',
            engine: 'our_engine',
            action: 'Sequence complete',
            outcome: timing.reasoning,
            prospectName: display.name,
            prospectCompany: display.company,
            metadata: {},
          });
          return { status: 'advanced', state: 'stopped' };
        }

        await updateCampaignProspect(campaignId, prospectId, {
          state: 'strategy_planned',
          next_action_at: timing.next_action_at,
        });
        return { status: 'scheduled', state: 'strategy_planned', reason: timing.reasoning };
      }

      /* ── conversation ─────────────────────────────────────────────── */
      case 'conversation': {
        const replyRes = await supabase
          .from('messages')
          .select('*')
          .eq('prospect_id', prospectId)
          .eq('campaign_id', campaignId)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const reply = unwrapSoft(replyRes, null, 'messages');

        if (!reply) {
          await updateCampaignProspect(campaignId, prospectId, { state: 'contacted' });
          return { status: 'idle', reason: 'no_inbound_message', state };
        }

        const chunks = await retrieveForStep({
          campaignId,
          agentName: 'conversation',
          context: reply.body ?? '',
        });

        const localPayload = {
          message: reply.body,
          channel: reply.channel,
          thread_history: [],
          campaign: campaignPolicy,
        };

        const result = await callAgent(
          'conversation',
          withHarness({
            inbound: { message: reply.body, channel: reply.channel },
            prospect: { enriched_profile: prospect.enriched_data ?? prospect, thread_history: [] },
            campaign: { objective_and_policy: campaignPolicy.messaging_policy },
            retrieved_knowledge: chunks,
          }),
          { ...baseMeta, retrieved_chunks: chunks, localPayload }
        );

        if (!result.success) return { status: 'error', reason: result.error, state };

        const out = result.output;

        await supabase
          .from('messages')
          .update({
            intent: out.intent,
            intent_confidence: String(out.intent_confidence),
            sentiment: out.sentiment,
            extracted_facts: out.extracted_facts,
            questions_asked: out.questions_asked,
            objections_raised: out.objections_raised,
            referral: out.referral,
            is_auto_reply: !out.is_human_reply,
            agent_run_id: result.agentRunId,
          })
          .eq('id', reply.id);

        const STATE_BY_INTENT = {
          meeting_request: 'meeting',
          interested: 'engaged',
          question: 'engaged',
          objection: 'engaged',
          referral: 'engaged',
          not_now: 'contacted',
          not_interested: 'rejected',
          opt_out: 'suppressed',
          wrong_person: 'needs_review',
          bounce: 'stopped',
          auto_reply: 'contacted',
          unclear: 'needs_review',
        };
        const nextState = STATE_BY_INTENT[out.intent] ?? 'engaged';

        // Opt-out is absolute: suppress the person everywhere, not just here.
        if (out.intent === 'opt_out') {
          await supabase.from('suppression_list').insert({
            email: prospect.email ?? null,
            phone: prospect.phone ?? null,
            reason: 'Prospect opted out via reply',
            added_by: 'conversation_agent',
          });
        }

        const nextActionAt =
          out.followup_delay_days != null
            ? new Date(Date.now() + out.followup_delay_days * 86400000).toISOString()
            : null;

        await updateCampaignProspect(campaignId, prospectId, {
          state: nextState,
          last_touch_at: new Date().toISOString(),
          next_action_at: nextActionAt,
        });

        if (out.requires_human) {
          await raiseEscalation({
            campaignId,
            prospectId,
            campaignProspectId: cp.id,
            sourceAgent: 'conversation',
            escalationType: out.intent === 'objection' ? 'objection_detected' : 'escalate_to_human',
            reason: out.escalation_reason,
            proposedAction:
              `Reply classified as "${out.intent}" (${Math.round(out.intent_confidence * 100)}% confidence). ` +
              `Recommended action: ${out.recommended_action}. ${out.escalation_reason ?? ''}`,
            proposedPayload: out,
            prospectName: display.name,
            campaignName: campaign.name,
          });
        }

        await logActivity({
          campaignId,
          prospectId,
          agentName: 'conversation',
          engine: result.engine,
          action: `Classified reply as ${out.intent}`,
          outcome: `${display.name} replied — intent "${out.intent}", recommended: ${out.recommended_action}`,
          status: result.degraded ? 'degraded' : 'success',
          prospectName: display.name,
          prospectCompany: display.company,
          metadata: {
            detected_intent: out.intent,
            confidence: Math.round(out.intent_confidence * 100),
            reply_text: reply.body,
            action_taken: out.recommended_action,
            reason: out.reasoning,
          },
        });

        return { status: 'advanced', state: nextState, engine: result.engine, degraded: result.degraded };
      }

      default:
        return { status: 'idle', reason: 'unhandled_agent', state };
    }
  } catch (err) {
    console.error(`[orchestrator] ${agentName} failed for prospect ${prospectId}:`, err);
    await logActivity({
      campaignId,
      prospectId,
      agentName,
      action: 'Step failed',
      outcome: err.message,
      status: 'error',
      prospectName: display.name,
      prospectCompany: display.company,
      metadata: { error: err.message },
    }).catch(() => {});
    return { status: 'error', reason: err.message, state };
  }
}

/**
 * Runs `advance` repeatedly for one prospect until it stops progressing.
 * Bounded so a state-machine bug cannot spin.
 */
export async function advanceUntilBlocked(campaignId, prospectId, maxSteps = 6) {
  const steps = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const result = await advance(campaignId, prospectId);
    steps.push(result);
    if (result.status !== 'advanced') break;
  }
  return steps;
}

export default advance;
