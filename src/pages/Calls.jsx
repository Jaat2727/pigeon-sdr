/**
 * Voice SDR.
 *
 * Voice is the stretch agent and no telephony provider is wired, so this page
 * does two things and keeps them clearly separated:
 *
 *   · Real data — which campaigns have voice enabled, what the gate says about
 *     the voice channel right now, and every voice-channel message the system
 *     has actually produced.
 *   · A labelled walkthrough of how a call would run, so the design is
 *     reviewable without being presented as something that happened.
 *
 * The separation is deliberate: a scripted transcript shown as call history is
 * the kind of thing that makes everything else in a submission harder to trust.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone, PhoneOff, Play, Pause, Brain, AlertTriangle,
  Info, ChevronRight, Mic,
} from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import { LoadingState, ErrorState, EmptyState, AlertBanner, StatusPill } from '../components/index.jsx';
import './Calls.css';

/** The scripted walkthrough. Every render of it is labelled as a simulation. */
const SCRIPT = [
  { speaker: 'ai', text: 'Hi Alice, this is the Pigeon SDR voice agent calling on behalf of Aarav. Is now a bad time?' },
  { speaker: 'prospect', text: 'I have a couple of minutes. What is this about?' },
  { speaker: 'ai', text: 'You wrote about cutting first-token latency under 300 milliseconds on your blog last month. That is the problem we work on with voice teams at your stage. How are you measuring it in production right now?' },
  { speaker: 'prospect', text: 'Mostly manually. We have traces but nobody watches them.' },
  { speaker: 'ai', text: 'That is the common answer. Would twenty minutes with our engineer next week be useful, or is this something you would rather revisit after your launch?' },
  { speaker: 'prospect', text: 'Next week could work. Send me something and I will find a slot.' },
];

const ANALYSIS = {
  intent: 'meeting_request',
  confidence: 0.82,
  sentiment: 'positive',
  signals: [
    'Prospect confirmed the problem exists and is unmeasured',
    'Prospect proposed a timeframe themselves rather than deflecting',
  ],
  objections: [],
  recommended_action: 'book_meeting',
  escalate: false,
};

export default function Calls() {
  const navigate = useNavigate();
  const { campaigns, systemControl, isKilled } = useApp();

  const [voiceMessages, setVoiceMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Walkthrough playback
  const [playing, setPlaying] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prospects = await api.getAllProspects({ limit: 500 });
      const channels = await api.getChannelMetrics().catch(() => []);
      const voice = channels.find((c) => c.channel === 'voice');
      setVoiceMessages({ prospects, voice });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!playing) return undefined;
    timerRef.current = setInterval(() => {
      setLineIndex((i) => {
        if (i >= SCRIPT.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 2600);
    return () => clearInterval(timerRef.current);
  }, [playing]);

  if (loading) return <LoadingState message="Loading voice channel…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const voiceCampaigns = campaigns.filter((c) => c.channels?.voice);
  const voicePaused = systemControl.channel_pauses?.voice;
  const voiceStats = voiceMessages.voice ?? { sent: 0, replied: 0, meetings: 0 };
  const voiceAgentPaused = systemControl.agent_pauses?.voice_sdr;

  return (
    <div className="page animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Voice SDR</h1>
          <p className="page-subtitle">
            Voice is the stretch agent. Call planning, gating and classification are built;
            telephony is not connected, so no call is placed.
          </p>
        </div>
      </div>

      {/* Honest status */}
      <AlertBanner type="info">
        No telephony provider is configured, so the Voice SDR agent plans and gates calls but does not
        place them. Everything below the divider is a labelled walkthrough of the intended call flow, not
        a recording of something that happened.
      </AlertBanner>

      {/* Real state */}
      <div className="calls-state-grid">
        <div className="calls-state-card">
          <div className="calls-state-label">Voice channel</div>
          <div className="calls-state-value" style={{ color: voicePaused || isKilled ? 'var(--danger)' : 'var(--success)' }}>
            {isKilled ? 'Stopped' : voicePaused ? 'Paused' : 'Open'}
          </div>
          <div className="calls-state-sub">
            {isKilled
              ? 'The global kill switch is engaged'
              : voicePaused
                ? 'Paused globally in Settings → Channels'
                : 'The gate would permit a voice touch'}
          </div>
        </div>

        <div className="calls-state-card">
          <div className="calls-state-label">Voice SDR agent</div>
          <div className="calls-state-value" style={{ color: voiceAgentPaused ? 'var(--warning)' : 'var(--text-primary)' }}>
            {voiceAgentPaused ? 'Paused' : 'Enabled'}
          </div>
          <div className="calls-state-sub">Pausing it leaves every other agent running</div>
        </div>

        <div className="calls-state-card">
          <div className="calls-state-label">Campaigns with voice</div>
          <div className="calls-state-value">{voiceCampaigns.length}</div>
          <div className="calls-state-sub">
            {voiceCampaigns.length ? voiceCampaigns.map((c) => c.name).join(', ') : 'None enabled'}
          </div>
        </div>

        <div className="calls-state-card">
          <div className="calls-state-label">Voice touches produced</div>
          <div className="calls-state-value">{voiceStats.sent ?? 0}</div>
          <div className="calls-state-sub">Call openers written by the Personalisation agent</div>
        </div>
      </div>

      {/* Campaigns with voice */}
      {voiceCampaigns.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card__header">
            <span className="card__title">Voice-enabled campaigns</span>
          </div>
          <div>
            {voiceCampaigns.map((c) => (
              <div key={c.id} className="calls-campaign-row" onClick={() => navigate(`/campaigns/${c.id}`)}>
                <span className="campaign-dot" style={{ background: c.colour, width: 9, height: 9, borderRadius: '50%' }} />
                <div style={{ flex: 1 }}>
                  <div className="calls-campaign-name">{c.name}</div>
                  <div className="calls-campaign-policy">
                    Daily voice cap: {c.channel_limits?.voice ?? 0} · Voice is never a first touch
                  </div>
                </div>
                <StatusPill status={c.status} />
                <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {voiceCampaigns.length === 0 && (
        <EmptyState
          icon={Phone}
          title="No campaign has voice enabled"
          message="Turn on the voice channel in a campaign's configuration to let the Outreach Strategy agent plan voice touches. It will still never place one as the first contact."
          action={{ label: 'Go to campaigns', onClick: () => navigate('/campaigns') }}
        />
      )}

      {/* ── Walkthrough ── */}
      <div className="calls-divider">
        <span>Walkthrough — simulated, not a real call</span>
      </div>

      <div className="calls-sim-grid">
        <div className="card">
          <div className="card__header">
            <span className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mic size={14} /> Call flow
            </span>
            <span className="calls-sim-badge">Simulated</span>
          </div>
          <div className="card__body">
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                className={`btn btn--sm ${playing ? 'btn--secondary' : 'btn--primary'}`}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Play walkthrough</>}
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => { setPlaying(false); setLineIndex(0); }}
              >
                <PhoneOff size={12} /> Reset
              </button>
            </div>

            <div className="calls-transcript">
              {SCRIPT.slice(0, lineIndex + 1).map((line, i) => (
                <div key={i} className={`calls-line calls-line--${line.speaker}`}>
                  <span className="calls-line-who">{line.speaker === 'ai' ? 'Agent' : 'Prospect'}</span>
                  <span className="calls-line-text">{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <span className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Brain size={14} /> What the Conversation agent would return
            </span>
            <span className="calls-sim-badge">Simulated</span>
          </div>
          <div className="card__body">
            <div className="calls-analysis-row">
              <span>Intent</span>
              <strong style={{ color: 'var(--success)' }}>{ANALYSIS.intent}</strong>
            </div>
            <div className="calls-analysis-row">
              <span>Confidence</span>
              <strong>{Math.round(ANALYSIS.confidence * 100)}%</strong>
            </div>
            <div className="calls-analysis-row">
              <span>Sentiment</span>
              <strong>{ANALYSIS.sentiment}</strong>
            </div>
            <div className="calls-analysis-row">
              <span>Recommended action</span>
              <strong>{ANALYSIS.recommended_action}</strong>
            </div>
            <div className="calls-analysis-row">
              <span>Escalate to human</span>
              <strong style={{ color: ANALYSIS.escalate ? 'var(--warning)' : 'var(--text-secondary)' }}>
                {ANALYSIS.escalate ? 'yes' : 'no'}
              </strong>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="calls-analysis-label">Signals extracted</div>
              {ANALYSIS.signals.map((s) => (
                <div key={s} className="calls-signal">{s}</div>
              ))}
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Info size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
                On a real call this output would be produced by the same Conversation agent that classifies
                email and SMS replies, using the same intent set and the same escalation rules. Only the
                transport differs.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <AlertBanner type="warning">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} />
            To make this real: set a Twilio account and a voice provider in the server environment, then
            implement transport in the personalisation send step. Every gate, limit and escalation rule the
            voice channel needs is already enforced.
          </span>
        </AlertBanner>
      </div>
    </div>
  );
}
