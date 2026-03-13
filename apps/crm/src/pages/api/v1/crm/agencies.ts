import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { getSupabaseServerClient } from "@shared/supabase/server";
import {
  CLIENT_CONTACT_SELECT_COLUMNS,
  CLIENT_SELECT_COLUMNS,
  CLIENT_SELECT_COLUMNS_LEGACY,
  isMissingProfileDataColumnError,
  mapClientRow,
} from "@shared/clients/domain";
import { readAgencyAttributedSummary } from "@shared/agencies/analytics";
import { asBoolean, asText, asUuid, toPositiveInt } from "@shared/portal/domain";
import { createAgencyBundle, type AgencyCreateInput } from "@shared/agencies/crud";

const AGENCY_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "client_id",
  "agency_code",
  "agency_status",
  "agency_scope",
  "parent_agency_id",
  "is_referral_source",
  "notes",
  "created_at",
  "updated_at",
].join(", ");

const TERMINAL_LEAD_STATUSES = new Set(["converted", "won", "lost", "discarded", "junk"]);
const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 120;

const chunkValues = <T,>(values: T[], size = ID_CHUNK_SIZE) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const fetchAllAgencyRows = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string
) => {
  const rows: Array<Record<string, unknown>> = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .schema("crm")
      .from("agencies")
      .select(AGENCY_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) throw new Error(`db_agencies_read_error:${error.message}`);
    const pageRows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
};

const fetchAllOrgRows = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  table: string,
  select: string,
  organizationId: string
) => {
  const rows: Array<Record<string, unknown>> = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .schema("crm")
      .from(table)
      .select(select)
      .eq("organization_id", organizationId)
      .range(from, to);

    if (error) throw new Error(`db_${table}_read_error:${error.message}`);
    const pageRows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
};

const readClientRows = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  clientIds: string[]
) => {
  if (!clientIds.length) return [] as Array<Record<string, unknown>>;

  const rows: Array<Record<string, unknown>> = [];

  for (const clientIdChunk of chunkValues(clientIds)) {
    let { data, error } = await client
      .schema("crm")
      .from("clients")
      .select(CLIENT_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .in("id", clientIdChunk);

    if (error && isMissingProfileDataColumnError(error)) {
      const legacyAttempt = await client
        .schema("crm")
        .from("clients")
        .select(CLIENT_SELECT_COLUMNS_LEGACY)
        .eq("organization_id", organizationId)
        .in("id", clientIdChunk);
      data = legacyAttempt.data;
      error = legacyAttempt.error;
    }

    if (error) throw new Error(`db_agency_clients_read_error:${error.message}`);
    rows.push(...(Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []));
  }

  return rows;
};

export const GET: APIRoute = async ({ url, cookies }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);
  const agencyStatus = asText(url.searchParams.get("agency_status"));
  const agencyScope = asText(url.searchParams.get("agency_scope"));
  const clientStatus = asText(url.searchParams.get("client_status"));
  const referralSourceFilter = asBoolean(url.searchParams.get("is_referral_source"));

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.clients.read"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const attributedSummary = readAgencyAttributedSummary();
    const attributedByAgencyId = new Map(
      (attributedSummary?.by_agency ?? [])
        .map((row) => [asUuid(row.agency_id), row] as const)
        .filter((entry): entry is [string, NonNullable<typeof attributedSummary>["by_agency"][number]] => Boolean(entry[0]))
    );
    const agencyRows = await fetchAllAgencyRows(client, organizationId);
    const clientIds = Array.from(
      new Set(agencyRows.map((row) => asUuid(row.client_id)).filter((value): value is string => Boolean(value)))
    );

    const clientRows = await readClientRows(client, organizationId, clientIds);
    const clientsById = new Map<string, Record<string, unknown>>();
    clientRows.forEach((row) => {
      const clientId = asUuid(row.id);
      if (!clientId) return;
      clientsById.set(clientId, row);
    });

    const contactIds = Array.from(
      new Set(
        clientRows.map((row) => asUuid(row.contact_id)).filter((value): value is string => Boolean(value))
      )
    );

    const contactsById = new Map<string, Record<string, unknown>>();
    if (contactIds.length) {
      for (const contactIdChunk of chunkValues(contactIds)) {
        const { data: contactsRaw, error: contactsError } = await client
          .schema("crm")
          .from("contacts")
          .select(CLIENT_CONTACT_SELECT_COLUMNS)
          .eq("organization_id", organizationId)
          .in("id", contactIdChunk);

        if (contactsError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_agency_contacts_read_error",
              details: contactsError.message,
            },
            { status: 500 }
          );
        }

        (contactsRaw ?? []).forEach((row) => {
          const contactId = asUuid((row as Record<string, unknown>).id);
          if (!contactId) return;
          contactsById.set(contactId, row as Record<string, unknown>);
        });
      }
    }

    const agencyIds = Array.from(
      new Set(agencyRows.map((row) => asUuid(row.id)).filter((value): value is string => Boolean(value)))
    );

    const leadStatsByAgencyId = new Map<
      string,
      { total: number; open: number; converted: number; won: number }
    >();
    if (agencyIds.length) {
      for (const agencyIdChunk of chunkValues(agencyIds)) {
        const { data: leadsRaw, error: leadsError } = await client
          .schema("crm")
          .from("leads")
          .select("id, agency_id, status, converted_at")
          .eq("organization_id", organizationId)
          .in("agency_id", agencyIdChunk);

        if (leadsError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_agency_leads_read_error",
              details: leadsError.message,
            },
            { status: 500 }
          );
        }

        (leadsRaw ?? []).forEach((row) => {
          const record = row as Record<string, unknown>;
          const agencyId = asUuid(record.agency_id);
          if (!agencyId) return;
          const status = asText(record.status) ?? "new";
          const current = leadStatsByAgencyId.get(agencyId) ?? {
            total: 0,
            open: 0,
            converted: 0,
            won: 0,
          };
          current.total += 1;
          if (!TERMINAL_LEAD_STATUSES.has(status)) current.open += 1;
          if (status === "converted" || asText(record.converted_at)) current.converted += 1;
          if (status === "won") current.won += 1;
          leadStatsByAgencyId.set(agencyId, current);
        });
      }
    }

    const agencyContactsStatsByAgencyId = new Map<string, { total: number; primary: number }>();
    if (agencyIds.length) {
      for (const agencyIdChunk of chunkValues(agencyIds)) {
        const { data: agencyContactsRaw, error: agencyContactsError } = await client
          .schema("crm")
          .from("agency_contacts")
          .select("agency_id, relation_status, is_primary")
          .eq("organization_id", organizationId)
          .in("agency_id", agencyIdChunk);

        if (agencyContactsError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_agency_contact_links_read_error",
              details: agencyContactsError.message,
            },
            { status: 500 }
          );
        }

        (agencyContactsRaw ?? []).forEach((row) => {
          const record = row as Record<string, unknown>;
          const agencyId = asUuid(record.agency_id);
          const relationStatus = asText(record.relation_status) ?? "active";
          if (!agencyId || relationStatus !== "active") return;
          const current = agencyContactsStatsByAgencyId.get(agencyId) ?? { total: 0, primary: 0 };
          current.total += 1;
          if (record.is_primary === true) current.primary += 1;
          agencyContactsStatsByAgencyId.set(agencyId, current);
        });
      }
    }

    const linkedClientsByAgencyId = new Map<string, number>();
    const linkedReservedClientsByAgencyId = new Map<string, number>();
    const orgClientRows = await fetchAllOrgRows(
      client,
      "clients",
      "id, organization_id, profile_data",
      organizationId
    );
    const reservationRows = await fetchAllOrgRows(
      client,
      "client_project_reservations",
      "id, organization_id, client_id",
      organizationId
    );
    const reservedClientIds = new Set(
      reservationRows.map((row) => asUuid(row.client_id)).filter((value): value is string => Boolean(value))
    );

    orgClientRows.forEach((row) => {
      const profileData =
        row.profile_data && typeof row.profile_data === "object"
          ? (row.profile_data as Record<string, unknown>)
          : {};
      const agencyId = asUuid(profileData.linked_agency_id);
      const clientId = asUuid(row.id);
      if (!agencyId || !clientId) return;
      linkedClientsByAgencyId.set(agencyId, (linkedClientsByAgencyId.get(agencyId) ?? 0) + 1);
      if (reservedClientIds.has(clientId)) {
        linkedReservedClientsByAgencyId.set(agencyId, (linkedReservedClientsByAgencyId.get(agencyId) ?? 0) + 1);
      }
    });

    const rows = agencyRows
      .map((agencyRow) => {
        const clientId = asUuid(agencyRow.client_id);
        if (!clientId) return null;

        const clientRow = clientsById.get(clientId) ?? null;
        if (!clientRow) return null;

        const contactId = asUuid(clientRow.contact_id);
        const contactRow = contactId ? contactsById.get(contactId) ?? null : null;
        const baseRow = mapClientRow(clientRow, contactRow, { agency: agencyRow });
        const agencyId = asUuid(agencyRow.id);
        const leadStats = agencyId ? leadStatsByAgencyId.get(agencyId) : null;
        const contactStats = agencyId ? agencyContactsStatsByAgencyId.get(agencyId) : null;
        const attributed = agencyId ? attributedByAgencyId.get(agencyId) ?? null : null;
        const agencyDisplayName =
          asText(clientRow.billing_name) ??
          asText(baseRow.agency_name) ??
          asText(baseRow.full_name) ??
          asText(baseRow.agent_name) ??
          asText(baseRow.client_code) ??
          asText(agencyRow.agency_code) ??
          "Agencia";

        const searchBlob = [
          agencyDisplayName,
          baseRow.full_name,
          baseRow.email,
          baseRow.phone,
          baseRow.client_code,
          baseRow.agency_code,
          baseRow.agency_notes,
          baseRow.comments,
          baseRow.agent_name,
          baseRow.tax_id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return {
          ...baseRow,
          full_name: agencyDisplayName,
          id: agencyId,
          agency_id: agencyId,
          parent_agency_id: asUuid(agencyRow.parent_agency_id),
          leads_total: leadStats?.total ?? 0,
          leads_open_total: leadStats?.open ?? 0,
          leads_converted_total: leadStats?.converted ?? 0,
          leads_won_total: leadStats?.won ?? 0,
          attributed_records_total: Number(attributed?.attributed_records_total ?? 0) || 0,
          attributed_records_with_identity_total: Number(attributed?.records_with_identity_total ?? 0) || 0,
          attributed_records_without_identity_total: Number(attributed?.records_without_identity_total ?? 0) || 0,
          attributed_records_customer_total: Number(attributed?.customer_total ?? 0) || 0,
          attributed_records_discarded_total: Number(attributed?.discarded_total ?? 0) || 0,
          linked_contacts_total: contactStats?.total ?? 0,
          linked_primary_contacts_total: contactStats?.primary ?? 0,
          linked_clients_total: agencyId ? linkedClientsByAgencyId.get(agencyId) ?? 0 : 0,
          linked_reserved_clients_total: agencyId ? linkedReservedClientsByAgencyId.get(agencyId) ?? 0 : 0,
          search_blob: searchBlob,
        };
      })
      .filter((value): value is Record<string, unknown> => Boolean(value));

    const filteredRows = rows.filter((row) => {
      if (agencyStatus && asText(row.agency_status) !== agencyStatus) return false;
      if (agencyScope && asText(row.agency_scope) !== agencyScope) return false;
      if (clientStatus && asText(row.client_status) !== clientStatus) return false;
      if (referralSourceFilter != null && row.agency_is_referral_source !== referralSourceFilter) return false;
      if (q && !String(row.search_blob ?? "").includes(q)) return false;
      return true;
    });

    const total = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(page, totalPages);
    const from = (safePage - 1) * perPage;
    const pageRows = filteredRows.slice(from, from + perPage).map((row) => {
      const { search_blob, ...rest } = row;
      return rest;
    });

    return jsonResponse({
      ok: true,
      data: pageRows,
      meta: {
        count: pageRows.length,
        total,
        page: safePage,
        per_page: perPage,
        total_pages: totalPages,
        organization_id: organizationId,
        options: {
          agency_statuses: ["active", "inactive", "discarded"],
          agency_scopes: ["buyer", "seller", "rental", "mixed"],
          client_statuses: ["active", "inactive", "discarded", "blacklisted"],
          referral_source_values: [true, false],
        },
        summary: {
          active: filteredRows.filter((row) => row.agency_status === "active").length,
          referral_sources: filteredRows.filter((row) => row.agency_is_referral_source === true).length,
          with_open_leads: filteredRows.filter((row) => Number(row.leads_open_total ?? 0) > 0).length,
          with_linked_clients: filteredRows.filter((row) => Number(row.linked_clients_total ?? 0) > 0).length,
          attributed_records_total: filteredRows.reduce(
            (sum, row) => sum + Number(row.attributed_records_total ?? 0),
            0
          ),
          attributed_records_with_identity_total: filteredRows.reduce(
            (sum, row) => sum + Number(row.attributed_records_with_identity_total ?? 0),
            0
          ),
          attributed_records_without_identity_total: filteredRows.reduce(
            (sum, row) => sum + Number(row.attributed_records_without_identity_total ?? 0),
            0
          ),
          linked_clients_total: filteredRows.reduce(
            (sum, row) => sum + Number(row.linked_clients_total ?? 0),
            0
          ),
        },
        storage: "supabase.crm.agencies + crm.clients + crm.contacts + crm.leads + crm.agency_contacts",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agencies_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<AgencyCreateInput & { organization_id?: string | null }>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationIdHint = asText(body.organization_id);
  const fullName = asText(body.full_name);
  if (!fullName) {
    return jsonResponse({ ok: false, error: "agency_name_required" }, { status: 422 });
  }

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.clients.write"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const created = await createAgencyBundle(client, organizationId, {
      full_name: fullName,
      email: asText(body.email),
      phone: asText(body.phone),
      agent_name: asText(body.agent_name),
      client_code: asText(body.client_code),
      client_status: asText(body.client_status),
      tax_id: asText(body.tax_id),
      agency_code: asText(body.agency_code),
      agency_status: asText(body.agency_status),
      agency_scope: asText(body.agency_scope),
      agency_is_referral_source:
        body.agency_is_referral_source == null ? null : Boolean(body.agency_is_referral_source),
      agency_notes: asText(body.agency_notes),
    });

    return jsonResponse(
      {
        ok: true,
        data: {
          agency_id: asUuid(created.agency.id),
          client_id: asUuid(created.client.id),
          contact_id: asUuid(created.contact.id),
          agency_code: asText(created.agency.agency_code),
          client_code: asText(created.client.client_code),
          full_name: asText(created.client.billing_name),
        },
        meta: {
          organization_id: organizationId,
          storage: "supabase.crm.contacts + crm.clients + crm.agencies",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const meta = error instanceof Error && "meta" in error ? (error as Error & { meta?: Record<string, unknown> }).meta : undefined;
    const isDuplicate = message === "agency_duplicate_identity";
    return jsonResponse(
      {
        ok: false,
        error: isDuplicate ? "agency_duplicate_identity" : "crm_agency_create_unhandled_error",
        details: message,
        ...(meta ? { meta } : {}),
      },
      { status: isDuplicate ? 409 : 500 }
    );
  }
};
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
