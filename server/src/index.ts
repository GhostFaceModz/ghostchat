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
import { resolveEmbeddingModel } from "./lib/models.js";
import { warmupLocalEmbeddings } from "./lib/localEmbeddings.js";

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
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "ghostchat" });
});

app.use("/api/auth", authRouter);
app.use("/api/sites", requireAuth, sitesRouter);
app.use("/api/chat", chatRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/widget", widgetRouter);
app.use("/api/billing", requireAuth, billingRouter);
app.use("/api/models", requireAuth, modelsRouter);
app.get("/api/templates", (_req, res, next) => {
  // convenience alias
  _req.url = "/templates";
  widgetRouter(_req, res, next);
});

app.use("/widget", express.static(path.join(repoRoot, "widget"), { maxAge: "1h" }));
app.get("/widget.js", (_req, res) => {
  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300");
  res.sendFile(path.join(repoRoot, "widget", "widget.js"));
});
app.use("/dashboard", express.static(path.join(repoRoot, "dashboard"), { maxAge: "5m", index: "index.html" }));
app.use("/demo", express.static(path.join(repoRoot, "widget"), { index: "index.html" }));
app.use(express.static(path.join(repoRoot, "public"), { maxAge: "5m" }));

app.get("/c/:siteKey", (req, res) => {
  const siteKey = encodeURIComponent(String(req.params.siteKey || ""));
  const safeKey = siteKey.replace(/[^a-zA-Z0-9_\-]/g, "");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chat · GhostChat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; font-family: "Instrument Sans", system-ui, sans-serif;
      background:
        radial-gradient(1200px 600px at 10% -10%, rgba(167,139,250,.28), transparent 55%),
        radial-gradient(900px 500px at 110% 10%, rgba(244,114,182,.16), transparent 50%),
        #09060f;
      color: #f5f3ff;
      display: grid; place-items: center; padding: 32px 20px;
    }
    .card {
      width: min(560px, 100%);
      background: rgba(18, 10, 32, .72);
      border: 1px solid rgba(196,181,253,.16);
      border-radius: 28px;
      padding: 36px 32px 28px;
      backdrop-filter: blur(24px);
      box-shadow: 0 30px 80px rgba(0,0,0,.4);
      text-align: center;
    }
    h1 { font-family: Syne, sans-serif; font-weight: 800; margin: 0 0 8px; letter-spacing: -0.03em; }
    p { color: #c4b5fd; margin: 0 0 18px; line-height: 1.5; }
    a { color: #e9d5ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>GhostChat</h1>
    <p>The assistant is opening in the corner. Ask anything about this site.</p>
  </div>
  <script src="/widget.js" data-id="${safeKey}" data-open="true" data-share="true"></script>
</body>
</html>`);
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
  if (resolveEmbeddingModel().provider === "local") {
    warmupLocalEmbeddings().then(
      () => console.log("Local embeddings model ready (hash/feature-384, 384-d)"),
      (err) => console.error("Failed to warm local embeddings:", err),
    );
  }
});
