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
    projectDetailsCache: new Map(),
    parentLegacyById: new Map(),
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

  const propertyRef = (item, fallback = "sin codigo") => {
    const code = toText(item?.legacy_code);
    return code || fallback;
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

    const cards = [
      { label: "Total propiedades", value: stats.total ?? 0 },
      { label: "Disponibles", value: stats.available_total ?? 0 },
      { label: "Promociones", value: stats.projects_total ?? 0 },
      { label: "Viviendas de promocion", value: stats.units_total ?? 0 },
    ];

    el.kpiGrid.innerHTML = cards
      .map(
        (card) => `
          <article class="crm-card crm-kpi">
            <strong>${esc(card.value)}</strong>
            <p>${esc(card.label)}</p>
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

    el.statusBoard.innerHTML = propertyStatuses
      .map((status) => {
        const count = Number(stats.by_status?.[status] ?? 0);
        return `<span class="crm-status-chip">${esc(statusLabels[status] || status)}: ${esc(count)}</span>`;
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

    el.promotionsTbody.innerHTML = promotions
      .slice(0, 20)
      .map((promo) => `
        <tr>
          <td><strong>${esc(projectLabel(promo))}</strong><br /><small>${esc(propertyRef(promo))}</small></td>
          <td>${esc(businessLabels[promo.business_type] || promo.business_type || "-")}</td>
          <td><span class="crm-badge ${statusClass[promo.status] || "warn"}">${esc(promo.status || "-")}</span></td>
          <td>${esc(promo.total_units ?? 0)}</td>
          <td>${esc(promo.available_units ?? 0)}</td>
          <td>${esc(promo.reserved_units ?? 0)}</td>
          <td>${esc((promo.sold_units ?? 0) + (promo.rented_units ?? 0))}</td>
        </tr>
      `)
      .join("");
  };

  const renderDashboardGroups = () => {
    if (!el.dashboardGroups) return;

    const promotions = Array.isArray(state.stats?.promotions) ? state.stats.promotions : [];
    const grouped = new Map(dashboardBuckets.map((bucket) => [bucket.key, []]));
    promotions.forEach((promo) => {
      if (!grouped.has(promo.business_type)) return;
      grouped.get(promo.business_type).push(promo);
    });

    el.dashboardGroups.innerHTML = dashboardBuckets
      .map((bucket) => {
        const rows = grouped.get(bucket.key) || [];
        const rowsHtml = rows.length
          ? rows
              .map((entry) => `
                <li class="crm-dashboard-promo-item">
                  <div>
                    <strong>${esc(projectLabel(entry))}</strong>
                    <small>Ref: ${esc(propertyRef(entry))}</small>
                    <small>${esc(entry.available_units ?? 0)} / ${esc(entry.total_units ?? 0)} disponibles</small>
                  </div>
                  <span class="crm-badge ${entry.available_units > 0 ? "ok" : "warn"}">${esc(entry.total_units ?? 0)} viviendas</span>
                  <button type="button" class="crm-mini-btn" data-dashboard-action="open-project" data-project-id="${esc(entry.id)}">Abrir</button>
                </li>
              `)
              .join("")
          : "<li class='crm-dashboard-promo-item-empty'>Sin promociones con los filtros actuales.</li>";

        return `
          <article class="crm-dashboard-column">
            <h3>${esc(bucket.title)}</h3>
            <p class="crm-inline-note">${esc(bucket.helper)}</p>
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
        const singles = Number(stats.singles_total ?? 0);
        if (isCompactViewport()) {
          el.dashboardSummary.textContent =
            `${stats.total || 0} registros | ${stats.projects_total || 0} promociones | ` +
            `${stats.available_total || 0} disponibles`;
        } else {
          el.dashboardSummary.textContent =
            `Total ${stats.total || 0} registros | ${stats.projects_total || 0} promociones | ` +
            `${stats.units_total || 0} viviendas en promociones | ${singles} viviendas sueltas | ` +
            `${stats.available_total || 0} disponibles`;
        }
      }
    }
  };

  const renderDashboard = () => {
    renderDashboardKpis();
    renderStatusBoard();
    renderDashboardGroups();
    renderPromotionTable();
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
        return `
          <article class="crm-project-item ${selectedClass}">
            <button type="button" class="crm-project-select" data-project-id="${esc(promo.id)}">
              <strong>${esc(projectLabel(promo))}</strong>
              <small class="crm-project-meta crm-project-meta-ref">Ref: ${esc(propertyRef(promo))}</small>
              <small class="crm-project-meta crm-project-meta-model">${esc(businessLabels[promo.business_type] || promo.business_type || "-")}</small>
              <small class="crm-project-meta crm-project-meta-stock">${esc(promo.total_units ?? 0)} viviendas | ${esc(promo.available_units ?? 0)} disponibles</small>
              <small class="crm-project-meta crm-project-meta-status">Estado: ${esc(promo.status || "-")}</small>
            </button>
            <button type="button" class="crm-mini-btn" data-action="open-project-page" data-id="${esc(promo.id)}">Pagina</button>
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
      renderProjectKpis(null, []);
      renderProjectExecutive(null, []);
      return;
    }
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
      renderProjectKpis(null, []);
      renderProjectExecutive(null, []);
      return;
    }

    const availability = availabilityBadge(project);
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
          </div>
          <span class="crm-badge ${availability.className}">${availability.label}</span>
        </div>
        <p class="crm-unit-meta">${esc(availableUnits)} de ${esc(units.length)} viviendas disponibles</p>
        <p class="crm-unit-price">${esc(money(project))}</p>
        <div class="crm-actions-row">
          <button type="button" class="crm-mini-btn" data-action="open-project-page" data-id="${esc(project.id)}">Abrir ficha promocion</button>
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

        return `<section class="crm-media-category"><h3>${esc(mediaCategoryLabel(category))}</h3><ul class="crm-media-list">${rows}</ul></section>`;
      })
      .join("");
  };

  const fillEditor = (item) => {
    if (!el.editForm) return;
    if (!item) {
      setFormsEnabled(false);
      el.editForm.reset();
      if (el.selectedPropertyContext) {
        el.selectedPropertyContext.textContent =
          "Selecciona una propiedad del listado para editar la ficha.";
      }
      if (el.coverBox) el.coverBox.innerHTML = "<p>Selecciona una propiedad para gestionar portada y galeria.</p>";
      if (el.mediaBoard) el.mediaBoard.innerHTML = "";
      return;
    }

    setFormsEnabled(true);
    if (el.selectedPropertyContext) {
      el.selectedPropertyContext.textContent =
        `Propiedad activa: ${propertyLabel(item, "sin nombre")} | Ref: ${propertyRef(item)} | ${item.record_type || "-"}`;
    }

    el.editForm.elements.id.value = item.id;
    el.editForm.elements.legacy_code.value = item.legacy_code || "";
    el.editForm.elements.record_type.value = item.record_type || "single";
    el.editForm.elements.project_business_type.value = item.project_business_type || "external_listing";
    el.editForm.elements.operation_type.value = item.operation_type || "sale";
    el.editForm.elements.status.value = item.status || "draft";
    const parentId = toText(item.parent_property_id);
    const cachedParentLegacyCode = parentId
      ? state.parentLegacyById.get(parentId) || findKnownPropertyById(parentId)?.legacy_code || ""
      : "";
    el.editForm.elements.parent_legacy_code.value = cachedParentLegacyCode;
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
    el.editForm.elements.commercialization_notes.value = item.commercialization_notes || "";
    renderMedia(item);
  };

  const payloadFromForm = (form) => {
    const formData = new FormData(form);
    const parentLegacyCode = toText(formData.get("parent_legacy_code"));
    return {
      organization_id: state.organizationId || null,
      legacy_code: toText(formData.get("legacy_code")),
      record_type: toText(formData.get("record_type")),
      project_business_type: toText(formData.get("project_business_type")),
      operation_type: toText(formData.get("operation_type")),
      status: toText(formData.get("status")),
      ...(parentLegacyCode ? { parent_legacy_code: parentLegacyCode } : {}),
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
        setFeedback("Para una vivienda de promocion debes indicar la promocion padre (legacy_code).", "error", {
          toast: true,
        });
        return false;
      }
    }

    return true;
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
          el.projectExecBoard
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
    const pageButton = target.closest("button[data-action='open-property-page']");
    if (pageButton) {
      openPropertyPage(pageButton.getAttribute("data-id"));
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
      setFeedback("Propiedad creada correctamente.", "ok", { toast: true });

      if (!el.editForm && state.selectedId) {
        openPropertyPage(state.selectedId);
        return;
      }

      await loadProperties({ preserveSelection: true });
    } catch (error) {
      setFeedback(`Error al crear: ${error.message}`, "error", { toast: true });
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
      setFeedback(`Error al actualizar: ${error.message}`, "error", { toast: true });
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
      if (hasFile) {
        const uploadPayload = new FormData();
        uploadPayload.set("organization_id", state.organizationId || "");
        uploadPayload.set("category", String(formData.get("category") || ""));
        uploadPayload.set("label", String(formData.get("label") || ""));
        uploadPayload.set("alt_es", String(formData.get("alt_es") || ""));
        uploadPayload.set("set_as_cover", formData.get("set_as_cover") === "on" ? "true" : "false");
        uploadPayload.set("file", file);
        await request(`${apiBase}/${encodeURIComponent(current.id)}/media/upload`, {
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
        await request(`${apiBase}/${encodeURIComponent(current.id)}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      el.mediaForm.reset();
      setFeedback(hasFile ? "Archivo subido y vinculado." : "Media agregada.", "ok", { toast: true });
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
