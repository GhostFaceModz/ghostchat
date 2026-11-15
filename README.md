# GhostChat

A premium, embeddable AI chatbot any website owner can add with one script tag. It answers questions about **their own site** using retrieval over content crawled or uploaded by the owner — and says “I’m not sure” instead of making things up.

GhostChat is a GhostApps project. The default chat model is **DeepSeek V4 Flash** via OpenRouter. Embeddings default to a **local, key-free MiniLM model** so retrieval works with only an OpenRouter key.

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
- Plan & billing (Whop checkout links; the webhook URL is below under *Whop webhook*)
- Sign-in at `/login`, sign-up at `/signup`; Discord/Google buttons show a "Soon" state until their env vars are set

### Marketing site
- Landing page (`/`) and buyer setup guide (`/guide`), styled after ghostapps.org
- Images in `public/img/` were generated with Krea and converted to WebP (`og.jpg` is the 1200×630 social card)

### Backend
- Multi-model chat over an OpenAI-compatible adapter: OpenRouter (default: `deepseek/deepseek-v4-flash`), plus Grok, OpenAI, and Gemini when their keys exist. The picker also lists OpenRouter `:free` models for a $0 chat option. DeepSeek V4 Flash is extremely cheap, but not strictly free — OpenRouter has no truly-free DeepSeek variant.
- Retrieval over `pgvector` (384-d). Default embeddings: local `Xenova/all-MiniLM-L6-v2` (no API key, no cost). OpenRouter does not provide embeddings.
- Prompt-injection guards, rate limits, SSRF-safe crawler, PII-redacted logs
- Per-site isolation and Whop-driven Free / Pro / Business limits

## Models

Chat is **per site**. Owners pick a provider and model in the dashboard. If that provider’s key is not configured, the bot **falls back to OpenRouter** (`deepseek/deepseek-v4-flash`).

`deepseek/deepseek-v4-flash` is extremely cheap, but not strictly $0. OpenRouter does not offer a truly-free DeepSeek variant. For a $0 chat option, pick one of the `:free` models in the dashboard (for example `google/gemma-4-31b-it:free`).

| Provider | Env key(s) | Default / example chat models | Embeddings (must be 384-d) |
| --- | --- | --- | --- |
| **OpenRouter** — default | `OPENROUTER_API_KEY` | `deepseek/deepseek-v4-flash` (default), plus `:free` models such as `google/gemma-4-31b-it:free`, `meta-llama/llama-3.3-70b-instruct:free`, `qwen/qwen3-8b:free` | No embeddings API. Leave `EMBEDDING_PROVIDER=local`. |
| **Local MiniLM** — default embeddings | none | n/a (embeddings only) | Yes — `Xenova/all-MiniLM-L6-v2` at 384-d, runs on the server, no key, no cost. |
| Grok (xAI) | `GROK_API_KEY` or `XAI_API_KEY` | `grok-4.7`, `grok-4.6`, `grok-4.5` | Optional — model `v1` with `dimensions: 384`. |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini` | Optional — `text-embedding-3-small` with `dimensions: 384`. |
| Google Gemini | `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY` | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash` | Optional — `gemini-embedding-001` with `dimensions: 384`. |

Embeddings are **global** (not per-site) so every bot shares the same vector index. Local MiniLM is the default so a site works with only an OpenRouter chat key.

## Local development

Needs Node 22+ and the env vars in `.env.example`.

```bash
cp .env.example .env
# fill SUPABASE_SERVICE_KEY, SESSION_SECRET, and OPENROUTER_API_KEY
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
| `OPENROUTER_API_KEY` | Default chat provider |
| `OPENROUTER_MODEL` | Default chat model, `deepseek/deepseek-v4-flash` |
| `OPENAI_API_KEY` | Optional OpenAI chat (and optional 384-d embeddings) |
| `GROK_API_KEY` / `XAI_API_KEY` | Optional Grok chat (and optional 384-d embeddings) |
| `GEMINI_API_KEY` | Optional Gemini chat (and optional 384-d embeddings) |
| `EMBEDDING_PROVIDER` | Default `local`. Set `openai`, `gemini`, or `grok` to use a paid embeddings API (must stay 384-d). |
| `EMBEDDING_MODEL` | Override the embeddings model id |
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
- `supabase/migrations/20261114153000_ghostchat_local_embeddings_384.sql`

Tables: `ghostchat_owners`, `ghostchat_sites`, `ghostchat_documents`, `ghostchat_chunks`, `ghostchat_logs`, `ghostchat_leads`, `ghostchat_billing_events`, plus `ghostchat_match_chunks(...)`.

This project does not read or change `public.profiles`, `ghostflix_*`, `gg_*`, `ghostlinks_*`, or any other existing table.

## Deploy (Render)

Free Render web service (`render.yaml`, Frankfurt, Node 22; Node 20 crashes because supabase-js needs a global WebSocket). Owner does this — secrets are not in the repo:

1. Confirm both `ghostchat_` migrations have been applied.
2. Create the service from this repo / Blueprint.
3. Set `PUBLIC_URL`, `SESSION_SECRET`, `SUPABASE_SERVICE_KEY`, and `OPENROUTER_API_KEY`. Leave `EMBEDDING_PROVIDER=local`. Add OAuth/Whop keys later if you want those features.
4. Deploy and check `/healthz`.
5. Add Discord/Google redirect URIs and the Whop webhook URL if you use those.

Live service: `https://ghostchat.pro`. Set `PUBLIC_URL` to exactly that. The Render hostname `https://ghostchat-nfoc.onrender.com` still serves the app (and remains the CNAME target for white-label domains).

### Discord / Google sign-in

By default the buttons sign in through **Supabase Auth** on the shared project, using the same Discord and Google apps as GhostFlix (no GhostChat client secrets needed):

1. The button goes to `{SUPABASE_URL}/auth/v1/authorize?provider=discord|google&redirect_to={PUBLIC_URL}/auth/callback`.
2. `/auth/callback` reads the Supabase session from the URL fragment and POSTs the access token to `POST /api/auth/supabase`.
3. The server verifies it with the service key (`auth.getUser`), finds or creates the `ghostchat_owners` row by provider ID or email, and returns the normal GhostChat session token.

Requirements: `https://ghostchat.pro/**` must be in Supabase → Authentication → URL Configuration → Redirect URLs (otherwise Supabase sends people to its Site URL instead). Keep the legacy `https://ghostchat-nfoc.onrender.com/**` entry too so existing sign-in links still work. `SUPABASE_ANON_KEY` defaults to the project's public publishable key; set `SUPABASE_OAUTH=false` to hide the buttons.

Fallback: if `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` (or the Google pair) are set, that provider uses direct OAuth instead, with redirect URI `{PUBLIC_URL}/api/auth/discord/callback` (or `/google/callback`).

`GET /api/auth/providers` shows which mode each provider uses and where its button goes.

### Keep-awake ping

Render's free plan sleeps after ~15 minutes idle. `.github/workflows/keepalive.yml` curls `/healthz` every 10 minutes (and can be run by hand from the Actions tab). GitHub pauses scheduled workflows after 60 days without repo activity; re-enable it from the Actions tab if that happens.

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
