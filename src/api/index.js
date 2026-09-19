/**
 * API surface.
 *
 * One function per backend route. Every one hits the real API — if it fails,
 * it throws and the calling screen renders its error state. Nothing here falls
 * back to sample data.
 */
import { request, checkHealth, isApiConfigured, API_BASE_URL } from './client.js';

const qs = (params) => {
  const entries = Object.entries(params ?? {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

const api = {
  // ── system ──
  checkHealth,
  isApiConfigured,
  baseUrl: API_BASE_URL,
  getSchemaHealth: () => request('get', '/health/schema'),

  // ── campaigns ──
  getCampaigns: () => request('get', '/campaigns'),
  getCampaign: (id) => request('get', `/campaigns/${id}`),
  createCampaign: (data) => request('post', '/campaigns', data),
  updateCampaign: (id, data) => request('patch', `/campaigns/${id}`, data),
  setCampaignStatus: (id, status) => request('post', `/campaigns/${id}/status`, { status }),
  duplicateCampaign: (id, name) => request('post', `/campaigns/${id}/duplicate`, name ? { name } : null),
  runCampaign: (id, limit = 3, force = false) =>
    request('post', `/campaigns/${id}/run`, { limit, force }),

  getCampaignMetrics: (id) => request('get', `/campaigns/${id}/metrics`),
  getCampaignActivity: (id, limit) => request('get', `/campaigns/${id}/activity${qs({ limit })}`),
  getCampaignProspects: (id) => request('get', `/campaigns/${id}/prospects`),
  getAgentRuns: (campaignId) => request('get', `/campaigns/${campaignId}/agents`),

  // ── prompts ──
  getCampaignPrompts: (campaignId) => request('get', `/campaigns/${campaignId}/prompts`),
  createPromptVersion: (campaignId, data) => request('post', `/campaigns/${campaignId}/prompts`, data),
  activatePrompt: (promptId) => request('post', `/prompts/${promptId}/activate`),

  // ── prospects ──
  getAllProspects: (filters) => request('get', `/prospects${qs(filters)}`),
  getProspect: (id, campaignId) => request('get', `/prospects/${id}${qs({ campaignId })}`),
  advanceProspect: (id, campaignId, all = false) =>
    request('post', `/prospects/${id}/advance`, { campaign_id: campaignId, all }),
  sendReply: (id, payload) => request('post', `/prospects/${id}/reply`, payload),

  // ── escalations ──
  getEscalations: (status = 'pending') => request('get', `/escalations${qs({ status })}`),
  resolveEscalation: (id, action, extra = {}) =>
    request('post', `/escalations/${id}/resolve`, { action, ...extra }),

  // ── conflicts ──
  getConflicts: (status = 'pending') => request('get', `/conflicts${qs({ status })}`),
  resolveConflict: (id, payload) => request('post', `/conflicts/${id}/resolve`, payload),

  // ── attention ──
  getNeedsAttention: (limit = 12) => request('get', `/attention${qs({ limit })}`),

  // ── control ──
  getSystemControl: () => request('get', '/control'),
  toggleKillSwitch: (enabled) => request('post', '/control/kill', { enabled }),
  setChannelPause: (channel, paused) => request('post', '/control/channel', { channel, paused }),
  setAgentPause: (agent, paused) => request('post', '/control/agent', { agent, paused }),
  setWorker: (enabled) => request('post', '/control/worker', { enabled }),
  sweepWorker: () => request('post', '/control/worker/sweep'),

  // ── agents ──
  getGlobalAgents: () => request('get', '/agents'),
  getAgentPerformance: (campaignId) => request('get', `/agents/performance${qs({ campaignId })}`),
  getAgentRouting: () => request('get', '/agents/routing'),
  testAgent: (id, payload) => request('post', `/agents/${id}/test`, payload ? { payload } : {}),

  // ── metrics, costs, activity ──
  getGlobalMetrics: () => request('get', '/metrics/global'),
  getChannelMetrics: (campaignId) => request('get', `/metrics/channels${qs({ campaignId })}`),
  getAllActivity: (limit = 50) => request('get', `/activity${qs({ limit })}`),
  getCosts: () => request('get', '/costs'),

  // ── settings ──
  getReps: () => request('get', '/reps'),
  createRep: (data) => request('post', '/reps', data),
  updateRep: (id, data) => request('patch', `/reps/${id}`, data),
  assignRep: (id, campaignId, assigned) =>
    request('post', `/reps/${id}/assign`, { campaign_id: campaignId, assigned }),

  getSuppression: () => request('get', '/suppression'),
  addSuppression: (data) => request('post', '/suppression', data),
  removeSuppression: (id) => request('delete', `/suppression/${id}`),

  // ── knowledge ──
  getKnowledge: (campaignId) => request('get', `/knowledge${qs({ campaignId })}`),
  addKnowledge: (data) => request('post', '/knowledge', data),
  deleteKnowledge: (id) => request('delete', `/knowledge/${id}`),
  searchKnowledge: (payload) => request('post', '/knowledge/search', payload),
};

export default api;
