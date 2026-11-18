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
  /** In-chat forms: which fields to collect, and whether a submission is a lead or a support ticket. */
  kind?: "lead" | "support";
  fields?: Array<{ key: string; label: string; required: boolean }>;
};

export type Owner = {
  id: string;
  email: string;
  name: string | null;
  plan?: Plan;
  avatar_url?: string | null;
  discord_id?: string | null;
  google_id?: string | null;
  agent_display_name?: string | null;
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
  read_aloud_enabled?: boolean;
  conversion_cards?: ConversionCard[];
  chat_provider?: string | null;
  chat_model?: string | null;
  answer_mode?: "helpful" | "strict";
  max_sources?: number | null;
  max_suggestions?: number | null;
  search_tools?: unknown;
  crawl_scope?: unknown;
  open_site_links?: "same_tab" | "new_tab";
  usage_alert_level?: number;
  reveal_model?: boolean;
  live_chat?: Record<string, unknown> | null;
  recrawl_schedule?: "off" | "daily" | "weekly";
  live_lookup?: boolean;
  lookup_search_url?: string | null;
  greetings?: Array<{ pattern: string; message: string; delay_s: number }>;
  chat_form?: Record<string, unknown> | null;
  memory_enabled?: boolean;
  multilingual?: boolean;
  custom_domain?: string | null;
  channels?: Record<string, unknown> | null;
  bot_mode?: "assistant" | "support" | "sales" | "recommendations";
  support?: Record<string, unknown> | null;
  updated_at?: string;
  email_channel?: boolean;
  email_inbound_token?: string | null;
  email_from_name?: string | null;
  last_widget_seen_at?: string | null;
  last_widget_page?: string | null;
  last_install_check_at?: string | null;
  last_install_check?: Record<string, unknown> | null;
  knowledge_rev?: number;
};

export type RetrievedChunk = {
  id: string;
  site_id: string;
  url: string | null;
  title: string | null;
  heading?: string | null;
  content: string;
  similarity: number;
};

export type ChatSource = {
  title: string;
  url: string | null;
};
