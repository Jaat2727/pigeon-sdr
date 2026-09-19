import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, ArrowUpDown, ChevronUp, ChevronDown, X, ChevronRight } from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import { LoadingState, ErrorState, Drawer } from '../components/index.jsx';
import './Prospects.css';

const STAGES = ['discovered','researched','qualified','contacted','engaged','meeting','opportunity'];

const STAGE_COLORS = {
  discovered:  '#6366F1',
  researched:  '#818CF8',
  qualified:   '#22C55E',
  contacted:   '#60A5FA',
  engaged:     '#F59E0B',
  meeting:     '#10B981',
  opportunity: '#8B5CF6',
};

const INTENT_LABELS = {
  high:   { label: 'High Intent',   color: 'var(--success)' },
  medium: { label: 'Moderate',      color: 'var(--warning)' },
  low:    { label: 'Low Intent',    color: 'var(--text-muted)' },
};

function ScorePill({ score }) {
  if (score == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const color = score >= 70 ? 'var(--success)' : score >= 45 ? 'var(--warning)' : 'var(--danger)';
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13,
      color, minWidth: 32, textAlign: 'right', display: 'inline-block',
    }}>{score}</span>
  );
}

function StagePill({ stage }) {
  const color = STAGE_COLORS[stage] || 'var(--text-muted)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 600, color,
      textTransform: 'capitalize',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {stage}
    </span>
  );
}

/** Declared at module scope: a component defined inside render remounts on
 *  every keystroke, which is what the hooks linter flags. */
function SortIcon({ field, active, dir }) {
  if (active !== field) return <ArrowUpDown size={11} style={{ opacity: 0.3 }} />;
  return dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />;
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const mins = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function Prospects() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { campaigns } = useApp();

  const [prospects, setProspects]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');
  const [sortField, setSortField]   = useState('fit_score');
  const [sortDir, setSortDir]       = useState('desc');
  const [drawer, setDrawer]         = useState(null);
  const [drawerData, setDrawerData] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const campaignFilter = searchParams.get('campaign') || '';
  const stageFilter    = searchParams.get('status') || '';
  const scoreFilter    = searchParams.get('score') || '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProspects(
        campaignFilter
          ? await api.getCampaignProspects(campaignFilter)
          : await api.getAllProspects()
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [campaignFilter]);

  useEffect(() => { load(); }, [load]);

  const openDrawer = async (p) => {
    setDrawer(p);
    setDrawerData(null);
    setDrawerLoading(true);
    try {
      setDrawerData(await api.getProspect(p.id, p.campaign_id));
    } catch {
      setDrawerData(p);
    } finally {
      setDrawerLoading(false);
    }
  };

  const getCampaignName = (id) => campaigns.find(c => c.id === id)?.name || id;

  /**
   * Clicking the active column flips direction; clicking a different one
   * switches to it descending. The previous version read `sortField` inside
   * the second state updater, which sees the value from before the first
   * updater ran, so the direction toggled a click late.
   */
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const setFilter = (key, val) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val); else next.delete(key);
    setSearchParams(next);
  };

  const clearFilters = () => setSearchParams({});
  const hasFilters   = campaignFilter || stageFilter || scoreFilter || search;

  const filtered = useMemo(() => {
    let list = [...prospects];
    if (stageFilter) list = list.filter(p => p.funnel_status === stageFilter);
    if (scoreFilter === 'high')   list = list.filter(p => (p.fit_score ?? 0) >= 70);
    if (scoreFilter === 'medium') list = list.filter(p => (p.fit_score ?? 0) >= 45 && (p.fit_score ?? 0) < 70);
    if (scoreFilter === 'low')    list = list.filter(p => (p.fit_score ?? 0) < 45);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
        p.company?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      let av, bv;
      if (sortField === 'name')     { av = `${a.first_name} ${a.last_name}`; bv = `${b.first_name} ${b.last_name}`; }
      else if (sortField === 'company') { av = a.company; bv = b.company; }
      else if (sortField === 'stage')   { av = a.funnel_status; bv = b.funnel_status; }
      else { av = a.fit_score ?? 0; bv = b.fit_score ?? 0; }
      if (typeof av === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [prospects, stageFilter, scoreFilter, search, sortField, sortDir]);

  if (loading) return <LoadingState message="Loading prospects…" />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  const p = drawerData || drawer;

  return (
    <div className="page animate-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Prospects</h1>
          <p className="page-subtitle">Find and manage high-intent prospects across all campaigns.</p>
        </div>
      </div>

      {/* Controls */}
      <div className="prospects-controls">
        <div className="topbar-search" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search prospects…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 200 }}
          />
        </div>

        {/* Campaign filter */}
        <select
          className="prospects-select"
          value={campaignFilter}
          onChange={e => setFilter('campaign', e.target.value)}
        >
          <option value="">All Campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Stage filter */}
        <select
          className="prospects-select"
          value={stageFilter}
          onChange={e => setFilter('status', e.target.value)}
        >
          <option value="">All Stages</option>
          {STAGES.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
        </select>

        {/* Score filter */}
        <select
          className="prospects-select"
          value={scoreFilter}
          onChange={e => setFilter('score', e.target.value)}
        >
          <option value="">All Scores</option>
          <option value="high">High (70+)</option>
          <option value="medium">Medium (45–69)</option>
          <option value="low">Low (&lt;45)</option>
        </select>

        {hasFilters && (
          <button className="btn btn--ghost btn--sm" onClick={clearFilters}>
            <X size={12} /> Clear
          </button>
        )}

        <span className="prospects-count">{filtered.length} prospects</span>
      </div>

      {/* Table */}
      <div className="card">
        <table className="campaigns-table">
          <thead>
            <tr>
              <th className="th-name" onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                Prospect <SortIcon field="name" active={sortField} dir={sortDir} />
              </th>
              <th onClick={() => handleSort('company')} style={{ cursor: 'pointer' }}>
                Company <SortIcon field="company" active={sortField} dir={sortDir} />
              </th>
              <th>Campaign</th>
              <th onClick={() => handleSort('stage')} style={{ cursor: 'pointer' }}>
                Stage <SortIcon field="stage" active={sortField} dir={sortDir} />
              </th>
              <th className="th-num" onClick={() => handleSort('fit_score')} style={{ cursor: 'pointer' }}>
                Score <SortIcon field="fit_score" active={sortField} dir={sortDir} />
              </th>
              <th>Intent</th>
              <th>Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const intent = p.intent_level || (p.fit_score >= 70 ? 'high' : p.fit_score >= 45 ? 'medium' : 'low');
              const ic = INTENT_LABELS[intent] || INTENT_LABELS.low;
              return (
                <tr
                  key={p.id}
                  onClick={() => openDrawer(p)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="td-name">
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>
                      {p.first_name} {p.last_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.email}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{p.company}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.role}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {p.campaign_name || getCampaignName(p.campaign_id)}
                    </span>
                  </td>
                  <td><StagePill stage={p.funnel_status} /></td>
                  <td className="td-num"><ScorePill score={p.fit_score} /></td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 600, color: ic.color }}>{ic.label}</span>
                  </td>
                  <td>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {timeAgo(p.last_activity || p.updated_at)}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: 13 }}>
                  No prospects match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Prospect Detail Drawer */}
      <Drawer open={!!drawer} onClose={() => setDrawer(null)} title="Prospect Profile" width={520}>
        {drawer && (
          <ProspectDrawer
            prospect={p}
            loading={drawerLoading}
            navigate={navigate}
            getCampaignName={getCampaignName}
          />
        )}
      </Drawer>
    </div>
  );
}

function ProspectDrawer({ prospect: p, loading, navigate, getCampaignName }) {
  if (loading || !p) {
    return <div className="state-box"><div className="spinner" /></div>;
  }

  const intent = p.intent_level || (p.fit_score >= 70 ? 'high' : p.fit_score >= 45 ? 'medium' : 'low');
  const ic = INTENT_LABELS[intent] || INTENT_LABELS.low;

  const signals = p.signals || [];
  const journey = STAGES;
  const currentIdx = journey.indexOf(p.funnel_status);

  const nextActions = {
    discovered:  'Research their LinkedIn and company news before outreach.',
    researched:  'Run ICP qualification check — prospects awaits scoring.',
    qualified:   'Launch personalized outreach sequence via Email + LinkedIn.',
    contacted:   'Follow up in 3 days if no reply is received.',
    engaged:     'Respond within 2 hours — high intent signals detected.',
    meeting:     'Send calendar invite and pre-meeting brief.',
    opportunity: 'Hand off to account executive for closing.',
  };

  return (
    <div className="prospect-drawer">
      {/* Header */}
      <div className="prospect-drawer__header">
        <div className="prospect-drawer__avatar">
          {(p.first_name || 'P')[0]}{(p.last_name || '')[0] || ''}
        </div>
        <div className="prospect-drawer__info">
          <div className="prospect-drawer__name">{p.first_name} {p.last_name}</div>
          <div className="prospect-drawer__role">{p.role}</div>
          <div className="prospect-drawer__company">{p.company}</div>
        </div>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => navigate(`/prospects/${p.id}`)}
          style={{ flexShrink: 0 }}
        >
          Full profile <ChevronRight size={12} />
        </button>
      </div>

      {/* Score + Intent */}
      <div className="prospect-drawer__scores">
        <div className="prospect-drawer__score-cell">
          <div className="prospect-drawer__score-val"
            style={{ color: p.fit_score >= 70 ? 'var(--success)' : p.fit_score >= 45 ? 'var(--warning)' : 'var(--danger)' }}>
            {p.fit_score ?? '—'}
          </div>
          <div className="prospect-drawer__score-label">ICP Score</div>
        </div>
        <div className="prospect-drawer__score-divider" />
        <div className="prospect-drawer__score-cell">
          <div className="prospect-drawer__score-val" style={{ color: ic.color }}>{ic.label}</div>
          <div className="prospect-drawer__score-label">Intent Level</div>
        </div>
        <div className="prospect-drawer__score-divider" />
        <div className="prospect-drawer__score-cell">
          <div className="prospect-drawer__score-val" style={{ textTransform: 'capitalize', fontSize: 14 }}>{p.funnel_status}</div>
          <div className="prospect-drawer__score-label">Current Stage</div>
        </div>
      </div>

      {/* AI Summary */}
      {p.fit_reason && (
        <div className="prospect-drawer__section">
          <div className="prospect-drawer__section-label">AI Summary</div>
          <div className="prospect-drawer__ai-summary">{p.fit_reason}</div>
        </div>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <div className="prospect-drawer__section">
          <div className="prospect-drawer__section-label">Signals Detected</div>
          <div className="prospect-drawer__signals">
            {signals.map((s, i) => (
              <span key={i} className="prospect-drawer__signal">{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Journey */}
      <div className="prospect-drawer__section">
        <div className="prospect-drawer__section-label">Prospect Journey</div>
        <div className="prospect-drawer__journey">
          {journey.map((stage, i) => {
            const done    = i < currentIdx;
            const active  = i === currentIdx;
            const color   = STAGE_COLORS[stage] || 'var(--text-muted)';
            return (
              <div key={stage} className="prospect-journey-step">
                <div
                  className="prospect-journey-dot"
                  style={{
                    background: done || active ? color : 'var(--border-strong)',
                    transform: active ? 'scale(1.3)' : 'scale(1)',
                    boxShadow: active ? `0 0 0 3px ${color}30` : 'none',
                  }}
                />
                <span className="prospect-journey-label" style={{
                  color: active ? color : done ? 'var(--text-secondary)' : 'var(--text-muted)',
                  fontWeight: active ? 700 : 400,
                }}>
                  {stage}
                </span>
                {i < journey.length - 1 && (
                  <div className="prospect-journey-connector"
                    style={{ background: done ? color : 'var(--border-strong)' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Campaign */}
      <div className="prospect-drawer__section">
        <div className="prospect-drawer__section-label">Campaign</div>
        <button
          className="btn btn--ghost btn--sm"
          style={{ fontSize: 12 }}
          onClick={() => navigate(`/campaigns/${p.campaign_id}`)}
        >
          {p.campaign_name || getCampaignName(p.campaign_id)} <ChevronRight size={11} />
        </button>
      </div>

      {/* Next action */}
      <div className="prospect-drawer__next-action">
        <div className="prospect-drawer__section-label" style={{ marginBottom: 6 }}>
          Recommended Next Action
        </div>
        <div className="prospect-drawer__recommendation">
          {nextActions[p.funnel_status] || 'Continue monitoring prospect signals.'}
        </div>
      </div>
    </div>
  );
}
