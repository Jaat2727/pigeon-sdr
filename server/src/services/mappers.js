/**
 * Row mappers — the boundary between database shape and API shape.
 *
 * The database stores what is true (campaign_prospects.state, activities.
 * agent_name, prospects.company_name). The UI reads a flatter vocabulary
 * (funnel_status, agent, company). Every translation between the two lives
 * here, so a column rename is a one-file change and no route hand-rolls its
 * own reshaping.
 */
import { getAgent, getAgentName, getAgentEngine } from '../agents/registry.js';

export const FUNNEL_STAGES = [
  'discovered', 'researched', 'qualified', 'contacted',
  'engaged', 'meeting', 'opportunity',
];

/** States that are not funnel stages but are valid prospect states. */
export const TERMINAL_STATES = ['rejected', 'needs_review', 'suppressed', 'stopped'];

export const CHANNELS = ['email', 'linkedin', 'sms', 'voice'];

/* ── campaigns ──────────────────────────────────────────────────────── */

/**
 * `channels` has been stored both as an object ({email:true}) and as an array
 * (["email"]) at different points in this project's life. Both are accepted and
 * both shapes are returned, so neither the UI nor the gate has to guess.
 */
export function normaliseChannels(campaign) {
  const raw = campaign?.channels ?? campaign?.enabled_channels ?? null;
  const object = { email: false, linkedin: false, sms: false, voice: false };

  if (Array.isArray(raw)) {
    for (const c of raw) if (c in object) object[c] = true;
  } else if (raw && typeof raw === 'object') {
    for (const c of CHANNELS) object[c] = Boolean(raw[c]);
  }

  // enabled_channels wins when it is a populated array, because the gate uses it.
  if (Array.isArray(campaign?.enabled_channels) && campaign.enabled_channels.length) {
    for (const c of CHANNELS) object[c] = campaign.enabled_channels.includes(c);
  }

  const array = CHANNELS.filter((c) => object[c]);
  return { object, array: array.length ? array : ['email'] };
}

/** Free-text criteria may be stored as text or as jsonb. Read either. */
export function readCriteria(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

export function mapCampaign(row, { metrics = null } = {}) {
  if (!row) return null;
  const channels = normaliseChannels(row);

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    colour: row.colour ?? '#4F46E5',
    status: row.status ?? 'draft',
    owner: row.owner ?? 'Unassigned',

    // Short ICP label for tables, long form for the config screens.
    icp: row.icp_label ?? row.target_audience ?? readCriteria(row.icp_criteria).slice(0, 80),
    target_audience: row.target_audience ?? '',
    icp_criteria: readCriteria(row.icp_criteria),
    exclusion_criteria: readCriteria(row.exclusion_criteria),
    research_focus: readCriteria(row.research_focus),
    outreach_policy: readCriteria(row.outreach_policy),
    messaging_policy: readCriteria(row.messaging_policy),

    geography: row.geography ?? [],
    target_roles: row.target_roles ?? [],
    industry: row.industry ?? [],
    company_size: row.company_size ?? '',
    never_contact: row.never_contact ?? [],
    prospect_source: row.prospect_source ?? '',

    channels: channels.object,
    enabled_channels: channels.array,
    channel_limits: row.channel_limits ?? { email: 50, linkedin: 30, sms: 10, voice: 5 },
    daily_limit: row.daily_limit ?? 50,
    working_hours: row.working_hours ?? { start: '09:00', end: '18:00', timezone: 'UTC' },
    approval_required: Boolean(row.approval_required),

    agents: row.agents ?? {},
    reps: Array.isArray(row.campaign_reps) ? row.campaign_reps.map((r) => r.rep_id) : (row.reps ?? []),

    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(metrics ? { metrics } : {}),
  };
}

/* ── prospects ──────────────────────────────────────────────────────── */

function enrichedOf(prospect) {
  const e = prospect?.enriched_data;
  if (!e || typeof e !== 'object') return { person: {}, company: {}, signals: {} };
  return { person: e.person ?? {}, company: e.company ?? {}, signals: e.signals ?? {}, ...e };
}

/**
 * Merges enrichment under the stored record. Provenance rule from the spec:
 * manual beats crm beats ai_enriched, so a value already on the prospect row
 * is never overwritten by research output.
 */
export function resolveProspectFields(prospect) {
  const enriched = enrichedOf(prospect);
  const provenance = prospect?.provenance ?? {};

  const resolve = (stored, researched, field) => {
    if (stored !== null && stored !== undefined && stored !== '') {
      return { value: stored, source: provenance[field] ?? 'crm' };
    }
    if (researched !== null && researched !== undefined && researched !== '') {
      return { value: researched, source: 'ai_enriched' };
    }
    return { value: null, source: null };
  };

  const name = resolve(
    [prospect?.first_name, prospect?.last_name].filter(Boolean).join(' ') || null,
    enriched.person?.full_name,
    'name'
  );
  const role = resolve(prospect?.title, enriched.person?.title, 'role');
  const company = resolve(prospect?.company_name, enriched.company?.name, 'company');
  const email = resolve(prospect?.email, enriched.person?.email, 'email');
  const phone = resolve(prospect?.phone, enriched.person?.phone, 'phone');
  const linkedin = resolve(prospect?.linkedin_url, enriched.person?.linkedin_url, 'linkedin_url');
  const location = resolve(prospect?.location, enriched.person?.location, 'location');
  const industry = resolve(prospect?.company_industry, enriched.company?.industry, 'industry');

  return {
    name, role, company, email, phone, linkedin, location, industry,
    enriched,
    provenance: {
      name: name.source, role: role.source, company: company.source,
      email: email.source, phone: phone.source, linkedin_url: linkedin.source,
      location: location.source, industry: industry.source,
    },
  };
}

function intentLevel(score) {
  if (score === null || score === undefined) return 'low';
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

/**
 * List row. `cp` is a campaign_prospects row; `prospect` is the joined
 * prospects row. Funnel state lives on the junction, never on the person,
 * because the same person can be qualified in one campaign and rejected in
 * another.
 */
export function mapProspectListItem(cp, prospect, campaign = null) {
  const p = prospect ?? cp?.prospects ?? {};
  const f = resolveProspectFields(p);

  return {
    id: p.id,
    campaign_prospect_id: cp?.id ?? null,
    first_name: p.first_name ?? (f.name.value ?? '').split(' ')[0] ?? '',
    last_name: p.last_name ?? (f.name.value ?? '').split(' ').slice(1).join(' '),
    email: f.email.value,
    phone: f.phone.value,
    linkedin_url: f.linkedin.value,
    role: f.role.value,
    title: f.role.value,
    company: f.company.value,
    company_name: f.company.value,
    company_domain: p.company_domain ?? f.enriched.company?.domain ?? null,
    location: f.location.value,

    campaign_id: cp?.campaign_id ?? null,
    campaign_name: campaign?.name ?? cp?.campaigns?.name ?? null,
    campaign_colour: campaign?.colour ?? cp?.campaigns?.colour ?? null,

    funnel_status: cp?.state ?? 'discovered',
    state: cp?.state ?? 'discovered',
    fit_score: cp?.fit_score ?? null,
    intent_level: intentLevel(cp?.fit_score),
    icp_verdict: cp?.icp_verdict ?? null,
    icp_confidence: cp?.icp_confidence ?? null,
    priority: cp?.priority ?? null,
    current_step: cp?.current_step ?? 0,
    total_touches: cp?.total_touches ?? 0,

    last_touch: cp?.last_touch_at ?? null,
    last_activity: cp?.last_touch_at ?? cp?.updated_at ?? p.updated_at ?? null,
    next_action_at: cp?.next_action_at ?? null,
    updated_at: cp?.updated_at ?? p.updated_at ?? null,
    created_at: p.created_at ?? null,
  };
}

/** Facts shown beside the profile, each carrying where it came from. */
export function buildFacts(prospect) {
  const f = resolveProspectFields(prospect);
  const e = f.enriched;
  const facts = [];

  const push = (text, source, tag) => {
    if (text) facts.push({ text, source, tag: tag ?? 'ai_enriched' });
  };

  push(f.role.value && `Role: ${f.role.value}`, 'person.title', f.provenance.role);
  push(f.company.value && `Company: ${f.company.value}`, 'company.name', f.provenance.company);
  push(e.company?.industry && `Industry: ${e.company.industry}`, 'company.industry', 'ai_enriched');
  push(
    e.company?.employee_count && `Headcount: ${e.company.employee_count}`,
    'company.employee_count',
    'ai_enriched'
  );
  push(
    e.company?.funding_stage && `Funding stage: ${e.company.funding_stage}`,
    'company.funding_stage',
    'ai_enriched'
  );
  push(e.signals?.recent_news && `Recent news: ${e.signals.recent_news}`, 'signals.recent_news', 'ai_enriched');
  if (e.signals?.tech_stack?.length) {
    push(`Tech stack: ${e.signals.tech_stack.join(', ')}`, 'signals.tech_stack', 'ai_enriched');
  }
  if (e.signals?.hiring_roles?.length) {
    push(`Hiring for: ${e.signals.hiring_roles.join(', ')}`, 'signals.hiring_roles', 'ai_enriched');
  }
  if (e.signals?.intent_signals?.length) {
    push(`Intent: ${e.signals.intent_signals.join(', ')}`, 'signals.intent_signals', 'ai_enriched');
  }
  push(
    e.person?.tenure_months != null && `Tenure: ${e.person.tenure_months} months in role`,
    'person.tenure_months',
    'ai_enriched'
  );

  return facts;
}

/**
 * Timeline for the prospect detail page. Built from agent_runs and messages so
 * every entry carries the engine that produced it, the prompt version that was
 * active, the knowledge chunks retrieved, and the tokens, cost and latency it
 * used. That is what makes "why did the agent behave this way" answerable.
 */
export function buildTimeline({ prospect, campaignProspect, runs = [], messages = [], promptVersions = [] }) {
  const promptById = new Map(promptVersions.map((p) => [p.id, p]));
  const events = [];

  if (prospect?.created_at) {
    events.push({
      type: 'discovered',
      agent: null,
      agent_engine: null,
      prompt_version: null,
      tokens_used: 0,
      cost: 0,
      latency_ms: null,
      timestamp: prospect.created_at,
      details: { source: prospect.source ?? 'prospect list import' },
      knowledge_chunks: [],
    });
  }

  const TYPE_BY_AGENT = {
    research: 'researched',
    icp_fitment: 'qualified',
    outreach_strategy: 'strategy_created',
    personalisation: 'contacted',
    conversation: 'replied',
    followup_timing: 'followup_scheduled',
  };

  for (const run of runs) {
    const out = run.output_payload ?? {};
    const pv = promptById.get(run.prompt_version_id);
    let type = TYPE_BY_AGENT[run.agent_name] ?? run.agent_name;
    const details = {};

    if (run.agent_name === 'icp_fitment') {
      const verdict = out.verdict ?? null;
      type = verdict === 'reject' ? 'rejected' : verdict === 'needs_review' ? 'needs_review' : 'qualified';
      details.verdict = verdict;
      details.reason = out.reasoning
        ? `Score: ${out.fit_score ?? '—'}. ${out.reasoning}`
        : `Score: ${out.fit_score ?? '—'}`;
      details.confidence = out.confidence;
      details.dimension_scores = out.dimension_scores ?? null;
    } else if (run.agent_name === 'research') {
      const notFound = out.fields_not_found?.length ?? 0;
      details.signals_found =
        (out.signals?.intent_signals?.length ?? 0) +
        (out.signals?.tech_stack?.length ?? 0) +
        (out.signals?.hiring_roles?.length ?? 0);
      details.fields_not_found = notFound;
      details.reason = out.research_notes ?? null;
    } else if (run.agent_name === 'outreach_strategy') {
      details.reason = out.reasoning ?? null;
      details.next_action = out.sequence?.length
        ? `${out.sequence.length}-touch sequence starting on ${out.sequence[0].channel}`
        : out.no_contact_reason;
      details.priority = out.priority;
    } else if (run.agent_name === 'personalisation') {
      details.subject = out.subject ?? null;
      details.message_text = out.body ?? null;
      details.reason = out.reasoning ?? null;
      if (out.needs_human) {
        type = 'needs_human';
        details.reason = out.needs_human_reason ?? details.reason;
      }
    } else if (run.agent_name === 'conversation') {
      details.detected_intent = out.intent ?? null;
      details.reason = out.reasoning ?? null;
      details.action_taken = out.recommended_action ?? null;
    }

    if (run.status === 'degraded') {
      details.degraded_note = run.error_message;
    }

    const knowledgeChunks = Array.isArray(run.retrieved_chunks)
      ? run.retrieved_chunks.map((c) => (typeof c === 'string' ? c : c.title ?? c.type ?? 'knowledge chunk'))
      : (out.knowledge_used ?? []).map((k) => k.source ?? k.claim ?? 'knowledge chunk');

    events.push({
      type,
      agent: getAgentName(run.agent_name),
      agent_engine: run.engine ?? getAgentEngine(run.agent_name),
      prompt_version: pv ? `v${pv.version}` : null,
      prompt_version_id: run.prompt_version_id ?? null,
      tokens_used: (run.tokens_in ?? 0) + (run.tokens_out ?? 0),
      cost: Number(run.cost_usd ?? 0),
      latency_ms: run.latency_ms ?? null,
      status: run.status,
      timestamp: run.created_at,
      details,
      knowledge_chunks: knowledgeChunks,
    });
  }

  for (const msg of messages) {
    if (msg.direction !== 'inbound') continue;
    events.push({
      type: 'replied',
      agent: null,
      agent_engine: null,
      prompt_version: null,
      tokens_used: 0,
      cost: 0,
      timestamp: msg.received_at ?? msg.created_at,
      details: { reply_text: msg.body, detected_intent: msg.intent },
      knowledge_chunks: [],
    });
  }

  if (campaignProspect?.state === 'meeting') {
    events.push({
      type: 'meeting_booked',
      agent: getAgentName('followup_timing'),
      agent_engine: 'our_engine',
      prompt_version: null,
      tokens_used: 0,
      cost: 0,
      timestamp: campaignProspect.last_touch_at ?? campaignProspect.updated_at,
      details: { action_taken: 'Meeting booked and handed to the rep' },
      knowledge_chunks: [],
    });
  }

  return events
    .filter((e) => e.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function mapProspectDetail({ prospect, campaignProspect, campaign, runs, messages, promptVersions }) {
  const base = mapProspectListItem(campaignProspect, prospect, campaign);
  const f = resolveProspectFields(prospect);
  const icpResult = campaignProspect?.icp_result ?? {};

  return {
    ...base,
    provenance: f.provenance,
    enriched_data: prospect?.enriched_data ?? null,
    signals: [
      ...(f.enriched.signals?.intent_signals ?? []),
      ...(f.enriched.signals?.tech_stack ?? []),
      ...(f.enriched.signals?.hiring_roles ?? []),
    ].slice(0, 8),
    fit_reason: icpResult.reasoning ?? null,
    icp_verdict: campaignProspect?.icp_verdict
      ? {
          status: campaignProspect.icp_verdict,
          fit_score: campaignProspect.fit_score ?? icpResult.fit_score ?? null,
          confidence: campaignProspect.icp_confidence ?? icpResult.confidence ?? null,
          reasoning: icpResult.reasoning ?? null,
          dimension_scores: icpResult.dimension_scores ?? null,
          missing_data: icpResult.missing_data ?? [],
          disqualifiers: icpResult.disqualifiers ?? [],
        }
      : null,
    outreach_plan: campaignProspect?.outreach_plan ?? campaignProspect?.sequence ?? [],
    facts: buildFacts(prospect),
    timeline: buildTimeline({ prospect, campaignProspect, runs, messages, promptVersions }),
    messages: messages ?? [],
  };
}

/* ── activities ─────────────────────────────────────────────────────── */

export function mapActivity(row) {
  if (!row) return null;
  const agent = getAgent(row.agent_name);

  // Operator actions are logged against 'system', whose registry entry is named
  // "System Prompt" — correct for the prompt editor, wrong as the actor in an
  // activity feed.
  const actor = row.agent_name === 'system' ? 'System' : (agent?.name ?? row.agent_name ?? 'System');

  return {
    id: row.id,
    campaign_id: row.campaign_id,
    campaign_name: row.campaigns?.name ?? null,
    campaign_colour: row.campaigns?.colour ?? null,
    prospect_id: row.prospect_id,
    prospect_name: row.prospect_name ?? null,
    prospect_company: row.prospect_company ?? null,
    agent: actor,
    agent_key: row.agent_name ?? null,
    agent_engine: row.engine ?? agent?.engine ?? null,
    action: row.action ?? '',
    outcome: row.outcome ?? row.action ?? '',
    status: row.status ?? 'success',
    details: row.metadata ?? {},
    timestamp: row.created_at,
    created_at: row.created_at,
  };
}

/* ── escalations ────────────────────────────────────────────────────── */

const RISK_BY_TYPE = {
  escalate_to_human: 'high',
  objection_detected: 'high',
  opt_out: 'high',
  needs_review: 'medium',
  needs_human: 'medium',
  conflict: 'medium',
  agent_degraded: 'low',
};

export function mapEscalation(row) {
  if (!row) return null;
  const p = row.prospects ?? {};
  const prospectName = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name || row.campaigns?.name || null,
    prospect_id: row.prospect_id,
    prospect_name: row.prospect_name || prospectName,
    prospect_company: p.company_name ?? null,
    campaign_prospect_id: row.campaign_prospect_id ?? null,
    source_agent: getAgentName(row.source_agent) ?? row.source_agent,
    source_agent_key: row.source_agent,
    escalation_type: row.escalation_type,
    risk_level: row.risk_level ?? RISK_BY_TYPE[row.escalation_type] ?? 'low',
    reason: row.reason ?? '',
    proposed_action: row.proposed_action ?? row.reason ?? '',
    proposed_payload: row.proposed_payload ?? null,
    status: row.status ?? 'pending',
    created_at: row.created_at,
  };
}

/* ── conflicts ──────────────────────────────────────────────────────── */

export function mapConflict(row, campaignsById = new Map()) {
  if (!row) return null;
  const p = row.prospects ?? {};
  const ids = row.campaign_ids ?? [];
  const joinedName = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return {
    id: row.id,
    prospect_id: row.prospect_id,
    // `join` returns '' rather than null, so `||` is correct here and mixing it
    // with `??` in one expression is a syntax error.
    prospect_name: row.prospect_name || joinedName || 'Unknown prospect',
    prospect_company: p.company_name ?? null,
    campaign_ids: ids,
    campaigns: ids.map((id) => campaignsById.get(id)?.name ?? id),
    type: row.rule ?? 'manual_review',
    conflict_type: row.rule ?? 'manual_review',
    last_touch: row.last_touch ?? row.created_at,
    last_touch_channel: row.last_touch_channel ?? null,
    next_action: row.next_action ?? null,
    contact_count: row.contact_count ?? null,
    status: row.status ?? 'pending',
    created_at: row.created_at,
  };
}

/* ── prompts ────────────────────────────────────────────────────────── */

export function mapPromptVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    agent_name: row.agent_name,
    agent_label: getAgentName(row.agent_name),
    version: row.version,
    content: row.content ?? '',
    is_active: Boolean(row.is_active),
    author: row.author ?? 'System',
    created_at: row.created_at,
  };
}
