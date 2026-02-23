import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLIENT_SELECT =
  "id, organization_id, contact_id, client_code, client_type, client_status, billing_name, tax_id, profile_data";
const CONTACT_SELECT = "id, organization_id, full_name, email, phone";
const RESERVATION_SELECT = "id, organization_id, client_id, project_property_id, source_file, source_row_number";

const parseEnvFile = (file) => {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const envFiles = {
  ...parseEnvFile(path.join(ROOT, ".env")),
  ...parseEnvFile(path.join(ROOT, ".env.local")),
};

const env = (name) => {
  const value = process.env[name] ?? envFiles[name];
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length ? t : null;
};

const arg = (name) => {
  const p = `--${name}=`;
  const direct = process.argv.find((x) => x.startsWith(p));
  if (direct) return direct.slice(p.length);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

const flag = (name) => process.argv.includes(`--${name}`);

const txt = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
};

const low = (v) => {
  const t = txt(v);
  return t ? t.toLowerCase() : null;
};

const canonical = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const parseCsv = (raw) => {
  const text = String(raw ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  row.push(field);
  if (row.some((x) => String(x ?? "").length > 0) || rows.length === 0) rows.push(row);
  return rows;
};

const detectHeader = (rows) => {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const values = rows[i].map((x) => String(x ?? "").trim()).filter(Boolean);
    const c = canonical(values.join(" "));
    const score =
      values.length +
      (c.includes("comprador") ? 4 : 0) +
      (c.includes("mail") ? 2 : 0) +
      (c.includes("telefono") ? 2 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
};

const buildLookup = (headers) => {
  const normalized = headers.map((h) => String(h ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim());
  const byKey = new Map();
  normalized.forEach((h, idx) => {
    const k = canonical(h);
    if (!k) return;
    const bucket = byKey.get(k) ?? [];
    bucket.push(idx);
    byKey.set(k, bucket);
  });
  return { headers: normalized, byKey };
};

const pick = (row, lookup, aliases) => {
  for (const alias of aliases) {
    const idxs = lookup.byKey.get(canonical(alias)) ?? [];
    for (const idx of idxs) {
      const value = txt(row[idx]);
      if (value) return value;
    }
  }
  return null;
};

const parseDate = (value) => {
  const t = txt(value);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const parseNumber = (value) => {
  const t = txt(value);
  if (!t) return null;
  const cleaned = t.replace(/[€\s]/g, "").replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  const both = cleaned.includes(",") && cleaned.includes(".");
  const n = both
    ? cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "")
    : cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned;
  const parsed = Number(n);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBool = (value) => {
  const c = canonical(value);
  if (!c) return null;
  if (["true", "si", "yes", "1", "x"].includes(c)) return true;
  if (["false", "no", "0"].includes(c)) return false;
  if (c.includes("pendiente") || c.includes("falta")) return false;
  return null;
};

const firstEmail = (value) => {
  const t = txt(value);
  if (!t) return null;
  const m = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : low(t);
};

const firstTaxId = (value) => {
  const t = txt(value);
  if (!t) return null;
  return t.split(/[\/|]/).map((x) => x.trim())[0] || t;
};

const randomCode = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const inferTaxType = (value) => {
  const c = canonical(value);
  if (!c) return null;
  if (c.includes("dni")) return "dni";
  if (c.includes("nie") || c.includes("residencia")) return "nie";
  if (c.includes("cif") || c.includes("nif")) return "cif";
  if (c.includes("pasaporte")) return "passport";
  return "other";
};

const inferChannel = (value) => (canonical(value).includes("agencia") ? "agency" : "other");

const inferClientType = (value) => (canonical(value).includes("jurid") || canonical(value).includes("empresa") ? "company" : "individual");

const inferPersonKind = (clientType) => (clientType === "company" ? "juridica" : "fisica");

const inferReservationStatus = (state, dropDate, paid, adhesion) => {
  const c = canonical(state);
  if (dropDate) return "discarded";
  if (c.includes("cancel")) return "cancelled";
  if (adhesion === true) return "adhesion_paid";
  if (paid === true || c.includes("reserva")) return "reserved";
  if (c.includes("enviado")) return "reservation_sent";
  return "other";
};

const buildRawRow = (headers, row) => {
  const out = {};
  headers.forEach((h, i) => {
    out[txt(h) ?? `col_${i + 1}`] = txt(row[i]);
  });
  return out;
};

const parseSource = (source) => {
  const sourcePath = path.isAbsolute(source.file) ? source.file : path.join(ROOT, source.file);
  if (!fs.existsSync(sourcePath)) throw new Error(`source_file_not_found:${sourcePath}`);
  const rows = parseCsv(fs.readFileSync(sourcePath, "utf8"));
  const headerIndex = Number.isInteger(source.header_row) && source.header_row > 0 ? source.header_row - 1 : detectHeader(rows);
  const lookup = buildLookup(rows[headerIndex] ?? []);
  const mapped = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = lookup.headers.map((_, idx) => txt(rows[i]?.[idx]) ?? "");
    const fullName = pick(row, lookup, ["COMPRADOR /ES"]);
    const taxId = firstTaxId(pick(row, lookup, ["DNI", "DNI o DNIS", "ID"]));
    const email = firstEmail(pick(row, lookup, ["Mail", "Email"]));
    const phone = txt(pick(row, lookup, ["Telefono"]));
    const hasStrongIdentity = Boolean(fullName || taxId || (email && phone));
    if (!hasStrongIdentity) continue;
    const state = pick(row, lookup, ["Estado"]);
    const reservationPaid = parseBool(pick(row, lookup, ["Reserva pagada", "Reservada pagada"]));
    const adhesionPaid = parseBool(pick(row, lookup, ["Adhesion pagada"]));
    const dropDate = parseDate(pick(row, lookup, ["BAJA"]));
    const clientType = inferClientType(pick(row, lookup, ["Persona o Empresa"]));
    const docType = pick(row, lookup, ["Tramite documento", "Verificación Documento", "Verificacion Documento"]);
    mapped.push({
      source_row_number: i + 1,
      full_name: fullName,
      email,
      phone,
      tax_id: taxId,
      client_type: clientType,
      person_kind: inferPersonKind(clientType),
      tax_id_type: inferTaxType(docType ?? taxId),
      intake_date: parseDate(pick(row, lookup, ["Fecha de reserva"])) ?? parseDate(pick(row, lookup, ["Fecha preinscripción", "Fecha preinscripcion"])),
      entry_channel: inferChannel(pick(row, lookup, ["Directo / Agencia", "¿Comprador directo o representado por agencia?"]) ?? ""),
      agency_name: pick(row, lookup, ["Agencia y Nombre agente", "Contacto Agencia", "Contacto agencia"]),
      agent_name: pick(row, lookup, ["COMERCIAL", "Agente"]),
      nationality: pick(row, lookup, ["NACIONALIDAD"]),
      comments: pick(row, lookup, ["Comentarios", "COMENTARIO"]),
      reservation_notes: state,
      reservation: {
        reservation_status: inferReservationStatus(state, dropDate, reservationPaid, adhesionPaid),
        reservation_state_text: state,
        reservation_date: parseDate(pick(row, lookup, ["Fecha de reserva"])),
        pre_registration_date: parseDate(pick(row, lookup, ["Fecha preinscripción", "Fecha preinscripcion"])),
        reservation_paid_date: parseDate(pick(row, lookup, ["Fecha de pago de reserva"])),
        adhesion_paid_date: parseDate(pick(row, lookup, ["Fecha de pago de Adhesion"])),
        drop_date: dropDate,
        interest_date: parseDate(
          pick(row, lookup, [
            "¿Cuándo se interesa por Orion?",
            "¿Cuándo se interesa por Sunset?",
            "¿Cuándo se interesa por Nylva?",
          ])
        ),
        transaction_cycle_days: parseNumber(pick(row, lookup, ["Transaction cycle time (días)", "Transaction cycle time dias"])),
        price_without_vat: parseNumber(pick(row, lookup, ["Precio sin IVA"])),
        price_with_vat: parseNumber(pick(row, lookup, ["Precio con IVA"])),
        price_with_increment: parseNumber(
          pick(row, lookup, ["PRECIO CON IVA INCREMENTO DIC 25", "PRECIO SIN IVA CON INCREMENTO DIC 25"])
        ),
        increment_amount: parseNumber(pick(row, lookup, ["INCREMENTO DIC 25"])),
        ppc_amount: parseNumber(pick(row, lookup, ["10% PPC con incremento"])),
        ppc_balance_amount: parseNumber(
          pick(row, lookup, ["PPC 10%  con incremento+ IVA 10% + IVA Reserva - Reserva 5000"])
        ),
        adhesion_amount: parseNumber(pick(row, lookup, ["IMPORTE ADHESION CON PREINSCR."])),
        commission_rate: parseNumber(pick(row, lookup, ["COMISION", "Comisión firmada con la agencia"])),
        agency_commission_amount: parseNumber(
          pick(row, lookup, ["COMISION A PAGAR A AGENCIAS SIN IVA", "COMISIÓN AGENCIA 3% sin IVA"])
        ),
        internal_commission_amount: parseNumber(
          pick(row, lookup, ["COMISION BLANCAREAL SIN IVA", "COMISIÓN BLANCAREAL sin IVA"])
        ),
        unit_reference: pick(row, lookup, ["Unidad Vivienda"]),
        unit_portal: pick(row, lookup, ["Unidad Vivienda Portal"]),
        unit_floor: pick(row, lookup, ["Unidad Vivienda Piso"]),
        unit_letter: pick(row, lookup, ["Unidad Vivienda Letra"]),
        parking_reference: pick(row, lookup, ["Nº Parking", "Nº Parking comentarios"]),
        storage_reference: pick(row, lookup, ["Nº Trastero"]),
        document_type: docType,
        document_verification: pick(row, lookup, ["Verificación Documento", "Verificacion Documento", "Verificación Documentos"]),
        is_direct_sale: canonical(pick(row, lookup, ["Directo / Agencia", "¿Comprador directo o representado por agencia?"])).includes("directo"),
        is_agency_sale: canonical(pick(row, lookup, ["Directo / Agencia", "¿Comprador directo o representado por agencia?"])).includes("agencia"),
        is_collaboration_contract_signed: parseBool(pick(row, lookup, ["Contrato colaboración firmado"])),
        is_reservation_paid: reservationPaid,
        is_contract_paid: parseBool(pick(row, lookup, ["Contrato compraventa abonado"])),
        is_pre_registration_paid: parseBool(pick(row, lookup, ["Preinscripción pagada", "Preinscripcion pagada"])),
        is_adhesion_paid: adhesionPaid,
        is_reservation_contract_signed: parseBool(pick(row, lookup, ["Contrato de reserva firmado por el cliente"])),
        is_adhesion_contract_signed: parseBool(pick(row, lookup, ["Contrato de adhesión firmado", "Contrato de adhesion firmado"])),
        is_document_copy_received: parseBool(pick(row, lookup, ["Fotocopia del DNI/Pasaporte", "Fotocopia DNI/Pasaporte"])),
        is_aml_form_received: parseBool(pick(row, lookup, ["Formulario de Blanqueo firmado", "Formulario de Blanqueo"])),
        is_uploaded_to_folder: parseBool(pick(row, lookup, ["¿Subido a nuestra carpeta?"])),
        is_represented_by_lawyer: parseBool(pick(row, lookup, ["Representante Abogado", "Representante", "Abogado"])),
        buyer_civil_status: pick(row, lookup, ["Estado civil compradores"]),
        buyer_motivation: pick(row, lookup, ["Motivo de compra"]),
        agency_name: pick(row, lookup, ["Agencia y Nombre agente", "Contacto Agencia", "Contacto agencia"]),
        agency_contact: pick(row, lookup, ["Contacto Agencia", "Contacto agencia", "Email Agencia"]),
        agent_name: pick(row, lookup, ["COMERCIAL", "Agente"]),
        lawyer_name: pick(row, lookup, ["Representante Abogado", "Representante", "Abogado"]),
        lawyer_contact: pick(row, lookup, ["Contacto abogado"]),
        comments: pick(row, lookup, ["Comentarios", "COMENTARIO"]),
        follow_up_comments: pick(row, lookup, ["Comentario Seguimiento"]),
        commercial_comments: pick(row, lookup, ["Comentarios comerciales"]),
      },
      metadata: {
        raw_row: buildRawRow(lookup.headers, row),
      },
    });
  }
  return {
    file_path: sourcePath,
    source_file_name: path.basename(sourcePath),
    header_row: headerIndex + 1,
    rows: mapped,
  };
};

const findClientByTax = async (db, organizationId, taxId) => {
  if (!txt(taxId)) return null;
  const { data, error } = await db
    .schema("crm")
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("organization_id", organizationId)
    .eq("tax_id", taxId)
    .limit(1);
  if (error) throw new Error(`db_client_lookup_tax_error:${error.message}`);
  return Array.isArray(data) && data.length ? data[0] : null;
};

const findClientByEmail = async (db, organizationId, email) => {
  if (!low(email)) return null;
  const { data: contacts, error: contactError } = await db
    .schema("crm")
    .from("contacts")
    .select(CONTACT_SELECT)
    .eq("organization_id", organizationId)
    .eq("email", low(email))
    .limit(1);
  if (contactError) throw new Error(`db_contact_lookup_email_error:${contactError.message}`);
  if (!Array.isArray(contacts) || !contacts.length) return null;
  const contact = contacts[0];
  const { data: clients, error: clientError } = await db
    .schema("crm")
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("organization_id", organizationId)
    .eq("contact_id", contact.id)
    .limit(1);
  if (clientError) throw new Error(`db_client_lookup_contact_error:${clientError.message}`);
  return Array.isArray(clients) && clients.length ? { client: clients[0], contact } : null;
};

const ensureClient = async (ctx) => {
  const { db, organizationId, row, dryRun, updateExisting, stats, cache } = ctx;
  const tax = txt(row.tax_id);
  const email = low(row.email);
  const name = txt(row.full_name);
  if (tax && cache.byTax.has(tax)) return cache.byTax.get(tax);
  if (email && cache.byEmail.has(email)) return cache.byEmail.get(email);
  if (name && cache.byName.has(name)) return cache.byName.get(name);

  let found = null;
  if (tax) {
    const client = await findClientByTax(db, organizationId, tax);
    if (client) found = { client, contact: null };
  }
  if (!found && email) found = await findClientByEmail(db, organizationId, email);

  if (found?.client) {
    stats.clients_reused += 1;
    if (updateExisting && !dryRun) {
      const patch = {};
      if (!txt(found.client.tax_id) && tax) patch.tax_id = tax;
      if (!txt(found.client.billing_name) && name) patch.billing_name = name;
      if (Object.keys(patch).length) {
        const { data, error } = await db
          .schema("crm")
          .from("clients")
          .update(patch)
          .eq("organization_id", organizationId)
          .eq("id", found.client.id)
          .select(CLIENT_SELECT)
          .single();
        if (error) throw new Error(`db_client_update_error:${error.message}`);
        found.client = data;
        stats.clients_updated += 1;
      }
    }
    if (tax) cache.byTax.set(tax, found.client);
    if (email) cache.byEmail.set(email, found.client);
    if (name) cache.byName.set(name, found.client);
    return found.client;
  }

  if (dryRun) {
    const dryClient = { id: `dry_client_${crypto.randomUUID()}`, billing_name: name, tax_id: tax };
    stats.clients_created += 1;
    if (tax) cache.byTax.set(tax, dryClient);
    if (email) cache.byEmail.set(email, dryClient);
    if (name) cache.byName.set(name, dryClient);
    return dryClient;
  }

  const contactPayload = {
    organization_id: organizationId,
    contact_type: "client",
    full_name: name ?? "Cliente",
    email,
    phone: txt(row.phone),
    notes: txt(row.comments),
  };
  const { data: createdContact, error: contactError } = await db
    .schema("crm")
    .from("contacts")
    .insert(contactPayload)
    .select(CONTACT_SELECT)
    .single();
  if (contactError) throw new Error(`db_contact_insert_error:${contactError.message}`);
  stats.contacts_created += 1;

  const profileData = {
    intake_date: row.intake_date ?? null,
    entry_channel: row.entry_channel ?? "other",
    agency_name: row.agency_name ?? null,
    agent_name: row.agent_name ?? null,
    nationality: row.nationality ?? null,
    budget_amount: null,
    typology: null,
    preferred_location: null,
    comments: row.comments ?? null,
    report_notes: null,
    visit_notes: null,
    reservation_notes: row.reservation_notes ?? null,
    discarded_by: null,
    other_notes: null,
    tax_id_type: row.tax_id_type ?? null,
    person_kind: row.person_kind ?? null,
  };

  const clientPayload = {
    organization_id: organizationId,
    contact_id: createdContact.id,
    client_code: randomCode("CLI"),
    client_type: row.client_type === "company" ? "company" : "individual",
    client_status: "active",
    billing_name: name ?? "Cliente",
    tax_id: tax,
    billing_address: {},
    profile_data: profileData,
  };
  const { data: createdClient, error: clientError } = await db
    .schema("crm")
    .from("clients")
    .insert(clientPayload)
    .select(CLIENT_SELECT)
    .single();
  if (clientError) throw new Error(`db_client_insert_error:${clientError.message}`);
  stats.clients_created += 1;

  if (tax) cache.byTax.set(tax, createdClient);
  if (email) cache.byEmail.set(email, createdClient);
  if (name) cache.byName.set(name, createdClient);
  return createdClient;
};

const loadProjects = async (db, organizationId) => {
  const { data, error } = await db
    .schema("crm")
    .from("properties")
    .select("id, organization_id, legacy_code, record_type")
    .eq("organization_id", organizationId)
    .eq("record_type", "project");
  if (error) throw new Error(`db_projects_read_error:${error.message}`);
  const byId = new Map();
  const byLegacy = new Map();
  (data ?? []).forEach((row) => {
    if (txt(row.id)) byId.set(String(row.id), row);
    if (txt(row.legacy_code)) byLegacy.set(String(row.legacy_code).toLowerCase(), row);
  });
  return { byId, byLegacy };
};

const ensureReservationTableReady = async (db) => {
  const { error } = await db.schema("crm").from("client_project_reservations").select("id").limit(1);
  if (!error) return;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  if (code === "PGRST205" || message.includes("client_project_reservations")) {
    throw new Error("missing_table_client_project_reservations_apply_migration_008");
  }
  throw new Error(`db_reservation_table_probe_error:${error.message}`);
};

const resolveProject = (projects, source) => {
  const byId = txt(source.project_id);
  const byLegacy = txt(source.project_legacy_code);
  const projectById = byId ? projects.byId.get(byId) ?? null : null;
  const projectByLegacy = byLegacy ? projects.byLegacy.get(byLegacy.toLowerCase()) ?? null : null;
  if (!projectById && !projectByLegacy) throw new Error(`project_not_found_for_source:${source.file}`);
  if (projectById && projectByLegacy && String(projectById.id) !== String(projectByLegacy.id)) {
    throw new Error(`project_reference_mismatch:${source.file}`);
  }
  return projectById ?? projectByLegacy;
};

const ensureReservation = async (ctx) => {
  const {
    db,
    organizationId,
    projectId,
    sourceFile,
    row,
    clientId,
    dryRun,
    updateExisting,
    stats,
  } = ctx;
  const { data: existingRows, error: existingError } = await db
    .schema("crm")
    .from("client_project_reservations")
    .select(RESERVATION_SELECT)
    .eq("organization_id", organizationId)
    .eq("project_property_id", projectId)
    .eq("source_file", sourceFile)
    .eq("source_row_number", row.source_row_number)
    .limit(1);
  if (existingError) throw new Error(`db_reservation_lookup_error:${existingError.message}`);
  const existing = Array.isArray(existingRows) && existingRows.length ? existingRows[0] : null;
  if (existing && !updateExisting) {
    stats.reservations_skipped_duplicate += 1;
    return;
  }

  const payload = {
    organization_id: organizationId,
    client_id: clientId,
    project_property_id: projectId,
    source_file: sourceFile,
    source_row_number: row.source_row_number,
    ...row.reservation,
    metadata: row.metadata,
  };

  if (dryRun) {
    if (existing) stats.reservations_updated += 1;
    else stats.reservations_inserted += 1;
    return;
  }

  if (existing) {
    const { error } = await db
      .schema("crm")
      .from("client_project_reservations")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw new Error(`db_reservation_update_error:${error.message}`);
    stats.reservations_updated += 1;
    return;
  }

  const { error } = await db.schema("crm").from("client_project_reservations").insert(payload);
  if (error) throw new Error(`db_reservation_insert_error:${error.message}`);
  stats.reservations_inserted += 1;
};

const main = async () => {
  const jobFile = arg("job-file");
  if (!jobFile) throw new Error("job_file_required");
  const jobPath = path.isAbsolute(jobFile) ? jobFile : path.join(ROOT, jobFile);
  if (!fs.existsSync(jobPath)) throw new Error(`job_file_not_found:${jobPath}`);
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));

  const organizationId =
    txt(arg("organization-id")) ??
    txt(env("CRM_ORGANIZATION_ID")) ??
    txt(env("PUBLIC_CRM_ORGANIZATION_ID")) ??
    txt(job.organization_id);
  if (!organizationId || !UUID_RX.test(organizationId)) throw new Error("organization_id_invalid");
  const sources = Array.isArray(job.sources) ? job.sources : [];
  if (!sources.length) throw new Error("sources_required");

  const dryRun = flag("dry-run");
  const updateExisting = flag("update-existing");
  const continueOnError = flag("continue-on-error");
  const limit = Number(arg("limit"));
  const rowLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;

  const url = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? env("SUPABASE_ANON_KEY") ?? env("PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("supabase_env_missing");
  const db = createClient(url, key, { auth: { persistSession: false } });

  await ensureReservationTableReady(db);
  const projects = await loadProjects(db, organizationId);
  const stats = {
    dry_run: dryRun,
    update_existing: updateExisting,
    rows_processed: 0,
    rows_skipped: 0,
    clients_created: 0,
    clients_reused: 0,
    clients_updated: 0,
    contacts_created: 0,
    reservations_inserted: 0,
    reservations_updated: 0,
    reservations_skipped_duplicate: 0,
    errors: 0,
  };
  const errors = [];
  const cache = { byTax: new Map(), byEmail: new Map(), byName: new Map() };

  let processed = 0;
  const sourceReports = [];
  for (const sourceRaw of sources) {
    const source = sourceRaw ?? {};
    const parsed = parseSource(source);
    const project = resolveProject(projects, source);
    const report = {
      file: source.file,
      header_row: parsed.header_row,
      project_id: String(project.id),
      rows: parsed.rows.length,
      processed: 0,
      skipped: 0,
      errors: 0,
    };
    for (const row of parsed.rows) {
      if (rowLimit && processed >= rowLimit) break;
      try {
        const client = await ensureClient({
          db,
          organizationId,
          row,
          dryRun,
          updateExisting,
          stats,
          cache,
        });
        await ensureReservation({
          db,
          organizationId,
          projectId: String(project.id),
          sourceFile: parsed.source_file_name,
          row,
          clientId: client.id,
          dryRun,
          updateExisting,
          stats,
        });
        stats.rows_processed += 1;
        report.processed += 1;
        processed += 1;
      } catch (error) {
        stats.errors += 1;
        report.errors += 1;
        errors.push({
          file: source.file,
          row: row.source_row_number,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!continueOnError) throw error;
      }
    }
    sourceReports.push(report);
    if (rowLimit && processed >= rowLimit) break;
  }

  const out = {
    ok: true,
    generated_at: new Date().toISOString(),
    job_file: jobPath,
    organization_id: organizationId,
    stats,
    sources: sourceReports,
    errors,
  };

  const reportsDir = path.join(ROOT, "scripts", "client-import", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `client-reservations-import-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, report_path: reportPath, stats }, null, 2));
};

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
