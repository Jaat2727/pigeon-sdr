/**
 * Knowledge retrieval (RAG).
 *
 * Retrieval is lexical: BM25-style scoring over the campaign's knowledge
 * chunks, with a small boost for chunks whose type matches what the caller is
 * about to do. It is not embedding search, and it is not described as such
 * anywhere in the UI.
 *
 * That choice is deliberate. Embedding search needs a vector column, an
 * embedding provider and a backfill job; lexical retrieval over a few hundred
 * campaign chunks runs inside the existing Postgres and returns in a few
 * milliseconds. `retrieveForStep` returns the chunk objects themselves, which
 * the caller stores on the agent run, so the prospect timeline can show which
 * chunks produced which message. Swapping in pgvector later means replacing
 * `score()` and nothing else.
 */
import { supabase, unwrapSoft } from '../db/client.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'you', 'your', 'our', 'their', 'has', 'have', 'had', 'not', 'but', 'can',
  'will', 'would', 'should', 'about', 'into', 'over', 'they', 'them', 'its',
]);

function tokenise(text) {
  if (!text) return [];
  const flat = typeof text === 'string' ? text : JSON.stringify(text);
  return flat
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Chunk types that matter most for each pipeline step. */
const TYPE_PRIORITY = {
  icp_fitment: ['icp_definition', 'icp', 'persona'],
  personalisation: ['case_study', 'example_email', 'product', 'playbook', 'brand_voice'],
  conversation: ['objection_handling', 'faq', 'playbook', 'competitor'],
  outreach_strategy: ['playbook', 'sequence', 'icp_definition'],
  research: ['icp_definition', 'persona'],
};

function score(chunk, queryTokens, preferredTypes) {
  const chunkTokens = tokenise(`${chunk.title ?? ''} ${chunk.content ?? ''}`);
  if (chunkTokens.length === 0) return 0;

  const chunkSet = new Set(chunkTokens);
  let overlap = 0;
  for (const t of queryTokens) if (chunkSet.has(t)) overlap += 1;
  if (overlap === 0 && !preferredTypes.includes(chunk.type)) return 0;

  // Normalise by chunk length so a long document does not dominate on volume.
  const lengthNorm = 1 / Math.log2(chunkTokens.length + 2);
  const typeBoost = preferredTypes.includes(chunk.type) ? 1.6 : 1;

  return overlap * lengthNorm * typeBoost;
}

/**
 * @param {object} args
 * @param {string} args.campaignId
 * @param {string} args.agentName     pipeline step asking for context
 * @param {object} args.context       prospect profile, campaign policy, reply text…
 * @param {number} args.limit
 * @returns {Promise<Array<{id,type,title,content,score}>>}
 */
export async function retrieveForStep({ campaignId, agentName, context, limit = 4 }) {
  const res = await supabase
    .from('knowledge_chunks')
    .select('id, campaign_id, type, title, content, created_at')
    .or(`campaign_id.eq.${campaignId},campaign_id.is.null`);

  const chunks = unwrapSoft(res, [], 'knowledge_chunks');
  if (!chunks.length) return [];

  const queryTokens = tokenise(context);
  const preferred = TYPE_PRIORITY[agentName] ?? [];

  return chunks
    .map((c) => ({ ...c, score: Number(score(c, queryTokens, preferred).toFixed(4)) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      type: c.type,
      title: c.title ?? c.type ?? 'knowledge chunk',
      content: c.content,
      score: c.score,
      scope: c.campaign_id ? 'campaign' : 'global',
    }));
}

export async function listKnowledge(campaignId = null) {
  const query = supabase
    .from('knowledge_chunks')
    .select('id, campaign_id, type, title, content, created_at')
    .order('created_at', { ascending: false });

  const res = campaignId
    ? await query.or(`campaign_id.eq.${campaignId},campaign_id.is.null`)
    : await query;

  return unwrapSoft(res, [], 'knowledge_chunks').map((c) => ({
    id: c.id,
    campaign_id: c.campaign_id,
    scope: c.campaign_id ? 'campaign' : 'global',
    type: c.type,
    title: c.title ?? c.type ?? 'Untitled',
    content: c.content,
    excerpt: (c.content ?? '').length > 220 ? `${c.content.slice(0, 220).trimEnd()}…` : (c.content ?? ''),
    word_count: (c.content ?? '').split(/\s+/).filter(Boolean).length,
    created_at: c.created_at,
  }));
}

export async function addKnowledge({ campaignId = null, type, title, content }) {
  const res = await supabase
    .from('knowledge_chunks')
    .insert({ campaign_id: campaignId, type, title, content })
    .select()
    .single();
  return unwrapSoft(res, null, 'knowledge_chunks insert');
}

export async function deleteKnowledge(id) {
  const res = await supabase.from('knowledge_chunks').delete().eq('id', id).select('id').maybeSingle();
  return unwrapSoft(res, null, 'knowledge_chunks delete');
}
