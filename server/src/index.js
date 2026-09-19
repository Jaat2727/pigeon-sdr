/**
 * Pigeon SDR API server.
 *
 * Boot order: configuration report, middleware, routes, error handling, listen.
 * Nothing here throws on a missing environment variable — the server starts,
 * reports what is missing on /health, and answers data routes with a 503 until
 * it is fixed. A crash loop on Railway tells you nothing; a running server that
 * explains itself tells you everything.
 */
import express from 'express';
import cors from 'cors';
import { env, configReport } from './config.js';
import { requireDb } from './db/client.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { startWorker, stopWorker } from './worker/index.js';

import healthRoutes from './routes/health.js';
import controlRoutes from './routes/control.js';
import campaignsRoutes from './routes/campaigns.js';
import prospectsRoutes from './routes/prospects.js';
import promptsRoutes from './routes/prompts.js';
import escalationsRoutes from './routes/escalations.js';
import conflictsRoutes from './routes/conflicts.js';
import attentionRoutes from './routes/attention.js';
import costsRoutes from './routes/costs.js';
import metricsRoutes from './routes/metrics.js';
import activityRoutes from './routes/activity.js';
import agentsRoutes from './routes/agents.js';
import repsRoutes from './routes/reps.js';
import suppressionRoutes from './routes/suppression.js';
import knowledgeRoutes from './routes/knowledge.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

/**
 * CORS. Origins come from CORS_ORIGINS so a new Vercel preview URL is an
 * environment change rather than a code change. Requests with no Origin header
 * (curl, health checks, server-to-server) are allowed through.
 */
const allowed = new Set(env.CORS_ORIGINS);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);

      // Any preview deployment of the same Vercel project.
      const isVercelPreview =
        /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) &&
        [...allowed].some((o) => o.endsWith('.vercel.app'));
      if (isVercelPreview) return callback(null, true);

      return callback(new Error(`Origin ${origin} is not in CORS_ORIGINS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

app.use(express.json({ limit: '2mb' }));

// One line per request, so Railway logs are useful without a logging service.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

/* ── routes ─────────────────────────────────────────────────────────── */

app.get('/', (req, res) => {
  res.json({
    name: 'Pigeon SDR API',
    status: 'running',
    docs: '/health for configuration, /health/schema for database state',
    endpoints: [
      'GET  /campaigns', 'GET  /campaigns/:id', 'POST /campaigns/:id/status',
      'POST /campaigns/:id/run', 'GET  /campaigns/:id/metrics',
      'GET  /prospects', 'GET  /prospects/:id', 'POST /prospects/:id/advance',
      'GET  /escalations', 'POST /escalations/:id/resolve',
      'GET  /conflicts', 'POST /conflicts/:id/resolve',
      'GET  /attention', 'GET  /agents', 'POST /agents/:id/test',
      'GET  /control', 'POST /control/kill', 'POST /control/channel', 'POST /control/agent',
      'GET  /metrics/global', 'GET  /costs', 'GET  /activity', 'GET  /knowledge',
    ],
  });
});

app.use('/health', healthRoutes);

// Everything below this line needs the database.
app.use(requireDb);

app.use('/control', controlRoutes);
app.use('/campaigns', campaignsRoutes);
app.use('/prospects', prospectsRoutes);
app.use('/prompts', promptsRoutes);
app.use('/escalations', escalationsRoutes);
app.use('/conflicts', conflictsRoutes);
app.use('/attention', attentionRoutes);
app.use('/costs', costsRoutes);
app.use('/metrics', metricsRoutes);
app.use('/activity', activityRoutes);
app.use('/agents', agentsRoutes);
app.use('/reps', repsRoutes);
app.use('/suppression', suppressionRoutes);
app.use('/knowledge', knowledgeRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

/* ── boot ───────────────────────────────────────────────────────────── */

const report = configReport();
console.log('─'.repeat(64));
console.log('Pigeon SDR API');
console.log(`  environment      ${report.node_env}`);
console.log(`  database         ${report.database_configured ? 'configured' : 'NOT CONFIGURED'}`);
if (report.missing_required.length) {
  console.log(`  missing env      ${report.missing_required.join(', ')}`);
}
console.log(`  cors origins     ${report.cors_origins.join(', ')}`);
console.log('  agent routing');
for (const [agent, engine] of Object.entries(report.agent_routing)) {
  console.log(`    ${agent.padEnd(20)} ${engine}`);
}
console.log('─'.repeat(64));

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`Listening on http://${env.HOST}:${env.PORT}`);
  if (env.WORKER_ENABLED) startWorker();
  else console.log('Worker is off. Set WORKER_ENABLED=true, or drive the pipeline from the UI.');
});

// Railway sends SIGTERM on redeploy; finish in-flight requests before exiting.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    stopWorker();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

export default app;
