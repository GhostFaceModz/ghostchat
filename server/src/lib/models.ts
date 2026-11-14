import { config } from "../config.js";

export type ProviderId = "grok" | "openai" | "openrouter" | "gemini";

export type ChatModelOption = {
  id: string;
  label: string;
};

export type ProviderDef = {
  id: ProviderId;
  name: string;
  baseUrl: string;
  chatModels: ChatModelOption[];
  embeddings: {
    supported: boolean;
    model?: string;
    dimensions: 1536;
    queryPrefix?: string;
    passagePrefix?: string;
    note?: string;
  };
};

const PUBLIC_URL = config.publicUrl;

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  grok: {
    id: "grok",
    name: "Grok (xAI)",
    baseUrl: "https://api.x.ai/v1",
    chatModels: [
      { id: "grok-4.7", label: "Grok 4.7 (default)" },
      { id: "grok-4.6", label: "Grok 4.6" },
      { id: "grok-4.5", label: "Grok 4.5" },
    ],
    embeddings: {
      supported: true,
      model: "v1",
      dimensions: 1536,
      queryPrefix: "query: ",
      passagePrefix: "passage: ",
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
    embeddings: { supported: true, model: "text-embedding-3-small", dimensions: 1536 },
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    chatModels: [
      { id: "x-ai/grok-4.7", label: "Grok 4.7 via OpenRouter" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini via OpenRouter" },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash via OpenRouter" },
    ],
    embeddings: {
      supported: false,
      dimensions: 1536,
      note: "Chat only by default. You can point EMBEDDING_PROVIDER at OpenAI, Grok, or Gemini instead.",
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
    embeddings: { supported: true, model: "gemini-embedding-001", dimensions: 1536 },
  },
};

export const DEFAULT_CHAT_PROVIDER: ProviderId = "grok";
export const DEFAULT_CHAT_MODEL = "grok-4.7";
export const EMBEDDING_DIMENSIONS = 1536;

function firstEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export function providerKey(id: ProviderId): string {
  switch (id) {
    case "grok":
      return firstEnv(["GROK_API_KEY", "XAI_API_KEY"]);
    case "openai":
      return firstEnv(["OPENAI_API_KEY", "AI_API_KEY"]);
    case "openrouter":
      return firstEnv(["OPENROUTER_API_KEY"]);
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
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  fallbackFrom?: { provider: string; model: string };
};

export function resolveChatModel(choice?: { chat_provider?: string | null; chat_model?: string | null }): ResolvedModel {
  const requestedProvider = (choice?.chat_provider || process.env.AI_PROVIDER || DEFAULT_CHAT_PROVIDER) as ProviderId;
  const requestedModel = choice?.chat_model || process.env.GROK_MODEL || process.env.AI_MODEL || DEFAULT_CHAT_MODEL;

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

  const grok = tryResolve(DEFAULT_CHAT_PROVIDER, DEFAULT_CHAT_MODEL);
  if (grok) {
    return { ...grok, fallbackFrom: { provider: requestedProvider, model: requestedModel } };
  }

  for (const id of enabledProviders()) {
    const resolved = tryResolve(id, PROVIDERS[id].chatModels[0].id);
    if (resolved) {
      return { ...resolved, fallbackFrom: { provider: requestedProvider, model: requestedModel } };
    }
  }

  throw new Error("No chat model provider is configured. Set GROK_API_KEY (or XAI_API_KEY) to use Grok by default.");
}

export type ResolvedEmbedding = ResolvedModel & {
  queryPrefix: string;
  passagePrefix: string;
};

export function resolveEmbeddingModel(): ResolvedEmbedding {
  const requested = (process.env.EMBEDDING_PROVIDER || process.env.AI_EMBEDDING_PROVIDER || "") as ProviderId | "";
  const requestedModel = process.env.EMBEDDING_MODEL || process.env.AI_EMBEDDING_MODEL || "";
  const order: ProviderId[] = requested && PROVIDERS[requested]
    ? [requested, "grok", "openai", "gemini"]
    : ["grok", "openai", "gemini"];

  const seen = new Set<ProviderId>();
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const def = PROVIDERS[id];
    if (!def.embeddings.supported || !providerKey(id)) continue;
    return {
      provider: id,
      model: requested && id === requested && requestedModel ? requestedModel : def.embeddings.model || requestedModel,
      baseUrl: def.baseUrl,
      apiKey: providerKey(id),
      headers: extraHeaders(id),
      queryPrefix: def.embeddings.queryPrefix || "",
      passagePrefix: def.embeddings.passagePrefix || "",
    };
  }
  throw new Error("No embeddings provider is configured. Set GROK_API_KEY or OPENAI_API_KEY (1536-d embeddings required).");
}

export function publicModelCatalog(): {
  defaultProvider: ProviderId;
  defaultModel: string;
  embedding: { provider?: ProviderId; model?: string; dimensions: number; supported: boolean; note?: string };
  providers: Array<{
    id: ProviderId;
    name: string;
    enabled: boolean;
    models: ChatModelOption[];
    embeddings: ProviderDef["embeddings"];
  }>;
} {
  let embedding: { provider?: ProviderId; model?: string; dimensions: number; supported: boolean; note?: string } = {
    dimensions: EMBEDDING_DIMENSIONS,
    supported: false,
    note: "No embeddings key is configured yet.",
  };
  try {
    const resolved = resolveEmbeddingModel();
    embedding = {
      provider: resolved.provider,
      model: resolved.model,
      dimensions: EMBEDDING_DIMENSIONS,
      supported: true,
    };
  } catch {
    // leave the note
  }

  return {
    defaultProvider: DEFAULT_CHAT_PROVIDER,
    defaultModel: DEFAULT_CHAT_MODEL,
    embedding,
    providers: (Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({
      id,
      name: PROVIDERS[id].name,
      enabled: isProviderEnabled(id),
      models: PROVIDERS[id].chatModels,
      embeddings: PROVIDERS[id].embeddings,
    })),
  };
}
