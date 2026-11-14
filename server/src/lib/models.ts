import { config } from "../config.js";
import { LOCAL_EMBEDDING_MODEL } from "./localEmbeddings.js";

export type ProviderId = "openrouter" | "grok" | "openai" | "gemini";
export type EmbeddingProviderId = ProviderId | "local";

export type ChatModelOption = {
  id: string;
  label: string;
  free?: boolean;
};

export type ProviderDef = {
  id: ProviderId;
  name: string;
  baseUrl: string;
  chatModels: ChatModelOption[];
  embeddings: {
    supported: boolean;
    model?: string;
    dimensions: number;
    queryPrefix?: string;
    passagePrefix?: string;
    note?: string;
  };
};

const PUBLIC_URL = config.publicUrl;

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    chatModels: [
      { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash (default, very cheap)" },
      { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B IT (free)", free: true },
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)", free: true },
      { id: "qwen/qwen3-8b:free", label: "Qwen3 8B (free)", free: true },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini via OpenRouter" },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash via OpenRouter" },
      { id: "x-ai/grok-4.7", label: "Grok 4.7 via OpenRouter" },
    ],
    embeddings: {
      supported: false,
      dimensions: 384,
      note: "OpenRouter has no embeddings API. GhostChat uses the lightweight local hash embeddings (free, no key, free-tier friendly) by default.",
    },
  },
  grok: {
    id: "grok",
    name: "Grok (xAI)",
    baseUrl: "https://api.x.ai/v1",
    chatModels: [
      { id: "grok-4.7", label: "Grok 4.7" },
      { id: "grok-4.6", label: "Grok 4.6" },
      { id: "grok-4.5", label: "Grok 4.5" },
    ],
    embeddings: {
      supported: true,
      model: "v1",
      dimensions: 384,
      queryPrefix: "query: ",
      passagePrefix: "passage: ",
      note: "Supports a dimensions parameter; GhostChat requests 384 to match the local default index.",
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    chatModels: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
    embeddings: {
      supported: true,
      model: "text-embedding-3-small",
      dimensions: 384,
      note: "Requests 384 dimensions so vectors stay compatible with the local 384-d index.",
    },
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    chatModels: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ],
    embeddings: {
      supported: true,
      model: "gemini-embedding-001",
      dimensions: 384,
      note: "Requests 384 dimensions so vectors stay compatible with the local 384-d index.",
    },
  },
};

export const DEFAULT_CHAT_PROVIDER: ProviderId = "openrouter";
export const DEFAULT_CHAT_MODEL = "deepseek/deepseek-v4-flash";
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProviderId = "local";
export const EMBEDDING_DIMENSIONS = 384;

function firstEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export function providerKey(id: ProviderId): string {
  switch (id) {
    case "openrouter":
      return firstEnv(["OPENROUTER_API_KEY"]);
    case "grok":
      return firstEnv(["GROK_API_KEY", "XAI_API_KEY"]);
    case "openai":
      return firstEnv(["OPENAI_API_KEY", "AI_API_KEY"]);
    case "gemini":
      return firstEnv(["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"]);
  }
}

export function isProviderEnabled(id: ProviderId): boolean {
  return Boolean(providerKey(id));
}

export function enabledProviders(): ProviderId[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).filter(isProviderEnabled);
}

export function extraHeaders(id: ProviderId): Record<string, string> {
  if (id === "openrouter") {
    return {
      "HTTP-Referer": PUBLIC_URL || "https://github.com/GhostFaceModz/ghostchat",
      "X-Title": "GhostChat",
    };
  }
  return {};
}

export type ResolvedModel = {
  provider: EmbeddingProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  fallbackFrom?: { provider: string; model: string };
};

export function resolveChatModel(choice?: { chat_provider?: string | null; chat_model?: string | null }): ResolvedModel {
  const requestedProvider = (choice?.chat_provider || process.env.AI_PROVIDER || DEFAULT_CHAT_PROVIDER) as ProviderId;
  const requestedModel =
    choice?.chat_model ||
    process.env.OPENROUTER_MODEL ||
    process.env.AI_MODEL ||
    DEFAULT_CHAT_MODEL;

  const tryResolve = (provider: ProviderId, model: string): ResolvedModel | null => {
    const def = PROVIDERS[provider];
    const apiKey = providerKey(provider);
    if (!def || !apiKey) return null;
    return {
      provider,
      model: model || def.chatModels[0].id,
      baseUrl: def.baseUrl,
      apiKey,
      headers: extraHeaders(provider),
    };
  };

  const preferred = PROVIDERS[requestedProvider] ? tryResolve(requestedProvider, requestedModel) : null;
  if (preferred) return preferred;

  const openrouter = tryResolve(DEFAULT_CHAT_PROVIDER, DEFAULT_CHAT_MODEL);
  if (openrouter) {
    return { ...openrouter, fallbackFrom: { provider: requestedProvider, model: requestedModel } };
  }

  for (const id of enabledProviders()) {
    const resolved = tryResolve(id, PROVIDERS[id].chatModels[0].id);
    if (resolved) {
      return { ...resolved, fallbackFrom: { provider: requestedProvider, model: requestedModel } };
    }
  }

  throw new Error("No chat model provider is configured. Set OPENROUTER_API_KEY to use DeepSeek V4 Flash by default.");
}

/**
 * Per-plan model: Pro/Business sites that haven't picked their own model use PRO_CHAT_MODEL for the main
 * answer (env-configurable; unset = no change). Free sites and helper calls (suggestions, intent) are unchanged.
 */
export function planChatChoice(site?: { plan?: string | null; chat_provider?: string | null; chat_model?: string | null } | null, primary = false): { chat_provider?: string | null; chat_model?: string | null } | undefined {
  if (!site) return undefined;
  const proModel = process.env.PRO_CHAT_MODEL?.trim();
  if (primary && proModel && (site.plan === "pro" || site.plan === "business") && !site.chat_model) {
    return { chat_provider: process.env.PRO_CHAT_PROVIDER?.trim() || site.chat_provider || DEFAULT_CHAT_PROVIDER, chat_model: proModel };
  }
  return site;
}

export type ResolvedEmbedding = ResolvedModel & {
  queryPrefix: string;
  passagePrefix: string;
};

function localEmbedding(): ResolvedEmbedding {
  return {
    provider: "local",
    model: process.env.EMBEDDING_MODEL?.trim() || LOCAL_EMBEDDING_MODEL,
    baseUrl: "",
    apiKey: "",
    headers: {},
    queryPrefix: "",
    passagePrefix: "",
  };
}

export function resolveEmbeddingModel(): ResolvedEmbedding {
  const requested = (process.env.EMBEDDING_PROVIDER || process.env.AI_EMBEDDING_PROVIDER || DEFAULT_EMBEDDING_PROVIDER).trim() || DEFAULT_EMBEDDING_PROVIDER;
  const requestedModel = process.env.EMBEDDING_MODEL || process.env.AI_EMBEDDING_MODEL || "";

  if (requested === "local") return localEmbedding();

  const id = requested as ProviderId;
  const def = PROVIDERS[id];
  if (def?.embeddings.supported && providerKey(id)) {
    return {
      provider: id,
      model: requestedModel || def.embeddings.model || "",
      baseUrl: def.baseUrl,
      apiKey: providerKey(id),
      headers: extraHeaders(id),
      queryPrefix: def.embeddings.queryPrefix || "",
      passagePrefix: def.embeddings.passagePrefix || "",
    };
  }

  // If a paid embeddings provider was requested but has no key, fall back to local.
  return { ...localEmbedding(), fallbackFrom: { provider: requested, model: requestedModel } };
}

export function publicModelCatalog(): {
  defaultProvider: ProviderId;
  defaultModel: string;
  embedding: { provider?: EmbeddingProviderId; model?: string; dimensions: number; supported: boolean; note?: string };
  providers: Array<{
    id: ProviderId;
    name: string;
    enabled: boolean;
    models: ChatModelOption[];
    embeddings: ProviderDef["embeddings"];
  }>;
} {
  const resolved = resolveEmbeddingModel();
  return {
    defaultProvider: DEFAULT_CHAT_PROVIDER,
    defaultModel: DEFAULT_CHAT_MODEL,
    embedding: {
      provider: resolved.provider,
      model: resolved.model,
      dimensions: EMBEDDING_DIMENSIONS,
      supported: true,
      note:
        resolved.provider === "local"
          ? "Default: local hash/feature-384 (384-d, no API key, free-tier friendly)."
          : undefined,
    },
    providers: (Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({
      id,
      name: PROVIDERS[id].name,
      enabled: isProviderEnabled(id),
      models: PROVIDERS[id].chatModels,
      embeddings: PROVIDERS[id].embeddings,
    })),
  };
}
