-- Add tracking columns for asynchronous DronaHQ webhooks
ALTER TABLE campaign_prospects
ADD COLUMN pending_agent_call TEXT,
ADD COLUMN pending_run_id TEXT,
ADD COLUMN pending_thread_id TEXT,
ADD COLUMN agent_fired_at TIMESTAMPTZ,
ADD COLUMN pending_payload JSONB;
