import express from 'express';
import { supabase, unwrap, unwrapSoft } from '../db/client.js';
import { asyncHandler, notFound, parseLimit } from '../lib/http.js';
import { mapPromptVersion } from '../services/mappers.js';
import { logActivity } from '../services/escalations.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  let query = supabase
    .from('prompt_versions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(parseLimit(req.query.limit, 200, 1000));

  if (req.query.campaignId) query = query.eq('campaign_id', req.query.campaignId);
  if (req.query.agent) query = query.eq('agent_name', req.query.agent);

  res.json(unwrapSoft(await query, [], 'prompt_versions').map(mapPromptVersion));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = unwrapSoft(
    await supabase.from('prompt_versions').select('*').eq('id', req.params.id).maybeSingle(),
    null,
    'prompt_versions'
  );
  if (!row) throw notFound(`Prompt version ${req.params.id} does not exist`);
  res.json(mapPromptVersion(row));
}));

/**
 * POST /prompts/:id/activate
 *
 * Activation is scoped to one agent within one campaign, which is what keeps
 * campaigns isolated: rolling back the ICP prompt on the US SaaS campaign
 * cannot change how the BFSI campaign scores anybody. The same route serves
 * rollback, because rolling back is activating an older version.
 */
router.post('/:id/activate', asyncHandler(async (req, res) => {
  const target = unwrapSoft(
    await supabase.from('prompt_versions').select('*').eq('id', req.params.id).maybeSingle(),
    null,
    'prompt_versions'
  );
  if (!target) throw notFound(`Prompt version ${req.params.id} does not exist`);

  const previous = unwrapSoft(
    await supabase
      .from('prompt_versions')
      .select('version')
      .eq('campaign_id', target.campaign_id)
      .eq('agent_name', target.agent_name)
      .eq('is_active', true)
      .maybeSingle(),
    null,
    'prompt_versions'
  );

  await supabase
    .from('prompt_versions')
    .update({ is_active: false })
    .eq('campaign_id', target.campaign_id)
    .eq('agent_name', target.agent_name);

  const row = unwrap(
    await supabase
      .from('prompt_versions')
      .update({ is_active: true })
      .eq('id', req.params.id)
      .select()
      .single(),
    'prompt_versions activate'
  );

  const isRollback = previous && previous.version > target.version;

  await logActivity({
    campaignId: target.campaign_id,
    agentName: target.agent_name,
    action: isRollback ? 'Prompt rolled back' : 'Prompt version activated',
    outcome:
      `${target.agent_name} now runs on v${target.version}` +
      (previous ? ` (was v${previous.version})` : '') +
      '. Agent runs from here on record this version.',
    status: 'success',
    metadata: {
      agent: target.agent_name,
      to_version: target.version,
      from_version: previous?.version ?? null,
      rollback: Boolean(isRollback),
    },
  });

  res.json(mapPromptVersion(row));
}));

export default router;
