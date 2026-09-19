-- ===========================================================================
-- Pigeon SDR · migration 004
--
-- Safe to run on a live database and safe to run more than once.
--
--   · Every table is CREATE TABLE IF NOT EXISTS, so a fresh Supabase project
--     gets the full schema from this one file.
--   · Every column is ADD COLUMN IF NOT EXISTS, so an existing database only
--     gains what it is missing.
--   · Nothing is dropped, nothing is renamed, no column type is altered. A
--     column that already exists with a different type keeps that type, and
--     the API reads both shapes.
--
-- Run it in the Supabase SQL editor, then open /health/schema on the API to
-- confirm every table is present.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Primary keys.
--
-- The schema this project grew from was reconstructed from an OpenAPI dump, so
-- several tables have an `id` column with no primary key on it. That is not
-- cosmetic: without a unique constraint, `ON CONFLICT` is rejected outright and
-- no foreign key can point at the table. This block adds the missing keys where
-- it is safe to, and says so in a notice where it is not (duplicate or null ids
-- are a data problem to look at, not something a migration should silently
-- resolve).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  dup_count bigint;
begin
  foreach t in array array[
    'campaigns', 'prospects', 'campaign_prospects', 'prompt_versions',
    'agent_runs', 'activities', 'messages', 'escalations', 'conflicts',
    'suppression_list', 'reps', 'system_control'
  ]
  loop
    -- Skip tables that do not exist yet; they are created below with a key.
    if to_regclass(t) is null then
      continue;
    end if;

    -- Skip tables that already have a primary key.
    if exists (
      select 1 from pg_constraint
      where conrelid = t::regclass and contype = 'p'
    ) then
      continue;
    end if;

    execute format('select count(*) from (select id from %I group by id having count(*) > 1 or id is null) d', t)
      into dup_count;

    if dup_count > 0 then
      raise notice 'Primary key not added to %: % duplicate or null id(s) found. Resolve those, then re-run this migration.', t, dup_count;
      continue;
    end if;

    begin
      execute format('alter table %I add constraint %I primary key (id)', t, t || '_pkey');
      raise notice 'Added primary key to %', t;
    exception when others then
      raise notice 'Primary key not added to %: %', t, sqlerrm;
    end;
  end loop;
end $$;

-- ── campaigns ──────────────────────────────────────────────────────────────
create table if not exists campaigns (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  created_at          timestamptz not null default now()
);

alter table campaigns
  add column if not exists description        text,
  add column if not exists colour             text default '#4F46E5',
  add column if not exists status             text default 'draft',
  add column if not exists owner              text,
  add column if not exists icp_label          text,
  add column if not exists target_audience    text,
  add column if not exists geography          text[] default '{}',
  add column if not exists target_roles       text[] default '{}',
  add column if not exists company_size       text,
  add column if not exists industry           text[] default '{}',
  add column if not exists exclusion_criteria text,
  add column if not exists icp_criteria       text,
  add column if not exists research_focus     text,
  add column if not exists sample_profiles    jsonb default '[]'::jsonb,
  add column if not exists outreach_policy    text,
  add column if not exists messaging_policy   text,
  add column if not exists objective_and_policy jsonb,
  add column if not exists channels           jsonb default '{"email":true,"linkedin":false,"sms":false,"voice":false}'::jsonb,
  -- Deliberately no default: a default would stamp every existing row with
  -- ["email"] before the backfill below could read the real channel config,
  -- which is how a LinkedIn-enabled campaign silently loses LinkedIn.
  add column if not exists enabled_channels   jsonb,
  add column if not exists channel_limits     jsonb default '{"email":50,"linkedin":30,"sms":10,"voice":5}'::jsonb,
  add column if not exists daily_limit        integer default 50,
  add column if not exists agents             jsonb default '{}'::jsonb,
  add column if not exists working_hours      jsonb default '{"start":"09:00","end":"18:00","timezone":"UTC"}'::jsonb,
  add column if not exists approval_required  boolean default false,
  add column if not exists prospect_source    text,
  add column if not exists never_contact      text[] default '{}',
  add column if not exists updated_at         timestamptz default now();

-- A campaign must be in one of the lifecycle states the control plane knows.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_status_check') then
    alter table campaigns add constraint campaigns_status_check
      check (status in ('draft','live','paused','completed','archived'));
  end if;
exception when others then
  raise notice 'campaigns_status_check not added: %', sqlerrm;
end $$;

-- ── prospects ──────────────────────────────────────────────────────────────
create table if not exists prospects (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

alter table prospects
  add column if not exists first_name                text,
  add column if not exists last_name                 text,
  add column if not exists email                     text,
  add column if not exists email_status              text,
  add column if not exists phone                     text,
  add column if not exists phone_type                text,
  add column if not exists linkedin_url              text,
  add column if not exists title                     text,
  add column if not exists seniority                 text,
  add column if not exists department                text,
  add column if not exists location                  text,
  add column if not exists timezone                  text,
  add column if not exists tenure_months             integer,
  add column if not exists recent_activity           text,
  add column if not exists previous_companies        text[] default '{}',
  add column if not exists company_name              text,
  add column if not exists company_domain            text,
  add column if not exists company_industry          text,
  add column if not exists company_sub_industry      text,
  add column if not exists company_employee_count    integer,
  add column if not exists company_hq                text,
  add column if not exists company_funding_stage     text,
  add column if not exists company_last_funding_date date,
  add column if not exists company_description       text,
  add column if not exists tech_stack                text[] default '{}',
  add column if not exists hiring_roles              text[] default '{}',
  add column if not exists recent_news               text,
  add column if not exists intent_signals            text[] default '{}',
  -- provenance records where each field came from: manual | crm | ai_enriched
  add column if not exists provenance                jsonb default '{}'::jsonb,
  add column if not exists sources                   text[] default '{}',
  add column if not exists research_notes            text,
  add column if not exists research_confidence       text,
  add column if not exists fields_not_found          text[] default '{}',
  add column if not exists enriched_data             jsonb,
  add column if not exists enriched_at               timestamptz,
  add column if not exists enrichment_stale_after    timestamptz,
  -- the gate excludes existing customers from outreach entirely
  add column if not exists is_existing_customer      boolean default false,
  add column if not exists source                    text,
  add column if not exists updated_at                timestamptz default now();

-- ── campaign_prospects ─────────────────────────────────────────────────────
-- Funnel state lives here, not on prospects: the same person can be qualified
-- in one campaign and rejected in another, and each campaign keeps its own
-- score, sequence and history.
create table if not exists campaign_prospects (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null,
  prospect_id  uuid not null,
  created_at   timestamptz not null default now()
);

alter table campaign_prospects
  add column if not exists state              text default 'discovered',
  add column if not exists fit_score          integer,
  add column if not exists icp_verdict        text,
  add column if not exists icp_confidence     text,
  add column if not exists icp_result         jsonb,
  add column if not exists sequence           jsonb,
  add column if not exists outreach_plan      jsonb,
  add column if not exists current_step       integer default 0,
  add column if not exists next_action_at     timestamptz,
  add column if not exists priority           text,
  add column if not exists should_contact     boolean,
  add column if not exists no_contact_reason  text,
  add column if not exists latest_reply       text,
  add column if not exists last_touch_at      timestamptz,
  add column if not exists total_touches      integer default 0,
  add column if not exists updated_at         timestamptz default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_prospects_unique') then
    alter table campaign_prospects
      add constraint campaign_prospects_unique unique (campaign_id, prospect_id);
  end if;
exception when others then
  raise notice 'campaign_prospects_unique not added (duplicates may exist): %', sqlerrm;
end $$;

-- (Foreign keys for this table are created with all the others further down.)

-- ── prompt_versions ────────────────────────────────────────────────────────
create table if not exists prompt_versions (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid,
  agent_name  text not null,
  version     integer not null default 1,
  created_at  timestamptz not null default now()
);

alter table prompt_versions
  add column if not exists content   text default '',
  add column if not exists is_active boolean default false,
  add column if not exists author    text;

-- Prompt versions were written with display names ("System Prompt") while the
-- code keys off registry ids ("system"), so the Prompts screen showed empty
-- tabs. Normalise the stored values to the ids.
update prompt_versions set agent_name = 'system'            where agent_name in ('System Prompt','system_prompt');
update prompt_versions set agent_name = 'research'          where agent_name in ('Research Agent','Lead Research Agent','lead_research');
update prompt_versions set agent_name = 'icp_fitment'       where agent_name in ('ICP Agent','ICP Fitment Agent','icp');
update prompt_versions set agent_name = 'outreach_strategy' where agent_name in ('Strategy Agent','Outreach Strategy Agent','strategy');
update prompt_versions set agent_name = 'personalisation'   where agent_name in ('Personalisation Agent','Personalization Agent','personalization');
update prompt_versions set agent_name = 'conversation'      where agent_name in ('Conversation Agent');

-- ── agent_runs ─────────────────────────────────────────────────────────────
-- One row per agent invocation. This table is what makes "why did the agent
-- behave this way" answerable: it records the engine, the prompt version, the
-- inputs, the output, the retrieved chunks, tokens, cost and latency.
create table if not exists agent_runs (
  id          uuid primary key default gen_random_uuid(),
  agent_name  text not null,
  created_at  timestamptz not null default now()
);

alter table agent_runs
  add column if not exists campaign_id          uuid,
  add column if not exists prospect_id          uuid,
  add column if not exists campaign_prospect_id uuid,
  -- 'dronahq' | 'local_engine' | 'our_engine'
  add column if not exists engine               text,
  add column if not exists prompt_version_id    uuid,
  add column if not exists input_payload        jsonb,
  add column if not exists output_payload       jsonb,
  add column if not exists retrieved_chunks     jsonb default '[]'::jsonb,
  add column if not exists tokens_in            integer,
  add column if not exists tokens_out           integer,
  add column if not exists cost_usd             numeric(12,6) default 0,
  add column if not exists latency_ms           integer,
  -- 'success' | 'degraded' | 'error'
  add column if not exists status               text default 'success',
  add column if not exists error_message        text;

-- ── activities ─────────────────────────────────────────────────────────────
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

alter table activities
  add column if not exists campaign_id      uuid,
  add column if not exists prospect_id      uuid,
  add column if not exists agent_name       text,
  add column if not exists engine           text,
  add column if not exists prospect_name    text,
  add column if not exists prospect_company text,
  add column if not exists action           text,
  add column if not exists outcome          text,
  add column if not exists status           text default 'success',
  add column if not exists metadata         jsonb default '{}'::jsonb;

-- ── messages ───────────────────────────────────────────────────────────────
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

alter table messages
  add column if not exists campaign_prospect_id uuid,
  add column if not exists prospect_id          uuid,
  add column if not exists campaign_id          uuid,
  add column if not exists direction            text,
  add column if not exists channel              text,
  add column if not exists step_number          integer,
  add column if not exists subject              text,
  add column if not exists body                 text,
  add column if not exists personalisation_used jsonb default '[]'::jsonb,
  add column if not exists knowledge_used       jsonb default '[]'::jsonb,
  add column if not exists cta                  text,
  add column if not exists needs_human          boolean default false,
  add column if not exists needs_human_reason   text,
  add column if not exists intent               text,
  add column if not exists intent_confidence    text,
  add column if not exists sentiment            text,
  add column if not exists extracted_facts      jsonb default '[]'::jsonb,
  add column if not exists questions_asked      jsonb default '[]'::jsonb,
  add column if not exists objections_raised    jsonb default '[]'::jsonb,
  add column if not exists referral             jsonb,
  add column if not exists is_auto_reply        boolean default false,
  add column if not exists agent_run_id         uuid,
  add column if not exists prompt_version_id    uuid,
  add column if not exists sent_at              timestamptz,
  add column if not exists received_at          timestamptz;

-- ── escalations ────────────────────────────────────────────────────────────
create table if not exists escalations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

alter table escalations
  add column if not exists campaign_id          uuid,
  add column if not exists prospect_id          uuid,
  add column if not exists campaign_prospect_id uuid,
  add column if not exists source_agent         text,
  add column if not exists escalation_type      text,
  add column if not exists reason               text,
  add column if not exists proposed_action      text,
  add column if not exists proposed_payload     jsonb,
  add column if not exists status               text default 'pending',
  add column if not exists risk_level           text default 'low',
  add column if not exists prospect_name        text,
  add column if not exists campaign_name        text,
  add column if not exists resolved_by          text,
  add column if not exists resolved_at          timestamptz,
  add column if not exists resolution_note      text;

-- ── conflicts ──────────────────────────────────────────────────────────────
create table if not exists conflicts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

alter table conflicts
  add column if not exists prospect_id          uuid,
  add column if not exists campaign_ids         uuid[] default '{}',
  add column if not exists rule                 text default 'multi_campaign_touch',
  add column if not exists status               text default 'pending',
  add column if not exists prospect_name        text,
  add column if not exists last_touch           timestamptz,
  add column if not exists last_touch_channel   text,
  add column if not exists next_action          text,
  add column if not exists contact_count        integer default 0,
  add column if not exists resolved_campaign_id uuid,
  add column if not exists resolved_by          text,
  add column if not exists resolved_at          timestamptz;

-- ── suppression_list ───────────────────────────────────────────────────────
create table if not exists suppression_list (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

alter table suppression_list
  add column if not exists email    text,
  add column if not exists domain   text,
  add column if not exists phone    text,
  add column if not exists reason   text,
  add column if not exists added_by text;

-- ── reps and campaign_reps ─────────────────────────────────────────────────
create table if not exists reps (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  created_at  timestamptz not null default now()
);

alter table reps
  add column if not exists email        text,
  add column if not exists title        text,
  add column if not exists linkedin_url text,
  add column if not exists avatar_url   text,
  add column if not exists is_active    boolean default true;

create table if not exists campaign_reps (
  campaign_id uuid not null,
  rep_id      uuid not null
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_reps_pkey') then
    alter table campaign_reps add constraint campaign_reps_pkey primary key (campaign_id, rep_id);
  end if;
exception when others then
  raise notice 'campaign_reps_pkey not added: %', sqlerrm;
end $$;

-- ── system_control ─────────────────────────────────────────────────────────
-- Exactly one row. Holds the global kill switch, per-channel pauses and
-- per-agent pauses. The gate reads it before every autonomous action.
create table if not exists system_control (
  id integer primary key default 1
);

alter table system_control
  add column if not exists kill_switch    boolean default false,
  add column if not exists channel_pauses jsonb   default '{"email":false,"linkedin":false,"sms":false,"voice":false}'::jsonb,
  add column if not exists agent_pauses   jsonb   default '{}'::jsonb,
  add column if not exists updated_at     timestamptz default now();

-- A `where not exists` insert rather than `on conflict (id)`, because on a
-- database where system_control has no primary key, ON CONFLICT is rejected
-- outright and aborts the whole migration.
insert into system_control (id, kill_switch, channel_pauses, agent_pauses)
select 1, false, '{"email":false,"linkedin":false,"sms":false,"voice":false}'::jsonb, '{}'::jsonb
where not exists (select 1 from system_control);

-- Backfill in case an older row predates these columns.
update system_control set kill_switch = false where kill_switch is null;
update system_control set channel_pauses = '{"email":false,"linkedin":false,"sms":false,"voice":false}'::jsonb
  where channel_pauses is null;
update system_control set agent_pauses = '{}'::jsonb where agent_pauses is null;

-- ── knowledge_chunks ───────────────────────────────────────────────────────
-- Campaign-scoped RAG corpus. campaign_id null means the chunk is global and
-- retrievable by every campaign.
create table if not exists knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  content     text not null,
  created_at  timestamptz not null default now()
);

alter table knowledge_chunks
  add column if not exists campaign_id uuid,
  add column if not exists title       text,
  add column if not exists source      text,
  add column if not exists updated_at  timestamptz default now();

-- ---------------------------------------------------------------------------
-- Foreign keys.
--
-- These are not decoration. PostgREST derives its embedded-select relationships
-- from foreign keys, so without them a query like
-- `activities?select=*,campaigns(name)` is rejected with PGRST200 and the
-- activity feed, approval queue and conflict list all come back empty. Every
-- embed the API performs is backed by one of the keys below.
--
-- Added NOT VALID: the constraint applies to every new row and is visible to
-- PostgREST immediately, but existing rows are not re-checked. On a database
-- that already has orphaned rows — a prospect whose campaign was deleted, say —
-- a validating constraint would fail and abort the migration. Run
-- `alter table X validate constraint Y;` yourself once the orphans are cleaned
-- up, if you want the check enforced retroactively.
-- ---------------------------------------------------------------------------
do $$
declare
  fk record;
begin
  for fk in
    select * from (values
      ('campaign_prospects', 'campaign_fk',      'campaign_id',          'campaigns',          'cascade'),
      ('campaign_prospects', 'prospect_fk',      'prospect_id',          'prospects',          'cascade'),
      ('activities',         'campaign_fk',      'campaign_id',          'campaigns',          'cascade'),
      ('activities',         'prospect_fk',      'prospect_id',          'prospects',          'set null'),
      ('agent_runs',         'campaign_fk',      'campaign_id',          'campaigns',          'cascade'),
      ('agent_runs',         'prospect_fk',      'prospect_id',          'prospects',          'cascade'),
      ('agent_runs',         'prompt_fk',        'prompt_version_id',    'prompt_versions',    'set null'),
      ('messages',           'campaign_fk',      'campaign_id',          'campaigns',          'cascade'),
      ('messages',           'prospect_fk',      'prospect_id',          'prospects',          'cascade'),
      ('messages',           'cp_fk',            'campaign_prospect_id', 'campaign_prospects', 'cascade'),
      ('escalations',        'campaign_fk',      'campaign_id',          'campaigns',          'cascade'),
      ('escalations',        'prospect_fk',      'prospect_id',          'prospects',          'cascade'),
      ('escalations',        'cp_fk',            'campaign_prospect_id', 'campaign_prospects', 'cascade'),
      ('conflicts',          'prospect_fk',      'prospect_id',          'prospects',          'cascade'),
      ('prompt_versions',    'campaign_fk',      'campaign_id',          'campaigns',          'cascade'),
      ('knowledge_chunks',   'campaign_fk',      'campaign_id',          'campaigns',          'cascade'),
      ('campaign_reps',      'campaign_fk',      'campaign_id',          'campaigns',          'cascade'),
      ('campaign_reps',      'rep_fk',           'rep_id',               'reps',               'cascade')
    ) as t(child, suffix, col, parent, on_delete)
  loop
    continue when to_regclass(fk.child) is null or to_regclass(fk.parent) is null;

    -- The parent needs a primary key for a foreign key to point at it.
    continue when not exists (
      select 1 from pg_constraint where conrelid = fk.parent::regclass and contype = 'p'
    );

    continue when exists (
      select 1 from pg_constraint where conname = fk.child || '_' || fk.suffix
    );

    begin
      execute format(
        'alter table %I add constraint %I foreign key (%I) references %I(id) on delete %s not valid',
        fk.child, fk.child || '_' || fk.suffix, fk.col, fk.parent, fk.on_delete
      );
    exception when others then
      raise notice 'Foreign key %_% not added: %', fk.child, fk.suffix, sqlerrm;
    end;
  end loop;
end $$;

-- ── indexes ────────────────────────────────────────────────────────────────
create index if not exists idx_cp_campaign_state      on campaign_prospects (campaign_id, state);
create index if not exists idx_cp_next_action         on campaign_prospects (next_action_at);
create index if not exists idx_cp_prospect            on campaign_prospects (prospect_id);
create index if not exists idx_runs_prospect_created  on agent_runs (prospect_id, created_at desc);
create index if not exists idx_runs_campaign_created  on agent_runs (campaign_id, created_at desc);
create index if not exists idx_runs_agent_status      on agent_runs (agent_name, status);
create index if not exists idx_activities_created     on activities (created_at desc);
create index if not exists idx_activities_campaign    on activities (campaign_id, created_at desc);
create index if not exists idx_messages_prospect      on messages (prospect_id, created_at);
create index if not exists idx_messages_campaign_dir  on messages (campaign_id, direction, created_at desc);
create index if not exists idx_escalations_status     on escalations (status, created_at desc);
create index if not exists idx_conflicts_status       on conflicts (status, created_at desc);
create index if not exists idx_knowledge_campaign     on knowledge_chunks (campaign_id, type);
create index if not exists idx_prompts_lookup         on prompt_versions (campaign_id, agent_name, is_active);
create index if not exists idx_suppression_email      on suppression_list (email);
create index if not exists idx_suppression_domain     on suppression_list (domain);

-- ── data repair ────────────────────────────────────────────────────────────

-- Derive enabled_channels from the channels object for every row that does not
-- have one yet. The gate reads enabled_channels and the campaign form writes
-- channels, so a row where they disagree is a campaign that sends on a channel
-- nobody switched on, or fails to send on one they did.
update campaigns
set enabled_channels = (
  select coalesce(jsonb_agg(key order by key), '["email"]'::jsonb)
  from jsonb_each_text(channels)
  where value = 'true'
)
where channels is not null
  and jsonb_typeof(channels) = 'object'
  and (enabled_channels is null or enabled_channels = '[]'::jsonb);

-- Rows with neither side populated get email, the one channel every campaign
-- can use.
update campaigns set enabled_channels = '["email"]'::jsonb
  where enabled_channels is null or enabled_channels = '[]'::jsonb;

-- And the reverse, for rows that only ever had the array form.
update campaigns
set channels = jsonb_build_object(
  'email',    enabled_channels ? 'email',
  'linkedin', enabled_channels ? 'linkedin',
  'sms',      enabled_channels ? 'sms',
  'voice',    enabled_channels ? 'voice'
)
where (channels is null or jsonb_typeof(channels) <> 'object')
  and enabled_channels is not null;

alter table campaigns alter column enabled_channels set default '["email"]'::jsonb;

-- Runs written before the engine column existed came from DronaHQ.
update agent_runs set engine = 'dronahq' where engine is null;

-- Activities written before status existed succeeded.
update activities set status = 'success' where status is null;

-- ===========================================================================
-- Row level security
--
-- The API connects with the service role key, which bypasses RLS, so no
-- policies are required for it to work. If you enable RLS on these tables for
-- anon/authenticated access, add policies deliberately — do not leave the
-- tables readable by anon, because prospects holds contact data.
-- ===========================================================================

select 'Migration 004 applied. Open /health/schema on the API to verify.' as result;
