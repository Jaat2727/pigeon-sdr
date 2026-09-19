/**
 * Agent status and diagnostics.
 *
 * The previous version of this route read `a.name` and `a.key` from a registry
 * that exported `id` and `display`, so every lookup missed and every agent
 * reported zero runs with pauses that never applied. Both sides now read the
 * same registry.
 *
 * `/agents/:id/test` exists because the most common failure in this stack is a
 * DronaHQ webhook that answers with a run acknowledgement rather than output.
 * That is diagnosable from the deployed app rather than only from a terminal.
 */
import express from 'express';
import { supabase, unwrapSoft } from '../db/client.js';
import { asyncHandler, notFound, badRequest } from '../lib/http.js';
import { AGENT_REGISTRY, getAgent } from '../agents/registry.js';
import { getSystemControl } from '../orchestrator/gate.js';
import { computeAgentPerformance } from '../services/metrics.js';
import { probeAgent } from '../agents/client.js';
import { isDronaHqConfigured, configReport } from '../config.js';

const router = express.Router();

const SAMPLE_PAYLOAD = {
  research: { prospect: { stub: { first_name: 'Test', last_name: 'Prospect', company_name: 'Example Inc', title: 'CTO', email: 'test@example.com' } }, campaign: { research_focus: 'connectivity test' } },
  icp_fitment: { prospect: { enriched_profile: { person: { title: 'CTO', seniority: 'C-Level' }, company: { name: 'Example Inc', industry: 'SaaS', employee_count: 300 } } }, campaign: { icp_criteria: 'SaaS CTOs at 50-2000 person companies', exclusion_criteria: 'agencies' } },
  outreach_strategy: { prospect: { enriched_profile: { person: { title: 'CTO' }, company: { name: 'Example Inc' } }, icp_result: { verdict: 'qualify', fit_score: 82, confidence: 'high' }, contact_history: [] }, campaign: { outreach_policy: '3-step email sequence', enabled_channels: ['email'] } },
  personalisation: { prospect: { enriched_profile: { person: { full_name: 'Test Prospect', title: 'CTO' }, company: { name: 'Example Inc' }, signals: { recent_news: 'raised a Series B' } }, thread_history: [] }, outreach: { current_step: { step: 1, channel: 'email', angle: 'open on the funding signal', goal: 'earn a reply' } }, campaign: { messaging_policy: 'under 80 words, peer to peer' }, retrieved_knowledge: [], rep: { identity: 'Connectivity Test' } },
  conversation: { inbound: { message: 'Sounds interesting, can we chat next week?', channel: 'email' }, prospect: { thread_history: [], enriched_profile: {} }, campaign: { objective_and_policy: 'book meetings' } },
};

/**
 * GET /agents — global agent status for the Agents screen.
 */
router.get('/', asyncHandler(async (req, res) => {
  const [control, performance] = await Promise.all([getSystemControl(), computeAgentPerformance()]);
  const perfByAgent = new Map(performance.map((p) => [p.agent_name, p]));

  const lastActions = unwrapSoft(
    await supabase
      .from('activities')
      .select('agent_name, outcome, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    [],
    'activities'
  );

  const lastByAgent = new Map();
  for (const a of lastActions) {
    if (!lastByAgent.has(a.agent_name)) lastByAgent.set(a.agent_name, a);
  }

  res.json(
    AGENT_REGISTRY.filter((a) => a.id !== 'system').map((agent) => {
      const perf = perfByAgent.get(agent.id);
      const paused = Boolean(control.agent_pauses?.[agent.id]);
      const last = lastByAgent.get(agent.id);

      // Which engine actually served this agent most recently, which is not
      // always the one it is configured to use. An agent that is not callable
      // at all is reported on its configured engine rather than as a fallback:
      // it has not fallen back to anything, it simply has not been built.
      const activeEngine = !agent.callable
        ? agent.engine
        : (perf?.engines_used?.[perf.engines_used.length - 1] ??
           (agent.engine === 'dronahq' && !isDronaHqConfigured(agent.id) ? 'local_engine' : agent.engine));

      return {
        id: agent.id,
        key: agent.id,
        name: agent.name,
        engine: activeEngine,
        configured_engine: agent.engine,
        callable: agent.callable,
        dronahq_configured: isDronaHqConfigured(agent.id),
        description: agent.description,
        paused,
        status: paused ? 'paused' : (perf?.runs_today ?? 0) > 0 ? 'running' : 'idle',
        runs_today: perf?.runs_today ?? 0,
        runs_total: perf?.runs ?? 0,
        failures_today: perf?.failures_today ?? 0,
        degraded_runs: perf?.degraded_runs ?? 0,
        success_rate: perf?.success_rate ?? 0,
        avg_latency_ms: perf?.avg_latency_ms ?? 0,
        cost: perf?.cost ?? 0,
        current_task: !agent.callable
          ? 'Stretch agent — planned and gated, but not implemented'
          : paused
            ? 'Paused by an operator'
            : (perf?.runs_today ?? 0) > 0
              ? `${perf.runs_today} run(s) today`
              : 'Idle — waiting for work',
        last_action: last?.outcome ?? null,
        last_action_at: last?.created_at ?? perf?.last_run_at ?? null,
      };
    })
  );
}));

// GET /agents/performance — the Analytics table, counted from agent_runs.
router.get('/performance', asyncHandler(async (req, res) => {
  const performance = await computeAgentPerformance(req.query.campaignId ?? null);
  const byAgent = new Map(performance.map((p) => [p.agent_name, p]));

  res.json(
    AGENT_REGISTRY.filter((a) => a.id !== 'system').map((agent) => {
      const p = byAgent.get(agent.id);
      return {
        key: agent.id,
        name: agent.name,
        engine: agent.engine,
        runs: p?.runs ?? 0,
        success: p?.success_rate ?? 0,
        failures: p?.failures ?? 0,
        degraded: p?.degraded_runs ?? 0,
        cost: p?.cost ?? 0,
        avg_latency_ms: p?.avg_latency_ms ?? 0,
      };
    })
  );
}));

// GET /agents/routing — which engine each agent will actually use right now.
router.get('/routing', asyncHandler(async (req, res) => {
  res.json(configReport());
}));

/**
 * POST /agents/:id/test
 * Fires one call at the configured DronaHQ webhook with a sample payload and
 * reports exactly what came back, including the raw body. Nothing is written
 * to the database.
 */
router.post('/:id/test', asyncHandler(async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) throw notFound(`Unknown agent "${req.params.id}"`);
  if (!agent.callable) throw badRequest(`${agent.name} is not a callable agent`);

  const payload = req.body?.payload ?? SAMPLE_PAYLOAD[agent.id] ?? {};
  const result = await probeAgent(agent.id, payload);

  res.json({
    ...result,
    agent_name: agent.name,
    sent_payload: payload,
    guidance:
      result.error_code === 'async_acknowledgement'
        ? 'Open this agent in DronaHQ, go to the Webhook trigger, open "Configure Response", switch it from Background to Standard and paste the output JSON schema.'
        : result.error_code === 'not_configured'
          ? `Set DRONAHQ_${agent.id.toUpperCase()}_URL and DRONAHQ_${agent.id.toUpperCase()}_KEY (or DRONAHQ_API_KEY) in the server environment.`
          : result.valid === false && result.reachable
            ? 'The webhook answered but the output did not match the expected schema. The unwrapped_output field shows what came back.'
            : null,
  });
}));

export default router;
