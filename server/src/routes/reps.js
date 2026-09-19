import express from 'express';
import { supabase, unwrap, unwrapSoft } from '../db/client.js';
import { asyncHandler, badRequest } from '../lib/http.js';

const router = express.Router();

// GET /reps — sales reps whose identity is used for outreach.
router.get('/', asyncHandler(async (req, res) => {
  const rows = unwrapSoft(
    await supabase.from('reps').select('*, campaign_reps(campaign_id)').order('full_name'),
    [],
    'reps'
  );
  res.json(
    rows.map((r) => ({
      ...r,
      campaign_ids: (r.campaign_reps ?? []).map((c) => c.campaign_id),
      campaign_count: (r.campaign_reps ?? []).length,
    }))
  );
}));

router.post('/', asyncHandler(async (req, res) => {
  const { full_name: fullName, email, title = null, linkedin_url: linkedinUrl = null } = req.body ?? {};
  if (!fullName || !email) throw badRequest('full_name and email are required');
  const row = unwrap(
    await supabase
      .from('reps')
      .insert({ full_name: fullName, email, title, linkedin_url: linkedinUrl, is_active: true })
      .select()
      .single(),
    'reps insert'
  );
  res.status(201).json(row);
}));

/**
 * PATCH /reps/:id — used to deactivate a rep. Deactivating surfaces every
 * campaign they are assigned to so an admin can reassign, which is what the
 * offboarding requirement asks for.
 */
router.patch('/:id', asyncHandler(async (req, res) => {
  const patch = {};
  for (const key of ['full_name', 'email', 'title', 'linkedin_url', 'is_active']) {
    if (req.body?.[key] !== undefined) patch[key] = req.body[key];
  }
  if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');

  const row = unwrap(
    await supabase.from('reps').update(patch).eq('id', req.params.id).select().single(),
    'reps update'
  );

  let affectedCampaigns = [];
  if (patch.is_active === false) {
    affectedCampaigns = unwrapSoft(
      await supabase.from('campaign_reps').select('campaign_id, campaigns(name, status)').eq('rep_id', req.params.id),
      [],
      'campaign_reps'
    ).map((c) => ({
      campaign_id: c.campaign_id,
      campaign_name: c.campaigns?.name ?? null,
      campaign_status: c.campaigns?.status ?? null,
    }));
  }

  res.json({ rep: row, affected_campaigns: affectedCampaigns });
}));

// POST /reps/:id/assign — attach or detach a rep from a campaign.
router.post('/:id/assign', asyncHandler(async (req, res) => {
  const { campaign_id: campaignId, assigned = true } = req.body ?? {};
  if (!campaignId) throw badRequest('campaign_id is required');

  if (assigned) {
    const { error } = await supabase
      .from('campaign_reps')
      .upsert({ campaign_id: campaignId, rep_id: req.params.id }, { onConflict: 'campaign_id,rep_id' });
    if (error && error.code !== '23505') throw error;
  } else {
    await supabase.from('campaign_reps').delete().eq('campaign_id', campaignId).eq('rep_id', req.params.id);
  }

  res.json({ rep_id: req.params.id, campaign_id: campaignId, assigned: Boolean(assigned) });
}));

export default router;
