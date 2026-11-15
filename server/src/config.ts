import "dotenv/config";

function requiredInProd(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || undefined;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export const config = {
  port: num("PORT", 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  supabaseUrl: process.env.SUPABASE_URL ?? "https://rswtambjckwmlagydsvf.supabase.co",
  supabaseServiceKey: requiredInProd("SUPABASE_SERVICE_KEY") ?? process.env.SUPABASE_SERVICE_KEY ?? "",
  // Public (publishable) key for the shared project. Safe in client code; used only to
  // start Supabase Auth OAuth sign-in. Set SUPABASE_OAUTH=false to turn that off.
  supabaseAnonKey: str("SUPABASE_ANON_KEY", "sb_publishable_Q6craxzJCpWq_an3BOjeDw_VY69vuYl"),
  supabaseOAuth: bool("SUPABASE_OAUTH", true),
  aiBaseUrl: (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
  embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  sessionSecret:
    process.env.SESSION_SECRET ??
    (process.env.NODE_ENV === "production" ? "" : "dev-only-change-me-not-for-production"),
  crawlMaxPages: num("CRAWL_MAX_PAGES", 40),
  crawlMaxDepth: num("CRAWL_MAX_DEPTH", 3),
  freeMonthlyMessages: num("FREE_MONTHLY_MESSAGES", 200),
  proMonthlyMessages: num("PRO_MONTHLY_MESSAGES", 5000),
  businessMonthlyMessages: num("BUSINESS_MONTHLY_MESSAGES", 25000),
  discordClientId: str("DISCORD_CLIENT_ID"),
  discordClientSecret: str("DISCORD_CLIENT_SECRET"),
  googleClientId: str("GOOGLE_CLIENT_ID"),
  googleClientSecret: str("GOOGLE_CLIENT_SECRET"),
  // Google OAuth redirect_uri origin. Defaults to the Render hostname already
  // registered on the Google Cloud client (PUBLIC_URL may be a custom domain).
  googleRedirectBase: (process.env.GOOGLE_REDIRECT_BASE ?? "https://ghostchat-nfoc.onrender.com").replace(/\/$/, ""),
  whopWebhookSecret: str("WHOP_WEBHOOK_SECRET"),
  whopApiKey: str("WHOP_API_KEY"),
  whopPlanProId: str("WHOP_PLAN_PRO_ID"),
  whopPlanBusinessId: str("WHOP_PLAN_BUSINESS_ID"),
  whopCheckoutProUrl: str("WHOP_CHECKOUT_PRO_URL"),
  whopCheckoutBusinessUrl: str("WHOP_CHECKOUT_BUSINESS_URL"),
  whopTopup1000Id: str("WHOP_TOPUP_1000_ID") || "plan_uGqpl2f3z1NB8",
  whopTopup5000Id: str("WHOP_TOPUP_5000_ID") || "plan_3rVqDMRXNHvzM",
  notionApiKey: str("NOTION_API_KEY"),
  voiceEnabled: bool("VOICE_ENABLED", true),
};

export const PLAN_LIMITS = {
  free: {
    monthlyMessages: config.freeMonthlyMessages,
    maxSites: 2,
    maxPages: 30,
    maxUploads: 5,
    brandingRequired: true,
    monthlyLeads: 15,
    analytics: "basic" as const,
    maxCards: 3,
  },
  pro: {
    monthlyMessages: config.proMonthlyMessages,
    maxSites: 10,
    maxPages: 150,
    maxUploads: 50,
    brandingRequired: false,
    monthlyLeads: 1000,
    analytics: "full" as const,
    maxCards: 20,
  },
  business: {
    monthlyMessages: config.businessMonthlyMessages,
    maxSites: 50,
    maxPages: 400,
    maxUploads: 200,
    brandingRequired: false,
    monthlyLeads: 10000,
    analytics: "full" as const,
    maxCards: 50,
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export type OAuthProvider = "discord" | "google";

/** Direct OAuth (GhostChat's own client ID/secret). Takes priority when set. */
export function oauthConfigured(provider: OAuthProvider): boolean {
  if (provider === "discord") return Boolean(config.discordClientId && config.discordClientSecret);
  return Boolean(config.googleClientId && config.googleClientSecret);
}

/** Sign-in through Supabase Auth on the shared project (same Discord/Google apps as GhostFlix). */
export function supabaseOAuthConfigured(): boolean {
  return Boolean(config.supabaseOAuth && config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceKey);
}

export type OAuthMode = "direct" | "supabase" | null;

export function oauthMode(provider: OAuthProvider): OAuthMode {
  if (oauthConfigured(provider)) return "direct";
  if (supabaseOAuthConfigured()) return "supabase";
  return null;
}

/** Supabase Auth authorize URL; Supabase sends the user back to /auth/callback with a session. */
export function supabaseAuthorizeUrl(provider: OAuthProvider): string {
  const url = new URL(`${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/authorize`);
  url.searchParams.set("provider", provider);
  url.searchParams.set("redirect_to", `${config.publicUrl}/auth/callback`);
  if (provider === "discord") url.searchParams.set("scopes", "identify email");
  return url.toString();
}
