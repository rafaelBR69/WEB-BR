import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  CLIENT_CONTACT_SELECT_COLUMNS,
  CLIENT_SELECT_COLUMNS,
  CLIENT_SELECT_COLUMNS_LEGACY,
  isMissingProfileDataColumnError,
  mapClientRow,
} from "@/utils/crmClients";
import { mapPropertyRow } from "@/utils/crmProperties";

type BuyerRole = "primary" | "co_buyer" | "legal_representative" | "other";
type LinkSource = "manual" | "reservation_import" | "contract_import" | "script" | "other";
type ReservationStatus =
  | "pre_registered"
  | "reservation_sent"
  | "reserved"
  | "adhesion_paid"
  | "contract_signed"
  | "cancelled"
  | "discarded"
  | "other";

type UpsertPropertyClientLinkBody = {
  organization_id?: string;
  client_id?: string;
  buyer_role?: BuyerRole;
  civil_status?: string | null;
  marital_regime?: string | null;
  ownership_share?: number | null;
  is_active?: boolean;
  link_source?: LinkSource;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ClientMapResult = {
  byId: Map<string, Record<string, unknown>>;
  usedLegacyProfile: boolean;
};

type MatchScore = {
  score: number;
  reasons: string[];
  unitSpecific: boolean;
};

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

const RESERVATION_SELECT_COLUMNS = [
  "id",
  "client_id",
  "reservation_status",
  "reservation_state_text",
  "reservation_date",
  "drop_date",
  "unit_reference",
  "unit_portal",
  "unit_floor",
  "unit_letter",
  "buyer_civil_status",
  "source_file",
  "source_row_number",
  "created_at",
].join(", ");

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIVE_RESERVATION_STATUS = new Set<ReservationStatus>([
  "pre_registered",
  "reservation_sent",
  "reserved",
  "adhesion_paid",
  "contract_signed",
]);

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toPositiveInt = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
};

const normalizeToken = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  return normalized.length ? normalized : null;
};

const normalizeReservationStatus = (value: unknown): ReservationStatus => {
  if (
    value === "pre_registered" ||
    value === "reservation_sent" ||
    value === "reserved" ||
    value === "adhesion_paid" ||
    value === "contract_signed" ||
    value === "cancelled" ||
    value === "discarded" ||
    value === "other"
  ) {
    return value;
  }
  return "other";
};

const normalizeBuyerRole = (value: unknown): BuyerRole => {
  if (value === "primary" || value === "co_buyer" || value === "legal_representative" || value === "other") {
    return value;
  }
  return "primary";
};

const normalizeLinkSource = (value: unknown): LinkSource => {
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

const getPropertyIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const getDateSortValue = (value: unknown) => {
  const text = asText(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
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

const resolveFloorToken = (mappedProperty: Record<string, unknown>) => {
  const operational = asObject(mappedProperty.operational);
  const floorLabel = asText(operational.floor_label);
  if (floorLabel) return normalizeToken(floorLabel);
  const floorLevel = asNumber(operational.floor_level);
  if (floorLevel == null) return null;
  if (Number.isInteger(floorLevel)) return normalizeToken(String(floorLevel));
  return normalizeToken(String(floorLevel));
};

const scoreReservationMatch = (
  mappedProperty: Record<string, unknown>,
  reservationRow: Record<string, unknown>
): MatchScore => {
  const reasons: string[] = [];
  let score = 0;
  let unitSpecific = false;

  const recordType = asText(mappedProperty.record_type);
  if (recordType === "project") {
    score += 20;
    reasons.push("reserva de promocion");
  }

  const propertyCode = normalizeToken(mappedProperty.legacy_code);
  const reservationUnit = normalizeToken(reservationRow.unit_reference);
  if (propertyCode && reservationUnit) {
    if (propertyCode === reservationUnit) {
      score += 82;
      unitSpecific = true;
      reasons.push("coincidencia exacta de unidad");
    } else if (reservationUnit.includes(propertyCode) || propertyCode.includes(reservationUnit)) {
      score += 58;
      unitSpecific = true;
      reasons.push("coincidencia parcial de unidad");
    }
  }

  const operational = asObject(mappedProperty.operational);
  const propertyPortal = normalizeToken(operational.building_portal);
  const propertyFloor = resolveFloorToken(mappedProperty);
  const propertyDoor = normalizeToken(operational.building_door);

  const reservationPortal = normalizeToken(reservationRow.unit_portal);
  const reservationFloor = normalizeToken(reservationRow.unit_floor);
  const reservationDoor = normalizeToken(reservationRow.unit_letter);

  if (propertyPortal && reservationPortal && propertyPortal === reservationPortal) {
    score += 16;
    unitSpecific = true;
    reasons.push("portal coincide");
  }

  if (propertyFloor && reservationFloor && propertyFloor === reservationFloor) {
    score += 16;
    unitSpecific = true;
    reasons.push("planta coincide");
  }

  if (propertyDoor && reservationDoor && propertyDoor === reservationDoor) {
    score += 16;
    unitSpecific = true;
    reasons.push("puerta coincide");
  }

  const reservationStatus = normalizeReservationStatus(reservationRow.reservation_status);
  if (ACTIVE_RESERVATION_STATUS.has(reservationStatus)) {
    score += 6;
    reasons.push("estado activo");
  }

  return { score, reasons, unitSpecific };
};

const confidenceFromScore = (score: number): "high" | "medium" | "low" => {
  if (score >= 82) return "high";
  if (score >= 56) return "medium";
  return "low";
};

const buildReservationCandidates = (
  mappedProperty: Record<string, unknown>,
  reservationRows: Array<Record<string, unknown>>,
  maxCandidates: number
) => {
  if (!Array.isArray(reservationRows) || !reservationRows.length) return [];

  const byClientId = new Map<string, Record<string, unknown>>();
  const recordType = asText(mappedProperty.record_type);

  reservationRows.forEach((row) => {
    const clientId = asText(row.client_id);
    if (!clientId) return;

    const match = scoreReservationMatch(mappedProperty, row);
    if (match.score <= 0) return;

    if ((recordType === "unit" || recordType === "single") && !match.unitSpecific) {
      return;
    }

    const rowSortValue = Math.max(
      getDateSortValue(row.reservation_date),
      getDateSortValue(row.created_at),
      getDateSortValue(row.drop_date)
    );

    const candidate = {
      client_id: clientId,
      reservation_id: asText(row.id),
      reservation_status: normalizeReservationStatus(row.reservation_status),
      reservation_state_text: asText(row.reservation_state_text),
      reservation_date: asText(row.reservation_date),
      drop_date: asText(row.drop_date),
      buyer_civil_status: asText(row.buyer_civil_status),
      unit_reference: asText(row.unit_reference),
      unit_portal: asText(row.unit_portal),
      unit_floor: asText(row.unit_floor),
      unit_letter: asText(row.unit_letter),
      source_file: asText(row.source_file),
      source_row_number: asNumber(row.source_row_number),
      match_score: match.score,
      match_confidence: confidenceFromScore(match.score),
      match_reasons: match.reasons,
      _sort_value: rowSortValue,
    };

    const current = byClientId.get(clientId);
    if (!current) {
      byClientId.set(clientId, candidate);
      return;
    }

    const currentScore = asNumber(current.match_score) ?? 0;
    const currentSort = asNumber((current as Record<string, unknown>)._sort_value) ?? 0;
    if (candidate.match_score > currentScore || (candidate.match_score === currentScore && rowSortValue > currentSort)) {
      byClientId.set(clientId, candidate);
    }
  });

  return Array.from(byClientId.values())
    .sort((a, b) => {
      const scoreDiff = (asNumber(b.match_score) ?? 0) - (asNumber(a.match_score) ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (asNumber((b as Record<string, unknown>)._sort_value) ?? 0) - (asNumber((a as Record<string, unknown>)._sort_value) ?? 0);
    })
    .slice(0, maxCandidates)
    .map((item) => {
      const { _sort_value: _dropSortValue, ...rest } = item as Record<string, unknown>;
      return rest;
    });
};

const mapPropertyClientLinkRow = (row: Record<string, unknown>) => ({
  id: asText(row.id),
  organization_id: asText(row.organization_id),
  property_id: asText(row.property_id),
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
});

const readClientRows = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  ids: string[],
  selectColumns: string
) => {
  const chunkSize = 150;
  const rows: Array<Record<string, unknown>> = [];

  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    let query = client.schema("crm").from("clients").select(selectColumns).in("id", chunk);
    query = query.eq("organization_id", organizationId);

    const { data, error } = await query;
    if (error) {
      return { rows: [], error };
    }
    (data ?? []).forEach((row) => rows.push(row as Record<string, unknown>));
  }

  return { rows, error: null };
};

const fetchClientsByIds = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  ids: string[]
): Promise<ClientMapResult> => {
  const uniqueIds = Array.from(new Set(ids.filter((value) => UUID_RX.test(value))));
  if (!uniqueIds.length) {
    return { byId: new Map<string, Record<string, unknown>>(), usedLegacyProfile: false };
  }

  let usedLegacyProfile = false;
  let clientRowsResult = await readClientRows(client, organizationId, uniqueIds, CLIENT_SELECT_COLUMNS);

  if (clientRowsResult.error && isMissingProfileDataColumnError(clientRowsResult.error)) {
    usedLegacyProfile = true;
    clientRowsResult = await readClientRows(client, organizationId, uniqueIds, CLIENT_SELECT_COLUMNS_LEGACY);
  }

  if (clientRowsResult.error) {
    throw new Error(`db_clients_read_error:${clientRowsResult.error.message}`);
  }

  const clientRows = clientRowsResult.rows;
  const contactIds = Array.from(
    new Set(clientRows.map((row) => asText(row.contact_id)).filter((value): value is string => Boolean(value)))
  );

  const contactMap = new Map<string, Record<string, unknown>>();
  if (contactIds.length) {
    const chunkSize = 200;
    for (let offset = 0; offset < contactIds.length; offset += chunkSize) {
      const chunk = contactIds.slice(offset, offset + chunkSize);
      const { data, error } = await client
        .schema("crm")
        .from("contacts")
        .select(CLIENT_CONTACT_SELECT_COLUMNS)
        .eq("organization_id", organizationId)
        .in("id", chunk);

      if (error) throw new Error(`db_contacts_read_error:${error.message}`);
      (data ?? []).forEach((row) => {
        const id = asText((row as Record<string, unknown>).id);
        if (!id) return;
        contactMap.set(id, row as Record<string, unknown>);
      });
    }
  }

  const byId = new Map<string, Record<string, unknown>>();
  clientRows.forEach((row) => {
    const id = asText(row.id);
    if (!id) return;
    const contactId = asText(row.contact_id);
    const contactRow = contactId ? contactMap.get(contactId) ?? null : null;
    byId.set(id, mapClientRow(row, contactRow, { isProviderForProject: false }));
  });

  return { byId, usedLegacyProfile };
};

const fetchProjectReservations = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  projectPropertyId: string
) => {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  let from = 0;
  let guard = 0;

  while (guard < 300) {
    guard += 1;
    const to = from + pageSize - 1;
    const { data, error } = await client
      .schema("crm")
      .from("client_project_reservations")
      .select(RESERVATION_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("project_property_id", projectPropertyId)
      .range(from, to);

    if (error) throw error;

    const chunk = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return rows;
};

const resolveScopeOrganizationId = (queryOrBodyOrgId: string | null, propertyRow: Record<string, unknown>) =>
  queryOrBodyOrgId ?? asText(propertyRow.organization_id);

const readProperty = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  propertyId: string,
  organizationId: string | null
) => {
  let query = client
    .schema("crm")
    .from("properties")
    .select(PROPERTY_SELECT_COLUMNS)
    .eq("id", propertyId)
    .maybeSingle();

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  return { data: (data as Record<string, unknown> | null) ?? null, error };
};

export const GET: APIRoute = async ({ params, url }) => {
  const propertyId = getPropertyIdFromParams(params);
  if (!propertyId) {
    return jsonResponse({ ok: false, error: "property_id_required" }, { status: 400 });
  }

  const requestedOrganizationId = asText(url.searchParams.get("organization_id"));
  const maxCandidates = toPositiveInt(url.searchParams.get("max_candidates"), 25, 1, 200);
  const includeInactive = asBoolean(url.searchParams.get("include_inactive")) === true;
  const includeReservationCandidates =
    asBoolean(url.searchParams.get("include_reservation_candidates")) === true;

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        property: {
          id: propertyId,
        },
        link_status: "not_linked",
        rules: {
          max_active_buyers: 2,
          max_active_primary_buyers: 1,
        },
        summary: {
          verified_links_total: 0,
          verified_active_links_total: 0,
          verified_active_buyers_total: 0,
          reservation_candidates_total: 0,
        },
        verified_links: [],
        reservation_candidates: [],
      },
      meta: {
        storage: "mock_in_memory",
        reservation_candidates_mode: includeReservationCandidates ? "enabled" : "disabled",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const propertyRead = await readProperty(client, propertyId, requestedOrganizationId);
  if (propertyRead.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_read_error",
        details: propertyRead.error.message,
      },
      { status: 500 }
    );
  }
  if (!propertyRead.data) {
    return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });
  }

  const scopedOrganizationId = resolveScopeOrganizationId(requestedOrganizationId, propertyRead.data);
  if (!scopedOrganizationId) {
    return jsonResponse(
      {
        ok: false,
        error: "organization_id_required",
      },
      { status: 422 }
    );
  }

  const mappedProperty = mapPropertyRow(propertyRead.data);

  let linkRows: Array<Record<string, unknown>> = [];
  let linksTableAvailable = true;
  let linksTableWarning: string | null = null;

  {
    let linkQuery = client
      .schema("crm")
      .from("property_client_links")
      .select(PROPERTY_CLIENT_LINK_SELECT_COLUMNS)
      .eq("organization_id", scopedOrganizationId)
      .eq("property_id", propertyId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: true });

    if (!includeInactive) {
      linkQuery = linkQuery.eq("is_active", true);
    }

    const { data, error } = await linkQuery;
    if (error) {
      if (isMissingTableError(error, "property_client_links")) {
        linksTableAvailable = false;
        linksTableWarning = "missing_table_property_client_links_apply_migration_009";
      } else {
        return jsonResponse(
          {
            ok: false,
            error: "db_property_client_links_read_error",
            details: error.message,
          },
          { status: 500 }
        );
      }
    } else {
      linkRows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    }
  }

  const projectPropertyId =
    mappedProperty.record_type === "project"
      ? asText(mappedProperty.id)
      : asText(mappedProperty.parent_property_id);

  let reservationRows: Array<Record<string, unknown>> = [];
  let reservationsTableAvailable = !includeReservationCandidates;
  let reservationsTableWarning: string | null = null;

  if (includeReservationCandidates && projectPropertyId) {
    try {
      reservationRows = await fetchProjectReservations(client, scopedOrganizationId, projectPropertyId);
      reservationsTableAvailable = true;
    } catch (error) {
      if (isMissingTableError(error, "client_project_reservations")) {
        reservationsTableAvailable = false;
        reservationsTableWarning = "missing_table_client_project_reservations_apply_migration_008";
      } else {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : "unknown_reservations_error";
        return jsonResponse(
          {
            ok: false,
            error: "db_project_reservations_read_error",
            details: message,
          },
          { status: 500 }
        );
      }
    }
  }

  const reservationCandidates = includeReservationCandidates
    ? buildReservationCandidates(mappedProperty, reservationRows, maxCandidates)
    : [];

  const clientIds = Array.from(
    new Set([
      ...linkRows.map((row) => asText(row.client_id)).filter((value): value is string => Boolean(value)),
      ...reservationCandidates
        .map((row) => asText((row as Record<string, unknown>).client_id))
        .filter((value): value is string => Boolean(value)),
    ])
  );

  let clientMapResult: ClientMapResult;
  try {
    clientMapResult = await fetchClientsByIds(client, scopedOrganizationId, clientIds);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_clients_read_error",
        details: error instanceof Error ? error.message : "unknown_clients_read_error",
      },
      { status: 500 }
    );
  }

  const verifiedLinks = linkRows.map((row) => {
    const mapped = mapPropertyClientLinkRow(row);
    return {
      ...mapped,
      client: mapped.client_id ? clientMapResult.byId.get(mapped.client_id) ?? null : null,
    };
  });

  const hydratedCandidates = reservationCandidates.map((candidate) => {
    const clientId = asText((candidate as Record<string, unknown>).client_id);
    return {
      ...candidate,
      client: clientId ? clientMapResult.byId.get(clientId) ?? null : null,
    };
  });

  const activeLinks = verifiedLinks.filter((entry) => entry.is_active === true);
  const activeBuyerLinks = activeLinks.filter(
    (entry) => entry.buyer_role === "primary" || entry.buyer_role === "co_buyer"
  );
  const activePrimaryLinks = activeLinks.filter((entry) => entry.buyer_role === "primary");

  const linkStatus =
    activeBuyerLinks.length > 0
      ? "verified"
      : hydratedCandidates.length > 0
        ? "pending_verification"
        : "not_linked";

  const warnings = [linksTableWarning, reservationsTableWarning].filter(
    (value): value is string => Boolean(value)
  );
  if (!includeReservationCandidates) {
    warnings.push("reservation_candidates_disabled");
  }

  return jsonResponse({
    ok: true,
    data: {
      property: mappedProperty,
      project_property_id: projectPropertyId,
      link_status: linkStatus,
      rules: {
        max_active_buyers: 2,
        max_active_primary_buyers: 1,
      },
      summary: {
        verified_links_total: verifiedLinks.length,
        verified_active_links_total: activeLinks.length,
        verified_active_buyers_total: activeBuyerLinks.length,
        verified_primary_buyers_total: activePrimaryLinks.length,
        reservation_candidates_total: hydratedCandidates.length,
      },
      verified_links: verifiedLinks,
      reservation_candidates: hydratedCandidates,
    },
    meta: {
      storage: "supabase.crm.property_client_links",
      links_table: linksTableAvailable ? "available" : "missing",
      reservations_table: reservationsTableAvailable ? "available" : "missing",
      reservation_candidates_mode: includeReservationCandidates ? "enabled" : "disabled",
      schema_profile_data: clientMapResult.usedLegacyProfile ? "missing_legacy_fallback" : "available",
      warnings,
    },
  });
};

export const POST: APIRoute = async ({ params, request, url }) => {
  const propertyId = getPropertyIdFromParams(params);
  if (!propertyId) {
    return jsonResponse({ ok: false, error: "property_id_required" }, { status: 400 });
  }

  const body = await parseJsonBody<UpsertPropertyClientLinkBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const requestedOrganizationId = asText(body.organization_id) ?? asText(url.searchParams.get("organization_id"));
  const clientId = asText(body.client_id);
  if (!clientId || !UUID_RX.test(clientId)) {
    return jsonResponse({ ok: false, error: "client_id_required" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: false,
        error: "mock_property_client_link_not_implemented",
      },
      { status: 501 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const propertyRead = await readProperty(client, propertyId, requestedOrganizationId);
  if (propertyRead.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_read_error",
        details: propertyRead.error.message,
      },
      { status: 500 }
    );
  }
  if (!propertyRead.data) {
    return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });
  }

  const scopedOrganizationId = resolveScopeOrganizationId(requestedOrganizationId, propertyRead.data);
  if (!scopedOrganizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  const payload = {
    organization_id: scopedOrganizationId,
    property_id: propertyId,
    client_id: clientId,
    buyer_role: normalizeBuyerRole(body.buyer_role),
    civil_status: asText(body.civil_status),
    marital_regime: asText(body.marital_regime),
    ownership_share: asNumber(body.ownership_share),
    is_active: asBoolean(body.is_active) ?? true,
    link_source: normalizeLinkSource(body.link_source),
    notes: asText(body.notes),
    metadata: asObject(body.metadata),
  };

  const { data, error } = await client
    .schema("crm")
    .from("property_client_links")
    .upsert(payload, {
      onConflict: "organization_id,property_id,client_id",
    })
    .select(PROPERTY_CLIENT_LINK_SELECT_COLUMNS)
    .single();

  if (error) {
    if (isMissingTableError(error, "property_client_links")) {
      return jsonResponse(
        {
          ok: false,
          error: "db_table_missing_property_client_links",
          details: "Aplica supabase/sql/009_property_client_links.sql y reintenta.",
        },
        { status: 500 }
      );
    }

    const errorText = String(error.message ?? "db_property_client_links_write_error");
    const isValidationError =
      errorText.includes("Only 2 active buyers") ||
      errorText.includes("Only 1 active primary buyer") ||
      errorText.includes("Organization mismatch") ||
      errorText.includes("record_type unit/single");

    return jsonResponse(
      {
        ok: false,
        error: isValidationError ? "invalid_property_client_link" : "db_property_client_links_write_error",
        details: errorText,
      },
      { status: isValidationError ? 422 : 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapPropertyClientLinkRow((data as Record<string, unknown>) ?? {}),
    meta: {
      storage: "supabase.crm.property_client_links",
    },
  });
};

export const ALL: APIRoute = ({ request }) => methodNotAllowed(request, ["GET", "POST"]);
