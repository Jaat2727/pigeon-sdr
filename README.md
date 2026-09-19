# Pigeon SDR

An autonomous Sales Development Representative. Agents research prospects, score them against a campaign ICP, plan a multi-channel sequence, write each message at send time, and classify replies. A human manager keeps a control plane with four independent levels of stopping.

Built for the Inter Guild Buildathon on top of the DronaHQ agentic platform.

---

## 1. What this is

Two halves that work as one product.

**The control plane** is where a manager creates, configures, launches, pauses and watches campaigns. Several campaigns run at once, each with its own ICP, its own prompts, its own channel mix and its own lifecycle state. Pausing one does not touch the others.

**The intelligence layer** is the agents that do the work inside those campaigns. Each agent does one job and hands off. None of them decide control flow: the orchestrator does that, so changing a prompt changes tone and judgement without changing what happens next.

The whole system is auditable. Every agent run records which engine produced it, which prompt version was active, what went in, what came out, which knowledge chunks it retrieved, and how many tokens it used. That is what makes "why did the agent do that" a question with an answer.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser · React + Vite                       (Vercel)       │
│  Control plane: campaigns, prospects, approvals, prompts,    │
│  conflicts, knowledge, agents, analytics                     │
└───────────────────────────┬──────────────────────────────────┘
                            │  HTTPS, JSON
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  API · Node + Express                         (Railway)      │
│                                                              │
│   routes/      HTTP surface, one file per resource           │
│   orchestrator gate.js  · four levels of stopping            │
│                index.js · the pipeline state machine         │
│   agents/      dronahq.js     · transport + envelope parsing │
│                schemas.js     · coercion + validation        │
│                localEngine.js · deterministic fallback       │
│                client.js      · one door for every call      │
│   services/    metrics, mappers, knowledge (RAG), escalations│
│   worker/      due-prospect sweeper, off by default          │
└──────┬─────────────────────────────────────┬─────────────────┘
       │                                     │
       │ webhook per agent                   │ service role
       ▼                                     ▼
┌────────────────────┐              ┌────────────────────────┐
│ DronaHQ            │              │ Supabase Postgres      │
│ Agents 1-5         │              │ campaigns, prospects,  │
│                    │              │ campaign_prospects,    │
│ Falls back to the  │              │ agent_runs, messages,  │
│ local engine when  │              │ escalations, conflicts,│
│ a call returns     │              │ prompt_versions,       │
│ nothing usable     │              │ knowledge_chunks, …    │
└────────────────────┘              └────────────────────────┘
```

The browser never talks to DronaHQ and never holds a service-role key. The API is the only component with credentials.

### The pipeline

```
discovered ──research──▶ researched ──icp_fitment──▶ qualified
                                          │              │
                                          ├─▶ rejected   │
                                          └─▶ needs_review ──▶ Approval Center
                                                         │
                                    outreach_strategy ◀──┘
                                          │
                                          ▼
                                  strategy_planned
                                          │
                                   personalisation
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                          contacted            needs_human ──▶ Approval Center
                              │
                        reply arrives
                              │
                        conversation
                              │
        ┌─────────┬───────────┼───────────┬──────────┐
        ▼         ▼           ▼           ▼          ▼
     meeting   engaged    contacted    rejected  suppressed
```

### The seven agents

| # | Agent | Engine | What it decides |
|---|-------|--------|-----------------|
| 1 | Lead Research | DronaHQ | Builds a structured profile. Reports every field it could not source rather than inventing one. |
| 2 | ICP Fitment | DronaHQ | Returns qualify, reject or needs_review. Exclusions are checked before scoring and override everything. |
| 3 | Outreach Strategy | DronaHQ | Decides whether, when and on which channels to make contact. Returns day offsets, never dates. |
| 4 | Personalisation | DronaHQ | Writes one message for one step at send time. Every claim cites a profile field or a knowledge chunk. |
| 5 | Conversation | DronaHQ | Classifies an inbound reply, extracts facts, recommends the next action. Opt-out overrides every other reading. |
| 6 | Follow-up Timing | Our engine | Decides when the next touch goes out, or that the sequence is finished. |
| 7 | Voice SDR | DronaHQ | Stretch. Call planning and gating are built; no telephony provider is connected, so no call is placed. |

Agent 6 runs in our own engine deliberately. Scheduling is deterministic, so a rule is better than a model: it is cheaper, faster, and a wrong answer is inspectable.

---

## 3. What works, what is partial, what is not built

Stated plainly, because a submission that claims everything is harder to trust than one that says where the edges are.

### Fully working

- Three concurrent campaigns with independent ICPs, prompts, channels, daily limits and lifecycle state. Pausing one leaves the others running.
- The full pipeline from discovered to contacted, driven from the UI or by the background worker.
- Three-state ICP verdicts. `needs_review` is a first-class state everywhere, not a variant of reject.
- Four levels of stopping: global kill switch, per-channel pause, per-agent pause (global and per campaign), per-campaign pause. All enforced in one gate before every action.
- Exclusion rules enforced from the database, not from the model: suppression list, existing customers, a 30-day cross-campaign cooldown, per-campaign and per-channel daily caps.
- Conflict detection when two live campaigns are actively working the same prospect, with outreach held until a human resolves it.
- The Approval Center, with real approve, edit and reject that write to the database and resume or stop the prospect.
- Prompt versioning per agent per campaign, with diff, activate and rollback. Every agent run records the version that produced it.
- Knowledge retrieval before every ICP scoring and every message, with the retrieved chunks stored on the run and shown beside the message on the prospect timeline.
- Provenance on every prospect fact: manual beats CRM beats AI-enriched, and the tag is displayed.
- Cost, token and latency accounting per run, per agent and per campaign.
- Reply classification with twelve intents, and an opt-out that suppresses the prospect across every campaign immediately.

### Partially working

- **Message delivery.** Messages are written, costed, recorded and shown in full, but nothing is transmitted. No SendGrid, Twilio or LinkedIn integration is wired. The Integrations screen says so rather than showing them as connected.
- **Voice.** Planned, gated and limited correctly, and never used as a first touch. The call itself is a labelled walkthrough on the Calls screen, not a recording.
- **Inbound replies.** There is a real endpoint (`POST /prospects/:id/reply`) that a mail or SMS webhook would call. In the demo a reply is injected through it by hand.
- **Retrieval.** Lexical BM25-style ranking over campaign knowledge chunks, not embedding search. It is described as lexical everywhere it appears. Swapping in pgvector means replacing one scoring function.

### Not built

- Prospect discovery. Prospects are seeded or imported; there is no Apollo or LinkedIn sourcing.
- CRM sync.
- Multi-tenant accounts and roles. Sign-in is optional and there is one workspace.
- LLM-as-judge evaluation of agent output.

---

## 4. The DronaHQ agents, and the null-response problem

The most common failure in this stack is an agent that looks configured and returns nothing usable. It shows up downstream as "the agent returns nulls". There are three distinct causes and they need different fixes.

### Cause 1: the webhook is in Background mode

This is the usual one. A DronaHQ agent webhook set to Background answers immediately with a run acknowledgement:

```json
{ "run_id": "...", "thread_id": "..." }
```

That is not agent output and no amount of parsing on this side can recover it. The fix is in DronaHQ, not in code:

1. Open the agent in DronaHQ.
2. Go to the **Webhook** trigger.
3. Open **Configure Response**.
4. Change the response type from **Background** to **Standard**.
5. Paste the agent's output JSON Schema into the response schema box.
6. Save and republish the agent.

The API detects this case explicitly and returns that instruction verbatim rather than a generic parse error.

### Cause 2: the output is wrapped or stringified

DronaHQ wraps the model output differently depending on how the agent is set up. All of these are handled and unwrapped to the same object:

```
{...}                          { "response": {...} }        { "output": {...} }
{ "result": {...} }            { "data": { "output": ... }} { "success": true, "data": {...} }
[ {...} ]                      { "response": "{\"...\"}" }  { "response": "```json\n{...}\n```" }
```

Prose around the JSON is handled too. So are numbers sent as strings, arrays sent as comma-separated text, and `"N/A"` or `"null"` sent where a null was meant.

### Cause 3: the model genuinely returned an empty object

Every agent declares which of its fields the pipeline cannot proceed without. If all of them come back null, the response is treated as a failure rather than written to the database as a real result. The call is retried once with the validation error appended, and if it fails again the local engine answers instead.

### Diagnosing it from the deployed app

Open **Agents**, click **View details** on any agent, and press **Send a test call**. It fires one real request at the configured webhook and shows:

- whether the webhook is configured at all
- whether it was reachable, and how long it took
- the exact body that came back, after unwrapping
- which schema field failed, if the shape was wrong
- the specific fix for that failure

Nothing is written to the database by a test call.

You can also check routing without opening the UI:

```bash
curl https://your-api.up.railway.app/agents/routing
```

### The fallback engine

When a DronaHQ call fails, times out, is not configured, or returns nothing usable, a deterministic local engine answers so the pipeline keeps moving. Three rules hold:

1. It never invents facts about a prospect. It reasons only over values already in the database or already returned by research.
2. Every run is recorded with `engine: 'local_engine'`, and the UI badges it as **Fallback** in amber. You can always tell a model decision from a rule decision.
3. When it cannot decide with the data it has, it returns `needs_review` or `needs_human` rather than guessing.

It is rule-based, not a second model. A rule that is wrong is inspectable; a second model that is wrong is not.

Set `LOCAL_ENGINE_ENABLED=false` to make a failed DronaHQ call an error instead.

---

## 5. Deploying

Three services in this order: database, then API, then frontend. Roughly fifteen minutes.

### Step 1 · Supabase

1. Create a project at [supabase.com](https://supabase.com), or open your existing one.
2. Open the **SQL Editor**.
3. Paste and run `server/db/migrations/004-pigeon-sdr-fixes.sql`.

   It is safe on a database that already has data. Every table is `CREATE TABLE IF NOT EXISTS` and every column is `ADD COLUMN IF NOT EXISTS`. Nothing is dropped, nothing is renamed, no column type is changed. It is also safe to run twice.

4. Optional: run `server/db/seed/001-demo-data.sql` to load the three demo campaigns, ten prospects, nineteen prompt versions and ten knowledge chunks. Also idempotent.
5. Go to **Project Settings → API** and copy:
   - the **Project URL**
   - the **service_role** key (the secret one, not `anon`)

The service_role key must never reach the browser. It goes in the API environment only.

### Step 2 · Railway (the API)

1. Push this repository to GitHub.
2. In Railway, create a project from that repository.
3. Set the service **root directory** to `server`.
4. Add these variables under **Variables**:

   ```
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   CORS_ORIGINS=http://localhost:5173
   NODE_ENV=production
   ```

   Leave `CORS_ORIGINS` for now. You will add the Vercel URL in step 4.

5. Deploy. Railway reads `server/railway.json` and `server/nixpacks.toml`, runs `npm start`, and health-checks `/health`.
6. Open `https://your-api.up.railway.app/health`. You want `"status": "ok"` and `"database": "connected"`.
7. Open `https://your-api.up.railway.app/health/schema`. You want `"ok": true` with no missing tables.

If either is wrong, the response says which variable is missing or which table is absent. The server starts either way rather than crash-looping, so it can tell you what is wrong.

### Step 3 · Vercel (the frontend)

1. In Vercel, import the same repository.
2. Leave the root directory as the repository root. `vercel.json` sets the framework, build command and SPA rewrites.
3. Add one variable under **Settings → Environment Variables**:

   ```
   VITE_API_BASE_URL=https://your-api.up.railway.app
   ```

   No trailing slash.

4. Deploy, then copy the production URL.

Vite inlines `VITE_*` values at build time. Changing this variable later does nothing until you redeploy.

### Step 4 · Close the loop

Go back to Railway and set `CORS_ORIGINS` to include your Vercel URL:

```
CORS_ORIGINS=https://your-app.vercel.app,http://localhost:5173
```

Railway redeploys. Open the Vercel URL. If the API is reachable the app loads with live data. If it is not, a banner says exactly what is wrong instead of showing sample data.

Preview deployments on `*.vercel.app` are allowed automatically once one `vercel.app` origin is listed.

### Step 5 · DronaHQ agents (optional but expected)

The system runs without DronaHQ on the local engine, and says so in the UI. To wire the real agents, add to Railway:

```
DRONAHQ_API_KEY=your-key
DRONAHQ_RESEARCH_URL=https://...
DRONAHQ_ICP_URL=https://...
DRONAHQ_STRATEGY_URL=https://...
DRONAHQ_PERSONALISATION_URL=https://...
DRONAHQ_CONVERSATION_URL=https://...
```

Use per-agent keys (`DRONAHQ_RESEARCH_KEY` and so on) only if an agent uses a different key.

Then open **Agents** in the app and send a test call to each one. Section 4 covers what the results mean.

---

## 6. Running locally

```bash
# once
npm run setup          # installs both halves

# terminal 1 — API on :3001
cp server/.env.example server/.env    # fill in SUPABASE_URL and the service role key
npm run server

# terminal 2 — frontend on :5173
cp .env.example .env                  # set VITE_API_BASE_URL=http://localhost:3001
npm run dev
```

There is deliberately no dev proxy. The deployed app talks to the API cross-origin, and a proxy here would hide a broken CORS setup until production.

---

## 7. Environment variables

### Frontend (`.env`, and Vercel)

| Variable | Required | What it does |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | The API base URL, no trailing slash. Without it the app shows a configuration banner and loads nothing. |
| `VITE_SUPABASE_URL` | No | Enables Supabase sign-in. Leave blank to run in open-access mode. |
| `VITE_SUPABASE_ANON_KEY` | No | The anon key, paired with the above. Never the service role key. |

### API (`server/.env`, and Railway)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `SUPABASE_URL` | Yes | | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | | Service role key. Server side only. |
| `CORS_ORIGINS` | Yes in production | localhost | Comma-separated browser origins allowed to call the API. |
| `PORT` | No | `3001` | Railway sets this itself. |
| `HOST` | No | `0.0.0.0` | Leave as is on Railway. |
| `NODE_ENV` | No | `development` | Hides stack traces when set to `production`. |
| `DRONAHQ_API_KEY` | No | | One key for every agent. |
| `DRONAHQ_RESEARCH_URL` | No | | Webhook for agent 1. |
| `DRONAHQ_ICP_URL` | No | | Webhook for agent 2. |
| `DRONAHQ_STRATEGY_URL` | No | | Webhook for agent 3. |
| `DRONAHQ_PERSONALISATION_URL` | No | | Webhook for agent 4. |
| `DRONAHQ_CONVERSATION_URL` | No | | Webhook for agent 5. |
| `DRONAHQ_<AGENT>_KEY` | No | | Per-agent key, if it differs from `DRONAHQ_API_KEY`. |
| `LOCAL_ENGINE_ENABLED` | No | `true` | `false` makes a failed DronaHQ call an error instead of a fallback. |
| `WORKER_ENABLED` | No | `false` | Turns on the background sweeper. Off by default so a demo does not spend budget between takes. |
| `WORKER_POLL_MS` | No | `30000` | How often the sweeper runs. |
| `WORKER_BATCH_SIZE` | No | `5` | Prospects advanced per sweep. |
| `AGENT_TIMEOUT_MS` | No | `45000` | How long to wait for a DronaHQ response. |
| `MAX_AGENT_CALLS_PER_DAY` | No | `200` | Spend guardrail. |
| `COST_PER_1K_TOKENS_USD` | No | `0.015` | Used to attribute cost when the provider reports none. |

---

## 8. Folder structure

```
.
├── src/                          Frontend (React + Vite)
│   ├── api/
│   │   ├── client.js             Axios instance, error shaping, health probe
│   │   └── index.js              One function per backend route
│   ├── components/index.jsx      Shared components: badges, states, drawers, banners
│   ├── context/AppContext.jsx    Connection status, stop controls, campaigns, counts
│   ├── layouts/                  Shell: sidebar, top bar, status bar, banners
│   ├── pages/                    One file per screen, each with its own CSS
│   ├── supabaseClient.js         Auth only. Never reads application data.
│   └── tokens.css                Design tokens
│
├── server/                       API (Node + Express)
│   ├── src/
│   │   ├── agents/
│   │   │   ├── registry.js       Canonical agent identity. One source of truth.
│   │   │   ├── dronahq.js        HTTP transport, envelope unwrapping, async-ack detection
│   │   │   ├── schemas.js        Coercion then validation, per agent
│   │   │   ├── localEngine.js    Deterministic fallback for all seven agents
│   │   │   └── client.js         The one door every agent call goes through
│   │   ├── orchestrator/
│   │   │   ├── gate.js           Four levels of stopping plus database exclusions
│   │   │   └── index.js          The pipeline state machine
│   │   ├── services/
│   │   │   ├── metrics.js        Every figure counted from a table
│   │   │   ├── mappers.js        Database shape to API shape, in one place
│   │   │   ├── knowledge.js      Retrieval and the knowledge corpus
│   │   │   └── escalations.js    Escalations, activity log, conflict detection
│   │   ├── routes/               One file per resource
│   │   ├── worker/index.js       Due-prospect sweeper
│   │   ├── db/client.js          Supabase client, degrades instead of crashing
│   │   ├── lib/http.js           asyncHandler and the central error shape
│   │   ├── config.js             Every environment variable, declared once
│   │   └── index.js              Boot, CORS, middleware, graceful shutdown
│   ├── db/
│   │   ├── migrations/           Idempotent, additive schema
│   │   ├── seed/                 Demo data
│   │   └── legacy/               Superseded SQL, kept for history. Do not run.
│   └── scripts/
│       ├── verify-agent-layer.js Offline checks for parsing and the local engine
│       ├── smoke-test.js         Every read endpoint against a deployment
│       └── integration-test.js   End-to-end behaviour against a live API
│
├── vercel.json                   Build, output and SPA rewrites
├── server/railway.json           Start command and health check
└── server/nixpacks.toml          Pinned Node 20 build plan
```

Why the split: judges assess repo organisation, and more practically, the separation is what lets the agent layer be tested with no database and the orchestrator be read without wading through HTTP handling.

---

## 9. Tests

Three scripts, each answering a different question.

```bash
# 1. Does the agent layer handle real DronaHQ responses?
#    Offline. No database, no network. 59 checks.
node server/scripts/verify-agent-layer.js
```

Covers every response envelope shape, all-null detection, string-to-number coercion, stringified arrays, verdict synonyms, and that every local engine output passes its own schema. It also pins two false-exclusion bugs that a naive keyword matcher hits: a word shared with the ICP criteria must not trigger a reject, and "outside India" must not reject prospects in India.

```bash
# 2. Does a deployment answer every endpoint the UI needs?
node server/scripts/smoke-test.js https://your-api.up.railway.app
```

Checks all nineteen read endpoints, validates the response shape of each, and reports which agents will run on the local engine.

```bash
# 3. Does the system actually behave the way the brief requires?
node server/scripts/integration-test.js https://your-api.up.railway.app
```

Forty-nine assertions against a live API: three campaigns with different ICPs and prompts, a prospect moving through the pipeline, pausing one campaign without touching another, all four stop levels, a reply being classified, an opt-out suppressing a prospect everywhere, an escalation being approved and leaving the queue, a conflict being resolved. It writes real rows, so point it at a demo database. It restores every campaign's status when it finishes.

```bash
npm run lint      # frontend and API, zero errors
npm run build     # production build
```

---

## 10. Driving the demo

The background worker is off by default so a demo does not spend model budget between takes. The pipeline is driven from the UI.

1. Open **Campaigns**. Three campaigns: two live, one paused.
2. Open a live campaign and press **Run pipeline**. It advances up to three prospects one step each.
3. Press it a few more times. Prospects move discovered → researched → qualified → contacted, and the activity feed fills.
4. Open a prospect. The timeline shows each agent, which engine produced it, the prompt version, the knowledge chunks retrieved, and the tokens and cost.
5. Open **Approvals**. Jordan Pace is there because the ICP agent had too little data to score him. Dana Okonkwo is there because the personalisation agent refused to write filler with nothing specific to say.
6. Open **Conflicts**. Nadia Rahman qualifies for two live campaigns, so outreach on her is held until you decide which one keeps her.
7. Press **Pause** on one campaign, then **Run** the other. Only the running one advances.
8. Press **Kill All** in the top bar. Every campaign stops and scheduled actions are cleared. Release it and campaigns resume one at a time.

Turn the worker on with `WORKER_ENABLED=true` when you want it running unattended.

---

## 11. Notes on how things are measured

- Every number on the dashboard and in Analytics is counted from a table. Nothing is estimated.
- The one exception is pipeline value, which assumes a figure per booked meeting. It is labelled as modelled wherever it appears and the assumption is returned by the API alongside the number.
- Runs served by the local engine are costed at zero, because they make no external model call.
- Cost per run uses the provider's reported usage when there is one, and a token estimate otherwise.
- The funnel is cumulative: a prospect that reached `contacted` is counted in every earlier stage.

---

## 12. Security

- The service-role key lives only in the API environment. The browser never sees it.
- The API is the only component holding DronaHQ credentials.
- Only an allow-list of columns can be written through the campaigns API. Anything else in a request body is dropped.
- Exclusion rules are enforced with SQL predicates rather than by asking a model to remember them. A model can be talked out of a rule; a `where` clause cannot.
- Opt-out writes to the suppression list immediately and applies to every campaign, not just the one that received the reply.
- Row level security is not enabled on these tables. The API connects with the service role and bypasses it either way. If you turn RLS on for anon access, write the policies deliberately: `prospects` holds contact data.

---

## 13. Known limitations

- **No delivery.** Messages are produced and recorded, not sent.
- **Retrieval is lexical.** Good enough for a few hundred campaign chunks, and honest about what it is. pgvector is a one-function change.
- **One workspace.** No tenancy, no roles. Sign-in is optional.
- **The worker is single-process.** Two API instances would both sweep. For more than one instance, add an advisory lock or move the sweeper to its own service.
- **Conflict resolution is manual by design.** The system detects and holds; a human decides. Automatic resolution was deliberately not built, because picking a winner silently is how a prospect gets two emails.
- **Voice is not connected.** Everything except the telephony leg is built.
