import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { syncNotificationsForOrganization } from "../packages/shared/src/notifications/sync.ts";
import { normalizeNotificationRuleKey } from "../packages/shared/src/notifications/domain.ts";

const loadEnvFile = () => {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] != null) continue;
    process.env[key] = value;
  }
};

const readArg = (name: string) => {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  for (const arg of process.argv.slice(2)) {
    if (arg === exact) return "true";
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

loadEnvFile();

const organizationId = asText(readArg("organization-id")) ?? asText(process.env.CRM_ORGANIZATION_ID);
const supabaseUrl = asText(process.env.SUPABASE_URL) ?? asText(process.env.PUBLIC_SUPABASE_URL);
const supabaseKey = asText(process.env.SUPABASE_SERVICE_ROLE_KEY);
const scope = asText(readArg("scope")) ?? "all";
const onlyRule = normalizeNotificationRuleKey(readArg("only-rule"));
const dryRunArg = readArg("dry-run");
const dryRun =
  dryRunArg === "true" ||
  dryRunArg === "1" ||
  asText(process.env.npm_config_dry_run) === "true" ||
  asText(process.env.npm_config_dry_run) === "1";
const limit = asPositiveInt(readArg("limit"));

if (!organizationId) throw new Error("organization_id_required");
if (!supabaseUrl || !supabaseKey) throw new Error("supabase_credentials_required");

const client = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const result = await syncNotificationsForOrganization(client, organizationId, {
  scope: scope === "leads" || scope === "deals" || scope === "reservations" ? scope : "all",
  onlyRule,
  dryRun,
  limit,
});

console.log(JSON.stringify(result, null, 2));
