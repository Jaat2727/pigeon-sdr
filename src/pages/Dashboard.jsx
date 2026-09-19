import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Megaphone, Users, Calendar, TrendingUp, Zap,
  Play, Pause, ArrowRight, ChevronRight, RefreshCw,
} from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import {
  KPICard, NeedsAttentionItem, PipelineStage,
  ActivityEvent, StatusPill, CampaignDot, ProgressBar,
  Drawer, AlertBanner, AssumptionNote,
} from '../components/index.jsx';
import './Dashboard.css';

const STAGES = ['discovered', 'researched', 'qualified', 'contacted', 'engaged', 'meeting', 'opportunity'];

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    campaigns, campaignsLoading, globalMetrics, loadGlobalMetrics,
    needsAttention, setCampaignStatus, addToast, isConnected,
    escalationsCount, conflictsCount, loadCampaigns, refreshAll,
  } = useApp();

  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [funnelData, setFunnelData] = useState({});
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [pausingId, setPausingId] = useState(null);
  const [runningId, setRunningId] = useState(null);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const data = await api.getAllActivity(20);
      setActivity(data.slice(0, 12));
    } catch {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isConnected) loadActivity();
    else setActivityLoading(false);
  }, [isConnected, loadActivity]);

  // Combined funnel across every campaign.
  useEffect(() => {
    let mounted = true;
    async function loadFunnels() {
      const combined = Object.fromEntries(STAGES.map((s) => [s, 0]));
      try {
        const metrics = await Promise.all(campaigns.map((c) => api.getCampaignMetrics(c.id)));
        metrics.forEach((m) => {
          STAGES.forEach((s) => { combined[s] += m.funnel?.[s] ?? 0; });
        });
        if (mounted) setFunnelData(combined);
      } catch {
        if (mounted) setFunnelData(combined);
      } finally {
        if (mounted) setFunnelLoading(false);
      }
    }
    if (campaigns.length) loadFunnels();
    else if (!campaignsLoading) setFunnelLoading(false);
    return () => { mounted = false; };
  }, [campaigns, campaignsLoading]);

  /**
   * Advances a few prospects one step each. The background worker is off by
   * default so a demo does not burn budget between takes, which makes this the
   * control that actually drives the pipeline.
   */
  const handleRun = useCallback(async (id) => {
    setRunningId(id);
    try {
      const result = await api.runCampaign(id, 3);
      addToast({
        type: result.advanced > 0 ? 'success' : 'info',
        title: `Pipeline run: ${result.advanced} advanced`,
        message:
          `${result.processed} prospect(s) processed` +
          (result.scheduled ? `, ${result.scheduled} waiting for their next scheduled touch` : '') +
          (result.escalated ? `, ${result.escalated} escalated for review` : '') +
          (result.blocked ? `, ${result.blocked} blocked by the gate` : '') +
          (result.errors ? `, ${result.errors} errored` : '') + '.',
      });
      await Promise.all([loadActivity(), loadCampaigns(), loadGlobalMetrics()]);
    } catch (err) {
      addToast({ type: 'error', title: 'Could not run the pipeline', message: err.message });
    } finally {
      setRunningId(null);
    }
  }, [addToast, loadActivity, loadCampaigns, loadGlobalMetrics]);

  const handleToggleCampaign = useCallback(async (id, currentStatus) => {
    setPausingId(id);
    const newStatus = currentStatus === 'live' ? 'paused' : 'live';
    try {
      await setCampaignStatus(id, newStatus);
      await loadGlobalMetrics();
      addToast({
        type: 'success',
        title: `Campaign ${newStatus === 'live' ? 'resumed' : 'paused'}`,
        message: `Campaign status updated to ${newStatus}.`,
      });
    } catch {
      addToast({ type: 'error', title: 'Failed to update status' });
    } finally {
      setPausingId(null);
    }
  }, [setCampaignStatus, loadGlobalMetrics, addToast]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const funnelTotal = funnelData.discovered || 1;

  const stageDefs = [
    { key: 'discovered',  label: 'Discovered' },
    { key: 'researched',  label: 'Researched' },
    { key: 'qualified',   label: 'Qualified' },
    { key: 'contacted',   label: 'Contacted' },
    { key: 'engaged',     label: 'Engaged' },
    { key: 'meeting',     label: 'Meeting' },
    { key: 'opportunity', label: 'Opp' },
  ];

  const funnelColors = ['#4F46E5', '#6366F1', '#818CF8', '#60A5FA', '#34D399', '#FBBF24', '#F59E0B'];
  const attentionTotal = escalationsCount + conflictsCount;

  return (
    <div className="page animate-in">
      {/* ── Header ── */}
      <div className="dash-greeting">
        <div>
          <h1 className="dash-greeting__title">{greeting}</h1>
          <p className="dash-greeting__sub">
            {!isConnected
              ? 'Waiting on the API. Nothing below is current until it reconnects.'
              : globalMetrics.live_campaigns > 0
                ? `${globalMetrics.live_campaigns} campaign${globalMetrics.live_campaigns > 1 ? 's' : ''} live · ` +
                  `${globalMetrics.active_prospects} prospect${globalMetrics.active_prospects === 1 ? '' : 's'} in motion · ` +
                  `${attentionTotal} item${attentionTotal === 1 ? '' : 's'} need your attention`
                : 'No campaign is live. Set one live to let its agents start working.'}
          </p>
        </div>
        <div className="dash-header-actions">
          <button className="btn btn--ghost" onClick={() => { refreshAll(); loadActivity(); }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn--secondary" onClick={() => navigate('/analytics')}>
            <TrendingUp size={14} /> Analytics
          </button>
          <button className="btn btn--primary" onClick={() => navigate('/campaigns/new')}>
            <Megaphone size={14} /> New Campaign
          </button>
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="dash-kpi-strip">
        <KPICard
          label="Active Campaigns"
          value={globalMetrics.live_campaigns ?? 0}
          sub={`of ${globalMetrics.total_campaigns ?? 0} total`}
          icon={Megaphone}
          color="var(--accent)"
          onClick={() => navigate('/campaigns')}
        />
        <KPICard
          label="Prospects in Motion"
          value={globalMetrics.active_prospects ?? 0}
          sub={`of ${globalMetrics.total_prospects ?? 0} total`}
          icon={Users}
          color="var(--brand-blue)"
          onClick={() => navigate('/prospects')}
        />
        <KPICard
          label="Meetings Booked"
          value={globalMetrics.meetings_booked ?? 0}
          sub="this campaign cycle"
          icon={Calendar}
          color="var(--success)"
          onClick={() => navigate('/analytics')}
        />
        <KPICard
          label="Pipeline Value"
          value={globalMetrics.pipeline_value
            ? `$${(globalMetrics.pipeline_value / 1000).toFixed(0)}K`
            : '$0'}
          sub="modelled from booked meetings"
          icon={TrendingUp}
          color="var(--brand-teal)"
          onClick={() => navigate('/analytics')}
        />
        <KPICard
          label="Agent Success Rate"
          value={`${globalMetrics.agent_success_rate ?? 0}%`}
          sub="across all agent runs"
          icon={Zap}
          color="var(--violet)"
          onClick={() => navigate('/agents')}
        />
      </div>

      {/* ── Main 2-col layout ── */}
      <div className="dash-main">
        {/* ── Left column ── */}
        <div className="dash-left">

          {/* Campaign Command */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card__header">
              <span className="card__title">Campaign Command</span>
              <button className="btn btn--ghost btn--sm" onClick={() => navigate('/campaigns')}>
                All campaigns <ChevronRight size={12} />
              </button>
            </div>
            <table className="campaigns-table">
              <thead>
                <tr>
                  <th className="th-name">Campaign</th>
                  <th>Status</th>
                  <th className="th-num">Sent</th>
                  <th className="th-num">Replies</th>
                  <th className="th-num">Meetings</th>
                  <th>Progress</th>
                  <th className="th-action">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaignsLoading
                  ? [1, 2, 3].map(i => (
                    <tr key={i}>
                      <td colSpan={7} style={{ padding: '14px 16px' }}>
                        <div className="skeleton" style={{ height: 14, borderRadius: 6, width: '100%' }} />
                      </td>
                    </tr>
                  ))
                  : campaigns.length === 0
                  ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        No campaigns yet. Create one to get started.
                      </td>
                    </tr>
                  )
                  : campaigns.map(c => (
                    <tr key={c.id} className="campaign-row" onClick={() => navigate(`/campaigns/${c.id}`)}>
                      <td>
                        <div className="campaign-name-cell">
                          <CampaignDot colour={c.colour} size={9} />
                          <div>
                            <span className="campaign-primary-name">{c.name}</span>
                            <span className="campaign-audience">{c.icp}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <StatusPill status={c.status} />
                      </td>
                      <td className="td-num">{c.metrics?.messages_sent ?? '—'}</td>
                      <td className="td-num">{c.metrics?.replies ?? '—'}</td>
                      <td className="td-num" style={{ color: c.metrics?.meetings_booked > 0 ? 'var(--success)' : undefined, fontWeight: c.metrics?.meetings_booked > 0 ? 700 : undefined }}>
                        {c.metrics?.meetings_booked ?? '—'}
                      </td>
                      <td style={{ minWidth: 100 }}>
                        <ProgressBar value={c.metrics?.progress ?? 0} color={c.colour || 'var(--accent)'} height={5} />
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {c.metrics?.progress ?? 0}%
                        </span>
                      </td>
                      <td className="td-action" onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {c.status === 'live' && (
                            <button
                              className="btn btn--primary btn--sm"
                              title="Advance up to 3 prospects one pipeline step each"
                              onClick={() => handleRun(c.id)}
                              disabled={runningId === c.id}
                            >
                              {runningId === c.id ? 'Running…' : 'Run'}
                            </button>
                          )}
                          <button
                            className={`btn btn--sm ${c.status === 'live' ? 'btn--secondary' : 'btn--success'}`}
                            onClick={() => handleToggleCampaign(c.id, c.status)}
                            disabled={pausingId === c.id || c.status === 'draft'}
                          >
                            {c.status === 'live'
                              ? <><Pause size={11} /> Pause</>
                              : <><Play size={11} /> Resume</>
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {/* Pipeline Funnel */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card__header">
              <span className="card__title">Pipeline Funnel</span>
              <button className="btn btn--ghost btn--sm" onClick={() => navigate('/prospects')}>
                View prospects <ChevronRight size={12} />
              </button>
            </div>
            <div className="card__body">
              {funnelLoading
                ? <div className="skeleton" style={{ height: 80, borderRadius: 10 }} />
                : (
                  <div className="dash-funnel">
                    {stageDefs.map((s, i) => (
                      <PipelineStage
                        key={s.key}
                        label={s.label}
                        count={funnelData[s.key] ?? 0}
                        total={funnelTotal}
                        color={funnelColors[i]}
                        onClick={() => navigate(`/prospects?status=${s.key}`)}
                      />
                    ))}
                  </div>
                )
              }
              <div className="dash-funnel-footnote">
                Click a stage to view prospects in that stage
              </div>
            </div>
          </div>

          {/* Activity Feed */}
          <div className="card">
            <div className="card__header">
              <span className="card__title">AI Activity Feed</span>
              <div className="dash-live-indicator">
                <div className="dash-live-dot" />
                Live
              </div>
            </div>
            <div className="card__body" style={{ padding: '8px 18px' }}>
              {activityLoading
                ? [1, 2, 3, 4].map(i => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div className="skeleton" style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ height: 10, width: '40%', borderRadius: 4, marginBottom: 6 }} />
                      <div className="skeleton" style={{ height: 12, width: '80%', borderRadius: 4 }} />
                    </div>
                  </div>
                ))
                : activity.length === 0
                  ? <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0', fontSize: 13 }}>No activity yet — start a campaign to see agent actions here.</p>
                  : activity.map(event => (
                    <ActivityEvent
                      key={event.id}
                      event={event}
                      onClick={() => setSelectedEvent(event)}
                    />
                  ))
              }
            </div>
            {activity.length > 0 && (
              <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                <button className="btn btn--ghost btn--sm" onClick={() => navigate('/agents')}>
                  View agent logs <ArrowRight size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column — Needs Attention ── */}
        <div className="dash-right">
          <div className="dash-attention-header">
            <span className="card__title" style={{ fontSize: 13 }}>Needs Your Attention</span>
            {needsAttention.summary?.total > 0 && (
              <span className="badge badge--danger">{needsAttention.summary.total}</span>
            )}
          </div>

          {escalationsCount + conflictsCount === 0 && (
            <AlertBanner type="success">
              ✓ No urgent items — agents are operating autonomously.
            </AlertBanner>
          )}

          {needsAttention.items?.length > 0
            ? needsAttention.items.map(item => (
              <NeedsAttentionItem
                key={item.id}
                item={item}
                onClick={() => navigate(item.action_url)}
              />
            ))
            : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0', fontSize: 13 }}>
                No attention items — system is running smoothly.
              </div>
            )
          }

          {/* Quick links */}
          <div className="dash-quick-links">
            <button className="dash-quick-link" onClick={() => navigate('/review-queue')}>
              <span>Approvals</span>
              <span className="badge badge--danger">{escalationsCount}</span>
            </button>
            <button className="dash-quick-link" onClick={() => navigate('/conflicts')}>
              <span>Conflicts</span>
              <span className="badge badge--warning">{conflictsCount}</span>
            </button>
            <button className="dash-quick-link" onClick={() => navigate('/agents')}>
              <span>Agents</span>
              <ChevronRight size={12} />
            </button>
            <button className="dash-quick-link" onClick={() => navigate('/calls')}>
              <span>Live Calls</span>
              <span className="dash-live-dot" style={{ width: 7, height: 7 }} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Event Drawer ── */}
      {selectedEvent && (
        <Drawer
          open={!!selectedEvent}
          onClose={() => setSelectedEvent(null)}
          title="Agent Action Detail"
          width={460}
        >
          <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} navigate={navigate} />
        </Drawer>
      )}
    </div>
  );
}

function EventDetail({ event, navigate }) {
  const d = event.details || {};
  return (
    <div className="event-detail">
      <div className="event-detail__section">
        <div className="event-detail__label">Agent</div>
        <div className="event-detail__value" style={{ color: 'var(--accent)' }}>{event.agent}</div>
      </div>
      <div className="event-detail__section">
        <div className="event-detail__label">Action</div>
        <div className="event-detail__value">{event.outcome}</div>
      </div>
      {event.prospect_name && (
        <div className="event-detail__section">
          <div className="event-detail__label">Prospect</div>
          <div className="event-detail__value">
            <button
              className="btn btn--ghost btn--sm"
              style={{ padding: '2px 6px', fontSize: 12 }}
              onClick={() => navigate(`/prospects/${event.prospect_id}`)}
            >
              {event.prospect_name} · {event.prospect_company} <ArrowRight size={11} />
            </button>
          </div>
        </div>
      )}
      {d.reason && (
        <div className="event-detail__section">
          <div className="event-detail__label">Reason</div>
          <div className="event-detail__value">{d.reason}</div>
        </div>
      )}
      {d.data_used && (
        <div className="event-detail__section">
          <div className="event-detail__label">Data Used</div>
          <div className="event-detail__value">{d.data_used}</div>
        </div>
      )}
      {d.knowledge_sources?.length > 0 && (
        <div className="event-detail__section">
          <div className="event-detail__label">Knowledge Sources</div>
          <div className="event-detail__value">
            {d.knowledge_sources.map(s => (
              <span key={s} className="badge badge--accent" style={{ marginRight: 4, marginBottom: 4 }}>{s}</span>
            ))}
          </div>
        </div>
      )}
      {d.prompt_version && (
        <div className="event-detail__section">
          <div className="event-detail__label">Prompt Version</div>
          <div className="event-detail__value">{d.prompt_version}</div>
        </div>
      )}
      {d.confidence && (
        <div className="event-detail__section">
          <div className="event-detail__label">Confidence</div>
          <div className="event-detail__value">{d.confidence}%</div>
        </div>
      )}
      {d.action_taken && (
        <div className="event-detail__section">
          <div className="event-detail__label">Action Taken</div>
          <div className="event-detail__value">{d.action_taken}</div>
        </div>
      )}
      {d.next_action && (
        <div className="event-detail__section">
          <div className="event-detail__label">Next Action</div>
          <div className="event-detail__value" style={{ color: 'var(--accent)' }}>{d.next_action}</div>
        </div>
      )}
      <div className="event-detail__section">
        <div className="event-detail__label">Time</div>
        <div className="event-detail__value">
          {new Date(event.timestamp).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          })}
        </div>
      </div>
    </div>
  );
}
