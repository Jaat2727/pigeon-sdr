-- Current Schema Dump (from OpenAPI spec)

CREATE TABLE campaigns (
  id uuid,
  name text,
  description text,
  colour text,
  status text,
  owner text,
  target_audience text,
  geography text[],
  target_roles text[],
  company_size text,
  industry text[],
  exclusion_criteria text,
  icp_criteria jsonb,
  sample_profiles jsonb,
  outreach_policy jsonb,
  messaging_policy jsonb,
  objective_and_policy jsonb,
  channels jsonb,
  channel_limits jsonb,
  agents jsonb,
  working_hours jsonb,
  approval_required boolean,
  prospect_source text,
  never_contact text[],
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE prospects (
  id uuid,
  first_name text,
  last_name text,
  email text,
  email_status text,
  phone text,
  phone_type text,
  linkedin_url text,
  title text,
  seniority text,
  department text,
  location text,
  timezone text,
  tenure_months integer,
  recent_activity text,
  previous_companies text[],
  company_name text,
  company_domain text,
  company_industry text,
  company_sub_industry text,
  company_employee_count integer,
  company_hq text,
  company_funding_stage text,
  company_last_funding_date date,
  company_description text,
  tech_stack text[],
  hiring_roles text[],
  recent_news text,
  intent_signals text[],
  provenance jsonb,
  sources text[],
  research_notes text,
  research_confidence text,
  fields_not_found text[],
  enriched_at timestamptz,
  enrichment_stale_after timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  enriched_data jsonb
);

CREATE TABLE campaign_prospects (
  id uuid,
  campaign_id uuid,
  prospect_id uuid,
  state text,
  fit_score integer,
  icp_verdict text,
  icp_confidence text,
  icp_result jsonb,
  sequence jsonb,
  current_step integer,
  next_action_at timestamptz,
  priority text,
  should_contact boolean,
  no_contact_reason text,
  last_touch_at timestamptz,
  total_touches integer,
  created_at timestamptz,
  updated_at timestamptz,
  pending_agent_call text,
  pending_run_id text,
  pending_thread_id text,
  agent_fired_at timestamptz,
  pending_payload jsonb
);

CREATE TABLE prompt_versions (
  id uuid,
  campaign_id uuid,
  agent_name text,
  version integer,
  content text,
  is_active boolean,
  author text,
  created_at timestamptz
);

CREATE TABLE agent_runs (
  id uuid,
  campaign_id uuid,
  prospect_id uuid,
  campaign_prospect_id uuid,
  agent_name text,
  engine text,
  prompt_version_id uuid,
  input_payload jsonb,
  output_payload jsonb,
  retrieved_chunks jsonb,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric,
  latency_ms integer,
  status text,
  error_message text,
  created_at timestamptz
);

CREATE TABLE activities (
  id uuid,
  campaign_id uuid,
  prospect_id uuid,
  agent_name text,
  prospect_name text,
  action text,
  outcome text,
  status text,
  metadata jsonb,
  created_at timestamptz
);

CREATE TABLE messages (
  id uuid,
  campaign_prospect_id uuid,
  prospect_id uuid,
  campaign_id uuid,
  direction text,
  channel text,
  step_number integer,
  subject text,
  body text,
  personalisation_used jsonb,
  knowledge_used jsonb,
  cta text,
  needs_human boolean,
  needs_human_reason text,
  intent text,
  intent_confidence text,
  sentiment text,
  extracted_facts jsonb,
  questions_asked jsonb,
  objections_raised jsonb,
  referral jsonb,
  is_auto_reply boolean,
  agent_run_id uuid,
  prompt_version_id uuid,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz
);

CREATE TABLE escalations (
  id uuid,
  campaign_id uuid,
  prospect_id uuid,
  campaign_prospect_id uuid,
  source_agent text,
  escalation_type text,
  reason text,
  proposed_action text,
  proposed_payload jsonb,
  status text,
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz
);

CREATE TABLE conflicts (
  id uuid,
  prospect_id uuid,
  campaign_ids uuid[],
  rule text,
  status text,
  resolved_campaign_id uuid,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz
);

CREATE TABLE suppression_list (
  id uuid,
  email text,
  domain text,
  phone text,
  reason text,
  added_by text,
  created_at timestamptz
);

CREATE TABLE reps (
  id uuid,
  full_name text,
  email text,
  title text,
  linkedin_url text,
  avatar_url text,
  is_active boolean,
  created_at timestamptz
);

CREATE TABLE campaign_reps (
  campaign_id uuid,
  rep_id uuid
);

CREATE TABLE system_control (
  id integer,
  kill_switch boolean,
  channel_pauses jsonb,
  updated_at timestamptz
);

