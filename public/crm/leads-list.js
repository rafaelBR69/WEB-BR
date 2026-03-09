(() => {
  const apiBase = "/api/v1/crm/leads";

  const statusClass = {
    new: "warn",
    in_process: "warn",
    qualified: "ok",
    visit_scheduled: "warn",
    offer_sent: "warn",
    negotiation: "warn",
    converted: "ok",
    won: "ok",
    lost: "danger",
    discarded: "danger",
    junk: "danger",
  };

  const statusLabel = {
    new: "Nuevo",
    in_process: "En proceso",
    qualified: "Cualificado",
    visit_scheduled: "Visita programada",
    offer_sent: "Oferta enviada",
    negotiation: "Negociacion",
    converted: "Convertido",
    won: "Ganado",
    lost: "Perdido",
    discarded: "Descartado",
    junk: "No valido",
  };

  const originLabel = {
    direct: "Directo",
    website: "Web corporativa",
    portal: "Portal inmobiliario",
    agency: "Agencia colaboradora",
    provider: "Proveedor",
    phone: "Llamada telefonica",
    whatsapp: "WhatsApp",
    email: "Email",
    other: "Otros",
  };

  const operationLabel = {
    sale: "Compra",
    rent: "Alquiler",
    both: "Compra y alquiler",
  };

  const leadKindLabel = {
    buyer: "Comprador",
    seller: "Vendedor",
    landlord: "Propietario",
    tenant: "Inquilino",
    investor: "Inversor",
    agency: "Agencia",
    provider: "Proveedor",
    other: "Otro",
  };

  const sourceLabel = {
    crm_manual: "CRM manual",
    csv_import: "Importacion CSV",
    web_form: "Formulario web",
    website_form: "Formulario web",
    portal_form: "Formulario portal",
    formulario_web_br: "Formulario Web BR",
    idealista: "Idealista",
    inmowi: "Inmowi",
    clinmo: "Clinmo",
    landing: "Landing",
    landing_calahonda_sunset: "Landing Calahonda Sunset",
    posizionarte_google: "Posizionarte Google",
    psz_meta: "PSZ Meta",
    redes_sociales: "Redes Sociales",
    mailing: "Mailing",
    mail_lanzamiento: "Mail Lanzamiento",
    pisos_com: "Pisos.com",
    resales_online: "Resales Online",
    fotocasa: "Fotocasa",
    telefono_de_pasarela_zoiper: "Telefono de pasarela Zoiper",
    wa_natascha: "WA Natascha",
    wa_de_blancareal: "WA de BlancaReal",
    wa_de_blancareal_eva: "WA de BlancaReal (Eva)",
    info_blancareal: "info@blancareal.com",
    office_blancareal: "office@blancareal.com",
    eva_blancareal: "eva@blancareal.com",
    sales_blancareal: "sales@blancareal.com",
    info_calahondasunset: "info@calahondasunset.es",
    cliente: "Cliente",
    cliente_directo: "Cliente directo",
    agencia: "Agencia",
    contactos_internos_referenciados: "Contactos internos (Referenciados)",
    contactos_desde_serprocol: "Contactos desde Serprocol",
    contacto_interno: "Contacto interno",
    interno: "Interno",
    directo_ref: "Directo/ref",
    entro_en_la_oficina: "Entro en la oficina",
    se_paseaban_por_alli: "Se paseaban por alli",
    greg_marrs: "Greg Marrs",
    greg_marrs_pirata: "Greg Marrs (Pirata)",
    valla: "Valla",
    whatsapp: "WhatsApp",
    phone: "Llamada telefonica",
    email: "Email",
    meta_ads: "Meta Ads",
    google_ads: "Google Ads",
  };

  const FILTER_FIELD_NAMES = [
    "q",
    "status",
    "origin_type",
    "operation_interest",
    "lead_kind",
    "treated",
    "nationality",
    "project_id",
  ];

  const state = {
    organizationId: "",
    items: [],
    byId: new Map(),
    prefillProjectId: "",
    selectedLeadId: "",
    pagination: {
      page: 1,
      perPage: 25,
      total: 0,
      totalPages: 1,
    },
  };

  const el = {
    filterForm: document.getElementById("leads-filter-form"),
    filterClear: document.getElementById("leads-filter-clear"),
    perPageSelect: document.getElementById("leads-per-page"),
    projectSelect: document.getElementById("leads-project-select"),
    tbody: document.getElementById("leads-tbody"),
    meta: document.getElementById("leads-meta"),
    pagination: document.getElementById("leads-pagination"),
    pageInfo: document.getElementById("leads-page-info"),
    feedback: document.getElementById("leads-feedback"),
    detailEmpty: document.getElementById("leads-detail-empty"),
    detail: document.getElementById("leads-detail"),
    detailName: document.getElementById("leads-detail-name"),
    detailStatus: document.getElementById("leads-detail-status"),
    detailId: document.getElementById("leads-detail-id"),
    detailEmail: document.getElementById("leads-detail-email"),
    detailPhone: document.getElementById("leads-detail-phone"),
    detailNationality: document.getElementById("leads-detail-nationality"),
    detailProject: document.getElementById("leads-detail-project"),
    detailProperty: document.getElementById("leads-detail-property"),
    detailOrigin: document.getElementById("leads-detail-origin"),
    detailSource: document.getElementById("leads-detail-source"),
    detailOperation: document.getElementById("leads-detail-operation"),
    detailKind: document.getElementById("leads-detail-kind"),
    detailImport: document.getElementById("leads-detail-import"),
    detailCreated: document.getElementById("leads-detail-created"),
    detailUpdated: document.getElementById("leads-detail-updated"),
    detailMessage: document.getElementById("leads-detail-message"),
    actionEmail: document.getElementById("leads-action-email"),
    actionCall: document.getElementById("leads-action-call"),
    actionWhatsapp: document.getElementById("leads-action-whatsapp"),
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

  const humanizeToken = (value) => {
    const text = toText(value);
    if (!text) return "-";
    return text
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (match) => match.toUpperCase());
  };

  const resolveLabel = (dictionary, value, fallback = "-") => {
    const key = toText(value)?.toLowerCase();
    if (!key) return fallback;
    return dictionary[key] || humanizeToken(key);
  };

  const formField = (name) => {
    if (!el.filterForm || !el.filterForm.elements) return null;
    return el.filterForm.elements.namedItem(name);
  };

  const setFormFieldValue = (name, value) => {
    const input = formField(name);
    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLSelectElement ||
      input instanceof HTMLTextAreaElement
    ) {
      input.value = value == null ? "" : String(value);
    }
  };

  const formatDate = (value) => {
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

  const normalizePhoneForTel = (value) => {
    const text = toText(value);
    if (!text) return null;
    return text.replace(/[^\d+]/g, "");
  };

  const normalizePhoneForWhatsapp = (value) => {
    const text = toText(value);
    if (!text) return null;
    const digits = text.replace(/\D+/g, "");
    return digits.length >= 6 ? digits : null;
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
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 250) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
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

  const projectLabel = (row) => {
    const data = row && typeof row.property_data === "object" && !Array.isArray(row.property_data) ? row.property_data : {};
    return (
      toText(data.display_name) ||
      toText(data.project_name) ||
      toText(data.promotion_name) ||
      toText(data.name) ||
      toText(data.title) ||
      toText(row?.legacy_code) ||
      "Promocion"
    );
  };

  const renderProjectOptions = (rows) => {
    if (!(el.projectSelect instanceof HTMLSelectElement)) return;
    const selectedValue = toText(el.projectSelect.value) || state.prefillProjectId;
    const options = [
      '<option value="">Todas</option>',
      ...rows
        .filter((item) => toText(item?.id))
        .map((item) => `<option value="${esc(item.id)}">${esc(projectLabel(item))}</option>`),
    ];
    el.projectSelect.innerHTML = options.join("");
    if (selectedValue && el.projectSelect.querySelector(`option[value="${selectedValue}"]`)) {
      el.projectSelect.value = selectedValue;
      state.prefillProjectId = selectedValue;
    } else {
      state.prefillProjectId = "";
    }
  };

  const loadProjectOptions = async () => {
    if (!(el.projectSelect instanceof HTMLSelectElement)) return;
    if (!state.organizationId) {
      renderProjectOptions([]);
      return;
    }

    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("record_type", "project");
    params.set("per_page", "300");
    const payload = await request(`/api/v1/properties?${params.toString()}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    rows.sort((a, b) => projectLabel(a).localeCompare(projectLabel(b), "es"));
    renderProjectOptions(rows);
  };

  const renderTable = () => {
    if (!el.tbody) return;
    if (!state.items.length) {
      el.tbody.innerHTML = "<tr><td colspan='8'>Sin leads para los filtros actuales.</td></tr>";
      return;
    }

    el.tbody.innerHTML = state.items
      .map((item) => {
        const statusKey = toText(item.status) || "-";
        const statusText = resolveLabel(statusLabel, statusKey);
        const sourceText = resolveLabel(sourceLabel, toText(item.source) || "unknown");
        const originText = resolveLabel(originLabel, item.origin_type);
        const operationText = resolveLabel(operationLabel, item.operation_interest);
        const importFile = toText(item.import_source_file);
        const importRow = toNumber(item.import_source_row_number);
        const importTag = importFile ? `${importFile}${importRow ? ` #${importRow}` : ""}` : null;
        const leadName = toText(item.full_name) || toText(item.email) || toText(item.phone) || "Lead";
        const leadContact = [toText(item.email), toText(item.phone)].filter(Boolean).join(" | ");
        const project = toText(item.project_label) || toText(item.project_code) || "-";
        const nationality = toText(item.nationality) || "-";

        return `
          <tr class="crm-row-clickable" data-lead-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Abrir ficha de ${esc(leadName)}">
            <td data-label="Fecha">${esc(formatDate(item.created_at))}</td>
            <td data-label="Lead">
              <a href="/crm/leads/${esc(item.id)}${window.location.search}" class="crm-lead-link">
                <strong>${esc(leadName)}</strong>
              </a>
              <br /><small>${esc(leadContact || "-")}</small>
            </td>
            <td data-label="Nacionalidad">${esc(nationality)}</td>
            <td data-label="Promocion">${esc(project)}</td>
            <td data-label="Interes">${esc(operationText)}</td>
            <td data-label="Estado"><span class="crm-badge ${esc(statusClass[statusKey] || "warn")}">${esc(statusText)}</span></td>
            <td data-label="Origen">${esc(originText)}</td>
            <td data-label="Fuente">${esc(sourceText)}${importTag ? `<br /><small>${esc(importTag)}</small>` : ""}</td>
          </tr>
        `;
      })
      .join("");
  };

  const renderMeta = () => {
    if (!el.meta) return;
    el.meta.textContent =
      `Mostrando ${state.items.length} | Pagina ${state.pagination.page}/${state.pagination.totalPages} | ` +
      `Total ${state.pagination.total}`;
  };

  const renderPagination = () => {
    if (!el.pagination || !el.pageInfo) return;
    const total = Number(state.pagination.total ?? 0);
    const page = Number(state.pagination.page ?? 1);
    const totalPages = Number(state.pagination.totalPages ?? 1);

    el.pageInfo.textContent = `Pagina ${page} de ${totalPages} | ${state.items.length} en pagina | ${total} total`;

    const prevBtn = el.pagination.querySelector("button[data-page-action='prev']");
    const nextBtn = el.pagination.querySelector("button[data-page-action='next']");
    if (prevBtn instanceof HTMLButtonElement) prevBtn.disabled = page <= 1;
    if (nextBtn instanceof HTMLButtonElement) nextBtn.disabled = page >= totalPages;
  };

  const setActionLink = (node, href) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    if (href) {
      node.href = href;
      node.classList.remove("is-disabled");
      node.removeAttribute("aria-disabled");
    } else {
      node.href = "#";
      node.classList.add("is-disabled");
      node.setAttribute("aria-disabled", "true");
    }
  };

  const clearDetail = () => {
    state.selectedLeadId = "";
    if (el.detailEmpty) el.detailEmpty.hidden = false;
    if (el.detail) el.detail.hidden = true;
    setActionLink(el.actionEmail, null);
    setActionLink(el.actionCall, null);
    setActionLink(el.actionWhatsapp, null);
  };

  const setDetailField = (node, value) => {
    if (!(node instanceof HTMLElement)) return;
    node.textContent = toText(value) || "-";
  };

  const selectLead = (leadId) => {
    const id = toText(leadId);
    if (!id) {
      clearDetail();
      return;
    }
    const item = state.byId.get(id);
    if (!item) {
      clearDetail();
      return;
    }

    state.selectedLeadId = id;
    if (el.detailEmpty) el.detailEmpty.hidden = true;
    if (el.detail) el.detail.hidden = false;

    const statusKey = toText(item.status) || "-";
    const statusText = resolveLabel(statusLabel, statusKey);
    setDetailField(el.detailName, toText(item.full_name) || toText(item.email) || toText(item.phone) || "Lead");
    setDetailField(el.detailId, item.id);
    setDetailField(el.detailEmail, item.email);
    setDetailField(el.detailPhone, item.phone);
    setDetailField(el.detailNationality, item.nationality);
    setDetailField(el.detailProject, toText(item.project_label) || toText(item.project_code));
    setDetailField(el.detailProperty, toText(item.property_label) || toText(item.property_code));
    setDetailField(el.detailOrigin, resolveLabel(originLabel, item.origin_type));
    setDetailField(el.detailSource, resolveLabel(sourceLabel, item.source));
    setDetailField(el.detailOperation, resolveLabel(operationLabel, item.operation_interest));
    setDetailField(el.detailKind, resolveLabel(leadKindLabel, item.lead_kind));
    setDetailField(el.detailCreated, formatDate(item.created_at));
    setDetailField(el.detailUpdated, formatDate(item.updated_at));
    setDetailField(el.detailMessage, item.message);

    const importFile = toText(item.import_source_file);
    const importRow = toNumber(item.import_source_row_number);
    setDetailField(el.detailImport, importFile ? `${importFile}${importRow ? ` #${importRow}` : ""}` : null);

    if (el.detailStatus instanceof HTMLElement) {
      el.detailStatus.textContent = statusText;
      el.detailStatus.className = `crm-badge ${statusClass[statusKey] || "warn"}`;
    }

    const email = toText(item.email);
    const phoneTel = normalizePhoneForTel(item.phone);
    const phoneWa = normalizePhoneForWhatsapp(item.phone);
    setActionLink(el.actionEmail, email ? `mailto:${encodeURIComponent(email)}` : null);
    setActionLink(el.actionCall, phoneTel ? `tel:${phoneTel}` : null);
    setActionLink(el.actionWhatsapp, phoneWa ? `https://wa.me/${phoneWa}` : null);

    // Update the "Ver Ficha Completa" button
    const fichaBtn = document.getElementById("lead-action-ficha");
    if (fichaBtn instanceof HTMLAnchorElement) {
      fichaBtn.href = `/crm/leads/${encodeURIComponent(item.id)}${window.location.search}`;
    }
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

  const loadLeads = async () => {
    const params = buildListQuery();
    const payload = await request(`${apiBase}?${params.toString()}`);
    const items = Array.isArray(payload.data) ? payload.data : [];
    state.items = items;
    state.byId = new Map(items.map((item) => [String(item.id), item]));
    state.pagination.total = Number(payload.meta?.total ?? items.length);
    state.pagination.page = Number(payload.meta?.page ?? state.pagination.page);
    state.pagination.perPage = Number(payload.meta?.per_page ?? state.pagination.perPage);
    state.pagination.totalPages = Number(payload.meta?.total_pages ?? 1);

    if (el.perPageSelect instanceof HTMLSelectElement) {
      el.perPageSelect.value = String(state.pagination.perPage);
    }

    renderTable();
    renderMeta();
    renderPagination();

    if (state.selectedLeadId && state.byId.has(state.selectedLeadId)) selectLead(state.selectedLeadId);
    else clearDetail();
  };

  const clearFilterQueryFromUrl = () => {
    const next = new URL(window.location.href);
    ["q", "status", "origin_type", "operation_interest", "lead_kind", "project_id", "treated", "nationality", "page", "per_page"].forEach(
      (key) => next.searchParams.delete(key)
    );
    const qs = next.searchParams.toString();
    window.history.replaceState({}, "", `${next.pathname}${qs ? `?${qs}` : ""}`);
  };

  const resetFilters = () => {
    el.filterForm?.reset();
    FILTER_FIELD_NAMES.forEach((name) => setFormFieldValue(name, ""));
    if (el.projectSelect instanceof HTMLSelectElement) el.projectSelect.value = "";
    state.prefillProjectId = "";
    state.pagination.page = 1;
    if (el.perPageSelect instanceof HTMLSelectElement) {
      state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    }
    clearFilterQueryFromUrl();
  };

  el.filterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.pagination.page = 1;
    if (el.perPageSelect instanceof HTMLSelectElement) {
      state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    }
    try {
      await loadLeads();
      setFeedback("Listado de leads actualizado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando leads: ${error.message}`, "error");
    }
  });

  el.filterClear?.addEventListener("click", async () => {
    resetFilters();
    try {
      await loadLeads();
      setFeedback("Filtros limpiados y listado restaurado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando leads: ${error.message}`, "error");
    }
  });

  el.tbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("a")) return; // Let links be links
    const row = target.closest("tr[data-lead-id]");
    if (!(row instanceof HTMLTableRowElement)) return;
    selectLead(row.getAttribute("data-lead-id"));
  });

  el.tbody?.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = target.closest("tr[data-lead-id]");
    if (!(row instanceof HTMLTableRowElement)) return;
    event.preventDefault();
    selectLead(row.getAttribute("data-lead-id"));
  });

  el.pagination?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-page-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const action = button.getAttribute("data-page-action");
    if (action === "prev" && state.pagination.page > 1) {
      state.pagination.page -= 1;
    } else if (action === "next" && state.pagination.page < state.pagination.totalPages) {
      state.pagination.page += 1;
    } else {
      return;
    }

    try {
      await loadLeads();
      setFeedback("Listado de leads actualizado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando leads: ${error.message}`, "error");
    }
  });

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  state.prefillProjectId = toText(search.get("project_id")) || "";
  const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

  FILTER_FIELD_NAMES.forEach((name) => {
    if (name === "project_id") return;
    const value = toText(search.get(name));
    if (value) setFormFieldValue(name, value);
  });
  const queryPerPage = toNumber(search.get("per_page"));
  if (queryPerPage && el.perPageSelect instanceof HTMLSelectElement) {
    el.perPageSelect.value = String(queryPerPage);
    state.pagination.perPage = queryPerPage;
  } else if (el.perPageSelect instanceof HTMLSelectElement) {
    state.pagination.perPage = Number(el.perPageSelect.value) || 25;
  }

  void (async () => {
    try {
      await loadProjectOptions();
      await loadLeads();
      setFeedback("Modulo de leads cargado.", "ok");
    } catch (error) {
      setFeedback(`Error inicializando modulo: ${error.message}`, "error");
    }
  })();
})();
