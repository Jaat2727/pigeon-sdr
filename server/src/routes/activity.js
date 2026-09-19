import express from 'express';
import { supabase, unwrapSoft } from '../db/client.js';
import { asyncHandler, parseLimit } from '../lib/http.js';
import { mapActivity } from '../services/mappers.js';

const router = express.Router();

// GET /activity — the live feed across every campaign.
router.get('/', asyncHandler(async (req, res) => {
  let query = supabase
    .from('activities')
    .select('*, campaigns(name, colour)')
    .order('created_at', { ascending: false })
    .limit(parseLimit(req.query.limit, 50, 300));

  if (req.query.campaignId) query = query.eq('campaign_id', req.query.campaignId);
  if (req.query.agent) query = query.eq('agent_name', req.query.agent);
  if (req.query.status) query = query.eq('status', req.query.status);

  const rows = unwrapSoft(await query, [], 'activities');
  res.json(rows.map(mapActivity));
}));

export default router;
