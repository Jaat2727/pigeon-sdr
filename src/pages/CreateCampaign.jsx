import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Save, Rocket, Upload } from 'lucide-react';
import api from '../api/index.js';
import { useApp } from '../context/AppContext';
import {
  StepRail, Toggle, EngineBadge, StatTile, ConfirmDialog,
} from '../components/index.jsx';
import './CreateCampaign.css';

const STEPS = ['Identity', 'Targeting', 'Agents & Channels', 'Policies', 'Review'];

const AGENTS = [
  { key: 'research', name: 'Research & Enrichment', desc: 'Learns about the person and company from multiple sources.', engine: 'dronahq' },
  { key: 'icp_fitment', name: 'ICP Fitment', desc: 'Scores prospect fit and returns qualified/rejected with reason.', engine: 'dronahq' },
  { key: 'personalisation', name: 'Personalisation & Send', desc: 'Writes the message using research and sends it.', engine: 'dronahq' },
  { key: 'conversation', name: 'Conversation', desc: 'Reads replies, classifies intent and decides next action.', engine: 'dronahq' },
  { key: 'outreach_strategy', name: 'Outreach Strategy', desc: 'Picks the best channel and timing for each prospect.', engine: 'dronahq' },
  { key: 'followup_timing', name: 'Follow-up Timing', desc: 'Decides when to nudge or stop following up.', engine: 'our_engine' },
  { key: 'voice_sdr', name: 'Voice SDR (Stretch)', desc: 'Makes voice calls to qualified prospects.', engine: 'dronahq' },
];

const CHANNELS = [
  { key: 'email', name: 'Email' },
  { key: 'linkedin', name: 'LinkedIn' },
  { key: 'sms', name: 'SMS' },
  { key: 'voice', name: 'Voice' },
];

const COLOURS = ['#3B9AE1', '#4FBF92', '#D9A441', '#E05C5C', '#A78BFA', '#F472B6', '#38BDF8', '#FB923C'];

export default function CreateCampaign() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { loadCampaigns, isKilled, addToast } = useApp();
  const isEdit = !!id;

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [showGoLive, setShowGoLive] = useState(false);

  const [error, setError] = useState(null);

  const [form, setForm] = useState({
    name: '', description: '', owner: 'Operator', colour: COLOURS[0],
    target_audience: '', geography: '', target_roles: '', company_size: '', industry: '',
    never_contact: '', prospect_source: '',
    // These four drive the agents. Without them every agent reasons from an
    // empty policy, which is how a campaign ends up scoring everyone the same.
    icp_criteria: '', exclusion_criteria: '', research_focus: '',
    outreach_policy: '', messaging_policy: '',
    agents: { research: true, icp_fitment: true, outreach_strategy: true, personalisation: true, conversation: true, followup_timing: true, voice_sdr: false },
    channels: { email: true, linkedin: false, sms: false, voice: false },
    channel_limits: { email: 50, linkedin: 30, sms: 10, voice: 5 },
    daily_limit: 50,
    working_hours: { start: '09:00', end: '18:00', timezone: 'UTC' },
    approval_required: false,
  });

  // Load the existing campaign when editing.
  useEffect(() => {
    if (!isEdit) return;
    api.getCampaign(id)
      .then((c) => {
        setForm((prev) => ({
          ...prev,
          ...c,
          geography: (c.geography ?? []).join(', '),
          target_roles: (c.target_roles ?? []).join(', '),
          industry: (c.industry ?? []).join(', '),
          never_contact: (c.never_contact ?? []).join(', '),
        }));
      })
      .catch((err) => setError(err.message));
  }, [id, isEdit]);

  const updateForm = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateNested = (parent, key, value) =>
    setForm((prev) => ({ ...prev, [parent]: { ...prev[parent], [key]: value } }));

  /** Only the fields the API accepts — the rest are UI state. */
  const payload = () => ({
    name: form.name,
    description: form.description,
    colour: form.colour,
    owner: form.owner,
    target_audience: form.target_audience,
    geography: form.geography,
    target_roles: form.target_roles,
    company_size: form.company_size,
    industry: form.industry,
    never_contact: form.never_contact,
    prospect_source: form.prospect_source,
    icp_criteria: form.icp_criteria,
    exclusion_criteria: form.exclusion_criteria,
    research_focus: form.research_focus,
    outreach_policy: form.outreach_policy,
    messaging_policy: form.messaging_policy,
    agents: form.agents,
    channels: form.channels,
    channel_limits: form.channel_limits,
    daily_limit: form.daily_limit,
    working_hours: form.working_hours,
    approval_required: form.approval_required,
  });

  const handleSaveDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = isEdit
        ? await api.updateCampaign(id, { ...payload(), status: 'draft' })
        : await api.createCampaign({ ...payload(), status: 'draft' });
      await loadCampaigns();
      addToast({
        type: 'success',
        title: 'Draft saved',
        message: 'A draft is never permitted to send outreach. Go live when it is ready.',
      });
      if (!isEdit) navigate(`/campaigns/${saved.id}/edit`);
    } catch (err) {
      setError(err.message);
      addToast({ type: 'error', title: 'Could not save', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleGoLive = async () => {
    setSaving(true);
    setError(null);
    try {
      let campaignId = id;
      if (isEdit) {
        await api.updateCampaign(id, payload());
      } else {
        const created = await api.createCampaign({ ...payload(), status: 'draft' });
        campaignId = created.id;
      }
      await api.setCampaignStatus(campaignId, 'live');
      await loadCampaigns();
      addToast({
        type: 'success',
        title: 'Campaign is live',
        message: 'Its agents can now research, qualify and contact prospects. Pause it at any time.',
      });
      navigate(`/campaigns/${campaignId}`);
    } catch (err) {
      setError(err.message);
      addToast({ type: 'error', title: 'Could not go live', message: err.message });
    } finally {
      setSaving(false);
      setShowGoLive(false);
    }
  };

  // Validation. These are the fields without which the agents have nothing to
  // work from, not an arbitrary completeness check.
  const missingFields = [];
  if (!form.name) missingFields.push('campaign name');
  if (!form.target_audience) missingFields.push('target audience');
  if (!form.icp_criteria) missingFields.push('ICP criteria');
  if (!Object.values(form.channels).some((v) => v)) missingFields.push('at least one channel');
  if (!Object.values(form.agents).some((v) => v)) missingFields.push('at least one agent');
  const canGoLive = missingFields.length === 0;

  return (
    <div className="page animate-in">
      <div className="page-header">
        <div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/campaigns')} style={{ marginBottom: 'var(--sp-2)', marginLeft: '-12px' }}>
            <ArrowLeft size={14} /> Back
          </button>
          <h1 className="page-title">{isEdit ? 'Edit Campaign' : 'Create Campaign'}</h1>
          <p className="page-subtitle">Configure your autonomous sales workflow.</p>
        </div>
      </div>

      <StepRail steps={STEPS} currentStep={step} onStepClick={(s) => setStep(s)} />

      <div className="wizard-body">
        {/* Step 1: Identity */}
        {step === 1 && (
          <div className="wizard-step">
            <h2 className="wizard-step-title">Campaign Identity</h2>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Campaign Name *</label>
                <input className="form-input" value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="e.g. Enterprise HR Tech Outreach" />
              </div>
              <div className="form-group">
                <label className="form-label">Owner</label>
                <input className="form-input" value={form.owner} onChange={e => updateForm('owner', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" value={form.description} onChange={e => updateForm('description', e.target.value)} placeholder="What this campaign is about…" />
            </div>
            <div className="form-group">
              <label className="form-label">Campaign Colour</label>
              <div className="colour-picker">
                {COLOURS.map(c => (
                  <button key={c} type="button" className={`colour-swatch ${form.colour === c ? 'active' : ''}`} style={{ background: c }} onClick={() => updateForm('colour', c)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Targeting */}
        {step === 2 && (
          <div className="wizard-step">
            <h2 className="wizard-step-title">Targeting</h2>
            <div className="form-group">
              <label className="form-label">Ideal Customer Profile (free text) *</label>
              <textarea className="form-textarea" value={form.target_audience} onChange={e => updateForm('target_audience', e.target.value)} placeholder="Describe your ideal customer: role, seniority, company type, buying signals…" />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Geography tags</label>
                <input className="form-input" value={form.geography} onChange={e => updateForm('geography', e.target.value)} placeholder="US, UK, Germany…" />
              </div>
              <div className="form-group">
                <label className="form-label">Target Role tags</label>
                <input className="form-input" value={form.target_roles} onChange={e => updateForm('target_roles', e.target.value)} placeholder="VP Engineering, CTO, Head of AI…" />
              </div>
              <div className="form-group">
                <label className="form-label">Company Size</label>
                <input className="form-input" value={form.company_size} onChange={e => updateForm('company_size', e.target.value)} placeholder="200-2000" />
              </div>
              <div className="form-group">
                <label className="form-label">Industry</label>
                <input className="form-input" value={form.industry} onChange={e => updateForm('industry', e.target.value)} placeholder="SaaS, Fintech, Healthcare…" />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Never-contact tags</label>
                <input className="form-input" value={form.never_contact} onChange={e => updateForm('never_contact', e.target.value)} placeholder="competitor.com, government.gov…" />
              </div>
              <div className="form-group">
                <label className="form-label">Prospect Source</label>
                <input className="form-input" value={form.prospect_source} onChange={e => updateForm('prospect_source', e.target.value)} placeholder="LinkedIn Sales Nav, CSV upload…" />
              </div>
            </div>

            <h3 className="wizard-section-label">Qualification criteria</h3>
            <p className="wizard-section-help">
              The ICP agent scores against this text and rejects on the exclusions before it scores anything.
              Write them the way you would brief a new rep.
            </p>

            <div className="form-group">
              <label className="form-label">ICP criteria *</label>
              <textarea
                className="form-textarea"
                value={form.icp_criteria}
                onChange={e => updateForm('icp_criteria', e.target.value)}
                placeholder="Who qualifies, and what makes a strong signal. e.g. US-based CTOs at SaaS companies with 50 to 2000 employees, Series A or later. Strong signal if they are hiring engineers."
              />
            </div>

            <div className="form-group">
              <label className="form-label">Exclusion criteria</label>
              <textarea
                className="form-textarea"
                value={form.exclusion_criteria}
                onChange={e => updateForm('exclusion_criteria', e.target.value)}
                placeholder="Anything here is an immediate reject, checked before scoring. e.g. exclude agencies, consultancies and anyone outside the US."
              />
            </div>

            <div className="form-group">
              <label className="form-label">Research focus</label>
              <textarea
                className="form-textarea"
                value={form.research_focus}
                onChange={e => updateForm('research_focus', e.target.value)}
                placeholder="What the research agent should look hardest for. e.g. recent funding, engineering blog posts, open roles."
              />
            </div>
          </div>
        )}

        {/* Step 3: Agents & Channels */}
        {step === 3 && (
          <div className="wizard-step">
            <h2 className="wizard-step-title">Agents & Channels</h2>
            <h3 className="wizard-section-label">AI Agents</h3>
            <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
              {AGENTS.map(a => (
                <div key={a.key} className="agent-config-row">
                  <div className="agent-config-info">
                    <div className="agent-config-name">
                      {a.name}
                      <EngineBadge engine={a.engine} />
                    </div>
                    <p className="agent-config-desc">{a.desc}</p>
                  </div>
                  <Toggle on={form.agents[a.key]} onChange={v => updateNested('agents', a.key, v)} ariaLabel={`Toggle ${a.name}`} />
                </div>
              ))}
            </div>

            <h3 className="wizard-section-label">Channels</h3>
            <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
              {CHANNELS.map(ch => (
                <div key={ch.key} className="channel-row">
                  <span className="channel-row__name">{ch.name}</span>
                  <div className="channel-row__limit">
                    <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>Daily limit</span>
                    <input
                      type="number"
                      value={form.channel_limits[ch.key]}
                      onChange={e => updateNested('channel_limits', ch.key, parseInt(e.target.value) || 0)}
                      disabled={!form.channels[ch.key]}
                    />
                  </div>
                  <Toggle on={form.channels[ch.key]} onChange={v => updateNested('channels', ch.key, v)} ariaLabel={`Toggle ${ch.name}`} />
                </div>
              ))}
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Working Hours Start</label>
                <input className="form-input" type="time" value={form.working_hours.start} onChange={e => updateNested('working_hours', 'start', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Working Hours End</label>
                <input className="form-input" type="time" value={form.working_hours.end} onChange={e => updateNested('working_hours', 'end', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={form.approval_required} onChange={e => updateForm('approval_required', e.target.checked)} />
                Require human approval before sending
              </label>
            </div>
          </div>
        )}

        {/* Step 4: Policies */}
        {step === 4 && (
          <div className="wizard-step">
            <h2 className="wizard-step-title">Outreach & Messaging Policy</h2>
            <p className="wizard-section-help">
              These become the campaign-level instructions the Strategy and Personalisation agents run under.
              Per-agent prompts are versioned separately on the Prompts screen once the campaign exists, so
              you can diff, activate and roll them back without touching this.
            </p>

            <div className="form-group">
              <label className="form-label">Outreach policy</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: 130 }}
                value={form.outreach_policy}
                onChange={e => updateForm('outreach_policy', e.target.value)}
                placeholder="How many touches, on which channels, and how far apart. e.g. three to five touches across email and LinkedIn over eighteen days. Never open on voice."
              />
            </div>

            <div className="form-group">
              <label className="form-label">Messaging policy</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: 130 }}
                value={form.messaging_policy}
                onChange={e => updateForm('messaging_policy', e.target.value)}
                placeholder="Tone, length and hard rules. e.g. peer to peer, under 80 words, reference a real signal from research, one clear ask, no superlatives."
              />
            </div>

            <div className="form-group">
              <label className="form-label">Knowledge</label>
              <div className="drop-zone" style={{ cursor: 'default' }}>
                <Upload size={26} />
                <div className="drop-zone__title">Knowledge is added on the Knowledge Base screen</div>
                <div className="drop-zone__sub">
                  Agents retrieve from campaign-scoped chunks before writing anything customer-facing.
                  Add them after the campaign exists so they can be scoped to it.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <div className="wizard-step">
            <h2 className="wizard-step-title">Review & Go Live</h2>
            <div className="review-stats-grid">
              <StatTile label="Agents enabled" value={Object.values(form.agents).filter(v => v).length} sub="of 7" />
              <StatTile label="Channels active" value={Object.values(form.channels).filter(v => v).length} sub={Object.entries(form.channels).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'} />
              <StatTile label="Daily cap" value={form.daily_limit} sub="messages per day, enforced in the gate" />
              <StatTile label="Approval" value={form.approval_required ? 'Required' : 'Autonomous'} sub={form.approval_required ? 'every message is held for review' : 'agents send within policy'} />
            </div>

            <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
              <div className="card__header"><span className="card__title">What happens when this goes live</span></div>
              <div className="card__body">
                <ol className="review-steps-list">
                  <li>Prospects in this campaign become due, and the pipeline picks them up on the next run.</li>
                  <li>The Research agent enriches each profile, reporting any field it could not source rather than inventing one.</li>
                  <li>The ICP agent checks exclusions first, then scores. It returns qualify, reject or needs_review — anything it flags lands in the Approval Center.</li>
                  <li>The Strategy agent plans a sequence across {Object.entries(form.channels).filter(([, v]) => v).map(([k]) => k).join(', ') || 'your enabled channels'} and escalates the cases worth a human look.</li>
                  <li>The Personalisation agent writes each touch at send time, citing profile fields and knowledge chunks. With nothing specific to say it escalates rather than writing filler.</li>
                  <li>Replies are classified by the Conversation agent; opt-outs suppress the prospect everywhere immediately.</li>
                  <li>Every action is gated: the campaign status, the channel, the agent and the global kill switch are all checked before anything is sent.</li>
                </ol>
              </div>
            </div>

            {!canGoLive && (
              <div className="alert-banner alert-banner--warning" style={{ marginBottom: 'var(--sp-5)' }}>
                <span>Still needed before this can go live: {missingFields.join(', ')}.</span>
              </div>
            )}

            {error && (
              <div className="alert-banner alert-banner--danger" style={{ marginBottom: 'var(--sp-5)' }}>
                <span>{error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky Footer */}
      <div className="sticky-footer">
        <div>
          {step > 1 && (
            <button type="button" className="btn btn--secondary" onClick={() => setStep(s => s - 1)}>
              <ArrowLeft size={14} /> Back
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
          <button type="button" className="btn btn--ghost" onClick={handleSaveDraft} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save Draft'}
          </button>
          {step < 5 ? (
            <button type="button" className="btn btn--primary" onClick={() => setStep(s => s + 1)}>
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--success btn--lg"
              disabled={!canGoLive || isKilled}
              onClick={() => setShowGoLive(true)}
              title={!canGoLive ? `Missing: ${missingFields.join(', ')}` : isKilled ? 'Kill switch engaged' : 'Go live'}
            >
              <Rocket size={16} /> Go Live
            </button>
          )}
        </div>
      </div>

      {showGoLive && (
        <ConfirmDialog
          title="Launch campaign?"
          message={`"${form.name}" will start processing prospects and sending messages. You can pause at any time.`}
          confirmLabel="Go Live"
          onConfirm={handleGoLive}
          onCancel={() => setShowGoLive(false)}
          variant="primary"
        />
      )}
    </div>
  );
}
