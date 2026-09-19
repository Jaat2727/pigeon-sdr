/**
 * Health and configuration report.
 *
 * `/health` answers in one request the three questions that account for almost
 * every "it's deployed but nothing works" moment: is the process up, can it
 * reach the database, and which engine will each agent actually use. It is
 * deliberately readable by a person, not only by a load balancer.
 */
import express from 'express';
import { supabase, dbReady } from '../db/client.js';
import { asyncHandler } from '../lib/http.js';
import { configReport } from '../config.js';
import { isWorkerRunning, workerStats } from '../worker/index.js';

const router = express.Router();

const REQUIRED_TABLES = [
  'campaigns', 'prospects', 'campaign_prospects', 'prompt_versions',
  'agent_runs', 'activities', 'messages', 'escalations', 'conflicts',
  'suppression_list', 'reps', 'campaign_reps', 'system_control', 'knowledge_chunks',
];

const startedAt = Date.now();

router.get('/', asyncHandler(async (req, res) => {
  const report = configReport();

  if (!dbReady) {
    return res.status(503).json({
      status: 'degraded',
      database: 'not_configured',
      message:
        'The API is running but has no database credentials. Set SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in the deployment environment.',
      config: report,
    });
  }

  const { error } = await supabase.from('campaigns').select('id').limit(1);

  if (error) {
    return res.status(503).json({
      status: 'degraded',
      database: 'unreachable',
      message: error.message,
      hint:
        error.code === '42P01'
          ? 'The campaigns table does not exist. Run server/db/migrations/004-pigeon-sdr-fixes.sql in the Supabase SQL editor.'
          : 'Check that SUPABASE_URL points at the right project and the service role key is current.',
      config: report,
    });
  }

  res.json({
    status: 'ok',
    database: 'connected',
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    worker: { running: isWorkerRunning(), ...workerStats },
    config: report,
    version: process.env.npm_package_version ?? '1.0.0',
  });
}));

/**
 * GET /health/schema
 * Reports which expected tables are actually present, which is the fastest way
 * to tell a missing migration apart from a wrong connection string.
 */
router.get('/schema', asyncHandler(async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'database_not_configured' });

  const results = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      const { error, count } = await supabase.from(table).select('*', { count: 'exact', head: true });
      return {
        table,
        present: !error || error.code !== '42P01',
        rows: error ? null : (count ?? 0),
        error: error?.code === '42P01' ? 'table_missing' : (error?.message ?? null),
      };
    })
  );

  const missing = results.filter((r) => !r.present).map((r) => r.table);

  res.json({
    ok: missing.length === 0,
    missing_tables: missing,
    hint: missing.length
      ? 'Run server/db/migrations/004-pigeon-sdr-fixes.sql in the Supabase SQL editor, then reload this endpoint.'
      : null,
    tables: results,
  });
}));

export default router;
