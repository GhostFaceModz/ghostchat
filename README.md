# GhostChat

A premium, embeddable AI chatbot any website owner can add with one script tag. It answers questions about **their own site** using retrieval over content crawled or uploaded by the owner — and says “I’m not sure” instead of making things up.

GhostChat is a GhostApps project. This repo is the v1: API, widget, dashboard, and shareable chat link.

## One-line embed

```html
<script src="https://YOUR_GHOSTCHAT_HOST/widget.js" data-id="SITE_KEY"></script>
```

Optional data attributes: `data-theme="dark|light"`, `data-primary="#a78bfa"`, `data-greeting="…"`, `data-delay="4000"`, `data-sound="true"`, `data-open="true"`.

The widget also picks up theme, greeting, starter questions, and branding from the dashboard via `/api/widget/config/:siteKey`.

## What v1 includes

### Widget
- Animated ghost mascot (idle float + thinking)
- Glassmorphism chat panel
- Dark / light / custom brand colour
- Streaming word-by-word replies, typing indicator
- Markdown and code-block rendering
- Quick-reply suggestion chips and follow-up questions
- Source chips under answers (the page the context came from)
- Optional sound toggle and a proactive greeting after a delay
- “I’m not sure” plus an in-chat email handoff when there’s no good context
- 👍 / 👎 on answers
- “Powered by GhostChat” badge (Pro and Business can hide it)

### Dashboard
- Email sign-in, add a site, copy `SITE_KEY` and the embed snippet
- Train from a site crawl (including `sitemap.xml`) plus uploaded or pasted `.txt` / `.md` / `.html` / `.csv`
- Persona, tone, greeting, starter questions, guardrails, and banned topics
- Starter templates: Support, Sales, and Docs bots
- Theme, sound default, branding toggle
- Transcripts, top questions, unanswered gaps, 👍/👎 satisfaction
- Pages driving questions (counts by page URL)
- Captured leads, with the chat transcript attached
- Shareable public chat link (`/c/SITE_KEY`) and a downloadable QR code
- Usage meter with Free / Pro / Business limits (ready for Whop)

### Backend
- Retrieval over `pgvector` (default embedding: `text-embedding-3-small`, 1536 dimensions)
- Cheap default chat model: `gpt-4o-mini`, over any OpenAI-compatible API (OpenAI, Groq, OpenRouter, xAI, …)
- Prompt-injection and banned-topic guardrails
- Rate limiting, SSRF-safe crawler (public http/https only, no private IPs)
- PII redaction in stored logs (email, phone, cards, and similar)
- Per-site data isolation (`site_id` on every row and in the match function)
- Monthly usage metering fields for Whop tiers

## Local development

Needs Node 20+ and the env vars in `.env.example`.

```bash
cp .env.example .env
# fill SUPABASE_SERVICE_KEY, AI_API_KEY, SESSION_SECRET
npm install
npm test
npm run dev
```

Then open:

- Landing: http://localhost:3000
- Dashboard: http://localhost:3000/dashboard
- Widget demo: http://localhost:3000/demo
- Health: http://localhost:3000/healthz

`npm run build` compiles the TypeScript server to `dist/`. `npm start` runs the compiled app (what Render uses).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (default `3000`) |
| `PUBLIC_URL` | Public origin, used in the share link and QR (e.g. `https://ghostchat.onrender.com`) |
| `SUPABASE_URL` | Shared project URL, default `https://rswtambjckwmlagydsvf.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **Server only.** Service role key. Never put this in the widget or dashboard. |
| `AI_BASE_URL` | OpenAI-compatible base, default `https://api.openai.com/v1` |
| `AI_API_KEY` | **Server only.** Provider secret. |
| `AI_MODEL` | Chat model, default `gpt-4o-mini` |
| `AI_EMBEDDING_MODEL` | Embedding model, default `text-embedding-3-small` (must stay 1536-d unless you change the migration) |
| `SESSION_SECRET` | Signs dashboard tokens. Generate with `openssl rand -hex 32`. |

Copy `.env.example` only. **Never commit `.env` or real secrets.**

## Supabase

GhostChat shares the existing GhostGames / GhostFlix project (`rswtambjckwmlagydsvf`) and uses **only** its own `ghostchat_` tables:

- `ghostchat_owners` — dashboard accounts (separate from shared `public.profiles` / Auth)
- `ghostchat_sites` — sites, theme, persona, plan, usage counters
- `ghostchat_documents` — crawled pages and uploaded docs
- `ghostchat_chunks` — retrieved chunks + `vector(1536)` embeddings
- `ghostchat_logs` — PII-redacted transcripts, feedback, page URL
- `ghostchat_leads` — captured emails + conversation transcript
- `ghostchat_match_chunks(...)` — similarity search scoped to one `site_id`

The migration lives at `supabase/migrations/20261114120000_create_ghostchat_tables.sql`. It enables `pgvector` and turns on RLS with **no** anon/authenticated policies — the API talks to the database with the service role only.

This project does not read or change `public.profiles`, `ghostflix_*`, `gg_*`, `ghostlinks_*`, or any other existing table.

## Deploy (Render)

Target setup:

- API + widget + dashboard on a free Render web service (see `render.yaml`, Frankfurt, Node 20)
- Later, the dashboard can also be served at `ghostapps.org/ghostchat` in front of the same service

To go live (owner does this — secrets are not in the repo):

1. Confirm the `ghostchat_` migration has been applied on project `rswtambjckwmlagydsvf`.
2. In Render: New → Blueprint, pick `GhostFaceModz/ghostchat`, or create a web service from this repo.
3. Set `SUPABASE_SERVICE_KEY`, `AI_API_KEY`, `SESSION_SECRET`, and `PUBLIC_URL`.
4. Deploy. Check `/healthz`.
5. Create an owner account on `/dashboard`, add a site, crawl or upload content, paste the snippet onto your site.

Stay on free tiers. Do not put the service role key or AI key in client-side code.

## Plan limits (Whop-ready)

| | Free | Pro | Business |
| --- | --- | --- | --- |
| Messages / month | 200 | 5,000 | 25,000 |
| Sites | 2 | 10 | 50 |
| Crawl pages | 30 | 150 | 400 |
| Uploaded docs | 5 | 50 | 200 |
| Hide branding | no | yes | yes |

Plans are stored on each site (`plan`, `messages_this_period`, `period_start`, …). There is no Whop webhook in v1 — bump a plan in the database when billing is wired up.

## Roadmap

Already in this build, in lighter form: site crawl + sitemap + text/markdown/HTML/CSV uploads, starter persona templates, multi-site per account, lead capture with transcript, shareable chat link + QR, and question counts by page.

Still to build:

- [ ] **Voice mode** — talk to the bot with TTS / STT
- [ ] **Smart escalation** — open a ticket or email the team automatically, with the full transcript (in-chat email capture is already live)
- [ ] **In-chat booking** — Cal.com / Calendly appointment slots
- [ ] **Order / status lookups** — call the owner’s API for order or account status
- [ ] **Train-from-anything** — PDFs, Notion, richer FAQ importers (crawl, sitemap, and text docs are done)
- [ ] **Brand-voice cloning** — learn tone from writing samples (manual persona + templates are done)
- [ ] **Owner co-pilot weekly digest** — email of top questions, doc gaps, and suggested FAQs
- [ ] **Conversion widgets** — product cards, discount codes, richer in-chat forms
- [ ] **Visual analytics heatmap** — a page-by-page map of where questions start (counts by page URL are done)
- [ ] **Template marketplace** — browse and install community support / sales / docs bots (three built-in templates are done)
- [ ] **Slack / Discord / WhatsApp** connectors
- [ ] **Multi-language** replies and dashboard
- [ ] **A/B tests** on greetings, personas, and themes
- [ ] **Team seats** and roles
- [ ] **Whop billing webhooks** to flip Free / Pro / Business automatically
- [ ] Discord / Google sign-in for the dashboard

## License

Private to GhostFaceModz / GhostApps unless a license file is added later.
