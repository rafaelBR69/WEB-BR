import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedServiceClient: SupabaseClient | null | undefined;
let cachedAuthClient: SupabaseClient | null | undefined;

const getEnv = (key: string): string | null => {
  const value = import.meta.env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const resolveServiceCredentials = () => {
  const url = getEnv("SUPABASE_URL") ?? getEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
};

const resolveAuthCredentials = () => {
  const url = getEnv("SUPABASE_URL") ?? getEnv("PUBLIC_SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY") ?? getEnv("PUBLIC_SUPABASE_ANON_KEY");
  if (url && anonKey) {
    return { url, authKey: anonKey };
  }

  // Fallback keeps local/prod environments operational until anon key is provisioned.
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (url && serviceRoleKey) {
    return { url, authKey: serviceRoleKey };
  }

  return null;
};

export const getSupabaseServerClient = (): SupabaseClient | null => {
  if (cachedServiceClient !== undefined) return cachedServiceClient;
  const credentials = resolveServiceCredentials();
  if (!credentials) {
    cachedServiceClient = null;
    return cachedServiceClient;
  }

  cachedServiceClient = createClient(credentials.url, credentials.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedServiceClient;
};

export const getSupabaseServerAuthClient = (): SupabaseClient | null => {
  if (cachedAuthClient !== undefined) return cachedAuthClient;
  const credentials = resolveAuthCredentials();
  if (!credentials) {
    cachedAuthClient = null;
    return cachedAuthClient;
  }

  cachedAuthClient = createClient(credentials.url, credentials.authKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedAuthClient;
};

export const hasSupabaseServerClient = (): boolean => Boolean(getSupabaseServerClient());
export const hasSupabaseServerAuthClient = (): boolean => Boolean(getSupabaseServerAuthClient());
