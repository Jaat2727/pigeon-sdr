/**
 * Canonical agent registry.
 *
 * This is the single source of truth for agent identity. Routes, the
 * orchestrator, prompt versioning and the UI all key off `id`. The previous
 * version exported `{ id, display }` while the routes read `a.name` and
 * `a.key`, which is why every agent reported zero runs — every consumer now
 * gets all three fields from one place.
 */

export const AGENT_REGISTRY = [
  {
    id: 'system',
    key: 'system',
    name: 'System Prompt',
    engine: 'dronahq',
    callable: false,
    description:
      'The campaign-level system prompt. Prepended to every agent call in this campaign. Not an agent itself — it is the harness they all run inside.',
  },
  {
    id: 'research',
    key: 'research',
    name: 'Lead Research Agent',
    engine: 'dronahq',
    callable: true,
    description:
      'Researches the person and their company and returns a structured profile. Never guesses: a null field is a correct answer, an invented value is not.',
  },
  {
    id: 'icp_fitment',
    key: 'icp_fitment',
    name: 'ICP Fitment Agent',
    engine: 'dronahq',
    callable: true,
    description:
      'Scores a researched prospect against this campaign ICP and returns qualify, reject or needs_review. Exclusion criteria are checked first and override the score.',
  },
  {
    id: 'outreach_strategy',
    key: 'outreach_strategy',
    name: 'Outreach Strategy Agent',
    engine: 'dronahq',
    callable: true,
    description:
      'Decides whether, when and on which channels to contact a qualified prospect, and returns a 3 to 5 touch sequence as day offsets.',
  },
  {
    id: 'personalisation',
    key: 'personalisation',
    name: 'Personalisation Agent',
    engine: 'dronahq',
    callable: true,
    description:
      'Writes one message for one step at send time. Every claim about the prospect cites a profile field and every product claim cites a knowledge chunk.',
  },
  {
    id: 'conversation',
    key: 'conversation',
    name: 'Conversation Agent',
    engine: 'dronahq',
    callable: true,
    description:
      'Reads an inbound reply, classifies intent and sentiment, extracts facts, and recommends the next action. Opt-out overrides every other reading.',
  },
  {
    id: 'followup_timing',
    key: 'followup_timing',
    name: 'Follow-up Timing Agent',
    engine: 'our_engine',
    callable: true,
    description:
      'Decides when to send the next touch or when to stop. Runs in our own engine rather than DronaHQ because it is deterministic scheduling, not language work.',
  },
  {
    id: 'voice_sdr',
    key: 'voice_sdr',
    name: 'Voice SDR Agent',
    engine: 'dronahq',
    callable: false,
    description:
      'Conducts voice calls, qualifies on the call and escalates to a human when needed. Stretch agent — simulated unless a telephony provider is configured.',
  },
];

/** Agents the orchestrator can actually invoke. */
export const CALLABLE_AGENTS = AGENT_REGISTRY.filter((a) => a.callable).map((a) => a.id);

const byId = new Map(AGENT_REGISTRY.map((a) => [a.id, a]));
const byName = new Map(AGENT_REGISTRY.map((a) => [a.name.toLowerCase(), a]));

export function getAgent(idOrName) {
  if (!idOrName) return null;
  const raw = String(idOrName);
  return byId.get(raw) || byName.get(raw.toLowerCase()) || null;
}

export function getAgentName(id) {
  return getAgent(id)?.name ?? id;
}

export function getAgentId(idOrName) {
  return getAgent(idOrName)?.id ?? idOrName;
}

export function getAgentEngine(id) {
  return getAgent(id)?.engine ?? 'our_engine';
}

export default AGENT_REGISTRY;
