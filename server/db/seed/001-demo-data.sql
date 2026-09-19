-- ===========================================================================
-- Pigeon SDR · demo seed
--
-- Creates the three concurrent campaigns the brief requires, each with its own
-- ICP, its own prompts, its own channel mix and its own lifecycle state:
--
--   US SaaS CTO Outreach     live     email + linkedin
--   India BFSI CIO Outreach  paused   email
--   Voice AI Founder Outreach live    email + voice
--
-- Run this AFTER 004-pigeon-sdr-fixes.sql. It is idempotent: every insert is
-- ON CONFLICT DO NOTHING, so running it twice changes nothing.
--
-- The previous seed used ids like '00000000-0000-0000-0000-rep_10000000',
-- which are not valid UUIDs and are rejected by a uuid column. Every id here
-- is a real UUID.
-- ===========================================================================

-- ── reps ───────────────────────────────────────────────────────────────────
insert into reps (id, full_name, email, title, linkedin_url, is_active) values
  ('a1000000-0000-4000-8000-000000000001', 'Nishu Jain',  'nishu@pigeonsdr.com',  'Founder & SDR Lead',  'https://linkedin.com/in/nishu',  true),
  ('a1000000-0000-4000-8000-000000000002', 'Aarav Singh', 'aarav@pigeonsdr.com',  'Account Executive',   'https://linkedin.com/in/aarav',  true)
on conflict (id) do nothing;

-- ── suppression list ───────────────────────────────────────────────────────
insert into suppression_list (id, email, domain, phone, reason, added_by) values
  ('a2000000-0000-4000-8000-000000000001', 'ceo@competitor.com', null,             null, 'Direct competitor',                 'Nishu Jain'),
  ('a2000000-0000-4000-8000-000000000002', null,                 'government.gov', null, 'Government domain, out of policy',  'System'),
  ('a2000000-0000-4000-8000-000000000003', 'optout@example.com', null,             null, 'Opted out on a previous campaign',  'System')
on conflict (id) do nothing;

-- ── campaigns ──────────────────────────────────────────────────────────────

insert into campaigns (
  id, name, description, colour, status, owner, icp_label, target_audience,
  geography, target_roles, company_size, industry,
  icp_criteria, exclusion_criteria, research_focus, outreach_policy, messaging_policy,
  channels, enabled_channels, channel_limits, daily_limit,
  agents, working_hours, approval_required, prospect_source, never_contact
) values (
  'c1000000-0000-4000-8000-000000000001',
  'US SaaS CTO Outreach',
  'Engineering leaders at funded US SaaS companies who are scaling their teams.',
  '#4F46E5', 'live', 'Nishu Jain',
  'US SaaS CTOs · Series A+',
  'CTOs and VPs of Engineering at US SaaS companies, Series A and later',
  array['United States'], array['CTO','VP Engineering','Head of Engineering'], '50-2000', array['SaaS','DevTools','Cloud Infrastructure'],
  'US-based CTOs or VPs of Engineering at SaaS and developer-tools companies with 50 to 2000 employees. Series A funding or later. Strong signal if they are hiring engineers or have published engineering content in the last quarter.',
  'Exclude consulting firms, agencies, staffing companies, and any company headquartered outside the United States. Exclude companies under 50 employees.',
  'Look for recent funding rounds, engineering blog posts, open-source activity, and open engineering roles.',
  'Three to five touches across email and LinkedIn over eighteen days. Open on the strongest research signal, follow with a relevant customer outcome, then ask for a short call.',
  'Peer-to-peer and concrete. Reference their actual tech stack or a specific signal. Under 80 words. No superlatives, no flattery, one clear ask.',
  '{"email":true,"linkedin":true,"sms":false,"voice":false}'::jsonb,
  '["email","linkedin"]'::jsonb,
  '{"email":50,"linkedin":25,"sms":0,"voice":0}'::jsonb,
  50,
  '{"research":true,"icp_fitment":true,"outreach_strategy":true,"personalisation":true,"conversation":true,"followup_timing":true,"voice_sdr":false}'::jsonb,
  '{"start":"09:00","end":"17:00","timezone":"America/New_York"}'::jsonb,
  false, 'LinkedIn Sales Navigator', array['competitor.com']
) on conflict (id) do nothing;

insert into campaigns (
  id, name, description, colour, status, owner, icp_label, target_audience,
  geography, target_roles, company_size, industry,
  icp_criteria, exclusion_criteria, research_focus, outreach_policy, messaging_policy,
  channels, enabled_channels, channel_limits, daily_limit,
  agents, working_hours, approval_required, prospect_source, never_contact
) values (
  'c1000000-0000-4000-8000-000000000002',
  'India BFSI CIO Outreach',
  'Technology leaders at Indian banks, insurers and NBFCs running modernisation programmes.',
  '#10B981', 'paused', 'Nishu Jain',
  'India BFSI CIOs · Enterprise',
  'CIOs and Chief Digital Officers at Indian banks, insurers and NBFCs',
  array['India'], array['CIO','Chief Digital Officer','VP Technology'], '1000-50000', array['Banking','Insurance','NBFC','Financial Services'],
  'CIOs, CDOs or VPs of Technology at Indian scheduled commercial banks, insurers and NBFCs with more than 1000 employees. Strong signal if they have an announced digital transformation programme.',
  'Exclude cooperative banks, microfinance institutions, payment aggregators and any organisation outside India.',
  'Look for digital transformation announcements, RBI compliance deadlines, core banking migrations and existing technology vendor relationships.',
  'Two email touches, seven days apart. Lead on regulatory timelines and operating cost, not on product features.',
  'Formal and specific. Reference the regulatory environment they operate in. Under 80 words. Address them by title. No casual openers.',
  '{"email":true,"linkedin":false,"sms":false,"voice":false}'::jsonb,
  '["email"]'::jsonb,
  '{"email":30,"linkedin":0,"sms":0,"voice":0}'::jsonb,
  30,
  '{"research":true,"icp_fitment":true,"outreach_strategy":true,"personalisation":true,"conversation":true,"followup_timing":true,"voice_sdr":false}'::jsonb,
  '{"start":"10:00","end":"18:00","timezone":"Asia/Kolkata"}'::jsonb,
  true, 'Industry association directory', array['government.gov']
) on conflict (id) do nothing;

insert into campaigns (
  id, name, description, colour, status, owner, icp_label, target_audience,
  geography, target_roles, company_size, industry,
  icp_criteria, exclusion_criteria, research_focus, outreach_policy, messaging_policy,
  channels, enabled_channels, channel_limits, daily_limit,
  agents, working_hours, approval_required, prospect_source, never_contact
) values (
  'c1000000-0000-4000-8000-000000000003',
  'Voice AI Founder Outreach',
  'Founders building voice and conversational AI products at seed to Series A.',
  '#F59E0B', 'live', 'Aarav Singh',
  'Voice AI Founders · Seed–Series A',
  'Founders and CTOs at voice AI and conversational AI startups',
  array['United States','United Kingdom','India'], array['Founder','Co-Founder','CEO','CTO'], '5-150', array['Voice AI','Conversational AI','Speech Technology'],
  'Founders, co-founders or CTOs at voice AI, speech and conversational AI startups between seed and Series A, with 5 to 150 employees.',
  'Exclude enterprise AI divisions inside large corporations, hardware-first companies, and agencies that resell voice platforms.',
  'Look for product launches, GitHub and open-source activity, accelerator affiliations, and published technical writing on latency or model quality.',
  'Founder to founder. A single direct email, then one voice touch only if they engage. Never open on voice.',
  'Technical, direct and short. Lead with a specific technical observation about what they built. Under 70 words. No marketing language.',
  '{"email":true,"linkedin":false,"sms":false,"voice":true}'::jsonb,
  '["email","voice"]'::jsonb,
  '{"email":40,"linkedin":0,"sms":0,"voice":10}'::jsonb,
  40,
  '{"research":true,"icp_fitment":true,"outreach_strategy":true,"personalisation":true,"conversation":true,"followup_timing":true,"voice_sdr":true}'::jsonb,
  '{"start":"09:00","end":"18:00","timezone":"America/Los_Angeles"}'::jsonb,
  false, 'Accelerator batch lists', array[]::text[]
) on conflict (id) do nothing;

-- ── rep assignment ─────────────────────────────────────────────────────────
insert into campaign_reps (campaign_id, rep_id) values
  ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),
  ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002')
on conflict do nothing;

-- ── prompt versions ────────────────────────────────────────────────────────
-- Each campaign carries its own system prompt and its own per-agent prompts.
-- Campaign 1 ships v1 and v2 of its ICP prompt so the diff, activate and
-- rollback flow has something real to show.

insert into prompt_versions (id, campaign_id, agent_name, version, is_active, author, content) values
  ('b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'system', 1, true, 'Nishu Jain',
   'You are the autonomous SDR system for the US SaaS CTO campaign. You speak to engineering leaders who receive dozens of cold emails a week and delete almost all of them. Every claim you make about a prospect must come from a field in their researched profile. Every claim you make about the product must come from a retrieved knowledge chunk. If you cannot ground a statement in one of those, do not make the statement. Escalate rather than guess.'),
  ('b1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'research', 1, true, 'Nishu Jain',
   'Research this prospect and their company. Return only what you can source. A null field is a correct answer; an invented value is a failure. Prioritise: current title and seniority, company headcount, funding stage and date, engineering blog or open-source activity, and open engineering roles. List every field you could not find in fields_not_found.'),
  ('b1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'icp_fitment', 1, false, 'Nishu Jain',
   'Score this prospect against the campaign ICP from 0 to 100 and return qualify, reject or needs_review. Weight role seniority most heavily, then industry, then company size.'),
  ('b1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'icp_fitment', 2, true, 'Nishu Jain',
   'Check the exclusion criteria first. Any exclusion match is an immediate reject with a score of 0 and high confidence, regardless of how strong the rest of the profile is. If no exclusion matches, score from 0 to 100 across five dimensions: role seniority (35%), industry fit (20%), company size band (15%), overlap with the free-text ICP (20%) and buying signals (10%). Return qualify at 70 or above, reject below 45, and needs_review in between. Return needs_review with low confidence whenever two or more critical fields are missing, whatever the score says. Name every missing field in missing_data.'),
  ('b1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001', 'outreach_strategy', 1, true, 'Nishu Jain',
   'Plan three to five touches across email and LinkedIn over about eighteen days. Never open on voice. Escalate to a human when ICP confidence is low, the verdict is needs_review, title or seniority is null, the fit score is 90 or above, the prospect has been in role under a month, company news is negative, or the prospect has previously responded negatively. Return day offsets, not dates.'),
  ('b1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000001', 'personalisation', 1, true, 'Nishu Jain',
   'Write one message for one step. Under 80 words. Open on the specific signal named in the step, not on a generic compliment. Every claim about the prospect cites a profile field; every claim about the product cites a knowledge chunk. One clear ask at the end. If the profile does not give you anything specific to say, set needs_human rather than writing filler.'),
  ('b1000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000001', 'conversation', 1, true, 'Nishu Jain',
   'Read the inbound reply and classify it. Check for opt-out language first: opt-out overrides every other reading, including an otherwise positive message. Then check for delivery failures and auto-replies. Extract every question asked and every objection raised, quoting the prospect''s own words. Escalate objections, referrals, wrong-person replies and anything you classify with low confidence.')
on conflict (id) do nothing;

insert into prompt_versions (id, campaign_id, agent_name, version, is_active, author, content) values
  ('b2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'system', 1, true, 'Nishu Jain',
   'You are the autonomous SDR system for the India BFSI CIO campaign. Your audience is regulated: every message may be read by a compliance function. Be formal, specific and conservative. Never imply a regulatory obligation that you cannot cite. Escalate anything that touches compliance, security review or procurement to a human.'),
  ('b2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'research', 1, true, 'Nishu Jain',
   'Research this technology leader and their institution. Prioritise: current title, institution type (bank, insurer or NBFC), announced digital transformation programmes, core banking or policy administration platform in use, and regulatory deadlines they are working towards. Return null for anything you cannot source.'),
  ('b2000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002', 'icp_fitment', 1, true, 'Nishu Jain',
   'Check exclusions first: cooperative banks, microfinance institutions and payment aggregators are immediate rejects. Then score on role seniority, institution size and whether a modernisation programme is under way. Weight institution type heavily: a CIO at an NBFC and a CIO at a scheduled commercial bank are different prospects.'),
  ('b2000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000002', 'outreach_strategy', 1, true, 'Nishu Jain',
   'Email only, two touches, seven days apart. This audience does not respond to high-frequency sequences. Escalate anything where the institution has an active regulatory action.'),
  ('b2000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000002', 'personalisation', 1, true, 'Nishu Jain',
   'Formal register. Address by title. Under 80 words. Lead on regulatory timeline or operating cost, never on product features. No casual openers, no first-name-only greetings, no exclamation marks.'),
  ('b2000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000002', 'conversation', 1, true, 'Nishu Jain',
   'Classify the reply. Treat any mention of procurement, information security review or compliance as an objection requiring a human, not as a question to answer autonomously. Opt-out language overrides everything.')
on conflict (id) do nothing;

insert into prompt_versions (id, campaign_id, agent_name, version, is_active, author, content) values
  ('b3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'system', 1, true, 'Aarav Singh',
   'You are the autonomous SDR system for the Voice AI Founder campaign. You are writing to technical founders who will spot a generic email instantly. Be specific about what they built. Short is better than complete. If you have nothing technically specific to say, say nothing and escalate.'),
  ('b3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003', 'research', 1, true, 'Aarav Singh',
   'Research this founder and their product. Prioritise: what the product actually does, the stage they are at, GitHub and open-source activity, accelerator affiliation, and any published technical writing. Technical specifics matter more than firmographics for this ICP.'),
  ('b3000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'icp_fitment', 1, true, 'Aarav Singh',
   'Exclusions first: enterprise AI divisions inside large corporations, hardware-first companies and reseller agencies are rejects. Then score on whether the person is a founder or CTO, whether the company is genuinely voice or speech focused, and whether they are between seed and Series A. A brilliant fit at Series C is still a reject for this campaign.'),
  ('b3000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000003', 'outreach_strategy', 1, true, 'Aarav Singh',
   'One direct email first. Add a voice touch only after the prospect has engaged. Voice is never the first touch under any circumstances. Escalate before scheduling any voice call.'),
  ('b3000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000003', 'personalisation', 1, true, 'Aarav Singh',
   'Under 70 words. Open with one specific technical observation about their product or their writing. Founder to founder, no marketing language, no company boilerplate. One question at the end.'),
  ('b3000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000003', 'conversation', 1, true, 'Aarav Singh',
   'Classify the reply. Technical questions from this audience are buying signals, not objections: route them to a reply rather than to a human, unless they ask about pricing or contracts. Opt-out overrides everything.')
on conflict (id) do nothing;

-- ── knowledge base ─────────────────────────────────────────────────────────
-- Global chunks (campaign_id null) are retrievable by every campaign.

insert into knowledge_chunks (id, campaign_id, type, title, content) values
  ('d0000000-0000-4000-8000-000000000001', null, 'product', 'What Pigeon SDR does',
   'Pigeon SDR runs multi-channel outbound as an autonomous system. Agents research a prospect, score them against a campaign ICP, plan a sequence, write each message at send time, and classify replies. A human manager keeps a control plane with per-campaign, per-agent, per-channel and global stop controls.'),
  ('d0000000-0000-4000-8000-000000000002', null, 'objection_handling', 'Objection: we already have a tool for this',
   'Acknowledge the incumbent, then ask one specific question about what it does not cover. Most teams have sequencing but not autonomous research and qualification, so the gap is usually in how prospects are scored before anyone writes to them, not in sending.'),
  ('d0000000-0000-4000-8000-000000000003', null, 'objection_handling', 'Objection: pricing',
   'Do not quote numbers autonomously. Ask what they currently spend per qualified meeting, and hand the conversation to a human for anything beyond that.'),
  ('d0000000-0000-4000-8000-000000000004', null, 'brand_voice', 'How we write',
   'Short sentences. Specific nouns. No superlatives, no hype words, no exclamation marks. One ask per message. Never claim a result we cannot attribute to a named customer.')
on conflict (id) do nothing;

insert into knowledge_chunks (id, campaign_id, type, title, content) values
  ('d1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'case_study', 'Engineering team of 40 to 180 in nine months',
   'A Series B developer-tools company grew engineering from 40 to 180 in nine months. Their outbound stalled because sourcing could not keep pace with hiring. After running qualification autonomously, their reps spent time only on prospects that had already been scored and researched.'),
  ('d1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'icp_definition', 'US SaaS CTO ICP',
   'Target: CTO or VP Engineering, US-based, SaaS or developer tools, 50 to 2000 employees, Series A or later. Strongest signals are open engineering roles and recently published engineering content. Weakest fit: agencies, consultancies and anyone under 50 employees.'),
  ('d2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'icp_definition', 'India BFSI CIO ICP',
   'Target: CIO, CDO or VP Technology at an Indian scheduled commercial bank, insurer or NBFC with more than 1000 employees. Strongest signal is an announced digital transformation programme with a regulatory deadline attached.'),
  ('d2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'playbook', 'BFSI outreach constraints',
   'Messages to this audience are often forwarded to compliance. Keep claims narrow and attributable. Never assert a regulatory requirement without naming the circular or guideline it comes from. Escalate anything touching procurement or information security review.'),
  ('d3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'icp_definition', 'Voice AI founder ICP',
   'Target: founder, co-founder or CTO at a voice, speech or conversational AI company between seed and Series A, 5 to 150 employees. Technical specificity matters more than firmographics. Reject enterprise AI divisions and hardware-first companies.'),
  ('d3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003', 'example_email', 'Founder-to-founder opener that worked',
   'Opened on a specific latency number from the founder''s own blog post, named the trade-off they had written about, and asked one question about how they were measuring it in production. Forty-one words, no product pitch, reply within an hour.')
on conflict (id) do nothing;

-- ── prospects ──────────────────────────────────────────────────────────────
-- Left in 'discovered' so the pipeline has real work to do on first run,
-- rather than arriving pre-filled with outcomes nobody's agents produced.

-- The set is chosen so the first pipeline run exercises every branch rather
-- than producing eight identical qualifications. Each row is annotated with
-- what it is there to demonstrate.

insert into prospects (id, first_name, last_name, email, title, company_name, company_domain, company_industry, company_sub_industry, company_employee_count, company_funding_stage, recent_news, tech_stack, hiring_roles, location, linkedin_url, source, provenance) values
  -- Clean qualification: everything present, strong signals.
  ('e1000000-0000-4000-8000-000000000001', 'Sarah', 'Chen', 'sarah.chen@northwind.example', 'CTO', 'Northwind Systems', 'northwind.example', 'SaaS', 'DevTools', 420, 'Series C',
   'Announced a Series C and opened a second engineering office',
   array['Kubernetes','Go','Postgres'], array['Staff Engineer','Engineering Manager'],
   'San Francisco, CA', 'https://linkedin.com/in/example-schen', 'LinkedIn Sales Navigator',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb),

  -- Qualifies here, rejected by the Voice AI campaign: the same person, two
  -- different verdicts, which is what per-campaign state exists to allow.
  ('e1000000-0000-4000-8000-000000000002', 'Marcus', 'Webb', 'marcus.webb@latchkey.example', 'VP Engineering', 'Latchkey', 'latchkey.example', 'DevTools', null, 180, 'Series B',
   null, array['Terraform','AWS'], array['Platform Engineer'],
   'Austin, TX', 'https://linkedin.com/in/example-mwebb', 'LinkedIn Sales Navigator',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb),

  -- Qualifies, but has nothing specific to reference, so the Personalisation
  -- agent sets needs_human rather than writing filler.
  ('e1000000-0000-4000-8000-000000000003', 'Dana', 'Okonkwo', 'dana@brightpath.example', 'Head of Engineering', 'Brightpath Cloud', 'brightpath.example', 'Cloud Infrastructure', null, 95, null,
   null, null, null,
   'Boston, MA', 'https://linkedin.com/in/example-dokonkwo', 'LinkedIn Sales Navigator',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb),

  -- Immediate reject: a consultancy, which the campaign excludes explicitly.
  ('e1000000-0000-4000-8000-000000000004', 'Tomas', 'Lindqvist', 'tomas@fernhill.example', 'Principal Consultant', 'Fernhill Advisory', 'fernhill.example', 'Consulting', null, 60, null,
   null, null, null,
   'Chicago, IL', null, 'LinkedIn Sales Navigator',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb),

  -- Too little data to score: no title, no industry, no headcount. The ICP
  -- agent returns needs_review, which lands in the Approval Center.
  ('e1000000-0000-4000-8000-000000000005', 'Jordan', 'Pace', 'j.pace@quietfold.example', null, 'Quietfold', 'quietfold.example', null, null, null, null,
   null, null, null,
   null, null, 'Conference attendee list',
   '{"company":"crm","email":"crm"}'::jsonb),

  -- Qualifies for BOTH live campaigns: a CTO at a SaaS company whose product
  -- is voice AI. This is the conflict case.
  ('e1000000-0000-4000-8000-000000000006', 'Nadia', 'Rahman', 'nadia@cadence.example', 'CTO & Co-Founder', 'Cadence Labs', 'cadence.example', 'SaaS', 'Voice AI', 90, 'Series A',
   'Launched a real-time voice agent product and published latency benchmarks',
   array['Rust','WebRTC','Postgres'], array['Speech Engineer','Infrastructure Engineer'],
   'New York, NY', 'https://linkedin.com/in/example-nrahman', 'Accelerator batch lists',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb),

  ('e2000000-0000-4000-8000-000000000001', 'Rajesh', 'Kumar', 'rajesh.kumar@meridianbank.example', 'Chief Information Officer', 'Meridian Bank', 'meridianbank.example', 'Banking', null, 12000, null,
   'Announced a three-year core banking modernisation programme', null, array['Cloud Architect'],
   'Mumbai, India', 'https://linkedin.com/in/example-rkumar', 'Industry association directory',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb),

  ('e2000000-0000-4000-8000-000000000002', 'Priya', 'Venkatesh', 'priya.v@arclightinsure.example', 'Chief Digital Officer', 'Arclight Insurance', 'arclightinsure.example', 'Insurance', null, 4500, null,
   null, null, null,
   'Bengaluru, India', 'https://linkedin.com/in/example-pvenkatesh', 'Industry association directory',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb),

  ('e3000000-0000-4000-8000-000000000001', 'Alice', 'Moreau', 'alice@resonate.example', 'Founder & CEO', 'Resonate Voice', 'resonate.example', 'Voice AI', 'Speech Technology', 22, 'Seed',
   'Published a write-up on cutting first-token latency below 300ms',
   array['Rust','ONNX'], array['ML Engineer'],
   'London, UK', 'https://linkedin.com/in/example-amoreau', 'Accelerator batch lists',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb),

  ('e3000000-0000-4000-8000-000000000002', 'Kenji', 'Nakamura', 'kenji@utterly.example', 'Co-Founder & CTO', 'Utterly', 'utterly.example', 'Conversational AI', 'Voice AI', 14, 'Seed',
   'Open-sourced their streaming transcription layer',
   array['Python','Triton'], array['Research Engineer'],
   'Palo Alto, CA', 'https://linkedin.com/in/example-knakamura', 'Accelerator batch lists',
   '{"role":"crm","company":"crm","email":"crm"}'::jsonb)
on conflict (id) do nothing;

-- Marcus Webb and Nadia Rahman each sit in two live campaigns. Marcus is
-- rejected by the Voice AI ICP, so only one campaign works him and no conflict
-- arises. Nadia qualifies for both, which is exactly the case the conflict
-- detector is for.
insert into campaign_prospects (id, campaign_id, prospect_id, state) values
  ('f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'discovered'),
  ('f1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'discovered'),
  ('f1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', 'discovered'),
  ('f1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', 'discovered'),
  ('f1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000005', 'discovered'),
  ('f1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000006', 'discovered'),
  ('f2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'discovered'),
  ('f2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'discovered'),
  ('f3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000001', 'discovered'),
  ('f3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000002', 'discovered'),
  ('f3000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000002', 'discovered'),
  ('f3000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000006', 'discovered')
on conflict (id) do nothing;

-- Everything in a live campaign is due now, so the first run has work to do.
update campaign_prospects
set next_action_at = now()
where next_action_at is null
  and campaign_id in (
    select id from campaigns where status = 'live'
  );

select
  (select count(*) from campaigns)          as campaigns,
  (select count(*) from prospects)          as prospects,
  (select count(*) from campaign_prospects) as memberships,
  (select count(*) from prompt_versions)    as prompt_versions,
  (select count(*) from knowledge_chunks)   as knowledge_chunks,
  'Seed applied. Set a campaign live and POST /campaigns/:id/run to start the pipeline.' as next_step;
