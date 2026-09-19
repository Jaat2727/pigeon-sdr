import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle, Clock, Pause, Play, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  StatusPill, CampaignDot, LoadingState, ErrorState, EmptyState,
  ProgressBar, AlertBanner,
} from '../components/index.jsx';
import './CampaignsList.css';

export default function CampaignsList() {
  const navigate = useNavigate();
  const {
    campaigns, campaignsLoading, campaignsError,
    setCampaignStatus, isKilled, conflictsCount, escalationsCount, loadCampaigns,
  } = useApp();

  if (campaignsLoading) return <LoadingState message="Loading campaigns…" />;
  if (campaignsError) return <ErrorState message={campaignsError} onRetry={loadCampaigns} />;

  const handleToggle = (e, campaign) => {
    e.stopPropagation();
    if (isKilled) return;
    const newStatus = campaign.status === 'live' ? 'paused' : 'live';
    setCampaignStatus(campaign.id, newStatus);
  };

  return (
    <div className="page animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle">
            {campaigns.filter(c => c.status === 'live').length} live · {campaigns.filter(c => c.status === 'paused').length} paused · {campaigns.filter(c => c.status === 'draft').length} draft
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {conflictsCount > 0 && (
            <button className="btn btn--secondary" onClick={() => navigate('/conflicts')}>
              <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
              {conflictsCount} Conflict{conflictsCount > 1 ? 's' : ''}
            </button>
          )}
          {escalationsCount > 0 && (
            <button className="btn btn--secondary" onClick={() => navigate('/review-queue')}>
              <Clock size={14} style={{ color: 'var(--accent)' }} />
              {escalationsCount} Approval{escalationsCount > 1 ? 's' : ''}
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={() => navigate('/campaigns/new')}>
            <Plus size={15} /> New Campaign
          </button>
        </div>
      </div>

      {/* Campaign Table */}
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          message="Create your first campaign to start reaching prospects."
          action={{ label: 'Create your first campaign', onClick: () => navigate('/campaigns/new') }}
        />
      ) : (
        <div className="card">
          <table className="campaigns-table">
            <thead>
              <tr>
                <th className="th-name">Campaign</th>
                <th>Status</th>
                <th>ICP Target</th>
                <th className="th-num">Progress</th>
                <th className="th-num">Sent</th>
                <th className="th-num">Replies</th>
                <th className="th-num">Meetings</th>
                <th className="th-num">Reply Rate</th>
                <th className="th-action">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const m = c.metrics || {};
                const isLive = c.status === 'live';
                const isPaused = c.status === 'paused';
                const isDraft = c.status === 'draft';
                return (
                  <tr
                    key={c.id}
                    className={`campaign-row ${isPaused ? 'dimmed' : ''}`}
                    onClick={() => !isDraft && navigate(`/campaigns/${c.id}`)}
                    style={{ cursor: isDraft ? 'default' : 'pointer' }}
                  >
                    <td className="td-name">
                      <div className="campaign-name-cell">
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <CampaignDot colour={c.colour} size={10} />
                          {isLive && (
                            <span style={{
                              position: 'absolute', top: -1, right: -1,
                              width: 5, height: 5, borderRadius: '50%',
                              background: 'var(--success)', animation: 'pulse-dot 2s ease-in-out infinite',
                            }} />
                          )}
                        </div>
                        <div>
                          <span className="campaign-primary-name">{c.name}</span>
                          <span className="campaign-audience">{c.owner}</span>
                        </div>
                      </div>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.icp || c.target_audience || '—'}
                      </span>
                    </td>
                    <td style={{ minWidth: 100 }}>
                      {!isDraft && (
                        <>
                          <ProgressBar value={m.progress ?? 0} color={c.colour || 'var(--accent)'} height={4} />
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{m.progress ?? 0}%</span>
                        </>
                      )}
                    </td>
                    <td className="td-num">{m.messages_sent ?? '—'}</td>
                    <td className="td-num">{m.replies ?? '—'}</td>
                    <td className="td-num" style={{ color: m.meetings_booked > 0 ? 'var(--success)' : undefined, fontWeight: m.meetings_booked > 0 ? 700 : undefined }}>
                      {m.meetings_booked ?? '—'}
                    </td>
                    <td className="td-num">
                      {m.response_rate != null
                        ? <span style={{ color: parseFloat(m.response_rate) >= 10 ? 'var(--success)' : undefined, fontWeight: 600 }}>{m.response_rate}%</span>
                        : '—'
                      }
                    </td>
                    <td className="td-action" onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                        {!isDraft && (
                          <button
                            type="button"
                            className={`btn btn--sm ${isLive ? 'btn--secondary' : 'btn--success'}`}
                            onClick={(e) => handleToggle(e, c)}
                            disabled={isKilled}
                          >
                            {isLive ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Resume</>}
                          </button>
                        )}
                        {isDraft && (
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate(`/campaigns/${c.id}/edit`)}>
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm btn--icon"
                          onClick={() => navigate(`/campaigns/${c.id}`)}
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
