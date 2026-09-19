-- ==========================================
-- Phase 3 Seed Script - 10 Fresh Prospects
-- ==========================================

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enriched_data JSONB;

-- Use Campaign 1: '11111111-1111-1111-1111-111111111111'

-- ── 5 DISCOVERED PROSPECTS ──
INSERT INTO prospects (id, first_name, last_name, email, title, company_name, provenance) VALUES 
('00000000-0000-0000-0000-300000000001', 'Alice', 'Smith', 'alice.smith@example.com', 'CHRO', 'Initech', '{"role":"crm","company":"crm","email":"crm","title":"crm","phone":"crm"}'::jsonb),
('00000000-0000-0000-0000-300000000002', 'Bob', 'Jones', 'bob.jones@example.com', 'VP HR', 'Globex', '{"role":"crm","company":"crm","email":"crm","title":"crm","phone":"crm"}'::jsonb),
('00000000-0000-0000-0000-300000000003', 'Charlie', 'Brown', 'charlie.brown@example.com', 'Director of People', 'Soylent', '{"role":"crm","company":"crm","email":"crm","title":"crm","phone":"crm"}'::jsonb),
('00000000-0000-0000-0000-300000000004', 'Diana', 'Prince', 'diana.prince@example.com', 'Head of Talent', 'Wayne Ent', '{"role":"crm","company":"crm","email":"crm","title":"crm","phone":"crm"}'::jsonb),
('00000000-0000-0000-0000-300000000005', 'Evan', 'Wright', 'evan.wright@example.com', 'CHRO', 'Massive Dynamic', '{"role":"crm","company":"crm","email":"crm","title":"crm","phone":"crm"}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO campaign_prospects (id, campaign_id, prospect_id, state, last_touch_at) VALUES 
('00000000-0000-0000-0001-300000000001', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000001', 'discovered', NOW()),
('00000000-0000-0000-0001-300000000002', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000002', 'discovered', NOW()),
('00000000-0000-0000-0001-300000000003', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000003', 'discovered', NOW()),
('00000000-0000-0000-0001-300000000004', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000004', 'discovered', NOW()),
('00000000-0000-0000-0001-300000000005', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000005', 'discovered', NOW())
ON CONFLICT DO NOTHING;

-- ── 5 RESEARCHED PROSPECTS (WITH PRE-FILLED ENRICHMENT) ──
INSERT INTO prospects (id, first_name, last_name, email, title, company_name, provenance, enriched_data) VALUES 
('00000000-0000-0000-0000-300000000006', 'Fiona', 'Gallagher', 'fiona.g@example.com', 'VP HR', 'Acme Corp', '{"role":"crm"}'::jsonb, 
'{"person": {"full_name": "Fiona Gallagher", "title": "VP HR", "linkedin_url": "linkedin.com/in/fiona", "tenure_months": 24}, "company": {"name": "Acme Corp", "industry": "SaaS", "employee_count": 8500}, "signals": {"tech_stack": ["Workday"], "recent_news": "Acme Corp expands to EMEA"}}'::jsonb),

('00000000-0000-0000-0000-300000000007', 'George', 'Bluth', 'george.bluth@example.com', 'Director of People', 'Bluth Co', '{"role":"crm"}'::jsonb, 
'{"person": {"full_name": "George Bluth", "title": "Director of People", "linkedin_url": "linkedin.com/in/george", "tenure_months": 12}, "company": {"name": "Bluth Co", "industry": "Real Estate", "employee_count": 1200}, "signals": {"tech_stack": ["BambooHR"], "recent_news": "Bluth Co launches new subdivision"}}'::jsonb),

('00000000-0000-0000-0000-300000000008', 'Hannah', 'Montana', 'hannah.m@example.com', 'CHRO', 'Cyberdyne', '{"role":"crm"}'::jsonb, 
'{"person": {"full_name": "Hannah Montana", "title": "CHRO", "linkedin_url": "linkedin.com/in/hannah", "tenure_months": 48}, "company": {"name": "Cyberdyne", "industry": "Tech", "employee_count": 5500}, "signals": {"tech_stack": ["Workday", "Greenhouse"], "recent_news": "Cyberdyne AI division growth"}}'::jsonb),

('00000000-0000-0000-0000-300000000009', 'Ian', 'Malcolm', 'ian.m@example.com', 'VP HR', 'InGen', '{"role":"crm"}'::jsonb, 
'{"person": {"full_name": "Ian Malcolm", "title": "VP HR", "linkedin_url": "linkedin.com/in/ian", "tenure_months": 36}, "company": {"name": "InGen", "industry": "Biotech", "employee_count": 450}, "signals": {"tech_stack": ["Gusto"], "recent_news": "InGen secures Series C"}}'::jsonb),

('00000000-0000-0000-0000-300000000010', 'Jack', 'Bauer', 'jack.b@example.com', 'Head of People', 'CTU', '{"role":"crm"}'::jsonb, 
'{"person": {"full_name": "Jack Bauer", "title": "Head of People", "linkedin_url": "linkedin.com/in/jack", "tenure_months": 120}, "company": {"name": "CTU", "industry": "Security", "employee_count": 10000}, "signals": {"tech_stack": ["Workday"], "recent_news": "CTU upgrades internal comms"}}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO campaign_prospects (id, campaign_id, prospect_id, state, last_touch_at) VALUES 
('00000000-0000-0000-0001-300000000006', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000006', 'researched', NOW()),
('00000000-0000-0000-0001-300000000007', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000007', 'researched', NOW()),
('00000000-0000-0000-0001-300000000008', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000008', 'researched', NOW()),
('00000000-0000-0000-0001-300000000009', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000009', 'researched', NOW()),
('00000000-0000-0000-0001-300000000010', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-300000000010', 'researched', NOW())
ON CONFLICT DO NOTHING;
