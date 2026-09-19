/**
 * Knowledge Base.
 *
 * Shows the actual chunks agents retrieve from, not a list of file names. That
 * is the useful view: a manager asking "why did the agent say that" needs to
 * see the text that was retrieved, and the search box runs the same retrieval
 * the pipeline runs so the ranking is inspectable rather than asserted.
 */
import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Search, Plus, Trash2, Globe, Folder, X } from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import { LoadingState, ErrorState, EmptyState } from '../components/index.jsx';
import './KnowledgeBase.css';

const CHUNK_TYPES = [
  { id: 'product', label: 'Product' },
  { id: 'case_study', label: 'Case study' },
  { id: 'icp_definition', label: 'ICP definition' },
  { id: 'playbook', label: 'Sales playbook' },
  { id: 'objection_handling', label: 'Objection handling' },
  { id: 'example_email', label: 'Example message' },
  { id: 'brand_voice', label: 'Brand voice' },
  { id: 'competitor', label: 'Competitor' },
  { id: 'faq', label: 'FAQ' },
];

const typeLabel = (id) => CHUNK_TYPES.find((t) => t.id === id)?.label ?? id;

export default function KnowledgeBase() {
  const { campaigns, addToast } = useApp();

  const [campaignId, setCampaignId] = useState('');
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  // Retrieval preview
  const [query, setQuery] = useState('');
  const [retrieved, setRetrieved] = useState(null);
  const [retrieving, setRetrieving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChunks(await api.getKnowledge(campaignId || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    try {
      await api.deleteKnowledge(id);
      setChunks((prev) => prev.filter((c) => c.id !== id));
      addToast({ type: 'success', title: 'Knowledge chunk removed' });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not remove it', message: err.message });
    }
  };

  const runRetrieval = async () => {
    if (!query.trim()) return;
    setRetrieving(true);
    try {
      setRetrieved(
        await api.searchKnowledge({ campaign_id: campaignId || null, query, agent: 'personalisation' })
      );
    } catch (err) {
      addToast({ type: 'error', title: 'Retrieval failed', message: err.message });
    } finally {
      setRetrieving(false);
    }
  };

  const filtered = chunks.filter((c) => {
    if (typeFilter && c.type !== typeFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return `${c.title} ${c.content} ${c.type}`.toLowerCase().includes(q);
  });

  const globalChunks = filtered.filter((c) => c.scope === 'global');
  const campaignChunks = filtered.filter((c) => c.scope === 'campaign');

  if (loading) return <LoadingState message="Loading knowledge base…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="page animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Knowledge Base</h1>
          <p className="page-subtitle">
            What agents retrieve from before they write anything customer-facing.
            {' '}{chunks.length} chunk{chunks.length === 1 ? '' : 's'} indexed.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowAdd(true)}>
          <Plus size={15} /> Add knowledge
        </button>
      </div>

      {/* Controls */}
      <div className="kb-controls">
        <div className="topbar-search" style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Filter chunks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 200 }}
          />
        </div>

        <select className="prospects-select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">Global only</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select className="prospects-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {CHUNK_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Retrieval preview */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__header">
          <span className="card__title">Retrieval preview</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Runs the same lexical ranking the pipeline uses before a message is written
          </span>
        </div>
        <div className="card__body">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              placeholder="e.g. they just raised a Series B and are hiring engineers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runRetrieval()}
              style={{ flex: 1 }}
            />
            <button className="btn btn--secondary" onClick={runRetrieval} disabled={retrieving || !query.trim()}>
              {retrieving ? 'Retrieving…' : 'Retrieve'}
            </button>
          </div>

          {retrieved && (
            <div style={{ marginTop: 14 }}>
              {retrieved.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Nothing matched. The agent would run without retrieved context for this query, which is
                  when it sets needs_human rather than writing unsourced claims.
                </p>
              ) : (
                retrieved.map((r, i) => (
                  <div key={r.id} className="kb-retrieved-row">
                    <span className="kb-retrieved-rank">{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div className="kb-retrieved-title">{r.title}</div>
                      <div className="kb-retrieved-body">{r.content.slice(0, 180)}…</div>
                    </div>
                    <span className="kb-retrieved-score">{r.score.toFixed(3)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {chunks.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge indexed yet"
          message="Agents retrieve from this corpus before writing anything customer-facing. Without it they have nothing to cite, so they escalate instead of inventing claims."
          action={{ label: 'Add the first chunk', onClick: () => setShowAdd(true) }}
        />
      ) : (
        <>
          {campaignId && (
            <ChunkSection
              icon={Folder}
              title="Campaign knowledge"
              subtitle="Only this campaign's agents retrieve these"
              chunks={campaignChunks}
              onDelete={handleDelete}
            />
          )}
          <ChunkSection
            icon={Globe}
            title="Global knowledge"
            subtitle="Every campaign retrieves from these"
            chunks={globalChunks}
            onDelete={handleDelete}
          />
        </>
      )}

      {showAdd && (
        <AddKnowledgeDialog
          campaigns={campaigns}
          defaultCampaignId={campaignId}
          onClose={() => setShowAdd(false)}
          onSaved={(chunk) => {
            setChunks((prev) => [chunk, ...prev]);
            setShowAdd(false);
            addToast({ type: 'success', title: 'Knowledge added', message: 'Agents can retrieve it on the next run.' });
          }}
        />
      )}
    </div>
  );
}

function ChunkSection({ icon: Icon, title, subtitle, chunks, onDelete }) {
  if (!chunks.length) return null;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card__header">
        <span className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={14} /> {title}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>({chunks.length})</span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</span>
      </div>
      <div>
        {chunks.map((c) => (
          <div key={c.id} className="kb-chunk-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="kb-chunk-head">
                <span className="kb-chunk-title">{c.title}</span>
                <span className="kb-chunk-type">{typeLabel(c.type)}</span>
                <span className="kb-chunk-words">{c.word_count} words</span>
              </div>
              <p className="kb-chunk-excerpt">{c.excerpt}</p>
            </div>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              title="Remove this chunk"
              onClick={() => onDelete(c.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddKnowledgeDialog({ campaigns, defaultCampaignId, onClose, onSaved }) {
  const [form, setForm] = useState({
    campaign_id: defaultCampaignId || '',
    type: 'product',
    title: '',
    content: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      onSaved(
        await api.addKnowledge({
          campaign_id: form.campaign_id || null,
          type: form.type,
          title: form.title || null,
          content: form.content,
        })
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-dialog animate-in" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 className="confirm-dialog__title">Add knowledge</h3>
          <button className="btn btn--ghost btn--sm btn--icon" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="confirm-dialog__message" style={{ marginBottom: 14 }}>
          Paste the text agents should be able to cite. Keep one idea per chunk — retrieval ranks
          chunks, so a single long document competes with itself.
        </p>

        <div className="form-grid-2" style={{ marginBottom: 12 }}>
          <div className="form-group">
            <label className="form-label">Scope</label>
            <select
              className="form-input"
              value={form.campaign_id}
              onChange={(e) => setForm((f) => ({ ...f, campaign_id: e.target.value }))}
            >
              <option value="">Global — every campaign</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select
              className="form-input"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              {CHUNK_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Title</label>
          <input
            className="form-input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Short label shown beside the message that used it"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Content</label>
          <textarea
            className="form-textarea"
            style={{ minHeight: 150 }}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="The text an agent may cite."
          />
        </div>

        {err && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{err}</p>}

        <div className="confirm-dialog__actions">
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={saving || !form.content.trim()}>
            {saving ? 'Saving…' : 'Add chunk'}
          </button>
        </div>
      </div>
    </div>
  );
}
