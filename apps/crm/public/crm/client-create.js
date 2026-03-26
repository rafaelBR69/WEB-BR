(() => {
  const apiBase = "/api/v1/clients";
  const detailNoticeStorageKey = "crm.clients.detail.notice";

  const state = {
    organizationId: "",
    properties: [],
  };

  const el = {
    form: document.getElementById("client-create-form"),
    propertySelect: document.getElementById("client-create-property-id"),
    feedback: document.getElementById("client-create-feedback"),
    providerToggle: document.getElementById("client-create-as-provider"),
    agencyToggle: document.getElementById("client-create-as-agency"),
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
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 220) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
  };

  const humanizeError = (error) => {
    const raw = error instanceof Error ? error.message : String(error ?? "unknown_error");
    if (raw.includes("organization_id_required")) {
      return "No hay organization_id activa para crear el cliente.";
    }
    if (raw.includes("full_name_required")) {
      return "El nombre completo es obligatorio.";
    }
    if (raw.includes("invalid_property_record_type")) {
      return "Solo puedes asignar viviendas unit/single.";
    }
    if (raw.includes("Only 2 active buyers")) {
      return "La vivienda ya tiene dos compradores activos.";
    }
    if (raw.includes("Only 1 active primary buyer")) {
      return "La vivienda ya tiene un titular principal activo.";
    }
    if (raw.includes("invalid_property_assignment")) {
      return "La vivienda elegida no cumple las reglas de asignacion.";
    }
    if (raw.includes("clients_create_requires_supabase")) {
      return "La alta real de clientes requiere Supabase activo.";
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

  const writeDetailNotice = (clientId, message, kind = "ok") => {
    try {
      window.sessionStorage.setItem(
        detailNoticeStorageKey,
        JSON.stringify({ clientId, message, kind })
      );
    } catch {
      // no-op
    }
  };

  const propertyLabel = (row) => {
    const display =
      toText(row?.display_name) ||
      toText(row?.project_name) ||
      toText(row?.legacy_code) ||
      toText(row?.id) ||
      "Propiedad";
    const code = toText(row?.legacy_code);
    const status = toText(row?.status);
    const recordType = toText(row?.record_type);
    const parts = [display];
    if (code && code !== display) parts.push(code);
    if (recordType) parts.push(recordType);
    if (status) parts.push(status);
    return parts.join(" | ");
  };

  const syncRoleFields = () => {
    const providerEnabled = el.providerToggle instanceof HTMLInputElement ? el.providerToggle.checked : false;
    const agencyEnabled = el.agencyToggle instanceof HTMLInputElement ? el.agencyToggle.checked : false;

    document.querySelectorAll("[data-role-field='provider']").forEach((field) => {
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        field.disabled = !providerEnabled;
      }
    });

    document.querySelectorAll("[data-role-field='agency']").forEach((field) => {
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        field.disabled = !agencyEnabled;
      }
    });
  };

  const renderPropertyOptions = () => {
    if (!(el.propertySelect instanceof HTMLSelectElement)) return;
    const options = [
      '<option value="">Sin asignar</option>',
      ...state.properties
        .filter((row) => toText(row?.id))
        .map((row) => `<option value="${esc(row.id)}">${esc(propertyLabel(row))}</option>`),
    ];
    el.propertySelect.innerHTML = options.join("");
  };

  const loadProperties = async () => {
    if (!(el.propertySelect instanceof HTMLSelectElement)) return;
    if (!state.organizationId) {
      state.properties = [];
      renderPropertyOptions();
      return;
    }

    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("per_page", "250");
    const payload = await request(`/api/v1/properties?${params.toString()}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    state.properties = rows
      .filter(
        (row) =>
          row &&
          (row.record_type === "unit" || row.record_type === "single") &&
          toText(row.status) !== "archived"
      )
      .sort((left, right) => propertyLabel(left).localeCompare(propertyLabel(right), "es"));
    renderPropertyOptions();
  };

  const redirectToDetail = (clientId) => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    window.location.href = `/crm/clients/${encodeURIComponent(clientId)}/${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const createPayloadFromForm = () => {
    if (!(el.form instanceof HTMLFormElement)) return null;
    const formData = new FormData(el.form);
    return {
      organization_id: state.organizationId || null,
      full_name: toText(formData.get("full_name")),
      email: toText(formData.get("email")),
      phone: toText(formData.get("phone")),
      nationality: toText(formData.get("nationality")),
      intake_date: toText(formData.get("intake_date")),
      client_type: toText(formData.get("client_type")) || "individual",
      entry_channel: toText(formData.get("entry_channel")) || "other",
      client_status: toText(formData.get("client_status")) || "active",
      agency_name: toText(formData.get("agency_name")),
      agent_name: toText(formData.get("agent_name")),
      tax_id_type: toText(formData.get("tax_id_type")),
      tax_id: toText(formData.get("tax_id")),
      budget_amount: toNumber(formData.get("budget_amount")),
      typology: toText(formData.get("typology")),
      preferred_location: toText(formData.get("preferred_location")),
      comments: toText(formData.get("comments")),
      report_notes: toText(formData.get("report_notes")),
      visit_notes: toText(formData.get("visit_notes")),
      reservation_notes: toText(formData.get("reservation_notes")),
      other_notes: toText(formData.get("other_notes")),
      as_provider: formData.get("as_provider") === "on",
      provider_code: toText(formData.get("provider_code")),
      provider_type: toText(formData.get("provider_type")),
      provider_status: toText(formData.get("provider_status")),
      provider_is_billable: formData.get("provider_is_billable") === "on",
      provider_notes: toText(formData.get("provider_notes")),
      as_agency: formData.get("as_agency") === "on",
      agency_code: toText(formData.get("agency_code")),
      agency_scope: toText(formData.get("agency_scope")),
      agency_status: toText(formData.get("agency_status")),
      agency_is_referral_source: formData.get("agency_is_referral_source") === "on",
      agency_notes: toText(formData.get("agency_notes")),
    };
  };

  const assignProperty = async (clientId, propertyId, buyerRole, notes) =>
    request(`${apiBase}/${encodeURIComponent(clientId)}/property`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId || null,
        property_id: propertyId,
        buyer_role: buyerRole,
        notes,
      }),
    });

  el.providerToggle?.addEventListener("change", syncRoleFields);
  el.agencyToggle?.addEventListener("change", syncRoleFields);

  el.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = createPayloadFromForm();
    if (!payload?.full_name) {
      setFeedback("El nombre completo es obligatorio.", "error");
      return;
    }

    if (!payload.email && !payload.phone) {
      const confirmed = window.confirm(
        "Este cliente se creara sin email ni telefono. Continuar?"
      );
      if (!confirmed) return;
    }

    if (!state.organizationId) {
      setFeedback("No hay organization_id activa. Define la organizacion antes de crear clientes.", "error");
      return;
    }

    if (!(el.form instanceof HTMLFormElement)) return;
    const formData = new FormData(el.form);
    const initialPropertyId = toText(formData.get("property_id"));
    const buyerRole = toText(formData.get("buyer_role")) || "primary";
    const assignmentNotes = toText(formData.get("assignment_notes"));

    try {
      setFeedback("Creando cliente...", "ok");
      const response = await request(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const clientId = toText(response?.data?.id);
      if (!clientId) {
        setFeedback("La respuesta de alta no devolvio un client_id valido.", "error");
        return;
      }

      if (response?.meta?.persisted === false) {
        setFeedback(
          "Cliente mock generado. Activa Supabase para operar la ficha real en el CRM.",
          "ok"
        );
        return;
      }

      if (!initialPropertyId) {
        writeDetailNotice(clientId, "Cliente creado correctamente.", "ok");
        redirectToDetail(clientId);
        return;
      }

      try {
        await assignProperty(clientId, initialPropertyId, buyerRole, assignmentNotes);
        writeDetailNotice(clientId, "Cliente creado y vivienda asignada.", "ok");
      } catch (assignmentError) {
        writeDetailNotice(
          clientId,
          `Cliente creado, pero no se pudo asignar la vivienda: ${humanizeError(assignmentError)}`,
          "error"
        );
      }
      redirectToDetail(clientId);
    } catch (error) {
      setFeedback(`Error creando cliente: ${humanizeError(error)}`, "error");
    }
  });

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

  syncRoleFields();

  loadProperties()
    .then(() => {
      setFeedback("Formulario listo para crear clientes.", "ok");
    })
    .catch((error) => {
      setFeedback(`No se pudieron cargar las viviendas iniciales: ${humanizeError(error)}`, "error");
    });
})();
