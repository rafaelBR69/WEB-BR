(() => {
  const root = document.querySelector("[data-portal-operations-page='operations']");
  if (!(root instanceof HTMLElement)) return;

  const state = {
    organizationId: "",
    organizationSource: "none",
    portalProjects: [],
    portalProjectsLoadedForOrg: null,
    visitsRows: [],
    commissionsRows: [],
  };

  const el = {
    orgForm: document.getElementById("crm-portal-ops-org-form"),
    orgInput: document.getElementById("crm-portal-ops-organization-id"),
    orgSource: document.getElementById("crm-portal-ops-org-source"),
    orgHelp: document.getElementById("crm-portal-ops-org-help"),
    feedback: document.getElementById("crm-portal-ops-feedback"),

    visitsFilterForm: document.getElementById("portal-ops-visits-filter"),
    visitsFilterClearBtn: document.getElementById("portal-ops-visits-clear"),
    visitsFilterProjectSelect: document.getElementById("portal-ops-visits-project-select"),
    visitsFilterProjectManualInput: document.getElementById("portal-ops-visits-project-manual"),
    visitsMeta: document.getElementById("portal-ops-visits-meta"),
    visitsTbody: document.getElementById("portal-ops-visits-tbody"),
    visitForm: document.getElementById("portal-ops-visit-form"),
    visitIdInput: document.getElementById("portal-ops-visit-id"),
    visitNewBtn: document.getElementById("portal-ops-visit-new"),

    commissionsFilterForm: document.getElementById("portal-ops-commissions-filter"),
    commissionsFilterClearBtn: document.getElementById("portal-ops-commissions-clear"),
    commissionsFilterProjectSelect: document.getElementById("portal-ops-commissions-project-select"),
    commissionsFilterProjectManualInput: document.getElementById("portal-ops-commissions-project-manual"),
    commissionsMeta: document.getElementById("portal-ops-commissions-meta"),
    commissionsTbody: document.getElementById("portal-ops-commissions-tbody"),
    commissionForm: document.getElementById("portal-ops-commission-form"),
    commissionIdInput: document.getElementById("portal-ops-commission-id"),
    commissionNewBtn: document.getElementById("portal-ops-commission-new"),
  };

  const toText = (value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  };

  const asObject = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
  };

  const crmLabels = window.crmLabels ?? null;
  const dictLabel = (dictionary, value, fallback = "-") => {
    const normalizedValue = toText(value);
    if (!normalizedValue) return fallback;
    return (
      crmLabels?.label?.(dictionary, normalizedValue, null) ??
      crmLabels?.labelAny?.(normalizedValue, null) ??
      normalizedValue
    );
  };

  const visitStatusLabel = (value) => dictLabel("visit-status", value, "-");
  const commissionStatusLabel = (value) => dictLabel("commission-status", value, "-");
  const commissionTypeLabel = (value) => dictLabel("commission-type", value, "-");

  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const formatDateTime = (value) => {
    const text = toText(value);
    if (!text) return "-";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleString("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDateOnly = (value) => {
    const text = toText(value);
    if (!text) return "-";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toISOString().slice(0, 10);
  };

  const formatAmount = (value, currency = "EUR") => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "-";
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: toText(currency) || "EUR",
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${toText(currency) || "EUR"}`;
    }
  };

  const statusClass = (value) => {
    const status = toText(value) || "";
    if (
      status === "active" ||
      status === "approved" ||
      status === "paid" ||
      status === "confirmed" ||
      status === "done"
    ) {
      return "ok";
    }
    if (
      status === "declined" ||
      status === "cancelled" ||
      status === "no_show" ||
      status === "revoked" ||
      status === "blocked"
    ) {
      return "danger";
    }
    return "warn";
  };

  const buildApiUrl = (path, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value == null) return;
      const text = toText(value);
      if (text) query.set(key, text);
    });
    const queryText = query.toString();
    return queryText ? `${path}?${queryText}` : path;
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
    if (!response.ok || !payload?.ok) {
      const code = toText(payload?.error) || `http_${response.status}`;
      const details = toText(payload?.details) || toText(payload?.message) || null;
      const message = details ? `${code}: ${details}` : code;
      throw new Error(message);
    }
    return payload;
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

  const organizationSourceLabel = (source) => {
    if (source === "url") return "URL";
    if (source === "local") return "Guardada en navegador";
    if (source === "default") return "Por defecto CRM";
    if (source === "manual") return "Manual";
    return "Sin configurar";
  };

  const resolveOrganizationContext = (queryValue, localValue, defaultValue) => {
    if (queryValue) return { id: queryValue, source: "url" };
    if (localValue) return { id: localValue, source: "local" };
    if (defaultValue) return { id: defaultValue, source: "default" };
    return { id: "", source: "none" };
  };

  const persistOrganization = () => {
    if (state.organizationId) window.localStorage.setItem("crm.organization_id", state.organizationId);
    else window.localStorage.removeItem("crm.organization_id");
  };

  const updateUrlOrganization = () => {
    const url = new URL(window.location.href);
    if (state.organizationId) url.searchParams.set("organization_id", state.organizationId);
    else url.searchParams.delete("organization_id");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };

  const renderOrganizationContext = () => {
    if (el.orgInput instanceof HTMLInputElement) el.orgInput.value = state.organizationId;
    if (el.orgSource instanceof HTMLElement) {
      el.orgSource.textContent = `Origen: ${organizationSourceLabel(state.organizationSource)}`;
      el.orgSource.className = `crm-badge ${state.organizationId ? "ok" : "warn"}`;
    }
    if (el.orgHelp instanceof HTMLElement) {
      el.orgHelp.textContent = state.organizationId
        ? `Contexto activo: ${state.organizationId}`
        : "Define organization_id para cargar operativa portal.";
    }
  };

  const ensureOrganization = () => {
    if (state.organizationId) return true;
    setFeedback("Debes definir organization_id para continuar.", "error");
    return false;
  };

  const getProjectDisplayName = (project) => {
    const row = asObject(project);
    const displayName = toText(row.display_name);
    const projectName = toText(row.project_name);
    const legacyCode = toText(row.legacy_code);
    const id = toText(row.id);
    const status = toText(row.status);
    const main = displayName || projectName || legacyCode || id || "Promocion";
    return status ? `${main} | ${status}` : main;
  };

  const isPortalEnabledProject = (project) => {
    const row = asObject(project);
    const portal = asObject(row.portal);
    if (typeof portal.is_enabled === "boolean") return portal.is_enabled;
    const propertyData = asObject(row.property_data);
    if (typeof propertyData.portal_enabled === "boolean") return propertyData.portal_enabled;
    return true;
  };

  const getProjectById = (projectId) => {
    const normalized = toText(projectId);
    if (!normalized) return null;
    return state.portalProjects.find((entry) => toText(entry.id) === normalized) ?? null;
  };

  const setProjectSelectOptions = (select, projects, emptyLabel) => {
    if (!(select instanceof HTMLSelectElement)) return;
    const current = toText(select.value);
    const options = [
      `<option value="">${esc(emptyLabel)}</option>`,
      ...projects.map((entry) => {
        const id = toText(entry.id);
        if (!id) return "";
        const selected = current === id ? " selected" : "";
        return `<option value="${esc(id)}"${selected}>${esc(getProjectDisplayName(entry))}</option>`;
      }),
    ];
    select.innerHTML = options.join("");

    if (current && !projects.some((entry) => toText(entry.id) === current)) {
      const orphan = document.createElement("option");
      orphan.value = current;
      orphan.textContent = `${current} (manual)`;
      orphan.selected = true;
      select.appendChild(orphan);
    }
  };

  const renderProjectSelectors = () => {
    setProjectSelectOptions(el.visitsFilterProjectSelect, state.portalProjects, "Todas las promociones");
    setProjectSelectOptions(el.commissionsFilterProjectSelect, state.portalProjects, "Todas las promociones");
  };

  const loadPortalProjects = async ({ force = false } = {}) => {
    if (!ensureOrganization()) return [];
    if (!force && state.portalProjectsLoadedForOrg === state.organizationId) return state.portalProjects;

    const payload = await request(
      buildApiUrl("/api/v1/properties", {
        organization_id: state.organizationId,
        record_type: "project",
        per_page: "200",
        page: "1",
      })
    );

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    state.portalProjects = rows
      .filter((entry) => toText(entry?.id) && isPortalEnabledProject(entry))
      .sort((a, b) => getProjectDisplayName(a).localeCompare(getProjectDisplayName(b), "es"));
    state.portalProjectsLoadedForOrg = state.organizationId;
    renderProjectSelectors();
    return state.portalProjects;
  };

  const resolveProjectPropertyIdFromForm = (formData, selectFieldName, manualFieldName) => {
    const selected = toText(formData.get(selectFieldName));
    const manual = toText(formData.get(manualFieldName));
    return manual ?? selected ?? null;
  };

  const clearForm = (form) => {
    if (!(form instanceof HTMLFormElement)) return;
    form.reset();
  };

  const toDatetimeLocalValue = (value) => {
    const text = toText(value);
    if (!text) return "";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "";
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  };

  const renderVisits = (rows = [], meta = {}) => {
    if (!(el.visitsTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.visitsTbody.innerHTML = '<tr><td colspan="6">No hay solicitudes para el filtro aplicado.</td></tr>';
    } else {
      el.visitsTbody.innerHTML = rows
        .map((entry) => {
          const id = toText(entry.id) || "";
          const project = getProjectById(entry.project_property_id);
          const projectLabel = project ? getProjectDisplayName(project) : "Promocion";
          const leadSummary = asObject(entry.lead_summary);
          const leadLabel = toText(leadSummary.label) || "Lead";
          const status = toText(entry.status) || "requested";
          const statusText = visitStatusLabel(status);
          const confirmedSlot = formatDateTime(entry.confirmed_slot);
          return `
            <tr>
              <td>${esc(formatDateTime(entry.created_at))}</td>
              <td>${esc(projectLabel)}</td>
              <td>${esc(leadLabel)}</td>
              <td><span class="crm-badge ${statusClass(status)}">${esc(statusText)}</span></td>
              <td>${esc(confirmedSlot)}</td>
              <td>
                <button type="button" class="crm-mini-btn" data-action="edit-visit" data-visit-id="${esc(id)}">
                  Editar
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (el.visitsMeta instanceof HTMLElement) {
      const count = Number(meta.count || rows.length || 0);
      const total = Number(meta.total || count);
      const pageValue = Number(meta.page || 1);
      const totalPages = Number(meta.total_pages || 1);
      el.visitsMeta.textContent = `${count} filas visibles | total ${total} | pagina ${pageValue}/${totalPages}`;
    }
  };

  const loadVisits = async () => {
    if (!ensureOrganization()) return;
    const filterForm = el.visitsFilterForm instanceof HTMLFormElement ? new FormData(el.visitsFilterForm) : null;
    const projectPropertyId = filterForm
      ? resolveProjectPropertyIdFromForm(filterForm, "project_property_id", "project_property_id_manual")
      : null;

    const params = {
      organization_id: state.organizationId,
      project_property_id: projectPropertyId,
      status: toText(filterForm?.get("status")),
      q: toText(filterForm?.get("q")),
      per_page: toText(filterForm?.get("per_page")) || "25",
      page: "1",
    };

    const payload = await request(buildApiUrl("/api/v1/crm/portal/visit-requests", params));
    state.visitsRows = Array.isArray(payload?.data) ? payload.data : [];
    renderVisits(state.visitsRows, asObject(payload?.meta));
  };

  const resetVisitForm = () => {
    clearForm(el.visitForm);
    if (el.visitIdInput instanceof HTMLInputElement) el.visitIdInput.value = "";
  };

  const fillVisitForm = (visitId) => {
    if (!visitId || !(el.visitForm instanceof HTMLFormElement)) return;
    const row = state.visitsRows.find((entry) => toText(entry.id) === visitId);
    if (!row) return;

    const idField = el.visitForm.elements.namedItem("id");
    if (idField instanceof HTMLInputElement) idField.value = toText(row.id) ?? "";

    const statusField = el.visitForm.elements.namedItem("status");
    if (statusField instanceof HTMLSelectElement) statusField.value = toText(row.status) ?? "requested";

    const slotField = el.visitForm.elements.namedItem("confirmed_slot");
    if (slotField instanceof HTMLInputElement) {
      slotField.value = toDatetimeLocalValue(row.confirmed_slot);
    }

    const notesField = el.visitForm.elements.namedItem("notes");
    if (notesField instanceof HTMLTextAreaElement) notesField.value = toText(row.notes) ?? "";

    const focusField = el.visitForm.elements.namedItem("status");
    if (focusField instanceof HTMLSelectElement) focusField.focus();
  };

  const saveVisit = async () => {
    if (!ensureOrganization() || !(el.visitForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.visitForm);
    const visitId = toText(formData.get("id"));
    const status = toText(formData.get("status"));
    const confirmedSlotRaw = toText(formData.get("confirmed_slot"));
    const notes = toText(formData.get("notes"));

    if (!visitId || !status) {
      setFeedback("Selecciona una solicitud y estado para guardar.", "error");
      return;
    }

    const payload = {
      organization_id: state.organizationId,
      id: visitId,
      status,
      confirmed_slot: confirmedSlotRaw ? new Date(confirmedSlotRaw).toISOString() : null,
      notes,
    };

    await request("/api/v1/crm/portal/visit-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await loadVisits();
    setFeedback("Solicitud de visita actualizada.", "ok");
  };

  const renderCommissions = (rows = [], meta = {}) => {
    if (!(el.commissionsTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.commissionsTbody.innerHTML = '<tr><td colspan="7">No hay comisiones para el filtro aplicado.</td></tr>';
    } else {
      el.commissionsTbody.innerHTML = rows
        .map((entry) => {
          const id = toText(entry.id) || "";
          const project = getProjectById(entry.project_property_id);
          const projectLabel = project ? getProjectDisplayName(project) : "Promocion";
          const leadSummary = asObject(entry.lead_summary);
          const leadLabel = toText(leadSummary.label) || "Lead";
          const status = toText(entry.status) || "pending";
          const type = toText(entry.commission_type) || "fixed";
          const statusText = commissionStatusLabel(status);
          const typeText = commissionTypeLabel(type);
          const amount = formatAmount(entry.commission_value, entry.currency);
          return `
            <tr>
              <td>${esc(projectLabel)}</td>
              <td>${esc(leadLabel)}</td>
              <td>${esc(typeText)}</td>
              <td>${esc(amount)}</td>
              <td><span class="crm-badge ${statusClass(status)}">${esc(statusText)}</span></td>
              <td>${esc(formatDateOnly(entry.payment_date))}</td>
              <td>
                <button type="button" class="crm-mini-btn" data-action="edit-commission" data-commission-id="${esc(id)}">
                  Editar
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (el.commissionsMeta instanceof HTMLElement) {
      const count = Number(meta.count || rows.length || 0);
      const total = Number(meta.total || count);
      const pageValue = Number(meta.page || 1);
      const totalPages = Number(meta.total_pages || 1);
      el.commissionsMeta.textContent = `${count} filas visibles | total ${total} | pagina ${pageValue}/${totalPages}`;
    }
  };

  const loadCommissions = async () => {
    if (!ensureOrganization()) return;
    const filterForm = el.commissionsFilterForm instanceof HTMLFormElement ? new FormData(el.commissionsFilterForm) : null;
    const projectPropertyId = filterForm
      ? resolveProjectPropertyIdFromForm(filterForm, "project_property_id", "project_property_id_manual")
      : null;

    const params = {
      organization_id: state.organizationId,
      project_property_id: projectPropertyId,
      status: toText(filterForm?.get("status")),
      commission_type: toText(filterForm?.get("commission_type")),
      q: toText(filterForm?.get("q")),
      per_page: toText(filterForm?.get("per_page")) || "25",
      page: "1",
    };

    const payload = await request(buildApiUrl("/api/v1/crm/portal/commissions", params));
    state.commissionsRows = Array.isArray(payload?.data) ? payload.data : [];
    renderCommissions(state.commissionsRows, asObject(payload?.meta));
  };

  const resetCommissionForm = () => {
    clearForm(el.commissionForm);
    if (el.commissionIdInput instanceof HTMLInputElement) el.commissionIdInput.value = "";
    const currencyField = el.commissionForm?.elements?.namedItem("currency");
    if (currencyField instanceof HTMLInputElement) currencyField.value = "EUR";
  };

  const fillCommissionForm = (commissionId) => {
    if (!commissionId || !(el.commissionForm instanceof HTMLFormElement)) return;
    const row = state.commissionsRows.find((entry) => toText(entry.id) === commissionId);
    if (!row) return;

    const idField = el.commissionForm.elements.namedItem("id");
    if (idField instanceof HTMLInputElement) idField.value = toText(row.id) ?? "";

    const statusField = el.commissionForm.elements.namedItem("status");
    if (statusField instanceof HTMLSelectElement) statusField.value = toText(row.status) ?? "pending";

    const typeField = el.commissionForm.elements.namedItem("commission_type");
    if (typeField instanceof HTMLSelectElement) typeField.value = toText(row.commission_type) ?? "fixed";

    const valueField = el.commissionForm.elements.namedItem("commission_value");
    if (valueField instanceof HTMLInputElement) {
      const numeric = Number(row.commission_value);
      valueField.value = Number.isFinite(numeric) ? String(numeric) : "";
    }

    const currencyField = el.commissionForm.elements.namedItem("currency");
    if (currencyField instanceof HTMLInputElement) currencyField.value = toText(row.currency) ?? "EUR";

    const paymentField = el.commissionForm.elements.namedItem("payment_date");
    if (paymentField instanceof HTMLInputElement) paymentField.value = toText(row.payment_date) ?? "";

    const notesField = el.commissionForm.elements.namedItem("notes");
    if (notesField instanceof HTMLTextAreaElement) notesField.value = toText(row.notes) ?? "";

    const focusField = el.commissionForm.elements.namedItem("status");
    if (focusField instanceof HTMLSelectElement) focusField.focus();
  };

  const saveCommission = async () => {
    if (!ensureOrganization() || !(el.commissionForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.commissionForm);
    const commissionId = toText(formData.get("id"));
    const status = toText(formData.get("status"));
    const commissionType = toText(formData.get("commission_type"));
    const commissionValueText = toText(formData.get("commission_value"));
    const currency = toText(formData.get("currency"));
    const paymentDate = toText(formData.get("payment_date"));
    const notes = toText(formData.get("notes"));

    if (!commissionId || !status || !commissionType) {
      setFeedback("Selecciona una comision y completa estado/tipo.", "error");
      return;
    }

    const commissionValue = commissionValueText != null ? Number(commissionValueText) : null;
    if (commissionValueText != null && (!Number.isFinite(commissionValue) || commissionValue < 0)) {
      setFeedback("El importe debe ser un numero mayor o igual a 0.", "error");
      return;
    }

    const payload = {
      organization_id: state.organizationId,
      id: commissionId,
      status,
      commission_type: commissionType,
      commission_value: commissionValue,
      currency,
      payment_date: paymentDate,
      notes,
    };

    await request("/api/v1/crm/portal/commissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await loadCommissions();
    setFeedback("Comision actualizada.", "ok");
  };

  const loadAll = async () => {
    if (!state.organizationId) {
      setFeedback("Define organization_id para cargar datos.", "error");
      return;
    }

    setFeedback("Cargando operativa portal...", "ok");
    try {
      try {
        await loadPortalProjects();
      } catch {
        state.portalProjects = [];
        state.portalProjectsLoadedForOrg = null;
        renderProjectSelectors();
      }
      await Promise.all([loadVisits(), loadCommissions()]);
      setFeedback("Operativa actualizada.", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`No se pudo cargar operativa: ${message}`, "error");
    }
  };

  const initContext = () => {
    const search = new URLSearchParams(window.location.search);
    const queryOrganizationId = toText(search.get("organization_id"));
    const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
    const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);

    const context = resolveOrganizationContext(queryOrganizationId, localOrganizationId, defaultOrganizationId);
    state.organizationId = context.id;
    state.organizationSource = context.source;
    state.portalProjects = [];
    state.portalProjectsLoadedForOrg = null;
    state.visitsRows = [];
    state.commissionsRows = [];
    persistOrganization();
    updateUrlOrganization();
    renderOrganizationContext();
    renderProjectSelectors();
  };

  const handleOrgSubmit = async (event) => {
    event.preventDefault();
    const nextId = toText(el.orgInput instanceof HTMLInputElement ? el.orgInput.value : "");
    const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
    const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
    const fallbackOrganizationId = localOrganizationId || defaultOrganizationId || state.organizationId;
    state.organizationId = nextId || fallbackOrganizationId || "";
    state.organizationSource = nextId
      ? "manual"
      : state.organizationId && state.organizationId === defaultOrganizationId
        ? "default"
        : state.organizationId
          ? "local"
          : "none";
    state.portalProjects = [];
    state.portalProjectsLoadedForOrg = null;
    state.visitsRows = [];
    state.commissionsRows = [];
    persistOrganization();
    updateUrlOrganization();
    renderOrganizationContext();
    renderProjectSelectors();
    await loadAll();
  };

  if (el.orgForm instanceof HTMLFormElement) {
    el.orgForm.addEventListener("submit", (event) => {
      void handleOrgSubmit(event);
    });
  }

  if (
    el.visitsFilterProjectSelect instanceof HTMLSelectElement &&
    el.visitsFilterProjectManualInput instanceof HTMLInputElement
  ) {
    el.visitsFilterProjectSelect.addEventListener("change", () => {
      if (toText(el.visitsFilterProjectSelect.value)) el.visitsFilterProjectManualInput.value = "";
    });
  }

  if (
    el.commissionsFilterProjectSelect instanceof HTMLSelectElement &&
    el.commissionsFilterProjectManualInput instanceof HTMLInputElement
  ) {
    el.commissionsFilterProjectSelect.addEventListener("change", () => {
      if (toText(el.commissionsFilterProjectSelect.value)) el.commissionsFilterProjectManualInput.value = "";
    });
  }

  if (el.visitsFilterForm instanceof HTMLFormElement) {
    el.visitsFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadVisits();
          setFeedback("Solicitudes de visita actualizadas.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando visitas: ${message}`, "error");
        }
      })();
    });
  }

  el.visitsFilterClearBtn?.addEventListener("click", () => {
    clearForm(el.visitsFilterForm);
    if (el.visitsFilterProjectManualInput instanceof HTMLInputElement) el.visitsFilterProjectManualInput.value = "";
    void (async () => {
      try {
        await loadVisits();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`Error limpiando filtros de visitas: ${message}`, "error");
      }
    })();
  });

  if (el.visitForm instanceof HTMLFormElement) {
    el.visitForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await saveVisit();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo guardar visita: ${message}`, "error");
        }
      })();
    });
  }

  el.visitNewBtn?.addEventListener("click", () => {
    resetVisitForm();
    setFeedback("Formulario de visita listo para nueva seleccion.", "ok");
  });

  el.visitsTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-action='edit-visit']");
    if (!button) return;
    const visitId = toText(button.getAttribute("data-visit-id"));
    if (!visitId) return;
    fillVisitForm(visitId);
    setFeedback("Solicitud de visita cargada para editar.", "ok");
  });

  if (el.commissionsFilterForm instanceof HTMLFormElement) {
    el.commissionsFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadCommissions();
          setFeedback("Comisiones actualizadas.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando comisiones: ${message}`, "error");
        }
      })();
    });
  }

  el.commissionsFilterClearBtn?.addEventListener("click", () => {
    clearForm(el.commissionsFilterForm);
    if (el.commissionsFilterProjectManualInput instanceof HTMLInputElement) {
      el.commissionsFilterProjectManualInput.value = "";
    }
    void (async () => {
      try {
        await loadCommissions();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`Error limpiando filtros de comisiones: ${message}`, "error");
      }
    })();
  });

  if (el.commissionForm instanceof HTMLFormElement) {
    el.commissionForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await saveCommission();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo guardar comision: ${message}`, "error");
        }
      })();
    });
  }

  el.commissionNewBtn?.addEventListener("click", () => {
    resetCommissionForm();
    setFeedback("Formulario de comision listo para nueva seleccion.", "ok");
  });

  el.commissionsTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-action='edit-commission']");
    if (!button) return;
    const commissionId = toText(button.getAttribute("data-commission-id"));
    if (!commissionId) return;
    fillCommissionForm(commissionId);
    setFeedback("Comision cargada para editar.", "ok");
  });

  crmLabels?.applySelectDictionaries?.(root);
  initContext();
  void loadAll();
})();
