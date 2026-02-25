(() => {
  const apiBase = "/api/v1/properties";
  const mediaCategories = [
    "living",
    "bedroom",
    "kitchen",
    "bathroom",
    "exterior",
    "interior",
    "views",
    "floorplan",
  ];

  const propertyStatuses = [
    "draft",
    "available",
    "reserved",
    "sold",
    "rented",
    "private",
    "archived",
  ];

  const businessLabels = {
    owned_and_commercialized: "Propia y comercializada",
    provider_and_commercialized_by_us: "Proveedor + comercializamos",
    external_listing: "Captacion externa",
  };

  const statusLabels = {
    draft: "Borrador",
    available: "Disponible",
    reserved: "Reservada",
    sold: "Vendida",
    rented: "Alquilada",
    private: "Privada",
    archived: "Archivada",
  };

  const reservationFlowLabels = {
    pre_registered: "Preinscrito",
    reservation_sent: "Reserva enviada",
    reserved: "Reservado",
    adhesion_paid: "Adhesion pagada",
    contract_signed: "Contrato firmado",
    cancelled: "Cancelado",
    discarded: "Descartado",
    other: "Otro",
  };

  const statusClass = {
    draft: "warn",
    available: "ok",
    reserved: "warn",
    sold: "danger",
    rented: "danger",
    private: "warn",
    archived: "danger",
  };

  const dashboardBuckets = [
    {
      key: "provider_and_commercialized_by_us",
      title: "Obra nueva",
      helper: "Proyectos de obra nueva comercializados por el equipo.",
    },
    {
      key: "external_listing",
      title: "Segunda mano",
      helper: "Captacion externa y producto de segunda mano.",
    },
    {
      key: "owned_and_commercialized",
      title: "Promociones nuestras",
      helper: "Promociones propias de la empresa.",
    },
  ];

  const state = {
    organizationId: "",
    organizationSource: "none",
    items: [],
    selectedId: null,
    selectedProjectId: null,
    requestedPropertyId: null,
    requestedProjectId: null,
    source: "",
    stats: null,
    clientProjectRows: [],
    clientProjectGeneratedAt: null,
    clientProjectError: null,
    propertyClientData: null,
    propertyClientMeta: null,
    propertyClientError: null,
    propertyClientLoading: false,
    propertyClientPropertyId: null,
    activePropertyTab: "client",
    projectDetailsCache: new Map(),
    parentLegacyById: new Map(),
    createPrefillApplied: false,
    pagination: {
      page: 1,
      perPage: 24,
      total: 0,
      totalPages: 1,
    },
    wizard: {
      step: 1,
      totalSteps: 3,
    },
  };

  const el = {
    orgForm: document.getElementById("crm-org-form"),
    orgInput: document.getElementById("crm-organization-id"),
    orgSourceBadge: document.getElementById("crm-org-source"),
    orgHelp: document.getElementById("crm-org-help"),
    createForm: document.getElementById("property-create-form"),
    filterForm: document.getElementById("property-filter-form"),
    clearFilters: document.getElementById("property-filters-clear"),
    reload: document.getElementById("properties-reload"),
    perPageSelect: document.getElementById("properties-per-page"),
    pagination: document.getElementById("properties-pagination"),
    pageInfo: document.getElementById("properties-page-info"),
    tbody: document.getElementById("properties-tbody"),
    mobileList: document.getElementById("properties-mobile-list"),
    meta: document.getElementById("properties-meta"),
    dashboardSummary: document.getElementById("properties-dashboard-summary"),
    dashboardGroups: document.getElementById("properties-dashboard-groups"),
    kpiGrid: document.getElementById("properties-kpi-grid"),
    statusBoard: document.getElementById("properties-status-board"),
    promotionsTbody: document.getElementById("properties-promotions-tbody"),
    clientLinkSummary: document.getElementById("properties-client-link-summary"),
    clientLinkTbody: document.getElementById("properties-client-link-tbody"),
    projectsList: document.getElementById("projects-list"),
    projectKpiGrid: document.getElementById("project-kpi-grid"),
    projectExecBoard: document.getElementById("project-exec-board"),
    projectDetail: document.getElementById("project-detail"),
    feedback: document.getElementById("properties-feedback"),
    editForm: document.getElementById("property-edit-form"),
    editFieldset: document.getElementById("property-edit-fieldset"),
    mediaForm: document.getElementById("property-media-form"),
    mediaFieldset: document.getElementById("property-media-fieldset"),
    mediaBoard: document.getElementById("property-media-board"),
    coverBox: document.getElementById("property-cover-box"),
    workspace: document.getElementById("property-workspace"),
    selectedPropertyContext: document.getElementById("selected-property-context"),
    propertyPageTitle: document.getElementById("property-page-title"),
    propertyPageSubtitle: document.getElementById("property-page-subtitle"),
    propertyPageMeta: document.getElementById("property-page-meta"),
    propertyPresentationGrid: document.getElementById("property-presentation-grid"),
    propertyTabbar: document.getElementById("property-tabbar"),
    propertyClientSummary: document.getElementById("property-client-summary"),
    propertyClientVerifiedList: document.getElementById("property-client-verified-list"),
    propertyClientCandidateList: document.getElementById("property-client-candidate-list"),
    propertyClientRefresh: document.getElementById("property-client-refresh"),
    projectPageTitle: document.getElementById("project-page-title"),
    projectPageSubtitle: document.getElementById("project-page-subtitle"),
    projectPageMeta: document.getElementById("project-page-meta"),
    wizardSteps: document.getElementById("property-create-steps"),
    wizardPrev: document.getElementById("property-create-prev"),
    wizardNext: document.getElementById("property-create-next"),
    wizardSubmit: document.getElementById("property-create-submit"),
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
    const text = String(value ?? "").trim();
    if (!text) return null;
    const parsed = Number(text.replace(",", "."));
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 10000) / 10000;
  };

  const toInt = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const normalized = Math.floor(parsed);
    if (normalized < min) return min;
    if (normalized > max) return max;
    return normalized;
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

  const renderOrganizationContext = () => {
    if (el.orgInput) el.orgInput.value = state.organizationId;
    if (el.orgSourceBadge) {
      el.orgSourceBadge.textContent = `Origen: ${organizationSourceLabel(state.organizationSource)}`;
      el.orgSourceBadge.className = `crm-badge ${
        state.organizationId ? "ok" : "warn"
      }`;
    }
    if (!el.orgHelp) return;

    if (!state.organizationId) {
      el.orgHelp.textContent =
        "Sin organizacion activa. Si solo trabajas con una, define CRM_ORGANIZATION_ID en .env y se autocompletara.";
      return;
    }

    el.orgHelp.textContent =
      "Este identificador filtra todo el CRM por tu empresa. Solo cambialo si gestionas varias organizaciones.";
  };

  const selected = () => {
    if (!state.selectedId) return null;
    const inPage = state.items.find((item) => item.id === state.selectedId);
    if (inPage) return inPage;
    for (const detail of state.projectDetailsCache.values()) {
      if (detail.project?.id === state.selectedId) return detail.project;
      const inUnits = detail.units.find((unit) => unit.id === state.selectedId);
      if (inUnits) return inUnits;
    }
    return null;
  };

  const findKnownPropertyById = (id) => {
    const normalized = toText(id);
    if (!normalized) return null;
    const inPage = state.items.find((item) => item.id === normalized);
    if (inPage) return inPage;
    for (const detail of state.projectDetailsCache.values()) {
      if (detail?.project?.id === normalized) return detail.project;
      const inUnits = detail?.units?.find((unit) => unit.id === normalized);
      if (inUnits) return inUnits;
    }
    return null;
  };

  const cachePropertyLegacyCode = (property) => {
    const propertyId = toText(property?.id);
    const legacyCode = toText(property?.legacy_code);
    if (!propertyId || !legacyCode) return;
    state.parentLegacyById.set(propertyId, legacyCode);
  };

  const ensureToastStack = () => {
    const existing = document.getElementById("crm-toast-stack");
    if (existing) return existing;
    const stack = document.createElement("div");
    stack.id = "crm-toast-stack";
    stack.className = "crm-toast-stack";
    document.body.append(stack);
    return stack;
  };

  const pushToast = (message, kind = "ok") => {
    const text = String(message ?? "").trim();
    if (!text) return;
    const stack = ensureToastStack();
    const toast = document.createElement("div");
    toast.className = `crm-toast ${kind === "error" ? "is-error" : "is-ok"}`;
    toast.textContent = text;
    stack.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 240);
    }, 2800);
  };

  const setFeedback = (message, kind, options = {}) => {
    if (el.feedback) {
      el.feedback.textContent = message;
      el.feedback.classList.remove("is-error", "is-ok");
      if (kind === "error") el.feedback.classList.add("is-error");
      if (kind === "ok") el.feedback.classList.add("is-ok");
    }
    if (options.toast) pushToast(message, kind);
  };

  const friendlyPropertyError = (rawMessage) => {
    const message = String(rawMessage || "");
    if (message.includes("parent_legacy_code_required_for_unit")) {
      return "Para una vivienda hija debes elegir una promocion padre o indicar su legacy_code.";
    }
    if (message.includes("parent_property_not_found")) {
      return "No se encontro la promocion padre indicada.";
    }
    if (message.includes("parent_property_must_be_project")) {
      return "La referencia padre debe ser una promocion, no una vivienda hija.";
    }
    return message;
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
      const detail = payload?.details || payload?.message || (payload ? null : raw.slice(0, 240) || null);
      throw new Error(detail ? `${errorCode}: ${detail}` : errorCode);
    }

    return payload;
  };

  const buildQuery = (options = {}) => {
    const {
      includeStats = false,
      page = state.pagination.page,
      perPage = state.pagination.perPage,
      projectId = null,
      ignoreFilters = false,
    } = options;

    const params = new URLSearchParams();

    if (state.organizationId) params.set("organization_id", state.organizationId);
    params.set("page", String(toInt(page, 1, 1, 10000)));
    params.set("per_page", String(toInt(perPage, 24, 1, 200)));
    if (includeStats) params.set("include_stats", "1");
    if (projectId) params.set("project_id", projectId);

    if (!ignoreFilters && el.filterForm) {
      const formData = new FormData(el.filterForm);
      for (const [key, value] of formData.entries()) {
        if (key === "per_page") continue;
        const text = String(value ?? "").trim();
        if (text) params.set(key, text);
      }
    }

    return params;
  };

  const navigateTo = (path, extraParams = {}) => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    Object.entries(extraParams).forEach(([key, value]) => {
      const text = String(value ?? "").trim();
      if (text) params.set(key, text);
    });
    const suffix = params.toString();
    window.location.href = suffix ? `${path}?${suffix}` : path;
  };

  const isCompactViewport = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;

  const openPropertyEditor = (id) => {
    const propertyId = toText(id);
    if (!propertyId) return;
    if (!el.editForm) {
      openPropertyPage(propertyId);
      return;
    }
    selectForEdit(propertyId);
  };

  const openPropertyPage = (id) => {
    const propertyId = toText(id);
    if (!propertyId) return;
    navigateTo(`/crm/properties/propiedad/${encodeURIComponent(propertyId)}/`);
  };

  const openProjectPage = (id) => {
    const projectId = toText(id);
    if (!projectId) return;
    navigateTo(`/crm/properties/promocion/${encodeURIComponent(projectId)}/`);
  };

  const openCreateUnitForProject = (id) => {
    const projectId = toText(id);
    if (!projectId) return;
    const project =
      findKnownPropertyById(projectId) ||
      (Array.isArray(state.stats?.promotions)
        ? state.stats.promotions.find((entry) => entry.id === projectId)
        : null);
    const parentLegacyCode = toText(project?.legacy_code);

    navigateTo("/crm/properties/nueva/", {
      record_type: "unit",
      project_id: projectId,
      ...(parentLegacyCode ? { parent_legacy_code: parentLegacyCode } : {}),
    });
  };

  const money = (item) => {
    const currency = item?.pricing?.currency || "EUR";
    if (item.operation_type === "sale") {
      return item.pricing?.price_sale != null ? `${item.pricing.price_sale} ${currency}` : "-";
    }
    if (item.operation_type === "rent") {
      if (item.pricing?.rent_price_on_request) return "Consultar";
      return item.pricing?.price_rent_monthly != null
        ? `${item.pricing.price_rent_monthly} ${currency}/mes`
        : "-";
    }
    const sale = item.pricing?.price_sale != null ? `${item.pricing.price_sale} ${currency}` : "-";
    const rent = item.pricing?.rent_price_on_request
      ? "Consultar"
      : item.pricing?.price_rent_monthly != null
        ? `${item.pricing.price_rent_monthly} ${currency}/mes`
        : "-";
    return `${sale} | ${rent}`;
  };

  const asFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatCurrency = (amount, currency = "EUR") => {
    const safeAmount = asFiniteNumber(amount);
    if (safeAmount == null) return "-";
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(safeAmount);
    } catch {
      return `${safeAmount} ${currency}`;
    }
  };

  const formatInt = (value) => {
    const safe = asFiniteNumber(value);
    if (safe == null) return "0";
    return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(safe);
  };

  const formatDecimal = (value, digits = 2) => {
    const safe = asFiniteNumber(value);
    if (safe == null) return "-";
    return new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(safe);
  };

  const formatPctValue = (value) => {
    const safe = asFiniteNumber(value);
    if (safe == null) return "-";
    return `${new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(safe)}%`;
  };

  const formatDate = (value) => {
    const text = toText(value);
    if (!text) return "-";
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [y, m, d] = text.split("-");
        return `${d}/${m}/${y}`;
      }
      return text;
    }
    return parsed.toLocaleDateString("es-ES");
  };

  const recordTypeLabel = (recordType) => {
    if (recordType === "project") return "Promocion";
    if (recordType === "unit") return "Vivienda de promocion";
    return "Vivienda individual";
  };

  const mediaCategoryLabel = (category) => {
    if (category === "living") return "Salon";
    if (category === "bedroom") return "Dormitorio";
    if (category === "kitchen") return "Cocina";
    if (category === "bathroom") return "Bano";
    if (category === "exterior") return "Exterior";
    if (category === "interior") return "Interior";
    if (category === "views") return "Vistas";
    if (category === "floorplan") return "Plano";
    return category;
  };

  const propertyLabel = (item, fallback = "-") => {
    const label = toText(item?.display_name) || toText(item?.legacy_code);
    return label || fallback;
  };

  const projectLabel = (item, fallback = "Promocion sin nombre") => {
    const label =
      toText(item?.project_name) || toText(item?.display_name) || toText(item?.legacy_code);
    return label || fallback;
  };

  const normalizeKey = (value) => String(value ?? "").trim().toLowerCase();

  const listParentProjectCandidates = () => {
    const byId = new Map();
    const register = (candidate) => {
      const id = toText(candidate?.id);
      if (!id) return;
      const recordType = toText(candidate?.record_type);
      if (recordType && recordType !== "project") return;
      const legacyCode = toText(candidate?.legacy_code);
      const label = projectLabel(candidate, legacyCode || "Promocion sin nombre");
      const normalized = {
        id,
        legacy_code: legacyCode,
        label,
        status: toText(candidate?.status),
        total_units: Number(candidate?.total_units ?? 0),
        available_units: Number(candidate?.available_units ?? 0),
      };
      const previous = byId.get(id);
      if (!previous) {
        byId.set(id, normalized);
        return;
      }
      byId.set(id, {
        ...previous,
        ...normalized,
        legacy_code: normalized.legacy_code || previous.legacy_code,
      });
    };

    const promotions = Array.isArray(state.stats?.promotions) ? state.stats.promotions : [];
    promotions.forEach((promo) => register(promo));
    state.items.forEach((item) => {
      if (item?.record_type === "project") register(item);
    });
    for (const detail of state.projectDetailsCache.values()) {
      if (detail?.project) register(detail.project);
    }

    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, "es"));
  };

  const findParentProjectByLegacyCode = (legacyCode) => {
    const normalized = normalizeKey(legacyCode);
    if (!normalized) return null;
    return (
      listParentProjectCandidates().find((entry) => normalizeKey(entry.legacy_code) === normalized) || null
    );
  };

  const renderParentProjectOptions = () => {
    const forms = [el.createForm, el.editForm].filter(Boolean);
    if (!forms.length) return;

    const projects = listParentProjectCandidates();
    const hasProjects = projects.length > 0;

    forms.forEach((form) => {
      const parentSelect = form.querySelector("select[data-parent-project-select]");
      const parentField = form.elements?.parent_legacy_code;
      const helper = form.querySelector("[data-parent-link-helper]");
      if (!(parentSelect instanceof HTMLSelectElement)) return;
      if (!(parentField instanceof HTMLInputElement)) return;

      const currentSelectValue = toText(parentSelect.value);
      const currentLegacyCode = toText(parentField.value);

      const optionRows = projects
        .map((project) => {
          const legacySuffix = project.legacy_code ? ` - ${project.legacy_code}` : "";
          const stockSuffix =
            project.total_units > 0
              ? ` - ${project.available_units}/${project.total_units} disponibles`
              : "";
          return `<option value="${esc(project.id)}" data-legacy-code="${esc(
            project.legacy_code || ""
          )}">${esc(`${project.label}${legacySuffix}${stockSuffix}`)}</option>`;
        })
        .join("");

      parentSelect.innerHTML = `
        <option value="">Selecciona una promocion...</option>
        ${optionRows}
      `;

      if (currentSelectValue && projects.some((entry) => entry.id === currentSelectValue)) {
        parentSelect.value = currentSelectValue;
      } else {
        const matchByLegacy = currentLegacyCode ? findParentProjectByLegacyCode(currentLegacyCode) : null;
        parentSelect.value = matchByLegacy?.id || "";
      }

      if (helper instanceof HTMLElement) {
        helper.textContent = hasProjects
          ? "Selecciona la promocion para autocompletar el codigo padre. Si no aparece, escribe el codigo manual."
          : "No hay promociones cargadas para seleccionar. Puedes escribir el codigo manual de la promocion padre.";
      }
    });
  };

  const syncParentProjectSelection = (form, preferredProjectId = null) => {
    if (!form) return;
    const parentSelect = form.querySelector("select[data-parent-project-select]");
    const parentField = form.elements?.parent_legacy_code;
    if (!(parentSelect instanceof HTMLSelectElement)) return;
    if (!(parentField instanceof HTMLInputElement)) return;

    const preferredId = toText(preferredProjectId);
    if (preferredId && listParentProjectCandidates().some((entry) => entry.id === preferredId)) {
      parentSelect.value = preferredId;
      const option = parentSelect.selectedOptions[0];
      const legacyCode = toText(option?.getAttribute("data-legacy-code"));
      if (legacyCode) parentField.value = legacyCode;
      return;
    }

    const legacyCode = toText(parentField.value);
    const matchByLegacy = legacyCode ? findParentProjectByLegacyCode(legacyCode) : null;
    parentSelect.value = matchByLegacy?.id || "";
  };

  const bindParentProjectForm = (form) => {
    if (!form) return;
    const parentSelect = form.querySelector("select[data-parent-project-select]");
    const parentField = form.elements?.parent_legacy_code;
    if (!(parentSelect instanceof HTMLSelectElement)) return;
    if (!(parentField instanceof HTMLInputElement)) return;
    if (parentSelect.dataset.bound === "1") return;

    parentSelect.dataset.bound = "1";
    parentSelect.addEventListener("change", () => {
      const option = parentSelect.selectedOptions[0];
      const legacyCode = toText(option?.getAttribute("data-legacy-code"));
      if (legacyCode) parentField.value = legacyCode;
    });

    parentField.addEventListener("input", () => {
      syncParentProjectSelection(form);
    });
  };

  const propertyRef = (item, fallback = "sin codigo") => {
    const code = toText(item?.legacy_code);
    return code || fallback;
  };

  const statusLabel = (status) => statusLabels[status] || status || "-";

  const resolveProjectPortalState = (project) => {
    const row = project && typeof project === "object" ? project : {};
    const portal = row.portal && typeof row.portal === "object" ? row.portal : {};
    const propertyData =
      row.property_data && typeof row.property_data === "object" ? row.property_data : {};
    const legacyPortalEnabled = typeof row.portal_enabled === "boolean" ? row.portal_enabled : null;

    const explicitFromPortal =
      typeof portal.is_explicit === "boolean"
        ? portal.is_explicit
        : typeof propertyData.portal_enabled === "boolean" || typeof legacyPortalEnabled === "boolean";
    const enabledFromPortal =
      typeof portal.is_enabled === "boolean"
        ? portal.is_enabled
        : typeof propertyData.portal_enabled === "boolean"
          ? propertyData.portal_enabled
          : typeof legacyPortalEnabled === "boolean"
            ? legacyPortalEnabled
          : true;

    const publishedAt =
      toText(portal.published_at) ||
      toText(propertyData.portal_published_at) ||
      toText(row.portal_published_at);
    const updatedAt =
      toText(portal.updated_at) || toText(propertyData.portal_updated_at) || toText(row.portal_updated_at);

    return {
      enabled: enabledFromPortal,
      explicit: explicitFromPortal,
      publishedAt,
      updatedAt,
      badgeClass: enabledFromPortal ? "ok" : "warn",
      badgeLabel: enabledFromPortal ? "Portal activo" : "Portal pausado",
      actionLabel: enabledFromPortal ? "Quitar del portal" : "Subir al portal",
      nextActionValue: enabledFromPortal ? "false" : "true",
    };
  };

  const formatPercent = (value, total) => {
    const numerator = Number(value ?? 0);
    const denominator = Number(total ?? 0);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 100);
  };

  const resolveParentLegacyCode = (item) => {
    const parentId = toText(item?.parent_property_id);
    if (!parentId) return null;
    return state.parentLegacyById.get(parentId) || toText(findKnownPropertyById(parentId)?.legacy_code);
  };

  const renderSelectedPropertyContext = (item) => {
    if (!el.selectedPropertyContext) return;
    if (!item) {
      el.selectedPropertyContext.innerHTML = `
        <p class="crm-selected-context-kicker">Contexto activo</p>
        <h4 class="crm-selected-context-title">Sin propiedad seleccionada</h4>
        <p class="crm-selected-context-meta">Selecciona una propiedad del listado para editar la ficha.</p>
      `;
      return;
    }

    const parentLegacyCode = resolveParentLegacyCode(item);
    const priceLabel = money(item);
    const badges = [
      `<span class="crm-selected-context-badge">${esc(recordTypeLabel(item.record_type))}</span>`,
      `<span class="crm-selected-context-badge">${esc(statusLabel(item.status))}</span>`,
    ];
    if (priceLabel !== "-") badges.push(`<span class="crm-selected-context-badge">${esc(priceLabel)}</span>`);
    if (parentLegacyCode) {
      badges.push(`<span class="crm-selected-context-badge">Padre: ${esc(parentLegacyCode)}</span>`);
    }
    if (item.record_type === "project") {
      const portalState = resolveProjectPortalState(item);
      badges.push(
        `<span class="crm-selected-context-badge">Portal: ${esc(
          portalState.enabled ? "Activo" : "Pausado"
        )}</span>`
      );
    }

    el.selectedPropertyContext.innerHTML = `
      <p class="crm-selected-context-kicker">Contexto activo</p>
      <h4 class="crm-selected-context-title">${esc(propertyLabel(item, "Propiedad sin nombre"))}</h4>
      <p class="crm-selected-context-meta">Ref: ${esc(propertyRef(item))}</p>
      <div class="crm-selected-context-badges">${badges.join("")}</div>
    `;
  };

  const syncPropertyPageContext = (item) => {
    if (!el.propertyPageTitle) return;
    if (!item) {
      el.propertyPageTitle.textContent = "Ficha de propiedad";
      if (el.propertyPageSubtitle) {
        el.propertyPageSubtitle.textContent =
          "Gestion completa de datos comerciales, estado e imagenes en una sola vista.";
      }
      if (el.propertyPageMeta) {
        el.propertyPageMeta.textContent = "Cargando contexto de la propiedad...";
      }
      return;
    }

    const parentLegacyCode = resolveParentLegacyCode(item);
    const priceLabel = money(item);
    const subtitleParts = [recordTypeLabel(item.record_type), statusLabel(item.status)];
    const metaParts = [`Ref: ${propertyRef(item)}`];
    if (priceLabel !== "-") metaParts.push(priceLabel);
    if (parentLegacyCode) metaParts.push(`Padre: ${parentLegacyCode}`);

    el.propertyPageTitle.textContent = propertyLabel(item, "Propiedad sin nombre");
    if (el.propertyPageSubtitle) el.propertyPageSubtitle.textContent = subtitleParts.join(" | ");
    if (el.propertyPageMeta) el.propertyPageMeta.textContent = metaParts.join(" | ");
  };

  const renderPropertyPresentation = (item) => {
    if (!el.propertyPresentationGrid) return;
    if (!item) {
      el.propertyPresentationGrid.innerHTML = `
        <article class="crm-property-metric"><small>Estado comercial</small><strong>-</strong></article>
        <article class="crm-property-metric"><small>Tipo</small><strong>-</strong></article>
        <article class="crm-property-metric"><small>Precio objetivo</small><strong>-</strong></article>
        <article class="crm-property-metric"><small>Superficie</small><strong>-</strong></article>
        <article class="crm-property-metric"><small>Dormitorios</small><strong>-</strong></article>
        <article class="crm-property-metric"><small>Banos</small><strong>-</strong></article>
      `;
      return;
    }

    const area = asFiniteNumber(item?.operational?.area_m2);
    const bedrooms = asFiniteNumber(item?.operational?.bedrooms);
    const bathrooms = asFiniteNumber(item?.operational?.bathrooms);
    const totalMedia = mediaCategories.reduce((acc, category) => {
      const list = Array.isArray(item?.media?.gallery?.[category]) ? item.media.gallery[category] : [];
      return acc + list.length;
    }, item?.media?.cover ? 1 : 0);

    const metrics = [
      { label: "Estado comercial", value: statusLabel(item.status) },
      { label: "Tipo", value: recordTypeLabel(item.record_type) },
      { label: "Precio objetivo", value: money(item) },
      { label: "Superficie", value: area == null ? "-" : `${formatDecimal(area, 2)} m2` },
      { label: "Dormitorios", value: bedrooms == null ? "-" : formatDecimal(bedrooms, 0) },
      { label: "Banos", value: bathrooms == null ? "-" : formatDecimal(bathrooms, 0) },
      { label: "Media total", value: formatInt(totalMedia) },
      { label: "Ultima actualizacion", value: formatDate(item.updated_at) },
    ];

    el.propertyPresentationGrid.innerHTML = metrics
      .map(
        (metric) => `
          <article class="crm-property-metric">
            <small>${esc(metric.label)}</small>
            <strong>${esc(metric.value || "-")}</strong>
          </article>
        `
      )
      .join("");
  };

  const setPropertyTab = (tabName) => {
    const requested = toText(tabName) || "client";
    const panelNodes = Array.from(document.querySelectorAll("[data-property-tab-panel]"));
    const hasRequested = panelNodes.some(
      (node) =>
        node instanceof HTMLElement && node.getAttribute("data-property-tab-panel") === requested
    );
    const normalized = hasRequested ? requested : "client";
    state.activePropertyTab = normalized;

    const buttons = document.querySelectorAll("button[data-property-tab-trigger]");
    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const isActive = button.getAttribute("data-property-tab-trigger") === normalized;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panelNodes.forEach((panel) => {
      if (!(panel instanceof HTMLElement)) return;
      const isActive = panel.getAttribute("data-property-tab-panel") === normalized;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
  };

  const syncProjectPageContext = (project, units = []) => {
    if (!el.projectPageTitle) return;
    if (!project) {
      el.projectPageTitle.textContent = "Vista de promocion";
      if (el.projectPageSubtitle) {
        el.projectPageSubtitle.textContent =
          "Seguimiento operativo de una promocion concreta con KPIs y estado de viviendas.";
      }
      if (el.projectPageMeta) {
        el.projectPageMeta.textContent = "Selecciona una promocion para cargar su contexto.";
      }
      return;
    }

    const totalUnits = Array.isArray(units) ? units.length : 0;
    const availableUnits = Array.isArray(units) ? units.filter((item) => isAvailable(item)).length : 0;
    const priceLabel = money(project);
    const businessType = project?.project_business_type || project?.business_type;
    const portalState = resolveProjectPortalState(project);
    const subtitleParts = [
      businessLabels[businessType] || businessType || "Promocion",
      totalUnits ? `${availableUnits}/${totalUnits} disponibles` : "Sin viviendas hijas cargadas",
    ];
    const metaParts = [`Ref: ${propertyRef(project)}`, `Estado: ${statusLabel(project.status)}`];
    metaParts.push(`Portal: ${portalState.enabled ? "Activo" : "Pausado"}`);
    if (priceLabel !== "-") metaParts.push(priceLabel);

    el.projectPageTitle.textContent = projectLabel(project);
    if (el.projectPageSubtitle) el.projectPageSubtitle.textContent = subtitleParts.join(" | ");
    if (el.projectPageMeta) el.projectPageMeta.textContent = metaParts.join(" | ");
  };

  const isAvailable = (item) => item?.status === "available";

  const availabilityBadge = (item) => {
    if (isAvailable(item)) return { className: "ok", label: "Disponible" };
    if (item?.status === "reserved") return { className: "warn", label: "No disponible" };
    return { className: "danger", label: "No disponible" };
  };

  const renderDashboardKpis = () => {
    if (!el.kpiGrid) return;
    const stats = state.stats;
    if (!stats) {
      el.kpiGrid.innerHTML = "";
      return;
    }

    const total = Number(stats.total ?? 0);
    const available = Number(stats.available_total ?? 0);
    const projects = Number(stats.projects_total ?? 0);
    const units = Number(stats.units_total ?? 0);
    const singles = Number(stats.singles_total ?? 0);
    const availabilityRate = formatPercent(available, total);

    const cards = [
      {
        label: "Total propiedades",
        value: total,
        hint: "Inventario total del CRM",
      },
      {
        label: "Disponibles",
        value: available,
        hint: `${availabilityRate}% del inventario`,
      },
      {
        label: "Promociones",
        value: projects,
        hint: `${singles} viviendas sueltas`,
      },
      {
        label: "Viviendas de promocion",
        value: units,
        hint: "Unidades hijas cargadas",
      },
    ];

    el.kpiGrid.innerHTML = cards
      .map(
        (card, index) => `
          <article class="crm-card crm-kpi ${index === 0 ? "crm-kpi-highlight" : ""}">
            <strong>${esc(card.value)}</strong>
            <p>${esc(card.label)}</p>
            <small class="crm-kpi-hint">${esc(card.hint)}</small>
          </article>
        `
      )
      .join("");
  };

  const renderStatusBoard = () => {
    if (!el.statusBoard) return;
    const stats = state.stats;
    if (!stats?.by_status) {
      el.statusBoard.innerHTML = "<p class='crm-inline-note'>Sin datos de estado.</p>";
      return;
    }

    const total = Number(stats.total ?? 0);
    el.statusBoard.innerHTML = propertyStatuses
      .map((status) => {
        const count = Number(stats.by_status?.[status] ?? 0);
        const percentage = formatPercent(count, total);
        const chipClass = statusClass[status] || "warn";
        return `
          <span class="crm-status-chip ${chipClass}">
            <span class="crm-status-chip-label">${esc(statusLabels[status] || status)}</span>
            <strong>${esc(count)}</strong>
            <small>${esc(percentage)}%</small>
          </span>
        `;
      })
      .join("");
  };

  const renderPromotionTable = () => {
    if (!el.promotionsTbody) return;
    const promotions = Array.isArray(state.stats?.promotions) ? state.stats.promotions : [];
    if (!promotions.length) {
      el.promotionsTbody.innerHTML = "<tr><td colspan='7'>Sin promociones para mostrar.</td></tr>";
      return;
    }

    const ordered = [...promotions].sort((a, b) => {
      const availableDiff = Number(b.available_units ?? 0) - Number(a.available_units ?? 0);
      if (availableDiff !== 0) return availableDiff;
      const totalDiff = Number(b.total_units ?? 0) - Number(a.total_units ?? 0);
      if (totalDiff !== 0) return totalDiff;
      return projectLabel(a).localeCompare(projectLabel(b), "es");
    });

    el.promotionsTbody.innerHTML = ordered
      .slice(0, 20)
      .map((promo) => {
        const businessType = promo.business_type || promo.project_business_type;
        return `
          <tr>
            <td><strong>${esc(projectLabel(promo))}</strong><br /><small>${esc(propertyRef(promo))}</small></td>
            <td>${esc(businessLabels[businessType] || businessType || "-")}</td>
            <td><span class="crm-badge ${statusClass[promo.status] || "warn"}">${esc(statusLabel(promo.status))}</span></td>
            <td>${esc(promo.total_units ?? 0)}</td>
            <td>${esc(promo.available_units ?? 0)}</td>
            <td>${esc(promo.reserved_units ?? 0)}</td>
            <td>${esc((promo.sold_units ?? 0) + (promo.rented_units ?? 0))}</td>
          </tr>
        `;
      })
      .join("");
  };

  const renderProjectClientLinks = () => {
    if (!el.clientLinkTbody) return;

    if (state.clientProjectError) {
      el.clientLinkTbody.innerHTML = `<tr><td colspan="9">Error cargando vinculacion: ${esc(
        state.clientProjectError
      )}</td></tr>`;
      if (el.clientLinkSummary) {
        el.clientLinkSummary.textContent = "No se pudo cargar la conexion proyecto-cliente.";
      }
      return;
    }

    const rows = Array.isArray(state.clientProjectRows) ? state.clientProjectRows : [];
    if (!rows.length) {
      el.clientLinkTbody.innerHTML =
        "<tr><td colspan='9'>Sin vinculacion de clientes para las promociones filtradas.</td></tr>";
      if (el.clientLinkSummary) {
        el.clientLinkSummary.textContent = "Sin datos de vinculacion proyecto-cliente en este contexto.";
      }
      return;
    }

    const linkedPromotions = rows.filter((row) => Number(row.reservations_total ?? 0) > 0).length;
    const generatedAtDate = state.clientProjectGeneratedAt ? new Date(state.clientProjectGeneratedAt) : null;
    const generatedAtText =
      generatedAtDate && !Number.isNaN(generatedAtDate.getTime())
        ? generatedAtDate.toLocaleString("es-ES")
        : "sin fecha";

    if (el.clientLinkSummary) {
      el.clientLinkSummary.textContent =
        `${linkedPromotions} promociones con clientes vinculados | ${rows.length} promociones evaluadas | Actualizado: ${generatedAtText}`;
    }

    el.clientLinkTbody.innerHTML = rows
      .slice(0, 30)
      .map((row) => `
        <tr>
          <td>
            <strong>${esc(row.project_label)}</strong><br />
            <small>${esc(row.project_ref)}</small>
          </td>
          <td>${esc(formatInt(row.total_units))}</td>
          <td>${esc(formatInt(row.available_units))}</td>
          <td>${esc(formatInt(row.clients_total))}</td>
          <td>${esc(formatInt(row.reservations_total))}</td>
          <td>${esc(formatInt(row.active_reservations_total))}</td>
          <td>${esc(formatPctValue(row.active_reservations_pct))}</td>
          <td>${esc(formatDecimal(row.reservations_per_client, 2))}</td>
          <td>${esc(row.top_status_label)}</td>
        </tr>
      `)
      .join("");
  };

  const loadProjectClientLinks = async () => {
    if (!el.clientLinkTbody && !el.clientLinkSummary) return;

    if (!state.organizationId) {
      state.clientProjectRows = [];
      state.clientProjectGeneratedAt = null;
      state.clientProjectError = "organization_id_required";
      renderProjectClientLinks();
      return;
    }

    try {
      const params = new URLSearchParams({ organization_id: state.organizationId });
      const payload = await request(`/api/v1/clients/kpis?${params.toString()}`);
      const clientPromotions = Array.isArray(payload?.data?.promotions) ? payload.data.promotions : [];
      const propertyPromotions = Array.isArray(state.stats?.promotions) ? state.stats.promotions : [];

      const clientByProjectId = new Map();
      clientPromotions.forEach((row) => {
        const key = toText(row?.project_id);
        if (!key) return;
        clientByProjectId.set(key, row);
      });

      const propertyByProjectId = new Map();
      propertyPromotions.forEach((row) => {
        const key = toText(row?.id);
        if (!key) return;
        propertyByProjectId.set(key, row);
      });

      const projectIds =
        propertyByProjectId.size > 0
          ? new Set(propertyByProjectId.keys())
          : new Set(clientByProjectId.keys());
      const mergedRows = Array.from(projectIds)
        .map((projectId) => {
          const propertyPromo = propertyByProjectId.get(projectId);
          const clientPromo = clientByProjectId.get(projectId);

          const reservationsTotal = Number(clientPromo?.reservations_total ?? 0);
          const activeReservationsTotal = Number(clientPromo?.active_reservations_total ?? 0);
          const clientsTotal = Number(clientPromo?.clients_total ?? 0);
          const activeReservationsPct = Number(clientPromo?.active_reservations_pct ?? 0);

          return {
            project_id: projectId,
            project_label:
              propertyPromo?.project_name ||
              propertyPromo?.display_name ||
              propertyPromo?.legacy_code ||
              clientPromo?.project_name ||
              clientPromo?.project_legacy_code ||
              "Promocion",
            project_ref:
              propertyPromo?.legacy_code || toText(clientPromo?.project_legacy_code) || "sin codigo",
            total_units: Number(propertyPromo?.total_units ?? 0),
            available_units: Number(propertyPromo?.available_units ?? 0),
            clients_total: clientsTotal,
            reservations_total: reservationsTotal,
            active_reservations_total: activeReservationsTotal,
            active_reservations_pct: activeReservationsPct,
            reservations_per_client: clientsTotal > 0 ? reservationsTotal / clientsTotal : null,
            top_status: toText(clientPromo?.top_status) || null,
            top_status_label:
              reservationFlowLabels[toText(clientPromo?.top_status)] ||
              toText(clientPromo?.top_status) ||
              "-",
          };
        })
        .sort((a, b) => {
          if (b.clients_total !== a.clients_total) return b.clients_total - a.clients_total;
          if (b.active_reservations_total !== a.active_reservations_total) {
            return b.active_reservations_total - a.active_reservations_total;
          }
          if (b.reservations_total !== a.reservations_total) return b.reservations_total - a.reservations_total;
          return String(a.project_label).localeCompare(String(b.project_label), "es");
        });

      state.clientProjectRows = mergedRows;
      state.clientProjectGeneratedAt = toText(payload?.data?.generated_at);
      state.clientProjectError = null;
    } catch (error) {
      state.clientProjectRows = [];
      state.clientProjectGeneratedAt = null;
      state.clientProjectError = String(error?.message || "client_project_links_error");
    }

    renderProjectClientLinks();
  };

  const buyerRoleLabel = (value) => {
    if (value === "primary") return "Titular";
    if (value === "co_buyer") return "Cotitular";
    if (value === "legal_representative") return "Representante";
    return "Otro";
  };

  const matchConfidenceLabel = (value) => {
    if (value === "high") return "Alta";
    if (value === "medium") return "Media";
    return "Baja";
  };

  const reservationStatusLabel = (value) => {
    const normalized = toText(value);
    return reservationFlowLabels[normalized] || normalized || "Otro";
  };

  const renderClientCardBody = (client, extraBadges = []) => {
    if (!client) return "<p class='crm-inline-note'>Cliente no disponible.</p>";
    const title = client.full_name || client.client_code || "Cliente";
    const badges = [];
    if (client.client_status) badges.push(client.client_status);
    if (client.client_type) badges.push(client.client_type === "company" ? "Empresa" : "Particular");
    badges.push(...extraBadges.filter(Boolean));
    return `
      <h5>${esc(title)}</h5>
      <p class="crm-property-client-meta">
        ${esc(client.email || "-")} | ${esc(client.phone || "-")}
      </p>
      <p class="crm-property-client-meta">
        ID fiscal: ${esc(client.tax_id || "-")} | Codigo: ${esc(client.client_code || "-")}
      </p>
      <div class="crm-property-client-badges">
        ${badges.map((badge) => `<span class="crm-selected-context-badge">${esc(badge)}</span>`).join("")}
      </div>
    `;
  };

  const renderPropertyClientLinks = () => {
    if (!el.propertyClientSummary || !el.propertyClientVerifiedList || !el.propertyClientCandidateList) return;

    if (state.propertyClientLoading) {
      el.propertyClientSummary.textContent = "Cargando vinculacion vivienda-cliente...";
      el.propertyClientVerifiedList.innerHTML = "<p class='crm-inline-note'>Cargando vinculos verificados...</p>";
      el.propertyClientCandidateList.innerHTML = "<p class='crm-inline-note'>Cargando candidatos...</p>";
      return;
    }

    if (state.propertyClientError) {
      el.propertyClientSummary.textContent = `Error cargando vinculacion: ${state.propertyClientError}`;
      el.propertyClientVerifiedList.innerHTML = "<p class='crm-inline-note'>No disponible.</p>";
      el.propertyClientCandidateList.innerHTML = "<p class='crm-inline-note'>No disponible.</p>";
      return;
    }

    const payload = state.propertyClientData;
    const summary = payload?.summary || {};
    const verified = Array.isArray(payload?.verified_links) ? payload.verified_links : [];
    const candidates = Array.isArray(payload?.reservation_candidates) ? payload.reservation_candidates : [];
    const linkStatus = toText(payload?.link_status) || "not_linked";
    const warnings = Array.isArray(state.propertyClientMeta?.warnings)
      ? state.propertyClientMeta.warnings.filter((entry) => toText(entry))
      : [];
    const candidatesDisabled = warnings.includes("reservation_candidates_disabled");
    const statusLabel =
      linkStatus === "verified"
        ? "Verificado"
        : linkStatus === "pending_verification"
          ? "Pendiente de verificacion"
          : "Sin vinculo";

    el.propertyClientSummary.textContent =
      `${statusLabel} | Verificados: ${formatInt(summary.verified_active_buyers_total || 0)} compradores activos | ` +
      `Candidatos: ${formatInt(summary.reservation_candidates_total || 0)}`;
    if (warnings.length) {
      el.propertyClientSummary.textContent += ` | Avisos: ${warnings.join(", ")}`;
    }

    if (!verified.length) {
      el.propertyClientVerifiedList.innerHTML =
        "<p class='crm-inline-note'>Sin vinculo legal verificado para esta vivienda.</p>";
    } else {
      el.propertyClientVerifiedList.innerHTML = verified
        .map((entry) => {
          const buyerBadges = [
            buyerRoleLabel(entry.buyer_role),
            entry.is_active ? "Activo" : "Inactivo",
            entry.civil_status ? `Estado civil: ${entry.civil_status}` : null,
            entry.marital_regime ? `Regimen: ${entry.marital_regime}` : null,
            entry.ownership_share != null ? `Titularidad ${formatDecimal(entry.ownership_share, 2)}%` : null,
          ];
          return `
            <article class="crm-property-client-card">
              ${renderClientCardBody(entry.client, buyerBadges)}
              <div class="crm-property-client-card-footer">
              <small>Fuente: ${esc(entry.link_source || "manual")} | Alta: ${esc(formatDate(entry.created_at))}</small>
              </div>
            </article>
          `;
        })
        .join("");
    }

    if (candidatesDisabled) {
      el.propertyClientCandidateList.innerHTML =
        "<p class='crm-inline-note'>Candidatos automaticos anulados. Relaciona clientes-viviendas con CSV controlado.</p>";
      return;
    }

    if (!candidates.length) {
      el.propertyClientCandidateList.innerHTML =
        "<p class='crm-inline-note'>Sin candidatos en reservas importadas para esta vivienda.</p>";
      return;
    }

    el.propertyClientCandidateList.innerHTML = candidates
      .map((entry) => {
        const candidateBadges = [
          `Confianza ${matchConfidenceLabel(entry.match_confidence)}`,
          reservationStatusLabel(entry.reservation_status),
          entry.buyer_civil_status ? `Estado civil: ${entry.buyer_civil_status}` : null,
        ];
        const reasons = Array.isArray(entry.match_reasons) ? entry.match_reasons : [];
        return `
          <article class="crm-property-client-card">
            ${renderClientCardBody(entry.client, candidateBadges)}
            <p class="crm-property-client-meta">
              Reserva: ${esc(formatDate(entry.reservation_date))} | Unidad: ${esc(entry.unit_reference || "-")}
            </p>
            <p class="crm-property-client-meta">
              Match: ${esc(formatInt(entry.match_score || 0))} | ${esc(reasons.join(", ") || "sin detalle")}
            </p>
            <div class="crm-actions-row">
              <button
                type="button"
                class="crm-mini-btn"
                data-property-client-action="link-primary"
                data-client-id="${esc(entry.client_id)}"
              >Vincular titular</button>
              <button
                type="button"
                class="crm-mini-btn"
                data-property-client-action="link-co-buyer"
                data-client-id="${esc(entry.client_id)}"
              >Vincular cotitular</button>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const loadPropertyClientLinks = async (item, { force = false } = {}) => {
    if (!el.propertyClientSummary || !el.propertyClientVerifiedList || !el.propertyClientCandidateList) return;

    const propertyId = toText(item?.id);
    if (!propertyId) {
      state.propertyClientData = null;
      state.propertyClientMeta = null;
      state.propertyClientError = null;
      state.propertyClientLoading = false;
      state.propertyClientPropertyId = null;
      renderPropertyClientLinks();
      return;
    }

    if (
      !force &&
      state.propertyClientPropertyId === propertyId &&
      !state.propertyClientLoading &&
      !state.propertyClientError &&
      state.propertyClientData
    ) {
      renderPropertyClientLinks();
      return;
    }

    state.propertyClientLoading = true;
    state.propertyClientError = null;
    state.propertyClientPropertyId = propertyId;
    renderPropertyClientLinks();

    try {
      const params = new URLSearchParams();
      if (state.organizationId) params.set("organization_id", state.organizationId);
      params.set("max_candidates", "30");
      const payload = await request(
        `${apiBase}/${encodeURIComponent(propertyId)}/clients?${params.toString()}`
      );
      state.propertyClientData = payload?.data || null;
      state.propertyClientMeta = payload?.meta || null;
      state.propertyClientError = null;
    } catch (error) {
      state.propertyClientData = null;
      state.propertyClientMeta = null;
      state.propertyClientError = String(error?.message || "property_client_links_error");
    } finally {
      state.propertyClientLoading = false;
      renderPropertyClientLinks();
    }
  };

  const upsertPropertyClientLink = async ({ propertyId, clientId, buyerRole }) => {
    const normalizedPropertyId = toText(propertyId);
    const normalizedClientId = toText(clientId);
    if (!normalizedPropertyId || !normalizedClientId) return;

    const payload = {
      organization_id: state.organizationId || null,
      client_id: normalizedClientId,
      buyer_role: buyerRole,
      is_active: true,
      link_source: "manual",
    };

    await request(`${apiBase}/${encodeURIComponent(normalizedPropertyId)}/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  const renderDashboardGroups = () => {
    if (!el.dashboardGroups) return;

    const promotions = Array.isArray(state.stats?.promotions) ? state.stats.promotions : [];
    const grouped = new Map(dashboardBuckets.map((bucket) => [bucket.key, []]));
    promotions.forEach((promo) => {
      const businessType = promo.business_type || promo.project_business_type;
      if (!grouped.has(businessType)) return;
      grouped.get(businessType).push(promo);
    });

    el.dashboardGroups.innerHTML = dashboardBuckets
      .map((bucket) => {
        const rows = [...(grouped.get(bucket.key) || [])].sort((a, b) => {
          const availableDiff = Number(b.available_units ?? 0) - Number(a.available_units ?? 0);
          if (availableDiff !== 0) return availableDiff;
          const totalDiff = Number(b.total_units ?? 0) - Number(a.total_units ?? 0);
          if (totalDiff !== 0) return totalDiff;
          return projectLabel(a).localeCompare(projectLabel(b), "es");
        });
        const totalUnits = rows.reduce((sum, item) => sum + Number(item.total_units ?? 0), 0);
        const availableUnits = rows.reduce((sum, item) => sum + Number(item.available_units ?? 0), 0);
        const visibleRows = rows.slice(0, 8);
        const overflowCount = rows.length - visibleRows.length;
        const rowsHtml = visibleRows.length
          ? `${visibleRows
              .map((entry) => {
                const entryTotalUnits = Number(entry.total_units ?? 0);
                const entryAvailableUnits = Number(entry.available_units ?? 0);
                const availabilityPercent = formatPercent(entryAvailableUnits, entryTotalUnits);
                return `
                  <li class="crm-dashboard-promo-item">
                    <div>
                      <strong>${esc(projectLabel(entry))}</strong>
                      <small>Ref: ${esc(propertyRef(entry))}</small>
                      <small>${esc(entryAvailableUnits)} / ${esc(entryTotalUnits)} disponibles (${esc(
                        availabilityPercent
                      )}%)</small>
                    </div>
                    <span class="crm-badge ${entryAvailableUnits > 0 ? "ok" : "warn"}">${esc(
                      entryTotalUnits
                    )} viviendas</span>
                    <div class="crm-actions-row">
                      <button type="button" class="crm-mini-btn" data-dashboard-action="open-project" data-project-id="${esc(
                        entry.id
                      )}">Abrir</button>
                      <button type="button" class="crm-mini-btn" data-dashboard-action="create-unit" data-project-id="${esc(
                        entry.id
                      )}">Nueva hija</button>
                    </div>
                  </li>
                `;
              })
              .join("")}${
              overflowCount > 0
                ? `<li class='crm-dashboard-promo-item-empty'>+${esc(overflowCount)} promociones mas...</li>`
                : ""
            }`
          : "<li class='crm-dashboard-promo-item-empty'>Sin promociones con los filtros actuales.</li>";

        return `
          <article class="crm-dashboard-column">
            <h3>${esc(bucket.title)}</h3>
            <p class="crm-inline-note">${esc(bucket.helper)}</p>
            <p class="crm-dashboard-column-summary">${esc(rows.length)} promociones | ${esc(
              availableUnits
            )} de ${esc(totalUnits)} disponibles</p>
            <ul class="crm-dashboard-promo-list">${rowsHtml}</ul>
          </article>
        `;
      })
      .join("");

    if (el.dashboardSummary) {
      const stats = state.stats;
      if (!stats) {
        el.dashboardSummary.textContent = "Sin datos de dashboard.";
      } else {
        const total = Number(stats.total ?? 0);
        const available = Number(stats.available_total ?? 0);
        const projects = Number(stats.projects_total ?? 0);
        const units = Number(stats.units_total ?? 0);
        const singles = Number(stats.singles_total ?? 0);
        const availabilityRate = formatPercent(available, total);
        if (isCompactViewport()) {
          el.dashboardSummary.textContent =
            `${total} registros | ${available} disponibles (${availabilityRate}%) | ${projects} promociones`;
        } else {
          el.dashboardSummary.textContent =
            `Inventario: ${total} registros | ${available} disponibles (${availabilityRate}%) | ` +
            `${projects} promociones | ${units} viviendas en promociones | ${singles} viviendas sueltas`;
        }
      }
    }
  };

  const renderDashboard = () => {
    renderDashboardKpis();
    renderStatusBoard();
    renderDashboardGroups();
    renderPromotionTable();
    renderProjectClientLinks();
  };

  const renderPropertyCard = (item) => {
    const availability = availabilityBadge(item);
    const selectedClass = state.selectedId === item.id ? "is-selected" : "";
    return `
      <button type="button" class="crm-unit-card crm-unit-card-click ${selectedClass}" data-action="open-property-page" data-id="${esc(
        item.id
      )}">
        <div class="crm-row-between">
          <h4>${esc(propertyLabel(item))}</h4>
          <span class="crm-badge ${availability.className}">${availability.label}</span>
        </div>
        <p class="crm-unit-meta">Ref: ${esc(propertyRef(item))}</p>
        <p class="crm-unit-price">${esc(money(item))}</p>
      </button>
    `;
  };

  const renderProjectList = () => {
    if (!el.projectsList) return;
    const promotions = Array.isArray(state.stats?.promotions) ? state.stats.promotions : [];

    if (!promotions.length) {
      el.projectsList.innerHTML = "<p class='crm-inline-note'>No hay promociones con los filtros actuales.</p>";
      return;
    }

    const rows = promotions
      .map((promo) => {
        const selectedClass = state.selectedProjectId === promo.id ? "is-selected" : "";
        const portalState = resolveProjectPortalState(promo);
        return `
          <article class="crm-project-item ${selectedClass}">
            <button type="button" class="crm-project-select" data-project-id="${esc(promo.id)}">
              <strong>${esc(projectLabel(promo))}</strong>
              <small class="crm-project-meta crm-project-meta-ref">Ref: ${esc(propertyRef(promo))}</small>
              <small class="crm-project-meta crm-project-meta-model">${esc(businessLabels[promo.business_type] || promo.business_type || "-")}</small>
              <small class="crm-project-meta crm-project-meta-stock">${esc(promo.total_units ?? 0)} viviendas | ${esc(promo.available_units ?? 0)} disponibles</small>
              <small class="crm-project-meta crm-project-meta-status">Estado: ${esc(promo.status || "-")}</small>
              <small class="crm-project-meta crm-project-meta-portal">
                Portal:
                <span class="crm-badge ${esc(portalState.badgeClass)}">${esc(portalState.badgeLabel)}</span>
              </small>
            </button>
            <div class="crm-actions-row">
              <button type="button" class="crm-mini-btn" data-action="open-project-page" data-id="${esc(
                promo.id
              )}">Pagina</button>
              <button
                type="button"
                class="crm-mini-btn ${portalState.enabled ? "danger" : ""}"
                data-action="toggle-project-portal"
                data-project-id="${esc(promo.id)}"
                data-next-portal-enabled="${esc(portalState.nextActionValue)}"
              >${esc(portalState.actionLabel)}</button>
              <button type="button" class="crm-mini-btn" data-action="create-unit" data-project-id="${esc(
                promo.id
              )}">Nueva hija</button>
            </div>
          </article>
        `;
      })
      .join("");

    el.projectsList.innerHTML = `
      <div class="crm-project-list-head">
        <h3>Promociones (disponibles primero)</h3>
      </div>
      <div class="crm-project-list-items">${rows}</div>
    `;
  };

  const renderProjectKpis = (project, units) => {
    if (!el.projectKpiGrid) return;
    if (!project) {
      el.projectKpiGrid.innerHTML = "<p class='crm-inline-note'>Selecciona una promocion para ver KPIs.</p>";
      return;
    }

    const availableUnits = units.filter((item) => item?.status === "available").length;
    const reservedUnits = units.filter((item) => item?.status === "reserved").length;
    const soldOrRentedUnits = units.filter(
      (item) => item?.status === "sold" || item?.status === "rented"
    ).length;
    const salePrices = units
      .map((item) => asFiniteNumber(item?.pricing?.price_sale))
      .filter((value) => value != null);
    const averagePrice = salePrices.length
      ? salePrices.reduce((sum, value) => sum + value, 0) / salePrices.length
      : null;
    const minPrice = salePrices.length ? Math.min(...salePrices) : null;

    const cards = [
      { label: "Total viviendas", value: units.length },
      { label: "Disponibles", value: availableUnits },
      { label: "Reservadas", value: reservedUnits },
      { label: "Vendidas/Alquiladas", value: soldOrRentedUnits },
      {
        label: "Precio medio",
        value: averagePrice != null ? formatCurrency(averagePrice, project?.pricing?.currency || "EUR") : "-",
      },
      {
        label: "Desde",
        value: minPrice != null ? formatCurrency(minPrice, project?.pricing?.currency || "EUR") : "-",
      },
    ];

    el.projectKpiGrid.innerHTML = cards
      .map(
        (card) => `
          <article class="crm-card crm-kpi crm-kpi-inline">
            <strong>${esc(card.value)}</strong>
            <p>${esc(card.label)}</p>
          </article>
        `
      )
      .join("");
  };

  const renderProjectExecutive = (project, units) => {
    if (!el.projectExecBoard) return;
    if (!project) {
      el.projectExecBoard.innerHTML =
        "<p class='crm-inline-note'>Selecciona una promocion para ver la vista ejecutiva.</p>";
      return;
    }

    const total = units.length;
    const byStatus = {
      available: units.filter((item) => item?.status === "available").length,
      reserved: units.filter((item) => item?.status === "reserved").length,
      sold: units.filter((item) => item?.status === "sold").length,
      rented: units.filter((item) => item?.status === "rented").length,
      draft: units.filter((item) => item?.status === "draft").length,
      private: units.filter((item) => item?.status === "private").length,
      archived: units.filter((item) => item?.status === "archived").length,
    };

    const saleValues = units
      .map((item) => asFiniteNumber(item?.pricing?.price_sale))
      .filter((value) => value != null);
    const availableValue = units
      .filter((item) => item?.status === "available")
      .map((item) => asFiniteNumber(item?.pricing?.price_sale))
      .filter((value) => value != null)
      .reduce((acc, value) => acc + value, 0);
    const totalCatalogValue = saleValues.reduce((acc, value) => acc + value, 0);
    const averageTicket = saleValues.length ? totalCatalogValue / saleValues.length : null;
    const maxPrice = saleValues.length ? Math.max(...saleValues) : null;
    const minPrice = saleValues.length ? Math.min(...saleValues) : null;

    const soldOrRented = byStatus.sold + byStatus.rented;
    const availabilityPct = total > 0 ? Math.round((byStatus.available / total) * 100) : 0;
    const absorptionPct = total > 0 ? Math.round((soldOrRented / total) * 100) : 0;
    const reservedPct = total > 0 ? Math.round((byStatus.reserved / total) * 100) : 0;

    const execCards = [
      {
        label: "Tasa disponibilidad",
        value: `${availabilityPct}%`,
        helper: `${byStatus.available} de ${total} viviendas`,
      },
      {
        label: "Tasa absorcion",
        value: `${absorptionPct}%`,
        helper: `${soldOrRented} vendidas/alquiladas`,
      },
      {
        label: "Stock reservado",
        value: `${reservedPct}%`,
        helper: `${byStatus.reserved} unidades`,
      },
      {
        label: "Valor stock disponible",
        value: formatCurrency(availableValue, project?.pricing?.currency || "EUR"),
        helper: "Suma de precios de unidades disponibles",
      },
      {
        label: "Valor catalogo",
        value: formatCurrency(totalCatalogValue, project?.pricing?.currency || "EUR"),
        helper: "Suma de precios publicados",
      },
      {
        label: "Ticket medio",
        value:
          averageTicket != null ? formatCurrency(averageTicket, project?.pricing?.currency || "EUR") : "-",
        helper: "Precio medio por unidad",
      },
      {
        label: "Precio minimo",
        value: minPrice != null ? formatCurrency(minPrice, project?.pricing?.currency || "EUR") : "-",
        helper: "Unidad mas economica",
      },
      {
        label: "Precio maximo",
        value: maxPrice != null ? formatCurrency(maxPrice, project?.pricing?.currency || "EUR") : "-",
        helper: "Unidad mas alta",
      },
    ];

    const bars = [
      { label: "Disponibles", percent: availabilityPct, className: "ok" },
      { label: "Reservadas", percent: reservedPct, className: "warn" },
      { label: "Vendidas/Alquiladas", percent: absorptionPct, className: "danger" },
    ];

    const alerts = [];
    if (total === 0) alerts.push("No hay unidades cargadas en esta promocion.");
    if (availabilityPct < 15 && total > 0) alerts.push("Stock disponible por debajo del 15%.");
    if (byStatus.draft > 0) alerts.push(`Hay ${byStatus.draft} unidades en borrador.`);
    if (saleValues.length === 0) alerts.push("No hay precios de venta definidos en las unidades.");

    const alertsHtml = alerts.length
      ? `<ul class="crm-exec-alerts">${alerts.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
      : "<p class='crm-inline-note'>Sin alertas comerciales relevantes.</p>";

    el.projectExecBoard.innerHTML = `
      <section class="crm-exec-grid">
        ${execCards
          .map(
            (card) => `
              <article class="crm-card crm-exec-card">
                <strong>${esc(card.value)}</strong>
                <p>${esc(card.label)}</p>
                <small>${esc(card.helper)}</small>
              </article>
            `
          )
          .join("")}
      </section>
      <section class="crm-exec-bars">
        ${bars
          .map(
            (bar) => `
              <div class="crm-exec-bar-row">
                <div class="crm-row-between">
                  <span>${esc(bar.label)}</span>
                  <strong>${esc(bar.percent)}%</strong>
                </div>
                <div class="crm-exec-bar-track">
                  <div class="crm-exec-bar-fill ${esc(bar.className)}" style="width: ${Math.max(
                    0,
                    Math.min(100, bar.percent)
                  )}%"></div>
                </div>
              </div>
            `
          )
          .join("")}
      </section>
      <section class="crm-exec-alerts-wrap">
        <h4>Alertas y foco comercial</h4>
        ${alertsHtml}
      </section>
    `;
  };

  const renderProjectDetailLoading = () => {
    if (!el.projectDetail) return;
    if (!state.selectedProjectId) {
      el.projectDetail.innerHTML = "<p class='crm-inline-note'>Selecciona una promocion para ver sus viviendas.</p>";
      syncProjectPageContext(null, []);
      renderProjectKpis(null, []);
      renderProjectExecutive(null, []);
      return;
    }
    const previewProject =
      state.stats?.promotions?.find((entry) => entry.id === state.selectedProjectId) ||
      findKnownPropertyById(state.selectedProjectId);
    syncProjectPageContext(previewProject || null, []);
    el.projectDetail.innerHTML = "<p class='crm-inline-note'>Cargando viviendas de la promocion...</p>";
    renderProjectKpis(null, []);
    renderProjectExecutive(null, []);
  };

  const ensureProjectDetail = async (projectId) => {
    if (!projectId) return null;
    if (state.projectDetailsCache.has(projectId)) {
      return state.projectDetailsCache.get(projectId);
    }

    const params = buildQuery({
      includeStats: false,
      page: 1,
      perPage: 200,
      projectId,
      ignoreFilters: true,
    });
    const payload = await request(`${apiBase}?${params.toString()}`);
    const rows = Array.isArray(payload.data) ? payload.data : [];
    rows.forEach((row) => cachePropertyLegacyCode(row));

    const project =
      rows.find((row) => row.record_type === "project" && row.id === projectId) ||
      rows.find((row) => row.record_type === "project") ||
      null;

    const units = rows
      .filter((row) => row.record_type === "unit" && row.parent_property_id === projectId)
      .sort((a, b) => String(a.legacy_code || "").localeCompare(String(b.legacy_code || "")));

    const detail = { project, units };
    state.projectDetailsCache.set(projectId, detail);
    return detail;
  };

  const renderProjectDetail = () => {
    if (!el.projectDetail) return;
    if (!state.selectedProjectId) {
      el.projectDetail.innerHTML = "<p class='crm-inline-note'>Selecciona una promocion para ver sus viviendas.</p>";
      syncProjectPageContext(null, []);
      return;
    }

    const detail = state.projectDetailsCache.get(state.selectedProjectId);
    if (!detail) {
      renderProjectDetailLoading();
      return;
    }

    const project = detail.project;
    const units = detail.units;
    if (!project) {
      el.projectDetail.innerHTML = "<p class='crm-inline-note'>No se pudo cargar la promocion seleccionada.</p>";
      syncProjectPageContext(null, []);
      renderProjectKpis(null, []);
      renderProjectExecutive(null, []);
      return;
    }

    syncProjectPageContext(project, units);
    const availability = availabilityBadge(project);
    const portalState = resolveProjectPortalState(project);
    const availableUnits = units.filter((item) => isAvailable(item)).length;
    const projectSelectedClass = state.selectedId === project.id ? "is-selected" : "";
    const unitsHtml = units.length
      ? `<div class="crm-unit-grid">${units
          .map((item) => renderPropertyCard(item))
          .join("")}</div>`
      : "<p class='crm-inline-note'>Esta promocion no tiene viviendas hijas cargadas.</p>";
    renderProjectKpis(project, units);
    renderProjectExecutive(project, units);

    el.projectDetail.innerHTML = `
      <section class="crm-project-detail-head ${projectSelectedClass}">
        <div class="crm-row-between">
          <div>
            <h3>${esc(projectLabel(project))}</h3>
            <p class="crm-project-head-ref">Ref: ${esc(propertyRef(project))}</p>
            <p class="crm-project-head-model">${esc(businessLabels[project.project_business_type] || project.project_business_type || "-")}</p>
            <p class="crm-project-head-model">Portal: <span class="crm-badge ${esc(
              portalState.badgeClass
            )}">${esc(portalState.badgeLabel)}</span></p>
          </div>
          <span class="crm-badge ${availability.className}">${availability.label}</span>
        </div>
        <p class="crm-unit-meta">${esc(availableUnits)} de ${esc(units.length)} viviendas disponibles</p>
        <p class="crm-unit-price">${esc(money(project))}</p>
        <div class="crm-actions-row">
          <button type="button" class="crm-mini-btn" data-action="open-project-page" data-id="${esc(project.id)}">Abrir ficha promocion</button>
          <button
            type="button"
            class="crm-mini-btn ${portalState.enabled ? "danger" : ""}"
            data-action="toggle-project-portal"
            data-project-id="${esc(project.id)}"
            data-next-portal-enabled="${esc(portalState.nextActionValue)}"
          >${esc(portalState.actionLabel)}</button>
          <button type="button" class="crm-mini-btn" data-action="create-unit" data-project-id="${esc(project.id)}">Crear vivienda hija</button>
        </div>
      </section>
      <section>
        <h3>Viviendas de la promocion</h3>
        ${unitsHtml}
      </section>
    `;
  };

  const updateMeta = () => {
    if (!el.meta) return;

    const total = Number(state.pagination.total ?? state.items.length);
    const page = Number(state.pagination.page ?? 1);
    const totalPages = Number(state.pagination.totalPages ?? 1);
    const showing = state.items.length;
    const source = state.source ? ` | Fuente: ${state.source}` : "";

    if (state.stats) {
      const stats = state.stats;
      if (isCompactViewport()) {
        el.meta.textContent =
          `${showing}/${total} propiedades | Pag ${page}/${totalPages} | ${stats.available_total || 0} disponibles${source}`;
      } else {
        el.meta.textContent =
          `Mostrando ${showing} de ${total} propiedades | Pagina ${page}/${totalPages} | ` +
          `${stats.projects_total || 0} promociones | ${stats.units_total || 0} viviendas de promocion | ` +
          `${stats.singles_total || 0} viviendas sueltas | ${stats.available_total || 0} disponibles${source}`;
      }
      return;
    }

    if (isCompactViewport()) {
      el.meta.textContent = `${showing}/${total} propiedades | Pag ${page}/${totalPages}${source}`;
      return;
    }

    el.meta.textContent = `Mostrando ${showing} de ${total} propiedades | Pagina ${page}/${totalPages}${source}`;
  };

  const renderTable = () => {
    if (el.tbody) {
      if (!state.items.length) {
        el.tbody.innerHTML = "<tr><td colspan='5'>Sin resultados con los filtros actuales.</td></tr>";
      } else {
        el.tbody.innerHTML = state.items
          .map((item) => {
            const current = state.selectedId === item.id ? "crm-row-selected" : "";
            const badge = statusClass[item.status] || "warn";
            return `
              <tr class="${current}">
                <td data-label="Propiedad"><strong>${esc(propertyLabel(item))}</strong><br /><small>Ref: ${esc(propertyRef(item))}</small></td>
                <td data-label="Tipo" class="crm-cell-optional">${esc(recordTypeLabel(item.record_type))}</td>
                <td data-label="Precio">${esc(money(item))}</td>
                <td data-label="Disponibilidad"><span class="crm-badge ${badge}">${esc(statusLabels[item.status] || item.status || "-")}</span></td>
                <td data-label="Acciones" class="crm-actions-row crm-cell-optional crm-cell-actions">
                  <button type="button" class="crm-mini-btn" data-action="select" data-id="${esc(item.id)}">Editar</button>
                  <button type="button" class="crm-mini-btn" data-action="open-page" data-id="${esc(item.id)}">Pagina</button>
                </td>
              </tr>
            `;
          })
          .join("");
      }
    }

    if (!el.mobileList) return;
    if (!state.items.length) {
      el.mobileList.innerHTML = "<p class='crm-inline-note'>Sin resultados con los filtros actuales.</p>";
      return;
    }

    const hasInlineEditor = Boolean(el.editForm);
    el.mobileList.innerHTML = state.items
      .map((item) => {
        const availability = availabilityBadge(item);
        const selectedClass = state.selectedId === item.id ? "is-selected" : "";
        const mainAction = hasInlineEditor ? "select" : "open-page";
        const mainLabel = hasInlineEditor ? "Editar ficha" : "Abrir propiedad";
        return `
          <article class="crm-mobile-property-card ${selectedClass}">
            <button type="button" class="crm-mobile-property-hit" data-action="${mainAction}" data-id="${esc(item.id)}">
              <div class="crm-row-between">
                <h4>${esc(propertyLabel(item))}</h4>
                <span class="crm-badge ${availability.className}">${availability.label}</span>
              </div>
              <p class="crm-mobile-property-ref">Ref: ${esc(propertyRef(item))}</p>
              <p class="crm-mobile-property-price">${esc(money(item))}</p>
            </button>
            <div class="crm-mobile-property-actions">
              <button type="button" class="crm-mini-btn" data-action="${mainAction}" data-id="${esc(item.id)}">${mainLabel}</button>
              ${
                hasInlineEditor
                  ? `<button type="button" class="crm-mini-btn" data-action="open-page" data-id="${esc(item.id)}">Pagina</button>`
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderPagination = () => {
    if (!el.pagination || !el.pageInfo) return;

    const total = Number(state.pagination.total ?? 0);
    const page = Number(state.pagination.page ?? 1);
    const totalPages = Number(state.pagination.totalPages ?? 1);

    el.pageInfo.textContent = `Pagina ${page} de ${totalPages} | ${state.items.length} en pagina | ${total} total`;

    const prevBtn = el.pagination.querySelector("button[data-page-action='prev']");
    const nextBtn = el.pagination.querySelector("button[data-page-action='next']");
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  };

  const setFormsEnabled = (enabled) => {
    if (el.editFieldset) el.editFieldset.disabled = !enabled;
    if (el.mediaFieldset) el.mediaFieldset.disabled = !enabled;
  };

  const syncParentLegacyFieldRules = (form) => {
    if (!form) return;
    const recordTypeField = form.elements?.record_type;
    const parentField = form.elements?.parent_legacy_code;
    const parentSelect = form.querySelector("select[data-parent-project-select]");
    const parentLinkFields = form.querySelectorAll("[data-parent-link-field], [data-parent-link-helper]");
    if (!(recordTypeField instanceof HTMLSelectElement)) return;
    if (!(parentField instanceof HTMLInputElement)) return;

    const isUnit = recordTypeField.value === "unit";
    parentField.required = isUnit;
    parentField.disabled = !isUnit;
    parentField.placeholder = isUnit
      ? "Se autocompleta al elegir promocion"
      : "Solo aplica a viviendas de promocion";

    if (parentSelect instanceof HTMLSelectElement) {
      const hasProjects = parentSelect.options.length > 1;
      parentSelect.disabled = !isUnit || !hasProjects;
    }

    parentLinkFields.forEach((node) => {
      if (node instanceof HTMLElement) node.hidden = !isUnit;
    });

    if (!isUnit) {
      if (parentField.value) parentField.value = "";
      if (parentSelect instanceof HTMLSelectElement && parentSelect.value) {
        parentSelect.value = "";
      }
    }
  };

  const syncProjectPortalFieldRules = (form, item = null) => {
    if (!form) return;
    const recordTypeField = form.elements?.record_type;
    const portalField = form.elements?.portal_enabled;
    const portalNodes = form.querySelectorAll("[data-project-portal-field], [data-project-portal-helper]");
    const statusNode = form.querySelector("[data-project-portal-status]");
    if (!(recordTypeField instanceof HTMLSelectElement)) return;
    if (!(portalField instanceof HTMLInputElement)) return;

    const isProject = recordTypeField.value === "project";
    portalField.disabled = !isProject;
    portalNodes.forEach((node) => {
      if (node instanceof HTMLElement) node.hidden = !isProject;
    });

    if (!isProject) {
      portalField.checked = false;
      if (statusNode instanceof HTMLElement) statusNode.textContent = "";
      return;
    }

    const source = item && item.record_type === "project" ? item : null;
    const portalState = resolveProjectPortalState(source ?? { portal: { is_enabled: portalField.checked } });
    const effectiveEnabled = portalField.checked;
    const statusText = effectiveEnabled ? "Activa en portal." : "Fuera de portal.";
    const updatedSuffix = portalState.updatedAt
      ? ` Ultima actualizacion: ${formatDate(portalState.updatedAt)}.`
      : "";
    if (statusNode instanceof HTMLElement) {
      statusNode.textContent = `Estado actual: ${statusText}${updatedSuffix}`;
    }
  };

  const renderMedia = (item) => {
    if (!el.coverBox || !el.mediaBoard) return;
    const cover = item?.media?.cover || null;
    el.coverBox.innerHTML = cover
      ? `
        <div class="crm-cover-card">
          <strong>Portada actual</strong>
          <a class="crm-cover-thumb" href="${esc(cover.url)}" target="_blank" rel="noreferrer">
            <img src="${esc(cover.url)}" alt="${esc(cover.label || propertyLabel(item, "Portada"))}" loading="lazy" />
          </a>
          <small>${esc(cover.label || "Sin etiqueta")}</small>
        </div>
      `
      : "<p>Sin portada asignada.</p>";

    el.mediaBoard.innerHTML = mediaCategories
      .map((category) => {
        const list = Array.isArray(item?.media?.gallery?.[category]) ? item.media.gallery[category] : [];
        const rows = list.length
          ? list
              .map(
                (entry, index) => `
                  <li class="crm-media-item">
                    <a class="crm-media-thumb" href="${esc(entry.url)}" target="_blank" rel="noreferrer">
                      <img src="${esc(entry.url)}" alt="${esc(entry.label || mediaCategoryLabel(category))}" loading="lazy" />
                    </a>
                    <div class="crm-media-item-main">
                      <strong>${esc(entry.label || mediaCategoryLabel(category))}</strong>
                      <small>${esc(entry.url)}</small>
                    </div>
                    <div class="crm-media-actions">
                      <button type="button" class="crm-mini-btn" data-media-action="set_cover" data-item-id="${esc(entry.id)}" data-category="${esc(category)}">Portada</button>
                      <button type="button" class="crm-mini-btn" data-media-action="move" data-item-id="${esc(entry.id)}" data-category="${esc(category)}" data-direction="up" ${index === 0 ? "disabled" : ""}>Subir</button>
                      <button type="button" class="crm-mini-btn" data-media-action="move" data-item-id="${esc(entry.id)}" data-category="${esc(category)}" data-direction="down" ${index === list.length - 1 ? "disabled" : ""}>Bajar</button>
                      <button type="button" class="crm-mini-btn danger" data-media-action="remove" data-item-id="${esc(entry.id)}" data-category="${esc(category)}">Borrar</button>
                    </div>
                  </li>
                `
              )
              .join("")
          : "<li class='crm-media-item-empty'>Sin archivos</li>";

        const summaryCount = list.length;
        return `
          <details class="crm-media-category" ${summaryCount > 0 ? "open" : ""}>
            <summary>
              <span>${esc(mediaCategoryLabel(category))}</span>
              <span class="crm-media-count">${esc(formatInt(summaryCount))} archivos</span>
            </summary>
            <ul class="crm-media-list">${rows}</ul>
          </details>
        `;
      })
      .join("");
  };

  const fillEditor = (item) => {
    if (!el.editForm) return;
    if (!item) {
      setFormsEnabled(false);
      el.editForm.reset();
      syncParentLegacyFieldRules(el.editForm);
      syncProjectPortalFieldRules(el.editForm, null);
      renderSelectedPropertyContext(null);
      syncPropertyPageContext(null);
      renderPropertyPresentation(null);
      state.propertyClientData = null;
      state.propertyClientMeta = null;
      state.propertyClientError = null;
      state.propertyClientLoading = false;
      state.propertyClientPropertyId = null;
      renderPropertyClientLinks();
      if (el.coverBox) el.coverBox.innerHTML = "<p>Selecciona una propiedad para gestionar portada y galeria.</p>";
      if (el.mediaBoard) el.mediaBoard.innerHTML = "";
      return;
    }

    setFormsEnabled(true);
    renderSelectedPropertyContext(item);
    syncPropertyPageContext(item);
    renderPropertyPresentation(item);

    el.editForm.elements.id.value = item.id;
    el.editForm.elements.legacy_code.value = item.legacy_code || "";
    el.editForm.elements.record_type.value = item.record_type || "single";
    renderParentProjectOptions();
    syncParentLegacyFieldRules(el.editForm);
    el.editForm.elements.project_business_type.value = item.project_business_type || "external_listing";
    el.editForm.elements.operation_type.value = item.operation_type || "sale";
    el.editForm.elements.status.value = item.status || "draft";
    const parentId = item.record_type === "unit" ? toText(item.parent_property_id) : null;
    const cachedParentLegacyCode = parentId
      ? state.parentLegacyById.get(parentId) || findKnownPropertyById(parentId)?.legacy_code || ""
      : "";
    el.editForm.elements.parent_legacy_code.value = cachedParentLegacyCode;
    syncParentProjectSelection(el.editForm, parentId);
    if (parentId && !cachedParentLegacyCode) {
      void resolveParentLegacyCodeForEditor(item);
    }
    el.editForm.elements.price_sale.value = item.pricing?.price_sale ?? "";
    el.editForm.elements.price_rent_monthly.value = item.pricing?.price_rent_monthly ?? "";
    el.editForm.elements.currency.value = item.pricing?.currency || "EUR";
    el.editForm.elements.area_m2.value = item.operational?.area_m2 ?? "";
    el.editForm.elements.usable_area_m2.value = item.operational?.usable_area_m2 ?? "";
    el.editForm.elements.built_area_total_m2.value = item.operational?.built_area_total_m2 ?? "";
    el.editForm.elements.terrace_m2.value = item.operational?.terrace_m2 ?? "";
    el.editForm.elements.exterior_area_m2.value = item.operational?.exterior_area_m2 ?? "";
    el.editForm.elements.garden_m2.value = item.operational?.garden_m2 ?? "";
    el.editForm.elements.plot_m2.value = item.operational?.plot_m2 ?? "";
    el.editForm.elements.bedrooms.value = item.operational?.bedrooms ?? "";
    el.editForm.elements.bathrooms.value = item.operational?.bathrooms ?? "";
    el.editForm.elements.garages.value = item.operational?.garages ?? "";
    el.editForm.elements.storage_rooms.value = item.operational?.storage_rooms ?? "";
    el.editForm.elements.floor_level.value = item.operational?.floor_level ?? "";
    el.editForm.elements.year_built.value = item.operational?.year_built ?? "";
    el.editForm.elements.community_fees_monthly.value = item.operational?.community_fees_monthly ?? "";
    el.editForm.elements.ibi_yearly.value = item.operational?.ibi_yearly ?? "";
    el.editForm.elements.floor_label.value = item.operational?.floor_label || "";
    el.editForm.elements.building_block.value = item.operational?.building_block || "";
    el.editForm.elements.building_portal.value = item.operational?.building_portal || "";
    el.editForm.elements.building_door.value = item.operational?.building_door || "";
    el.editForm.elements.building_name.value = item.operational?.building_name || "";
    el.editForm.elements.orientation.value = item.operational?.orientation || "";
    el.editForm.elements.condition.value = item.operational?.condition || "";
    el.editForm.elements.cadastral_ref.value = item.operational?.cadastral_ref || "";
    el.editForm.elements.energy_rating.value = item.operational?.energy_rating || "";
    el.editForm.elements.elevator.checked = item.operational?.elevator === true;
    el.editForm.elements.rent_price_on_request.checked = item.pricing?.rent_price_on_request === true;
    el.editForm.elements.is_public.checked = item.is_public !== false;
    el.editForm.elements.is_featured.checked = item.is_featured === true;
    const portalField = el.editForm.elements.portal_enabled;
    if (portalField instanceof HTMLInputElement) {
      const portalState = resolveProjectPortalState(item);
      portalField.checked = item.record_type === "project" ? portalState.enabled : false;
    }
    syncProjectPortalFieldRules(el.editForm, item);
    el.editForm.elements.commercialization_notes.value = item.commercialization_notes || "";
    renderMedia(item);
    void loadPropertyClientLinks(item);
  };

  const payloadFromForm = (form) => {
    const formData = new FormData(form);
    const recordType = toText(formData.get("record_type"));
    const parentLegacyCode = recordType === "unit" ? toText(formData.get("parent_legacy_code")) : null;
    const portalField = form.elements?.portal_enabled;
    const includePortalField = recordType === "project" && portalField instanceof HTMLInputElement;
    return {
      organization_id: state.organizationId || null,
      legacy_code: toText(formData.get("legacy_code")),
      record_type: recordType,
      project_business_type: toText(formData.get("project_business_type")),
      ...(includePortalField ? { portal_enabled: portalField.checked } : {}),
      operation_type: toText(formData.get("operation_type")),
      status: toText(formData.get("status")),
      ...(recordType === "unit" ? { parent_legacy_code: parentLegacyCode } : {}),
      price_sale: toNumber(formData.get("price_sale")),
      price_rent_monthly: toNumber(formData.get("price_rent_monthly")),
      currency: toText(formData.get("currency")),
      area_m2: toNumber(formData.get("area_m2")),
      usable_area_m2: toNumber(formData.get("usable_area_m2")),
      built_area_total_m2: toNumber(formData.get("built_area_total_m2")),
      terrace_m2: toNumber(formData.get("terrace_m2")),
      exterior_area_m2: toNumber(formData.get("exterior_area_m2")),
      garden_m2: toNumber(formData.get("garden_m2")),
      plot_m2: toNumber(formData.get("plot_m2")),
      bedrooms: toNumber(formData.get("bedrooms")),
      bathrooms: toNumber(formData.get("bathrooms")),
      garages: toNumber(formData.get("garages")),
      storage_rooms: toNumber(formData.get("storage_rooms")),
      floor_level: toNumber(formData.get("floor_level")),
      year_built: toNumber(formData.get("year_built")),
      community_fees_monthly: toNumber(formData.get("community_fees_monthly")),
      ibi_yearly: toNumber(formData.get("ibi_yearly")),
      floor_label: toText(formData.get("floor_label")),
      building_block: toText(formData.get("building_block")),
      building_portal: toText(formData.get("building_portal")),
      building_door: toText(formData.get("building_door")),
      building_name: toText(formData.get("building_name")),
      orientation: toText(formData.get("orientation")),
      condition: toText(formData.get("condition")),
      cadastral_ref: toText(formData.get("cadastral_ref")),
      energy_rating: toText(formData.get("energy_rating")),
      elevator: formData.get("elevator") === "on",
      rent_price_on_request: formData.get("rent_price_on_request") === "on",
      is_public: formData.get("is_public") === "on",
      is_featured: formData.get("is_featured") === "on",
      commercialization_notes: toText(formData.get("commercialization_notes")),
    };
  };

  const setWizardStep = (step) => {
    if (!el.createForm) return;
    state.wizard.step = toInt(step, 1, 1, state.wizard.totalSteps);

    const stepBlocks = el.createForm.querySelectorAll("[data-wizard-step]");
    stepBlocks.forEach((block) => {
      const blockStep = Number(block.getAttribute("data-wizard-step"));
      block.hidden = blockStep !== state.wizard.step;
    });

    if (el.wizardSteps) {
      const indicators = el.wizardSteps.querySelectorAll("[data-step-indicator]");
      indicators.forEach((indicator) => {
        const indicatorStep = Number(indicator.getAttribute("data-step-indicator"));
        indicator.classList.remove("is-active", "is-done");
        if (indicatorStep < state.wizard.step) indicator.classList.add("is-done");
        if (indicatorStep === state.wizard.step) indicator.classList.add("is-active");
      });
    }

    if (el.wizardPrev) el.wizardPrev.hidden = state.wizard.step <= 1;
    if (el.wizardNext) el.wizardNext.hidden = state.wizard.step >= state.wizard.totalSteps;
    if (el.wizardSubmit) el.wizardSubmit.hidden = state.wizard.step < state.wizard.totalSteps;
  };

  const applyCreateFormPrefill = ({ recordType = null, projectId = null, parentLegacyCode = null } = {}) => {
    if (!el.createForm) return;
    if (state.createPrefillApplied) return;

    const recordTypeField = el.createForm.elements?.record_type;
    const parentField = el.createForm.elements?.parent_legacy_code;
    const normalizedRecordType = toText(recordType);

    if (
      recordTypeField instanceof HTMLSelectElement &&
      (normalizedRecordType === "project" ||
        normalizedRecordType === "unit" ||
        normalizedRecordType === "single")
    ) {
      recordTypeField.value = normalizedRecordType;
    } else if (recordTypeField instanceof HTMLSelectElement && toText(projectId)) {
      recordTypeField.value = "unit";
    }

    if (parentField instanceof HTMLInputElement) {
      const normalizedParentLegacy = toText(parentLegacyCode);
      if (normalizedParentLegacy) parentField.value = normalizedParentLegacy;
    }

    renderParentProjectOptions();
    syncParentLegacyFieldRules(el.createForm);

    const normalizedProjectId = toText(projectId);
    if (normalizedProjectId) {
      syncParentProjectSelection(el.createForm, normalizedProjectId);
    } else {
      syncParentProjectSelection(el.createForm);
    }

    state.createPrefillApplied = true;
  };

  const validateWizardStep = (step) => {
    if (!el.createForm) return true;

    if (step === 1) {
      const legacyCode = toText(el.createForm.elements.legacy_code?.value);
      if (!legacyCode) {
        setFeedback("El codigo interno es obligatorio.", "error", { toast: true });
        return false;
      }

      const recordType = toText(el.createForm.elements.record_type?.value);
      const parentLegacyCode = toText(el.createForm.elements.parent_legacy_code?.value);
      if (recordType === "unit" && !parentLegacyCode) {
        setFeedback(
          "Para una vivienda hija debes elegir una promocion padre o indicar su legacy_code.",
          "error",
          {
            toast: true,
          }
        );
        return false;
      }
    }

    return true;
  };

  const toggleProjectPortalVisibility = async (projectId, nextPortalEnabledRaw) => {
    const normalizedProjectId = toText(projectId);
    if (!normalizedProjectId) {
      setFeedback("No se pudo identificar la promocion a actualizar.", "error", { toast: true });
      return;
    }

    const nextPortalEnabled = String(nextPortalEnabledRaw ?? "")
      .trim()
      .toLowerCase() === "true";
    const loadingMessage = nextPortalEnabled
      ? "Publicando promocion en portal..."
      : "Quitando promocion del portal...";
    setFeedback(loadingMessage, "ok");

    try {
      await request(`${apiBase}/${encodeURIComponent(normalizedProjectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: state.organizationId || null,
          portal_enabled: nextPortalEnabled,
        }),
      });

      state.projectDetailsCache.delete(normalizedProjectId);
      await loadProperties({ preserveSelection: true });
      setFeedback(
        nextPortalEnabled
          ? "Promocion publicada correctamente en portal."
          : "Promocion retirada del portal.",
        "ok",
        { toast: true }
      );
    } catch (error) {
      setFeedback(`Error actualizando publicacion portal: ${error.message}`, "error", { toast: true });
    }
  };

  const handleProjectSelection = async (projectId) => {
    const normalized = toText(projectId);
    if (!normalized) return;
    state.selectedProjectId = normalized;
    renderProjectList();
    renderProjectDetailLoading();

    try {
      await ensureProjectDetail(normalized);
    } catch (error) {
      setFeedback(`Error cargando detalle de promocion: ${error.message}`, "error", { toast: true });
    }
    renderProjectDetail();
  };

  const selectForEdit = async (id) => {
    const normalized = toText(id);
    if (!normalized) return;
    state.selectedId = normalized;
    const current = selected();
    if (!current) return;

    if (current.record_type === "project") {
      state.selectedProjectId = current.id;
      await ensureProjectDetail(current.id);
    } else if (current.record_type === "unit" && current.parent_property_id) {
      state.selectedProjectId = current.parent_property_id;
      await ensureProjectDetail(current.parent_property_id);
    }

    renderTable();
    renderProjectList();
    renderProjectDetail();
    fillEditor(selected());
    el.workspace?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const fetchPropertyById = async (propertyId) => {
    const normalized = toText(propertyId);
    if (!normalized) return null;
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    const suffix = params.toString();
    const payload = await request(
      `${apiBase}/${encodeURIComponent(normalized)}${suffix ? `?${suffix}` : ""}`
    );
    const property = payload?.data || null;
    if (property) cachePropertyLegacyCode(property);
    return property;
  };

  const resolveParentLegacyCodeForEditor = async (property) => {
    if (!el.editForm) return;
    const propertyId = toText(property?.id);
    const parentId = toText(property?.parent_property_id);
    if (!propertyId || !parentId) return;

    let parentLegacyCode =
      state.parentLegacyById.get(parentId) || toText(findKnownPropertyById(parentId)?.legacy_code);

    if (!parentLegacyCode) {
      try {
        const parent = await fetchPropertyById(parentId);
        parentLegacyCode = toText(parent?.legacy_code);
      } catch {
        return;
      }
    }

    if (!parentLegacyCode) return;
    const currentPropertyId = toText(el.editForm.elements.id?.value);
    if (!currentPropertyId || currentPropertyId !== propertyId) return;
    el.editForm.elements.parent_legacy_code.value = parentLegacyCode;
    syncParentProjectSelection(el.editForm, parentId);
  };

  const loadProperties = async ({ preserveSelection = false, resetPage = false } = {}) => {
    try {
      if (resetPage) state.pagination.page = 1;

      const includeStats = Boolean(
        el.dashboardGroups ||
          el.projectsList ||
          el.kpiGrid ||
          el.promotionsTbody ||
          el.projectKpiGrid ||
          el.projectExecBoard ||
          el.createForm?.querySelector("select[data-parent-project-select]") ||
          el.editForm?.querySelector("select[data-parent-project-select]")
      );
      const params = buildQuery({
        includeStats,
        page: state.pagination.page,
        perPage: state.pagination.perPage,
      });
      const payload = await request(`${apiBase}?${params.toString()}`);

      state.items = Array.isArray(payload.data) ? payload.data : [];
      state.items.forEach((item) => cachePropertyLegacyCode(item));
      state.source = payload.meta?.storage || "";
      state.stats = payload.meta?.stats || null;
      state.pagination.total = Number(payload.meta?.total ?? state.items.length);
      state.pagination.page = Number(payload.meta?.page ?? state.pagination.page);
      state.pagination.perPage = Number(payload.meta?.per_page ?? state.pagination.perPage);
      state.pagination.totalPages = Number(
        payload.meta?.total_pages ??
          Math.max(1, Math.ceil(state.pagination.total / Math.max(1, state.pagination.perPage)))
      );

      if (el.perPageSelect) {
        el.perPageSelect.value = String(state.pagination.perPage);
      }

      state.projectDetailsCache.clear();
      renderParentProjectOptions();
      applyCreateFormPrefill({
        recordType: queryRecordTypePrefill,
        projectId: queryProjectId,
        parentLegacyCode: queryParentLegacyCodePrefill,
      });

      if (state.requestedPropertyId && !state.items.some((item) => item.id === state.requestedPropertyId)) {
        try {
          const requestedItem = await fetchPropertyById(state.requestedPropertyId);
          if (requestedItem?.id) {
            state.items = [requestedItem, ...state.items.filter((item) => item.id !== requestedItem.id)];
          }
        } catch {
          // Keep list rendering even if the direct fetch fails.
        }
      }

      const projectIds = Array.isArray(state.stats?.promotions)
        ? state.stats.promotions.map((entry) => entry.id)
        : [];

      if (state.requestedPropertyId && state.items.some((item) => item.id === state.requestedPropertyId)) {
        state.selectedId = state.requestedPropertyId;
        state.requestedPropertyId = null;
      } else if (preserveSelection && state.selectedId) {
        if (!state.items.some((item) => item.id === state.selectedId)) {
          state.selectedId = state.items[0]?.id || null;
        }
      } else {
        state.selectedId = state.items[0]?.id || null;
      }

      if (state.requestedProjectId) {
        state.selectedProjectId = state.requestedProjectId;
        state.requestedProjectId = null;
      } else {
        state.selectedProjectId =
          preserveSelection && state.selectedProjectId && projectIds.includes(state.selectedProjectId)
            ? state.selectedProjectId
            : projectIds[0] || null;
      }

      if (!state.selectedProjectId && state.selectedId) {
        const current = selected();
        if (current?.record_type === "project") {
          state.selectedProjectId = current.id;
        } else if (current?.record_type === "unit" && current.parent_property_id) {
          state.selectedProjectId = current.parent_property_id;
        }
      }

      if (el.clientLinkTbody || el.clientLinkSummary) {
        await loadProjectClientLinks();
      }

      renderTable();
      updateMeta();
      renderPagination();
      renderDashboard();
      renderProjectList();
      renderProjectDetailLoading();

      if (state.selectedProjectId && el.projectDetail) {
        try {
          await ensureProjectDetail(state.selectedProjectId);
        } catch (error) {
          setFeedback(`Error cargando detalle de promocion: ${error.message}`, "error", { toast: true });
        }
      }

      renderProjectDetail();
      fillEditor(selected());
    } catch (error) {
      setFeedback(`Error cargando propiedades: ${error.message}`, "error", { toast: true });
    }
  };

  const handlePropertyAction = (action, id) => {
    if (action === "open-page") {
      openPropertyPage(id);
      return;
    }
    if (action === "select") {
      openPropertyEditor(id);
    }
  };

  bindParentProjectForm(el.createForm);
  bindParentProjectForm(el.editForm);

  const createRecordTypeField = el.createForm?.elements?.record_type;
  if (createRecordTypeField instanceof HTMLSelectElement) {
    createRecordTypeField.addEventListener("change", () => {
      syncParentLegacyFieldRules(el.createForm);
      syncParentProjectSelection(el.createForm);
      syncProjectPortalFieldRules(el.createForm);
    });
    syncParentLegacyFieldRules(el.createForm);
    syncProjectPortalFieldRules(el.createForm);
  }

  const editRecordTypeField = el.editForm?.elements?.record_type;
  if (editRecordTypeField instanceof HTMLSelectElement) {
    editRecordTypeField.addEventListener("change", () => {
      syncParentLegacyFieldRules(el.editForm);
      syncParentProjectSelection(el.editForm);
      syncProjectPortalFieldRules(el.editForm, selected());
    });
    syncParentLegacyFieldRules(el.editForm);
    syncProjectPortalFieldRules(el.editForm, selected());
  }

  const editPortalField = el.editForm?.elements?.portal_enabled;
  if (editPortalField instanceof HTMLInputElement) {
    editPortalField.addEventListener("change", () => {
      syncProjectPortalFieldRules(el.editForm, selected());
    });
  }

  el.propertyTabbar?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-property-tab-trigger]");
    if (!button) return;
    setPropertyTab(button.getAttribute("data-property-tab-trigger"));
  });

  el.propertyClientRefresh?.addEventListener("click", async () => {
    const current = selected();
    if (!current) {
      setFeedback("Selecciona una propiedad para cargar clientes.", "error", { toast: true });
      return;
    }
    await loadPropertyClientLinks(current, { force: true });
    setFeedback("Vinculacion vivienda-cliente actualizada.", "ok", { toast: true });
  });

  el.propertyClientCandidateList?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-property-client-action]");
    if (!button) return;

    const current = selected();
    if (!current) {
      setFeedback("Selecciona una propiedad para vincular clientes.", "error", { toast: true });
      return;
    }

    const clientId = button.getAttribute("data-client-id");
    const action = button.getAttribute("data-property-client-action");
    const buyerRole = action === "link-co-buyer" ? "co_buyer" : "primary";

    try {
      await upsertPropertyClientLink({
        propertyId: current.id,
        clientId,
        buyerRole,
      });
      setFeedback(
        buyerRole === "primary"
          ? "Cliente vinculado como titular."
          : "Cliente vinculado como cotitular.",
        "ok",
        { toast: true }
      );
      await loadPropertyClientLinks(current, { force: true });
    } catch (error) {
      setFeedback(`Error vinculando cliente: ${error.message}`, "error", { toast: true });
    }
  });

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
    setFeedback(
      state.organizationId ? "Organizacion activa actualizada." : "Organizacion limpiada.",
      "ok"
    );
    await loadProperties({ preserveSelection: false, resetPage: true });
  });

  el.filterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.pagination.page = 1;
    if (el.perPageSelect) {
      state.pagination.perPage = toInt(el.perPageSelect.value, state.pagination.perPage, 1, 200);
    }
    await loadProperties({ preserveSelection: false, resetPage: true });
  });

  el.perPageSelect?.addEventListener("change", async () => {
    state.pagination.perPage = toInt(el.perPageSelect.value, state.pagination.perPage, 1, 200);
    state.pagination.page = 1;
    await loadProperties({ preserveSelection: false, resetPage: true });
  });

  el.reload?.addEventListener("click", async () => {
    await loadProperties({ preserveSelection: true });
  });

  el.pagination?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-page-action]");
    if (!button) return;
    const action = button.getAttribute("data-page-action");
    if (action === "prev" && state.pagination.page > 1) {
      state.pagination.page -= 1;
      await loadProperties({ preserveSelection: false });
      return;
    }
    if (action === "next" && state.pagination.page < state.pagination.totalPages) {
      state.pagination.page += 1;
      await loadProperties({ preserveSelection: false });
    }
  });

  el.tbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-action]");
    if (!button) return;
    handlePropertyAction(button.getAttribute("data-action"), button.getAttribute("data-id"));
  });

  el.mobileList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-action]");
    if (!button) return;
    handlePropertyAction(button.getAttribute("data-action"), button.getAttribute("data-id"));
  });

  el.projectsList?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const portalButton = target.closest("button[data-action='toggle-project-portal']");
    if (portalButton) {
      await toggleProjectPortalVisibility(
        portalButton.getAttribute("data-project-id"),
        portalButton.getAttribute("data-next-portal-enabled")
      );
      return;
    }
    const createUnitButton = target.closest("button[data-action='create-unit']");
    if (createUnitButton) {
      openCreateUnitForProject(createUnitButton.getAttribute("data-project-id"));
      return;
    }
    const pageButton = target.closest("button[data-action='open-project-page']");
    if (pageButton) {
      openProjectPage(pageButton.getAttribute("data-id"));
      return;
    }
    const button = target.closest("button[data-project-id]");
    if (!button) return;
    await handleProjectSelection(button.getAttribute("data-project-id"));
  });

  el.projectDetail?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const portalButton = target.closest("button[data-action='toggle-project-portal']");
    if (portalButton) {
      void toggleProjectPortalVisibility(
        portalButton.getAttribute("data-project-id"),
        portalButton.getAttribute("data-next-portal-enabled")
      );
      return;
    }
    const pageButton = target.closest("button[data-action='open-property-page']");
    if (pageButton) {
      openPropertyPage(pageButton.getAttribute("data-id"));
      return;
    }
    const createUnitButton = target.closest("button[data-action='create-unit']");
    if (createUnitButton) {
      openCreateUnitForProject(createUnitButton.getAttribute("data-project-id"));
      return;
    }
    const projectPageButton = target.closest("button[data-action='open-project-page']");
    if (projectPageButton) {
      openProjectPage(projectPageButton.getAttribute("data-id"));
      return;
    }
    const button = target.closest("button[data-action='select-property']");
    if (!button) return;
    openPropertyEditor(button.getAttribute("data-id"));
  });

  el.dashboardGroups?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const createUnitButton = target.closest("button[data-dashboard-action='create-unit']");
    if (createUnitButton) {
      openCreateUnitForProject(createUnitButton.getAttribute("data-project-id"));
      return;
    }

    const projectButton = target.closest("button[data-dashboard-action='open-project']");
    if (projectButton) {
      const projectId = projectButton.getAttribute("data-project-id");
      if (!projectId) return;
      if (!el.projectsList || !el.projectDetail) {
        openProjectPage(projectId);
        return;
      }
      await handleProjectSelection(projectId);
      return;
    }

    const propertyButton = target.closest("button[data-dashboard-action='open-property']");
    if (!propertyButton) return;
    openPropertyEditor(propertyButton.getAttribute("data-id"));
  });

  el.clearFilters?.addEventListener("click", async () => {
    el.filterForm?.reset();
    if (el.perPageSelect) {
      state.pagination.perPage = toInt(el.perPageSelect.value, state.pagination.perPage, 1, 200);
    }
    state.pagination.page = 1;
    await loadProperties({ preserveSelection: false, resetPage: true });
  });

  el.wizardPrev?.addEventListener("click", () => {
    setWizardStep(state.wizard.step - 1);
  });

  el.wizardNext?.addEventListener("click", () => {
    if (!validateWizardStep(state.wizard.step)) return;
    setWizardStep(state.wizard.step + 1);
    setFeedback(`Paso ${state.wizard.step} de ${state.wizard.totalSteps}.`, "ok");
  });

  el.createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (state.wizard.step < state.wizard.totalSteps) {
      setFeedback("Completa los pasos del asistente antes de crear.", "error", { toast: true });
      return;
    }
    if (!validateWizardStep(state.wizard.step)) return;

    if (!state.organizationId) {
      setFeedback(
        "No hay organizacion activa. Define CRM_ORGANIZATION_ID o indica un UUID manual.",
        "error",
        { toast: true }
      );
      return;
    }

    try {
      const payload = payloadFromForm(el.createForm);
      const response = await request(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.selectedId = response.data?.id || null;
      el.createForm.reset();
      setWizardStep(1);
      syncParentLegacyFieldRules(el.createForm);
      syncParentProjectSelection(el.createForm);
      setFeedback("Propiedad creada correctamente.", "ok", { toast: true });

      if (!el.editForm && state.selectedId) {
        openPropertyPage(state.selectedId);
        return;
      }

      await loadProperties({ preserveSelection: true });
    } catch (error) {
      const rawMessage = String(error?.message || "db_insert_error");
      const friendly = friendlyPropertyError(rawMessage);
      setFeedback(`Error al crear: ${friendly}`, "error", { toast: true });
    }
  });

  el.editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = selected();
    if (!current) {
      setFeedback("Selecciona una propiedad para editar.", "error", { toast: true });
      return;
    }

    try {
      const payload = payloadFromForm(el.editForm);
      const response = await request(`${apiBase}/${encodeURIComponent(current.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const updated = response?.data || null;
      const hiddenFromPublic =
        updated?.is_public === false || updated?.status === "private" || updated?.status === "archived";
      setFeedback(
        hiddenFromPublic
          ? "Propiedad actualizada. Ojo: con esta visibilidad/estado no aparecera en la web publica."
          : "Propiedad actualizada.",
        "ok",
        { toast: true }
      );
      await loadProperties({ preserveSelection: true });
    } catch (error) {
      const rawMessage = String(error?.message || "db_update_error");
      const friendly = friendlyPropertyError(rawMessage);
      setFeedback(`Error al actualizar: ${friendly}`, "error", { toast: true });
    }
  });

  el.mediaForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = selected();
    if (!current) {
      setFeedback("Selecciona una propiedad antes de subir media.", "error", { toast: true });
      return;
    }

    const formData = new FormData(el.mediaForm);
    const file = formData.get("file");
    const hasFile = file instanceof File && file.size > 0;
    const submitButton = el.mediaForm.querySelector("button[type='submit']");
    const originalButtonText = submitButton ? submitButton.textContent : null;

    if (submitButton) {
      submitButton.setAttribute("disabled", "disabled");
      submitButton.textContent = hasFile ? "Subiendo..." : "Guardando...";
    }
    setFeedback(hasFile ? "Subiendo archivo..." : "Guardando media...", "ok");

    try {
      let mediaResponse = null;
      if (hasFile) {
        const uploadPayload = new FormData();
        uploadPayload.set("organization_id", state.organizationId || "");
        uploadPayload.set("category", String(formData.get("category") || ""));
        uploadPayload.set("label", String(formData.get("label") || ""));
        uploadPayload.set("alt_es", String(formData.get("alt_es") || ""));
        uploadPayload.set("set_as_cover", formData.get("set_as_cover") === "on" ? "true" : "false");
        uploadPayload.set("file", file);
        mediaResponse = await request(`${apiBase}/${encodeURIComponent(current.id)}/media/upload`, {
          method: "POST",
          body: uploadPayload,
        });
      } else {
        const payload = {
          organization_id: state.organizationId || null,
          category: toText(formData.get("category")),
          url: toText(formData.get("url")),
          label: toText(formData.get("label")),
          alt_es: toText(formData.get("alt_es")),
          set_as_cover: formData.get("set_as_cover") === "on",
        };
        mediaResponse = await request(`${apiBase}/${encodeURIComponent(current.id)}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      el.mediaForm.reset();
      const queueMeta = mediaResponse?.meta?.media_optimize_queue || null;
      const queueSuffix = queueMeta?.enqueued
        ? " Optimizacion en cola."
        : queueMeta?.error
          ? " Media guardada, pero la cola de optimizacion no esta disponible."
          : "";
      setFeedback(
        `${hasFile ? "Archivo subido y vinculado." : "Media agregada."}${queueSuffix}`,
        "ok",
        { toast: true }
      );
      await loadProperties({ preserveSelection: true });
    } catch (error) {
      const rawMessage = String(error?.message || "error_subiendo_media");
      let friendly = rawMessage;
      if (rawMessage.includes("unsupported_file_type")) {
        friendly = "Formato no permitido. Usa PNG, JPG/JPEG o WEBP.";
      } else if (rawMessage.includes("file_too_large")) {
        friendly = "Archivo demasiado grande. Maximo 10 MB.";
      } else if (rawMessage.includes("empty_file")) {
        friendly = "El archivo esta vacio.";
      } else if (rawMessage.includes("invalid_or_missing_category")) {
        friendly = "Selecciona una categoria valida antes de subir.";
      } else if (rawMessage.includes("file_required")) {
        friendly = "Debes seleccionar un archivo.";
      }
      setFeedback(`Error al agregar media: ${friendly}`, "error", { toast: true });
    } finally {
      if (submitButton) {
        submitButton.removeAttribute("disabled");
        submitButton.textContent = originalButtonText || "Agregar archivo";
      }
    }
  });

  el.mediaBoard?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-media-action]");
    if (!button) return;

    const current = selected();
    if (!current) {
      setFeedback("Selecciona una propiedad para editar galeria.", "error", { toast: true });
      return;
    }

    try {
      await request(`${apiBase}/${encodeURIComponent(current.id)}/media`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: state.organizationId || null,
          action: button.getAttribute("data-media-action"),
          item_id: button.getAttribute("data-item-id"),
          category: button.getAttribute("data-category"),
          direction: button.getAttribute("data-direction"),
        }),
      });
      setFeedback("Galeria actualizada.", "ok", { toast: true });
      await loadProperties({ preserveSelection: true });
    } catch (error) {
      setFeedback(`Error actualizando galeria: ${error.message}`, "error", { toast: true });
    }
  });

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  const queryPropertyId = toText(search.get("property_id"));
  const queryProjectId = toText(search.get("project_id"));
  const queryPropertyTab = toText(search.get("tab"));
  const queryRecordTypePrefill = toText(search.get("record_type"));
  const queryParentLegacyCodePrefill = toText(search.get("parent_legacy_code"));
  const bootPropertyId = toText(window.__crmPropertyId);
  const bootProjectId = toText(window.__crmProjectId);
  const queryPage = toInt(search.get("page"), 1, 1, 10000);
  const queryPerPage = toInt(search.get("per_page"), 24, 1, 200);

  const organizationContext = resolveOrganizationContext(
    queryOrganizationId,
    localOrganizationId,
    defaultOrganizationId
  );
  state.organizationId = organizationContext.id;
  state.organizationSource = organizationContext.source;
  state.requestedPropertyId = queryPropertyId || bootPropertyId;
  state.requestedProjectId = queryProjectId || bootProjectId;
  state.pagination.page = queryPage;
  state.pagination.perPage = queryPerPage;

  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

  renderOrganizationContext();
  setPropertyTab(queryPropertyTab || state.activePropertyTab);
  if (el.perPageSelect) el.perPageSelect.value = String(state.pagination.perPage);
  if (el.createForm) setWizardStep(1);

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      updateMeta();
      renderDashboardGroups();
      renderTable();
    }, 120);
  });

  loadProperties({ preserveSelection: false });
})();
