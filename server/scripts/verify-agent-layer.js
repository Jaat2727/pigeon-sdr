#!/usr/bin/env node
/**
 * Agent-layer verification.
 *
 * Runs entirely offline — no database, no DronaHQ, no network — so it can be
 * run before a deploy to prove the two things most likely to break silently:
 *
 *   1. Response handling. Every envelope shape a DronaHQ webhook can answer
 *      with is unwrapped to the same output object, and a response whose
 *      fields are all null is detected as empty rather than written to the
 *      database as a real result.
 *   2. The local engine. Every agent produces output that passes its own
 *      schema, so a fallback can never put a malformed record into the
 *      pipeline.
 *
 *   node server/scripts/verify-agent-layer.js
 */

import { unwrapEnvelope, parseLooseJson, isAsyncAcknowledgement } from '../src/agents/dronahq.js';
import { AGENT_SCHEMAS, isEmptyOutput } from '../src/agents/schemas.js';
import { runLocalEngine } from '../src/agents/localEngine.js';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) {
      failed += 1;
      console.log(`${RED}FAIL${RESET}  ${name}\n      ${problem}`);
    } else {
      passed += 1;
      console.log(`${GREEN}pass${RESET}  ${name}`);
    }
  } catch (err) {
    failed += 1;
    console.log(`${RED}FAIL${RESET}  ${name}\n      threw: ${err.message}`);
  }
}

const eq = (actual, expected, label) =>
  JSON.stringify(actual) === JSON.stringify(expected)
    ? null
    : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;

/* ── 1 · envelope unwrapping ────────────────────────────────────────── */

console.log(`\n${DIM}Response envelope handling${RESET}`);

const TARGET = { verdict: 'qualify', fit_score: 82, confidence: 'high', reasoning: 'fits' };

const ENVELOPES = {
  'bare object': TARGET,
  'response key': { response: TARGET },
  'output key': { output: TARGET },
  'result key': { result: TARGET },
  'data key': { data: TARGET },
  'stringified response': { response: JSON.stringify(TARGET) },
  'double wrapped': { data: { output: TARGET } },
  'success wrapper': { success: true, data: TARGET },
  'single-element array': [TARGET],
  'markdown fenced string': { response: '```json\n' + JSON.stringify(TARGET) + '\n```' },
  'prose around json': { response: `Here is the result:\n${JSON.stringify(TARGET)}\nHope that helps.` },
};

for (const [label, envelope] of Object.entries(ENVELOPES)) {
  check(`unwraps ${label}`, () => {
    const out = unwrapEnvelope(envelope);
    return out?.verdict === 'qualify' && out?.fit_score === 82
      ? null
      : `got ${JSON.stringify(out)}`;
  });
}

check('detects a background-run acknowledgement', () =>
  isAsyncAcknowledgement({ run_id: 'r_1', thread_id: 't_1' })
    ? null
    : 'a run_id/thread_id body was not recognised as an async ack'
);

check('does not mistake real output carrying a run_id for an ack', () =>
  isAsyncAcknowledgement({ run_id: 'r_1', response: TARGET })
    ? 'a body with both a run_id and output was treated as an ack'
    : null
);

check('parses JSON with a trailing newline and whitespace', () =>
  parseLooseJson('  \n{"a":1}\n  ')?.a === 1 ? null : 'failed to parse padded JSON'
);

/* ── 2 · null handling ──────────────────────────────────────────────── */

console.log(`\n${DIM}Null and malformed field handling${RESET}`);

check('an all-null ICP response is detected as empty', () => {
  const coerced = AGENT_SCHEMAS.icp_fitment.coerce({
    fit_score: null, verdict: null, confidence: null, reasoning: null,
  });
  return isEmptyOutput('icp_fitment', coerced) ? null : 'all-null output was not flagged as empty';
});

check('an all-null research response is detected as empty', () => {
  const coerced = AGENT_SCHEMAS.research.coerce({ full_name: null, title: null, company_name: null });
  return isEmptyOutput('research', coerced) ? null : 'all-null output was not flagged as empty';
});

check('a populated ICP response is not flagged as empty', () => {
  const coerced = AGENT_SCHEMAS.icp_fitment.coerce(TARGET);
  return isEmptyOutput('icp_fitment', coerced) ? 'valid output was wrongly flagged as empty' : null;
});

check('string placeholders count as null', () => {
  const coerced = AGENT_SCHEMAS.icp_fitment.coerce({
    fit_score: 'N/A', verdict: 'null', confidence: '', reasoning: 'none',
  });
  return isEmptyOutput('icp_fitment', coerced)
    ? null
    : 'placeholder strings were treated as real values';
});

check('numbers arriving as strings are coerced', () => {
  const c = AGENT_SCHEMAS.icp_fitment.coerce({ fit_score: '82', verdict: 'qualify', confidence: 'high', reasoning: 'x' });
  return eq(c.fit_score, 82, 'fit_score');
});

check('a score above 100 is clamped', () => {
  const c = AGENT_SCHEMAS.icp_fitment.coerce({ fit_score: 150, verdict: 'qualify', confidence: 'high', reasoning: 'x' });
  return eq(c.fit_score, 100, 'fit_score');
});

check('verdict synonyms map to the canonical three', () => {
  const qualified = AGENT_SCHEMAS.icp_fitment.coerce({ verdict: 'Qualified', fit_score: 80 }).verdict;
  const rejected = AGENT_SCHEMAS.icp_fitment.coerce({ verdict: 'REJECTED', fit_score: 10 }).verdict;
  const review = AGENT_SCHEMAS.icp_fitment.coerce({ verdict: 'Needs Review', fit_score: 50 }).verdict;
  return eq([qualified, rejected, review], ['qualify', 'reject', 'needs_review'], 'verdicts');
});

check('stringified arrays are parsed', () => {
  const c = AGENT_SCHEMAS.icp_fitment.coerce({
    verdict: 'reject', fit_score: 10, reasoning: 'x',
    disqualifiers: '["agency","outside US"]',
  });
  return eq(c.disqualifiers, ['agency', 'outside US'], 'disqualifiers');
});

check('comma-separated text is read as an array', () => {
  const c = AGENT_SCHEMAS.icp_fitment.coerce({
    verdict: 'reject', fit_score: 10, reasoning: 'x', missing_data: 'title, seniority, industry',
  });
  return eq(c.missing_data, ['title', 'seniority', 'industry'], 'missing_data');
});

check('flattened research output is normalised to the nested shape', () => {
  const c = AGENT_SCHEMAS.research.coerce({
    full_name: 'Sarah Chen', title: 'CTO', company_name: 'Northwind', company_employee_count: '420',
  });
  return (
    eq(c.person.full_name, 'Sarah Chen', 'person.full_name') ||
    eq(c.company.name, 'Northwind', 'company.name') ||
    eq(c.company.employee_count, 420, 'company.employee_count')
  );
});

check('conversation confidence given as 0-100 is normalised to 0-1', () => {
  const c = AGENT_SCHEMAS.conversation.coerce({ intent: 'interested', intent_confidence: 85 });
  return eq(c.intent_confidence, 0.85, 'intent_confidence');
});

/* ── 3 · local engine output validity ───────────────────────────────── */

console.log(`\n${DIM}Local engine output${RESET}`);

const STUB = {
  first_name: 'Sarah', last_name: 'Chen', email: 'sarah@northwind.example',
  title: 'CTO', company_name: 'Northwind Systems', company_domain: 'northwind.example',
  company_industry: 'SaaS', company_employee_count: 420, company_funding_stage: 'Series C',
};

const CAMPAIGN = {
  icp_criteria: 'US-based CTOs at SaaS companies with 50 to 2000 employees, Series A or later',
  exclusion_criteria: 'Exclude consulting firms and agencies',
  target_roles: ['CTO', 'VP Engineering'],
  industry: ['SaaS'],
  company_size: '50-2000',
  enabled_channels: ['email', 'linkedin'],
  working_hours: { start: '09:00', end: '17:00' },
};

function validates(agent, output, label) {
  const spec = AGENT_SCHEMAS[agent];
  const coerced = spec.coerce(output);
  const parsed = spec.schema.safeParse(coerced);
  if (parsed.success) return null;
  return `${label}: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`;
}

const research = runLocalEngine('research', { stub: STUB });
check('research output passes its schema', () => validates('research', research, 'research'));

check('research names the fields it could not find', () =>
  research.fields_not_found.length > 0
    ? null
    : 'every field was reported as found, which cannot be true for a bare CRM record'
);

check('research derives seniority from the title', () =>
  research.person.seniority === 'C-Level' ? null : `got ${research.person.seniority}`
);

const icp = runLocalEngine('icp_fitment', { enriched_profile: research, campaign: CAMPAIGN });
check('ICP output passes its schema', () => validates('icp_fitment', icp, 'icp'));

check('a well-matched prospect qualifies', () =>
  icp.verdict === 'qualify' ? null : `verdict was ${icp.verdict} at score ${icp.fit_score}`
);

check('ICP reasoning cites specific dimensions', () =>
  icp.reasoning.includes('role') && icp.dimension_scores
    ? null
    : 'reasoning did not reference the scored dimensions'
);

const excluded = runLocalEngine('icp_fitment', {
  enriched_profile: runLocalEngine('research', {
    stub: { ...STUB, company_name: 'Fernhill Consulting', company_industry: 'Consulting' },
  }),
  campaign: CAMPAIGN,
});
check('an exclusion match is an immediate reject at score 0', () =>
  excluded.verdict === 'reject' && excluded.fit_score === 0
    ? null
    : `verdict ${excluded.verdict} at score ${excluded.fit_score}`
);

// Two false-exclusion cases that a naive keyword match gets wrong. Both were
// observed against the seed data before the matcher was tightened.
check('a word shared with the ICP criteria cannot trigger an exclusion', () => {
  const voiceCampaign = {
    icp_criteria: 'Founders and CTOs at voice AI, speech and conversational AI startups',
    exclusion_criteria: 'Exclude enterprise AI divisions inside large corporations, hardware-first companies, and agencies that resell voice platforms',
    target_roles: ['CTO', 'Founder'],
    industry: ['Voice AI'],
    company_size: '5-150',
  };
  const voiceProspect = runLocalEngine('research', {
    stub: {
      first_name: 'Nadia', last_name: 'Rahman', title: 'CTO & Co-Founder',
      company_name: 'Cadence Labs', company_industry: 'Voice AI',
      company_employee_count: 90, company_funding_stage: 'Series A',
    },
  });
  const out = runLocalEngine('icp_fitment', { enriched_profile: voiceProspect, campaign: voiceCampaign });
  return out.verdict !== 'reject'
    ? null
    : `a voice AI company was rejected by a voice AI campaign: ${out.disqualifiers.join(', ')}`;
});

check('an "outside <country>" clause does not reject prospects in that country', () => {
  const indiaCampaign = {
    icp_criteria: 'CIOs at Indian banks and NBFCs with more than 1000 employees',
    exclusion_criteria: 'Exclude cooperative banks, microfinance institutions and payment aggregators and any organisation outside India',
    target_roles: ['CIO'],
    industry: ['Banking'],
    company_size: '1000-50000',
  };
  const indianProspect = runLocalEngine('research', {
    stub: {
      first_name: 'Rajesh', last_name: 'Kumar', title: 'Chief Information Officer',
      company_name: 'Meridian Bank', company_industry: 'Banking',
      company_employee_count: 12000, location: 'Mumbai, India',
    },
  });
  const out = runLocalEngine('icp_fitment', { enriched_profile: indianProspect, campaign: indiaCampaign });
  return out.verdict !== 'reject'
    ? null
    : `an Indian bank was rejected by an India campaign: ${out.disqualifiers.join(', ')}`;
});

check('a genuine categorical exclusion still rejects', () => {
  const out = runLocalEngine('icp_fitment', {
    enriched_profile: runLocalEngine('research', {
      stub: { ...STUB, company_name: 'Apex Staffing', company_industry: 'Staffing' },
    }),
    campaign: { ...CAMPAIGN, exclusion_criteria: 'Exclude consulting firms, agencies and staffing companies' },
  });
  return out.verdict === 'reject' ? null : `verdict was ${out.verdict}`;
});

const thin = runLocalEngine('icp_fitment', { enriched_profile: { person: {}, company: {} }, campaign: CAMPAIGN });
check('a profile with nothing in it returns needs_review, not a low score', () =>
  thin.verdict === 'needs_review' ? null : `verdict was ${thin.verdict}`
);

const strategy = runLocalEngine('outreach_strategy', {
  enriched_profile: research, icp_result: icp, campaign: CAMPAIGN, contact_history: [],
});
check('strategy output passes its schema', () => validates('outreach_strategy', strategy, 'strategy'));

check('the sequence is 3 to 5 touches', () =>
  strategy.sequence.length >= 3 && strategy.sequence.length <= 5
    ? null
    : `got ${strategy.sequence.length} touches`
);

check('the first touch is never voice', () => {
  const voiceFirst = runLocalEngine('outreach_strategy', {
    enriched_profile: research, icp_result: icp,
    campaign: { ...CAMPAIGN, enabled_channels: ['voice', 'email'] }, contact_history: [],
  });
  return voiceFirst.sequence[0].channel !== 'voice'
    ? null
    : 'voice was planned as the opening touch';
});

check('day offsets increase across the sequence', () => {
  const offsets = strategy.sequence.map((s) => s.day_offset);
  const ascending = offsets.every((v, i) => i === 0 || v > offsets[i - 1]);
  return ascending ? null : `offsets were ${offsets.join(', ')}`;
});

check('a rejected prospect is never sequenced', () => {
  const s = runLocalEngine('outreach_strategy', {
    enriched_profile: research, icp_result: { verdict: 'reject', fit_score: 12 },
    campaign: CAMPAIGN, contact_history: [],
  });
  return s.should_contact === false && s.sequence.length === 0
    ? null
    : 'a rejected prospect was given a sequence';
});

const message = runLocalEngine('personalisation', {
  enriched_profile: {
    ...research,
    signals: { ...research.signals, recent_news: 'raised a Series C', tech_stack: ['Kubernetes'] },
  },
  current_step: strategy.sequence[0],
  retrieved_knowledge: [{ title: 'Case study', content: 'A similar team cut sourcing time in half.' }],
  rep: { full_name: 'Aarav Singh' },
});
check('personalisation output passes its schema', () => validates('personalisation', message, 'personalisation'));

check('every personalisation claim cites a profile field', () =>
  message.personalisation_used.length > 0 && message.personalisation_used.every((p) => p.source_field)
    ? null
    : 'a claim was made without a source field'
);

check('a thin profile sets needs_human instead of writing filler', () => {
  const empty = runLocalEngine('personalisation', {
    enriched_profile: { person: {}, company: {}, signals: {} },
    current_step: { step: 1, channel: 'email' },
    retrieved_knowledge: [],
    rep: {},
  });
  return empty.needs_human === true && empty.body === ''
    ? null
    : 'a message was written with nothing to ground it in';
});

console.log(`\n${DIM}Conversation intent rules${RESET}`);

const INTENT_CASES = [
  ['Please unsubscribe me from this list', 'opt_out'],
  ['Unsubscribe. Although this does sound interesting.', 'opt_out'],
  ['Undeliverable: address not found', 'bounce'],
  ['I am out of office until the 14th', 'auto_reply'],
  ['Can we schedule a call next week?', 'meeting_request'],
  ['Not interested, we already have a vendor', 'not_interested'],
  ['Not right now, circle back in Q3', 'not_now'],
  ['This is too expensive for where we are', 'objection'],
  ['You should speak to Priya, she handles this', 'referral'],
  ['I am not the right person for this', 'wrong_person'],
  ['qwerty zxcvb', 'unclear'],
];

for (const [text, expected] of INTENT_CASES) {
  check(`"${text.slice(0, 44)}${text.length > 44 ? '…' : ''}" reads as ${expected}`, () => {
    const out = runLocalEngine('conversation', { message: text });
    const problem = validates('conversation', out, 'conversation');
    if (problem) return problem;
    return out.intent === expected ? null : `classified as ${out.intent}`;
  });
}

check('an unclear reply escalates rather than guessing', () => {
  const out = runLocalEngine('conversation', { message: 'qwerty zxcvb' });
  return out.requires_human ? null : 'an unclassifiable reply was handled autonomously';
});

console.log(`\n${DIM}Follow-up timing${RESET}`);

const timing = runLocalEngine('followup_timing', {
  sequence: strategy.sequence,
  current_step: 0,
  last_touch_at: new Date('2026-01-05T10:00:00Z').toISOString(),
  working_hours: { start: '09:00' },
});

check('the next touch is scheduled after the last one', () =>
  new Date(timing.next_action_at) > new Date('2026-01-05T10:00:00Z')
    ? null
    : `scheduled for ${timing.next_action_at}`
);

check('a send is never scheduled onto a weekend', () => {
  const day = new Date(timing.next_action_at).getUTCDay();
  return day !== 0 && day !== 6 ? null : `scheduled on day ${day}`;
});

check('a finished sequence stops rather than looping', () => {
  const done = runLocalEngine('followup_timing', {
    sequence: strategy.sequence,
    current_step: strategy.sequence.length - 1,
    last_touch_at: new Date().toISOString(),
  });
  return done.should_continue === false ? null : 'the sequence continued past its last touch';
});

/* ── summary ────────────────────────────────────────────────────────── */

console.log(`\n${'─'.repeat(64)}`);
if (failed === 0) {
  console.log(`${GREEN}All ${passed} checks passed.${RESET}\n`);
  process.exit(0);
}
console.log(`${RED}${failed} failed${RESET}, ${passed} passed.\n`);
process.exit(1);
