/**
 * Central configuration.
 *
 * Every environment variable the server reads is declared here. Nothing else in
 * the codebase touches process.env directly, so a missing variable is reported
 * once, at boot, with a name you can paste into Railway.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Look for a .env next to the server, then at the repo root. On Railway neither
// exists and the platform injects the variables directly, which is fine.
for (const candidate of [
  path.resolve(here, '..', '.env'),
  path.resolve(here, '..', '..', '.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const str = (name, fallback = '') => (process.env[name] ?? fallback).toString().trim();
const bool = (name, fallback = false) => {
  const raw = str(name);
  if (raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};
const int = (name, fallback) => {
  const parsed = parseInt(str(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const list = (name, fallback = []) => {
  const raw = str(name);
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

export const env = {
  NODE_ENV: str('NODE_ENV', 'development'),
  PORT: int('PORT', 3001),
  HOST: str('HOST', '0.0.0.0'),

  // Supabase (service role — server side only, never shipped to the browser)
  SUPABASE_URL: str('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: str('SUPABASE_SERVICE_ROLE_KEY'),

  // Comma-separated list of browser origins allowed to call this API.
  CORS_ORIGINS: list('CORS_ORIGINS', [
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
  ]),

  // Background worker
  WORKER_ENABLED: bool('WORKER_ENABLED', false),
  WORKER_POLL_MS: int('WORKER_POLL_MS', 30000),
  WORKER_BATCH_SIZE: int('WORKER_BATCH_SIZE', 5),

  // Spend guardrails
  MAX_AGENT_CALLS_PER_DAY: int('MAX_AGENT_CALLS_PER_DAY', 200),
  AGENT_TIMEOUT_MS: int('AGENT_TIMEOUT_MS', 45000),

  // Fallback engine. When true, a DronaHQ call that fails or returns nothing
  // usable is answered by the deterministic local engine instead of stalling
  // the pipeline. Every run records which engine produced it.
  LOCAL_ENGINE_ENABLED: bool('LOCAL_ENGINE_ENABLED', true),

  // Pricing used to attribute cost to a run when the provider reports none.
  COST_PER_1K_TOKENS_USD: parseFloat(str('COST_PER_1K_TOKENS_USD', '0.015')) || 0.015,
};

/**
 * DronaHQ agent endpoints. Each agent has its own webhook URL and key so an
 * agent can be rolled out or rolled back on its own.
 */
export const DRONAHQ_AGENTS = {
  research: {
    url: str('DRONAHQ_RESEARCH_URL'),
    key: str('DRONAHQ_RESEARCH_KEY') || str('DRONAHQ_API_KEY'),
  },
  icp_fitment: {
    url: str('DRONAHQ_ICP_URL'),
    key: str('DRONAHQ_ICP_KEY') || str('DRONAHQ_API_KEY'),
  },
  outreach_strategy: {
    url: str('DRONAHQ_STRATEGY_URL'),
    key: str('DRONAHQ_STRATEGY_KEY') || str('DRONAHQ_API_KEY'),
  },
  personalisation: {
    url: str('DRONAHQ_PERSONALISATION_URL'),
    key: str('DRONAHQ_PERSONALISATION_KEY') || str('DRONAHQ_API_KEY'),
  },
  conversation: {
    url: str('DRONAHQ_CONVERSATION_URL'),
    key: str('DRONAHQ_CONVERSATION_KEY') || str('DRONAHQ_API_KEY'),
  },
};

export function isDronaHqConfigured(agentName) {
  const cfg = DRONAHQ_AGENTS[agentName];
  return Boolean(cfg && cfg.url && cfg.key);
}

/**
 * Returns a report of what is and is not configured. The server logs this at
 * boot and /health exposes it, so a misconfigured deploy is visible in one
 * request rather than through a stack trace on the first agent call.
 */
export function configReport() {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  const agents = {};
  for (const name of Object.keys(DRONAHQ_AGENTS)) {
    agents[name] = isDronaHqConfigured(name) ? 'dronahq' : 'local_engine';
  }

  return {
    node_env: env.NODE_ENV,
    database_configured: missing.length === 0,
    missing_required: missing,
    cors_origins: env.CORS_ORIGINS,
    worker_enabled: env.WORKER_ENABLED,
    local_engine_enabled: env.LOCAL_ENGINE_ENABLED,
    agent_routing: agents,
  };
}

export default env;
