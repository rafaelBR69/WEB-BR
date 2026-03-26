(() => {
  const apiBase = "/api/v1/crm/deals";
  const leadsApiBase = "/api/v1/crm/leads";
  const clientsApiBase = "/api/v1/clients";
  const propertiesApiBase = "/api/v1/properties";

  const state = {
    organizationId: "",
    contextProjectId: "",
    leads: [],
    clients: [],
    properties: [],
    selectedLead: null,
    selectedClient: null,
    selectedProperty: null,
  };

  const el = {
    form: document.getElementById("deal-create-form"),
    feedback: document.getElementById("deal-create-feedback"),
    context: document.getElementById("deal-create-context"),
    contextType: document.getElementById("deal-create-context-type"),
    leadField: document.getElementById("deal-create-lead-field"),
    leadSearch: document.getElementById("deal-create-lead-search"),
    leadId: document.getElementById("deal-create-lead-id"),
    leadList: document.getElementById("deal-create-lead-options"),
    clientField: document.getElementById("deal-create-client-field"),
    clientSearch: document.getElementById("deal-create-client-search"),
    clientId: document.getElementById("deal-create-client-id"),
    clientList: document.getElementById("deal-create-client-options"),
    propertySearch: document.getElementById("deal-create-property-search"),
    propertyId: document.getElementById("deal-create-property-id"),
    propertyList: document.getElementById("deal-create-property-options"),
    propertyHelper: document.getElementById("deal-create-property-helper"),
  };

  const toText = (value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  };

  const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const search = new URLSearchParams(window.location.search);

  const redirectToLogin = () => {
    const loginUrl = new URL("/crm/login/", window.location.origin);
    loginUrl.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
    window.location.href = `${loginUrl.pathname}${loginUrl.search}`;
  };

  const isCrmAuthError = (response, payload) => {
    const code = toText(payload?.error);
    return (
      response.status === 401 ||
      code === "auth_token_required" ||
      code === "refresh_token_required" ||
      code === "invalid_refresh_token" ||
      code === "crm_auth_required"
    );
  };

  const request = async (url, init) => {
    const response = await fetch(url, init);
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (isCrmAuthError(response, payload)) {
      redirectToLogin();
      throw new Error(toText(payload?.error) || `http_${response.status}`);
    }

    if (!response.ok || !payload?.ok) {
      const errorCode = payload?.error || `http_${response.status}`;
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 250) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }

    return payload;
  };

  const humanizeDealError = (error) => {
    const raw = error instanceof Error ? error.message : String(error ?? "unknown_error");
    if (raw.includes("lead_or_client_required")) {
      return "Debes seleccionar un lead o un cliente.";
    }
    if (raw.includes("invalid_deal_property_record_type")) {
      return "Solo puedes vincular una vivienda operativa al deal.";
    }
    if (raw.includes("property_archived_for_deal")) {
      return "La vivienda seleccionada esta archivada y no se puede usar.";
    }
    if (raw.includes("lead_not_found_for_deal")) {
      return "El lead seleccionado ya no existe o no pertenece a tu organizacion.";
    }
    if (raw.includes("client_not_found_for_deal")) {
      return "El cliente seleccionado ya no existe o no pertenece a tu organizacion.";
    }
    if (raw.includes("property_not_found_for_deal")) {
      return "La vivienda seleccionada ya no existe o no pertenece a tu organizacion.";
    }
    return raw;
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

  const orgId =
    toText(search.get("organization_id")) ||
    toText(localStorage.getItem("crm.organization_id")) ||
    toText(window.__crmDefaultOrganizationId) ||
    "";
  if (orgId) localStorage.setItem("crm.organization_id", orgId);
  state.organizationId = orgId;
  state.contextProjectId = toText(search.get("project_id")) || "";

  const leadLabel = (row) => {
    const name = toText(row?.full_name) || toText(row?.email) || toText(row?.phone) || "Lead";
    const meta = [
      toText(row?.status),
      toText(row?.project_label) || toText(row?.property_label),
      toText(row?.email),
      toText(row?.phone),
    ].filter(Boolean);
    return [name, meta.length ? meta.join(" | ") : null].filter(Boolean).join(" || ");
  };

  const clientLabel = (row) => {
    const name = toText(row?.full_name) || toText(row?.billing_name) || toText(row?.client_code) || "Cliente";
    const meta = [
      toText(row?.client_code),
      toText(row?.client_status),
      toText(row?.email),
      toText(row?.phone),
    ].filter(Boolean);
    return [name, meta.length ? meta.join(" | ") : null].filter(Boolean).join(" || ");
  };

  const propertyLabel = (row) => {
    const display =
      toText(row?.display_name) ||
      toText(row?.project_name) ||
      toText(row?.property_data?.display_name) ||
      toText(row?.legacy_code) ||
      toText(row?.id) ||
      "Propiedad";
    const project = toText(row?.project_label) || toText(row?.project_name);
    const meta = [
      toText(row?.legacy_code) !== display ? toText(row?.legacy_code) : null,
      toText(row?.record_type),
      toText(row?.status),
      project && project !== display ? project : null,
    ].filter(Boolean);
    return [display, meta.length ? meta.join(" | ") : null].filter(Boolean).join(" || ");
  };

  const propertyBelongsToProject = (row, projectId) => {
    if (!projectId) return true;
    const rowId = toText(row?.id);
    const parentId = toText(row?.parent_property_id);
    return rowId === projectId || parentId === projectId;
  };

  const activeDealPropertyRows = () =>
    state.properties.filter((row) => {
      const recordType = toText(row?.record_type);
      const status = toText(row?.status);
      if (recordType !== "unit" && recordType !== "single") return false;
      if (status === "archived") return false;
      return true;
    });

  const currentContextProjectId = () => {
    if (state.contextProjectId) return state.contextProjectId;
    const selectedPropertyParentId = toText(state.selectedProperty?.parent_property_id);
    if (selectedPropertyParentId) return selectedPropertyParentId;
    const selectedLeadProjectId = toText(state.selectedLead?.project_id);
    if (selectedLeadProjectId) return selectedLeadProjectId;
    return "";
  };

  const renderLeadOptions = () => {
    if (!(el.leadList instanceof HTMLDataListElement)) return;
    el.leadList.innerHTML = state.leads
      .filter((row) => toText(row?.id))
      .map((row) => `<option value="${esc(leadLabel(row))}"></option>`)
      .join("");
  };

  const renderClientOptions = () => {
    if (!(el.clientList instanceof HTMLDataListElement)) return;
    el.clientList.innerHTML = state.clients
      .filter((row) => toText(row?.id))
      .map((row) => `<option value="${esc(clientLabel(row))}"></option>`)
      .join("");
  };

  const renderPropertyOptions = () => {
    if (!(el.propertyList instanceof HTMLDataListElement)) return;
    const projectId = currentContextProjectId();
    const selectedPropertyId = toText(state.selectedProperty?.id);
    const rows = activeDealPropertyRows().filter((row) => propertyBelongsToProject(row, projectId));

    if (
      state.selectedProperty &&
      selectedPropertyId &&
      !rows.some((row) => toText(row?.id) === selectedPropertyId)
    ) {
      rows.push(state.selectedProperty);
    }

    rows.sort((left, right) => propertyLabel(left).localeCompare(propertyLabel(right), "es"));
    el.propertyList.innerHTML = rows
      .filter((row) => toText(row?.id))
      .map((row) => `<option value="${esc(propertyLabel(row))}"></option>`)
      .join("");

    if (el.propertyHelper instanceof HTMLElement) {
      el.propertyHelper.textContent = projectId
        ? "Selector acotado por la promocion del contexto activo."
        : "Sin restriccion de promocion activa.";
    }
  };

  const syncContextTypeVisibility = () => {
    const type = toText(el.contextType?.value) || "lead";
    if (el.leadField instanceof HTMLElement) el.leadField.hidden = type !== "lead";
    if (el.clientField instanceof HTMLElement) el.clientField.hidden = type !== "client";
  };

  const syncContextSummary = () => {
    if (!(el.context instanceof HTMLElement)) return;
    const parts = [];
    const type = toText(el.contextType?.value) || "lead";

    if (type === "lead") {
      parts.push(state.selectedLead ? `Lead: ${leadLabel(state.selectedLead)}` : "Lead: pendiente de seleccionar");
      if (toText(state.selectedLead?.converted_client_id)) {
        const convertedClient = state.clients.find(
          (row) => toText(row?.id) === toText(state.selectedLead?.converted_client_id)
        );
        parts.push(
          convertedClient
            ? `Cliente convertido: ${clientLabel(convertedClient)}`
            : "Cliente convertido vinculado en backend"
        );
      }
    } else {
      parts.push(state.selectedClient ? `Cliente: ${clientLabel(state.selectedClient)}` : "Cliente: pendiente de seleccionar");
    }

    parts.push(
      state.selectedProperty
        ? `Propiedad: ${propertyLabel(state.selectedProperty)}`
        : currentContextProjectId()
          ? "Propiedad: opcional dentro de la promocion filtrada"
          : "Propiedad: opcional"
    );

    el.context.textContent = parts.join(" | ");
  };

  const findLeadByInput = () => {
    const query = toText(el.leadSearch?.value);
    const match = state.leads.find((row) => leadLabel(row) === query) ?? null;
    state.selectedLead = match;
    if (el.leadId instanceof HTMLInputElement) el.leadId.value = toText(match?.id) || "";
    if (!toText(search.get("project_id"))) {
      state.contextProjectId = toText(match?.project_id) || "";
    }
    renderPropertyOptions();
    syncContextSummary();
    return match;
  };

  const findClientByInput = () => {
    const query = toText(el.clientSearch?.value);
    const match = state.clients.find((row) => clientLabel(row) === query) ?? null;
    state.selectedClient = match;
    if (el.clientId instanceof HTMLInputElement) el.clientId.value = toText(match?.id) || "";
    syncContextSummary();
    return match;
  };

  const findPropertyByInput = () => {
    const query = toText(el.propertySearch?.value);
    const match = state.properties.find((row) => propertyLabel(row) === query) ?? null;
    state.selectedProperty = match;
    if (el.propertyId instanceof HTMLInputElement) el.propertyId.value = toText(match?.id) || "";
    if (!query) state.selectedProperty = null;
    syncContextSummary();
    return match;
  };

  const ensureLeadLoaded = async (leadId) => {
    if (!leadId) return null;
    const existing = state.leads.find((row) => toText(row?.id) === leadId) ?? null;
    if (existing) return existing;
    const payload = await request(`${leadsApiBase}/${encodeURIComponent(leadId)}?organization_id=${encodeURIComponent(state.organizationId)}`);
    if (!payload?.data) return null;
    state.leads.unshift(payload.data);
    renderLeadOptions();
    return payload.data;
  };

  const ensureClientLoaded = async (clientId) => {
    if (!clientId) return null;
    const existing = state.clients.find((row) => toText(row?.id) === clientId) ?? null;
    if (existing) return existing;
    const payload = await request(`${clientsApiBase}/${encodeURIComponent(clientId)}?organization_id=${encodeURIComponent(state.organizationId)}`);
    if (!payload?.data) return null;
    state.clients.unshift(payload.data);
    renderClientOptions();
    return payload.data;
  };

  const ensurePropertyLoaded = async (propertyId) => {
    if (!propertyId) return null;
    const existing = state.properties.find((row) => toText(row?.id) === propertyId) ?? null;
    if (existing) return existing;
    const payload = await request(`${propertiesApiBase}/${encodeURIComponent(propertyId)}?organization_id=${encodeURIComponent(state.organizationId)}`);
    if (!payload?.data) return null;
    state.properties.unshift(payload.data);
    renderPropertyOptions();
    return payload.data;
  };

  const loadLeads = async () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    params.set("per_page", "250");
    const payload = await request(`${leadsApiBase}?${params.toString()}`);
    state.leads = Array.isArray(payload?.data) ? payload.data : [];
    renderLeadOptions();
  };

  const loadClients = async () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    params.set("per_page", "250");
    const payload = await request(`${clientsApiBase}?${params.toString()}`);
    state.clients = Array.isArray(payload?.data) ? payload.data : [];
    renderClientOptions();
  };

  const loadProperties = async () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    if (state.contextProjectId) params.set("project_id", state.contextProjectId);
    params.set("per_page", "300");
    const payload = await request(`${propertiesApiBase}?${params.toString()}`);
    state.properties = Array.isArray(payload?.data) ? payload.data : [];
    renderPropertyOptions();
  };

  const hydratePrefill = async () => {
    const leadId = toText(search.get("lead_id"));
    const clientId = toText(search.get("client_id"));
    const propertyId = toText(search.get("property_id"));
    const title = toText(search.get("title"));

    if (el.form instanceof HTMLFormElement && title) {
      const titleInput = el.form.elements.namedItem("title");
      if (titleInput instanceof HTMLInputElement) titleInput.value = title;
    }

    if (leadId && el.contextType instanceof HTMLSelectElement) {
      el.contextType.value = "lead";
    } else if (clientId && el.contextType instanceof HTMLSelectElement) {
      el.contextType.value = "client";
    }
    syncContextTypeVisibility();

    if (leadId) {
      const lead = await ensureLeadLoaded(leadId);
      state.selectedLead = lead;
      if (el.leadSearch instanceof HTMLInputElement) el.leadSearch.value = lead ? leadLabel(lead) : "";
      if (el.leadId instanceof HTMLInputElement) el.leadId.value = leadId;
      if (!state.contextProjectId) {
        state.contextProjectId = toText(lead?.project_id) || "";
      }
      const convertedClientId = toText(lead?.converted_client_id);
      if (convertedClientId) {
        await ensureClientLoaded(convertedClientId);
      }
    }

    if (clientId) {
      const client = await ensureClientLoaded(clientId);
      state.selectedClient = client;
      if (el.clientSearch instanceof HTMLInputElement) el.clientSearch.value = client ? clientLabel(client) : "";
      if (el.clientId instanceof HTMLInputElement) el.clientId.value = clientId;
    }

    if (propertyId) {
      const property = await ensurePropertyLoaded(propertyId);
      state.selectedProperty = property;
      if (el.propertySearch instanceof HTMLInputElement) {
        el.propertySearch.value = property ? propertyLabel(property) : "";
      }
      if (el.propertyId instanceof HTMLInputElement) el.propertyId.value = propertyId;
      if (!state.contextProjectId) {
        state.contextProjectId = toText(property?.parent_property_id) || "";
      }
    }

    renderPropertyOptions();
    syncContextSummary();
  };

  const validateSelectionState = () => {
    const type = toText(el.contextType?.value) || "lead";
    if (type === "lead") {
      if (!toText(el.leadId?.value)) {
        throw new Error("Selecciona un lead valido para crear el deal.");
      }
    } else if (!toText(el.clientId?.value)) {
      throw new Error("Selecciona un cliente valido para crear el deal.");
    }

    if (toText(el.propertySearch?.value) && !toText(el.propertyId?.value)) {
      throw new Error("Selecciona una propiedad valida de la lista.");
    }
  };

  el.contextType?.addEventListener("change", () => {
    const type = toText(el.contextType?.value) || "lead";
    if (type === "lead") {
      state.selectedClient = null;
      if (el.clientSearch instanceof HTMLInputElement) el.clientSearch.value = "";
      if (el.clientId instanceof HTMLInputElement) el.clientId.value = "";
    } else {
      state.selectedLead = null;
      if (el.leadSearch instanceof HTMLInputElement) el.leadSearch.value = "";
      if (el.leadId instanceof HTMLInputElement) el.leadId.value = "";
      if (!toText(search.get("project_id"))) {
        state.contextProjectId = "";
      }
    }
    syncContextTypeVisibility();
    renderPropertyOptions();
    syncContextSummary();
  });

  el.leadSearch?.addEventListener("input", () => {
    findLeadByInput();
  });

  el.leadSearch?.addEventListener("change", () => {
    findLeadByInput();
  });

  el.clientSearch?.addEventListener("input", () => {
    findClientByInput();
  });

  el.clientSearch?.addEventListener("change", () => {
    findClientByInput();
  });

  el.propertySearch?.addEventListener("input", () => {
    findPropertyByInput();
  });

  el.propertySearch?.addEventListener("change", () => {
    findPropertyByInput();
  });

  el.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(el.form instanceof HTMLFormElement)) return;

    try {
      validateSelectionState();
    } catch (error) {
      setFeedback(humanizeDealError(error), "error");
      return;
    }

    const formData = new FormData(el.form);
    const type = toText(el.contextType?.value) || "lead";
    const body = {
      organization_id: state.organizationId || null,
      lead_id: type === "lead" ? toText(formData.get("lead_id")) : null,
      client_id: type === "client" ? toText(formData.get("client_id")) : null,
      property_id: toText(formData.get("property_id")),
      title: toText(formData.get("title")),
      stage: toText(formData.get("stage")),
      expected_close_date: toText(formData.get("expected_close_date")),
      expected_value: toNumber(formData.get("expected_value")),
      probability: toNumber(formData.get("probability")),
    };

    try {
      const payload = await request(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const dealId = toText(payload?.data?.id);
      setFeedback(
        payload?.meta?.created === false
          ? "Deal abierto existente localizado. Redirigiendo..."
          : "Nuevo deal creado. Redirigiendo...",
        "ok"
      );
      if (dealId) {
        setTimeout(() => {
          const params = new URLSearchParams();
          if (state.organizationId) params.set("organization_id", state.organizationId);
          window.location.href = `/crm/deals/${encodeURIComponent(dealId)}/${params.toString() ? `?${params.toString()}` : ""}`;
        }, 700);
      }
    } catch (error) {
      setFeedback(`Error creando deal: ${humanizeDealError(error)}`, "error");
    }
  });

  syncContextTypeVisibility();

  void (async () => {
    try {
      await Promise.all([loadLeads(), loadClients(), loadProperties()]);
      await hydratePrefill();
      syncContextSummary();
      setFeedback("Formulario listo para crear deals.", "ok");
    } catch (error) {
      setFeedback(`Error inicializando la pantalla: ${humanizeDealError(error)}`, "error");
    }
  })();
})();
