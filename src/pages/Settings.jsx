/**
 * Workspace settings.
 *
 * Everything on this screen reflects real state. The sections that used to
 * render hardcoded arrays — agents, integrations, the audit log — now read
 * from the API, because a settings page that shows six integrations as
 * "Connected" regardless of configuration is worse than no settings page.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Users, Radio, Bot, Shield, Plug,
  CreditCard, FileText, ChevronRight, Plus, Trash2, RefreshCw,
} from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import { ChannelRow, EngineBadge, AssumptionNote } from '../components/index.jsx';
import { isAuthConfigured } from '../supabaseClient';
import './Settings.css';

const NAV_ITEMS = [
  { id: 'workspace',    label: 'Workspace',           icon: Building2 },
  { id: 'channels',     label: 'Channels',            icon: Radio },
  { id: 'agents',       label: 'AI & Agents',         icon: Bot },
  { id: 'safety',       label: 'Safety & Guardrails', icon: Shield },
  { id: 'team',         label: 'Team & Roles',        icon: Users },
  { id: 'integrations', label: 'Integrations',        icon: Plug },
  { id: 'billing',      label: 'Usage & Spend',       icon: CreditCard },
  { id: 'audit',        label: 'Audit Log',           icon: FileText },
];

export default function Settings() {
  const { systemControl, setChannelPause, isKilled, dailyCosts, campaigns } = useApp();
  const [activeSection, setActiveSection] = useState('workspace');
  const [reps, setReps] = useState([]);
  const [suppression, setSuppression] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        api.getReps().catch(() => []),
        api.getSuppression().catch(() => []),
      ]);
      setReps(r);
      setSuppression(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Workspace Settings</h1>
          <p className="page-subtitle">Channels, agents, guardrails and the people whose identity outreach is sent under.</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`settings-nav-item ${activeSection === item.id ? 'settings-nav-item--active' : ''}`}
                onClick={() => setActiveSection(item.id)}
              >
                <Icon size={15} />
                <span>{item.label}</span>
                <ChevronRight size={12} className="settings-nav-chevron" />
              </button>
            );
          })}
        </nav>

        <div className="settings-panel">
          {activeSection === 'workspace' && <WorkspaceSection campaigns={campaigns} reps={reps} />}
          {activeSection === 'channels' && (
            <ChannelsSection
              systemControl={systemControl}
              isKilled={isKilled}
              setChannelPause={setChannelPause}
              campaigns={campaigns}
            />
          )}
          {activeSection === 'agents' && <AgentsSection />}
          {activeSection === 'safety' && (
            <SafetySection
              suppression={suppression}
              loading={loading}
              campaigns={campaigns}
              onChanged={load}
            />
          )}
          {activeSection === 'team' && <TeamSection reps={reps} loading={loading} onChanged={load} />}
          {activeSection === 'integrations' && <IntegrationsSection />}
          {activeSection === 'billing' && <BillingSection dailyCosts={dailyCosts} />}
          {activeSection === 'audit' && <AuditSection />}
        </div>
      </div>
    </div>
  );
}

/* ── Workspace ── */
function WorkspaceSection({ campaigns, reps }) {
  const live = campaigns.filter((c) => c.status === 'live').length;
  const channelsInUse = new Set();
  campaigns.forEach((c) => Object.entries(c.channels ?? {}).forEach(([k, v]) => v && channelsInUse.add(k)));

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Workspace</h2>
        <p className="settings-section-sub">Current configuration, read from the API.</p>
      </div>

      <div className="settings-overview-grid">
        <div className="settings-overview-card">
          <div className="settings-overview-label">Campaigns</div>
          <div className="settings-overview-value">{campaigns.length}</div>
          <div className="settings-overview-sub">{live} live right now</div>
        </div>
        <div className="settings-overview-card">
          <div className="settings-overview-label">Reps</div>
          <div className="settings-overview-value">{reps.length}</div>
          <div className="settings-overview-sub">{reps.filter((r) => r.is_active).length} active</div>
        </div>
        <div className="settings-overview-card">
          <div className="settings-overview-label">Channels in use</div>
          <div className="settings-overview-value">{channelsInUse.size}</div>
          <div className="settings-overview-sub" style={{ textTransform: 'capitalize' }}>
            {channelsInUse.size ? [...channelsInUse].join(' · ') : 'None configured'}
          </div>
        </div>
        <div className="settings-overview-card">
          <div className="settings-overview-label">Access</div>
          <div className="settings-overview-value" style={{ fontSize: 15 }}>
            {isAuthConfigured ? 'Authenticated' : 'Open'}
          </div>
          <div className="settings-overview-sub">
            {isAuthConfigured
              ? 'Supabase auth is configured and sign-in is required'
              : 'No auth configured — anyone with the link can use this workspace'}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Channels ── */
function ChannelsSection({ systemControl, isKilled, setChannelPause, campaigns }) {
  const usage = (channel) => campaigns.filter((c) => c.channels?.[channel]).length;

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Channels</h2>
        <p className="settings-section-sub">
          Pausing a channel here stops it across every campaign at once. Campaign-level channel
          configuration is separate and lives in each campaign's settings.
        </p>
      </div>
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="card__header"><span className="card__title">Global channel controls</span></div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {['email', 'linkedin', 'sms', 'voice'].map((ch) => (
            <div key={ch}>
              <ChannelRow
                channel={ch}
                isPaused={Boolean(systemControl.channel_pauses?.[ch])}
                disabled={isKilled}
                onToggle={(channel, paused) => setChannelPause(channel, paused).catch(() => {})}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 30, marginTop: -4 }}>
                Enabled in {usage(ch)} campaign{usage(ch) === 1 ? '' : 's'}
              </div>
            </div>
          ))}
        </div>
      </div>
      {isKilled && (
        <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 12 }}>
          The global kill switch overrides these. Release it before changing individual channels.
        </p>
      )}
    </div>
  );
}

/* ── Agents ── */
function AgentsSection() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setAgentPause, isKilled } = useApp();

  useEffect(() => {
    api.getGlobalAgents().then(setAgents).catch(() => setAgents([])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">AI & Agents</h2>
        <p className="settings-section-sub">
          Pausing an agent stops it across every campaign while the rest keep running.
        </p>
      </div>
      <div className="card" style={{ maxWidth: 620 }}>
        <div className="card__header"><span className="card__title">Agent configuration</span></div>
        {loading ? (
          <div className="card__body" style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          agents.map((a) => (
            <div key={a.key} className="settings-agent-row">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {a.name}
                  <EngineBadge engine={a.engine} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
                  {a.configured_engine === 'dronahq' && !a.dronahq_configured
                    ? 'No DronaHQ URL configured — running on the local engine'
                    : `${a.runs_total} run${a.runs_total === 1 ? '' : 's'} recorded` +
                      (a.degraded_runs ? `, ${a.degraded_runs} fell back to the local engine` : '')}
                </div>
              </div>
              <button
                className={`btn btn--sm ${a.paused ? 'btn--success' : 'btn--secondary'}`}
                disabled={isKilled}
                onClick={() => setAgentPause(a.key, !a.paused).then(() =>
                  setAgents((prev) => prev.map((x) => (x.key === a.key ? { ...x, paused: !a.paused } : x)))
                ).catch(() => {})}
              >
                {a.paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Safety ── */
function SafetySection({ suppression, loading, campaigns, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', domain: '', reason: '' });
  const { addToast } = useApp();

  const add = async () => {
    try {
      await api.addSuppression({
        email: form.email || null,
        domain: form.domain || null,
        reason: form.reason,
      });
      setForm({ email: '', domain: '', reason: '' });
      setAdding(false);
      onChanged();
      addToast({ type: 'success', title: 'Added to the suppression list' });
    } catch (err) {
      addToast({ type: 'error', title: 'Could not add entry', message: err.message });
    }
  };

  const remove = async (id) => {
    try {
      await api.removeSuppression(id);
      onChanged();
    } catch (err) {
      addToast({ type: 'error', title: 'Could not remove entry', message: err.message });
    }
  };

  const limits = campaigns.map((c) => ({
    name: c.name,
    daily: c.daily_limit ?? 50,
    channels: c.channel_limits ?? {},
  }));

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Safety & Guardrails</h2>
        <p className="settings-section-sub">
          These are enforced in the gate from the database before every outbound action, not by asking a
          model to remember them.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 660 }}>
        <div className="card">
          <div className="card__header"><span className="card__title">Enforced rules</span></div>
          <div className="card__body">
            {[
              ['Suppression list', 'Any match on email, phone or domain blocks all outreach'],
              ['Existing customers', 'Prospects flagged as customers are excluded entirely'],
              ['Cross-campaign cooldown', 'A prospect contacted by another campaign in the last 30 days is skipped'],
              ['Per-campaign daily cap', 'Counted from messages actually sent today, per campaign'],
              ['Per-channel daily cap', 'Counted separately for each channel'],
              ['Voice as first touch', 'Never permitted — voice is only planned after engagement'],
            ].map(([label, detail]) => (
              <div key={label} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__header"><span className="card__title">Daily limits by campaign</span></div>
          <div className="card__body">
            {limits.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No campaigns configured.</div>
            ) : (
              limits.map((l) => (
                <div key={l.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{l.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {l.daily}/day
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                      {' '}({Object.entries(l.channels).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ') || 'no channel caps'})
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <span className="card__title">Suppression list</span>
            <button className="btn btn--ghost btn--sm" onClick={() => setAdding((a) => !a)}>
              <Plus size={13} /> Add
            </button>
          </div>
          <div className="card__body">
            {adding && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <input className="form-input" placeholder="email@example.com" value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={{ flex: '1 1 180px' }} />
                <input className="form-input" placeholder="or a domain" value={form.domain}
                  onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))} style={{ flex: '1 1 140px' }} />
                <input className="form-input" placeholder="Reason" value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} style={{ flex: '1 1 160px' }} />
                <button className="btn btn--primary btn--sm" onClick={add}
                  disabled={!form.reason || (!form.email && !form.domain)}>
                  Save
                </button>
              </div>
            )}

            {loading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
            ) : suppression.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Nothing suppressed. Adding an entry blocks every campaign from contacting it immediately.
              </div>
            ) : (
              suppression.map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
                  <div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {s.email || s.domain || s.phone}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                      {s.email ? 'Email' : s.domain ? 'Domain' : 'Phone'} · added by {s.added_by ?? 'system'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.reason}</span>
                    <button className="btn btn--ghost btn--sm btn--icon" onClick={() => remove(s.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Team ── */
function TeamSection({ reps, loading, onChanged }) {
  const { addToast } = useApp();
  const [affected, setAffected] = useState(null);

  const toggleActive = async (rep) => {
    try {
      const res = await api.updateRep(rep.id, { is_active: !rep.is_active });
      onChanged();
      if (!rep.is_active === false && res.affected_campaigns?.length) {
        setAffected({ rep, campaigns: res.affected_campaigns });
      } else {
        addToast({ type: 'success', title: `${rep.full_name} ${rep.is_active ? 'deactivated' : 'reactivated'}` });
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Could not update rep', message: err.message });
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Team & Roles</h2>
        <p className="settings-section-sub">
          Outreach is sent under a rep's identity. Deactivating one surfaces every campaign it affects so
          an admin can reassign before anything else goes out.
        </p>
      </div>

      {affected && (
        <div className="card" style={{ maxWidth: 560, marginBottom: 16, borderColor: 'var(--warning-light)' }}>
          <div className="card__header"><span className="card__title">Reassignment needed</span></div>
          <div className="card__body" style={{ fontSize: 13 }}>
            <p style={{ marginTop: 0 }}>
              {affected.rep.full_name} was assigned to {affected.campaigns.length} campaign
              {affected.campaigns.length === 1 ? '' : 's'}:
            </p>
            {affected.campaigns.map((c) => (
              <div key={c.campaign_id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <strong>{c.campaign_name}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{c.campaign_status}</span>
              </div>
            ))}
            <button className="btn btn--secondary btn--sm" style={{ marginTop: 12 }} onClick={() => setAffected(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card__header"><span className="card__title">Members</span></div>
        <div className="card__body">
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
          ) : reps.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No reps configured yet.</div>
          ) : (
            reps.map((r) => (
              <div key={r.id} className="settings-member-row">
                <div className="settings-member-avatar">
                  {r.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{r.full_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {r.title ?? 'No title'} · {r.email} · {r.campaign_count ?? 0} campaign
                    {(r.campaign_count ?? 0) === 1 ? '' : 's'}
                  </div>
                </div>
                <button className="btn btn--ghost btn--sm" onClick={() => toggleActive(r)}>
                  {r.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Integrations ── */
function IntegrationsSection() {
  const navigate = useNavigate();
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Integrations</h2>
        <p className="settings-section-sub">
          Live connection status is on its own screen, where it is checked against the API rather than
          listed from memory.
        </p>
      </div>
      <button className="btn btn--primary" onClick={() => navigate('/integrations')}>
        Open Integrations <ChevronRight size={14} />
      </button>
    </div>
  );
}

/* ── Billing ── */
function BillingSection({ dailyCosts }) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Usage & Spend</h2>
        <p className="settings-section-sub">
          Counted from agent_runs. Cost is attributed per run from reported usage, or estimated from token
          count when the provider does not report it.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16, maxWidth: 620 }}>
        {[
          { label: 'Total agent spend', value: `$${(dailyCosts.total_spend ?? 0).toFixed(4)}` },
          { label: 'Spend today',       value: `$${(dailyCosts.spend_today ?? 0).toFixed(4)}` },
          { label: 'Average latency',   value: `${dailyCosts.avg_latency_ms ?? 0}ms` },
          { label: 'Total agent runs',  value: (dailyCosts.total_runs ?? 0).toLocaleString() },
          { label: 'Runs today',        value: (dailyCosts.runs_today ?? 0).toLocaleString() },
          { label: 'Tokens processed',  value: (dailyCosts.total_tokens ?? 0).toLocaleString() },
        ].map((m) => (
          <div key={m.label} className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              {m.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {dailyCosts.by_campaign?.length > 0 && (
        <div className="card" style={{ marginTop: 16, maxWidth: 620 }}>
          <div className="card__header"><span className="card__title">By campaign</span></div>
          <div className="card__body">
            {dailyCosts.by_campaign.map((c) => (
              <div key={c.campaign_id ?? 'unassigned'} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{c.campaign_name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  ${c.spend.toFixed(4)}{' '}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({c.runs} runs)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AssumptionNote>
        Runs served by the local engine are recorded at zero cost, because they make no external model call.
      </AssumptionNote>
    </div>
  );
}

/* ── Audit ── */
function AuditSection() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getAllActivity(100)
      .then((rows) => setLogs(rows.filter((r) => r.agent_key === 'system' || r.status === 'blocked')))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Audit Log</h2>
        <p className="settings-section-sub">
          Operator actions and blocked attempts, read from the activity log. Agent activity itself is on the
          dashboard feed.
        </p>
      </div>
      <button className="btn btn--secondary btn--sm" style={{ marginBottom: 14 }} onClick={load}>
        <RefreshCw size={13} /> Refresh
      </button>
      <div className="card" style={{ maxWidth: 680 }}>
        {loading ? (
          <div className="card__body" style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div className="card__body" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No operator actions recorded yet. Pausing a campaign, engaging the kill switch or resolving an
            approval will appear here.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {log.action}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{log.outcome}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {log.campaign_name && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{log.campaign_name}</div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {new Date(log.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
