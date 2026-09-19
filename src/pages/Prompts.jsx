import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import api from '../api/index.js';
import { LoadingState, ErrorState } from '../components/index.jsx';
import './Prompts.css';

/**
 * One tab per agent that has its own prompt. Ids match the server's agent
 * registry, which is what the versions are keyed on — the Outreach Strategy
 * tab was missing entirely, so its versions were unreachable from the UI.
 */
const AGENT_TABS = [
  { id: 'system',            label: 'System Prompt' },
  { id: 'research',          label: 'Research' },
  { id: 'icp_fitment',       label: 'ICP Fitment' },
  { id: 'outreach_strategy', label: 'Outreach Strategy' },
  { id: 'personalisation',   label: 'Personalisation' },
  { id: 'conversation',      label: 'Conversation' },
];

const STATUS_LABELS = {
  'active': 'Active',
  'draft': 'Draft',
  'rolled-back': 'Rolled Back',
  'archived': 'Archived',
};

export default function Prompts() {
  const { campaigns, addToast } = useApp();
  const [activeTab, setActiveTab] = useState('system');
  const [allVersions, setAllVersions] = useState([]); // all versions for current campaign
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const [selectedVersion, setSelectedVersion] = useState(null);
  const [compareSource, setCompareSource] = useState(null);
  const [compareTarget, setCompareTarget] = useState(null);

  // Campaign selector
  const [campaignId, setCampaignId] = useState('');

  // Init campaign selection
  useEffect(() => {
    if (campaigns.length > 0 && !campaignId) {
      setCampaignId(campaigns[0].id);
    }
  }, [campaigns, campaignId]);

  const campaignName = campaigns.find(c => c.id === campaignId)?.name || 'Loading...';

  const loadPrompts = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getCampaignPrompts(campaignId);
      // Sort reverse chronological
      data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Assign statuses based on active flag and order
      const enriched = data.map((v) => {
        let status = 'draft';
        if (v.is_active) status = 'active';
        else {
          // Find the active version for the same agent
          const activeForAgent = data.find(d => d.agent_name === v.agent_name && d.is_active);
          if (activeForAgent) {
            const activeDate = new Date(activeForAgent.created_at);
            const thisDate = new Date(v.created_at);
            status = thisDate < activeDate ? 'archived' : 'rolled-back';
          }
        }
        return { ...v, status };
      });

      setAllVersions(enriched);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadPrompts();
    // Reset selections when campaign changes
    setSelectedVersion(null);
    setCompareSource(null);
    setCompareTarget(null);
  }, [loadPrompts]);

  // Filter versions by active tab (agent_name)
  const versions = useMemo(() => {
    return allVersions.filter(v => v.agent_name === activeTab);
  }, [allVersions, activeTab]);

  // Auto-select comparison versions when tab changes
  useEffect(() => {
    if (versions.length > 0) {
      const active = versions.find(v => v.status === 'active') || versions[0];
      const prev = versions.find(v => v.id !== active.id) || active;
      setSelectedVersion(active.id);
      setCompareSource(prev.id);
      setCompareTarget(active.id);
    } else {
      setSelectedVersion(null);
      setCompareSource(null);
      setCompareTarget(null);
    }
  }, [versions]);

  const handleActivate = async (id) => {
    if (!id) return;
    setBusy(true);
    try {
      const activated = await api.activatePrompt(id);
      await loadPrompts();
      addToast({
        type: 'success',
        title: `v${activated.version} is now active`,
        message:
          `${AGENT_TABS.find(t => t.id === activeTab)?.label} runs on this version from the next agent call. ` +
          'Other campaigns are unaffected.',
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not activate that version', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Opens the editor seeded with the selected version's content. A new version
   * is saved inactive: editing a prompt must never silently change how a live
   * campaign behaves.
   */
  const handleSaveDraft = async () => {
    if (!campaignId || !draft.trim()) return;
    setBusy(true);
    try {
      const created = await api.createPromptVersion(campaignId, {
        agent_name: activeTab,
        content: draft,
      });
      setEditing(false);
      await loadPrompts();
      addToast({
        type: 'success',
        title: `Saved as v${created.version}`,
        message: 'Saved inactive. Activate it when you want agents to start using it.',
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not save the version', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (loading && allVersions.length === 0) return <LoadingState message="Loading prompts..." />;
  if (error) return <ErrorState message={error} onRetry={loadPrompts} />;

  const activeVersionInfo = versions.find(v => v.status === 'active');
  const sourceVersion = versions.find(v => v.id === compareSource);
  const targetVersion = versions.find(v => v.id === compareTarget);

  // Count versions per tab
  const tabCounts = {};
  AGENT_TABS.forEach(tab => {
    tabCounts[tab.id] = allVersions.filter(v => v.agent_name === tab.id).length;
  });

  return (
    <div className="prompts-page animate-in">
      {/* Header */}
      <div className="prompts-header">
        <h1>Prompt Versions & Rollback</h1>
        <div className="prompts-header-sub">
          <span>Campaign: </span>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            style={{
              background: 'var(--surface-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-input)', padding: '4px 8px',
              fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 600,
              color: 'var(--text-primary)', marginLeft: '4px', marginRight: '8px',
            }}
          >
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          · Review diffs and deploy prompt instructions.
        </div>
        <div className="prompts-header-actions">
          <div /> {/* spacer */}
          <button
            className="btn btn--primary"
            style={{ borderRadius: 'var(--radius-btn)' }}
            disabled={!campaignId}
            onClick={() => {
              const base = versions.find(v => v.id === compareTarget) ?? versions.find(v => v.status === 'active');
              setDraft(base?.content ?? '');
              setEditing(true);
            }}
          >
            <Plus size={16} /> New version
          </button>
        </div>
      </div>

      {/* Tab Bar — shows count per agent */}
      <div className="prompts-tabs">
        {AGENT_TABS.map(tab => (
          <button
            key={tab.id}
            className={`prompts-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tabCounts[tab.id] > 0 && (
              <span style={{ marginLeft: '6px', fontSize: '10px', opacity: 0.7 }}>({tabCounts[tab.id]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="prompts-body">
        {/* Left — Version History */}
        <div>
          <div className="prompts-history-title">Version History — {AGENT_TABS.find(t => t.id === activeTab)?.label}</div>
          <div className="prompts-history-list">
            {versions.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                No prompt versions for this agent yet.
              </div>
            ) : (
              versions.map(v => (
                <div
                  key={v.id}
                  className={`prompts-version-card ${selectedVersion === v.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedVersion(v.id);
                    setCompareSource(v.id);
                  }}
                >
                  <div className="prompts-version-top">
                    <span className="prompts-version-label">v{v.version}</span>
                    <span className={`pv-status pv-status--${v.status}`}>
                      {STATUS_LABELS[v.status]}
                    </span>
                  </div>
                  <div className="prompts-version-author">
                    by {v.author}<br />
                    {new Date(v.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right — Comparison */}
        {versions.length > 0 ? (
          <div className="prompts-compare">
            <div className="prompts-compare-header">
              <span className="prompts-compare-title">Comparing Prompt Versions</span>
              <div className="prompts-compare-selector">
                <span>Compare</span>
                <select value={compareSource || ''} onChange={(e) => setCompareSource(e.target.value)}>
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>v{v.version} ({STATUS_LABELS[v.status]})</option>
                  ))}
                </select>
                <span>with</span>
                <select value={compareTarget || ''} onChange={(e) => setCompareTarget(e.target.value)}>
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>v{v.version} ({STATUS_LABELS[v.status]})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Side-by-side diff */}
            <div className="prompts-diff-columns">
              {/* Source (left) */}
              <div className="prompts-diff-col">
                <div className="prompts-diff-col-header">
                  <div>
                    <div className="prompts-diff-col-title">
                      Version v{sourceVersion?.version} Prompt
                    </div>
                    <div className="prompts-diff-col-date">
                      {sourceVersion ? new Date(sourceVersion.created_at).toLocaleString() : ''}
                    </div>
                  </div>
                </div>
                <div className="prompts-diff-content">
                  {renderDiffContent(sourceVersion?.content, targetVersion?.content, 'source')}
                </div>
              </div>

              {/* Target (right) */}
              <div className="prompts-diff-col">
                <div className="prompts-diff-col-header">
                  <div>
                    <div className="prompts-diff-col-title">
                      Version v{targetVersion?.version} Prompt ({STATUS_LABELS[targetVersion?.status]})
                    </div>
                    <div className="prompts-diff-col-date">
                      {targetVersion ? new Date(targetVersion.created_at).toLocaleString() : ''}
                    </div>
                  </div>
                  {targetVersion?.status === 'active' && (
                    <span className="prompts-diff-col-badge">Active Agent Standard</span>
                  )}
                </div>
                <div className="prompts-diff-content">
                  {renderDiffContent(sourceVersion?.content, targetVersion?.content, 'target')}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="prompts-compare-footer">
              <span className="prompts-compare-footer-note">
                {activeVersionInfo
                  ? `The next agent run for this campaign uses v${activeVersionInfo.version}. Every run records which version produced it.`
                  : 'No version is active for this agent yet.'}
              </span>
              <div className="prompts-compare-footer-actions">
                <button
                  className="btn btn--secondary"
                  style={{ borderRadius: 'var(--radius-btn)' }}
                  onClick={() => { setDraft(targetVersion?.content ?? ''); setEditing(true); }}
                >
                  Edit as new version
                </button>
                {targetVersion && targetVersion.status !== 'active' && (
                  <button
                    className="btn btn--primary"
                    style={{ borderRadius: 'var(--radius-btn)' }}
                    disabled={busy}
                    onClick={() => handleActivate(targetVersion.id)}
                  >
                    {activeVersionInfo && activeVersionInfo.version > targetVersion.version
                      ? `Roll back to v${targetVersion.version}`
                      : `Activate v${targetVersion.version}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="prompts-compare" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
            <p style={{ maxWidth: 380, lineHeight: 1.6 }}>
              No prompt versions exist for this agent on this campaign yet. Use “New version” above to
              write one — it saves inactive, so nothing changes until you activate it.
            </p>
          </div>
        )}
      </div>

      {/* Editor */}
      {editing && (
        <div className="confirm-overlay" onClick={() => setEditing(false)}>
          <div
            className="confirm-dialog animate-in"
            style={{ maxWidth: 720, width: '92vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="confirm-dialog__title">
              New {AGENT_TABS.find(t => t.id === activeTab)?.label} version
            </h3>
            <p className="confirm-dialog__message">
              Saved inactive against “{campaignName}”. Activating it is a separate, deliberate step, and it
              affects this campaign only.
            </p>
            <textarea
              className="form-textarea"
              style={{ minHeight: 320, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="confirm-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSaveDraft} disabled={busy || !draft.trim()}>
                {busy ? 'Saving…' : 'Save version'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Simple diff renderer ── */
function renderDiffContent(sourceContent, targetContent, side) {
  if (side === 'source' && !sourceContent) return null;
  if (side === 'target' && !targetContent) return null;

  const content = side === 'source' ? sourceContent : targetContent;
  const lines = content.split('\n');
  const otherLines = (side === 'source' ? targetContent : sourceContent)?.split('\n') || [];

  return lines.map((line, i) => {
    const inOther = otherLines.includes(line);
    
    if (!inOther && side === 'source') {
      return <span key={i} className="diff-removed">- {line}</span>;
    }
    if (!inOther && side === 'target') {
      return <span key={i} className="diff-added">+ {line}</span>;
    }

    return <span key={i}>{line}{'\n'}</span>;
  });
}
