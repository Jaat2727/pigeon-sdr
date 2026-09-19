/**
 * HTTP client.
 *
 * The backend is the only source of truth. There is no mock fallback: an app
 * that quietly swaps in fabricated data when the API is down looks like it is
 * working when it is not, and that is worse than an error message. When a call
 * fails, the failure reaches the screen.
 *
 * VITE_API_BASE_URL must be set at build time. Vite inlines it, so changing it
 * on Vercel requires a redeploy, not just an environment save.
 */
import axios from 'axios';

const RAW_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// Trailing slashes produce '//campaigns', which some hosts 301 and browsers
// then re-send as GET, breaking POSTs.
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '');

export const isApiConfigured = Boolean(API_BASE_URL);

if (!isApiConfigured) {
  console.error(
    '[api] VITE_API_BASE_URL is not set. The app has no backend to talk to. ' +
      'Set it in .env for local development, or in the Vercel project settings and redeploy.'
  );
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('pigeon_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Turns an axios failure into an Error whose message is worth showing a user.
 * The server sends `{ error, message }`; a network failure sends nothing at
 * all, and the two need different wording.
 */
function toFriendlyError(err, method, url) {
  const status = err.response?.status;
  const payload = err.response?.data;

  let message;
  if (!isApiConfigured) {
    message =
      'No backend URL is configured. Set VITE_API_BASE_URL and redeploy the frontend.';
  } else if (err.code === 'ECONNABORTED') {
    message = `The request to ${url} timed out. The API may be starting up — try again in a moment.`;
  } else if (!err.response) {
    message =
      `Could not reach the API at ${API_BASE_URL}. Check that the server is running and that ` +
      'this site\'s origin is listed in the server\'s CORS_ORIGINS.';
  } else if (status === 503 && payload?.error === 'database_not_configured') {
    message =
      'The API is running but has no database credentials. Set SUPABASE_URL and ' +
      'SUPABASE_SERVICE_ROLE_KEY on the server.';
  } else if (payload?.message) {
    message = payload.message;
  } else {
    message = `${method.toUpperCase()} ${url} failed with HTTP ${status}`;
  }

  const wrapped = new Error(message);
  wrapped.status = status ?? null;
  wrapped.code = payload?.error ?? err.code ?? 'network_error';
  wrapped.details = payload?.details ?? null;
  wrapped.url = url;
  return wrapped;
}

export async function request(method, url, data = null, config = {}) {
  if (!isApiConfigured) {
    throw toFriendlyError({ response: null, code: 'not_configured' }, method, url);
  }
  try {
    const res = await apiClient({ method, url, data, ...config });
    return res.data;
  } catch (err) {
    throw toFriendlyError(err, method, url);
  }
}

/** Liveness probe used by the connection banner. Never throws. */
export async function checkHealth() {
  if (!isApiConfigured) {
    return { ok: false, reason: 'not_configured', message: 'VITE_API_BASE_URL is not set.' };
  }
  try {
    const res = await apiClient.get('/health', { timeout: 12000 });
    return { ok: res.data?.status === 'ok', ...res.data };
  } catch (err) {
    return {
      ok: false,
      reason: err.response ? 'error' : 'unreachable',
      message: err.response?.data?.message ?? err.message,
      ...(err.response?.data ?? {}),
    };
  }
}

export default apiClient;
