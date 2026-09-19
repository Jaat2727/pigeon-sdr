/**
 * Supabase auth client (browser).
 *
 * This is used for sign-in only. It never reads or writes application data —
 * prospects, campaigns and agent runs all go through the API, which holds the
 * service-role key server side. The browser only ever sees the anon key.
 *
 * Auth is optional. With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set, the
 * app requires a real sign-in. Without them it runs in open mode with a local
 * operator identity, so the deployed link can be opened and used directly.
 * Which mode is active is stated in the UI rather than left ambiguous.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isAuthConfigured = Boolean(
  url && anonKey && /^https:\/\/.+\.supabase\.co/.test(url)
);

export const LOCAL_OPERATOR = {
  id: 'local-operator',
  email: 'operator@pigeonsdr.local',
  user_metadata: { full_name: 'Operator' },
  is_local: true,
};

/**
 * In open mode this stands in for the auth client so no call site has to
 * branch on whether auth exists. Every method resolves; none of them pretend
 * a sign-in happened that did not.
 */
const openModeClient = {
  auth: {
    getSession: async () => ({ data: { session: { user: LOCAL_OPERATOR } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({
      data: null,
      error: new Error(
        'Sign-in is not available: this deployment has no Supabase auth configured. ' +
          'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts.'
      ),
    }),
    signUp: async () => ({
      data: null,
      error: new Error(
        'Sign-up is not available: this deployment has no Supabase auth configured.'
      ),
    }),
    signInWithOAuth: async () => ({
      data: null,
      error: new Error(
        'OAuth is not available: this deployment has no Supabase auth configured.'
      ),
    }),
    signOut: async () => ({ error: null }),
  },
};

export const supabase = isAuthConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : openModeClient;

export default supabase;
