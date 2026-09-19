import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, DollarSign, Mail, Link2, MessageCircle, Phone,
  Bot, BarChart3, Target,
} from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import { LoadingState, ErrorState, CampaignDot, ProgressBar, EmptyState, AssumptionNote } from '../components/index.jsx';
import './Analytics.css';

const CHANNEL_META = {
  email:    { label: 'Email',    icon: Mail,          color: '#4F46E5' },
  linkedin: { label: 'LinkedIn', icon: Link2,         color: '#0077B5' },
  sms:      { label: 'SMS',      icon: MessageCircle, color: '#059669' },
  voice:    { label: 'Voice',    icon: Phone,         color: '#F59E0B' },
};

// ── SVG Donut Chart ──
function DonutChart({ segments, center, label }) {
  const SIZE = 120;
  const R = 46;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const circ = 2 * Math.PI * R;

  const total = segments.reduce((s, seg) => s + seg.value, 0);

  // Each arc starts where the previous one ended. Accumulated with reduce
  // rather than a mutable counter, which React 19's rules disallow in render.
  const arcs = segments.reduce((acc, seg) => {
    const dash = (total > 0 ? seg.value / total : 0) * circ;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    acc.push({ ...seg, dash, gap: circ - dash, offset });
    return acc;
  }, []);

  return (
    <div className="donut-wrap">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke={arc.color}
            strokeWidth={14}
            strokeDasharray={`${arc.dash} ${arc.gap}`}
            strokeDashoffset={-arc.offset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: `${CX}px ${CY}px`, transition: 'all 0.6s ease' }}
          />
        ))}
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text-primary)" fontFamily="var(--font-mono)">{center}</text>
        <text x={CX} y={CY + 12} textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="var(--font-ui)" textTransform="uppercase">{label}</text>
      </svg>
      <div className="donut-legend">
        {segments.map((seg, i) => (
          <div key={i} className="donut-legend-row">
            <span className="donut-legend-dot" style={{ background: seg.color }} />
            <span className="donut-legend-label">{seg.label}</span>
            <span className="donut-legend-val">{seg.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}


function MetricRow({ label, value, sub, color, barPct }) {
  return (
    <div className="metric-row">
      <div className="metric-row__left">
        <div className="metric-row__label">{label}</div>
        {sub && <div className="metric-row__sub">{sub}</div>}
      </div>
      <div className="metric-row__right">
        <div className="metric-row__value" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
        {barPct !== undefined && (
          <ProgressBar value={barPct} color={color || 'var(--accent)'} height={4} />
        )}
      </div>
    </div>
  );
}

export default function Analytics() {
  const navigate = useNavigate();
  const { campaigns, campaignsLoading, globalMetrics } = useApp();
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [costs, setCosts] = useState(null);
  const [channels, setChannels] = useState([]);
  const [agentPerf, setAgentPerf] = useState([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [metricsArr, costsData, channelData, agentData] = await Promise.all([
          Promise.all(campaigns.map((c) => api.getCampaignMetrics(c.id).then((m) => ({ ...m, campaign: c })))),
          api.getCosts(),
          api.getChannelMetrics(),
          api.getAgentPerformance(),
        ]);
        if (!mounted) return;
        setMetrics(metricsArr);
        setCosts(costsData);
        setChannels(channelData ?? []);
        setAgentPerf(agentData ?? []);
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    if (campaigns.length) load();
    else if (!campaignsLoading) setLoading(false);
    return () => { mounted = false; };
  }, [campaigns, campaignsLoading]);

  const totalSent = metrics.reduce((sum, m) => sum + (m.messages_sent || 0), 0);
  const totalReplies = metrics.reduce((sum, m) => sum + (m.replies || 0), 0);
  const totalMeetings = metrics.reduce((sum, m) => sum + (m.meetings_booked || 0), 0);
  const overallReplyRate = totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : 0;
  const meetingRate = totalReplies > 0 ? ((totalMeetings / totalReplies) * 100).toFixed(1) : 0;
  const qualifiedLeads = metrics.reduce((sum, m) => sum + (m.funnel?.qualified || 0), 0);
  const totalProspects = metrics.reduce((sum, m) => sum + (m.total_prospects || 0), 0);
  const qualifiedRate = totalProspects > 0 ? ((qualifiedLeads / totalProspects) * 100).toFixed(1) : 0;
  const pipelineValue = globalMetrics.pipeline_value || 0;
  const costPerMeeting = costs && totalMeetings > 0 ? (costs.total_spend / totalMeetings).toFixed(2) : '—';

  const channelTotal = channels.reduce((s, c) => s + (c.sent || 0), 0);

  if (loading) return <LoadingState message="Loading analytics…" />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  if (!campaigns.length) {
    return (
      <div className="page animate-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Analytics</h1>
            <p className="page-subtitle">Campaign performance, channel breakdown and agent efficiency.</p>
          </div>
        </div>
        <EmptyState
          icon={BarChart3}
          title="Nothing to measure yet"
          message="Create a campaign and run the pipeline. Every number on this page is counted from the database, so it stays at zero until agents have actually done something."
          action={{ label: 'Create a campaign', onClick: () => navigate('/campaigns/new') }}
        />
      </div>
    );
  }

  return (
    <div className="page animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">
            Every figure here is counted from the database. Nothing is estimated except pipeline value,
            which is labelled where it appears.
          </p>
        </div>
      </div>

      {/* ── Primary Metrics ── */}
      <div className="analytics-metrics-grid">
        <div className="card">
          <div className="analytics-metric">
            <div className="analytics-metric__label">Reply Rate</div>
            <div className="analytics-metric__value" style={{ color: 'var(--accent)' }}>{overallReplyRate}%</div>
            <div className="analytics-metric__sub">{totalReplies} of {totalSent} sent</div>
          </div>
        </div>
        <div className="card">
          <div className="analytics-metric">
            <div className="analytics-metric__label">Meeting Rate</div>
            <div className="analytics-metric__value" style={{ color: 'var(--success)' }}>{meetingRate}%</div>
            <div className="analytics-metric__sub">{totalMeetings} meetings from {totalReplies} replies</div>
          </div>
        </div>
        <div className="card">
          <div className="analytics-metric">
            <div className="analytics-metric__label">Qualified Lead Rate</div>
            <div className="analytics-metric__value" style={{ color: 'var(--violet)' }}>{qualifiedRate}%</div>
            <div className="analytics-metric__sub">{qualifiedLeads} of {totalProspects} prospects</div>
          </div>
        </div>
        <div className="card">
          <div className="analytics-metric">
            <div className="analytics-metric__label">Cost / Meeting</div>
            <div className="analytics-metric__value" style={{ color: 'var(--warning)' }}>
              {costPerMeeting === '—' ? '—' : `$${costPerMeeting}`}
            </div>
            <div className="analytics-metric__sub">Total spend: ${costs?.total_spend?.toFixed(2) ?? '0.00'}</div>
          </div>
        </div>
        <div className="card">
          <div className="analytics-metric">
            <div className="analytics-metric__label">Pipeline Value</div>
            <div className="analytics-metric__value" style={{ color: 'var(--brand-teal)' }}>
              ${(pipelineValue / 1000).toFixed(0)}K
            </div>
            <div className="analytics-metric__sub">from {totalMeetings} booked meetings</div>
            <AssumptionNote>
              Modelled, not measured: ${((globalMetrics.pipeline_assumptions?.meeting_value_usd ?? 50000) / 1000).toFixed(0)}K
              assumed per booked meeting.
            </AssumptionNote>
          </div>
        </div>
        <div className="card">
          <div className="analytics-metric">
            <div className="analytics-metric__label">Agent Success Rate</div>
            <div className="analytics-metric__value" style={{ color: 'var(--success)' }}>
              {globalMetrics.agent_success_rate ?? 0}%
            </div>
            <div className="analytics-metric__sub">{costs?.total_runs?.toLocaleString() ?? 0} total runs</div>
          </div>
        </div>
      </div>

      {/* ── 2-col analytics layout ── */}
      <div className="analytics-main">
        {/* Left */}
        <div className="analytics-left">
          {/* Campaign comparison */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card__header">
              <span className="card__title">Campaign Comparison</span>
            </div>
            <table className="campaigns-table">
              <thead>
                <tr>
                  <th className="th-name">Campaign</th>
                  <th className="th-num">Sent</th>
                  <th className="th-num">Replies</th>
                  <th className="th-num">Reply Rate</th>
                  <th className="th-num">Meetings</th>
                  <th className="th-num">Pipeline</th>
                  <th className="th-num">Agent ✓%</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(m => (
                  <tr key={m.campaign.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/campaigns/${m.campaign.id}`)}>
                    <td>
                      <div className="campaign-name-cell">
                        <CampaignDot colour={m.campaign.colour} size={8} />
                        <div>
                          <span className="campaign-primary-name" style={{ fontSize: 12 }}>{m.campaign.name}</span>
                          <span className="campaign-audience">{m.campaign.icp}</span>
                        </div>
                      </div>
                    </td>
                    <td className="td-num">{m.messages_sent}</td>
                    <td className="td-num">{m.replies}</td>
                    <td className="td-num">
                      <span style={{ color: parseFloat(m.response_rate) >= 10 ? 'var(--success)' : 'var(--text-primary)', fontWeight: 600 }}>
                        {m.response_rate}%
                      </span>
                    </td>
                    <td className="td-num" style={{ color: m.meetings_booked > 0 ? 'var(--success)' : undefined, fontWeight: m.meetings_booked > 0 ? 700 : undefined }}>
                      {m.meetings_booked}
                    </td>
                    <td className="td-num">${((m.pipeline_value || 0) / 1000).toFixed(0)}K</td>
                    <td className="td-num">
                      {m.agent_runs_total > 0 ? (
                        <span style={{ color: m.agent_success_rate >= 90 ? 'var(--success)' : 'var(--warning)' }}>
                          {m.agent_success_rate}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }} title="No agent runs yet">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Agent Performance */}
          <div className="card">
            <div className="card__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bot size={14} style={{ color: 'var(--accent)' }} />
                <span className="card__title">Agent Performance</span>
              </div>
            </div>
            <table className="campaigns-table">
              <thead>
                <tr>
                  <th className="th-name">Agent</th>
                  <th className="th-num">Runs</th>
                  <th className="th-num">Success</th>
                  <th className="th-num">Failed</th>
                  <th className="th-num">Fell back</th>
                  <th className="th-num">Avg latency</th>
                  <th className="th-num">Spend</th>
                </tr>
              </thead>
              <tbody>
                {agentPerf.map((agent) => (
                  <tr key={agent.key}>
                    <td>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{agent.name}</span>
                      <span className="campaign-audience">
                        {agent.engine === 'our_engine' ? 'Our engine' : 'DronaHQ'}
                      </span>
                    </td>
                    <td className="td-num">{agent.runs.toLocaleString()}</td>
                    <td className="td-num">
                      {agent.runs === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      ) : (
                        <span style={{ color: agent.success >= 95 ? 'var(--success)' : agent.success >= 85 ? 'var(--warning)' : 'var(--danger)', fontWeight: 600 }}>
                          {agent.success}%
                        </span>
                      )}
                    </td>
                    <td className="td-num" style={{ color: agent.failures > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {agent.failures}
                    </td>
                    <td className="td-num" style={{ color: agent.degraded > 0 ? 'var(--warning)' : 'var(--text-muted)' }}
                        title="Runs where DronaHQ did not return usable output and the local engine answered instead">
                      {agent.degraded}
                    </td>
                    <td className="td-num">{agent.avg_latency_ms ? `${agent.avg_latency_ms}ms` : '—'}</td>
                    <td className="td-num">${(agent.cost ?? 0).toFixed(4)}</td>
                  </tr>
                ))}
                {agentPerf.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
                      No agent runs recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right */}
        <div className="analytics-right">
          {/* Channel mix — counted from the messages table */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__header">
              <span className="card__title">Channel Mix</span>
            </div>
            <div style={{ padding: '8px 16px 12px' }}>
              {channelTotal === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', lineHeight: 1.5 }}>
                  No messages sent yet, so there is no channel mix to show. Run a campaign to populate this.
                </p>
              ) : (
                <>
                  <DonutChart
                    center={channelTotal}
                    label="messages"
                    segments={channels
                      .filter((c) => c.sent > 0)
                      .map((c) => ({
                        label: CHANNEL_META[c.channel]?.label ?? c.channel,
                        value: c.sent,
                        pct: Math.round((c.sent / channelTotal) * 100),
                        color: CHANNEL_META[c.channel]?.color ?? '#94A3B8',
                      }))}
                  />
                  <div style={{ marginTop: 12 }}>
                    {channels.filter((c) => c.sent > 0).map((c) => (
                      <MetricRow
                        key={c.channel}
                        label={CHANNEL_META[c.channel]?.label ?? c.channel}
                        sub={`${c.sent} sent · ${c.replied} replies · ${c.meetings} meetings`}
                        value={`${c.reply_rate}%`}
                        color={CHANNEL_META[c.channel]?.color}
                        barPct={Math.min(c.reply_rate * 2, 100)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Campaign contribution — prospects worked, which is measurable from
              the first pipeline run rather than only once meetings exist. */}
          {metrics.length > 0 && totalProspects > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card__header">
                <span className="card__title">Prospects by Campaign</span>
              </div>
              <div style={{ padding: '8px 16px 12px' }}>
                <DonutChart
                  center={totalProspects}
                  label="prospects"
                  segments={metrics
                    .filter((m) => (m.total_prospects ?? 0) > 0)
                    .map((m, i) => ({
                      label: m.campaign?.name?.split(' ').slice(0, 2).join(' ') || `Campaign ${i + 1}`,
                      value: m.total_prospects,
                      pct: Math.round((m.total_prospects / totalProspects) * 100),
                      color: m.campaign?.colour || '#4F46E5',
                    }))}
                />
              </div>
            </div>
          )}

          {/* Cost metrics */}
          <div className="card">
            <div className="card__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DollarSign size={14} style={{ color: 'var(--warning)' }} />
                <span className="card__title">Cost Efficiency</span>
              </div>
            </div>
            <div style={{ padding: '4px 0' }}>
              <MetricRow
                label="Cost / Prospect"
                value={costs && totalProspects > 0 ? `$${(costs.total_spend / totalProspects).toFixed(3)}` : '—'}
                sub="avg spend per prospect processed"
              />
              <MetricRow
                label="Cost / Qualified Lead"
                value={costs && qualifiedLeads > 0 ? `$${(costs.total_spend / qualifiedLeads).toFixed(3)}` : '—'}
                sub="avg spend per ICP-qualified lead"
              />
              <MetricRow
                label="Cost / Reply"
                value={costs && totalReplies > 0 ? `$${(costs.total_spend / totalReplies).toFixed(3)}` : '—'}
                sub="avg spend per inbound reply"
              />
              <MetricRow
                label="Cost / Meeting"
                value={costPerMeeting === '—' ? '—' : `$${costPerMeeting}`}
                sub="avg spend per meeting booked"
                color="var(--warning)"
              />
              <MetricRow
                label="Avg Latency"
                value={costs ? `${costs.avg_latency_ms}ms` : '—'}
                sub="avg agent run latency"
              />
              <MetricRow
                label="Total Agent Runs"
                value={costs ? costs.total_runs.toLocaleString() : '—'}
                sub="across all campaigns"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
