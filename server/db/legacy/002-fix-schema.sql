-- Campaign-level configuration
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS icp_criteria        text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS exclusion_criteria  text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS research_focus      text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS outreach_policy     text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS messaging_policy    text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS enabled_channels    jsonb   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS daily_limit         integer DEFAULT 50;

-- Drives the worker
ALTER TABLE campaign_prospects
  ADD COLUMN IF NOT EXISTS next_action_at  timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS outreach_plan   jsonb,
  ADD COLUMN IF NOT EXISTS current_step    integer     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS icp_result      jsonb,
  ADD COLUMN IF NOT EXISTS latest_reply    text;

-- Existing rows have NULL and would never match .lte(), so backfill.
UPDATE campaign_prospects SET next_action_at = now()
  WHERE next_action_at IS NULL;

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS enriched_data   jsonb,
  ADD COLUMN IF NOT EXISTS enriched_at     timestamptz;

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS tokens_used     integer,
  ADD COLUMN IF NOT EXISTS cost_usd        numeric(10,6),
  ADD COLUMN IF NOT EXISTS retrieved_chunk_ids jsonb DEFAULT '[]'::jsonb;

-- Knowledge chunks does not exist, so we create it
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL,
  type         text NOT NULL,
  content      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- messages table already exists, skipping create.

ALTER TABLE system_control
  ADD COLUMN IF NOT EXISTS agent_pauses   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS channel_pauses jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Missing columns for UI rendering
ALTER TABLE escalations
  ADD COLUMN IF NOT EXISTS prospect_name text,
  ADD COLUMN IF NOT EXISTS campaign_name text,
  ADD COLUMN IF NOT EXISTS risk_level text;

ALTER TABLE conflicts
  ADD COLUMN IF NOT EXISTS prospect_name text,
  ADD COLUMN IF NOT EXISTS last_touch timestamptz,
  ADD COLUMN IF NOT EXISTS last_touch_channel text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS contact_count integer;

CREATE INDEX IF NOT EXISTS cp_campaign_state_idx
  ON campaign_prospects (campaign_id, state);
CREATE INDEX IF NOT EXISTS cp_next_action_idx
  ON campaign_prospects (next_action_at);
CREATE INDEX IF NOT EXISTS agent_runs_prospect_idx
  ON agent_runs (prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_campaign_idx
  ON agent_runs (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_campaign_type_idx
  ON knowledge_chunks (campaign_id, type);
