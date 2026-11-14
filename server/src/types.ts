export type Plan = "free" | "pro" | "business";

export type Theme = {
  mode: "dark" | "light";
  primary: string;
  background?: string;
  text?: string;
  accent?: string;
  title?: string;
};

export type Owner = {
  id: string;
  email: string;
  name: string | null;
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
