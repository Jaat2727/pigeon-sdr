import express from 'express';
import { supabase, unwrap, unwrapSoft } from '../db/client.js';
import { asyncHandler, notFound, badRequest, parseLimit } from '../lib/http.js';
import { mapEscalation } from '../services/mappers.js';
import { advance } from '../orchestrator/index.js';
import { logActivity } from '../services/escalations.js';

const router = express.Router();

// GET /escalations?status=pending
router.get('/', asyncHandler(async (req, res) => {
  const rows = unwrapSoft(
    await supabase
      .from('escalations')
      .select('*, prospects(first_name, last_name, company_name), campaigns(name)')
      .eq('status', req.query.status ?? 'pending')
      .order('created_at', { ascending: false })
      .limit(parseLimit(req.query.limit, 100)),
    [],
    'escalations'
  );
  res.json(rows.map(mapEscalation));
}));

/**
 * POST /escalations/:id/resolve
 *
 * This route did not exist, so the Approval Center's Approve and Reject
 * buttons removed the row from local state and nothing was written. Approving
 * now resumes the prospect where the agent stopped; rejecting stops that
 * prospect without touching the rest of the campaign. Either way the decision,
 * who made it and any edited copy are recorded.
 */
router.post('/:id/resolve', asyncHandler(async (req, res) => {
  const { action, note = null, edited_content: editedContent = null, resolved_by: resolvedBy = 'Operator' } =
    req.body ?? {};

  const VALID = ['approved', 'rejected', 'dismissed'];
  if (!VALID.includes(action)) {
    throw badRequest(`action must be one of: ${VALID.join(', ')}`);
  }

  const escalation = unwrapSoft(
    await supabase.from('escalations').select('*').eq('id', req.params.id).maybeSingle(),
    null,
    'escalations'
  );
  if (!escalation) throw notFound(`Escalation ${req.params.id} does not exist`);
  if (escalation.status !== 'pending') {
    throw badRequest(`This escalation was already ${escalation.status}`);
  }

  const updated = unwrap(
    await supabase
      .from('escalations')
      .update({
        status: action,
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
        resolution_note: note ?? (editedContent ? 'Approved with edits' : null),
        proposed_payload: editedContent
          ? { ...(escalation.proposed_payload ?? {}), edited_content: editedContent }
          : escalation.proposed_payload,
      })
      .eq('id', req.params.id)
      .select()
      .single(),
    'escalations resolve'
  );

  let pipeline = null;

  if (action === 'approved' && escalation.campaign_id && escalation.prospect_id) {
    // An approved ICP review means the human is overriding needs_review to
    // qualified, which is what lets the prospect continue down the pipeline.
    if (escalation.escalation_type === 'needs_review') {
      await supabase
        .from('campaign_prospects')
        .update({ state: 'qualified', icp_verdict: 'qualify', next_action_at: new Date().toISOString() })
        .eq('campaign_id', escalation.campaign_id)
        .eq('prospect_id', escalation.prospect_id);
    } else {
      await supabase
        .from('campaign_prospects')
        .update({ next_action_at: new Date().toISOString() })
        .eq('campaign_id', escalation.campaign_id)
        .eq('prospect_id', escalation.prospect_id);
    }

    pipeline = await advance(escalation.campaign_id, escalation.prospect_id, { force: true });
  }

  if (action === 'rejected' && escalation.campaign_id && escalation.prospect_id) {
    await supabase
      .from('campaign_prospects')
      .update({ state: 'stopped', next_action_at: null, no_contact_reason: note ?? 'Rejected at human review' })
      .eq('campaign_id', escalation.campaign_id)
      .eq('prospect_id', escalation.prospect_id);
  }

  await logActivity({
    campaignId: escalation.campaign_id,
    prospectId: escalation.prospect_id,
    agentName: 'system',
    action: `Escalation ${action}`,
    outcome: `${resolvedBy} ${action} the ${escalation.escalation_type} raised by ${escalation.source_agent}`,
    status: 'success',
    prospectName: escalation.prospect_name,
    metadata: { escalation_id: escalation.id, action, note },
  });

  res.json({ escalation: mapEscalation(updated), pipeline });
}));

export default router;
