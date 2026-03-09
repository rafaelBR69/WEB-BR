import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { resolveCrmOrgAccess } from "@/utils/crmAccess";
import { asText, asUuid, asObject, toPositiveInt } from "@/utils/crmPortal";
import { getProjectNameFromRow, getPropertyDisplayNameFromRow } from "@/utils/crmProperties";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import { 
  LEAD_SELECT_COLUMNS, 
  CONTACT_SELECT_COLUMNS, 
  PROPERTY_SELECT_COLUMNS,
  LEAD_STATUSES,
  LEAD_ORIGIN_TYPES,
  LEAD_KINDS,
  LEAD_OPERATION_INTERESTS,
  normalizeLeadStatus,
  normalizeLeadOriginType,
  normalizeLeadKind,
  normalizeOperationInterest,
  normalizeEmail,
  normalizePhone,
  normalizeNationality,
  normalizeNationalityKey,
  asFiniteNumber,
  buildLeadRows
} from "@/utils/crmLeads";

const PROPERTY_CONTEXT_SELECT_COLUMNS = ["id", "legacy_code", "parent_property_id", "record_type"].join(", ");

const TREATED_NEW_STATUS = "new";

type LeadStatus = (typeof LEAD_STATUSES)[number];
type LeadOriginType = (typeof LEAD_ORIGIN_TYPES)[number];
type LeadKind = (typeof LEAD_KINDS)[number];
type LeadOperationInterest = (typeof LEAD_OPERATION_INTERESTS)[number];

type QueryChunkResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

type LeadListRow = {
  id: string | null;
  contact_id: string | null;
  property_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  nationality_normalized: string | null;
  lead_kind: string | null;
  origin_type: string | null;
  source: string | null;
  status: string | null;
  is_treated: boolean;
  priority: number | null;
  operation_interest: string | null;
  budget_min: number | null;
  budget_max: number | null;
  discarded_reason: string | null;
  discarded_at: string | null;
  message: string | null;
  import_source_file: string | null;
  import_source_row_number: number | null;
  property_code: string | null;
  property_label: string | null;
  property_record_type: string | null;
  project_id: string | null;
  project_code: string | null;
  project_label: string | null;
  created_at: string | null;
  updated_at: string | null;
  search_blob: string;
};

type CreateLeadBody = {
  organization_id?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  message?: string | null;
  source?: string | null;
  origin_type?: string | null;
  lead_kind?: string | null;
  status?: string | null;
  operation_interest?: string | null;
  priority?: number | string | null;
  budget_min?: number | string | null;
  budget_max?: number | string | null;
  agency_id?: string | null;
  agency_contact_id?: string | null;
  property_id?: string | null;
  project_id?: string | null;
  property_legacy_code?: string | null;
  discarded_reason?: string | null;
};



const parseTreatedFilter = (value: string | null): { ok: boolean; value: boolean | null } => {
  if (!value) return { ok: true, value: null };
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["1", "true", "yes", "treated", "si"].includes(normalized)) return { ok: true, value: true };
  if (["0", "false", "no", "untreated", "no_tratado", "no-tratado"].includes(normalized)) return { ok: true, value: false };
  return { ok: false, value: null };
};

const propertyLabel = (row: Record<string, unknown> | null): string | null => {
  if (!row) return null;
  return getPropertyDisplayNameFromRow(row);
};

const projectLabel = (row: Record<string, unknown> | null): string | null => {
  if (!row) return null;
  return getProjectNameFromRow(row) ?? getPropertyDisplayNameFromRow(row);
};

const readAllPages = async (
  loader: (from: number, to: number) => Promise<QueryChunkResult>,
  pageSize = 1000
): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await loader(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = Array.isArray(data) ? data : [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += chunk.length;
  }

  return rows;
};



const findContactByIdentity = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  email: string | null,
  phone: string | null
): Promise<Record<string, unknown> | null> => {
  if (email) {
    const { data, error } = await client
      .schema("crm")
      .from("contacts")
      .select(CONTACT_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .ilike("email", email)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`db_contact_find_by_email_error:${error.message}`);
    if (data) return data as unknown as Record<string, unknown>;
  }

  if (phone) {
    const { data, error } = await client
      .schema("crm")
      .from("contacts")
      .select(CONTACT_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("phone", phone)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`db_contact_find_by_phone_error:${error.message}`);
    if (data) return data as unknown as Record<string, unknown>;
  }

  return null;
};

const resolvePropertyIdForMutation = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  input: {
    propertyId: string | null;
    projectId: string | null;
    propertyLegacyCode: string | null;
  }
): Promise<{
  propertyId: string | null;
  propertyLegacyCode: string | null;
  propertyRecordType: string | null;
  projectId: string | null;
  projectLegacyCode: string | null;
  projectRecordType: string | null;
  error: string | null;
}> => {
  const readPropertyById = async (propertyId: string, errorPrefix: string) => {
    const { data, error } = await client
      .schema("crm")
      .from("properties")
      .select(PROPERTY_CONTEXT_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", propertyId)
      .maybeSingle();
    if (error) return { row: null, error: `${errorPrefix}:${error.message}` };
    return { row: (data as Record<string, unknown> | null) ?? null, error: null };
  };

  const buildContext = async (propertyRow: Record<string, unknown> | null) => {
    if (!propertyRow) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: null,
      };
    }

    const propertyId = asUuid(propertyRow.id);
    if (!propertyId) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: "property_invalid_shape",
      };
    }

    let projectRow = propertyRow;
    const parentPropertyId = asUuid(propertyRow.parent_property_id);
    if (parentPropertyId) {
      const parentRead = await readPropertyById(parentPropertyId, "db_project_parent_read_error");
      if (parentRead.error) {
        return {
          propertyId,
          propertyLegacyCode: asText(propertyRow.legacy_code),
          propertyRecordType: asText(propertyRow.record_type),
          projectId: null,
          projectLegacyCode: null,
          projectRecordType: null,
          error: parentRead.error,
        };
      }
      if (parentRead.row) projectRow = parentRead.row;
    }

    return {
      propertyId,
      propertyLegacyCode: asText(propertyRow.legacy_code),
      propertyRecordType: asText(propertyRow.record_type),
      projectId: asUuid(projectRow.id),
      projectLegacyCode: asText(projectRow.legacy_code),
      projectRecordType: asText(projectRow.record_type),
      error: null,
    };
  };

  if (input.propertyId) {
    const propertyRead = await readPropertyById(input.propertyId, "db_property_read_error");
    if (propertyRead.error) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: propertyRead.error,
      };
    }
    if (!propertyRead.row) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: "property_id_not_found",
      };
    }
    return buildContext(propertyRead.row);
  }

  if (input.projectId) {
    const projectRead = await readPropertyById(input.projectId, "db_project_read_error");
    if (projectRead.error) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: projectRead.error,
      };
    }
    if (!projectRead.row) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: "project_id_not_found",
      };
    }
    return buildContext(projectRead.row);
  }

  if (input.propertyLegacyCode) {
    const { data, error } = await client
      .schema("crm")
      .from("properties")
      .select(PROPERTY_CONTEXT_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("legacy_code", input.propertyLegacyCode)
      .maybeSingle();
    if (error) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: `db_property_legacy_read_error:${error.message}`,
      };
    }
    if (!data) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: "property_legacy_code_not_found",
      };
    }
    return buildContext(data as unknown as Record<string, unknown>);
  }

  return {
    propertyId: null,
    propertyLegacyCode: null,
    propertyRecordType: null,
    projectId: null,
    projectLegacyCode: null,
    projectRecordType: null,
    error: null,
  };
};

export const GET: APIRoute = async ({ url, cookies }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 1000);

  const statusRaw = asText(url.searchParams.get("status"));
  const originTypeRaw = asText(url.searchParams.get("origin_type"));
  const sourceRaw = asText(url.searchParams.get("source"));
  const operationInterestRaw = asText(url.searchParams.get("operation_interest"));
  const leadKindRaw = asText(url.searchParams.get("lead_kind"));
  const projectIdRaw = asText(url.searchParams.get("project_id"));
  const propertyIdRaw = asText(url.searchParams.get("property_id"));
  const nationalityRaw = normalizeNationality(url.searchParams.get("nationality"));
  const nationalityFilter = normalizeNationalityKey(nationalityRaw);
  const treatedFilter = parseTreatedFilter(asText(url.searchParams.get("treated")));

  const status = statusRaw ? normalizeLeadStatus(statusRaw, "new") : null;
  const originType = originTypeRaw ? normalizeLeadOriginType(originTypeRaw, "other") : null;
  const operationInterest = operationInterestRaw ? normalizeOperationInterest(operationInterestRaw, "sale") : null;
  const leadKind = leadKindRaw ? normalizeLeadKind(leadKindRaw, "buyer") : null;
  const projectId = projectIdRaw ? asUuid(projectIdRaw) : null;
  const propertyId = propertyIdRaw ? asUuid(propertyIdRaw) : null;

  if (statusRaw && status !== statusRaw) {
    return jsonResponse({ ok: false, error: "invalid_status" }, { status: 422 });
  }
  if (originTypeRaw && originType !== originTypeRaw) {
    return jsonResponse({ ok: false, error: "invalid_origin_type" }, { status: 422 });
  }
  if (operationInterestRaw && operationInterest !== operationInterestRaw) {
    return jsonResponse({ ok: false, error: "invalid_operation_interest" }, { status: 422 });
  }
  if (leadKindRaw && leadKind !== leadKindRaw) {
    return jsonResponse({ ok: false, error: "invalid_lead_kind" }, { status: 422 });
  }
  if (projectIdRaw && !projectId) {
    return jsonResponse({ ok: false, error: "invalid_project_id" }, { status: 422 });
  }
  if (propertyIdRaw && !propertyId) {
    return jsonResponse({ ok: false, error: "invalid_property_id" }, { status: 422 });
  }
  if (!treatedFilter.ok) {
    return jsonResponse({ ok: false, error: "invalid_treated_filter" }, { status: 422 });
  }

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.leads.read"],
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

  let leadsRaw: Record<string, unknown>[];
  let contactsRaw: Record<string, unknown>[];
  let propertiesRaw: Record<string, unknown>[];

  try {
    [leadsRaw, contactsRaw, propertiesRaw] = await Promise.all([
      readAllPages(async (from, to) => {
        const response = (await client
          .schema("crm")
          .from("leads")
          .select(LEAD_SELECT_COLUMNS)
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .range(from, to)) as unknown as QueryChunkResult;
        return response;
      }),
      readAllPages(async (from, to) => {
        const response = (await client
          .schema("crm")
          .from("contacts")
          .select(CONTACT_SELECT_COLUMNS)
          .eq("organization_id", organizationId)
          .range(from, to)) as unknown as QueryChunkResult;
        return response;
      }),
      readAllPages(async (from, to) => {
        const response = (await client
          .schema("crm")
          .from("properties")
          .select(PROPERTY_SELECT_COLUMNS)
          .eq("organization_id", organizationId)
          .range(from, to)) as unknown as QueryChunkResult;
        return response;
      }),
    ]);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_leads_read_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  const contactsById = new Map<string, Record<string, unknown>>();
  contactsRaw.forEach((row) => {
    const id = asUuid(row.id);
    if (!id) return;
    contactsById.set(id, row);
  });

  const propertiesById = new Map<string, Record<string, unknown>>();
  propertiesRaw.forEach((row) => {
    const id = asUuid(row.id);
    if (!id) return;
    propertiesById.set(id, row);
  });

  const baseRows = buildLeadRows(leadsRaw, contactsById, propertiesById);
  const projectOptionsById = new Map<
    string,
    {
      project_id: string;
      project_code: string | null;
      project_label: string | null;
      count: number;
    }
  >();
  const sourceOptionsMap = new Map<string, number>();

  baseRows.forEach((row) => {
    if (row.project_id) {
      const current = projectOptionsById.get(row.project_id) ?? {
        project_id: row.project_id,
        project_code: row.project_code,
        project_label: row.project_label,
        count: 0,
      };
      current.count += 1;
      if (!current.project_code && row.project_code) current.project_code = row.project_code;
      if (!current.project_label && row.project_label) current.project_label = row.project_label;
      projectOptionsById.set(row.project_id, current);
    }

    const sourceKey = row.source ?? null;
    if (sourceKey) {
      sourceOptionsMap.set(sourceKey, (sourceOptionsMap.get(sourceKey) ?? 0) + 1);
    }
  });

  const filteredRows = baseRows.filter((row) => {
    if (status && row.status !== status) return false;
    if (originType && row.origin_type !== originType) return false;
    if (sourceRaw && row.source !== sourceRaw) return false;
    if (operationInterest && row.operation_interest !== operationInterest) return false;
    if (leadKind && row.lead_kind !== leadKind) return false;
    if (projectId && row.project_id !== projectId) return false;
    if (propertyId && row.property_id !== propertyId) return false;
    if (nationalityFilter && row.nationality_normalized !== nationalityFilter) return false;
    if (treatedFilter.value != null && row.is_treated !== treatedFilter.value) return false;
    if (q && !row.search_blob.includes(q)) return false;
    return true;
  });

  const statusSummary: Record<string, number> = {};
  LEAD_STATUSES.forEach((entry) => {
    statusSummary[entry] = 0;
  });

  const originSummary: Record<string, number> = {};
  LEAD_ORIGIN_TYPES.forEach((entry) => {
    originSummary[entry] = 0;
  });

  const sourceSummaryMap = new Map<string, number>();
  const nationalitySummaryMap = new Map<string, number>();

  let treatedCount = 0;
  let untreatedCount = 0;

  const projectsByCode = new Map<
    string,
    {
      project_id: string | null;
      project_code: string | null;
      project_label: string | null;
      count: number;
    }
  >();

  filteredRows.forEach((row) => {
    const statusKey = row.status ?? "unknown";
    statusSummary[statusKey] = (statusSummary[statusKey] ?? 0) + 1;

    const originKey = row.origin_type ?? "other";
    originSummary[originKey] = (originSummary[originKey] ?? 0) + 1;

    const sourceKey = row.source ?? "unknown";
    sourceSummaryMap.set(sourceKey, (sourceSummaryMap.get(sourceKey) ?? 0) + 1);

    if (row.nationality) {
      nationalitySummaryMap.set(row.nationality, (nationalitySummaryMap.get(row.nationality) ?? 0) + 1);
    }

    if (row.is_treated) treatedCount += 1;
    else untreatedCount += 1;

    const projectKey = row.project_id ?? row.project_code ?? "sin-proyecto";
    const current = projectsByCode.get(projectKey) ?? {
      project_id: row.project_id,
      project_code: row.project_code,
      project_label: row.project_label,
      count: 0,
    };
    current.count += 1;
    projectsByCode.set(projectKey, current);
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
      summary: {
        by_status: statusSummary,
        by_origin_type: originSummary,
        by_source: Array.from(sourceSummaryMap.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .reduce<Record<string, number>>((acc, [sourceKey, count]) => {
            acc[sourceKey] = count;
            return acc;
          }, {}),
        by_treated: {
          treated: treatedCount,
          untreated: untreatedCount,
        },
        top_sources: Array.from(sourceSummaryMap.entries())
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12),
        top_projects: Array.from(projectsByCode.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 12),
        top_nationalities: Array.from(nationalitySummaryMap.entries())
          .map(([nationality, count]) => ({ nationality, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12),
      },
      options: {
        statuses: LEAD_STATUSES,
        origin_types: LEAD_ORIGIN_TYPES,
        sources: Array.from(sourceOptionsMap.entries())
          .map(([sourceKey, count]) => ({ source: sourceKey, count }))
          .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
        nationalities: Array.from(nationalitySummaryMap.entries())
          .map(([nationality, count]) => ({ nationality, count }))
          .sort((a, b) => b.count - a.count || a.nationality.localeCompare(b.nationality, "es")),
        projects: Array.from(projectOptionsById.values()).sort((a, b) => {
          const left = `${a.project_code ?? ""} ${a.project_label ?? ""}`.trim();
          const right = `${b.project_code ?? ""} ${b.project_label ?? ""}`.trim();
          return left.localeCompare(right, "es", { sensitivity: "base" });
        }),
        lead_kinds: LEAD_KINDS,
        operation_interests: LEAD_OPERATION_INTERESTS,
        treated_values: ["treated", "untreated"],
      },
      storage: "supabase.crm.leads + crm.contacts + crm.properties",
    },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<CreateLeadBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationIdHint = asText(body.organization_id);
  const fullName = asText(body.full_name);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const nationality = normalizeNationality(body.nationality);
  const message = asText(body.message);
  const source = asText(body.source) ?? "crm_manual";
  const status = normalizeLeadStatus(asText(body.status), "new");
  const originType = normalizeLeadOriginType(asText(body.origin_type), "other");
  const leadKind = normalizeLeadKind(asText(body.lead_kind), "buyer");
  const operationInterest = normalizeOperationInterest(asText(body.operation_interest), "sale");
  const priorityRaw = asFiniteNumber(body.priority);
  const priority = priorityRaw == null ? 3 : Math.min(5, Math.max(1, Math.trunc(priorityRaw)));
  const budgetMin = asFiniteNumber(body.budget_min);
  const budgetMax = asFiniteNumber(body.budget_max);
  const agencyIdInput = asUuid(body.agency_id);
  const agencyContactIdInput = asUuid(body.agency_contact_id);

  const propertyIdInput = asUuid(body.property_id);
  const projectIdInput = asUuid(body.project_id);
  const propertyLegacyCode = asText(body.property_legacy_code);
  const discardedReasonInput = asText(body.discarded_reason);

  if (!fullName) {
    return jsonResponse({ ok: false, error: "full_name_required" }, { status: 422 });
  }
  if (!email && !phone) {
    return jsonResponse({ ok: false, error: "email_or_phone_required" }, { status: 422 });
  }
  if (body.property_id != null && !propertyIdInput) {
    return jsonResponse({ ok: false, error: "invalid_property_id" }, { status: 422 });
  }
  if (body.project_id != null && !projectIdInput) {
    return jsonResponse({ ok: false, error: "invalid_project_id" }, { status: 422 });
  }
  if (body.agency_id != null && !agencyIdInput) {
    return jsonResponse({ ok: false, error: "invalid_agency_id" }, { status: 422 });
  }
  if (body.agency_contact_id != null && !agencyContactIdInput) {
    return jsonResponse({ ok: false, error: "invalid_agency_contact_id" }, { status: 422 });
  }
  if (originType === "agency" && !agencyIdInput) {
    return jsonResponse({ ok: false, error: "agency_id_required_for_agency_origin" }, { status: 422 });
  }
  if (agencyContactIdInput && !agencyIdInput) {
    return jsonResponse({ ok: false, error: "agency_id_required_for_agency_contact" }, { status: 422 });
  }

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.leads.write"],
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

  if (agencyIdInput) {
    const { data: agencyRow, error: agencyError } = await client
      .schema("crm")
      .from("agencies")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", agencyIdInput)
      .maybeSingle();

    if (agencyError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_agency_lookup_error",
          details: agencyError.message,
        },
        { status: 500 }
      );
    }

    if (!agencyRow) {
      return jsonResponse({ ok: false, error: "agency_not_found" }, { status: 422 });
    }
  }

  let agencyContactRow: Record<string, unknown> | null = null;
  if (agencyContactIdInput) {
    const { data: row, error: agencyContactError } = await client
      .schema("crm")
      .from("agency_contacts")
      .select("id, agency_id, contact_id, role, relation_status")
      .eq("organization_id", organizationId)
      .eq("id", agencyContactIdInput)
      .maybeSingle();

    if (agencyContactError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_agency_contact_lookup_error",
          details: agencyContactError.message,
        },
        { status: 500 }
      );
    }

    if (!row) {
      return jsonResponse({ ok: false, error: "agency_contact_not_found" }, { status: 422 });
    }

    if (asUuid(row.agency_id) !== agencyIdInput) {
      return jsonResponse({ ok: false, error: "agency_contact_not_belongs_to_agency" }, { status: 422 });
    }

    agencyContactRow = row as Record<string, unknown>;
  }

  let contactRow: Record<string, unknown> | null = null;
  try {
    contactRow = await findContactByIdentity(client, organizationId, email, phone);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_contact_lookup_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  if (!contactRow) {
    const contactInsertPayload: Record<string, unknown> = {
      organization_id: organizationId,
      contact_type: "lead",
      full_name: fullName,
      email,
      phone,
      notes: message,
      country_code: nationality,
    };

    const { data: insertedContact, error: contactInsertError } = await client
      .schema("crm")
      .from("contacts")
      .insert(contactInsertPayload)
      .select(CONTACT_SELECT_COLUMNS)
      .single();
    if (contactInsertError || !insertedContact) {
      return jsonResponse(
        {
          ok: false,
          error: "db_contact_insert_error",
          details: contactInsertError?.message ?? "insert_contact_failed",
        },
        { status: 500 }
      );
    }
    contactRow = insertedContact as unknown as Record<string, unknown>;
  }

  const contactId = asUuid(contactRow.id);
  if (!contactId) {
    return jsonResponse({ ok: false, error: "contact_id_missing_after_insert" }, { status: 500 });
  }

  const propertyResolution = await resolvePropertyIdForMutation(client, organizationId, {
    propertyId: propertyIdInput,
    projectId: projectIdInput,
    propertyLegacyCode,
  });
  if (propertyResolution.error) {
    return jsonResponse({ ok: false, error: propertyResolution.error }, { status: 422 });
  }

  const nowIso = new Date().toISOString();
  const discardedReason =
    status === "discarded" ? discardedReasonInput ?? "manual_discarded" : null;
  const discardedAt = status === "discarded" ? nowIso : null;
  let agencyContactInfo: Record<string, unknown> | null = null;
  if (agencyContactRow) {
    const contactId = asUuid(agencyContactRow.contact_id);
    const { data: agencyContactInfoRow } = contactId
      ? await client
          .schema("crm")
          .from("contacts")
          .select("id, full_name, email, phone")
          .eq("organization_id", organizationId)
          .eq("id", contactId)
          .maybeSingle()
      : { data: null };
    agencyContactInfo = agencyContactInfoRow as Record<string, unknown> | null;
  }

  const leadInsertPayload: Record<string, unknown> = {
    organization_id: organizationId,
    contact_id: contactId,
    property_id: propertyResolution.propertyId,
    agency_id: agencyIdInput,
    lead_kind: leadKind,
    origin_type: originType,
    source,
    status,
    priority,
    operation_interest: operationInterest,
    budget_min: budgetMin,
    budget_max: budgetMax,
    discarded_reason: discardedReason,
    discarded_at: discardedAt,
    raw_payload: {
      created_via: "crm_ui_manual",
      mapped: {
        full_name: fullName,
        email,
        phone,
        nationality,
        property_id: propertyResolution.propertyId,
        property_legacy_code: propertyResolution.propertyLegacyCode ?? propertyLegacyCode,
        project_id: propertyResolution.projectId,
        project_legacy_code: propertyResolution.projectLegacyCode,
        agency_id: agencyIdInput,
        agency_contact_id: agencyContactIdInput,
        agency_contact_name: asText(agencyContactInfo?.full_name),
        agency_contact_email: asText(agencyContactInfo?.email),
        agency_contact_phone: asText(agencyContactInfo?.phone),
        source,
        message,
      },
      project: {
        property_id: propertyResolution.propertyId,
        property_legacy_code: propertyResolution.propertyLegacyCode ?? propertyLegacyCode,
        property_record_type: propertyResolution.propertyRecordType,
        project_id: propertyResolution.projectId,
        project_legacy_code: propertyResolution.projectLegacyCode,
        project_record_type: propertyResolution.projectRecordType,
      },
      import: {
        channel: "crm_manual",
        imported_at: nowIso,
      },
    },
  };

  const { data: insertedLead, error: leadInsertError } = await client
    .schema("crm")
    .from("leads")
    .insert(leadInsertPayload)
    .select(LEAD_SELECT_COLUMNS)
    .single();

  if (leadInsertError || !insertedLead) {
    return jsonResponse(
      {
        ok: false,
        error: "db_lead_insert_error",
        details: leadInsertError?.message ?? "insert_lead_failed",
      },
      { status: 500 }
    );
  }

  let propertiesRaw: Record<string, unknown>[] = [];
  try {
    propertiesRaw = await readAllPages(async (from, to) => {
      const response = (await client
        .schema("crm")
        .from("properties")
        .select(PROPERTY_SELECT_COLUMNS)
        .eq("organization_id", organizationId)
        .range(from, to)) as unknown as QueryChunkResult;
      return response;
    });
  } catch {
    propertiesRaw = [];
  }

  const propertiesById = new Map<string, Record<string, unknown>>();
  propertiesRaw.forEach((row) => {
    const id = asUuid(row.id);
    if (!id) return;
    propertiesById.set(id, row);
  });

  const contactsById = new Map<string, Record<string, unknown>>();
  contactsById.set(contactId, contactRow);

  const createdRows = buildLeadRows(
    [insertedLead as unknown as Record<string, unknown>],
    contactsById,
    propertiesById
  );

  const row = createdRows[0] ?? null;
  const result = row ? { ...row } : null;
  if (result) delete (result as any).search_blob;

  return jsonResponse(
    {
      ok: true,
      data: result,
      meta: {
        storage: "supabase.crm.contacts + crm.leads",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
