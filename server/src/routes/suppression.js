import express from 'express';
import { supabase, unwrap, unwrapSoft } from '../db/client.js';
import { asyncHandler, badRequest } from '../lib/http.js';

const router = express.Router();

// GET /suppression — the do-not-contact list the gate enforces.
router.get('/', asyncHandler(async (req, res) => {
  res.json(
    unwrapSoft(
      await supabase.from('suppression_list').select('*').order('created_at', { ascending: false }),
      [],
      'suppression_list'
    )
  );
}));

router.post('/', asyncHandler(async (req, res) => {
  const { email = null, domain = null, phone = null, reason, added_by: addedBy = 'Operator' } = req.body ?? {};
  if (!email && !domain && !phone) {
    throw badRequest('Provide at least one of email, domain or phone');
  }
  if (!reason) throw badRequest('reason is required — a suppression entry should say why it exists');

  const row = unwrap(
    await supabase
      .from('suppression_list')
      .insert({ email, domain, phone, reason, added_by: addedBy })
      .select()
      .single(),
    'suppression_list insert'
  );
  res.status(201).json(row);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await supabase.from('suppression_list').delete().eq('id', req.params.id);
  res.json({ id: req.params.id, deleted: true });
}));

export default router;
