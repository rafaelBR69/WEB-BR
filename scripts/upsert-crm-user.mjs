import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();

const parseEnvFile = (absolutePath) => {
  if (!fs.existsSync(absolutePath)) return {};
  const out = {};
  const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (!key) continue;
    const hashIndex = value.indexOf(" #");
    if (hashIndex >= 0) value = value.slice(0, hashIndex).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const envFromFiles = {
  ...parseEnvFile(path.join(ROOT, ".env")),
  ...parseEnvFile(path.join(ROOT, ".env.local")),
};

const asText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asEnv = (key) => asText(process.env[key] ?? envFromFiles[key] ?? null);

const readArg = (flagName) => {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${flagName}`);
  if (index >= 0) return process.argv[index + 1] || null;
  return null;
};

const asBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return fallback;
};

const CRM_MEMBERSHIP_ROLES = new Set(["owner", "admin", "agent", "finance", "legal", "viewer"]);

const asMembershipRole = (value) => {
  const normalized = asText(value)?.toLowerCase() ?? null;
  if (!normalized) return null;
  return CRM_MEMBERSHIP_ROLES.has(normalized) ? normalized : null;
};

const findUserByEmail = async (client, email) => {
  let page = 1;
  const perPage = 200;

  while (page <= 20) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`auth_list_users_error:${error.message}`);

    const users = Array.isArray(data?.users) ? data.users : [];
    const hit = users.find((entry) => asText(entry?.email)?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (users.length < perPage) break;
    page += 1;
  }

  return null;
};

const upsertMembership = async (client, options) => {
  const organizationId = asText(options.organizationId);
  const userId = asText(options.userId);
  const role = asMembershipRole(options.role);

  if (!organizationId || !userId || !role) {
    return {
      applied: false,
      membership: null,
    };
  }

  const payload = {
    organization_id: organizationId,
    user_id: userId,
    role,
    is_active: true,
  };

  const { data, error } = await client
    .schema("crm")
    .from("memberships")
    .upsert(payload, { onConflict: "organization_id,user_id" })
    .select("id,organization_id,user_id,role,is_active")
    .single();

  if (error) throw new Error(`crm_membership_upsert_error:${error.message}`);

  return {
    applied: true,
    membership: data ?? null,
  };
};

const run = async () => {
  const email = asText(readArg("email"))?.toLowerCase() ?? null;
  const password = asText(readArg("password"));
  const fullName = asText(readArg("full-name")) ?? "Usuario CRM";
  const role = asText(readArg("role")) ?? "staff";
  const organizationId = asText(readArg("organization-id")) ?? asEnv("CRM_ORGANIZATION_ID");
  const membershipRole = asMembershipRole(readArg("membership-role")) ?? asMembershipRole(role);
  const isDeveloper = asBoolean(readArg("developer"), false);

  if (!email) throw new Error("email_required (--email)");
  if (!password) throw new Error("password_required (--password)");
  if (password.length < 8) throw new Error("password_too_short (min 8 chars)");

  const supabaseUrl = asEnv("SUPABASE_URL") ?? asEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = asEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const metadata = {
    full_name: fullName,
    crm_role: role,
    crm_roles: isDeveloper ? [role, "developer"] : [role],
    crm_is_developer: isDeveloper,
  };

  const existing = await findUserByEmail(client, email);
  if (existing) {
    const { data, error } = await client.auth.admin.updateUserById(existing.id, {
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
      app_metadata: {
        role,
        crm_is_developer: isDeveloper,
      },
    });
    if (error || !data?.user) {
      throw new Error(`auth_update_user_error:${error?.message ?? "unknown_error"}`);
    }

    const user = data.user;
    const membership = await upsertMembership(client, {
      organizationId,
      userId: user.id,
      role: membershipRole,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "updated",
          user: {
            id: user.id,
            email: user.email,
            email_confirmed_at: user.email_confirmed_at,
            user_metadata: user.user_metadata,
            app_metadata: user.app_metadata,
          },
          membership: membership.membership,
        },
        null,
        2
      )
    );
    return;
  }

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
    app_metadata: {
      role,
      crm_is_developer: isDeveloper,
    },
  });
  if (error || !data?.user) {
    throw new Error(`auth_create_user_error:${error?.message ?? "unknown_error"}`);
  }

  const user = data.user;
  const membership = await upsertMembership(client, {
    organizationId,
    userId: user.id,
    role: membershipRole,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "created",
        user: {
          id: user.id,
          email: user.email,
          email_confirmed_at: user.email_confirmed_at,
          user_metadata: user.user_metadata,
          app_metadata: user.app_metadata,
        },
        membership: membership.membership,
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  const details = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: details }, null, 2));
  process.exitCode = 1;
});
