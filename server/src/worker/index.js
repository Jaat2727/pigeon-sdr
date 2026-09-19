/**
 * Background worker.
 *
 * Sweeps prospects in live campaigns whose `next_action_at` has come due and
 * advances each one. Three properties matter for a system that spends money
 * per call:
 *
 *   · It is off by default. Set WORKER_ENABLED=true to turn it on. During a
 *     demo you usually want to drive the pipeline from the UI instead.
 *   · Sweeps never overlap. A slow batch delays the next tick rather than
 *     running alongside it, so a prospect cannot be advanced twice at once.
 *   · It respects the global kill switch before touching anything, and every
 *     individual step re-checks the full gate.
 */
import { supabase, dbReady, unwrapSoft } from '../db/client.js';
import { env } from '../config.js';
import { advance } from '../orchestrator/index.js';
import { getSystemControl } from '../orchestrator/gate.js';

let timer = null;
let running = false;

export const workerStats = {
  enabled: false,
  sweeps: 0,
  advanced: 0,
  blocked: 0,
  errors: 0,
  last_sweep_at: null,
  last_error: null,
};

async function sweep() {
  if (running) return;
  running = true;

  try {
    const control = await getSystemControl();
    if (control.kill_switch) {
      workerStats.last_sweep_at = new Date().toISOString();
      return;
    }

    const liveRes = await supabase.from('campaigns').select('id').eq('status', 'live');
    const live = unwrapSoft(liveRes, [], 'campaigns');
    if (!live.length) {
      workerStats.last_sweep_at = new Date().toISOString();
      return;
    }

    const liveIds = live.map((c) => c.id);

    const dueRes = await supabase
      .from('campaign_prospects')
      .select('campaign_id, prospect_id, state, next_action_at')
      .in('campaign_id', liveIds)
      .not('next_action_at', 'is', null)
      .lte('next_action_at', new Date().toISOString())
      .order('next_action_at', { ascending: true })
      .limit(env.WORKER_BATCH_SIZE);

    const due = unwrapSoft(dueRes, [], 'campaign_prospects');

    for (const cp of due) {
      try {
        const result = await advance(cp.campaign_id, cp.prospect_id);
        if (result.status === 'advanced') workerStats.advanced += 1;
        else if (result.status === 'blocked') workerStats.blocked += 1;
        else if (result.status === 'error') workerStats.errors += 1;
      } catch (err) {
        workerStats.errors += 1;
        workerStats.last_error = err.message;
        console.error(`[worker] advance failed for ${cp.prospect_id}:`, err.message);
      }
    }

    workerStats.sweeps += 1;
    workerStats.last_sweep_at = new Date().toISOString();
  } catch (err) {
    workerStats.errors += 1;
    workerStats.last_error = err.message;
    console.error('[worker] sweep failed:', err.message);
  } finally {
    running = false;
  }
}

export function startWorker() {
  if (timer) return false;
  if (!dbReady) {
    console.warn('[worker] not started — no database credentials.');
    return false;
  }
  workerStats.enabled = true;
  console.log(`[worker] started, sweeping every ${env.WORKER_POLL_MS}ms`);
  timer = setInterval(sweep, env.WORKER_POLL_MS);
  sweep();
  return true;
}

export function stopWorker() {
  if (!timer) return false;
  clearInterval(timer);
  timer = null;
  workerStats.enabled = false;
  console.log('[worker] stopped');
  return true;
}

export function isWorkerRunning() {
  return Boolean(timer);
}

/** One sweep on demand, used by POST /control/worker/sweep. */
export async function sweepOnce() {
  await sweep();
  return { ...workerStats };
}
