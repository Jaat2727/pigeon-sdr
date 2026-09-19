/**
 * Global application state.
 *
 * Holds the things every screen needs: the four stop controls, the campaign
 * list, the counts behind the sidebar badges, and the API connection status.
 *
 * Two behaviours worth knowing about:
 *
 *   · Connection is tracked explicitly. If the API is unreachable the app says
 *     so in a banner and screens render their error states. It never invents
 *     data to fill the gap.
 *   · The kill switch and campaign pause update optimistically and then
 *     reconcile with the server response, so a stop control feels immediate
 *     while still being the server's decision.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/index.js';

const AppContext = createContext(null);

const EMPTY_CONTROL = {
  kill_switch: false,
  channel_pauses: { email: false, linkedin: false, sms: false, voice: false },
  agent_pauses: {},
};

const EMPTY_METRICS = {
  live_campaigns: 0, total_campaigns: 0, active_prospects: 0, total_prospects: 0,
  qualified_prospects: 0, messages_sent: 0, replies: 0, meetings_booked: 0,
  pipeline_value: 0, agent_success_rate: 0, pending_approvals: 0, conflicts: 0,
};

const POLL_MS = 20000;

export function AppProvider({ children }) {
  // ── connection ──
  const [connection, setConnection] = useState({ status: 'checking', detail: null });

  // ── data ──
  const [systemControl, setSystemControl] = useState(EMPTY_CONTROL);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState(null);
  const [conflictsCount, setConflictsCount] = useState(0);
  const [escalationsCount, setEscalationsCount] = useState(0);
  const [prospectsCount, setProspectsCount] = useState(0);
  const [dailyCosts, setDailyCosts] = useState({ total_spend: 0, avg_latency_ms: 0, total_runs: 0, by_campaign: [] });
  const [globalMetrics, setGlobalMetrics] = useState(EMPTY_METRICS);
  const [needsAttention, setNeedsAttention] = useState({ items: [], summary: { total: 0 } });
  const [toasts, setToasts] = useState([]);

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const addToast = useCallback((toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      if (mounted.current) setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* ── loaders ────────────────────────────────────────────────────── */

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const data = await api.getCampaigns();
      if (mounted.current) setCampaigns(Array.isArray(data) ? data : []);
    } catch (err) {
      if (mounted.current) setCampaignsError(err.message);
    } finally {
      if (mounted.current) setCampaignsLoading(false);
    }
  }, []);

  const loadSystemControl = useCallback(async () => {
    try {
      const data = await api.getSystemControl();
      if (mounted.current) setSystemControl({ ...EMPTY_CONTROL, ...data });
    } catch {
      /* the connection banner already reports this */
    }
  }, []);

  const loadConflicts = useCallback(async () => {
    try {
      const data = await api.getConflicts();
      if (mounted.current) setConflictsCount(Array.isArray(data) ? data.length : 0);
    } catch { /* non-fatal */ }
  }, []);

  const loadEscalations = useCallback(async () => {
    try {
      const data = await api.getEscalations();
      if (mounted.current) setEscalationsCount(Array.isArray(data) ? data.length : 0);
    } catch { /* non-fatal */ }
  }, []);

  const loadGlobalMetrics = useCallback(async () => {
    try {
      const data = await api.getGlobalMetrics();
      if (mounted.current) {
        setGlobalMetrics({ ...EMPTY_METRICS, ...data });
        setProspectsCount(data.total_prospects ?? 0);
      }
    } catch { /* non-fatal */ }
  }, []);

  const loadDailyCosts = useCallback(async () => {
    try {
      const data = await api.getCosts();
      if (mounted.current) setDailyCosts(data);
    } catch { /* non-fatal */ }
  }, []);

  const loadNeedsAttention = useCallback(async () => {
    try {
      const data = await api.getNeedsAttention();
      if (mounted.current) setNeedsAttention(data ?? { items: [], summary: { total: 0 } });
    } catch { /* non-fatal */ }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadSystemControl(), loadCampaigns(), loadConflicts(), loadEscalations(),
      loadGlobalMetrics(), loadDailyCosts(), loadNeedsAttention(),
    ]);
  }, [
    loadSystemControl, loadCampaigns, loadConflicts, loadEscalations,
    loadGlobalMetrics, loadDailyCosts, loadNeedsAttention,
  ]);

  /* ── boot: confirm the API is reachable before loading anything ─── */

  const connect = useCallback(async () => {
    setConnection({ status: 'checking', detail: null });
    const health = await api.checkHealth();

    if (!mounted.current) return;

    if (health.ok) {
      setConnection({ status: 'connected', detail: health });
      await refreshAll();
      return;
    }

    setConnection({
      status: health.reason === 'not_configured' ? 'not_configured' : 'unreachable',
      detail: health,
    });
    setCampaignsLoading(false);
    setCampaignsError(
      health.message ?? 'The API is not reachable. Check the server and its CORS configuration.'
    );
  }, [refreshAll]);

  useEffect(() => { connect(); }, [connect]);

  // Light polling while connected, so the live feed and badge counts move
  // without the user reloading. Paused when the tab is hidden.
  useEffect(() => {
    if (connection.status !== 'connected') return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadEscalations();
        loadConflicts();
        loadGlobalMetrics();
        loadNeedsAttention();
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [connection.status, loadEscalations, loadConflicts, loadGlobalMetrics, loadNeedsAttention]);

  /* ── actions ────────────────────────────────────────────────────── */

  const toggleKillSwitch = useCallback(async (engaged) => {
    const previous = systemControl;
    setSystemControl((s) => ({ ...s, kill_switch: engaged }));
    try {
      const data = await api.toggleKillSwitch(engaged);
      setSystemControl({ ...EMPTY_CONTROL, ...data });
      await loadCampaigns();
      addToast({
        type: engaged ? 'warning' : 'success',
        title: engaged ? 'All activity stopped' : 'Activity resumed',
        message: engaged
          ? 'Every campaign, agent and channel is halted. Scheduled actions were cleared.'
          : 'Campaigns resume individually — set each one live when you are ready.',
      });
    } catch (err) {
      setSystemControl(previous);
      addToast({ type: 'error', title: 'Kill switch failed', message: err.message });
      throw err;
    }
  }, [systemControl, loadCampaigns, addToast]);

  const setChannelPause = useCallback(async (channel, paused) => {
    const previous = systemControl;
    setSystemControl((s) => ({ ...s, channel_pauses: { ...s.channel_pauses, [channel]: paused } }));
    try {
      const data = await api.setChannelPause(channel, paused);
      setSystemControl({ ...EMPTY_CONTROL, ...data });
      addToast({
        type: 'info',
        title: `${channel} ${paused ? 'paused' : 'resumed'}`,
        message: `The ${channel} channel is now ${paused ? 'paused' : 'active'} across every campaign.`,
      });
    } catch (err) {
      setSystemControl(previous);
      addToast({ type: 'error', title: 'Channel update failed', message: err.message });
      throw err;
    }
  }, [systemControl, addToast]);

  const setAgentPause = useCallback(async (agentKey, paused) => {
    const previous = systemControl;
    setSystemControl((s) => ({ ...s, agent_pauses: { ...s.agent_pauses, [agentKey]: paused } }));
    try {
      const data = await api.setAgentPause(agentKey, paused);
      setSystemControl({ ...EMPTY_CONTROL, ...data });
    } catch (err) {
      setSystemControl(previous);
      addToast({ type: 'error', title: 'Agent update failed', message: err.message });
      throw err;
    }
  }, [systemControl, addToast]);

  const setCampaignStatus = useCallback(async (id, status) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    try {
      const updated = await api.setCampaignStatus(id, status);
      setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      await loadGlobalMetrics();
    } catch (err) {
      await loadCampaigns();
      addToast({ type: 'error', title: 'Could not change campaign status', message: err.message });
      throw err;
    }
  }, [loadCampaigns, loadGlobalMetrics, addToast]);

  const liveCampaignCount = campaigns.filter((c) => c.status === 'live').length;

  const value = {
    // connection
    connection,
    isConnected: connection.status === 'connected',
    reconnect: connect,
    refreshAll,

    // system control
    systemControl,
    isKilled: systemControl.kill_switch,
    toggleKillSwitch,
    setChannelPause,
    setAgentPause,
    loadSystemControl,

    // campaigns
    campaigns,
    campaignsLoading,
    campaignsError,
    liveCampaignCount,
    setCampaignStatus,
    loadCampaigns,

    // counts
    conflictsCount,
    loadConflicts,
    escalationsCount,
    loadEscalations,
    prospectsCount,

    // metrics
    dailyCosts,
    loadDailyCosts,
    globalMetrics,
    loadGlobalMetrics,
    needsAttention,
    loadNeedsAttention,

    // toasts
    toasts,
    addToast,
    removeToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
