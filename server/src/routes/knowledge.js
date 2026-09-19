import express from 'express';
import { asyncHandler, badRequest } from '../lib/http.js';
import { listKnowledge, addKnowledge, deleteKnowledge, retrieveForStep } from '../services/knowledge.js';

const router = express.Router();

// GET /knowledge?campaignId= — global chunks plus this campaign's own.
router.get('/', asyncHandler(async (req, res) => {
  res.json(await listKnowledge(req.query.campaignId ?? null));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { campaign_id: campaignId = null, type, title, content } = req.body ?? {};
  if (!type) throw badRequest('type is required, for example product, case_study, objection_handling');
  if (!content || !String(content).trim()) throw badRequest('content is required');
  res.status(201).json(await addKnowledge({ campaignId, type, title, content }));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await deleteKnowledge(req.params.id);
  res.json({ id: req.params.id, deleted: true });
}));

/**
 * POST /knowledge/search — shows what retrieval would return for a query.
 * Useful in a demo for making RAG visible rather than only claimed.
 */
router.post('/search', asyncHandler(async (req, res) => {
  const { campaign_id: campaignId, query, agent = 'personalisation', limit = 5 } = req.body ?? {};
  if (!query) throw badRequest('query is required');
  res.json(await retrieveForStep({ campaignId, agentName: agent, context: query, limit }));
}));

export default router;
