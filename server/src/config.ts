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

export const config = {
  port: num("PORT", 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  supabaseUrl: process.env.SUPABASE_URL ?? "https://rswtambjckwmlagydsvf.supabase.co",
  supabaseServiceKey: requiredInProd("SUPABASE_SERVICE_KEY") ?? process.env.SUPABASE_SERVICE_KEY ?? "",
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
};

export const PLAN_LIMITS = {
  free: {
    monthlyMessages: config.freeMonthlyMessages,
    maxSites: 2,
    maxPages: 30,
    maxUploads: 5,
    brandingRequired: true,
  },
  pro: {
    monthlyMessages: config.proMonthlyMessages,
    maxSites: 10,
    maxPages: 150,
    maxUploads: 50,
    brandingRequired: false,
  },
  business: {
    monthlyMessages: config.businessMonthlyMessages,
    maxSites: 50,
    maxPages: 400,
    maxUploads: 200,
    brandingRequired: false,
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;
