import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null | undefined;

const getEnv = (key: string): string | null => {
  const value = import.meta.env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const resolveCredentials = () => {
  const url = getEnv("SUPABASE_URL") ?? getEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
};

export const getSupabaseServerClient = (): SupabaseClient | null => {
  if (cachedClient !== undefined) return cachedClient;
  const credentials = resolveCredentials();
  if (!credentials) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(credentials.url, credentials.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedClient;
};

export const hasSupabaseServerClient = (): boolean => Boolean(getSupabaseServerClient());
