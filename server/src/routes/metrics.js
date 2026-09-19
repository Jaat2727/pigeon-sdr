import express from 'express';
import { asyncHandler } from '../lib/http.js';
import {
  computeGlobalMetrics,
  computeChannelMetrics,
  computeAgentPerformance,
} from '../services/metrics.js';

const router = express.Router();

// GET /metrics/global
router.get('/global', asyncHandler(async (req, res) => {
  res.json(await computeGlobalMetrics());
}));

// GET /metrics/channels — counted from the messages table, not assumed.
router.get('/channels', asyncHandler(async (req, res) => {
  res.json(await computeChannelMetrics(req.query.campaignId ?? null));
}));

// GET /metrics/agents
router.get('/agents', asyncHandler(async (req, res) => {
  res.json(await computeAgentPerformance(req.query.campaignId ?? null));
}));

export default router;
