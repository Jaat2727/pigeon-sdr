import express from 'express';
import { supabase, unwrap, unwrapSoft } from '../db/client.js';
import { asyncHandler, notFound, badRequest, parseLimit } from '../lib/http.js';
import { mapConflict } from '../services/mappers.js';
import { logActivity } from '../services/escalations.js';

const router = express.Router();

async function campaignsById() {
  const rows = unwrapSoft(await supabase.from('campaigns').select('id, name, colour'), [], 'campaigns');
  return new Map(rows.map((c) => [c.id, c]));
}

// GET /conflicts?status=pending
router.get('/', asyncHandler(async (req, res) => {
  const rows = unwrapSoft(
    await supabase
      .from('conflicts')
      .select('*, prospects(first_name, last_name, company_name)')
      .eq('status', req.query.status ?? 'pending')
      .order('created_at', { ascending: false })
      .limit(parseLimit(req.query.limit, 100)),
    [],
    'conflicts'
  );

  const byId = await campaignsById();
  res.json(rows.map((row) => mapConflict(row, byId)));
}));

/**
 * POST /conflicts/:id/resolve
 *
 * Another route the UI called that was never implemented. Resolution decides
 * which campaign keeps the prospect. The losing campaigns stop working that
 * prospect immediately; they are not deleted, so their history stays intact
 * and the decision is reversible by a human.
 *
 * body: { campaign_id } to keep one campaign,
 *       or { resolution: 'suppress_both' | 'allow_both' }
 */
router.post('/:id/resolve', asyncHandler(async (req, res) => {
  const { campaign_id: winnerId, resolution, resolved_by: resolvedBy = 'Operator' } = req.body ?? {};

  const conflict = unwrapSoft(
    await supabase.from('conflicts').select('*').eq('id', req.params.id).maybeSingle(),
    null,
    'conflicts'
  );
  if (!conflict) throw notFound(`Conflict ${req.params.id} does not exist`);
  if (conflict.status !== 'pending') throw badRequest(`This conflict was already ${conflict.status}`);

  const involved = conflict.campaign_ids ?? [];
  let winner = null;
  let losers = [];
  let mode;

  if (resolution === 'suppress_both') {
    mode = 'suppress_both';
    losers = involved;
  } else if (resolution === 'allow_both') {
    mode = 'allow_both';
  } else {
    if (!winnerId) {
      throw badRequest(
        'Provide campaign_id (the campaign that keeps this prospect), or resolution set to suppress_both or allow_both'
      );
    }
    if (!involved.includes(winnerId)) {
      throw badRequest('campaign_id must be one of the campaigns in this conflict', { involved });
    }
    mode = 'keep_one';
    winner = winnerId;
    losers = involved.filter((id) => id !== winnerId);
  }

  // Stop the losing campaigns from working this prospect.
  if (losers.length) {
    await supabase
      .from('campaign_prospects')
      .update({
        state: 'stopped',
        next_action_at: null,
        should_contact: false,
        no_contact_reason:
          mode === 'suppress_both'
            ? 'Suppressed by a human while resolving a multi-campaign conflict'
            : 'Another campaign was given priority for this prospect',
      })
      .eq('prospect_id', conflict.prospect_id)
      .in('campaign_id', losers);
  }

  // Let the winner continue.
  if (winner) {
    await supabase
      .from('campaign_prospects')
      .update({ next_action_at: new Date().toISOString(), should_contact: true, no_contact_reason: null })
      .eq('prospect_id', conflict.prospect_id)
      .eq('campaign_id', winner);
  }

  if (mode === 'allow_both') {
    await supabase
      .from('campaign_prospects')
      .update({ next_action_at: new Date().toISOString() })
      .eq('prospect_id', conflict.prospect_id)
      .in('campaign_id', involved);
  }

  const updated = unwrap(
    await supabase
      .from('conflicts')
      .update({
        status: 'resolved',
        resolved_campaign_id: winner,
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('*, prospects(first_name, last_name, company_name)')
      .single(),
    'conflicts resolve'
  );

  const byId = await campaignsById();

  await logActivity({
    campaignId: winner ?? involved[0] ?? null,
    prospectId: conflict.prospect_id,
    agentName: 'system',
    action: 'Conflict resolved',
    outcome:
      mode === 'keep_one'
        ? `${resolvedBy} gave "${byId.get(winner)?.name ?? winner}" priority for this prospect`
        : mode === 'suppress_both'
          ? `${resolvedBy} suppressed this prospect across all conflicting campaigns`
          : `${resolvedBy} allowed all campaigns to continue contacting this prospect`,
    status: 'success',
    prospectName: conflict.prospect_name,
    metadata: { mode, winner, losers },
  });

  res.json({ conflict: mapConflict(updated, byId), mode, winner, losers });
}));

export default router;
