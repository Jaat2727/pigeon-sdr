import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Megaphone, Users, Bot, Phone, BarChart3,
  BookOpen, Plug, Settings, ChevronRight, Bell, Search,
  MoreHorizontal, OctagonX, Play, Zap, LogOut, RefreshCw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ConfirmDialog, KillBanner, Toast, ConnectionBanner } from '../components/index.jsx';
import { isAuthConfigured } from '../supabaseClient';
import pigeonLogo from '../logo.png';
import './DashboardLayout.css';

// Primary nav items
const PRIMARY_NAV = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  {
    name: 'Campaigns', path: '/campaigns', icon: Megaphone,
    sub: [
      { name: 'All Campaigns', path: '/campaigns', exact: true },
      { name: 'Approvals', path: '/review-queue', badgeKey: 'review' },
      { name: 'Conflicts', path: '/conflicts', badgeKey: 'conflicts' },
      { name: 'Prompts', path: '/prompts' },
    ]
  },
  { name: 'Prospects', path: '/prospects', icon: Users },
  { name: 'Agents', path: '/agents', icon: Bot },
  { name: 'Calls', path: '/calls', icon: Phone },
  { name: 'Analytics', path: '/analytics', icon: BarChart3 },
];

const SECONDARY_NAV = [
  { name: 'Knowledge Base', path: '/knowledge', icon: BookOpen },
  { name: 'Integrations', path: '/integrations', icon: Plug },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export default function DashboardLayout({ children, user, onSignOut }) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isKilled, toggleKillSwitch,
    conflictsCount, escalationsCount, liveCampaignCount,
    dailyCosts, toasts, removeToast,
    connection, isConnected, reconnect, refreshAll,
  } = useApp();

  const displayName = user?.user_metadata?.full_name || user?.email || 'Operator';
  const avatarUrl =
    `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}` +
    '&background=4F46E5&color=fff&size=64&bold=true';

  // Which engine is actually serving the agents right now, from /health.
  const routing = connection.detail?.config?.agent_routing ?? null;
  const engineStatus = (() => {
    if (!isConnected) {
      return { label: 'API offline', colour: 'var(--text-muted)', title: 'The API is not reachable.' };
    }
    if (!routing) {
      return { label: 'Agent engine', colour: 'var(--text-muted)', title: 'Engine routing was not reported.' };
    }
    const engines = Object.values(routing);
    const onDronaHq = engines.filter((e) => e === 'dronahq').length;
    if (onDronaHq === engines.length) {
      return {
        label: 'DronaHQ · Agent Engine',
        colour: 'var(--success)',
        title: 'Every language agent is configured against a DronaHQ webhook.',
      };
    }
    if (onDronaHq === 0) {
      return {
        label: 'Local engine · no DronaHQ',
        colour: 'var(--warning)',
        title: 'No DronaHQ webhook is configured, so every agent runs on the local engine. Open Integrations for details.',
      };
    }
    return {
      label: `DronaHQ · ${onDronaHq}/${engines.length} agents`,
      colour: 'var(--warning)',
      title: `${engines.length - onDronaHq} agent(s) have no DronaHQ webhook and run on the local engine.`,
    };
  })();

  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [campaignsOpen, setCampaignsOpen] = useState(
    location.pathname.startsWith('/campaigns') ||
    location.pathname === '/review-queue' ||
    location.pathname === '/conflicts' ||
    location.pathname === '/prompts'
  );
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const getBadge = (key) => {
    switch (key) {
      case 'conflicts': return conflictsCount || null;
      case 'review': return escalationsCount || null;
      default: return null;
    }
  };

  return (
    <div className="sdr-shell">
      {/* ── Sidebar ── */}
      <aside className="sdr-sidebar">
        {/* Brand */}
        <div className="sidebar-brand" onClick={() => navigate('/dashboard')}>
          <div className="sidebar-logo">
            <img src={pigeonLogo} alt="Pigeon SDR" />
          </div>
          <span className="sidebar-wordmark">Pigeon SDR</span>
        </div>

        <nav className="sidebar-nav">
          {/* Primary nav */}
          <div className="nav-section">
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;

              if (item.sub) {
                const subActive = item.sub.some(s => location.pathname === s.path || location.pathname.startsWith(s.path));
                return (
                  <div key={item.path}>
                    <button
                      type="button"
                      className={`nav-item ${subActive ? 'active' : ''}`}
                      onClick={() => setCampaignsOpen(o => !o)}
                    >
                      <Icon size={17} className="nav-item-icon" />
                      <span className="nav-item-label">{item.name}</span>
                      {conflictsCount + escalationsCount > 0 && (
                        <span className="nav-item-badge nav-item-badge--danger">
                          {conflictsCount + escalationsCount}
                        </span>
                      )}
                      <ChevronRight size={13} className={`nav-chevron ${campaignsOpen ? 'open' : ''}`} />
                    </button>
                    <div className={`nav-subnav ${campaignsOpen ? 'open' : ''}`}>
                      {item.sub.map((sub) => {
                        const badge = getBadge(sub.badgeKey);
                        return (
                          <NavLink
                            key={sub.path}
                            to={sub.path}
                            className={({ isActive: ia }) =>
                              `nav-subitem ${ia || (sub.path === '/campaigns' && location.pathname === '/campaigns') ? 'active' : ''}`
                            }
                          >
                            <span style={{ flex: 1 }}>{sub.name}</span>
                            {badge !== null && (
                              <span className={`nav-item-badge nav-item-badge--${sub.badgeKey === 'conflicts' || sub.badgeKey === 'review' ? 'danger' : 'neutral'}`}>
                                {badge}
                              </span>
                            )}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive: ia }) => `nav-item ${ia ? 'active' : ''}`}
                >
                  <Icon size={17} className="nav-item-icon" />
                  <span className="nav-item-label">{item.name}</span>
                </NavLink>
              );
            })}
          </div>

          {/* Divider */}
          <div className="sidebar-divider" />

          {/* Secondary nav */}
          <div className="nav-section">
            <div className="nav-section-label">Tools</div>
            {SECONDARY_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive: ia }) => `nav-item ${ia ? 'active' : ''}`}
                >
                  <Icon size={17} className="nav-item-icon" />
                  <span className="nav-item-label">{item.name}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          {/* Engine status, read from the API rather than asserted. Claiming
              DronaHQ while every agent is on the local engine would be the
              first thing a reviewer catches. */}
          <div
            className="sidebar-engine-badge"
            style={{ marginBottom: '8px' }}
            title={engineStatus.title}
            onClick={() => navigate('/integrations')}
          >
            <div className="sidebar-engine-dot" style={{ background: engineStatus.colour }} />
            <span className="sidebar-engine-label">{engineStatus.label}</span>
            <Zap size={10} style={{ color: engineStatus.colour, marginLeft: 'auto' }} />
          </div>

          {/* User */}
          <div className="sidebar-user">
            <img src={avatarUrl} alt="" className="sidebar-user-avatar" />
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{displayName}</div>
              <div className="sidebar-user-team">
                {isAuthConfigured ? 'Signed in' : 'Open access mode'}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="sdr-main-wrapper">
        <ConnectionBanner connection={connection} onRetry={reconnect} />
        {isKilled && <KillBanner />}

        {/* Topbar */}
        <header className="sdr-topbar">
          {/* Search */}
          <div className="topbar-search">
            <Search size={14} color="var(--text-muted)" />
            <input type="text" placeholder="Search campaigns, prospects, agents…" />
            <span className="topbar-search-shortcut">⌘K</span>
          </div>

          <div className="topbar-right">
            {/* Live campaigns pill */}
            <div className={`topbar-live-pill ${liveCampaignCount > 0 ? 'has-live' : 'no-live'}`}>
              <div className={`topbar-live-dot ${liveCampaignCount > 0 ? 'pulsing' : ''}`} />
              {liveCampaignCount} Live
            </div>

            {/* Notifications */}
            <button className="topbar-icon-btn" title="Notifications">
              <Bell size={17} />
              {(conflictsCount + escalationsCount) > 0 && <span className="notification-dot" />}
            </button>

            {/* Global Kill Switch — persistent, always visible */}
            <button
              type="button"
              className={`topbar-kill-btn ${isKilled ? 'topbar-kill-btn--active' : ''}`}
              title={isKilled ? 'Resume all activity' : 'Global kill switch — stops everything'}
              disabled={!isConnected}
              onClick={() => {
                if (isKilled) {
                  toggleKillSwitch(false).catch(() => {});
                } else {
                  setShowKillConfirm(true);
                }
              }}
            >
              {isKilled
                ? <><Play size={14} /> Resume</>  
                : <><OctagonX size={14} /> Kill All</>
              }
            </button>

            {/* More menu — Settings only */}
            <div className="more-menu-wrapper">
              <button
                className="topbar-icon-btn"
                title="More options"
                onClick={() => setMoreMenuOpen(o => !o)}
              >
                <MoreHorizontal size={17} />
              </button>
              {moreMenuOpen && (
                <div className="more-menu-dropdown" onClick={() => setMoreMenuOpen(false)}>
                  <button className="more-menu-item" onClick={() => refreshAll()}>
                    <RefreshCw size={14} />
                    Refresh data
                  </button>
                  <button className="more-menu-item" onClick={() => navigate('/settings')}>
                    <Settings size={14} />
                    Settings
                  </button>
                  {isAuthConfigured && (
                    <button className="more-menu-item" onClick={() => onSignOut?.()}>
                      <LogOut size={14} />
                      Sign out
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Profile */}
            <div className="topbar-profile">
              <img src={avatarUrl} alt="" />
              <div className="topbar-profile-info">
                <span className="topbar-profile-name">{displayName}</span>
                <span className="topbar-profile-role">
                  {isAuthConfigured ? 'Signed in' : 'Open access'}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="sdr-main">
          {children}
        </main>

        {/* Status bar */}
        <div className="sdr-statusbar">
          <div className="sdr-statusbar-left">
            <span className="statusbar-indicator">
              <div
                className="statusbar-dot"
                style={{
                  background: !isConnected
                    ? 'var(--text-muted)'
                    : isKilled
                      ? 'var(--danger)'
                      : 'var(--success)',
                }}
              />
              {!isConnected ? 'API offline' : isKilled ? 'All activity stopped' : 'System normal'}
            </span>
            <span>Avg latency: {dailyCosts.avg_latency_ms || 0}ms</span>
            <span>Agent runs: {(dailyCosts.total_runs || 0).toLocaleString()}</span>
          </div>
          <div>
            Agent spend:{' '}
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              ${(dailyCosts.total_spend || 0).toFixed(4)}
            </span>
          </div>
        </div>
      </div>

      {/* Kill switch confirm dialog */}
      {showKillConfirm && (
        <ConfirmDialog
          title="Stop all autonomous activity?"
          message="Every campaign, agent and channel halts immediately and all scheduled actions are cleared. Prospect state and conversation history are kept, so nothing is lost. Campaigns are resumed one at a time afterwards."
          confirmLabel="Stop everything"
          onConfirm={() => { toggleKillSwitch(true).catch(() => {}); setShowKillConfirm(false); }}
          onCancel={() => setShowKillConfirm(false)}
          variant="danger"
        />
      )}

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 48, right: 24, zIndex: 1000,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {toasts.map(toast => (
            <Toast key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
