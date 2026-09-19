import { useState, useEffect, useCallback } from 'react';
import { ArrowUpDown, CheckCircle } from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import { LoadingState, ErrorState, EmptyState, Drawer } from '../components/index.jsx';
import './Conflicts.css';

const CONFLICT_TYPE_LABELS = {
  duplicate_prospect:    'Duplicate Prospect',
  multi_campaign_touch:  'Multi-Campaign Touch',
  manual_review:         'Manual Review',
  suppression_conflict:  'Suppression Conflict',
};

const AI_RECOMMENDATIONS = {
  duplicate_prospect:   'Keep the higher-priority campaign and suppress the second.',
  multi_campaign_touch: 'Allow the primary campaign to proceed and pause outreach from the secondary.',
  manual_review:        'Review contact history before continuing any outreach.',
  suppression_conflict: 'Verify suppression status before any further contact.',
};

function timeAgo(dateStr) {
  const mins = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const RESOLUTION_OPTIONS = [
  { id: 'keep_a',        label: 'Keep Campaign A — suppress Campaign B' },
  { id: 'keep_b',        label: 'Keep Campaign B — suppress Campaign A' },
  { id: 'suppress_both', label: 'Suppress both campaigns for this prospect' },
  { id: 'allow_both',    label: 'Allow both campaigns to continue' },
];

export default function Conflicts() {
  const { loadConflicts: reloadGlobalConflicts, addToast } = useApp();
  const [conflicts, setConflicts]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [drawer, setDrawer]         = useState(null);
  const [resolution, setResolution] = useState('keep_a');
  const [resolving, setResolving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConflicts(await api.getConflicts());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDrawer = (c) => { setDrawer(c); setResolution('keep_a'); };

  /**
   * The losing campaigns stop working this prospect; their history is kept, so
   * the decision is reversible. This route did not exist before, so the button
   * removed the card and wrote nothing.
   */
  const handleResolve = async () => {
    if (!drawer) return;
    setResolving(true);
    try {
      const payload =
        resolution === 'keep_a'
          ? { campaign_id: drawer.campaign_ids?.[0] }
          : resolution === 'keep_b'
            ? { campaign_id: drawer.campaign_ids?.[1] }
            : { resolution };

      const res = await api.resolveConflict(drawer.id, payload);
      setConflicts(prev => prev.filter(c => c.id !== drawer.id));
      setDrawer(null);
      await reloadGlobalConflicts();
      addToast({
        type: 'success',
        title: 'Conflict resolved',
        message:
          res.mode === 'keep_one'
            ? `${res.losers.length} campaign(s) stopped working this prospect. The winner continues.`
            : res.mode === 'suppress_both'
              ? 'Every conflicting campaign stopped working this prospect.'
              : 'All campaigns were allowed to continue.',
      });
    } catch (e) {
      addToast({ type: 'error', title: 'Could not resolve the conflict', message: e.message });
    } finally {
      setResolving(false);
    }
  };

  // Summary counts by type
  const types = conflicts.reduce((acc, c) => {
    const t = c.type || c.conflict_type || 'manual_review';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  if (loading) return <LoadingState message="Scanning for conflicts…" />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="page animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Conflict Center</h1>
          <p className="page-subtitle">
            The same person can sit in more than one campaign. When two live campaigns would work the same
            prospect, outreach is held here until somebody decides which one keeps them.
          </p>
        </div>
      </div>

      {/* Summary strip */}
      {conflicts.length > 0 && (
        <div className="conf-summary-strip">
          <div className="conf-summary-cell conf-summary-cell--total">
            <span className="conf-summary-value">{conflicts.length}</span>
            <span className="conf-summary-label">Active Conflicts</span>
          </div>
          <div className="conf-summary-cell">
            <span className="conf-summary-value">{types['duplicate_prospect'] || 0}</span>
            <span className="conf-summary-label">Duplicate Prospects</span>
          </div>
          <div className="conf-summary-cell">
            <span className="conf-summary-value">{types['multi_campaign_touch'] || 0}</span>
            <span className="conf-summary-label">Multi-Campaign Touch</span>
          </div>
          <div className="conf-summary-cell">
            <span className="conf-summary-value">{types['manual_review'] || 0}</span>
            <span className="conf-summary-label">Manual Review</span>
          </div>
        </div>
      )}

      {conflicts.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="No conflicts detected"
          message="Every prospect is being worked by one campaign at a time. Conflicts are detected before the first message goes out, not after, so this staying empty is the system doing its job."
        />
      ) : (
        <div className="conf-grid">
          {conflicts.map(c => {
            const campA = c.campaigns?.[0] || 'Campaign A';
            const campB = c.campaigns?.[1] || 'Campaign B';
            const type = c.type || c.conflict_type || 'manual_review';
            const rec = AI_RECOMMENDATIONS[type] || 'Review and resolve manually.';
            return (
              <div key={c.id} className="conf-card card">
                {/* Prospect */}
                <div className="conf-card__prospect">
                  <div className="conf-card__avatar">
                    {(c.prospect_name || 'P')[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="conf-card__name">{c.prospect_name}</div>
                    <div className="conf-card__type-badge">
                      {CONFLICT_TYPE_LABELS[type] || type}
                    </div>
                  </div>
                </div>

                {/* Campaign conflict visual */}
                <div className="conf-card__campaigns">
                  <div className="conf-card__campaign conf-card__campaign--a">
                    {campA}
                  </div>
                  <div className="conf-card__vs">
                    <ArrowUpDown size={14} style={{ color: 'var(--warning)' }} />
                  </div>
                  <div className="conf-card__campaign conf-card__campaign--b">
                    {campB}
                  </div>
                </div>

                {/* Last touch */}
                <div className="conf-card__meta">
                  <div className="conf-card__meta-row">
                    <span className="conf-card__meta-label">Last touch</span>
                    <span className="conf-card__meta-value">
                      {c.last_touch_channel
                        ? `${c.last_touch_channel} · ${timeAgo(c.last_touch)}`
                        : timeAgo(c.last_touch)}
                    </span>
                  </div>
                  <div className="conf-card__meta-row">
                    <span className="conf-card__meta-label">AI recommendation</span>
                    <span className="conf-card__meta-value conf-card__rec">{rec}</span>
                  </div>
                </div>

                <button
                  className="btn btn--secondary btn--sm conf-card__resolve-btn"
                  onClick={() => openDrawer(c)}
                >
                  Resolve conflict
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Resolution Drawer */}
      <Drawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        title="Resolve Conflict"
        width={480}
      >
        {drawer && (
          <div className="conf-drawer">
            <div className="conf-drawer__prospect">
              <div className="conf-card__avatar" style={{ width: 40, height: 40, fontSize: 16 }}>
                {(drawer.prospect_name || 'P')[0].toUpperCase()}
              </div>
              <div>
                <div className="conf-drawer__name">{drawer.prospect_name}</div>
                <div className="conf-drawer__sub">
                  {CONFLICT_TYPE_LABELS[drawer.type || drawer.conflict_type] || 'Conflict'}
                </div>
              </div>
            </div>

            {/* Campaigns */}
            <div className="conf-drawer-section">
              <div className="conf-drawer-section-label">Conflicting Campaigns</div>
              <div className="conf-drawer-campaigns">
                {(drawer.campaigns || []).map((camp, i) => (
                  <div key={i} className="conf-drawer-camp">
                    <div className="conf-drawer-camp__label">Campaign {i === 0 ? 'A' : 'B'}</div>
                    <div className="conf-drawer-camp__name">{camp}</div>
                    <div className="conf-drawer-camp__priority">
                      Priority: {i === 0 ? 'High' : 'Medium'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Context */}
            <div className="conf-drawer-section">
              <div className="conf-drawer-section-label">Context</div>
              <div className="conf-drawer-detail-row">
                <span>Last touch</span>
                <span>{drawer.last_touch_channel ? `${drawer.last_touch_channel} · ` : ''}{timeAgo(drawer.last_touch)}</span>
              </div>
              {drawer.next_action && (
                <div className="conf-drawer-detail-row">
                  <span>Next scheduled</span>
                  <span>{drawer.next_action}</span>
                </div>
              )}
              <div className="conf-drawer-detail-row">
                <span>Contact frequency</span>
                <span>{drawer.contact_count || '—'} touches</span>
              </div>
            </div>

            {/* Resolution options */}
            <div className="conf-drawer-section">
              <div className="conf-drawer-section-label">Resolution</div>
              <div className="conf-drawer-options">
                {RESOLUTION_OPTIONS.map(opt => (
                  <label key={opt.id} className={`conf-drawer-option ${resolution === opt.id ? 'conf-drawer-option--selected' : ''}`}>
                    <input
                      type="radio"
                      name="resolution"
                      value={opt.id}
                      checked={resolution === opt.id}
                      onChange={() => setResolution(opt.id)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
              <button className="btn btn--secondary" onClick={() => setDrawer(null)}>Cancel</button>
              <button
                className="btn btn--primary"
                onClick={handleResolve}
                disabled={resolving}
                style={{ flex: 1 }}
              >
                {resolving ? 'Resolving…' : 'Confirm Resolution'}
              </button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
