-- Campaign 1: US SaaS CTO
UPDATE campaigns SET
  icp_criteria = 'US-based CTOs or VP Engineering at SaaS/DevTools companies (50-2000 employees). Must have recent Series A+ funding.',
  exclusion_criteria = 'Exclude consulting companies, agencies, and companies outside the US.',
  research_focus = 'Look for recent funding rounds, technical blog posts, open-source contributions, and hiring signals for engineering roles.',
  outreach_policy = '3-step email sequence. First touch introduces our dev tool, second touch shares a relevant case study, third touch asks for a brief chat.',
  messaging_policy = 'Professional, concise, peer-to-peer tone. Reference their tech stack. Keep under 80 words.',
  enabled_channels = '["email", "linkedin"]'::jsonb
WHERE id = '11111111-1111-1111-1111-111111111111';

-- Campaign 2: BFSI CIO India (Leave status paused)
UPDATE campaigns SET
  icp_criteria = 'CIOs at Indian banks and NBFCs.',
  exclusion_criteria = 'Exclude cooperative banks and microfinance institutions.',
  research_focus = 'Look for digital transformation initiatives, RBI compliance updates, and technology vendor relationships.',
  outreach_policy = '2-step email sequence. Focus on compliance and cost-saving angles.',
  messaging_policy = 'Formal tone. Reference regulatory environment. Under 80 words.',
  enabled_channels = '["email"]'::jsonb,
  status = 'paused'
WHERE id = '22222222-2222-2222-2222-222222222222';

-- Campaign 3: Voice AI Founders
UPDATE campaigns SET
  icp_criteria = 'Founders of conversational AI and voice tech startups.',
  exclusion_criteria = 'Exclude large enterprise AI divisions and hardware-focused companies.',
  research_focus = 'Look for product announcements, GitHub activity, YC/investor affiliations.',
  outreach_policy = 'Direct founder-to-founder email. Single touch with a calendar link if they engage.',
  messaging_policy = 'Technical, direct, casual. Mention a relevant technical insight. Under 70 words.',
  enabled_channels = '["email", "voice"]'::jsonb
WHERE id = '33333333-3333-3333-3333-333333333333';

-- Add prospects in 'discovered' state to campaigns 2 and 3
INSERT INTO prospects (id, first_name, last_name, email, company_name, title)
VALUES 
  ('00000000-0000-0000-0000-000000000100', 'Rajesh', 'Kumar', 'rajesh.kumar@indianbank.demo', 'Indian Bank Demo', 'CIO'),
  ('00000000-0000-0000-0000-000000000101', 'Alice', 'Founder', 'alice@voiceai.demo', 'Voice AI Startup', 'Founder & CEO');

INSERT INTO campaign_prospects (id, campaign_id, prospect_id, state)
VALUES 
  ('00000000-0000-0000-0001-000000000100', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000100', 'discovered'),
  ('00000000-0000-0000-0001-000000000101', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000101', 'discovered');
