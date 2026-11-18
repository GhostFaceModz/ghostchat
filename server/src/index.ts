import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { requireAuth } from "./lib/auth.js";
import { authRouter } from "./routes/auth.js";
import { sitesRouter } from "./routes/sites.js";
import { chatRouter } from "./routes/chat.js";
import { leadsRouter } from "./routes/leads.js";
import { widgetRouter } from "./routes/widget.js";
import { billingRouter, whopWebhookRouter } from "./routes/billing.js";
import { modelsRouter } from "./routes/models.js";
import { liveWidgetRouter, liveOwnerRouter, telegramWebhookRouter, discordWebhookRouter } from "./routes/live.js";
import { resolveEmbeddingModel } from "./lib/models.js";
import { promoteGteEmbeddings } from "./lib/embeddingSpace.js";
import { ensureDemoSite } from "./lib/demoSite.js";
import { shareRouter } from "./routes/share.js";
import { warmupLocalEmbeddings } from "./lib/localEmbeddings.js";
import { cronRouter } from "./routes/cron.js";
import { metaWebhookRouter } from "./routes/meta.js";
import { ticketsRouter } from "./routes/tickets.js";
import { startIdleSweep, sweepIdleLiveChats, sweepClosedDiscordCards } from "./lib/discordInbox.js";
import { startRecrawlScheduler, runDueRecrawls } from "./lib/recrawl.js";
import { canonicalRedirect, HSTS_VALUE, PUBLIC_ERROR } from "./lib/httpSecurity.js";
import { widgetFile, widgetVersion, widgetCacheControl } from "./lib/widgetAsset.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(dir, "widget", "widget.js")) &&
      fs.existsSync(path.join(dir, "dashboard"))
    ) {
      return dir;
    }
    dir = path.resolve(dir, "..");
  }
  return path.resolve(start, "../..");
}

const repoRoot = findRepoRoot(here);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  const https = req.secure || req.headers["x-forwarded-proto"] === "https";
  if (https) res.setHeader("strict-transport-security", HSTS_VALUE);
  const to = canonicalRedirect(req.hostname, req.originalUrl);
  if (to) return res.redirect(301, to);
  next();
});
// CORS is only enabled on widget-facing API routes so customer sites can call them.
// Marketing pages and the owner dashboard stay same-origin.
const widgetCors = cors({ origin: true });
app.use("/api/webhooks/whop", express.raw({ type: "application/json" }), whopWebhookRouter);
app.use("/api/webhooks/discord", express.raw({ type: "application/json" }), discordWebhookRouter);
app.use("/api/webhooks/meta", express.raw({ type: "*/*", limit: "1mb" }), metaWebhookRouter);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "ghostchat" });
});

app.use("/api/auth", authRouter);
app.use("/api/sites", requireAuth, ticketsRouter);
app.use("/api/sites", requireAuth, sitesRouter);
app.use("/api/cron", cronRouter);
app.use("/api/chat", widgetCors, chatRouter);
app.use("/api/leads", widgetCors, leadsRouter);
app.use("/api/widget", widgetCors, widgetRouter);
app.use("/api/billing", requireAuth, billingRouter);
app.use("/api/models", requireAuth, modelsRouter);
app.use("/api/webhooks/telegram", telegramWebhookRouter);
app.use("/api/live/owner", requireAuth, liveOwnerRouter);
app.use("/api/live", widgetCors, liveWidgetRouter);
// Alias for /api/widget/templates.
app.get("/api/templates", widgetCors, (req, res, next) => {
  req.url = "/templates";
  widgetRouter(req, res, next);
});

function sendWidget(req: express.Request, res: express.Response) {
  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.setHeader("cache-control", widgetCacheControl(String(req.query.v || "")));
  res.setHeader("x-ghostchat-widget", widgetVersion());
  res.sendFile(widgetFile(repoRoot));
}
app.get(["/widget.js", "/widget/widget.js"], sendWidget);
app.use("/widget", express.static(path.join(repoRoot, "widget"), { maxAge: "1d", index: false }));
app.use("/dashboard", express.static(path.join(repoRoot, "dashboard"), { maxAge: "5m", index: false }));
app.use("/demo", express.static(path.join(repoRoot, "widget"), { index: "index.html" }));
// Marketing site: Krea-generated images are versioned by filename, so cache them longer.
app.use(shareRouter(repoRoot)); // /og/<siteKey>.png, /c/<siteKey>, /pricing (with its own preview text)
app.use("/img", express.static(path.join(repoRoot, "public", "img"), { maxAge: "7d" }));
function sendHtml(file: string, res: express.Response, maxAge = "5m") {
  let html = fs.readFileSync(file, "utf8").replaceAll("__WIDGET_V__", widgetVersion());
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", `public, max-age=${maxAge === "5m" ? 300 : 300}`);
  res.send(html);
}
app.get(["/", "/index.html"], (_req, res) => sendHtml(path.join(repoRoot, "public", "index.html"), res));
app.use(express.static(path.join(repoRoot, "public"), { maxAge: "5m", index: false }));
app.get(["/privacy", "/privacy-policy"], (_req, res) => {
  sendHtml(path.join(repoRoot, "public", "privacy.html"), res);
});
app.get(["/terms", "/tos"], (_req, res) => {
  sendHtml(path.join(repoRoot, "public", "terms.html"), res);
});

app.get(["/guide", "/getting-started", "/setup"], (_req, res) => {
  sendHtml(path.join(repoRoot, "public", "guide.html"), res);
});
// Supabase Auth returns here after Discord/Google sign-in.
app.get("/auth/callback", (_req, res) => {
  res.setHeader("cache-control", "no-store");
  res.sendFile(path.join(repoRoot, "public", "auth-callback.html"));
});
// Sign-in and sign-up are views of the dashboard app (it reads the path to pick the mode).
app.get(["/login", "/signup", "/account", "/dashboard", "/dashboard/"], (_req, res) => {
  sendHtml(path.join(repoRoot, "dashboard", "index.html"), res);
});

app.get("/dashboard/*", (_req, res) => {
  sendHtml(path.join(repoRoot, "dashboard", "index.html"), res);
});

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next;
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: PUBLIC_ERROR });
});

if (!config.supabaseServiceKey && config.nodeEnv === "production") {
  console.warn("SUPABASE_SERVICE_KEY is not set — API routes that need the database will fail.");
}

function catchUpOnWake() {
  promoteGteEmbeddings()
    .then((r) => { if (!r.skipped) console.log("embedding space:", JSON.stringify(r)); else if (r.skipped && r.skipped !== "test") console.log("embedding space:", r.skipped); })
    .catch((e) => console.error("embedding promotion failed:", (e as Error).message))
    .then(() => ensureDemoSite())
    .then((r) => { if (!r) return; if (r.crawled) console.log("demo site ready"); else if (r.skipped) console.log("demo site:", r.skipped); })
    .catch((e) => console.error("demo site failed:", (e as Error).message));
  runDueRecrawls()
    .then((r) => { if ((r as { results?: unknown[] }).results?.length) console.log("wake re-crawl:", JSON.stringify(r)); })
    .catch((e) => console.error("wake re-crawl failed:", (e as Error).message));
  sweepIdleLiveChats()
    .then((r) => { if (r.warned || r.closed) console.log("wake idle sweep:", JSON.stringify(r)); })
    .catch((e) => console.error("wake idle sweep failed:", (e as Error).message));
  sweepClosedDiscordCards()
    .then((r) => { if (r.cleared || r.failed) console.log("wake discord clear:", JSON.stringify(r)); })
    .catch((e) => console.error("wake discord clear failed:", (e as Error).message));
}

app.listen(config.port, () => {
  console.log(`GhostChat listening on ${config.publicUrl} (port ${config.port})`);
  startRecrawlScheduler();
  startIdleSweep();
  catchUpOnWake();
  if (resolveEmbeddingModel().provider === "local") {
    warmupLocalEmbeddings().then(
      () => console.log("Local embeddings model ready (hash/feature-384, 384-d)"),
      (err) => console.error("Failed to warm local embeddings:", err),
    );
  }
});
