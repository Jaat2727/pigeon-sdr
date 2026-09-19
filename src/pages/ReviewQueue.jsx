import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, X, Edit2, Save, Inbox, Clock, AlertTriangle,
  ChevronRight, ShieldAlert, Info,
} from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import { LoadingState, ErrorState, EmptyState, Drawer, RiskBadge } from '../components/index.jsx';
import './ReviewQueue.css';

const TYPE_LABELS = {
  needs_review:       'Needs Review',
  needs_human:        'Needs Human',
  escalate_to_human:  'Escalated',
  objection_detected: 'Objection Detected',
};

const RISK_COLOR = {
  high:   'var(--danger)',
  medium: 'var(--warning)',
  low:    'var(--text-secondary)',
};

function timeAgo(dateStr) {
  const mins = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function ReviewQueue() {
  const navigate = useNavigate();
  const { loadEscalations, addToast } = useApp();

  const [escalations, setEscalations] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [drawer, setDrawer]           = useState(null);   // esc being viewed
  const [editText, setEditText]       = useState('');
  const [isEditing, setIsEditing]     = useState(false);
  const [acting, setActing]           = useState(null);

  const loadQueue = useCallback(async () => {
    setLoading(true); setError(null);
    try { setEscalations(await api.getEscalations()); }
    catch (e) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  /**
   * Approving resumes the prospect where the agent stopped; rejecting stops
   * that prospect without touching the rest of the campaign. Both write to the
   * server — the previous version only removed the row from local state, so a
   * decision vanished on reload.
   */
  const act = useCallback(async (id, action, edited = null) => {
    setActing(id + action);
    try {
      const res = await api.resolveEscalation(id, action, edited ? { edited_content: edited } : {});
      setEscalations(prev => prev.filter(e => e.id !== id));
      if (drawer?.id === id) setDrawer(null);
      await loadEscalations();
      addToast({
        type: action === 'approved' ? 'success' : 'info',
        title: action === 'approved' ? 'Approved' : 'Rejected',
        message:
          action === 'approved'
            ? res.pipeline?.status === 'advanced'
              ? `The prospect moved to ${res.pipeline.state}.`
              : 'The prospect is queued to continue on the next pipeline run.'
            : 'This prospect is stopped in this campaign. Other campaigns are unaffected.',
      });
    } catch (e) {
      addToast({ type: 'error', title: 'Could not record that decision', message: e.message });
    } finally {
      setActing(null);
    }
  }, [drawer, loadEscalations, addToast]);

  const openDrawer = (esc) => {
    setDrawer(esc);
    setEditText(esc.proposed_action || '');
    setIsEditing(false);
  };

  // Summary counts
  const high   = escalations.filter(e => e.risk_level === 'high').length;
  const medium = escalations.filter(e => e.risk_level === 'medium').length;
  const low    = escalations.filter(e => !e.risk_level || e.risk_level === 'low').length;

  if (loading) return <LoadingState message="Loading approvals…" />;
  if (error)   return <ErrorState message={error} onRetry={loadQueue} />;

  return (
    <div className="page animate-in">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Approval Center</h1>
          <p className="page-subtitle">
            {escalations.length > 0
              ? `${escalations.length} item${escalations.length !== 1 ? 's' : ''} awaiting your decision`
              : 'All caught up — no pending approvals'}
          </p>
        </div>
      </div>

      {/* ── Summary strip ── */}
      {escalations.length > 0 && (
        <div className="aq-summary-strip">
          <div className="aq-summary-cell">
            <span className="aq-summary-value">{escalations.length}</span>
            <span className="aq-summary-label">Total Pending</span>
          </div>
          <div className="aq-summary-cell aq-summary-cell--danger">
            <span className="aq-summary-value">{high}</span>
            <span className="aq-summary-label">High Risk</span>
          </div>
          <div className="aq-summary-cell aq-summary-cell--warning">
            <span className="aq-summary-value">{medium}</span>
            <span className="aq-summary-label">Medium Risk</span>
          </div>
          <div className="aq-summary-cell">
            <span className="aq-summary-value">{low}</span>
            <span className="aq-summary-label">Low Risk</span>
          </div>
        </div>
      )}

      {/* ── Inbox list ── */}
      {escalations.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Approval inbox is clear"
          message="Agents are operating autonomously — nothing needs your decision right now."
        />
      ) : (
        <div className="card aq-inbox">
          {/* Column header */}
          <div className="aq-inbox-header">
            <span style={{ width: 72 }}>Risk</span>
            <span style={{ flex: 1.2 }}>Agent</span>
            <span style={{ flex: 2 }}>Campaign · Prospect</span>
            <span style={{ flex: 1.5 }}>Reason</span>
            <span style={{ width: 60, textAlign: 'right' }}>Time</span>
            <span style={{ width: 100 }} />
          </div>

          {escalations.map(esc => (
            <div
              key={esc.id}
              className={`aq-row ${esc.risk_level === 'high' ? 'aq-row--high' : ''}`}
            >
              {/* Risk */}
              <div style={{ width: 72, flexShrink: 0 }}>
                <span
                  className="aq-risk-dot"
                  style={{ color: RISK_COLOR[esc.risk_level] || 'var(--text-muted)' }}
                >
                  {esc.risk_level === 'high' && <ShieldAlert size={13} />}
                  {esc.risk_level === 'medium' && <AlertTriangle size={13} />}
                  {(!esc.risk_level || esc.risk_level === 'low') && <Info size={13} />}
                  <span className="aq-risk-label">{esc.risk_level || 'low'}</span>
                </span>
              </div>

              {/* Agent */}
              <div className="aq-cell" style={{ flex: 1.2 }}>
                <span className="aq-agent">{esc.source_agent}</span>
                <span className="aq-type">{TYPE_LABELS[esc.escalation_type] || esc.escalation_type}</span>
              </div>

              {/* Campaign · Prospect */}
              <div className="aq-cell" style={{ flex: 2 }}>
                <span className="aq-primary">
                  {esc.prospect_name || esc.prospect_id}
                </span>
                <span className="aq-secondary">
                  {esc.campaign_name || esc.campaign_id}
                </span>
              </div>

              {/* Reason — truncated */}
              <div className="aq-cell" style={{ flex: 1.5 }}>
                <span className="aq-reason">
                  {(esc.proposed_action || '').substring(0, 60)}{esc.proposed_action?.length > 60 ? '…' : ''}
                </span>
              </div>

              {/* Time */}
              <div style={{ width: 60, flexShrink: 0, textAlign: 'right' }}>
                <span className="aq-time">{timeAgo(esc.created_at)}</span>
              </div>

              {/* Action */}
              <div style={{ width: 100, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => openDrawer(esc)}
                  style={{ fontSize: 12, gap: 4 }}
                >
                  View <ChevronRight size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Detail Drawer ── */}
      <Drawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        title="Approval Detail"
        width={500}
      >
        {drawer && (
          <ApprovalDrawer
            esc={drawer}
            editText={editText}
            setEditText={setEditText}
            isEditing={isEditing}
            setIsEditing={setIsEditing}
            acting={acting}
            onAct={act}
            navigate={navigate}
          />
        )}
      </Drawer>
    </div>
  );
}

function ApprovalDrawer({ esc, editText, setEditText, isEditing, setIsEditing, acting, onAct, navigate }) {
  const rows = [
    { label: 'Prospect', value: esc.prospect_name, link: `/prospects/${esc.prospect_id}` },
    { label: 'Campaign', value: esc.campaign_name, link: `/campaigns/${esc.campaign_id}` },
    { label: 'Agent',    value: esc.source_agent },
    { label: 'Type',     value: TYPE_LABELS[esc.escalation_type] || esc.escalation_type },
    { label: 'Risk',     value: <RiskBadge level={esc.risk_level} /> },
    { label: 'Flagged',  value: timeAgo(esc.created_at) },
  ];

  return (
    <div className="aq-drawer">
      {/* Meta rows */}
      <div className="aq-drawer-meta">
        {rows.map(r => (
          <div key={r.label} className="aq-drawer-meta-row">
            <span className="aq-drawer-label">{r.label}</span>
            {r.link
              ? <button className="btn btn--ghost btn--sm" style={{ padding: '2px 6px', fontSize: 12 }} onClick={() => navigate(r.link)}>{r.value} <ChevronRight size={10} /></button>
              : <span className="aq-drawer-value">{r.value}</span>
            }
          </div>
        ))}
      </div>

      {/* Proposed action / content */}
      <div className="aq-drawer-section">
        <div className="aq-drawer-section-label">Proposed Action</div>
        {isEditing ? (
          <textarea
            className="form-control"
            rows={6}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            autoFocus
          />
        ) : (
          <div className="aq-drawer-content">{esc.proposed_action}</div>
        )}
      </div>

      {/* Why the agent stopped */}
      {esc.reason && esc.reason !== esc.proposed_action && (
        <div className="aq-drawer-section">
          <div className="aq-drawer-section-label">Why the agent escalated</div>
          <div className="aq-drawer-content">{esc.reason}</div>
        </div>
      )}

      {/* What each decision does */}
      <div className="aq-drawer-section">
        <div className="aq-drawer-section-label">What happens next</div>
        <div className="aq-drawer-suggestion">
          Approving resumes this prospect from where the agent stopped
          {esc.escalation_type === 'needs_review'
            ? ', overriding the needs_review verdict to qualified so the sequence can be planned.'
            : '.'}
          {' '}Rejecting stops this prospect in this campaign only. Every other campaign and every other
          prospect continues either way.
        </div>
      </div>

      {/* Actions */}
      <div className="aq-drawer-actions">
        <button
          className="btn btn--danger-outline"
          onClick={() => onAct(esc.id, 'rejected')}
          disabled={!!acting}
        >
          <X size={14} /> Reject
        </button>

        {isEditing ? (
          <>
            <button className="btn btn--secondary" onClick={() => setIsEditing(false)}>Cancel</button>
            <button
              className="btn btn--success"
              onClick={() => onAct(esc.id, 'approved', editText)}
              disabled={!!acting}
            >
              <Save size={14} /> Save & Approve
            </button>
          </>
        ) : (
          <>
            <button className="btn btn--secondary" onClick={() => setIsEditing(true)}>
              <Edit2 size={14} /> Edit
            </button>
            <button
              className="btn btn--primary"
              onClick={() => onAct(esc.id, 'approved')}
              disabled={!!acting}
            >
              <Check size={14} /> Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}
