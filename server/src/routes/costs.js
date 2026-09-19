import express from 'express';
import { asyncHandler } from '../lib/http.js';
import { computeCosts } from '../services/metrics.js';

const router = express.Router();

// GET /costs — spend, latency and token totals, all counted from agent_runs.
router.get('/', asyncHandler(async (req, res) => {
  res.json(await computeCosts());
}));

export default router;
