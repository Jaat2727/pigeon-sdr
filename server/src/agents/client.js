/**
 * Agent client — the single door every agent call goes through.
 *
 * Call order for one agent invocation:
 *
 *   1. If DronaHQ is configured for this agent, call it.
 *   2. Coerce whatever came back into the expected shape (strings to numbers,
 *      stringified JSON to arrays, alternate field names to canonical ones).
 *   3. Validate the coerced object against the agent's schema.
 *   4. If the load-bearing fields are all null, or validation fails, retry once
 *      with the validation error appended to the payload so the agent can
 *      correct itself.
 *   5. If it fails again, fall back to the local engine so the pipeline keeps
 *      moving, and record why.
 *   6. Write the run to `agent_runs` with the engine that produced it, the
 *      inputs, the output, retrieved chunks, tokens, cost and latency — before
 *      returning, so the run is auditable even if the caller then throws.
 *
 * The caller always receives a usable result object. It never has to handle a
 * half-parsed response or a null.
 */
import { randomUUID } from 'node:crypto';
import { supabase, dbReady } from '../db/client.js';
import { env, isDronaHqConfigured } from '../config.js';
import { callDronaHq, DronaHqError } from './dronahq.js';
import { AGENT_SCHEMAS, isEmptyOutput } from './schemas.js';
import { runLocalEngine } from './localEngine.js';
import { getAgentEngine } from './registry.js';

/** Rough token estimate when the provider reports none. ~4 chars per token. */
function estimateTokens(value) {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil((text?.length ?? 0) / 4);
}

function estimateCost(tokensIn, tokensOut) {
  const total = (tokensIn || 0) + (tokensOut || 0);
  return Number(((total / 1000) * env.COST_PER_1K_TOKENS_USD).toFixed(6));
}

/**
 * Runs coercion then validation. Returns { ok, value, reason }.
 */
function validateOutput(agentName, rawOutput, coerceContext) {
  const spec = AGENT_SCHEMAS[agentName];
  if (!spec) return { ok: false, value: null, reason: `No schema registered for agent "${agentName}"` };

  let coerced;
  try {
    coerced = spec.coerce(rawOutput, coerceContext);
  } catch (err) {
    return { ok: false, value: null, reason: `Could not reshape the response: ${err.message}` };
  }

  if (isEmptyOutput(agentName, coerced)) {
    return {
      ok: false,
      value: coerced,
      reason:
        `Every required field (${spec.requiredFields.join(', ')}) came back null or empty. ` +
        'This is the signature of an agent whose webhook response is not configured, or whose ' +
        'model returned an empty object.',
    };
  }

  const parsed = spec.schema.safeParse(coerced);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, value: coerced, reason: `Schema validation failed — ${issues}` };
  }

  return { ok: true, value: parsed.data, reason: null };
}

/**
 * Persists one agent run. Never throws: a logging failure must not take down a
 * pipeline step, but it is reported so it is not silent.
 */
async function recordRun(row) {
  if (!dbReady) return null;
  try {
    const { data, error } = await supabase.from('agent_runs').insert(row).select('id').single();
    if (error) {
      console.error('[agent_runs] insert failed:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error('[agent_runs] insert threw:', err.message);
    return null;
  }
}

/**
 * @param {string} agentName  registry id, e.g. 'icp_fitment'
 * @param {object} payload    the agent input, already assembled by the orchestrator
 * @param {object} meta       { campaign_id, prospect_id, campaign_prospect_id,
 *                              prompt_version_id, retrieved_chunks, localPayload,
 *                              coerceContext }
 * @returns {Promise<{success, engine, output, degraded, error, latencyMs, agentRunId}>}
 */
export async function callAgent(agentName, payload, meta = {}) {
  const startedAt = Date.now();
  const spec = AGENT_SCHEMAS[agentName];

  if (!spec) {
    throw new Error(`Unknown agent "${agentName}". Add it to AGENT_SCHEMAS before calling it.`);
  }

  const attempts = [];
  let output = null;
  let engine = null;
  let degraded = false;
  let failureReason = null;
  let tokensIn = null;
  let tokensOut = null;
  let costUsd = null;

  const wantsDronaHq = getAgentEngine(agentName) === 'dronahq' && isDronaHqConfigured(agentName);

  if (wantsDronaHq) {
    for (let attempt = 0; attempt < 2 && !output; attempt += 1) {
      const body =
        attempt === 0
          ? payload
          : {
              ...payload,
              _retry: true,
              _previous_error: failureReason,
              _instruction:
                'The previous response could not be used. Return only a JSON object matching ' +
                'the declared output schema, with no prose and no markdown fences. Use null for ' +
                'fields you cannot determine rather than omitting them.',
            };

      try {
        const res = await callDronaHq(agentName, body);
        const validated = validateOutput(agentName, res.output, meta.coerceContext);

        if (validated.ok) {
          output = validated.value;
          engine = 'dronahq';
          tokensIn = res.tokensIn ?? estimateTokens(body);
          tokensOut = res.tokensOut ?? estimateTokens(res.output);
          costUsd = res.costUsd ?? estimateCost(tokensIn, tokensOut);
        } else {
          failureReason = validated.reason;
          attempts.push({ attempt: attempt + 1, source: 'dronahq', error: validated.reason });
        }
      } catch (err) {
        failureReason =
          err instanceof DronaHqError ? `[${err.code}] ${err.message}` : err.message;
        attempts.push({ attempt: attempt + 1, source: 'dronahq', error: failureReason });
        // A misconfigured webhook will not fix itself on a retry.
        if (err instanceof DronaHqError &&
            ['async_acknowledgement', 'not_configured', 'http_error'].includes(err.code)) {
          break;
        }
      }
    }
  } else if (getAgentEngine(agentName) === 'dronahq') {
    failureReason = `DronaHQ is not configured for "${agentName}" (missing URL or API key).`;
    attempts.push({ attempt: 0, source: 'dronahq', error: failureReason });
  }

  // Fallback: the local engine.
  if (!output) {
    if (getAgentEngine(agentName) !== 'dronahq') {
      // Agents that always run locally by design are not "degraded".
      degraded = false;
    } else if (!env.LOCAL_ENGINE_ENABLED) {
      const latencyMs = Date.now() - startedAt;
      const agentRunId = await recordRun({
        id: randomUUID(),
        campaign_id: meta.campaign_id ?? null,
        prospect_id: meta.prospect_id ?? null,
        campaign_prospect_id: meta.campaign_prospect_id ?? null,
        agent_name: agentName,
        engine: 'dronahq',
        prompt_version_id: meta.prompt_version_id ?? null,
        input_payload: payload,
        output_payload: { attempts },
        retrieved_chunks: meta.retrieved_chunks ?? [],
        status: 'error',
        error_message: failureReason,
        latency_ms: latencyMs,
      });
      return {
        success: false, engine: 'dronahq', output: null, degraded: true,
        error: failureReason, latencyMs, agentRunId, attempts,
      };
    } else {
      degraded = true;
    }

    try {
      const localInput = meta.localPayload ?? payload;
      const localOut = runLocalEngine(agentName, localInput);
      const validated = validateOutput(agentName, localOut, meta.coerceContext);
      output = validated.ok ? validated.value : localOut;
      engine = 'local_engine';
      tokensIn = 0;
      tokensOut = 0;
      costUsd = 0;
      if (!validated.ok) {
        attempts.push({ attempt: attempts.length + 1, source: 'local_engine', error: validated.reason });
      }
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message = `Local engine also failed for "${agentName}": ${err.message}`;
      const agentRunId = await recordRun({
        id: randomUUID(),
        campaign_id: meta.campaign_id ?? null,
        prospect_id: meta.prospect_id ?? null,
        campaign_prospect_id: meta.campaign_prospect_id ?? null,
        agent_name: agentName,
        engine: 'local_engine',
        prompt_version_id: meta.prompt_version_id ?? null,
        input_payload: payload,
        output_payload: { attempts },
        retrieved_chunks: meta.retrieved_chunks ?? [],
        status: 'error',
        error_message: message,
        latency_ms: latencyMs,
      });
      return {
        success: false, engine: 'local_engine', output: null, degraded: true,
        error: message, latencyMs, agentRunId, attempts,
      };
    }
  }

  const latencyMs = Date.now() - startedAt;

  const agentRunId = await recordRun({
    id: randomUUID(),
    campaign_id: meta.campaign_id ?? null,
    prospect_id: meta.prospect_id ?? null,
    campaign_prospect_id: meta.campaign_prospect_id ?? null,
    agent_name: agentName,
    engine,
    prompt_version_id: meta.prompt_version_id ?? null,
    input_payload: payload,
    output_payload: output,
    retrieved_chunks: meta.retrieved_chunks ?? [],
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: costUsd,
    latency_ms: latencyMs,
    status: degraded ? 'degraded' : 'success',
    error_message: degraded ? failureReason : null,
  });

  if (degraded) {
    console.warn(`[agents] ${agentName} fell back to the local engine: ${failureReason}`);
  }

  return {
    success: true,
    engine,
    output,
    degraded,
    error: degraded ? failureReason : null,
    latencyMs,
    agentRunId,
    tokensIn,
    tokensOut,
    costUsd,
    attempts,
  };
}

/**
 * Connectivity probe used by /agents/:name/test. Reports precisely what a
 * DronaHQ agent answered without writing anything to the database, so you can
 * debug a webhook from the deployed app rather than from a terminal.
 */
export async function probeAgent(agentName, payload = {}) {
  if (!AGENT_SCHEMAS[agentName]) {
    return { agent: agentName, configured: false, reachable: false, error: 'Unknown agent id' };
  }
  if (!isDronaHqConfigured(agentName)) {
    return {
      agent: agentName,
      configured: false,
      reachable: false,
      error: `No DRONAHQ_${agentName.toUpperCase()}_URL / key configured. This agent runs on the local engine.`,
    };
  }

  const startedAt = Date.now();
  try {
    const res = await callDronaHq(agentName, payload);
    const validated = validateOutput(agentName, res.output);
    return {
      agent: agentName,
      configured: true,
      reachable: true,
      valid: validated.ok,
      problem: validated.reason,
      latency_ms: Date.now() - startedAt,
      unwrapped_output: res.output,
      raw_body: res.raw,
    };
  } catch (err) {
    return {
      agent: agentName,
      configured: true,
      reachable: err.code !== 'network_error' && err.code !== 'timeout',
      valid: false,
      error_code: err.code ?? 'unknown',
      problem: err.message,
      latency_ms: Date.now() - startedAt,
      raw_body: err.raw ?? null,
    };
  }
}

export default callAgent;
