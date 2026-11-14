# GhostChat

A premium, embeddable AI chatbot any website owner can add with one script tag. It answers questions about **their own site** using retrieval over content crawled or uploaded by the owner — and says “I’m not sure” instead of making things up.

GhostChat is a GhostApps project. The default chat model is **Grok (xAI)**.

## One-line embed

```html
<script src="https://YOUR_GHOSTCHAT_HOST/widget.js" data-id="SITE_KEY"></script>
```

Optional data attributes: `data-theme="dark|light"`, `data-primary="#a78bfa"`, `data-greeting="…"`, `data-delay="4000"`, `data-sound="true"`, `data-open="true"`, `data-voice="true"`.

The widget also picks up theme, greeting, starter questions, branding, booking, and voice from the dashboard via `/api/widget/config/:siteKey`.

## What’s in this build

### Widget
- Animated ghost mascot, glass panel, dark / light / custom colour
- Streaming replies, typing indicator, markdown and code blocks
- Quick-reply chips, source chips, follow-up questions
- “I’m not sure” plus in-chat email handoff
- 👍 / 👎, optional sound, proactive greeting
- “Powered by GhostChat” badge (Pro and Business can hide it)
- Voice mode (browser STT / TTS), off unless enabled, with a graceful fallback
- Cal.com / Calendly booking modal
- Product, discount-code, and lead-form cards

### Dashboard
- Email + password, **Discord**, and **Google** sign-in
- Train from a site crawl (including `sitemap.xml`), PDFs, `.txt` / `.md` / `.html` / `.csv`, pasted FAQs, and Notion pages
- Persona, templates, theme, voice toggle
- Per-site **model picker** (only providers with a key are enabled)
- Booking URL and conversion cards
- Transcripts, analytics (full analytics on Pro+), leads with transcripts
- Shareable chat link + QR
- Plan & billing (Whop checkout links + webhook URL)

### Backend
- Multi-model chat over an OpenAI-compatible adapter: Grok (default), OpenAI, OpenRouter, Gemini
- Retrieval over `pgvector` (1536-d). Default embeddings: Grok `v1` when a Grok key is set
- Prompt-injection guards, rate limits, SSRF-safe crawler, PII-redacted logs
- Per-site isolation and Whop-driven Free / Pro / Business limits

## Models

Chat is **per site**. Owners pick a provider and model in the dashboard. If that provider’s key is not configured, the bot **falls back to Grok**.

| Provider | Env key(s) | Default / example chat models | Embeddings (must be 1536-d) |
| --- | --- | --- | --- |
| **Grok (xAI)** — default | `GROK_API_KEY` or `XAI_API_KEY` | `grok-4.7` (default), `grok-4.6`, `grok-4.5` | Yes — model `v1`, requested at 1536-d. Queries/passages are prefixed as xAI recommends. |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini` | Yes — `text-embedding-3-small` (1536-d) |
| OpenRouter | `OPENROUTER_API_KEY` | `x-ai/grok-4.7`, `openai/gpt-4o-mini`, `google/gemini-2.5-flash` | Chat only by default. Point `EMBEDDING_PROVIDER` at Grok, OpenAI, or Gemini. |
| Google Gemini | `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY` | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash` | Yes — `gemini-embedding-001` with `dimensions: 1536` |

Embeddings are **global** (not per-site) so every bot shares the same vector index. Only keys that are set enable that provider. A OpenRouter key can be added later without a code change.

## Local development

Needs Node 20+ and the env vars in `.env.example`.

```bash
cp .env.example .env
# fill SUPABASE_SERVICE_KEY, SESSION_SECRET, and GROK_API_KEY (or XAI_API_KEY)
npm install
npm test
npm run dev
```

Then open `/`, `/dashboard`, `/demo`, and `/healthz`.

## Environment variables

See `.env.example` for the full list. Important ones:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_URL` | Public origin (share links, OAuth redirects, Whop webhook URL) |
| `SUPABASE_SERVICE_KEY` | **Server only.** Never expose this to the widget. |
| `SESSION_SECRET` | Signs dashboard tokens (`openssl rand -hex 32`) |
| `GROK_API_KEY` / `XAI_API_KEY` | Grok (xAI) — default chat + embeddings |
| `OPENAI_API_KEY` | Optional OpenAI |
| `OPENROUTER_API_KEY` | Optional OpenRouter |
| `GEMINI_API_KEY` | Optional Gemini |
| `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` | Override the global embeddings provider |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord sign-in. Redirect: `{PUBLIC_URL}/api/auth/discord/callback` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in. Redirect: `{PUBLIC_URL}/api/auth/google/callback` |
| `WHOP_WEBHOOK_SECRET` | Verifies Whop Standard Webhooks at `POST {PUBLIC_URL}/api/webhooks/whop` |
| `WHOP_PLAN_PRO_ID` / `WHOP_PLAN_BUSINESS_ID` | Map Whop plan or product IDs to GhostChat tiers |
| `WHOP_CHECKOUT_PRO_URL` / `WHOP_CHECKOUT_BUSINESS_URL` | Checkout buttons in the dashboard |
| `NOTION_API_KEY` | Notion internal integration token for page import |

**Never commit `.env` or real secrets.**

## Whop webhook

Paste this URL in the Whop dashboard:

```
https://YOUR_GHOSTCHAT_HOST/api/webhooks/whop
```

Subscribe to `membership.went_valid` and `membership.went_invalid` (or `membership.activated` / `membership.deactivated`). GhostChat verifies the Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`) with `WHOP_WEBHOOK_SECRET` (`ws_…`, do not strip the prefix). It matches the member to a GhostChat owner by email (use the same email) or `metadata.owner_id`, then updates `ghostchat_owners.plan` and every site under that owner.

## Supabase

Shared project `rswtambjckwmlagydsvf`, **`ghostchat_` tables only**. Migrations:

- `supabase/migrations/20261114120000_create_ghostchat_tables.sql`
- `supabase/migrations/20261114140000_ghostchat_oauth_billing_training.sql`

Tables: `ghostchat_owners`, `ghostchat_sites`, `ghostchat_documents`, `ghostchat_chunks`, `ghostchat_logs`, `ghostchat_leads`, `ghostchat_billing_events`, plus `ghostchat_match_chunks(...)`.

This project does not read or change `public.profiles`, `ghostflix_*`, `gg_*`, `ghostlinks_*`, or any other existing table.

## Deploy (Render)

Free Render web service (`render.yaml`, Frankfurt, Node 20). Owner does this — secrets are not in the repo:

1. Confirm both `ghostchat_` migrations have been applied.
2. Create the service from this repo / Blueprint.
3. Set `PUBLIC_URL`, `SESSION_SECRET`, `SUPABASE_SERVICE_KEY`, and `GROK_API_KEY` (plus any other keys you want).
4. Deploy and check `/healthz`.
5. Add Discord/Google redirect URIs and the Whop webhook URL if you use those.

## Plan limits

| | Free | Pro | Business |
| --- | --- | --- | --- |
| Messages / month | 200 | 5,000 | 25,000 |
| Sites | 2 | 10 | 50 |
| Crawl pages | 30 | 150 | 400 |
| Uploaded docs | 5 | 50 | 200 |
| Leads / month | 15 | 1,000 | 10,000 |
| Conversion cards | 3 | 20 | 50 |
| Full analytics | no | yes | yes |
| Hide branding | no | yes | yes |

## Roadmap

Still to build:

- [ ] **Smart escalation** — open a ticket or email automatically (in-chat capture with transcript is live)
- [ ] **Order / status lookups** — call the owner’s API
- [ ] **Brand-voice cloning** from writing samples
- [ ] **Owner co-pilot weekly digest**
- [ ] **Visual analytics heatmap** (page-level counts are live)
- [ ] **Template marketplace** (three built-in templates are live)
- [ ] **Slack / Discord / WhatsApp** visitor connectors
- [ ] **Multi-language** replies and dashboard
- [ ] **A/B tests**
- [ ] **Team seats** and roles
- [ ] Server-side TTS / STT beyond the browser voice mode

## License

Private to GhostFaceModz / GhostApps unless a license file is added later.
