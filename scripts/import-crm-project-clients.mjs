import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_TYPES = new Set(["individual", "company"]);
const CLIENT_STATUSES = new Set(["active", "inactive", "discarded", "blacklisted"]);
const CONTACT_TYPES = new Set(["lead", "client", "partner", "vendor", "agency", "lawyer"]);
const PROVIDER_TYPES = new Set(["developer", "promoter", "constructor", "architect", "agency", "owner", "other"]);
const PROVIDER_STATUSES = new Set(["active", "inactive"]);
const PROJECT_ROLES = new Set(["promoter", "developer", "constructor", "commercial_head", "exclusive_agent", "other"]);

const CLIENT_SELECT = "id, organization_id, contact_id, client_code, client_type, client_status, billing_name, tax_id, billing_address, profile_data, created_at, updated_at";
const CLIENT_SELECT_LEGACY = "id, organization_id, contact_id, client_code, client_type, client_status, billing_name, tax_id, billing_address, created_at, updated_at";
const CONTACT_SELECT = "id, organization_id, contact_type, full_name, email, phone, created_at, updated_at";
const PROVIDER_SELECT = "id, organization_id, client_id, provider_code, provider_type, provider_status, is_billable, notes, created_at, updated_at";
const PROJECT_SELECT = "id, organization_id, legacy_code, record_type";
const LINK_SELECT = "id, organization_id, project_property_id, provider_id, responsibility_role, commercial_terms, start_date, end_date, is_primary, notes, created_at, updated_at";

const parseEnvFile = (absolutePath) => {
  if (!fs.existsSync(absolutePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(absolutePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

const arg = (name) => {
  const prefix = `--${name}=`;
  const direct = process.argv.find((p) => p.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

const flag = (name) => process.argv.includes(`--${name}`);

const env = (key) => {
  const value = process.env[key] ?? envFromFiles[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const txt = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
};

const low = (v) => {
  const t = txt(v);
  return t ? t.toLowerCase() : null;
};

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);

const bool = (v, fallback = false) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : fallback;
  if (typeof v === "string") {
    const n = v.trim().toLowerCase();
    if (n === "true" || n === "1" || n === "yes") return true;
    if (n === "false" || n === "0" || n === "no") return false;
  }
  return fallback;
};

const date = (v) => {
  const t = txt(v);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

const int = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const norm = (value, allowed, fallback) => {
  const t = txt(value);
  return t && allowed.has(t) ? t : fallback;
};

const fmtErr = (e) => {
  if (!e) return "unknown_error";
  return [String(e.message ?? "unknown_error"), e.details ? `details=${e.details}` : null, e.hint ? `hint=${e.hint}` : null]
    .filter(Boolean)
    .join(" | ");
};

const isMissingProfile = (e) => {
  if (!e || typeof e !== "object") return false;
  const code = String(e.code ?? "");
  const message = String(e.message ?? "").toLowerCase();
  const details = String(e.details ?? "").toLowerCase();
  if (code === "42703") return message.includes("profile_data") || details.includes("profile_data");
  return message.includes("profile_data") && message.includes("does not exist");
};

const randomCode = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const first = async (query, label) => {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${fmtErr(error)}`);
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
};

const help = () => {
  console.log(`
Uso:
  node scripts/import-crm-project-clients.mjs --job-file <file.json> [--organization-id <uuid>] [--dry-run] [--update-existing] [--continue-on-error] [--limit-projects <n>] [--limit-clients <n>]
`);
};

const readJob = (jobPath) => {
  const absolute = path.isAbsolute(jobPath) ? jobPath : path.join(ROOT, jobPath);
  if (!fs.existsSync(absolute)) throw new Error(`job_file_not_found:${absolute}`);
  return { absolute, payload: JSON.parse(fs.readFileSync(absolute, "utf8")) };
};

const resolveProjects = async (client, organizationId) => {
  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .select(PROJECT_SELECT)
    .eq("organization_id", organizationId)
    .eq("record_type", "project");
  if (error) throw new Error(`db_projects_read_error: ${fmtErr(error)}`);

  const byId = new Map();
  const byLegacy = new Map();
  for (const row of data ?? []) {
    const id = txt(row.id);
    const legacy = txt(row.legacy_code);
    if (id) byId.set(id, row);
    if (legacy) byLegacy.set(legacy.toLowerCase(), row);
  }
  return { byId, byLegacy };
};
const resolveProjectFromItem = (maps, item) => {
  const pid = txt(item.project_id);
  const pcode = txt(item.project_legacy_code);
  if (!pid && !pcode) throw new Error("project_reference_required (project_id o project_legacy_code)");

  const byId = pid ? maps.byId.get(pid) ?? null : null;
  const byCode = pcode ? maps.byLegacy.get(pcode.toLowerCase()) ?? null : null;

  if (pid && !byId) throw new Error(`project_not_found_by_id:${pid}`);
  if (pcode && !byCode) throw new Error(`project_not_found_by_legacy_code:${pcode}`);
  if (byId && byCode && String(byId.id) !== String(byCode.id)) {
    throw new Error(`project_reference_mismatch:id=${pid} legacy=${pcode}`);
  }
  return byId ?? byCode;
};

const findClient = async (client, organizationId, columns, c) => {
  const cid = txt(c.client_id);
  const ccode = txt(c.client_code);
  const taxId = txt(c.tax_id);
  const email = low(c.email);

  if (cid) {
    const row = await first(
      client.schema("crm").from("clients").select(columns).eq("organization_id", organizationId).eq("id", cid).limit(1),
      "db_client_lookup_id_error"
    );
    if (row) return row;
  }

  if (ccode) {
    const row = await first(
      client
        .schema("crm")
        .from("clients")
        .select(columns)
        .eq("organization_id", organizationId)
        .eq("client_code", ccode)
        .limit(1),
      "db_client_lookup_code_error"
    );
    if (row) return row;
  }

  if (taxId) {
    const row = await first(
      client
        .schema("crm")
        .from("clients")
        .select(columns)
        .eq("organization_id", organizationId)
        .eq("tax_id", taxId)
        .order("updated_at", { ascending: false })
        .limit(1),
      "db_client_lookup_tax_error"
    );
    if (row) return row;
  }

  if (email) {
    const contact = await first(
      client
        .schema("crm")
        .from("contacts")
        .select(CONTACT_SELECT)
        .eq("organization_id", organizationId)
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1),
      "db_contact_lookup_email_error"
    );

    const contactId = txt(contact?.id);
    if (contactId) {
      const row = await first(
        client
          .schema("crm")
          .from("clients")
          .select(columns)
          .eq("organization_id", organizationId)
          .eq("contact_id", contactId)
          .order("updated_at", { ascending: false })
          .limit(1),
        "db_client_lookup_contact_error"
      );
      if (row) return row;
    }
  }

  const billing = txt(c.billing_name) ?? txt(c.full_name);
  if (billing) {
    return await first(
      client
        .schema("crm")
        .from("clients")
        .select(columns)
        .eq("organization_id", organizationId)
        .eq("billing_name", billing)
        .order("updated_at", { ascending: false })
        .limit(1),
      "db_client_lookup_billing_error"
    );
  }

  return null;
};

const findContact = async (client, organizationId, contactId) => {
  const id = txt(contactId);
  if (!id) return null;
  return await first(
    client
      .schema("crm")
      .from("contacts")
      .select(CONTACT_SELECT)
      .eq("organization_id", organizationId)
      .eq("id", id)
      .limit(1),
    "db_contact_lookup_id_error"
  );
};

const createContact = async (client, organizationId, c, dryRun) => {
  const payload = {
    organization_id: organizationId,
    contact_type: norm(c.contact_type, CONTACT_TYPES, "vendor"),
    full_name: txt(c.full_name) ?? txt(c.billing_name),
    email: low(c.email),
    phone: txt(c.phone),
    notes: txt(c.contact_notes) ?? txt(c.provider_notes) ?? txt(c.comments),
  };

  if (!payload.full_name) throw new Error("full_name_required_for_new_contact");

  if (dryRun) {
    return { id: `dry_contact_${crypto.randomUUID()}`, ...payload };
  }

  const { data, error } = await client.schema("crm").from("contacts").insert(payload).select(CONTACT_SELECT).single();
  if (error) throw new Error(`db_contact_insert_error: ${fmtErr(error)}`);
  return data;
};

const updateContact = async (client, organizationId, contactId, c, dryRun) => {
  const patch = {};
  if (txt(c.full_name) || txt(c.billing_name)) patch.full_name = txt(c.full_name) ?? txt(c.billing_name);
  if (txt(c.email)) patch.email = low(c.email);
  if (txt(c.phone)) patch.phone = txt(c.phone);
  if (!Object.keys(patch).length) return null;

  if (dryRun) return { id: contactId, ...patch };

  const { data, error } = await client
    .schema("crm")
    .from("contacts")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .select(CONTACT_SELECT)
    .single();
  if (error) throw new Error(`db_contact_update_error: ${fmtErr(error)}`);
  return data;
};

const createOrUpdateClient = async ({ client, organizationId, clientRow, contactRow, c, supportsProfileData, clientColumns, dryRun, updateExisting }) => {
  const fullName = txt(c.full_name) ?? txt(c.billing_name);

  if (clientRow) {
    if (!updateExisting) return { row: clientRow, supportsProfileData };

    const patch = {
      client_type: norm(c.client_type, CLIENT_TYPES, clientRow.client_type ?? "company"),
      client_status: norm(c.client_status, CLIENT_STATUSES, clientRow.client_status ?? "active"),
    };

    if (txt(c.client_code)) patch.client_code = txt(c.client_code);
    if (txt(c.tax_id)) patch.tax_id = txt(c.tax_id);
    if (txt(c.billing_name) || fullName) patch.billing_name = txt(c.billing_name) ?? fullName;

    if (supportsProfileData && Object.keys(obj(c.profile_data)).length) {
      patch.profile_data = { ...obj(clientRow.profile_data), ...obj(c.profile_data) };
    }

    if (contactRow?.id) {
      await updateContact(client, organizationId, contactRow.id, c, dryRun);
    }

    if (dryRun) return { row: { ...clientRow, ...patch }, supportsProfileData };

    let selectCols = supportsProfileData ? clientColumns : CLIENT_SELECT_LEGACY;
    let payload = { ...patch };
    if (!supportsProfileData) delete payload.profile_data;

    let result = await client
      .schema("crm")
      .from("clients")
      .update(payload)
      .eq("organization_id", organizationId)
      .eq("id", clientRow.id)
      .select(selectCols)
      .single();

    if (result.error && supportsProfileData && isMissingProfile(result.error)) {
      supportsProfileData = false;
      const fallback = { ...payload };
      delete fallback.profile_data;
      result = await client
        .schema("crm")
        .from("clients")
        .update(fallback)
        .eq("organization_id", organizationId)
        .eq("id", clientRow.id)
        .select(CLIENT_SELECT_LEGACY)
        .single();
    }

    if (result.error) throw new Error(`db_client_update_error: ${fmtErr(result.error)}`);
    return { row: result.data, supportsProfileData };
  }
  if (!fullName) throw new Error("full_name_required_for_new_client");

  const ensuredContact = contactRow ?? (await createContact(client, organizationId, c, dryRun));

  const payload = {
    organization_id: organizationId,
    contact_id: ensuredContact.id,
    client_code: txt(c.client_code) ?? randomCode("CLI"),
    client_type: norm(c.client_type, CLIENT_TYPES, "company"),
    client_status: norm(c.client_status, CLIENT_STATUSES, "active"),
    billing_name: txt(c.billing_name) ?? fullName,
    tax_id: txt(c.tax_id),
    billing_address: obj(c.billing_address),
    profile_data: obj(c.profile_data),
  };

  if (dryRun) return { row: { id: `dry_client_${crypto.randomUUID()}`, ...payload }, supportsProfileData };

  let insertPayload = { ...payload };
  if (!supportsProfileData) delete insertPayload.profile_data;

  let result = await client.schema("crm").from("clients").insert(insertPayload).select(clientColumns).single();

  if (result.error && supportsProfileData && isMissingProfile(result.error)) {
    supportsProfileData = false;
    const fallbackPayload = { ...insertPayload };
    delete fallbackPayload.profile_data;
    result = await client
      .schema("crm")
      .from("clients")
      .insert(fallbackPayload)
      .select(CLIENT_SELECT_LEGACY)
      .single();
  }

  if (result.error) throw new Error(`db_client_insert_error: ${fmtErr(result.error)}`);
  return { row: result.data, supportsProfileData };
};

const ensureProvider = async ({ client, organizationId, providerRow, clientId, c, dryRun, updateExisting }) => {
  if (providerRow) {
    if (txt(providerRow.client_id) !== txt(clientId)) {
      throw new Error(`provider_client_mismatch: provider_id=${providerRow.id}`);
    }

    if (!updateExisting) return providerRow;

    const patch = {
      provider_type: norm(c.provider_type, PROVIDER_TYPES, providerRow.provider_type ?? "promoter"),
      provider_status: norm(c.provider_status, PROVIDER_STATUSES, providerRow.provider_status ?? "active"),
      is_billable: bool(c.provider_is_billable, bool(providerRow.is_billable, true)),
    };
    if (txt(c.provider_code)) patch.provider_code = txt(c.provider_code);
    if (txt(c.provider_notes)) patch.notes = txt(c.provider_notes);

    if (dryRun) return { ...providerRow, ...patch };

    const { data, error } = await client
      .schema("crm")
      .from("providers")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", providerRow.id)
      .select(PROVIDER_SELECT)
      .single();
    if (error) throw new Error(`db_provider_update_error: ${fmtErr(error)}`);
    return data;
  }

  const payload = {
    organization_id: organizationId,
    client_id: clientId,
    provider_code: txt(c.provider_code) ?? randomCode("PRV"),
    provider_type: norm(c.provider_type, PROVIDER_TYPES, "promoter"),
    provider_status: norm(c.provider_status, PROVIDER_STATUSES, "active"),
    is_billable: bool(c.provider_is_billable, true),
    notes: txt(c.provider_notes),
  };

  if (dryRun) return { id: `dry_provider_${crypto.randomUUID()}`, ...payload };

  const { data, error } = await client.schema("crm").from("providers").insert(payload).select(PROVIDER_SELECT).single();
  if (error) throw new Error(`db_provider_insert_error: ${fmtErr(error)}`);
  return data;
};

const ensureProjectLink = async ({ client, organizationId, projectId, providerId, c, dryRun, updateExisting }) => {
  const role = norm(c.responsibility_role, PROJECT_ROLES, "promoter");

  const existing = await first(
    client
      .schema("crm")
      .from("project_providers")
      .select(LINK_SELECT)
      .eq("organization_id", organizationId)
      .eq("project_property_id", projectId)
      .eq("provider_id", providerId)
      .eq("responsibility_role", role)
      .limit(1),
    "db_project_provider_lookup_error"
  );

  const patch = {
    commercial_terms: obj(c.commercial_terms),
    start_date: date(c.start_date),
    end_date: date(c.end_date),
    is_primary: bool(c.is_primary, false),
    notes: txt(c.link_notes) ?? txt(c.notes) ?? txt(c.provider_notes),
  };

  if (existing) {
    if (!updateExisting) return { row: existing, state: "reused" };
    if (dryRun) return { row: { ...existing, ...patch }, state: "updated" };

    const { data, error } = await client
      .schema("crm")
      .from("project_providers")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", existing.id)
      .select(LINK_SELECT)
      .single();
    if (error) throw new Error(`db_project_provider_update_error: ${fmtErr(error)}`);
    return { row: data, state: "updated" };
  }

  const payload = {
    organization_id: organizationId,
    project_property_id: projectId,
    provider_id: providerId,
    responsibility_role: role,
    ...patch,
  };

  if (dryRun) return { row: { id: `dry_link_${crypto.randomUUID()}`, ...payload }, state: "created" };

  const { data, error } = await client
    .schema("crm")
    .from("project_providers")
    .insert(payload)
    .select(LINK_SELECT)
    .single();
  if (error) throw new Error(`db_project_provider_insert_error: ${fmtErr(error)}`);
  return { row: data, state: "created" };
};

const run = async () => {
  if (flag("help")) {
    help();
    return;
  }

  const jobFile = arg("job-file");
  if (!jobFile) throw new Error("job_file_required (--job-file)");

  const { absolute: jobPath, payload: job } = readJob(jobFile);
  const organizationId =
    txt(arg("organization-id")) ??
    txt(env("CRM_ORGANIZATION_ID")) ??
    txt(env("PUBLIC_CRM_ORGANIZATION_ID")) ??
    txt(job.organization_id);
  if (!organizationId || !UUID_RE.test(organizationId)) {
    throw new Error("organization_id_required_uuid (--organization-id o job.organization_id o CRM_ORGANIZATION_ID)");
  }

  const dryRun = flag("dry-run");
  const updateExisting = flag("update-existing");
  const continueOnError = flag("continue-on-error");
  const limitProjects = int(arg("limit-projects"));
  const limitClients = int(arg("limit-clients"));

  const projectsRaw = arr(job.projects);
  if (!projectsRaw.length) throw new Error("job_projects_required (job.projects[])");
  const projects = limitProjects ? projectsRaw.slice(0, limitProjects) : projectsRaw;

  const supabaseUrl = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const probe = await client
    .schema("crm")
    .from("clients")
    .select("id, profile_data")
    .eq("organization_id", organizationId)
    .limit(1);

  let supportsProfileData = true;
  if (probe.error) {
    if (isMissingProfile(probe.error)) supportsProfileData = false;
    else throw new Error(`schema_probe_failed: ${fmtErr(probe.error)}`);
  }

  let clientColumns = supportsProfileData ? CLIENT_SELECT : CLIENT_SELECT_LEGACY;
  const maps = await resolveProjects(client, organizationId);

  const stats = {
    dry_run: dryRun,
    update_existing: updateExisting,
    continue_on_error: continueOnError,
    organization_id: organizationId,
    job_file: path.relative(ROOT, jobPath),
    schema_profile_data: supportsProfileData ? "available" : "missing_legacy_fallback",
    projects_input: projects.length,
    projects_resolved: 0,
    clients_input: 0,
    clients_processed: 0,
    clients_created: 0,
    clients_reused: 0,
    providers_created: 0,
    providers_reused: 0,
    links_created: 0,
    links_updated: 0,
    links_reused: 0,
    errors: 0,
  };

  const failures = [];
  let processedClients = 0;

  for (let pi = 0; pi < projects.length; pi += 1) {
    const projectItem = obj(projects[pi]);
    let projectRow;

    try {
      projectRow = resolveProjectFromItem(maps, projectItem);
    } catch (error) {
      stats.errors += 1;
      failures.push({ project_index: pi, error: error instanceof Error ? error.message : "project_resolution_error" });
      if (!continueOnError) throw error;
      continue;
    }

    stats.projects_resolved += 1;

    const defaults = {
      ...obj(job.defaults),
      ...obj(projectItem.defaults),
      responsibility_role: txt(projectItem.responsibility_role) ?? txt(obj(job.defaults).responsibility_role),
      is_primary: projectItem.is_primary !== undefined ? projectItem.is_primary : obj(job.defaults).is_primary,
      link_notes: txt(projectItem.link_notes) ?? txt(projectItem.notes),
      commercial_terms:
        Object.keys(obj(projectItem.commercial_terms)).length > 0
          ? obj(projectItem.commercial_terms)
          : obj(obj(job.defaults).commercial_terms),
    };

    const clients = arr(projectItem.clients);
    stats.clients_input += clients.length;

    for (let ci = 0; ci < clients.length; ci += 1) {
      if (limitClients && processedClients >= limitClients) break;
      processedClients += 1;

      const c = { ...defaults, ...obj(clients[ci]) };

      try {
        let clientRow = await findClient(client, organizationId, clientColumns, c);
        let contactRow = clientRow ? await findContact(client, organizationId, clientRow.contact_id) : null;

        const beforeClientExists = Boolean(clientRow);

        if (!clientRow) {
          contactRow = await createContact(client, organizationId, c, dryRun);
        }

        const clientResult = await createOrUpdateClient({
          client,
          organizationId,
          clientRow,
          contactRow,
          c,
          supportsProfileData,
          clientColumns,
          dryRun,
          updateExisting,
        });

        clientRow = clientResult.row;
        supportsProfileData = clientResult.supportsProfileData;
        clientColumns = supportsProfileData ? CLIENT_SELECT : CLIENT_SELECT_LEGACY;

        if (beforeClientExists) stats.clients_reused += 1;
        else stats.clients_created += 1;

        const providerIdFromInput = txt(c.provider_id);
        const providerById = providerIdFromInput
          ? await first(
              client
                .schema("crm")
                .from("providers")
                .select(PROVIDER_SELECT)
                .eq("organization_id", organizationId)
                .eq("id", providerIdFromInput)
                .limit(1),
              "db_provider_lookup_id_error"
            )
          : null;

        let providerRow =
          providerById ??
          (await first(
            client
              .schema("crm")
              .from("providers")
              .select(PROVIDER_SELECT)
              .eq("organization_id", organizationId)
              .eq("client_id", clientRow.id)
              .limit(1),
            "db_provider_lookup_client_error"
          ));

        const beforeProviderExists = Boolean(providerRow);
        providerRow = await ensureProvider({
          client,
          organizationId,
          providerRow,
          clientId: clientRow.id,
          c,
          dryRun,
          updateExisting,
        });

        if (beforeProviderExists) stats.providers_reused += 1;
        else stats.providers_created += 1;

        const link = await ensureProjectLink({
          client,
          organizationId,
          projectId: projectRow.id,
          providerId: providerRow.id,
          c,
          dryRun,
          updateExisting,
        });

        if (link.state === "created") stats.links_created += 1;
        if (link.state === "updated") stats.links_updated += 1;
        if (link.state === "reused") stats.links_reused += 1;

        stats.clients_processed += 1;
      } catch (error) {
        stats.errors += 1;
        failures.push({
          project_index: pi,
          project_id: txt(projectRow?.id),
          project_legacy_code: txt(projectRow?.legacy_code),
          client_index: ci,
          client_ref:
            txt(c.client_id) ?? txt(c.client_code) ?? txt(c.tax_id) ?? txt(c.email) ?? txt(c.full_name) ?? null,
          error: error instanceof Error ? error.message : "client_process_error",
        });
        if (!continueOnError) throw error;
      }
    }

    if (limitClients && processedClients >= limitClients) break;
  }

  stats.failures_preview = failures.slice(0, 20);
  stats.failures_omitted = Math.max(0, failures.length - 20);

  console.log(JSON.stringify(stats, null, 2));

  if (failures.length && !continueOnError) {
    throw new Error(`import_finished_with_errors:${failures.length}`);
  }
};

run().catch((error) => {
  console.error("Error importando clientes por proyecto:", error instanceof Error ? error.message : error);
  process.exit(1);
});
