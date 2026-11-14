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
import { shareRouter } from "./routes/share.js";
import { warmupLocalEmbeddings } from "./lib/localEmbeddings.js";
import { cronRouter } from "./routes/cron.js";
import { metaWebhookRouter } from "./routes/meta.js";
import { ticketsRouter } from "./routes/tickets.js";
import { startRecrawlScheduler } from "./lib/recrawl.js";

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
app.use((_req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  next();
});
app.use(cors({ origin: true }));
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
app.use("/api/chat", chatRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/widget", widgetRouter);
app.use("/api/billing", requireAuth, billingRouter);
app.use("/api/models", requireAuth, modelsRouter);
app.use("/api/webhooks/telegram", telegramWebhookRouter);
app.use("/api/live/owner", requireAuth, liveOwnerRouter);
app.use("/api/live", liveWidgetRouter);
// Alias for /api/widget/templates.
app.get("/api/templates", (req, res, next) => {
  req.url = "/templates";
  widgetRouter(req, res, next);
});

app.use("/widget", express.static(path.join(repoRoot, "widget"), { maxAge: "1h" }));
app.get("/widget.js", (_req, res) => {
  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300");
  res.sendFile(path.join(repoRoot, "widget", "widget.js"));
});
app.use("/dashboard", express.static(path.join(repoRoot, "dashboard"), { maxAge: "5m", index: "index.html" }));
app.use("/demo", express.static(path.join(repoRoot, "widget"), { index: "index.html" }));
// Marketing site: Krea-generated images are versioned by filename, so cache them longer.
app.use(shareRouter(repoRoot)); // /og/<siteKey>.png, /c/<siteKey>, /pricing (with its own preview text)
app.use("/img", express.static(path.join(repoRoot, "public", "img"), { maxAge: "7d" }));
app.use(express.static(path.join(repoRoot, "public"), { maxAge: "5m" }));
app.get(["/privacy", "/privacy-policy"], (_req, res) => {
  res.sendFile(path.join(repoRoot, "public", "privacy.html"));
});
app.get(["/terms", "/tos"], (_req, res) => {
  res.sendFile(path.join(repoRoot, "public", "terms.html"));
});

app.get(["/guide", "/getting-started", "/setup"], (_req, res) => {
  res.sendFile(path.join(repoRoot, "public", "guide.html"));
});
// Supabase Auth returns here after Discord/Google sign-in.
app.get("/auth/callback", (_req, res) => {
  res.setHeader("cache-control", "no-store");
  res.sendFile(path.join(repoRoot, "public", "auth-callback.html"));
});
// Sign-in and sign-up are views of the dashboard app (it reads the path to pick the mode).
app.get(["/login", "/signup", "/account"], (_req, res) => {
  res.sendFile(path.join(repoRoot, "dashboard", "index.html"));
});

app.get("/dashboard/*", (_req, res) => {
  res.sendFile(path.join(repoRoot, "dashboard", "index.html"));
});

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next;
  const message = err instanceof Error ? err.message : "Unexpected error";
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: message });
});

if (!config.supabaseServiceKey && config.nodeEnv === "production") {
  console.warn("SUPABASE_SERVICE_KEY is not set — API routes that need the database will fail.");
}

app.listen(config.port, () => {
  console.log(`GhostChat listening on ${config.publicUrl} (port ${config.port})`);
  startRecrawlScheduler();
  if (resolveEmbeddingModel().provider === "local") {
    warmupLocalEmbeddings().then(
      () => console.log("Local embeddings model ready (hash/feature-384, 384-d)"),
      (err) => console.error("Failed to warm local embeddings:", err),
    );
  }
});
