import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Pause, Play, ArrowLeft, Copy, Users, Send, ThumbsUp, ThumbsDown, Calendar, DollarSign, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext';
import api from '../api/index.js';
import {
  StatusPill, CampaignDot, StatTile, FunnelBar,
  AgentRow, ActivityLine, LoadingState, ErrorState, PausedState, AssumptionNote,
} from '../components/index.jsx';
import './CampaignDashboard.css';

export default function CampaignDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isKilled, setCampaignStatus, loadCampaigns, systemControl, addToast } = useApp();

  const [campaign, setCampaign] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [activities, setActivities] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [camp, met, act, ag] = await Promise.all([
        api.getCampaign(id),
        api.getCampaignMetrics(id),
        api.getCampaignActivity(id),
        api.getAgentRuns(id),
      ]);
      setCampaign(camp);
      setMetrics(met);
      setActivities(act);
      setAgents(ag);
    } catch (err) {
      setError(err.message || 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <LoadingState message="Loading campaign…" />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;
  if (!campaign) return <ErrorState message="Campaign not found" />;

  const isPaused = campaign.status === 'paused';
  const isDraft = campaign.status === 'draft';
  const isLive = campaign.status === 'live';

  const handleToggle = async () => {
    if (isKilled) return;
    const newStatus = isLive ? 'paused' : 'live';
    await setCampaignStatus(id, newStatus);
    loadData();
  };

  const handleDuplicate = async () => {
    try {
      const copy = await api.duplicateCampaign(id);
      await loadCampaigns();
      addToast({
        type: 'success',
        title: 'Campaign duplicated',
        message: 'Configuration and active prompts were copied as a draft. Prospects were not, so the variant starts clean.',
      });
      navigate(`/campaigns/${copy.id}/edit`);
    } catch (err) {
      addToast({ type: 'error', title: 'Could not duplicate', message: err.message });
    }
  };

  /**
   * Advances a few prospects one step each. The worker is off by default so a
   * demo does not spend budget between takes; this is the control that drives
   * the pipeline from the UI.
   */
  const handleRun = async () => {
    setRunning(true);
    try {
      const result = await api.runCampaign(id, 3);
      addToast({
        type: result.advanced > 0 ? 'success' : 'info',
        title: `${result.advanced} prospect(s) advanced`,
        message:
          `${result.processed} processed` +
          (result.scheduled ? `, ${result.scheduled} waiting for a scheduled touch` : '') +
          (result.escalated ? `, ${result.escalated} escalated for review` : '') +
          (result.blocked ? `, ${result.blocked} blocked by the gate` : '') +
          (result.errors ? `, ${result.errors} errored` : '') + '.',
      });
      await loadData();
    } catch (err) {
      addToast({ type: 'error', title: 'Pipeline run failed', message: err.message });
    } finally {
      setRunning(false);
    }
  };

  /**
   * Per-campaign agent switch. Writes to campaigns.agents, which the gate reads
   * before invoking that agent — so switching it off here stops it for this
   * campaign only, and leaves every other campaign running.
   */
  const handleAgentToggle = async (nameOrKey, val) => {
    const agent = agents.find(a => a.key === nameOrKey || a.name === nameOrKey);
    if (!agent) return;
    try {
      await api.updateCampaign(id, { agents: { ...(campaign.agents ?? {}), [agent.key]: val } });
      await loadData();
    } catch (err) {
      addToast({ type: 'error', title: 'Could not update the agent', message: err.message });
    }
  };

  const activeChannels = campaign.channels
    ? Object.entries(campaign.channels).filter(([, v]) => v).map(([k]) => {
        const isChanPaused = systemControl?.channel_pauses?.[k];
        return isChanPaused ? `${k} (Paused)` : k;
      }).join(', ')
    : '—';

  // Compute health from agents array
  const totalFailures = agents.reduce((sum, a) => sum + (a.failures_today || 0), 0);
  const totalRuns = agents.reduce((sum, a) => sum + (a.runs_today || 0), 0);

  return (
    <div className={`page animate-in ${isPaused ? 'page--paused' : ''}`}>
      {/* Back link */}
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/campaigns')} style={{ marginBottom: 'var(--sp-3)' }}>
        <ArrowLeft size={14} /> All Campaigns
      </button>

      {/* Paused overlay. Pausing one campaign leaves the others running, which
          is the isolation guarantee the whole control plane rests on. */}
      {isPaused && (
        <PausedState message="This campaign is paused. Its agents are stopped and no outreach fires; every other campaign continues unaffected, and prospect state is kept so resuming picks up where it left off." />
      )}

      {/* Header Strip */}
      <div className="dash-header" style={{ borderLeft: `4px solid ${campaign.colour}`, opacity: isPaused ? 0.7 : 1 }}>
        <div className="dash-header-left">
          <div className="dash-header-title-row">
            <CampaignDot colour={campaign.colour} size={14} />
            <h1 className="dash-header-name">{campaign.name}</h1>
            <StatusPill status={campaign.status} />
          </div>
          <div className="dash-header-meta">
            <span>Owner: <strong>{campaign.owner}</strong></span>
            <span>Audience: <strong>{campaign.target_audience}</strong></span>
            <span>Channels: <strong style={{ textTransform: 'capitalize' }}>{activeChannels}</strong></span>
            {campaign.reps?.length > 0 && <span>Reps: <strong>{campaign.reps.length}</strong></span>}
          </div>
        </div>
        <div className="dash-header-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleDuplicate}>
            <Copy size={14} /> Duplicate as variant
          </button>
          {isLive && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleRun}
              disabled={running || isKilled}
              title="Advance up to 3 prospects one pipeline step each"
            >
              <Zap size={14} /> {running ? 'Running…' : 'Run pipeline'}
            </button>
          )}
          {!isDraft && (
            <button
              type="button"
              className={`btn ${isLive ? 'btn--danger-outline' : 'btn--success'} btn--lg`}
              onClick={handleToggle}
              disabled={isKilled}
            >
              {isLive ? <><Pause size={16} /> Pause Campaign</> : <><Play size={16} /> Resume Campaign</>}
            </button>
          )}
        </div>
      </div>

      {/* Funnel Bar */}
      {metrics?.funnel && (
        <div style={{ margin: 'var(--sp-5) 0' }}>
          <h3 className="section-heading">Pipeline Funnel</h3>
          <FunnelBar
            funnel={metrics.funnel}
            campaignColour={campaign.colour}
            onSegmentClick={(stage) => navigate(`/prospects?campaign=${id}&status=${stage}`)}
          />
        </div>
      )}

      {/* Stats Grid — no fake trends */}
      <div className="dash-stats-grid">
        <StatTile 
          label="Total Prospects" value={metrics?.total_prospects ?? 0} 
          icon={Users} color="var(--accent)"
          sub={`${metrics?.funnel?.qualified || 0} qualified`}
        />
        <StatTile 
          label="Messages Sent" value={metrics?.messages_sent ?? 0} 
          icon={Send} color="var(--brand-purple)"
          sub={`${metrics?.response_rate || 0}% response rate`}
        />
        <StatTile 
          label="Positive Replies" value={metrics?.positive_replies ?? 0} 
          icon={ThumbsUp} color="var(--success)"
        />
        <StatTile 
          label="Negative Replies" value={metrics?.negative_replies ?? 0} 
          icon={ThumbsDown} color="var(--danger)"
        />
        <StatTile 
          label="Meetings Booked" value={metrics?.meetings ?? 0} 
          icon={Calendar} color="var(--brand-orange)"
          sub={`${metrics?.meeting_rate || 0}% meeting rate`}
        />
        <StatTile
          label="Spend Today" value={`$${(metrics?.spend_today ?? 0).toFixed(4)}`}
          icon={DollarSign} color="var(--brand-blue)"
          sub={`${metrics?.agent_runs_today || 0} agent runs today`}
        />
      </div>

      {metrics?.agent_degraded_runs > 0 && (
        <AssumptionNote>
          {metrics.agent_degraded_runs} agent run(s) in this campaign fell back to the local engine because
          the DronaHQ call did not return usable output. Those runs are marked in the prospect timelines and
          on the Agents screen.
        </AssumptionNote>
      )}
      <div className="dash-two-col">
        {/* Activity Feed */}
        <div className="card dash-feed">
          <div className="card__header">
            <span className="card__title">Live Activity</span>
            <span className="text-muted font-mono" style={{ fontSize: 'var(--text-xs)' }}>
              {activities.length} events
            </span>
          </div>
          <div className="card__body dash-feed-body">
            {isPaused && activities.length > 0 && (
              <div style={{ padding: 'var(--sp-3)', textAlign: 'center', color: 'var(--warning)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                Campaign paused — showing last activity before pause
              </div>
            )}
            {activities.slice(0, 15).map((a) => (
              <ActivityLine key={a.id} activity={a} />
            ))}
            {activities.length === 0 && (
              <div style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
                No activity yet
              </div>
            )}
          </div>
        </div>

        {/* Right column: Agents + Health */}
        <div className="dash-right-col">
          {/* Agents Panel — all 7 agents */}
          <div className="card">
            <div className="card__header">
              <span className="card__title">Agents</span>
            </div>
            <div>
              {agents.map((a, i) => (
                <AgentRow
                  key={i}
                  agent={a}
                  onToggle={handleAgentToggle}
                  disabled={isKilled || isPaused}
                />
              ))}
            </div>
          </div>

          {/* Health — computed values */}
          <div className="card">
            <div className="card__header">
              <span className="card__title">Health</span>
            </div>
            <div className="card__body">
              <div className="health-grid">
                <div className="health-item">
                  <span className="health-label">Failed Runs</span>
                  <span className="health-value font-mono" style={{ color: totalFailures > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    {totalFailures}
                  </span>
                </div>
                <div className="health-item">
                  <span className="health-label">Pending Approvals</span>
                  <span className="health-value font-mono">{metrics?.pending_approvals ?? 0}</span>
                </div>
                <div className="health-item">
                  <span className="health-label">Escalations</span>
                  <span className="health-value font-mono" style={{ color: (metrics?.escalations || 0) > 0 ? 'var(--warning-text, #B28C00)' : 'var(--text-secondary)' }}>
                    {metrics?.escalations ?? 0}
                  </span>
                </div>
                <div className="health-item">
                  <span className="health-label">Agent Runs Today</span>
                  <span className="health-value font-mono">{totalRuns}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
