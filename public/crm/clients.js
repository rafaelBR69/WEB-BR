(() => {
  const apiBase = "/api/v1/clients";

  const statusLabels = {
    active: "Activo",
    inactive: "Inactivo",
    discarded: "Descartado",
    blacklisted: "Blacklisted",
  };

  const statusClass = {
    active: "ok",
    inactive: "warn",
    discarded: "danger",
    blacklisted: "danger",
  };

  const typeLabels = {
    individual: "Persona fisica",
    company: "Persona juridica",
  };

  const channelLabels = {
    website: "Web",
    agency: "Agencia",
    phone: "Telefono",
    whatsapp: "WhatsApp",
    email: "Email",
    provider: "Proveedor",
    walkin: "Oficina",
    portal: "Portal",
    other: "Otro",
  };

  const providerTypeLabels = {
    developer: "Developer",
    promoter: "Promotor",
    constructor: "Constructor",
    architect: "Arquitecto",
    agency: "Agencia",
    owner: "Propietario",
    other: "Otro",
  };

  const agencyScopeLabels = {
    buyer: "Comprador",
    seller: "Vendedor",
    rental: "Alquiler",
    mixed: "Mixto",
  };

  const documentKindLabels = {
    dni_front: "DNI anverso",
    dni_back: "DNI reverso",
    nie_front: "NIE anverso",
    nie_back: "NIE reverso",
    passport: "Pasaporte",
    cif: "CIF",
    bank_proof: "Justificante bancario",
    reservation: "Reserva",
    contract: "Contrato",
    authorization: "Autorizacion",
    other: "Otro",
  };

  const state = {
    organizationId: "",
    organizationSource: "none",
    view: "dashboard",
    initialForceNew: false,
    items: [],
    selectedId: null,
    documents: [],
    pagination: {
      page: 1,
      perPage: 25,
      total: 0,
      totalPages: 1,
    },
  };

  const el = {
    orgForm: document.getElementById("crm-org-form"),
    orgInput: document.getElementById("crm-organization-id"),
    orgSource: document.getElementById("crm-org-source"),
    orgHelp: document.getElementById("crm-org-help"),
    form: document.getElementById("client-form"),
    newButton: document.getElementById("client-new"),
    docForm: document.getElementById("client-doc-form"),
    docFieldset: document.getElementById("client-doc-fieldset"),
    docsList: document.getElementById("client-docs-list"),
    selectedContext: document.getElementById("client-selected-context"),
    filterForm: document.getElementById("client-filter-form"),
    filterClear: document.getElementById("clients-filter-clear"),
    perPageSelect: document.getElementById("clients-per-page"),
    tbody: document.getElementById("clients-tbody"),
    meta: document.getElementById("clients-meta"),
    feedback: document.getElementById("clients-feedback"),
  };

  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const toText = (value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  };

  const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const field = (name) => {
    if (!el.form || !el.form.elements) return null;
    return el.form.elements.namedItem(name);
  };

  const checkboxChecked = (name) => {
    const input = field(name);
    return input instanceof HTMLInputElement ? input.checked : false;
  };

  const setCheckbox = (name, checked) => {
    const input = field(name);
    if (input instanceof HTMLInputElement) {
      input.checked = Boolean(checked);
    }
  };

  const setFieldValue = (name, value) => {
    const input = field(name);
    if (!input) return;
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
      input.value = value == null ? "" : String(value);
    }
  };

  const setFieldDisabled = (name, disabled) => {
    const input = field(name);
    if (!input) return;
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
      input.disabled = disabled;
    }
  };

  const setRoleFieldStates = () => {
    const providerEnabled = checkboxChecked("as_provider");
    const agencyEnabled = checkboxChecked("as_agency");

    ["provider_code", "provider_type", "provider_status", "provider_is_billable", "provider_notes"].forEach(
      (name) => setFieldDisabled(name, !providerEnabled)
    );

    ["agency_code", "agency_scope", "agency_status", "agency_is_referral_source", "agency_notes"].forEach(
      (name) => setFieldDisabled(name, !agencyEnabled)
    );
  };

  const formatCurrency = (value) => {
    const amount = toNumber(value);
    if (amount == null) return "-";
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${amount} EUR`;
    }
  };

  const formatDate = (value) => {
    const text = toText(value);
    if (!text) return "-";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [year, month, day] = text.split("-");
      return `${day}/${month}/${year}`;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString("es-ES");
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

  const setFeedback = (message, kind = "ok") => {
    if (!el.feedback) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
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
      const errorCode = payload?.error || `http_${response.status}`;
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 200) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
  };

  const selected = () => {
    if (!state.selectedId) return null;
    return state.items.find((item) => item.id === state.selectedId) || null;
  };

  const setDocFormEnabled = (enabled) => {
    if (!el.docFieldset) return;
    el.docFieldset.disabled = !enabled;
  };

  const renderOrganizationContext = () => {
    if (el.orgInput) el.orgInput.value = state.organizationId;
    if (el.orgSource) {
      el.orgSource.textContent = `Origen: ${organizationSourceLabel(state.organizationSource)}`;
      el.orgSource.className = `crm-badge ${state.organizationId ? "ok" : "warn"}`;
    }
    if (el.orgHelp) {
      el.orgHelp.textContent = state.organizationId
        ? "El modulo clientes se filtra por esta organizacion."
        : "Sin organizacion activa. Define CRM_ORGANIZATION_ID o introduce el UUID manualmente.";
    }
  };

  const roleSummaryText = (item) => {
    const labels = [];
    if (item.is_provider) {
      const providerLabel = providerTypeLabels[item.provider_type] || item.provider_type || "Proveedor";
      labels.push(`Proveedor: ${providerLabel}`);
    }
    if (item.is_agency) {
      const agencyLabel = agencyScopeLabels[item.agency_scope] || item.agency_scope || "Agencia";
      labels.push(`Agencia: ${agencyLabel}`);
    }
    if (item.is_provider_for_project && !item.is_provider) {
      labels.push("Cliente de promocion");
    }
    if (!labels.length) return "Cliente base";
    return labels.join(" | ");
  };

  const renderSelectedContext = (item) => {
    if (!el.selectedContext) return;
    if (!item) {
      el.selectedContext.innerHTML = `
        <p class="crm-selected-context-kicker">Cliente activo</p>
        <h4 class="crm-selected-context-title">Sin cliente seleccionado</h4>
        <p class="crm-selected-context-meta">Selecciona un cliente para subir DNI/NIE/CIF o justificantes.</p>
      `;
      return;
    }

    const roleSummary = roleSummaryText(item);
    const projectTag = item.is_provider_for_project ? " | Vinculado a promocion" : "";

    el.selectedContext.innerHTML = `
      <p class="crm-selected-context-kicker">Cliente activo</p>
      <h4 class="crm-selected-context-title">${esc(item.full_name || "Cliente")}</h4>
      <p class="crm-selected-context-meta">Ref: ${esc(item.client_code || "-")} | ${
        esc(statusLabels[item.client_status] || item.client_status || "-")
      } | ${esc(roleSummary)}${esc(projectTag)}</p>
      <div class="crm-selected-context-badges">
        <span class="crm-selected-context-badge">${esc(typeLabels[item.client_type] || item.client_type || "-")}</span>
        <span class="crm-selected-context-badge">${esc(channelLabels[item.entry_channel] || item.entry_channel || "-")}</span>
        <span class="crm-selected-context-badge">${esc(item.tax_id_type || "-")} ${esc(item.tax_id || "")}</span>
      </div>
    `;
  };

  const renderDocuments = () => {
    if (!el.docsList) return;
    const current = selected();
    if (!current) {
      el.docsList.innerHTML = "<li>Selecciona un cliente para ver su documentacion.</li>";
      setDocFormEnabled(false);
      return;
    }

    setDocFormEnabled(true);
    if (!state.documents.length) {
      el.docsList.innerHTML = "<li>Sin documentos cargados.</li>";
      return;
    }

    el.docsList.innerHTML = state.documents
      .map((doc) => {
        const createdAt = formatDate(doc.created_at);
        const kindLabel = documentKindLabels[doc.document_kind] || doc.document_kind || "Documento";
        const fileSize =
          typeof doc.file_size_bytes === "number" && doc.file_size_bytes > 0
            ? `${Math.round(doc.file_size_bytes / 1024)} KB`
            : "-";
        const pathLabel = doc.storage_path || "-";
        const link = doc.public_url
          ? `<a href="${esc(doc.public_url)}" target="_blank" rel="noreferrer">Abrir</a>`
          : "<span>Sin URL publica</span>";
        return `
          <li>
            <strong>${esc(doc.title || kindLabel)}</strong><br />
            <small>${esc(kindLabel)} | ${esc(createdAt)} | ${esc(fileSize)}</small><br />
            <small>${esc(pathLabel)}</small><br />
            ${link}
          </li>
        `;
      })
      .join("");
  };

  const renderRoleBadges = (item) => {
    const badges = [];
    const hasProjectLink = item.is_provider_for_project === true;

    if (item.is_provider) {
      const providerLabel = providerTypeLabels[item.provider_type] || item.provider_type || "Proveedor";
      const suffix = hasProjectLink ? " (promo)" : "";
      badges.push(`<span class="crm-badge ok">${esc(`Proveedor ${providerLabel}${suffix}`)}</span>`);
    }

    if (item.is_agency) {
      const agencyLabel = agencyScopeLabels[item.agency_scope] || item.agency_scope || "Agencia";
      badges.push(`<span class="crm-badge warn">${esc(`Agencia ${agencyLabel}`)}</span>`);
    }

    if (hasProjectLink && !item.is_provider) {
      badges.push('<span class="crm-badge ok">Cliente promocion</span>');
    }

    if (!badges.length) {
      badges.push('<span class="crm-badge warn">Cliente base</span>');
    }

    return badges.join(" ");
  };

  const renderTable = () => {
    if (!el.tbody) return;
    if (!state.items.length) {
      el.tbody.innerHTML = "<tr><td colspan='10'>Sin clientes para los filtros actuales.</td></tr>";
      return;
    }

    el.tbody.innerHTML = state.items
      .map((item) => {
        const isSelected = state.selectedId === item.id ? "crm-row-selected" : "";
        return `
          <tr class="${isSelected}">
            <td data-label="Fecha">${esc(formatDate(item.intake_date || item.created_at))}</td>
            <td data-label="Nombre"><strong>${esc(item.full_name || "-")}</strong><br /><small>${esc(item.client_code || "-")}</small></td>
            <td data-label="Tipo">${esc(typeLabels[item.client_type] || item.client_type || "-")}</td>
            <td data-label="Canal">${esc(channelLabels[item.entry_channel] || item.entry_channel || "-")}</td>
            <td data-label="Rol Fase 2">${renderRoleBadges(item)}</td>
            <td data-label="Agencia/Agente">${esc(item.agency_name || "-")}<br /><small>${esc(item.agent_name || "-")}</small></td>
            <td data-label="Contacto">${esc(item.phone || "-")}<br /><small>${esc(item.email || "-")}</small></td>
            <td data-label="Presupuesto">${esc(formatCurrency(item.budget_amount))}</td>
            <td data-label="Estado"><span class="crm-badge ${esc(statusClass[item.client_status] || "warn")}">${esc(statusLabels[item.client_status] || item.client_status || "-")}</span></td>
            <td data-label="Accion"><button type="button" class="crm-mini-btn" data-action="select" data-id="${esc(item.id)}">Seleccionar</button></td>
          </tr>
        `;
      })
      .join("");
  };

  const renderMeta = () => {
    if (!el.meta) return;
    el.meta.textContent = `Mostrando ${state.items.length} | Pagina ${state.pagination.page}/${state.pagination.totalPages} | Total ${state.pagination.total}`;
  };

  const fillForm = (item) => {
    if (!el.form) return;
    if (!item) {
      el.form.reset();
      setFieldValue("id", "");
      setRoleFieldStates();
      return;
    }

    setFieldValue("id", item.id || "");
    setFieldValue("intake_date", item.intake_date || "");
    setFieldValue("client_type", item.client_type || "individual");
    setFieldValue("entry_channel", item.entry_channel || "other");
    setFieldValue("client_status", item.client_status || "active");
    setFieldValue("agency_name", item.agency_name || "");
    setFieldValue("agent_name", item.agent_name || "");
    setFieldValue("full_name", item.full_name || "");
    setFieldValue("phone", item.phone || "");
    setFieldValue("email", item.email || "");
    setFieldValue("nationality", item.nationality || "");
    setFieldValue("budget_amount", item.budget_amount ?? "");
    setFieldValue("typology", item.typology || "");
    setFieldValue("preferred_location", item.preferred_location || "");
    setFieldValue("tax_id_type", item.tax_id_type || "");
    setFieldValue("tax_id", item.tax_id || "");

    setCheckbox("as_provider", item.is_provider === true);
    setFieldValue("provider_code", item.provider_code || "");
    setFieldValue("provider_type", item.provider_type || "other");
    setFieldValue("provider_status", item.provider_status || "active");
    setCheckbox("provider_is_billable", item.provider_is_billable !== false);
    setFieldValue("provider_notes", item.provider_notes || "");

    setCheckbox("as_agency", item.is_agency === true);
    setFieldValue("agency_code", item.agency_code || "");
    setFieldValue("agency_scope", item.agency_scope || "mixed");
    setFieldValue("agency_status", item.agency_status || "active");
    setCheckbox("agency_is_referral_source", item.agency_is_referral_source !== false);
    setFieldValue("agency_notes", item.agency_notes || "");

    setFieldValue("comments", item.comments || "");
    setFieldValue("report_notes", item.report_notes || "");
    setFieldValue("visit_notes", item.visit_notes || "");
    setFieldValue("reservation_notes", item.reservation_notes || "");
    setFieldValue("discarded_by", item.discarded_by || "");
    setFieldValue("other_notes", item.other_notes || "");

    setRoleFieldStates();
  };

  const payloadFromForm = () => {
    if (!el.form) return null;
    const formData = new FormData(el.form);

    const asProvider = checkboxChecked("as_provider");
    const asAgency = checkboxChecked("as_agency");

    return {
      organization_id: state.organizationId || null,
      intake_date: toText(formData.get("intake_date")),
      client_type: toText(formData.get("client_type")),
      entry_channel: toText(formData.get("entry_channel")),
      client_status: toText(formData.get("client_status")),
      agency_name: toText(formData.get("agency_name")),
      agent_name: toText(formData.get("agent_name")),
      full_name: toText(formData.get("full_name")),
      phone: toText(formData.get("phone")),
      email: toText(formData.get("email")),
      nationality: toText(formData.get("nationality")),
      budget_amount: toNumber(formData.get("budget_amount")),
      typology: toText(formData.get("typology")),
      preferred_location: toText(formData.get("preferred_location")),
      tax_id_type: toText(formData.get("tax_id_type")),
      tax_id: toText(formData.get("tax_id")),
      as_provider: asProvider,
      provider_code: toText(formData.get("provider_code")),
      provider_type: toText(formData.get("provider_type")),
      provider_status: toText(formData.get("provider_status")),
      provider_is_billable: checkboxChecked("provider_is_billable"),
      provider_notes: toText(formData.get("provider_notes")),
      as_agency: asAgency,
      agency_code: toText(formData.get("agency_code")),
      agency_scope: toText(formData.get("agency_scope")),
      agency_status: toText(formData.get("agency_status")),
      agency_is_referral_source: checkboxChecked("agency_is_referral_source"),
      agency_notes: toText(formData.get("agency_notes")),
      comments: toText(formData.get("comments")),
      report_notes: toText(formData.get("report_notes")),
      visit_notes: toText(formData.get("visit_notes")),
      reservation_notes: toText(formData.get("reservation_notes")),
      discarded_by: toText(formData.get("discarded_by")),
      other_notes: toText(formData.get("other_notes")),
    };
  };

  const buildListQuery = () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    params.set("page", String(state.pagination.page));
    params.set("per_page", String(state.pagination.perPage));

    if (el.filterForm) {
      const formData = new FormData(el.filterForm);
      for (const [key, value] of formData.entries()) {
        if (key === "per_page") continue;
        const text = String(value ?? "").trim();
        if (text) params.set(key, text);
      }
    }

    return params;
  };

  const loadClientDocuments = async () => {
    const current = selected();
    if (!current?.id) {
      state.documents = [];
      renderDocuments();
      return;
    }

    try {
      const params = new URLSearchParams();
      if (state.organizationId) params.set("organization_id", state.organizationId);
      const payload = await request(
        `${apiBase}/${encodeURIComponent(current.id)}/documents?${params.toString()}`
      );
      state.documents = Array.isArray(payload.data) ? payload.data : [];
      renderDocuments();
    } catch (error) {
      state.documents = [];
      renderDocuments();
      setFeedback(`Error cargando documentos: ${error.message}`, "error");
    }
  };

  const selectClient = async (id) => {
    const normalized = toText(id);
    if (!normalized) return;
    state.selectedId = normalized;
    renderTable();
    const current = selected();
    fillForm(current);
    renderSelectedContext(current);
    await loadClientDocuments();
  };

  const loadClients = async () => {
    try {
      const params = buildListQuery();
      const payload = await request(`${apiBase}?${params.toString()}`);
      state.items = Array.isArray(payload.data) ? payload.data : [];
      state.pagination.total = Number(payload.meta?.total ?? state.items.length);
      state.pagination.page = Number(payload.meta?.page ?? state.pagination.page);
      state.pagination.perPage = Number(payload.meta?.per_page ?? state.pagination.perPage);
      state.pagination.totalPages = Number(payload.meta?.total_pages ?? 1);
      if (el.perPageSelect) el.perPageSelect.value = String(state.pagination.perPage);

      if (state.initialForceNew) {
        state.selectedId = null;
        state.initialForceNew = false;
      } else if (!state.items.some((item) => item.id === state.selectedId)) {
        state.selectedId = state.items[0]?.id || null;
      }

      renderTable();
      renderMeta();
      const current = selected();
      fillForm(current);
      renderSelectedContext(current);
      await loadClientDocuments();
    } catch (error) {
      setFeedback(`Error cargando clientes: ${error.message}`, "error");
    }
  };

  el.orgForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const manualValue = String(el.orgInput?.value || "").trim();
    const defaultOrgId = toText(window.__crmDefaultOrganizationId);
    state.organizationId = manualValue || defaultOrgId || "";
    state.organizationSource = manualValue ? "manual" : defaultOrgId ? "default" : "none";
    if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);
    else localStorage.removeItem("crm.organization_id");
    state.pagination.page = 1;
    renderOrganizationContext();
    await loadClients();
  });

  el.filterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.pagination.page = 1;
    if (el.perPageSelect) state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    await loadClients();
  });

  el.filterClear?.addEventListener("click", async () => {
    el.filterForm?.reset();
    state.pagination.page = 1;
    if (el.perPageSelect) state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    await loadClients();
  });

  el.tbody?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-action='select']");
    if (!button) return;
    await selectClient(button.getAttribute("data-id"));
  });

  el.newButton?.addEventListener("click", () => {
    state.selectedId = null;
    fillForm(null);
    renderTable();
    renderSelectedContext(null);
    state.documents = [];
    renderDocuments();
    setFeedback("Preparado para crear nuevo cliente.", "ok");
  });

  el.form?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const name = target.getAttribute("name");
    if (name === "as_provider" || name === "as_agency") {
      setRoleFieldStates();
    }
  });

  el.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.organizationId) {
      setFeedback("Debes definir organization_id antes de guardar clientes.", "error");
      return;
    }

    const payload = payloadFromForm();
    if (!payload) return;
    if (!payload.full_name) {
      setFeedback("El nombre es obligatorio.", "error");
      return;
    }

    const currentId = toText(field("id")?.value);
    try {
      if (currentId) {
        const response = await request(`${apiBase}/${encodeURIComponent(currentId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        state.selectedId = response?.data?.id || currentId;
        setFeedback("Cliente actualizado.", "ok");
      } else {
        const response = await request(apiBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        state.selectedId = response?.data?.id || null;
        setFeedback("Cliente creado.", "ok");
      }
      await loadClients();
    } catch (error) {
      setFeedback(`Error guardando cliente: ${error.message}`, "error");
    }
  });

  el.docForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = selected();
    if (!current?.id) {
      setFeedback("Selecciona un cliente antes de subir documentos.", "error");
      return;
    }

    const docData = new FormData(el.docForm);
    const file = docData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      setFeedback("Debes seleccionar un archivo.", "error");
      return;
    }

    docData.set("organization_id", state.organizationId || "");
    try {
      await request(`${apiBase}/${encodeURIComponent(current.id)}/documents/upload`, {
        method: "POST",
        body: docData,
      });
      el.docForm.reset();
      if (el.docForm.elements.is_private) el.docForm.elements.is_private.checked = true;
      setFeedback("Documento subido y vinculado al cliente.", "ok");
      await loadClientDocuments();
    } catch (error) {
      setFeedback(`Error subiendo documento: ${error.message}`, "error");
    }
  });

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  const queryClientId = toText(search.get("client_id"));
  const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);

  const orgContext = resolveOrganizationContext(
    queryOrganizationId,
    localOrganizationId,
    defaultOrganizationId
  );
  state.organizationId = orgContext.id;
  state.organizationSource = orgContext.source;
  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

  const perPageFromQuery = Number(search.get("per_page"));
  if (Number.isFinite(perPageFromQuery) && perPageFromQuery > 0) {
    state.pagination.perPage = Math.floor(perPageFromQuery);
  }

  if (queryClientId) state.selectedId = queryClientId;

  const viewFromQuery = toText(search.get("view"));
  if (viewFromQuery === "new") {
    state.view = "new";
    state.initialForceNew = true;
  } else if (viewFromQuery === "promotion") {
    state.view = "promotion";
  }

  if (el.filterForm) {
    ["q", "client_type", "client_status", "entry_channel", "client_role", "project_id"].forEach((key) => {
      const value = toText(search.get(key));
      if (!value) return;
      const input = el.filterForm.elements.namedItem(key);
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLSelectElement ||
        input instanceof HTMLTextAreaElement
      ) {
        input.value = value;
      }
    });

    if (state.view === "promotion" && !toText(search.get("client_role"))) {
      const roleInput = el.filterForm.elements.namedItem("client_role");
      if (roleInput instanceof HTMLSelectElement) {
        roleInput.value = "";
      }
    }
  }

  renderOrganizationContext();
  setRoleFieldStates();
  setDocFormEnabled(false);
  renderDocuments();

  if (state.view === "new") {
    setFeedback("Vista nuevo cliente activa.", "ok");
  } else if (state.view === "promotion") {
    setFeedback(
      "Vista clientes por promocion activa. Define project_id para filtrar compradores/proveedores vinculados.",
      "ok"
    );
  }

  loadClients();
})();
