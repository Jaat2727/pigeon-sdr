#!/usr/bin/env node
/**
 * Smoke test.
 *
 * Hits every read endpoint the frontend depends on and reports which ones
 * answer correctly. Run it after a deploy to confirm the API, the database and
 * the migration all line up, before opening the UI and guessing.
 *
 *   node server/scripts/smoke-test.js                       # localhost:3001
 *   node server/scripts/smoke-test.js https://api.example   # a deployment
 */

const BASE = (process.argv[2] ?? process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

const results = [];

async function check(name, path, { expect = 200, validate = null } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
    const ms = Date.now() - started;
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }

    if (res.status !== expect) {
      results.push({ name, path, ok: false, detail: `HTTP ${res.status}: ${body?.message ?? 'no body'}`, ms });
      return null;
    }

    if (validate) {
      const problem = validate(body);
      if (problem) {
        results.push({ name, path, ok: false, detail: problem, ms });
        return body;
      }
    }

    const shape = Array.isArray(body) ? `${body.length} row(s)` : typeof body === 'object' ? 'object' : String(body);
    results.push({ name, path, ok: true, detail: shape, ms });
    return body;
  } catch (err) {
    results.push({ name, path, ok: false, detail: err.message, ms: Date.now() - started });
    return null;
  }
}

const isArray = (b) => (Array.isArray(b) ? null : `expected an array, got ${typeof b}`);
const hasKeys = (...keys) => (b) => {
  if (!b || typeof b !== 'object') return `expected an object, got ${typeof b}`;
  const missing = keys.filter((k) => !(k in b));
  return missing.length ? `missing key(s): ${missing.join(', ')}` : null;
};

async function main() {
  console.log(`\nSmoke test against ${BASE}\n${'─'.repeat(64)}`);

  const health = await check('health', '/health', { validate: hasKeys('status', 'config') });

  if (!health || health.status !== 'ok') {
    console.log(`${RED}The API is not healthy. Everything below will fail for the same reason.${RESET}`);
  }

  const schema = await check('schema', '/health/schema', { validate: hasKeys('ok', 'tables') });

  await check('campaigns', '/campaigns', { validate: isArray });
  await check('global metrics', '/metrics/global', { validate: hasKeys('live_campaigns', 'total_prospects') });
  await check('channel metrics', '/metrics/channels', { validate: isArray });
  await check('prospects', '/prospects', { validate: isArray });
  await check('activity', '/activity', { validate: isArray });
  await check('escalations', '/escalations', { validate: isArray });
  await check('conflicts', '/conflicts', { validate: isArray });
  await check('attention', '/attention', { validate: hasKeys('items', 'summary') });
  await check('control', '/control', { validate: hasKeys('kill_switch', 'channel_pauses', 'agent_pauses') });
  await check('agents', '/agents', { validate: isArray });
  await check('agent routing', '/agents/routing', { validate: hasKeys('agent_routing') });
  await check('agent performance', '/agents/performance', { validate: isArray });
  await check('costs', '/costs', { validate: hasKeys('total_spend', 'total_runs') });
  await check('reps', '/reps', { validate: isArray });
  await check('suppression', '/suppression', { validate: isArray });
  await check('knowledge', '/knowledge', { validate: isArray });
  await check('404 handling', '/definitely-not-a-route', { expect: 404 });

  for (const r of results) {
    const mark = r.ok ? `${GREEN}pass${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`${mark}  ${r.name.padEnd(20)} ${DIM}${r.path.padEnd(28)} ${String(r.ms).padStart(5)}ms${RESET}  ${r.detail}`);
  }

  console.log('─'.repeat(64));

  const failed = results.filter((r) => !r.ok);

  if (schema && !schema.ok) {
    console.log(
      `${YELLOW}Missing tables: ${schema.missing_tables.join(', ')}\n` +
        `Run server/db/migrations/004-pigeon-sdr-fixes.sql in the Supabase SQL editor.${RESET}`
    );
  }

  if (health?.config?.agent_routing) {
    const local = Object.entries(health.config.agent_routing).filter(([, e]) => e === 'local_engine');
    if (local.length) {
      console.log(
        `${YELLOW}${local.length} agent(s) will run on the local engine: ${local.map(([a]) => a).join(', ')}.\n` +
          `Set their DRONAHQ_*_URL and key to route them to DronaHQ instead.${RESET}`
      );
    }
  }

  if (failed.length === 0) {
    console.log(`${GREEN}All ${results.length} checks passed.${RESET}\n`);
    process.exit(0);
  }

  console.log(`${RED}${failed.length} of ${results.length} checks failed.${RESET}\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`${RED}Smoke test crashed:${RESET}`, err);
  process.exit(1);
});
