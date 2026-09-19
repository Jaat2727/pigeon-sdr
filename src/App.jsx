import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, isAuthConfigured, LOCAL_OPERATOR } from './supabaseClient';

import { AppProvider } from './context/AppContext';
import DashboardLayout from './layouts/DashboardLayout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CampaignsList from './pages/CampaignsList';
import CampaignDashboard from './pages/CampaignDashboard';
import CreateCampaign from './pages/CreateCampaign';
import Prospects from './pages/Prospects';
import ProspectDetail from './pages/ProspectDetail';
import Agents from './pages/Agents';
import Calls from './pages/Calls';
import Analytics from './pages/Analytics';
import Integrations from './pages/Integrations';
import Prompts from './pages/Prompts';
import ReviewQueue from './pages/ReviewQueue';
import Conflicts from './pages/Conflicts';
import KnowledgeBase from './pages/KnowledgeBase';
import Settings from './pages/Settings';

import './App.css';

function AuthenticatedApp({ user, onSignOut }) {
  return (
    <AppProvider>
      <DashboardLayout user={user} onSignOut={onSignOut}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />

          <Route path="/campaigns" element={<CampaignsList />} />
          <Route path="/campaigns/new" element={<CreateCampaign />} />
          <Route path="/campaigns/:id" element={<CampaignDashboard />} />
          <Route path="/campaigns/:id/edit" element={<CreateCampaign />} />
          <Route path="/campaigns/approvals" element={<Navigate to="/review-queue" replace />} />

          <Route path="/prospects" element={<Prospects />} />
          <Route path="/prospects/:id" element={<ProspectDetail />} />

          <Route path="/agents" element={<Agents />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/prompts" element={<Prompts />} />
          <Route path="/review-queue" element={<ReviewQueue />} />
          <Route path="/conflicts" element={<Conflicts />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/settings" element={<Settings />} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </DashboardLayout>
    </AppProvider>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  /**
   * With auth configured, the session is restored from storage and the login
   * screen guards the app. Without it, the app opens directly as a local
   * operator — the previous version hardcoded a signed-in user either way,
   * which made the login screen unreachable even when auth was configured.
   */
  useEffect(() => {
    let active = true;

    if (!isAuthConfigured) {
      setUser(LOCAL_OPERATOR);
      setCheckingSession(false);
      return () => { active = false; };
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data?.session?.user ?? null);
      setCheckingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setUser(session?.user ?? null);
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(isAuthConfigured ? null : LOCAL_OPERATOR);
  };

  if (checkingSession) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <span className="loading-text">Loading Pigeon SDR…</span>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {user ? (
          <Route path="/*" element={<AuthenticatedApp user={user} onSignOut={handleSignOut} />} />
        ) : (
          <>
            <Route path="/login" element={<Login onLoginSuccess={setUser} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
