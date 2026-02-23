import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";

type ReservationStatus =
  | "pre_registered"
  | "reservation_sent"
  | "reserved"
  | "adhesion_paid"
  | "contract_signed"
  | "cancelled"
  | "discarded"
  | "other";

type DocumentMetricKey =
  | "is_document_copy_received"
  | "is_aml_form_received"
  | "is_uploaded_to_folder";

type ReservationRow = Record<string, unknown>;

const STATUS_ORDER: ReservationStatus[] = [
  "pre_registered",
  "reservation_sent",
  "reserved",
  "adhesion_paid",
  "contract_signed",
  "cancelled",
  "discarded",
  "other",
];

const ACTIVE_STATUS_SET = new Set<ReservationStatus>([
  "pre_registered",
  "reservation_sent",
  "reserved",
  "adhesion_paid",
  "contract_signed",
]);

const DOCUMENT_METRICS: Array<{ key: DocumentMetricKey; label: string }> = [
  { key: "is_document_copy_received", label: "DNI/Pasaporte recibido" },
  { key: "is_aml_form_received", label: "Formulario blanqueo recibido" },
  { key: "is_uploaded_to_folder", label: "Subido a carpeta" },
];

const RESERVATION_SELECT_COLUMNS = [
  "id",
  "client_id",
  "project_property_id",
  "source_file",
  "reservation_status",
  "reservation_date",
  "pre_registration_date",
  "reservation_paid_date",
  "adhesion_paid_date",
  "drop_date",
  "transaction_cycle_days",
  "price_without_vat",
  "is_direct_sale",
  "is_agency_sale",
  "is_reservation_paid",
  "is_adhesion_paid",
  "is_document_copy_received",
  "is_aml_form_received",
  "is_uploaded_to_folder",
].join(", ");

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "sí"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return null;
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const formatMonth = (isoDate: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  return isoDate.slice(0, 7);
};

const percentage = (part: number, total: number, digits = 1) => {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  const raw = (part / total) * 100;
  const factor = 10 ** digits;
  return Math.round(raw * factor) / factor;
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

const isMissingReservationsTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const code = String(row.code ?? "");
  const message = String(row.message ?? "").toLowerCase();
  return code === "PGRST205" || message.includes("client_project_reservations");
};

const emptyStatusMap = () =>
  ({
    pre_registered: 0,
    reservation_sent: 0,
    reserved: 0,
    adhesion_paid: 0,
    contract_signed: 0,
    cancelled: 0,
    discarded: 0,
    other: 0,
  }) as Record<ReservationStatus, number>;

const getProjectName = (row: Record<string, unknown>) => {
  const propertyData = asObject(row.property_data);
  const translations = asObject(row.translations);
  const languagePriority = ["es", "en", "de", "fr", "it", "nl"];

  for (const language of languagePriority) {
    const scoped = asObject(translations[language]);
    const title = asText(scoped.title) ?? asText(scoped.name);
    if (title) return title;
  }

  return (
    asText(propertyData.project_name) ??
    asText(propertyData.commercial_name) ??
    asText(propertyData.name) ??
    asText(propertyData.title) ??
    asText(row.legacy_code) ??
    "Promocion"
  );
};

const getOrganizationId = (url: URL) =>
  asText(url.searchParams.get("organization_id")) ??
  asText(import.meta.env.CRM_ORGANIZATION_ID) ??
  asText(import.meta.env.PUBLIC_CRM_ORGANIZATION_ID);

const fetchAllReservations = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string
) => {
  const rows: ReservationRow[] = [];
  const pageSize = 1000;
  let from = 0;
  let guard = 0;

  while (guard < 500) {
    guard += 1;
    const to = from + pageSize - 1;
    const { data, error } = await client
      .schema("crm")
      .from("client_project_reservations")
      .select(RESERVATION_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("source_file", { ascending: true })
      .order("source_row_number", { ascending: true })
      .range(from, to);

    if (error) throw error;
    const chunk = (data ?? []) as ReservationRow[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return rows;
};

const fetchProjects = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  projectIds: string[]
) => {
  if (!projectIds.length) return new Map<string, { legacyCode: string | null; name: string }>();

  const result = new Map<string, { legacyCode: string | null; name: string }>();
  const chunkSize = 150;

  for (let offset = 0; offset < projectIds.length; offset += chunkSize) {
    const chunk = projectIds.slice(offset, offset + chunkSize);
    const { data, error } = await client
      .schema("crm")
      .from("properties")
      .select("id, legacy_code, property_data, translations")
      .eq("organization_id", organizationId)
      .in("id", chunk);

    if (error) throw error;
    (data ?? []).forEach((item) => {
      const row = item as Record<string, unknown>;
      const id = asText(row.id);
      if (!id) return;
      result.set(id, {
        legacyCode: asText(row.legacy_code),
        name: getProjectName(row),
      });
    });
  }

  return result;
};

export const GET: APIRoute = async ({ url }) => {
  const organizationId = getOrganizationId(url);
  if (!organizationId) {
    return jsonResponse(
      {
        ok: false,
        error: "organization_id_required",
        details: "Define organization_id por query o CRM_ORGANIZATION_ID en entorno.",
      },
      { status: 422 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        organization_id: organizationId,
        generated_at: new Date().toISOString(),
        totals: {
          clients_total: 0,
          clients_linked_total: 0,
          promotions_total: 0,
          reservations_total: 0,
        },
        kpis: {
          coverage_pct: 0,
          active_reservations_total: 0,
          active_reservations_pct: 0,
          avg_ticket_without_vat: null,
          avg_cycle_days: null,
          reservation_paid_pct: 0,
          adhesion_paid_pct: 0,
          document_completion_pct: 0,
        },
        sales_channels: { total: 0, direct: 0, agency: 0, mixed: 0, unknown: 0 },
        status_breakdown: [],
        monthly: [],
        documents: [],
        promotions: [],
        sources: [],
      },
      meta: {
        storage: "mock_in_memory",
        next_step: "connect_supabase_tables_for_clients_dashboard",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { count: totalClients, error: clientsCountError } = await client
    .schema("crm")
    .from("clients")
    .select("id", { head: true, count: "exact" })
    .eq("organization_id", organizationId);

  if (clientsCountError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_clients_count_error",
        details: clientsCountError.message,
      },
      { status: 500 }
    );
  }

  let reservations: ReservationRow[] = [];
  try {
    reservations = await fetchAllReservations(client, organizationId);
  } catch (error) {
    if (isMissingReservationsTableError(error)) {
      return jsonResponse(
        {
          ok: false,
          error: "db_table_missing_client_project_reservations",
          details: "Aplica supabase/sql/008_clients_project_reservations.sql y reintenta.",
        },
        { status: 500 }
      );
    }
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "unknown_reservations_error";
    return jsonResponse(
      {
        ok: false,
        error: "db_reservations_read_error",
        details: message,
      },
      { status: 500 }
    );
  }

  const uniqueClientIds = new Set<string>();
  const uniqueProjectIds = new Set<string>();
  const monthlyMap = new Map<string, number>();
  const statusTotals = emptyStatusMap();
  const sourceMap = new Map<string, { reservations: number; clientIds: Set<string> }>();
  const documentTotals = new Map<DocumentMetricKey, { known: number; completed: number; pending: number }>();
  const promotionMap = new Map<
    string,
    {
      clientIds: Set<string>;
      reservations: number;
      activeReservations: number;
      monthly: Map<string, number>;
      status: Record<ReservationStatus, number>;
      direct: number;
      agency: number;
      mixed: number;
      unknown: number;
      priceSum: number;
      priceCount: number;
      cycleSum: number;
      cycleCount: number;
      reservationPaidCompleted: number;
      reservationPaidKnown: number;
      adhesionPaidCompleted: number;
      adhesionPaidKnown: number;
      docCompleted: number;
      docKnown: number;
    }
  >();

  const salesChannels = { total: 0, direct: 0, agency: 0, mixed: 0, unknown: 0 };
  let activeReservationsTotal = 0;
  let reservationPaidCompleted = 0;
  let reservationPaidKnown = 0;
  let adhesionPaidCompleted = 0;
  let adhesionPaidKnown = 0;
  let ticketSum = 0;
  let ticketCount = 0;
  let cycleSum = 0;
  let cycleCount = 0;

  DOCUMENT_METRICS.forEach(({ key }) => {
    documentTotals.set(key, { known: 0, completed: 0, pending: 0 });
  });

  reservations.forEach((row) => {
    salesChannels.total += 1;

    const clientId = asText(row.client_id);
    const projectId = asText(row.project_property_id);
    if (clientId) uniqueClientIds.add(clientId);
    if (projectId) uniqueProjectIds.add(projectId);

    const status = normalizeReservationStatus(row.reservation_status);
    statusTotals[status] += 1;
    if (ACTIVE_STATUS_SET.has(status)) activeReservationsTotal += 1;

    const isDirect = asBoolean(row.is_direct_sale);
    const isAgency = asBoolean(row.is_agency_sale);
    if (isDirect === true && isAgency !== true) salesChannels.direct += 1;
    else if (isAgency === true && isDirect !== true) salesChannels.agency += 1;
    else if (isAgency === true && isDirect === true) salesChannels.mixed += 1;
    else salesChannels.unknown += 1;

    const monthSource =
      asText(row.reservation_date) ??
      asText(row.pre_registration_date) ??
      asText(row.reservation_paid_date) ??
      asText(row.adhesion_paid_date);
    const month = monthSource ? formatMonth(monthSource) : null;
    if (month) {
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + 1);
    }

    const source = asText(row.source_file) ?? "desconocido";
    const sourceBucket = sourceMap.get(source) ?? { reservations: 0, clientIds: new Set<string>() };
    sourceBucket.reservations += 1;
    if (clientId) sourceBucket.clientIds.add(clientId);
    sourceMap.set(source, sourceBucket);

    const price = asNumber(row.price_without_vat);
    if (price !== null && price > 0) {
      ticketSum += price;
      ticketCount += 1;
    }

    const cycle = asNumber(row.transaction_cycle_days);
    if (cycle !== null && cycle >= 0) {
      cycleSum += cycle;
      cycleCount += 1;
    }

    const reservationPaid = asBoolean(row.is_reservation_paid);
    if (reservationPaid !== null) {
      reservationPaidKnown += 1;
      if (reservationPaid === true) reservationPaidCompleted += 1;
    }

    const adhesionPaid = asBoolean(row.is_adhesion_paid);
    if (adhesionPaid !== null) {
      adhesionPaidKnown += 1;
      if (adhesionPaid === true) adhesionPaidCompleted += 1;
    }

    let docKnownInRow = 0;
    let docCompletedInRow = 0;
    DOCUMENT_METRICS.forEach(({ key }) => {
      const metricBucket = documentTotals.get(key);
      if (!metricBucket) return;
      const value = asBoolean(row[key]);
      if (value === null) return;
      metricBucket.known += 1;
      docKnownInRow += 1;
      if (value === true) {
        metricBucket.completed += 1;
        docCompletedInRow += 1;
      } else {
        metricBucket.pending += 1;
      }
    });

    if (projectId) {
      const promotion =
        promotionMap.get(projectId) ??
        {
          clientIds: new Set<string>(),
          reservations: 0,
          activeReservations: 0,
          monthly: new Map<string, number>(),
          status: emptyStatusMap(),
          direct: 0,
          agency: 0,
          mixed: 0,
          unknown: 0,
          priceSum: 0,
          priceCount: 0,
          cycleSum: 0,
          cycleCount: 0,
          reservationPaidCompleted: 0,
          reservationPaidKnown: 0,
          adhesionPaidCompleted: 0,
          adhesionPaidKnown: 0,
          docCompleted: 0,
          docKnown: 0,
        };

      if (clientId) promotion.clientIds.add(clientId);
      promotion.reservations += 1;
      promotion.status[status] += 1;
      if (ACTIVE_STATUS_SET.has(status)) promotion.activeReservations += 1;
      if (month) {
        promotion.monthly.set(month, (promotion.monthly.get(month) ?? 0) + 1);
      }

      if (isDirect === true && isAgency !== true) promotion.direct += 1;
      else if (isAgency === true && isDirect !== true) promotion.agency += 1;
      else if (isAgency === true && isDirect === true) promotion.mixed += 1;
      else promotion.unknown += 1;

      if (price !== null && price > 0) {
        promotion.priceSum += price;
        promotion.priceCount += 1;
      }
      if (cycle !== null && cycle >= 0) {
        promotion.cycleSum += cycle;
        promotion.cycleCount += 1;
      }
      if (reservationPaid !== null) {
        promotion.reservationPaidKnown += 1;
        if (reservationPaid === true) promotion.reservationPaidCompleted += 1;
      }
      if (adhesionPaid !== null) {
        promotion.adhesionPaidKnown += 1;
        if (adhesionPaid === true) promotion.adhesionPaidCompleted += 1;
      }
      promotion.docKnown += docKnownInRow;
      promotion.docCompleted += docCompletedInRow;

      promotionMap.set(projectId, promotion);
    }
  });

  let projectsById = new Map<string, { legacyCode: string | null; name: string }>();
  try {
    projectsById = await fetchProjects(client, organizationId, Array.from(uniqueProjectIds));
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "unknown_projects_error";
    return jsonResponse(
      {
        ok: false,
        error: "db_projects_read_error",
        details: message,
      },
      { status: 500 }
    );
  }

  const promotions = Array.from(promotionMap.entries())
    .map(([projectId, value]) => {
      const meta = projectsById.get(projectId);
      const topStatus = STATUS_ORDER.reduce(
        (best, key) => (value.status[key] > value.status[best] ? key : best),
        "other" as ReservationStatus
      );
      return {
        project_id: projectId,
        project_legacy_code: meta?.legacyCode ?? null,
        project_name: meta?.name ?? "Promocion",
        clients_total: value.clientIds.size,
        reservations_total: value.reservations,
        active_reservations_total: value.activeReservations,
        active_reservations_pct: percentage(value.activeReservations, value.reservations, 1),
        avg_ticket_without_vat: value.priceCount > 0 ? value.priceSum / value.priceCount : null,
        avg_cycle_days: value.cycleCount > 0 ? value.cycleSum / value.cycleCount : null,
        reservation_paid_pct: percentage(value.reservationPaidCompleted, value.reservationPaidKnown, 1),
        adhesion_paid_pct: percentage(value.adhesionPaidCompleted, value.adhesionPaidKnown, 1),
        document_completion_pct: percentage(value.docCompleted, value.docKnown, 1),
        top_status: topStatus,
        sales_channels: {
          total: value.reservations,
          direct: value.direct,
          agency: value.agency,
          mixed: value.mixed,
          unknown: value.unknown,
        },
        monthly: Array.from(value.monthly.entries())
          .map(([month, count]) => ({ month, count }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        status_breakdown: STATUS_ORDER.map((statusKey) => ({
          status: statusKey,
          count: value.status[statusKey],
          pct: percentage(value.status[statusKey], value.reservations, 1),
        })),
      };
    })
    .sort((a, b) => {
      if (b.clients_total !== a.clients_total) return b.clients_total - a.clients_total;
      if (b.reservations_total !== a.reservations_total) return b.reservations_total - a.reservations_total;
      return String(a.project_legacy_code ?? "").localeCompare(String(b.project_legacy_code ?? ""));
    });

  const documents = DOCUMENT_METRICS.map(({ key, label }) => {
    const bucket = documentTotals.get(key) ?? { known: 0, completed: 0, pending: 0 };
    return {
      key,
      label,
      known: bucket.known,
      completed: bucket.completed,
      pending: bucket.pending,
      completion_pct: percentage(bucket.completed, bucket.known, 1),
    };
  });

  const monthly = Array.from(monthlyMap.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const sources = Array.from(sourceMap.entries())
    .map(([sourceFile, value]) => ({
      source_file: sourceFile,
      reservations_total: value.reservations,
      clients_total: value.clientIds.size,
    }))
    .sort((a, b) => b.reservations_total - a.reservations_total);

  const reservationsTotal = reservations.length;
  const clientsTotalSafe = Number(totalClients ?? 0);
  const linkedClientsTotal = uniqueClientIds.size;
  const weightedDocCompleted = documents.reduce((sum, item) => sum + item.completed, 0);
  const weightedDocKnown = documents.reduce((sum, item) => sum + item.known, 0);

  return jsonResponse({
    ok: true,
    data: {
      organization_id: organizationId,
      generated_at: new Date().toISOString(),
      totals: {
        clients_total: clientsTotalSafe,
        clients_linked_total: linkedClientsTotal,
        promotions_total: uniqueProjectIds.size,
        reservations_total: reservationsTotal,
      },
      kpis: {
        coverage_pct: percentage(linkedClientsTotal, clientsTotalSafe, 1),
        active_reservations_total: activeReservationsTotal,
        active_reservations_pct: percentage(activeReservationsTotal, reservationsTotal, 1),
        avg_ticket_without_vat: ticketCount > 0 ? ticketSum / ticketCount : null,
        avg_cycle_days: cycleCount > 0 ? cycleSum / cycleCount : null,
        reservation_paid_pct: percentage(reservationPaidCompleted, reservationPaidKnown, 1),
        adhesion_paid_pct: percentage(adhesionPaidCompleted, adhesionPaidKnown, 1),
        document_completion_pct: percentage(weightedDocCompleted, weightedDocKnown, 1),
      },
      sales_channels: salesChannels,
      status_breakdown: STATUS_ORDER.map((statusKey) => ({
        status: statusKey,
        count: statusTotals[statusKey],
        pct: percentage(statusTotals[statusKey], reservationsTotal, 1),
      })),
      monthly,
      documents,
      promotions,
      sources,
    },
    meta: {
      storage: "supabase.crm.client_project_reservations",
      rows_scanned: reservationsTotal,
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
