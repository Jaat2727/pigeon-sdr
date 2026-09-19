import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Zap, RefreshCw } from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import {
  AgentCard, Drawer, LoadingState, ErrorState, Toggle, EngineBadge,
} from '../components/index.jsx';
import './Agents.css';

export default function Agents() {
  const navigate = useNavigate();
  const { isKilled, setAgentPause, addToast } = useApp();

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [toggling, setToggling] = useState(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getGlobalAgents();
      setAgents(data);
    } catch (err) {
      setError(err.message || 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleToggle = useCallback(async (agentKey, shouldPause) => {
    setToggling(agentKey);
    try {
      await setAgentPause(agentKey, shouldPause);
      setAgents(prev => prev.map(a =>
        (a.key === agentKey || a.name === agentKey)
          ? { ...a, paused: shouldPause, status: shouldPause ? 'paused' : 'idle' }
          : a
      ));
      addToast({
        type: 'success',
        title: `Agent ${shouldPause ? 'paused' : 'resumed'}`,
        message: `${agentKey} has been ${shouldPause ? 'paused' : 'resumed'}.`,
      });
    } catch {
      addToast({ type: 'error', title: 'Failed to update agent' });
    } finally {
      setToggling(null);
    }
  }, [setAgentPause, addToast]);

  const runningCount = agents.filter(a => !a.paused && a.status === 'running').length;
  const pausedCount = agents.filter(a => a.paused).length;
  const idleCount = agents.filter(a => !a.paused && a.status === 'idle').length;

  // Averaging over agents that have not run yet drags the figure towards zero
  // and says nothing useful, so only agents with runs are counted.
  const withRuns = agents.filter(a => (a.runs_today ?? 0) > 0);
  const avgSuccess = withRuns.length
    ? Math.round(withRuns.reduce((s, a) => s + (a.success_rate ?? 0), 0) / withRuns.length)
    : null;

  const callable = agents.filter(a => a.callable !== false);
  const dronaHqCapable = callable.filter(a => a.configured_engine === 'dronahq').length;
  const onDronaHq = callable.filter(a => a.dronahq_configured).length;
  const degradedTotal = agents.reduce((s, a) => s + (a.degraded_runs ?? 0), 0);

  if (loading) return <LoadingState message="Loading agent status..." />;
  if (error) return <ErrorState message={error} onRetry={loadAgents} />;

  return (
    <div className="page animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-subtitle">
            {runningCount} running · {idleCount} idle · {pausedCount} paused
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--secondary btn--sm" onClick={loadAgents}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/integrations')}>
            View infrastructure <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Engine routing, read from the API. Saying "DronaHQ connected" while
          every agent is falling back would hide the one thing this screen is
          for. */}
      <div
        className="agents-infra-banner"
        style={onDronaHq === dronaHqCapable ? undefined : {
          background: 'var(--warning-soft)',
          borderColor: 'var(--warning-light)',
        }}
      >
        <div
          className="agents-infra-dot"
          style={{ background: onDronaHq === dronaHqCapable ? 'var(--success)' : 'var(--warning)' }}
        />
        <span className="agents-infra-label">Agent engine</span>
        <span className="agents-infra-sep">·</span>
        <span className="agents-infra-engine">
          {dronaHqCapable === 0
            ? 'No agents are configured for DronaHQ'
            : onDronaHq === dronaHqCapable
              ? `All ${dronaHqCapable} language agents are wired to DronaHQ`
              : `${onDronaHq} of ${dronaHqCapable} language agents are wired to DronaHQ; the rest run on the local engine`}
        </span>
        <button
          className="btn btn--ghost btn--sm"
          style={{ marginLeft: 'auto', fontSize: 11 }}
          onClick={() => navigate('/integrations')}
        >
          Details <ChevronRight size={11} />
        </button>
      </div>

      {degradedTotal > 0 && (
        <div className="alert-banner" style={{
          background: 'var(--warning-soft)', borderColor: 'var(--warning-light)',
          color: 'var(--warning)', marginBottom: 16,
        }}>
          {degradedTotal} agent run(s) fell back to the local engine because the DronaHQ call did not
          return usable output. Open an agent and send a test call to see exactly what its webhook returned.
        </div>
      )}

      {isKilled && (
        <div className="alert-banner" style={{
          background: 'var(--danger-soft)', borderColor: 'var(--danger-light)', color: 'var(--danger)',
          marginBottom: 16,
        }}>
          ⛔ Global kill switch is active — all agents are halted.
        </div>
      )}

      {/* Stats strip */}
      <div className="agents-stat-strip">
        <div className="agents-stat">
          <div className="agents-stat__value agents-stat__value--running">{runningCount}</div>
          <div className="agents-stat__label">Running</div>
        </div>
        <div className="agents-stat">
          <div className="agents-stat__value agents-stat__value--idle">{idleCount}</div>
          <div className="agents-stat__label">Idle</div>
        </div>
        <div className="agents-stat">
          <div className="agents-stat__value agents-stat__value--paused">{pausedCount}</div>
          <div className="agents-stat__label">Paused</div>
        </div>
        <div className="agents-stat">
          <div className="agents-stat__value">{avgSuccess === null ? '—' : `${avgSuccess}%`}</div>
          <div className="agents-stat__label">
            {avgSuccess === null ? 'No runs today' : `Avg success · ${withRuns.length} active`}
          </div>
        </div>
        <div className="agents-stat">
          <div className="agents-stat__value">
            {agents.reduce((sum, a) => sum + (a.runs_today || 0), 0).toLocaleString()}
          </div>
          <div className="agents-stat__label">Total Runs Today</div>
        </div>
      </div>

      {/* Agent Grid */}
      <div className="agents-grid">
        {agents.map(agent => (
          <div key={agent.id} className="agent-grid-cell">
            <AgentCard
              agent={agent}
              disabled={isKilled || toggling === agent.key}
              onToggle={(key, shouldPause) => handleToggle(key, shouldPause)}
            />
            <button
              className="agent-grid-details"
              onClick={() => setSelectedAgent(agent)}
            >
              View details <ChevronRight size={11} />
            </button>
          </div>
        ))}
      </div>

      {/* Agent Detail Drawer */}
      {selectedAgent && (
        <Drawer
          open={!!selectedAgent}
          onClose={() => setSelectedAgent(null)}
          title={selectedAgent.name}
          width={520}
        >
          <AgentDrawer agent={selectedAgent} onToggle={handleToggle} isKilled={isKilled} />
        </Drawer>
      )}
    </div>
  );
}

/**
 * Connectivity test.
 *
 * The most common failure in this stack is a DronaHQ webhook that answers with
 * a background-run acknowledgement instead of output, which reads downstream as
 * "the agent returns nulls". This fires one real call and shows exactly what
 * came back, so that is diagnosable from the deployed app.
 */
function AgentTest({ agent }) {
  const [state, setState] = useState({ status: 'idle', result: null });

  const run = async () => {
    setState({ status: 'running', result: null });
    try {
      setState({ status: 'done', result: await api.testAgent(agent.key) });
    } catch (err) {
      setState({ status: 'done', result: { problem: err.message, reachable: false } });
    }
  };

  const r = state.result;
  const ok = r?.valid === true;

  return (
    <div className="agent-drawer__section">
      <div className="agent-drawer__label">Connectivity test</div>
      <button
        className="btn btn--secondary btn--sm"
        onClick={run}
        disabled={state.status === 'running'}
        style={{ marginBottom: 10 }}
      >
        {state.status === 'running' ? 'Calling agent…' : 'Send a test call'}
      </button>

      {r && (
        <div
          style={{
            border: `1px solid ${ok ? 'var(--success-light, #A7F3D0)' : 'var(--danger-light, #FECACA)'}`,
            background: ok ? 'var(--success-soft, #ECFDF5)' : 'var(--danger-soft, #FEF2F2)',
            borderRadius: 8, padding: 12, fontSize: 12, lineHeight: 1.55,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: ok ? 'var(--success)' : 'var(--danger)' }}>
            {ok
              ? `Responded with valid output in ${r.latency_ms}ms`
              : r.configured === false
                ? 'Not configured — this agent runs on the local engine'
                : 'The call did not produce usable output'}
          </div>
          {r.problem && (
            <div style={{ marginBottom: 6, color: 'var(--text-secondary)' }}>{r.problem}</div>
          )}
          {r.guidance && (
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.guidance}</div>
          )}
          {r.unwrapped_output && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--accent)' }}>
                What the webhook actually returned
              </summary>
              <pre
                style={{
                  marginTop: 6, maxHeight: 220, overflow: 'auto', fontSize: 11,
                  background: 'var(--canvas, #fff)', padding: 8, borderRadius: 6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}
              >
                {JSON.stringify(r.unwrapped_output, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function AgentDrawer({ agent, onToggle, isKilled }) {
  const statusColor = agent.paused ? 'var(--warning)' :
    (agent.status === 'running' ? 'var(--success)' :
     agent.status === 'error' ? 'var(--danger)' : 'var(--text-muted)');

  return (
    <div className="agent-drawer">
      {/* Header */}
      <div className="agent-drawer__header">
        <div className="agent-drawer__status" style={{ background: statusColor }} />
        <div className="agent-drawer__name-wrap">
          <div className="agent-drawer__status-label" style={{ color: statusColor }}>
            {agent.paused ? 'Paused' : agent.status}
          </div>
          <EngineBadge engine={agent.engine} />
        </div>
        <Toggle
          on={!agent.paused}
          onChange={(val) => onToggle(agent.key, !val)}
          disabled={isKilled}
          ariaLabel={`Toggle ${agent.name}`}
        />
      </div>

      {/* Description */}
      <div className="agent-drawer__section">
        <div className="agent-drawer__label">What it does</div>
        <div className="agent-drawer__value">{agent.description}</div>
      </div>

      {/* Engine routing — configured versus what is actually serving it */}
      <div className="agent-drawer__section">
        <div className="agent-drawer__label">Engine</div>
        <div className="agent-drawer__value">
          {agent.configured_engine === 'our_engine' ? (
            <>Runs in our own engine by design. This step is deterministic scheduling, not language work.</>
          ) : agent.dronahq_configured ? (
            <>
              Configured for DronaHQ.{' '}
              {agent.engine === 'local_engine'
                ? 'Recent runs fell back to the local engine — use the test below to see what the webhook returned.'
                : 'Recent runs were served by DronaHQ.'}
            </>
          ) : (
            <>
              No DronaHQ URL or key is set for this agent, so it is running on the local engine.
              Runs are labelled accordingly and the pipeline keeps moving.
            </>
          )}
        </div>
      </div>

      {/* Current task */}
      <div className="agent-drawer__section">
        <div className="agent-drawer__label">Current task</div>
        <div className="agent-drawer__value">{agent.current_task || 'Idle'}</div>
      </div>

      {agent.configured_engine === 'dronahq' && <AgentTest agent={agent} />}

      {/* Stats */}
      <div className="agent-drawer__section">
        <div className="agent-drawer__label">Performance Today</div>
        <div className="agent-drawer__stats-grid">
          <div className="agent-drawer__stat">
            <span className="agent-drawer__stat-val">{agent.runs_today?.toLocaleString()}</span>
            <span className="agent-drawer__stat-key">Runs</span>
          </div>
          <div className="agent-drawer__stat">
            <span className="agent-drawer__stat-val" style={{ color: 'var(--success)' }}>
              {agent.success_rate}%
            </span>
            <span className="agent-drawer__stat-key">Success</span>
          </div>
          <div className="agent-drawer__stat">
            <span className="agent-drawer__stat-val" style={{ color: agent.failures_today > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
              {agent.failures_today}
            </span>
            <span className="agent-drawer__stat-key">Failures</span>
          </div>
        </div>
      </div>

      {/* Last action */}
      {agent.last_action && (
        <div className="agent-drawer__section">
          <div className="agent-drawer__label">Last Action</div>
          <div className="agent-drawer__value">{agent.last_action}</div>
          {agent.last_action_at && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              {new Date(agent.last_action_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
        </div>
      )}

      {/* Note */}
      <div style={{ marginTop: 8, padding: '12px 16px', background: 'var(--surface-raised)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <Zap size={11} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent)' }} />
        Pausing this agent stops it globally across all campaigns. Campaign-level agent controls are available in each campaign's Agents tab.
      </div>
    </div>
  );
}
