import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { getSupabaseServerClient } from "@shared/supabase/server";
import { asObject, asText, asUuid } from "@shared/portal/domain";
import { CONTACT_SELECT_COLUMNS, LEAD_SELECT_COLUMNS, normalizeLeadKind } from "@shared/leads/domain";

const buildClientCode = () => `CLI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const readLeadRow = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  leadId: string,
  organizationId: string
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

const createOrReuseClientFromLead = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  lead: Record<string, unknown>,
  organizationId: string
) => {
  const convertedClientId = asUuid(lead.converted_client_id);
  if (convertedClientId) return convertedClientId;

  const contactId = asUuid(lead.contact_id);
  if (!contactId) {
    throw new Error("lead_contact_required_for_conversion");
  }

  const { data: existingClient, error: existingClientError } = await client
    .schema("crm")
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .limit(1)
    .maybeSingle();

  if (existingClientError) {
    throw new Error(`db_client_lookup_error:${existingClientError.message}`);
  }

  const existingClientId = asUuid(existingClient?.id);
  if (existingClientId) {
    const { error: updateLeadError } = await client
      .schema("crm")
      .from("leads")
      .update({
        status: "converted",
        converted_client_id: existingClientId,
        converted_at: new Date().toISOString(),
      })
      .eq("id", asUuid(lead.id))
      .eq("organization_id", organizationId);

    if (updateLeadError) {
      throw new Error(`db_lead_update_error:${updateLeadError.message}`);
    }

    return existingClientId;
  }

  const { data: contact, error: contactError } = await client
    .schema("crm")
    .from("contacts")
    .select(CONTACT_SELECT_COLUMNS)
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (contactError) {
    throw new Error(`db_contact_read_error:${contactError.message}`);
  }

  const rawPayload = asObject(lead.raw_payload);
  const mappedPayload = asObject(rawPayload.mapped);
  const leadMessage = asText(mappedPayload.message);
  const intakeDate = new Date().toISOString().slice(0, 10);
  const entryChannel = asText(lead.origin_type) ?? "other";

  const clientPayload = {
    organization_id: organizationId,
    contact_id: contactId,
    client_code: buildClientCode(),
    client_type: "individual",
    client_status: "active",
    billing_name: asText(contact?.full_name) ?? "Lead Convertido",
    tax_id: null,
    profile_data: {
      intake_date: intakeDate,
      entry_channel: entryChannel,
      comments: leadMessage ? `Convertido desde lead: ${leadMessage}` : "Convertido desde lead CRM.",
    },
  };

  const { data: newClient, error: clientError } = await client
    .schema("crm")
    .from("clients")
    .insert(clientPayload)
    .select("id")
    .single();

  if (clientError || !newClient) {
    throw new Error(`db_client_create_error:${clientError?.message ?? "insert_client_failed"}`);
  }

  const newClientId = asUuid(newClient.id);
  if (!newClientId) throw new Error("created_client_id_missing");

  const { error: updateLeadError } = await client
    .schema("crm")
    .from("leads")
    .update({
      status: "converted",
      converted_client_id: newClientId,
      converted_at: new Date().toISOString(),
    })
    .eq("id", asUuid(lead.id))
    .eq("organization_id", organizationId);

  if (updateLeadError) {
    throw new Error(`db_lead_update_error:${updateLeadError.message}`);
  }

  const { error: updateContactError } = await client
    .schema("crm")
    .from("contacts")
    .update({ contact_type: "client" })
    .eq("id", contactId)
    .eq("organization_id", organizationId);

  if (updateContactError) {
    throw new Error(`db_contact_update_error:${updateContactError.message}`);
  }

  return newClientId;
};

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const leadId = asUuid(params.id);
  const body = (await parseJsonBody<Record<string, unknown>>(request)) ?? {};
  const organizationIdHint = asText(body.organization_id);

  if (!leadId) {
    return jsonResponse({ ok: false, error: "invalid_lead_id" }, { status: 400 });
  }

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.leads.write", "crm.clients.write"],
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
    const lead = await readLeadRow(client, leadId, organizationId);
    if (!lead) {
      return jsonResponse({ ok: false, error: "lead_not_found" }, { status: 404 });
    }

    const leadKind = normalizeLeadKind(asText(lead.lead_kind), "buyer");

    if (leadKind === "agency") {
      const alreadyAgencyId = asUuid(lead.converted_agency_id);
      const alreadyClientId = asUuid(lead.converted_client_id);
      if (alreadyAgencyId && alreadyClientId) {
        return jsonResponse({
          ok: true,
          data: {
            id: alreadyClientId,
            client_id: alreadyClientId,
            agency_id: alreadyAgencyId,
            entity_type: "agency",
            redirect_client_id: alreadyClientId,
          },
        });
      }

      const { data: rpcResult, error: rpcError } = await client
        .schema("crm")
        .rpc("convert_lead_to_agency", { p_lead_id: leadId, p_agency_code: null });

      if (rpcError) {
        throw new Error(`db_agency_convert_error:${rpcError.message}`);
      }

      const agencyId = asUuid(rpcResult);
      if (!agencyId) throw new Error("agency_conversion_missing_id");

      const { data: agencyRow, error: agencyReadError } = await client
        .schema("crm")
        .from("agencies")
        .select("id, client_id")
        .eq("organization_id", organizationId)
        .eq("id", agencyId)
        .maybeSingle();

      if (agencyReadError) {
        throw new Error(`db_agency_read_error:${agencyReadError.message}`);
      }

      const clientId = asUuid(agencyRow?.client_id);
      if (!clientId) throw new Error("agency_conversion_missing_client_id");

      return jsonResponse({
        ok: true,
        data: {
          id: clientId,
          client_id: clientId,
          agency_id: agencyId,
          entity_type: "agency",
          redirect_client_id: clientId,
        },
      });
    }

    const clientId = await createOrReuseClientFromLead(client, lead, organizationId);
    return jsonResponse({
      ok: true,
      data: {
        id: clientId,
        client_id: clientId,
        entity_type: "client",
        redirect_client_id: clientId,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "lead_conversion_failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
