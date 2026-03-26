import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { hydrateDealRows, readDealsByLeadId } from "@shared/deals/crud";
import {
  LEAD_SELECT_COLUMNS,
  CONTACT_SELECT_COLUMNS,
  PROPERTY_SELECT_COLUMNS,
  buildLeadRows,
  normalizeLeadKind,
  normalizeLeadOriginType,
  normalizeLeadStatus,
  normalizeOperationInterest,
  normalizeEmail,
  normalizeNationality,
  normalizePhone,
  parseLeadStatus,
  resolveLeadPropertyContext,
} from "@shared/leads/domain";
import { buildNotificationEntitySummary, readNotificationRows } from "@shared/notifications/sync";
import { asNumber, asText, asUuid } from "@shared/portal/domain";
import { getSupabaseServerClient } from "@shared/supabase/server";

const asObjectRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const hasOwn = (value: unknown, key: string) =>
  Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return null;
};

const collectStringLeaves = (
  value: unknown,
  prefix = "",
  out: Array<{ path: string; value: string }> = []
) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringLeaves(item, prefix ? `${prefix}[${index}]` : `[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== "object") {
    const text = asText(value);
    if (text) out.push({ path: prefix, value: text });
    return out;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    collectStringLeaves(nested, nextPrefix, out);
  });
  return out;
};

const findRawPayloadValue = (rawPayload: Record<string, unknown>, patterns: RegExp[]) => {
  const leaves = collectStringLeaves(rawPayload);
  for (const leaf of leaves) {
    if (patterns.some((pattern) => pattern.test(leaf.path))) {
      return leaf.value;
    }
  }
  return null;
};

const loadAgencySource = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  leadRow: Record<string, unknown>
) => {
  const rawPayload = asObjectRecord(leadRow.raw_payload);
  const mappedPayload = asObjectRecord(rawPayload.mapped);
  const leadAgencyId = asUuid(leadRow.agency_id);
  const rawAgencyName = firstText(
    mappedPayload.agency_name,
    mappedPayload.agency,
    findRawPayloadValue(rawPayload, [/agency_name/i, /nombre agencia/i, /(^|\.)(agencia)($|\.)/i])
  );
  const rawAgencyAgentName = firstText(
    mappedPayload.agency_contact_name,
    mappedPayload.agent_name,
    findRawPayloadValue(rawPayload, [/agente agencia/i, /agency agent/i, /agency_contact/i, /contacto_agencia/i])
  );

  if (leadAgencyId) {
    const { data: agencyRow } = await client
      .schema("crm")
      .from("agencies")
      .select("id, client_id, agency_code, agency_status, agency_scope, notes")
      .eq("id", leadAgencyId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    const agencyClientId = asUuid((agencyRow as Record<string, unknown> | null)?.client_id);
    const { data: agencyClient } = agencyClientId
      ? await client
          .schema("crm")
          .from("clients")
          .select("id, client_code, client_status, billing_name, profile_data, contact_id")
          .eq("id", agencyClientId)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : { data: null };

    const agencyBaseContactId = asUuid((agencyClient as Record<string, unknown> | null)?.contact_id);
    const { data: agencyBaseContact } = agencyBaseContactId
      ? await client
          .schema("crm")
          .from("contacts")
          .select("id, full_name, email, phone")
          .eq("id", agencyBaseContactId)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : { data: null };

    const { data: agencyContactRows } = await client
      .schema("crm")
      .from("agency_contacts")
      .select("id, contact_id, role, relation_status, is_primary")
      .eq("agency_id", leadAgencyId)
      .eq("organization_id", organizationId);

    const primaryAgencyContactRow =
      (agencyContactRows ?? []).find((row) => row.relation_status === "active" && row.is_primary) ??
      (agencyContactRows ?? []).find((row) => row.relation_status === "active") ??
      null;
    const primaryAgencyContactId = asUuid(primaryAgencyContactRow?.contact_id);
    const { data: primaryAgencyContact } = primaryAgencyContactId
      ? await client
          .schema("crm")
          .from("contacts")
          .select("id, full_name, email, phone")
          .eq("id", primaryAgencyContactId)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : { data: null };

    const agencyProfile = asObjectRecord((agencyClient as Record<string, unknown> | null)?.profile_data);
    return {
      linked: true,
      agency_id: leadAgencyId,
      agency_name: firstText(
        (agencyClient as Record<string, unknown> | null)?.billing_name,
        agencyProfile.agency_name,
        rawAgencyName
      ),
      agency_code: asText((agencyRow as Record<string, unknown> | null)?.agency_code),
      agency_status: asText((agencyRow as Record<string, unknown> | null)?.agency_status),
      agency_scope: asText((agencyRow as Record<string, unknown> | null)?.agency_scope),
      client_id: agencyClientId,
      client_code: asText((agencyClient as Record<string, unknown> | null)?.client_code),
      primary_contact_name: firstText(
        (primaryAgencyContact as Record<string, unknown> | null)?.full_name,
        (agencyBaseContact as Record<string, unknown> | null)?.full_name,
        rawAgencyAgentName
      ),
      email: firstText(
        (primaryAgencyContact as Record<string, unknown> | null)?.email,
        (agencyBaseContact as Record<string, unknown> | null)?.email
      ),
      phone: firstText(
        (primaryAgencyContact as Record<string, unknown> | null)?.phone,
        (agencyBaseContact as Record<string, unknown> | null)?.phone
      ),
      notes: asText((agencyRow as Record<string, unknown> | null)?.notes),
      raw_agency_name: rawAgencyName,
      raw_agency_agent_name: rawAgencyAgentName,
    };
  }

  if (rawAgencyName || rawAgencyAgentName || asText(leadRow.origin_type) === "agency") {
    return {
      linked: false,
      agency_id: null,
      agency_name: rawAgencyName,
      agency_code: null,
      agency_status: null,
      agency_scope: null,
      client_id: null,
      client_code: null,
      primary_contact_name: rawAgencyAgentName,
      email: null,
      phone: null,
      notes: null,
      raw_agency_name: rawAgencyName,
      raw_agency_agent_name: rawAgencyAgentName,
    };
  }

  return null;
};

const readLeadPropertyMap = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  propertyId: string | null
) => {
  const propertiesById = new Map<string, Record<string, unknown>>();
  if (!propertyId) return propertiesById;

  const { data: property } = await client
    .schema("crm")
    .from("properties")
    .select(PROPERTY_SELECT_COLUMNS)
    .eq("id", propertyId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const propertyRow = (property as Record<string, unknown> | null) ?? null;
  if (!propertyRow) return propertiesById;

  const normalizedPropertyId = asUuid(propertyRow.id);
  if (normalizedPropertyId) propertiesById.set(normalizedPropertyId, propertyRow);

  const parentPropertyId = asUuid(propertyRow.parent_property_id);
  if (!parentPropertyId) return propertiesById;

  const { data: parentProperty } = await client
    .schema("crm")
    .from("properties")
    .select(PROPERTY_SELECT_COLUMNS)
    .eq("id", parentPropertyId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const parentRow = (parentProperty as Record<string, unknown> | null) ?? null;
  if (parentRow) propertiesById.set(parentPropertyId, parentRow);
  return propertiesById;
};

const buildLeadDetailData = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  leadRow: Record<string, unknown>
) => {
  const contactId = asUuid(leadRow.contact_id);
  const { data: contact } = contactId
    ? await client
        .schema("crm")
        .from("contacts")
        .select(CONTACT_SELECT_COLUMNS)
        .eq("id", contactId)
        .eq("organization_id", organizationId)
        .maybeSingle()
    : { data: null };

  const contactsById = new Map<string, Record<string, unknown>>();
  if (contactId && contact) contactsById.set(contactId, contact as Record<string, unknown>);

  const propertiesById = await readLeadPropertyMap(client, organizationId, asUuid(leadRow.property_id));
  const rows = buildLeadRows([leadRow], contactsById, propertiesById);
  const result = rows[0] ? { ...rows[0] } : null;

  if (result) delete (result as Record<string, unknown>).search_blob;
  if (!result) return null;

  (result as Record<string, unknown>).agency_source = await loadAgencySource(client, organizationId, leadRow);

  const leadId = asUuid(leadRow.id);
  if (leadId) {
    const dealRows = await readDealsByLeadId(client, organizationId, leadId);
    const deals = await hydrateDealRows(client, organizationId, dealRows);
    (result as Record<string, unknown>).deals_summary = {
      total: deals.length,
      open_total: deals.filter((entry) => entry.is_terminal !== true).length,
      closed_total: deals.filter((entry) => entry.is_terminal === true).length,
      open_deal: deals.find((entry) => entry.is_terminal !== true) ?? null,
      recent: deals.slice(0, 5),
    };
    try {
      const notificationRows = await readNotificationRows(client, organizationId, {
        includeClosed: true,
        leadId,
      });
      (result as Record<string, unknown>).notifications_summary = buildNotificationEntitySummary(notificationRows);
    } catch {
      (result as Record<string, unknown>).notifications_summary = buildNotificationEntitySummary([]);
    }
  }

  return result;
};

const readLeadRow = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  leadId: string
) => {
  const { data, error } = await client
    .schema("crm")
    .from("leads")
    .select(LEAD_SELECT_COLUMNS)
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`db_lead_read_error:${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
};

export const GET: APIRoute = async ({ params, url }) => {
  const leadId = asUuid(params.id);
  const organizationId = asText(url.searchParams.get("organization_id"));

  if (!leadId || !organizationId) {
    return jsonResponse({ ok: false, error: "invalid_params" }, { status: 400 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const lead = await readLeadRow(client, organizationId, leadId);
    if (!lead) {
      return jsonResponse({ ok: false, error: "lead_not_found" }, { status: 404 });
    }
    const result = await buildLeadDetailData(client, organizationId, lead);
    return jsonResponse({ ok: true, data: result });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "lead_detail_read_failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const leadId = asUuid(params.id);
  const body = await parseJsonBody<Record<string, unknown>>(request);
  const organizationId = asText(body?.organization_id);

  if (!leadId || !organizationId) {
    return jsonResponse({ ok: false, error: "invalid_params" }, { status: 400 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const currentLead = await readLeadRow(client, organizationId, leadId);
    if (!currentLead) {
      return jsonResponse({ ok: false, error: "lead_not_found" }, { status: 404 });
    }

    const currentRawPayload = asObjectRecord(currentLead.raw_payload);
    const currentMappedPayload = asObjectRecord(currentRawPayload.mapped);
    const currentProjectPayload = asObjectRecord(currentRawPayload.project);

    const contactId = asUuid(currentLead.contact_id);
    const { data: currentContact } = contactId
      ? await client
          .schema("crm")
          .from("contacts")
          .select(CONTACT_SELECT_COLUMNS)
          .eq("id", contactId)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : { data: null };

    const parsedStatus = hasOwn(body, "status") ? parseLeadStatus(body.status) : null;
    if (hasOwn(body, "status") && !parsedStatus) {
      return jsonResponse({ ok: false, error: "invalid_status" }, { status: 422 });
    }

    const nextStatus = parsedStatus ?? normalizeLeadStatus(asText(currentLead.status), "new");
    const nextLeadKind = hasOwn(body, "lead_kind")
      ? normalizeLeadKind(asText(body.lead_kind), "buyer")
      : normalizeLeadKind(asText(currentLead.lead_kind), "buyer");
    const nextOriginType = hasOwn(body, "origin_type")
      ? normalizeLeadOriginType(asText(body.origin_type), "other")
      : normalizeLeadOriginType(asText(currentLead.origin_type), "other");
    const nextOperationInterest = hasOwn(body, "operation_interest")
      ? normalizeOperationInterest(asText(body.operation_interest), "sale")
      : normalizeOperationInterest(asText(currentLead.operation_interest), "sale");
    const nextPriority = hasOwn(body, "priority") ? asNumber(body.priority) ?? 3 : asNumber(currentLead.priority) ?? 3;
    const nextBudgetMin = hasOwn(body, "budget_min") ? asNumber(body.budget_min) : asNumber(currentLead.budget_min);
    const nextBudgetMax = hasOwn(body, "budget_max") ? asNumber(body.budget_max) : asNumber(currentLead.budget_max);
    const nextSource = hasOwn(body, "source")
      ? asText(body.source)
      : asText(currentLead.source) ?? asText(currentMappedPayload.source) ?? "crm_manual";
    const nextMessage = hasOwn(body, "message")
      ? asText(body.message)
      : asText(currentMappedPayload.message);

    const nextFullName = hasOwn(body, "full_name")
      ? asText(body.full_name)
      : firstText((currentContact as Record<string, unknown> | null)?.full_name, currentMappedPayload.full_name);
    const nextEmail = hasOwn(body, "email")
      ? normalizeEmail(body.email)
      : normalizeEmail((currentContact as Record<string, unknown> | null)?.email) ?? normalizeEmail(currentMappedPayload.email);
    const nextPhone = hasOwn(body, "phone")
      ? normalizePhone(body.phone)
      : normalizePhone((currentContact as Record<string, unknown> | null)?.phone) ?? normalizePhone(currentMappedPayload.phone);
    const nextNationality = hasOwn(body, "nationality")
      ? normalizeNationality(body.nationality)
      : normalizeNationality((currentContact as Record<string, unknown> | null)?.country_code ?? currentMappedPayload.nationality);

    if (!nextFullName) {
      return jsonResponse({ ok: false, error: "full_name_required" }, { status: 422 });
    }
    if (!nextEmail && !nextPhone) {
      return jsonResponse({ ok: false, error: "email_or_phone_required" }, { status: 422 });
    }

    const rawAgencyContactId = asUuid(currentMappedPayload.agency_contact_id);
    const nextAgencyIdInput = hasOwn(body, "agency_id") ? asUuid(body.agency_id) : asUuid(currentLead.agency_id);
    const nextAgencyContactIdInput = hasOwn(body, "agency_contact_id") ? asUuid(body.agency_contact_id) : rawAgencyContactId;

    if (hasOwn(body, "agency_id") && body.agency_id != null && body.agency_id !== "" && !nextAgencyIdInput) {
      return jsonResponse({ ok: false, error: "invalid_agency_id" }, { status: 422 });
    }
    if (
      hasOwn(body, "agency_contact_id") &&
      body.agency_contact_id != null &&
      body.agency_contact_id !== "" &&
      !nextAgencyContactIdInput
    ) {
      return jsonResponse({ ok: false, error: "invalid_agency_contact_id" }, { status: 422 });
    }

    const persistedAgencyId = nextOriginType === "agency" ? nextAgencyIdInput : null;
    const persistedAgencyContactId = nextOriginType === "agency" ? nextAgencyContactIdInput : null;

    if (nextOriginType === "agency" && !persistedAgencyId) {
      return jsonResponse({ ok: false, error: "agency_id_required_for_agency_origin" }, { status: 422 });
    }
    if (persistedAgencyContactId && !persistedAgencyId) {
      return jsonResponse({ ok: false, error: "agency_id_required_for_agency_contact" }, { status: 422 });
    }

    if (persistedAgencyId) {
      const { data: agencyRow, error: agencyError } = await client
        .schema("crm")
        .from("agencies")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("id", persistedAgencyId)
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

    let agencyContactInfo: Record<string, unknown> | null = null;
    if (persistedAgencyContactId) {
      const { data: relationRow, error: relationError } = await client
        .schema("crm")
        .from("agency_contacts")
        .select("id, agency_id, contact_id, role, relation_status")
        .eq("organization_id", organizationId)
        .eq("id", persistedAgencyContactId)
        .maybeSingle();

      if (relationError) {
        return jsonResponse(
          {
            ok: false,
            error: "db_agency_contact_lookup_error",
            details: relationError.message,
          },
          { status: 500 }
        );
      }

      if (!relationRow) {
        return jsonResponse({ ok: false, error: "agency_contact_not_found" }, { status: 422 });
      }

      if (asUuid(relationRow.agency_id) !== persistedAgencyId) {
        return jsonResponse({ ok: false, error: "agency_contact_not_belongs_to_agency" }, { status: 422 });
      }

      const agencyContactPersonId = asUuid(relationRow.contact_id);
      if (agencyContactPersonId) {
        const { data: agencyContactRow } = await client
          .schema("crm")
          .from("contacts")
          .select("id, full_name, email, phone")
          .eq("organization_id", organizationId)
          .eq("id", agencyContactPersonId)
          .maybeSingle();
        agencyContactInfo = (agencyContactRow as Record<string, unknown> | null) ?? null;
      }
    }

    const propertyContextChanged =
      hasOwn(body, "property_id") || hasOwn(body, "project_id") || hasOwn(body, "property_legacy_code");
    const propertyIdInput = hasOwn(body, "property_id") ? asUuid(body.property_id) : null;
    const projectIdInput = hasOwn(body, "project_id") ? asUuid(body.project_id) : null;
    const propertyLegacyCodeInput = hasOwn(body, "property_legacy_code") ? asText(body.property_legacy_code) : null;

    if (hasOwn(body, "property_id") && body.property_id != null && body.property_id !== "" && !propertyIdInput) {
      return jsonResponse({ ok: false, error: "invalid_property_id" }, { status: 422 });
    }
    if (hasOwn(body, "project_id") && body.project_id != null && body.project_id !== "" && !projectIdInput) {
      return jsonResponse({ ok: false, error: "invalid_project_id" }, { status: 422 });
    }

    const currentProjectId = asUuid(firstText(currentMappedPayload.project_id, currentProjectPayload.project_id));
    const currentPropertyLegacyCode = firstText(
      currentMappedPayload.property_legacy_code,
      currentProjectPayload.property_legacy_code
    );

    const nextPropertyContext =
      propertyContextChanged ||
      asUuid(currentLead.property_id) ||
      currentProjectId ||
      currentPropertyLegacyCode
        ? await resolveLeadPropertyContext(client, organizationId, {
            propertyId: propertyContextChanged ? propertyIdInput : asUuid(currentLead.property_id),
            projectId: propertyContextChanged ? projectIdInput : asUuid(currentLead.property_id) ? null : currentProjectId,
            propertyLegacyCode: propertyContextChanged ? propertyLegacyCodeInput : currentPropertyLegacyCode,
          })
        : {
            propertyId: null,
            propertyLegacyCode: null,
            propertyRecordType: null,
            projectId: null,
            projectLegacyCode: null,
            projectRecordType: null,
            error: null,
          };

    if (nextPropertyContext.error) {
      return jsonResponse({ ok: false, error: nextPropertyContext.error }, { status: 422 });
    }

    const nextDiscardedReasonInput = hasOwn(body, "discarded_reason")
      ? asText(body.discarded_reason)
      : asText(currentLead.discarded_reason);
    const isDisposedStatus = nextStatus === "discarded" || nextStatus === "junk";
    if (nextStatus === "discarded" && !nextDiscardedReasonInput) {
      return jsonResponse({ ok: false, error: "discarded_reason_required" }, { status: 422 });
    }

    const nextDiscardedAt = isDisposedStatus
      ? asText(currentLead.discarded_at) ?? new Date().toISOString()
      : null;

    const nextRawPayload: Record<string, unknown> = {
      ...currentRawPayload,
      mapped: {
        ...currentMappedPayload,
        full_name: nextFullName,
        email: nextEmail,
        phone: nextPhone,
        nationality: nextNationality,
        property_id: nextPropertyContext.propertyId,
        property_legacy_code: nextPropertyContext.propertyLegacyCode,
        project_id: nextPropertyContext.projectId,
        project_legacy_code: nextPropertyContext.projectLegacyCode,
        agency_id: persistedAgencyId,
        agency_contact_id: persistedAgencyContactId,
        agency_contact_name: asText(agencyContactInfo?.full_name),
        agency_contact_email: asText(agencyContactInfo?.email),
        agency_contact_phone: asText(agencyContactInfo?.phone),
        source: nextSource,
        message: nextMessage,
        origin_type: nextOriginType,
        lead_kind: nextLeadKind,
        operation_interest: nextOperationInterest,
      },
      project: {
        ...currentProjectPayload,
        property_id: nextPropertyContext.propertyId,
        property_legacy_code: nextPropertyContext.propertyLegacyCode,
        property_record_type: nextPropertyContext.propertyRecordType,
        project_id: nextPropertyContext.projectId,
        project_legacy_code: nextPropertyContext.projectLegacyCode,
        project_record_type: nextPropertyContext.projectRecordType,
      },
    };

    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      lead_kind: nextLeadKind,
      origin_type: nextOriginType,
      source: nextSource,
      property_id: nextPropertyContext.propertyId,
      agency_id: persistedAgencyId,
      operation_interest: nextOperationInterest,
      priority: nextPriority,
      budget_min: nextBudgetMin,
      budget_max: nextBudgetMax,
      discarded_reason: isDisposedStatus ? nextDiscardedReasonInput : null,
      discarded_at: nextDiscardedAt,
      raw_payload: nextRawPayload,
    };

    const { data: updatedLead, error: updateError } = await client
      .schema("crm")
      .from("leads")
      .update(updatePayload)
      .eq("id", leadId)
      .eq("organization_id", organizationId)
      .select(LEAD_SELECT_COLUMNS)
      .single();

    if (updateError || !updatedLead) {
      return jsonResponse(
        {
          ok: false,
          error: "db_update_error",
          details: updateError?.message ?? "update_lead_failed",
        },
        { status: 500 }
      );
    }

    if (contactId) {
      const { error: contactUpdateError } = await client
        .schema("crm")
        .from("contacts")
        .update({
          full_name: nextFullName,
          email: nextEmail,
          phone: nextPhone,
          country_code: nextNationality,
        })
        .eq("id", contactId)
        .eq("organization_id", organizationId);

      if (contactUpdateError) {
        return jsonResponse(
          {
            ok: false,
            error: "db_contact_update_error",
            details: contactUpdateError.message,
          },
          { status: 500 }
        );
      }
    }

    const result = await buildLeadDetailData(client, organizationId, updatedLead as Record<string, unknown>);
    return jsonResponse({ ok: true, data: result });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "lead_update_failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const DELETE: APIRoute = async ({ params, url }) => {
  const leadId = asUuid(params.id);
  const organizationId = asText(url.searchParams.get("organization_id"));

  if (!leadId || !organizationId) {
    return jsonResponse({ ok: false, error: "invalid_params" }, { status: 400 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { error: deleteError } = await client
    .schema("crm")
    .from("leads")
    .delete()
    .eq("id", leadId)
    .eq("organization_id", organizationId);

  if (deleteError) {
    return jsonResponse({ ok: false, error: "db_delete_error", details: deleteError.message }, { status: 500 });
  }

  return jsonResponse({ ok: true });
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH", "DELETE"]);
