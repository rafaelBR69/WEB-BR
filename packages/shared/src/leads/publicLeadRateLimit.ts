import type { SupabaseClient } from "@supabase/supabase-js";

export const PUBLIC_LEAD_LOG_SOURCE = "public_lead_form";
export const PUBLIC_LEAD_RATE_LIMITS = {
  ip: {
    attempts: 5,
    windowMs: 15 * 60 * 1000,
  },
  email: {
    attempts: 3,
    windowMs: 24 * 60 * 60 * 1000,
  },
  phone: {
    attempts: 3,
    windowMs: 24 * 60 * 60 * 1000,
  },
} as const;

export type PublicLeadRateLimitResult = {
  blocked: boolean;
  reasons: string[];
  counts: {
    ip: number;
    email: number;
    phone: number;
  };
};

const buildCutoffIso = (windowMs: number, nowMs: number) => new Date(nowMs - windowMs).toISOString();

const countPublicLeadLogs = async (
  client: SupabaseClient,
  input: {
    organizationId: string;
    fromIso: string;
    ip?: string | null;
    email?: string | null;
    phoneNormalized?: string | null;
  }
) => {
  let query = client
    .schema("crm")
    .from("portal_access_logs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", input.organizationId)
    .in("event_type", ["blocked", "lead_submitted"])
    .gte("created_at", input.fromIso)
    .contains("metadata", { source: PUBLIC_LEAD_LOG_SOURCE });

  if (input.ip) {
    query = query.eq("ip", input.ip);
  }

  if (input.email) {
    query = query.eq("email", input.email);
  }

  if (input.phoneNormalized) {
    query = query.contains("metadata", {
      source: PUBLIC_LEAD_LOG_SOURCE,
      phone_normalized: input.phoneNormalized,
    });
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`public_lead_rate_limit_read_error:${error.message}`);
  }

  return count ?? 0;
};

export const normalizePublicLeadRateLimitPhone = (phone: string | null) => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
};

export const checkPublicLeadRateLimit = async (
  client: SupabaseClient,
  input: {
    organizationId: string;
    ip: string | null;
    email: string | null;
    phone: string | null;
    nowMs?: number;
  }
): Promise<PublicLeadRateLimitResult> => {
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  const normalizedPhone = normalizePublicLeadRateLimitPhone(input.phone);

  const [ipCount, emailCount, phoneCount] = await Promise.all([
    input.ip
      ? countPublicLeadLogs(client, {
          organizationId: input.organizationId,
          fromIso: buildCutoffIso(PUBLIC_LEAD_RATE_LIMITS.ip.windowMs, nowMs),
          ip: input.ip,
        })
      : Promise.resolve(0),
    input.email
      ? countPublicLeadLogs(client, {
          organizationId: input.organizationId,
          fromIso: buildCutoffIso(PUBLIC_LEAD_RATE_LIMITS.email.windowMs, nowMs),
          email: input.email,
        })
      : Promise.resolve(0),
    normalizedPhone
      ? countPublicLeadLogs(client, {
          organizationId: input.organizationId,
          fromIso: buildCutoffIso(PUBLIC_LEAD_RATE_LIMITS.phone.windowMs, nowMs),
          phoneNormalized: normalizedPhone,
        })
      : Promise.resolve(0),
  ]);

  const reasons: string[] = [];
  if (ipCount >= PUBLIC_LEAD_RATE_LIMITS.ip.attempts) reasons.push("rate_limit_ip");
  if (emailCount >= PUBLIC_LEAD_RATE_LIMITS.email.attempts) reasons.push("rate_limit_email");
  if (phoneCount >= PUBLIC_LEAD_RATE_LIMITS.phone.attempts) reasons.push("rate_limit_phone");

  return {
    blocked: reasons.length > 0,
    reasons,
    counts: {
      ip: ipCount,
      email: emailCount,
      phone: phoneCount,
    },
  };
};
