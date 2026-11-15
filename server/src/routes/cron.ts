import { Router } from "express";
import { cronSecretOk, runDueRecrawls, recrawlRunning } from "../lib/recrawl.js";
import { sweepIdleLiveChats } from "../lib/discordInbox.js";

export const cronRouter = Router();

/** Cron-safe re-crawl trigger. Send the secret as "x-cron-secret" or "Authorization: Bearer". Disabled until CRON_SECRET is set. */
cronRouter.post("/recrawl", (req, res) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: "Cron endpoint is disabled (CRON_SECRET not set)." });
  const auth = String(req.headers.authorization || "");
  const given = String(req.headers["x-cron-secret"] || (auth.startsWith("Bearer ") ? auth.slice(7) : ""));
  if (!cronSecretOk(given)) return res.status(401).json({ error: "Unauthorized" });
  if (recrawlRunning()) return res.status(202).json({ ok: true, status: "already running" });
  runDueRecrawls().then((r) => console.log("cron re-crawl:", JSON.stringify(r))).catch((e) => console.error("cron re-crawl failed:", (e as Error).message));
  res.status(202).json({ ok: true, status: "started" });
});

cronRouter.post("/live-idle", (req, res) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: "Cron endpoint is disabled (CRON_SECRET not set)." });
  const auth = String(req.headers.authorization || "");
  const given = String(req.headers["x-cron-secret"] || (auth.startsWith("Bearer ") ? auth.slice(7) : ""));
  if (!cronSecretOk(given)) return res.status(401).json({ error: "Unauthorized" });
  sweepIdleLiveChats()
    .then((r) => console.log("cron live-idle:", JSON.stringify(r)))
    .catch((e) => console.error("cron live-idle failed:", (e as Error).message));
  res.status(202).json({ ok: true, status: "started" });
});
