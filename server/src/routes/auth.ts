import { Router } from "express";
import { getDb } from "../lib/supabase.js";
import { hashPassword, verifyPassword, signToken, isValidEmail, requireAuth } from "../lib/auth.js";
import { clientIp, rateLimit } from "../lib/rateLimit.js";
import type { AuthedRequest } from "../lib/auth.js";

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const ip = clientIp(req);
  const rl = rateLimit(`signup:${ip}`, 8, 15 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many sign-up attempts. Try again shortly." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim() || null;
  if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const db = getDb();
  const { data: existing } = await db.from("ghostchat_owners").select("id").ilike("email", email).maybeSingle();
  if (existing) return res.status(409).json({ error: "An account with that email already exists." });

  const password_hash = await hashPassword(password);
  const { data, error } = await db
    .from("ghostchat_owners")
    .insert({ email, password_hash, name })
    .select("id, email, name")
    .single();
  if (error) return res.status(500).json({ error: "Could not create the account." });

  const token = signToken({ id: data.id, email: data.email, name: data.name });
  res.status(201).json({ token, owner: data });
});

authRouter.post("/login", async (req, res) => {
  const ip = clientIp(req);
  const rl = rateLimit(`login:${ip}`, 12, 15 * 60 * 1000);
  if (!rl.ok) return res.status(429).json({ error: "Too many sign-in attempts. Try again shortly." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { data, error } = await getDb()
    .from("ghostchat_owners")
    .select("id, email, name, password_hash")
    .ilike("email", email)
    .maybeSingle();
  if (error || !data || !(await verifyPassword(password, data.password_hash))) {
    return res.status(401).json({ error: "Those details don't match an account." });
  }

  const owner = { id: data.id, email: data.email, name: data.name };
  const token = signToken(owner);
  res.json({ token, owner });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const owner = (req as AuthedRequest).owner;
  res.json({ owner });
});
