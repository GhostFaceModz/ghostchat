export type Plan = "free" | "pro" | "business";

export type Theme = {
  mode: "dark" | "light";
  primary: string;
  background?: string;
  text?: string;
  accent?: string;
  title?: string;
};

export type ConversionCard = {
  id: string;
  type: "product" | "discount" | "form" | "booking";
  title: string;
  subtitle?: string;
  url?: string;
  image?: string;
  price?: string;
  cta?: string;
  code?: string;
  triggers?: string[];
};

export type Owner = {
  id: string;
  email: string;
  name: string | null;
  plan?: Plan;
  avatar_url?: string | null;
  discord_id?: string | null;
  google_id?: string | null;
};

export type Site = {
  id: string;
  owner_id: string;
  name: string;
  url: string;
  site_key: string;
  theme: Theme;
  greeting: string | null;
  persona: string | null;
  tone: string;
  guardrails: string | null;
  banned_topics: string[];
  starter_questions: string[];
  proactive_delay_ms: number;
  sound_default: boolean;
  show_branding: boolean;
  plan: Plan;
  messages_this_period: number;
  leads_this_period: number;
  period_start: string;
  crawl_status: string;
  crawl_error: string | null;
  last_crawled_at: string | null;
  page_count: number;
  chunk_count: number;
  created_at: string;
  booking_url?: string | null;
  booking_provider?: "cal.com" | "calendly" | "other" | null;
  voice_enabled?: boolean;
  conversion_cards?: ConversionCard[];
  chat_provider?: string | null;
  chat_model?: string | null;
};

export type RetrievedChunk = {
  id: string;
  site_id: string;
  url: string | null;
  title: string | null;
  content: string;
  similarity: number;
};

export type ChatSource = {
  title: string;
  url: string | null;
};
