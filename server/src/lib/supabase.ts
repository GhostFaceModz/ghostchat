import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!config.supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_KEY is not set");
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
