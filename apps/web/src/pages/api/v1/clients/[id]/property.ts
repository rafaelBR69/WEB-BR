import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import { asBoolean, asNumber, asText } from "@shared/clients/domain";
import { mapPropertyRow } from "@shared/properties/domain";

type BuyerRole = "primary" | "co_buyer" | "legal_representative" | "other";

type UpdateClientPropertyBody = {
  organization_id?: string;
  property_id?: string | null;
  buyer_role?: BuyerRole;
  notes?: string | null;
};

type AssignmentRow = {
  id: string | null;
  organization_id: string | null;
  property_id: string | null;
  client_id: string | null;
  buyer_role: BuyerRole;
  civil_status: string | null;
  marital_regime: string | null;
  ownership_share: number | null;
  is_active: boolean;
  link_source: "manual" | "reservation_import" | "contract_import" | "script" | "other";
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
  property: Record<string, unknown> | null;
};

type LinkedProjectSource = "provider_link" | "reservation" | "assigned_property_parent";

type LinkedProjectRow = {
  project_id: string;
  sources: LinkedProjectSource[];
  project: Record<string, unknown> | null;
  reservation_status: string | null;
  reservation_date: string | null;
  provider_links_total: number;
  reservations_total: number;
};

type LinkedProjectAggregate = {
  sources: Set<LinkedProjectSource>;
  reservation_status: string | null;
  reservation_date: string | null;
  provider_links_total: number;
  reservations_total: number;
};

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROPERTY_CLIENT_LINK_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "property_id",
  "client_id",
  "buyer_role",
  "civil_status",
  "marital_regime",
  "ownership_share",
  "is_active",
  "link_source",
  "notes",
  "metadata",
  "created_at",
  "updated_at",
].join(", ");

const PROPERTY_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "website_id",
  "legacy_code",
  "translations",
  "record_type",
  "project_business_type",
  "commercialization_notes",
  "parent_property_id",
  "operation_type",
  "status",
  "is_featured",
  "is_public",
  "price_sale",
  "price_rent_monthly",
  "price_currency",
  "property_data",
  "location",
  "media",
  "created_at",
  "updated_at",
].join(", ");

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getClientIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const normalizeBuyerRole = (value: unknown): BuyerRole => {
  if (value === "primary" || value === "co_buyer" || value === "legal_representative" || value === "other") {
    return value;
  }
  return "primary";
};

const normalizeLinkSource = (
  value: unknown
): "manual" | "reservation_import" | "contract_import" | "script" | "other" => {
  if (
    value === "manual" ||
    value === "reservation_import" ||
    value === "contract_import" ||
    value === "script" ||
    value === "other"
  ) {
    return value;
  }
  return "manual";
};

const isMissingTableError = (error: unknown, table: string): boolean => {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const code = String(row.code ?? "");
  const message = String(row.message ?? "").toLowerCase();
  const details = String(row.details ?? "").toLowerCase();
  const tableName = table.toLowerCase();
  return (
    code === "PGRST205" ||
    (message.includes(tableName) && message.includes("could not find")) ||
    details.includes(tableName)
  );
};

const readScopedClient = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  clientId: string,
  organizationId: string | null
) => {
  let query = client
    .schema("crm")
    .from("clients")
    .select("id, organization_id, client_status")
    .eq("id", clientId)
    .maybeSingle();
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  return { data: (data as Record<string, unknown> | null) ?? null, error };
};

const mapAssignmentRow = (
  row: Record<string, unknown>,
  propertyMap: Map<string, Record<string, unknown>>
): AssignmentRow => {
  const propertyId = asText(row.property_id);
  return {
    id: asText(row.id),
    organization_id: asText(row.organization_id),
    property_id: propertyId,
    client_id: asText(row.client_id),
    buyer_role: normalizeBuyerRole(row.buyer_role),
    civil_status: asText(row.civil_status),
    marital_regime: asText(row.marital_regime),
    ownership_share: asNumber(row.ownership_share),
    is_active: asBoolean(row.is_active) !== false,
    link_source: normalizeLinkSource(row.link_source),
    notes: asText(row.notes),
    metadata: asObject(row.metadata),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
    property: propertyId ? propertyMap.get(propertyId) ?? null : null,
  };
};

const readClientAssignments = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  clientId: string
) => {
  const { data: linkRows, error: linksError } = await client
    .schema("crm")
    .from("property_client_links")
    .select(PROPERTY_CLIENT_LINK_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (linksError) {
    if (isMissingTableError(linksError, "property_client_links")) {
      return { assignments: [] as AssignmentRow[], active: null as AssignmentRow | null, missingTable: true };
    }
    throw new Error(`db_property_client_links_read_error:${linksError.message}`);
  }

  const rows = Array.isArray(linkRows) ? (linkRows as Array<Record<string, unknown>>) : [];
  const propertyIds = Array.from(
    new Set(rows.map((row) => asText(row.property_id)).filter((value): value is string => Boolean(value)))
  );

  const propertyMap = new Map<string, Record<string, unknown>>();
  if (propertyIds.length) {
    const { data: propertyRows, error: propertyError } = await client
      .schema("crm")
      .from("properties")
      .select(PROPERTY_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .in("id", propertyIds);

    if (propertyError) {
      throw new Error(`db_properties_read_error:${propertyError.message}`);
    }

    (propertyRows ?? []).forEach((row) => {
      const mapped = mapPropertyRow(row as Record<string, unknown>);
      const id = asText(mapped.id);
      if (!id) return;
      propertyMap.set(id, mapped);
    });
  }

  const assignments = rows.map((row) => mapAssignmentRow(row, propertyMap));
  const active = assignments.find((entry) => entry.is_active === true) ?? null;
  return { assignments, active, missingTable: false };
};

const toDateSortValue = (value: string | null) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getLinkedProjectAggregate = (
  acc: Map<string, LinkedProjectAggregate>,
  projectId: string
): LinkedProjectAggregate => {
  const current = acc.get(projectId);
  if (current) return current;
  const next: LinkedProjectAggregate = {
    sources: new Set<LinkedProjectSource>(),
    reservation_status: null,
    reservation_date: null,
    provider_links_total: 0,
    reservations_total: 0,
  };
  acc.set(projectId, next);
  return next;
};

const readClientLinkedProjects = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  clientId: string,
  assignments: AssignmentRow[]
): Promise<LinkedProjectRow[]> => {
  const byProjectId = new Map<string, LinkedProjectAggregate>();

  assignments.forEach((assignment) => {
    const mappedProperty = assignment.property;
    if (!mappedProperty) return;
    const recordType = asText(mappedProperty.record_type);
    const propertyId = asText(mappedProperty.id);

    if (recordType === "project" && propertyId) {
      const aggregate = getLinkedProjectAggregate(byProjectId, propertyId);
      aggregate.sources.add("assigned_property_parent");
      return;
    }

    if (recordType === "unit") {
      const parentId = asText(mappedProperty.parent_property_id);
      if (!parentId) return;
      const aggregate = getLinkedProjectAggregate(byProjectId, parentId);
      aggregate.sources.add("assigned_property_parent");
    }
  });

  const { data: providerRows, error: providerError } = await client
    .schema("crm")
    .from("providers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId);

  if (providerError && !isMissingTableError(providerError, "providers")) {
    throw new Error(`db_providers_read_error:${providerError.message}`);
  }

  const providerIds = Array.from(
    new Set(
      (providerRows ?? [])
        .map((row) => asText((row as Record<string, unknown>).id))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (providerIds.length) {
    const { data: providerLinkRows, error: providerLinkError } = await client
      .schema("crm")
      .from("project_providers")
      .select("project_property_id")
      .eq("organization_id", organizationId)
      .in("provider_id", providerIds);

    if (providerLinkError && !isMissingTableError(providerLinkError, "project_providers")) {
      throw new Error(`db_project_providers_read_error:${providerLinkError.message}`);
    }

    (providerLinkRows ?? []).forEach((row) => {
      const projectId = asText((row as Record<string, unknown>).project_property_id);
      if (!projectId) return;
      const aggregate = getLinkedProjectAggregate(byProjectId, projectId);
      aggregate.sources.add("provider_link");
      aggregate.provider_links_total += 1;
    });
  }

  const { data: reservationRows, error: reservationError } = await client
    .schema("crm")
    .from("client_project_reservations")
    .select("project_property_id, reservation_status, reservation_date, created_at")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId);

  if (reservationError && !isMissingTableError(reservationError, "client_project_reservations")) {
    throw new Error(`db_client_project_reservations_read_error:${reservationError.message}`);
  }

  (reservationRows ?? []).forEach((row) => {
    const record = row as Record<string, unknown>;
    const projectId = asText(record.project_property_id);
    if (!projectId) return;
    const aggregate = getLinkedProjectAggregate(byProjectId, projectId);
    aggregate.sources.add("reservation");
    aggregate.reservations_total += 1;

    const reservationDate = asText(record.reservation_date) ?? asText(record.created_at);
    const currentDate = aggregate.reservation_date;
    if (toDateSortValue(reservationDate) >= toDateSortValue(currentDate)) {
      aggregate.reservation_date = reservationDate;
      aggregate.reservation_status = asText(record.reservation_status);
    }
  });

  const projectIds = Array.from(byProjectId.keys());
  if (!projectIds.length) return [];

  const { data: projectRows, error: projectError } = await client
    .schema("crm")
    .from("properties")
    .select(PROPERTY_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("record_type", "project")
    .in("id", projectIds);

  if (projectError) {
    throw new Error(`db_project_properties_read_error:${projectError.message}`);
  }

  const projectsById = new Map<string, Record<string, unknown>>();
  (projectRows ?? []).forEach((row) => {
    const mapped = mapPropertyRow(row as Record<string, unknown>);
    const id = asText(mapped.id);
    if (!id) return;
    projectsById.set(id, mapped);
  });

  return projectIds
    .map((projectId) => {
      const aggregate = byProjectId.get(projectId);
      if (!aggregate) return null;
      return {
        project_id: projectId,
        sources: Array.from(aggregate.sources.values()),
        project: projectsById.get(projectId) ?? null,
        reservation_status: aggregate.reservation_status,
        reservation_date: aggregate.reservation_date,
        provider_links_total: aggregate.provider_links_total,
        reservations_total: aggregate.reservations_total,
      } as LinkedProjectRow;
    })
    .filter((value): value is LinkedProjectRow => Boolean(value))
    .sort((a, b) => {
      const aName =
        asText(a.project?.display_name) ??
        asText(a.project?.project_name) ??
        asText(a.project?.legacy_code) ??
        a.project_id;
      const bName =
        asText(b.project?.display_name) ??
        asText(b.project?.project_name) ??
        asText(b.project?.legacy_code) ??
        b.project_id;
      return aName.localeCompare(bName, "es");
    });
};

const responseFromAssignments = (
  assignments: AssignmentRow[],
  active: AssignmentRow | null,
  linkedProjects: LinkedProjectRow[]
) => ({
  assigned_property_id: active?.property_id ?? null,
  assigned_buyer_role: active?.buyer_role ?? null,
  assigned_notes: active?.notes ?? null,
  assigned_link_id: active?.id ?? null,
  assigned_property: active?.property ?? null,
  assignments,
  linked_projects: linkedProjects,
});

export const GET: APIRoute = async ({ params, url }) => {
  const clientId = getClientIdFromParams(params);
  if (!clientId) return jsonResponse({ ok: false, error: "client_id_required" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: responseFromAssignments([], null, []),
      meta: {
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const requestedOrganizationId = asText(url.searchParams.get("organization_id"));
  const clientRead = await readScopedClient(client, clientId, requestedOrganizationId);
  if (clientRead.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_client_read_error",
        details: clientRead.error.message,
      },
      { status: 500 }
    );
  }
  if (!clientRead.data) return jsonResponse({ ok: false, error: "client_not_found" }, { status: 404 });

  const scopedOrganizationId = requestedOrganizationId ?? asText(clientRead.data.organization_id);
  if (!scopedOrganizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  try {
    const assignmentRead = await readClientAssignments(client, scopedOrganizationId, clientId);
    if (assignmentRead.missingTable) {
      return jsonResponse(
        {
          ok: false,
          error: "db_table_missing_property_client_links",
          details: "Aplica supabase/sql/009_property_client_links.sql y reintenta.",
        },
        { status: 500 }
      );
    }
    const linkedProjects = await readClientLinkedProjects(
      client,
      scopedOrganizationId,
      clientId,
      assignmentRead.assignments
    );

    return jsonResponse({
      ok: true,
      data: responseFromAssignments(assignmentRead.assignments, assignmentRead.active, linkedProjects),
      meta: {
        storage: "supabase.crm.property_client_links",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_property_assignment_read_error",
        details: error instanceof Error ? error.message : "unknown_property_assignment_read_error",
      },
      { status: 500 }
    );
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const clientId = getClientIdFromParams(params);
  if (!clientId) return jsonResponse({ ok: false, error: "client_id_required" }, { status: 400 });

  const body = await parseJsonBody<UpdateClientPropertyBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  if (!hasOwn(body, "property_id")) {
    return jsonResponse(
      {
        ok: false,
        error: "property_id_required_use_null_to_clear",
      },
      { status: 422 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: false,
        error: "mock_property_assignment_not_implemented",
      },
      { status: 501 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const requestedOrganizationId = asText(body.organization_id);
  const clientRead = await readScopedClient(client, clientId, requestedOrganizationId);
  if (clientRead.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_client_read_error",
        details: clientRead.error.message,
      },
      { status: 500 }
    );
  }
  if (!clientRead.data) return jsonResponse({ ok: false, error: "client_not_found" }, { status: 404 });

  const scopedOrganizationId = requestedOrganizationId ?? asText(clientRead.data.organization_id);
  if (!scopedOrganizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  const propertyId = asText(body.property_id);

  const deactivate = await client
    .schema("crm")
    .from("property_client_links")
    .update({ is_active: false })
    .eq("organization_id", scopedOrganizationId)
    .eq("client_id", clientId)
    .eq("is_active", true);

  if (deactivate.error) {
    if (isMissingTableError(deactivate.error, "property_client_links")) {
      return jsonResponse(
        {
          ok: false,
          error: "db_table_missing_property_client_links",
          details: "Aplica supabase/sql/009_property_client_links.sql y reintenta.",
        },
        { status: 500 }
      );
    }

    return jsonResponse(
      {
        ok: false,
        error: "db_property_assignment_update_error",
        details: deactivate.error.message,
      },
      { status: 500 }
    );
  }

  if (propertyId) {
    if (!UUID_RX.test(propertyId)) {
      return jsonResponse({ ok: false, error: "invalid_property_id" }, { status: 422 });
    }

    const propertyRead = await client
      .schema("crm")
      .from("properties")
      .select("id, organization_id, record_type")
      .eq("id", propertyId)
      .eq("organization_id", scopedOrganizationId)
      .maybeSingle();

    if (propertyRead.error) {
      return jsonResponse(
        {
          ok: false,
          error: "db_property_read_error",
          details: propertyRead.error.message,
        },
        { status: 500 }
      );
    }
    if (!propertyRead.data) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

    if (String((propertyRead.data as Record<string, unknown>).record_type) === "project") {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_property_record_type",
          details: "Solo puedes asignar viviendas unit/single.",
        },
        { status: 422 }
      );
    }

    const assignmentPayload = {
      organization_id: scopedOrganizationId,
      property_id: propertyId,
      client_id: clientId,
      buyer_role: normalizeBuyerRole(body.buyer_role),
      is_active: true,
      link_source: "manual" as const,
      notes: asText(body.notes),
    };

    const upsert = await client
      .schema("crm")
      .from("property_client_links")
      .upsert(assignmentPayload, {
        onConflict: "organization_id,property_id,client_id",
      });

    if (upsert.error) {
      if (isMissingTableError(upsert.error, "property_client_links")) {
        return jsonResponse(
          {
            ok: false,
            error: "db_table_missing_property_client_links",
            details: "Aplica supabase/sql/009_property_client_links.sql y reintenta.",
          },
          { status: 500 }
        );
      }

      const errorText = String(upsert.error.message ?? "db_property_assignment_write_error");
      const isValidationError =
        errorText.includes("Only 2 active buyers") ||
        errorText.includes("Only 1 active primary buyer") ||
        errorText.includes("Organization mismatch") ||
        errorText.includes("record_type unit/single");

      return jsonResponse(
        {
          ok: false,
          error: isValidationError ? "invalid_property_assignment" : "db_property_assignment_write_error",
          details: errorText,
        },
        { status: isValidationError ? 422 : 500 }
      );
    }
  }

  const currentClientStatus = asText(clientRead.data.client_status);
  const nextClientStatus =
    propertyId && currentClientStatus === "inactive"
      ? "active"
      : !propertyId && currentClientStatus === "active"
        ? "inactive"
        : null;

  if (nextClientStatus) {
    const statusUpdate = await client
      .schema("crm")
      .from("clients")
      .update({ client_status: nextClientStatus })
      .eq("organization_id", scopedOrganizationId)
      .eq("id", clientId);

    if (statusUpdate.error) {
      return jsonResponse(
        {
          ok: false,
          error: "db_client_status_sync_error",
          details: statusUpdate.error.message,
        },
        { status: 500 }
      );
    }
  }

  try {
    const assignmentRead = await readClientAssignments(client, scopedOrganizationId, clientId);
    if (assignmentRead.missingTable) {
      return jsonResponse(
        {
          ok: false,
          error: "db_table_missing_property_client_links",
          details: "Aplica supabase/sql/009_property_client_links.sql y reintenta.",
        },
        { status: 500 }
      );
    }
    const linkedProjects = await readClientLinkedProjects(
      client,
      scopedOrganizationId,
      clientId,
      assignmentRead.assignments
    );

    return jsonResponse({
      ok: true,
      data: responseFromAssignments(assignmentRead.assignments, assignmentRead.active, linkedProjects),
      meta: {
        storage: "supabase.crm.property_client_links",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_property_assignment_read_error",
        details: error instanceof Error ? error.message : "unknown_property_assignment_read_error",
      },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
