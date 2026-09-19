#!/usr/bin/env node
/**
 * End-to-end integration test.
 *
 * Drives a running API through the behaviour the brief is judged on, against a
 * real database, and asserts each step:
 *
 *   · Three campaigns run concurrently with independent state.
 *   · A prospect moves discovered → researched → qualified → contacted.
 *   · Pausing one campaign stops that campaign and no other.
 *   · The global kill switch stops everything at once.
 *   · An agent pause stops one agent while the others keep running.
 *   · A reply is classified and an opt-out suppresses the prospect everywhere.
 *   · Escalations and conflicts can actually be resolved.
 *
 * It writes real rows, so run it against a demo database rather than one you
 * care about. Every campaign is returned to its starting status at the end.
 *
 *   node server/scripts/integration-test.js                      # localhost:3001
 *   node server/scripts/integration-test.js https://api.example  # a deployment
 */

const BASE = (process.argv[2] ?? process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`${GREEN}pass${RESET}  ${name}`);
  } else {
    failed += 1;
    console.log(`${RED}FAIL${RESET}  ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const err = new Error(json?.message ?? `HTTP ${res.status} on ${method} ${path}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const section = (title) => console.log(`\n${DIM}${title}${RESET}`);

async function main() {
  console.log(`\nIntegration test against ${BASE}\n${'─'.repeat(70)}`);

  /* ── setup ──────────────────────────────────────────────────────── */

  const health = await api('GET', '/health');
  if (health.status !== 'ok') {
    console.log(`${RED}The API is not healthy — nothing below can pass.${RESET}`);
    process.exit(1);
  }

  const control0 = await api('GET', '/control');
  if (control0.kill_switch) {
    console.log(`${DIM}Releasing the kill switch so the test can run.${RESET}`);
    await api('POST', '/control/kill', { enabled: false });
  }

  const campaigns = await api('GET', '/campaigns');
  const originalStatus = new Map(campaigns.map((c) => [c.id, c.status]));

  const restore = async () => {
    for (const [id, status] of originalStatus) {
      await api('POST', `/campaigns/${id}/status`, { status }).catch(() => {});
    }
    await api('POST', '/control/kill', { enabled: false }).catch(() => {});
    for (const agent of ['research', 'icp_fitment', 'outreach_strategy', 'personalisation', 'conversation']) {
      await api('POST', '/control/agent', { agent, paused: false }).catch(() => {});
    }
  };

  try {
    /* ── concurrency ──────────────────────────────────────────────── */

    section('Concurrent campaigns');

    assert('at least three campaigns exist', campaigns.length >= 3, `found ${campaigns.length}`);

    const icps = new Set(campaigns.map((c) => (c.icp_criteria ?? c.target_audience ?? '').slice(0, 40)));
    assert('each campaign targets a different ICP', icps.size >= 3, `${icps.size} distinct ICP(s)`);

    const channelMixes = new Set(campaigns.map((c) => (c.enabled_channels ?? []).join(',')));
    assert('campaigns use different channel mixes', channelMixes.size >= 2, [...channelMixes].join(' | '));

    const statuses = new Set(campaigns.map((c) => c.status));
    assert('campaigns hold independent lifecycle states', statuses.size >= 2, [...statuses].join(', '));

    // Prompt isolation
    const promptSets = await Promise.all(
      campaigns.slice(0, 3).map((c) => api('GET', `/campaigns/${c.id}/prompts`))
    );
    assert(
      'each campaign carries its own prompt versions',
      promptSets.every((p) => p.length > 0) &&
        new Set(promptSets.flat().map((p) => p.campaign_id)).size === promptSets.length,
      promptSets.map((p) => p.length).join(', ') + ' prompt(s) per campaign'
    );

    const icpPrompts = promptSets.map((set) => set.find((p) => p.agent_name === 'icp_fitment' && p.is_active)?.content);
    assert(
      'campaigns have genuinely different ICP prompts',
      new Set(icpPrompts.filter(Boolean)).size === icpPrompts.filter(Boolean).length,
      'two campaigns share the same active ICP prompt'
    );

    /* ── pipeline ─────────────────────────────────────────────────── */

    section('Pipeline execution');

    let live = campaigns.filter((c) => c.status === 'live');
    if (live.length === 0) {
      await api('POST', `/campaigns/${campaigns[0].id}/status`, { status: 'live' });
      live = [campaigns[0]];
    }
    const target = live[0];

    const before = await api('GET', `/campaigns/${target.id}/prospects`);
    assert('the target campaign has prospects', before.length > 0, `${before.length} prospect(s)`);

    // Advance one prospect as far as it will go.
    const subject = before.find((p) => p.funnel_status === 'discovered') ?? before[0];
    const steps = await api('POST', `/prospects/${subject.id}/advance`, {
      campaign_id: target.id,
      all: true,
    });

    const reached = steps.steps?.map((s) => s.state).filter(Boolean) ?? [];
    assert('the prospect advanced through the pipeline', reached.length > 0, `states: ${reached.join(' → ')}`);
    assert(
      'research ran and produced an enriched profile',
      reached.includes('researched') || reached.includes('qualified') || reached.includes('rejected') ||
        reached.includes('needs_review'),
      `states: ${reached.join(' → ')}`
    );

    const detail = await api('GET', `/prospects/${subject.id}?campaignId=${target.id}`);
    assert('the prospect has an agent timeline', (detail.timeline ?? []).length > 1, `${detail.timeline?.length ?? 0} event(s)`);
    assert(
      'every timeline entry names the engine that produced it',
      (detail.timeline ?? []).filter((e) => e.agent).every((e) => e.agent_engine),
      'an agent event had no engine recorded'
    );
    assert('the prospect has provenance-tagged facts', (detail.facts ?? []).length > 0, `${detail.facts?.length ?? 0} fact(s)`);
    assert(
      'facts carry a provenance tag',
      (detail.facts ?? []).every((f) => ['manual', 'crm', 'ai_enriched'].includes(f.tag)),
      'a fact had no valid provenance tag'
    );

    const verdicts = ['qualify', 'reject', 'needs_review'];
    assert(
      'the ICP verdict is one of the three states',
      detail.icp_verdict === null || verdicts.includes(detail.icp_verdict?.status),
      `got ${JSON.stringify(detail.icp_verdict?.status)}`
    );

    const runAll = await api('POST', `/campaigns/${target.id}/run`, { limit: 5 });
    assert('a campaign-wide run processes prospects', runAll.processed > 0, `${runAll.processed} processed`);

    /* ── isolation ────────────────────────────────────────────────── */

    section('Campaign isolation');

    const others = campaigns.filter((c) => c.id !== target.id);
    const other = others.find((c) => c.status === 'live') ?? others[0];
    await api('POST', `/campaigns/${other.id}/status`, { status: 'live' });

    await api('POST', `/campaigns/${target.id}/status`, { status: 'paused' });

    let blocked = null;
    try {
      blocked = await api('POST', `/campaigns/${target.id}/run`, { limit: 2 });
    } catch (err) {
      blocked = { refused: true, message: err.message };
    }
    assert(
      'a paused campaign refuses to run',
      blocked?.refused === true || blocked?.advanced === 0,
      JSON.stringify(blocked).slice(0, 120)
    );

    const otherRun = await api('POST', `/campaigns/${other.id}/run`, { limit: 2 });
    assert(
      'pausing one campaign does not stop another',
      otherRun.processed >= 0 && otherRun.blocked === 0,
      `${otherRun.processed} processed, ${otherRun.blocked} blocked`
    );

    const pausedProspects = await api('GET', `/campaigns/${target.id}/prospects`);
    assert(
      'a paused campaign keeps its prospect state',
      pausedProspects.length === before.length,
      `${pausedProspects.length} vs ${before.length} before`
    );

    await api('POST', `/campaigns/${target.id}/status`, { status: 'live' });
    const resumed = await api('GET', `/campaigns/${target.id}`);
    assert('a campaign resumes cleanly', resumed.status === 'live', `status is ${resumed.status}`);

    /* ── stop controls ────────────────────────────────────────────── */

    section('The four levels of stopping');

    await api('POST', '/control/agent', { agent: 'research', paused: true });
    const afterAgentPause = await api('GET', '/control');
    assert('an agent can be paused globally', afterAgentPause.agent_pauses?.research === true);

    const agentsList = await api('GET', '/agents');
    const research = agentsList.find((a) => a.key === 'research');
    assert('the paused agent reports as paused', research?.paused === true && research?.status === 'paused');
    assert(
      'other agents are unaffected by one agent pause',
      agentsList.filter((a) => a.key !== 'research').every((a) => !a.paused)
    );
    await api('POST', '/control/agent', { agent: 'research', paused: false });

    await api('POST', '/control/channel', { channel: 'email', paused: true });
    const afterChannelPause = await api('GET', '/control');
    assert('a channel can be paused globally', afterChannelPause.channel_pauses?.email === true);
    assert(
      'other channels are unaffected by one channel pause',
      afterChannelPause.channel_pauses?.linkedin === false
    );
    await api('POST', '/control/channel', { channel: 'email', paused: false });

    await api('POST', '/control/kill', { enabled: true });
    const killed = await api('GET', '/control');
    assert('the global kill switch engages', killed.kill_switch === true);

    let liveWhileKilled = null;
    try {
      liveWhileKilled = await api('POST', `/campaigns/${other.id}/status`, { status: 'live' });
    } catch (err) {
      liveWhileKilled = { refused: true, message: err.message };
    }
    assert(
      'a campaign cannot be brought live while the kill switch is engaged',
      liveWhileKilled?.refused === true,
      JSON.stringify(liveWhileKilled).slice(0, 120)
    );

    const killedRun = await api('POST', `/campaigns/${target.id}/run`, { limit: 2 }).catch((e) => ({
      refused: true, message: e.message,
    }));
    assert(
      'no prospect advances while the kill switch is engaged',
      killedRun?.refused === true || killedRun.advanced === 0,
      JSON.stringify(killedRun).slice(0, 140)
    );

    await api('POST', '/control/kill', { enabled: false });
    assert('the kill switch releases', (await api('GET', '/control')).kill_switch === false);

    /* ── conversation ─────────────────────────────────────────────── */

    section('Replies and suppression');

    await api('POST', `/campaigns/${target.id}/status`, { status: 'live' });
    const contacted = (await api('GET', `/campaigns/${target.id}/prospects`)).find((p) =>
      ['contacted', 'engaged'].includes(p.funnel_status)
    );

    if (contacted) {
      const replied = await api('POST', `/prospects/${contacted.id}/reply`, {
        campaign_id: target.id,
        channel: 'email',
        body: 'This looks interesting, can we schedule a call next week?',
      });
      assert(
        'a positive reply advances the prospect',
        ['meeting', 'engaged', 'opportunity'].includes(replied.state),
        `state is ${replied.state}`
      );

      const suppressionBefore = (await api('GET', '/suppression')).length;
      const optOut = (await api('GET', `/campaigns/${target.id}/prospects`)).find(
        (p) => p.id !== contacted.id && ['contacted', 'engaged'].includes(p.funnel_status)
      );

      if (optOut) {
        const out = await api('POST', `/prospects/${optOut.id}/reply`, {
          campaign_id: target.id,
          channel: 'email',
          body: 'Please unsubscribe me and do not contact me again.',
        });
        assert('an opt-out suppresses the prospect', out.state === 'suppressed', `state is ${out.state}`);
        const suppressionAfter = (await api('GET', '/suppression')).length;
        assert(
          'the opt-out is written to the suppression list',
          suppressionAfter > suppressionBefore,
          `${suppressionBefore} → ${suppressionAfter}`
        );
      } else {
        console.log(`${DIM}skip  no second contacted prospect for the opt-out check${RESET}`);
      }
    } else {
      console.log(`${DIM}skip  no contacted prospect yet — run the pipeline further first${RESET}`);
    }

    /* ── human in the loop ────────────────────────────────────────── */

    section('Escalations and conflicts');

    const escalations = await api('GET', '/escalations');
    const attention = await api('GET', '/attention');
    assert('the attention feed has the right shape', Array.isArray(attention.items) && attention.summary);
    assert(
      'the attention feed reflects the escalation count',
      attention.summary.approvals === escalations.length,
      `${attention.summary.approvals} vs ${escalations.length}`
    );

    if (escalations.length) {
      const esc = escalations[0];
      assert('an escalation names its source agent', Boolean(esc.source_agent));
      assert('an escalation carries a proposed action', Boolean(esc.proposed_action));
      assert('an escalation carries a risk level', ['high', 'medium', 'low'].includes(esc.risk_level));

      const resolved = await api('POST', `/escalations/${esc.id}/resolve`, {
        action: 'approved',
        resolved_by: 'integration-test',
      });
      assert('an escalation can be approved', resolved.escalation.status === 'approved');

      const remaining = await api('GET', '/escalations');
      assert(
        'a resolved escalation leaves the queue',
        !remaining.some((e) => e.id === esc.id),
        'the escalation is still pending'
      );

      const doubleResolve = await api('POST', `/escalations/${esc.id}/resolve`, { action: 'rejected' })
        .then(() => null)
        .catch((e) => e);
      assert('an escalation cannot be resolved twice', doubleResolve !== null, 'the second resolve succeeded');
    } else {
      console.log(`${DIM}skip  no escalations raised yet${RESET}`);
    }

    const conflicts = await api('GET', '/conflicts');
    if (conflicts.length) {
      const c = conflicts[0];
      assert('a conflict names the campaigns involved', (c.campaign_ids ?? []).length >= 2);
      const resolvedConflict = await api('POST', `/conflicts/${c.id}/resolve`, {
        campaign_id: c.campaign_ids[0],
        resolved_by: 'integration-test',
      });
      assert('a conflict can be resolved in favour of one campaign', resolvedConflict.mode === 'keep_one');
      assert('the losing campaigns are recorded', resolvedConflict.losers.length >= 1);
    } else {
      console.log(`${DIM}skip  no conflicts detected yet${RESET}`);
    }

    /* ── measurement ──────────────────────────────────────────────── */

    section('Measurement');

    const metrics = await api('GET', `/campaigns/${target.id}/metrics`);
    assert('funnel counts are present', Boolean(metrics.funnel?.discovered !== undefined));
    assert(
      'the funnel is monotonically non-increasing',
      ['discovered', 'researched', 'qualified', 'contacted', 'engaged', 'meeting', 'opportunity']
        .map((s) => metrics.funnel[s])
        .every((v, i, arr) => i === 0 || v <= arr[i - 1]),
      JSON.stringify(metrics.funnel)
    );
    assert('pipeline value declares its assumptions', Boolean(metrics.pipeline_assumptions?.note));

    const costs = await api('GET', '/costs');
    assert('agent runs are being costed', costs.total_runs > 0, `${costs.total_runs} run(s)`);

    const perf = await api('GET', '/agents/performance');
    assert('agent performance is reported per agent', perf.length >= 5, `${perf.length} agent(s)`);

    const activity = await api('GET', '/activity');
    assert('activity was logged', activity.length > 0, `${activity.length} event(s)`);
    assert(
      'activity events carry agent, outcome and timestamp',
      activity.every((a) => a.agent && a.outcome && a.timestamp)
    );
  } finally {
    section('Restoring campaign statuses');
    await restore();
    console.log(`${DIM}done${RESET}`);
  }

  console.log(`\n${'─'.repeat(70)}`);
  if (failed === 0) {
    console.log(`${GREEN}All ${passed} assertions passed.${RESET}\n`);
    process.exit(0);
  }
  console.log(`${RED}${failed} failed${RESET}, ${passed} passed.\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`\n${RED}Integration test crashed:${RESET} ${err.message}`);
  if (err.body) console.error(err.body);
  process.exit(1);
});
