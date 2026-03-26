(() => {
  const apiBase = "/api/v1/clients/kpis";
  const authMeApiBase = "/api/v1/crm/auth/me";
  const promotionStorageKey = "crm.clients.dashboard.promotion_id";
  const onlyActiveStorageKey = "crm.clients.dashboard.only_active";
  const statusFilterStorageKey = "crm.clients.dashboard.status_filter";
  const dashboardPreferenceStorageKey = "crm.clients.dashboard.preferences.v1";
  const ALL_PROMOTIONS_VALUE = "__all__";

  const statusLabels = {
    pre_registered: "Preinscrito",
    reservation_sent: "Reserva enviada",
    reserved: "Reservado",
    adhesion_paid: "Adhesion pagada",
    contract_signed: "Contrato firmado",
    cancelled: "Cancelado",
    discarded: "Descartado",
    other: "Otro",
  };

  const channelConfig = [
    { key: "direct", label: "Directo", color: "#0f8a56" },
    { key: "agency", label: "Agencia", color: "#f97316" },
    { key: "mixed", label: "Mixto", color: "#1d4ed8" },
    { key: "unknown", label: "Sin dato", color: "#7a889a" },
  ];
  const validStatusFilters = new Set(Object.keys(statusLabels));

  const activeStatusKeys = [
    "pre_registered",
    "reservation_sent",
    "reserved",
    "adhesion_paid",
    "contract_signed",
  ];

  const FIXED_KPI_WIDGETS = [
    {
      id: "reservations_total",
      label: "Reservas registradas",
      helper: "Volumen real importado en la promocion o en el total filtrado.",
    },
    {
      id: "active_reservations",
      label: "Reservas activas",
      helper: "Reservas en curso, excluyendo canceladas y descartadas.",
    },
    {
      id: "clients_total",
      label: "Clientes unicos",
      helper: "Clientes distintos vinculados a las reservas visibles.",
    },
    {
      id: "ratio",
      label: "Reservas por cliente",
      helper: "Intensidad comercial media por cliente.",
    },
    {
      id: "ticket",
      label: "Ticket medio sin IVA",
      helper: "Importe medio por operacion valida.",
    },
    {
      id: "cycle",
      label: "Ciclo medio",
      helper: "Dias medios para cerrar la operacion.",
    },
    {
      id: "reservation_paid",
      label: "Reserva pagada",
      helper: "Porcentaje de reservas con pago inicial confirmado.",
    },
    {
      id: "adhesion_paid",
      label: "Adhesion pagada",
      helper: "Porcentaje que ya ha avanzado a adhesion abonada.",
    },
    {
      id: "docs",
      label: "Documentacion completa",
      helper: "Cumplimiento documental medio del filtro actual.",
    },
    {
      id: "direct",
      label: "Canal directo",
      helper: "Peso relativo de la venta directa sobre el total.",
    },
    {
      id: "top_status",
      label: "Estado lider",
      helper: "Estado mas repetido del embudo actual.",
    },
  ];

  const FIXED_PANEL_WIDGETS = [
    {
      id: "overview",
      label: "Canal comercial y estados",
      helper: "Lectura rapida del mix comercial y del avance de reservas.",
    },
    {
      id: "monthly",
      label: "Evolucion mensual",
      helper: "Tendencia temporal de reservas y media movil.",
    },
    {
      id: "compare",
      label: "Comparativa entre promociones",
      helper: "Ranking y tabla detallada para detectar diferencias entre promociones.",
    },
  ];

  const defaultDashboardPreferences = () => ({
    version: 1,
    layout: {
      kpis: FIXED_KPI_WIDGETS.map((widget, index) => ({
        id: widget.id,
        visible: true,
        order: index,
      })),
      panels: FIXED_PANEL_WIDGETS.map((widget, index) => ({
        id: widget.id,
        visible: true,
        order: index,
      })),
    },
  });

  const state = {
    organizationId: "",
    organizationSource: "none",
    userId: "anon",
    userName: "",
    data: null,
    selectedPromotionId: "",
    onlyActive: false,
    statusFilter: "",
    layoutPanelOpen: false,
    preferences: defaultDashboardPreferences(),
    charts: {
      channel: null,
      status: null,
      monthly: null,
      compare: null,
    },
  };

  const el = {
    root: document.getElementById("clients-dashboard-root"),
    orgForm: document.getElementById("clients-kpi-org-form"),
    orgInput: document.getElementById("clients-kpi-organization-id"),
    orgMeta: document.getElementById("clients-kpi-org-meta"),
    promoMeta: document.getElementById("clients-kpi-promo-meta"),
    promotionSelect: document.getElementById("clients-kpi-promotion-select"),
    openListLink: document.getElementById("clients-kpi-open-list"),
    statusFilterSelect: document.getElementById("clients-kpi-status-filter"),
    onlyActiveCheckbox: document.getElementById("clients-kpi-only-active"),
    selectTopButton: document.getElementById("clients-kpi-select-top"),
    customizeToggleButton: document.getElementById("clients-kpi-customize-toggle"),
    customizeResetButton: document.getElementById("clients-kpi-customize-reset"),
    customizeCloseButton: document.getElementById("clients-kpi-customize-close"),
    layoutPanel: document.getElementById("clients-kpi-layout-panel"),
    layoutKpis: document.getElementById("clients-kpi-layout-kpis"),
    layoutPanels: document.getElementById("clients-kpi-layout-panels"),
    feedback: document.getElementById("clients-kpi-feedback"),
    cards: {
      reservationsTotal: document.getElementById("promo-kpi-reservations-total"),
      activeReservationsTotal: document.getElementById("promo-kpi-active-reservations"),
      clientsTotal: document.getElementById("promo-kpi-clients-total"),
      ratio: document.getElementById("promo-kpi-ratio"),
      ticket: document.getElementById("promo-kpi-ticket"),
      cycle: document.getElementById("promo-kpi-cycle"),
      reservationPaid: document.getElementById("promo-kpi-reservation-paid"),
      adhesionPaid: document.getElementById("promo-kpi-adhesion-paid"),
      docs: document.getElementById("promo-kpi-docs"),
      direct: document.getElementById("promo-kpi-direct"),
      topStatus: document.getElementById("promo-kpi-top-status"),
    },
    channelDonut: document.getElementById("clients-kpi-channel-donut"),
    channelLegend: document.getElementById("clients-kpi-channel-legend"),
    statusBars: document.getElementById("clients-kpi-status-bars"),
    monthly: document.getElementById("clients-kpi-monthly"),
    compareSummary: document.getElementById("clients-kpi-compare-summary"),
    compare: document.getElementById("clients-kpi-compare"),
    promotionsTbody: document.getElementById("clients-kpi-promotions-tbody"),
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

  const sanitizeStatusFilter = (value) => {
    const text = toText(value);
    if (!text) return "";
    return validStatusFilters.has(text) ? text : "";
  };

  const parseJsonSafe = (raw) => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const storageScope = () => `${state.organizationId || "default"}:${state.userId || "anon"}`;

  const buildScopedStorageKey = (baseKey) => `${baseKey}:${storageScope()}`;

  const readScopedStorage = (baseKey) => {
    try {
      return toText(localStorage.getItem(buildScopedStorageKey(baseKey)));
    } catch {
      return null;
    }
  };

  const writeScopedStorage = (baseKey, value) => {
    try {
      const scopedKey = buildScopedStorageKey(baseKey);
      if (toText(value)) localStorage.setItem(scopedKey, String(value));
      else localStorage.removeItem(scopedKey);
    } catch {
      // no-op
    }
  };

  const fmtInt = (value) => {
    const parsed = toNumber(value);
    if (parsed == null) return "-";
    return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(parsed);
  };

  const fmtDecimal = (value, digits = 2) => {
    const parsed = toNumber(value);
    if (parsed == null) return "-";
    return new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(parsed);
  };

  const fmtCurrency = (value) => {
    const parsed = toNumber(value);
    if (parsed == null) return "-";
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(parsed);
  };

  const fmtPct = (value) => {
    const parsed = toNumber(value);
    if (parsed == null) return "-";
    return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(parsed)}%`;
  };

  const formatMonth = (month) => {
    const text = toText(month);
    if (!text || !/^\d{4}-\d{2}$/.test(text)) return text || "-";
    const [year, monthValue] = text.split("-");
    const date = new Date(`${year}-${monthValue}-01T00:00:00Z`);
    return date.toLocaleDateString("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });
  };

  const formatDateTime = (value) => {
    const text = toText(value);
    if (!text) return "-";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleString("es-ES");
  };

  const sourceLabel = (source) => {
    if (source === "url") return "URL";
    if (source === "local") return "Local";
    if (source === "default") return "Por defecto CRM";
    if (source === "manual") return "Manual";
    return "Sin configurar";
  };

  const normalizeLayoutSection = (definitions, rawSection) => {
    const rawList = Array.isArray(rawSection) ? rawSection : [];
    const byId = new Map(
      rawList
        .map((item) => {
          const id = toText(item?.id);
          return id ? [id, item] : null;
        })
        .filter(Boolean)
    );

    return definitions
      .map((definition, index) => {
        const existing = byId.get(definition.id);
        const order = toNumber(existing?.order);
        return {
          id: definition.id,
          visible: existing?.visible !== false,
          order: order == null ? index : order,
        };
      })
      .sort((a, b) => a.order - b.order)
      .map((entry, index) => ({
        ...entry,
        order: index,
      }));
  };

  const normalizeDashboardPreferences = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const layout = source.layout && typeof source.layout === "object" ? source.layout : {};
    return {
      version: 1,
      layout: {
        kpis: normalizeLayoutSection(FIXED_KPI_WIDGETS, layout.kpis),
        panels: normalizeLayoutSection(FIXED_PANEL_WIDGETS, layout.panels),
      },
    };
  };

  const persistPreferences = () => {
    writeScopedStorage(
      dashboardPreferenceStorageKey,
      JSON.stringify({
        version: 1,
        layout: state.preferences.layout,
      })
    );
  };

  const loadPreferences = () => {
    state.preferences = normalizeDashboardPreferences(parseJsonSafe(readScopedStorage(dashboardPreferenceStorageKey)));
  };

  const getLayoutDefinitions = (section) => (section === "kpis" ? FIXED_KPI_WIDGETS : FIXED_PANEL_WIDGETS);

  const getSortedLayoutEntries = (section) =>
    (Array.isArray(state.preferences?.layout?.[section]) ? state.preferences.layout[section] : [])
      .slice()
      .sort((a, b) => a.order - b.order);

  const findLayoutItem = (section, widgetId) =>
    getSortedLayoutEntries(section).find((entry) => entry.id === widgetId) || null;

  const getWidgetNode = (section, widgetId) =>
    document.querySelector(`[data-dashboard-section="${section}"][data-widget-id="${widgetId}"]`);

  const isWidgetShown = (section, widgetId) => {
    const item = findLayoutItem(section, widgetId);
    if (!item) return true;
    return item.visible || state.layoutPanelOpen;
  };

  const setLayoutPanelOpen = (nextOpen) => {
    state.layoutPanelOpen = Boolean(nextOpen);
    if (el.layoutPanel instanceof HTMLElement) {
      el.layoutPanel.hidden = !state.layoutPanelOpen;
    }
    if (el.root instanceof HTMLElement) {
      el.root.classList.toggle("is-customizing", state.layoutPanelOpen);
    }
    if (el.customizeToggleButton instanceof HTMLButtonElement) {
      el.customizeToggleButton.textContent = state.layoutPanelOpen ? "Salir de edicion" : "Personalizar vista";
      el.customizeToggleButton.setAttribute("aria-expanded", String(state.layoutPanelOpen));
    }
  };

  const applyLayoutSection = (section) => {
    getSortedLayoutEntries(section).forEach((entry, index) => {
      const node = getWidgetNode(section, entry.id);
      if (!(node instanceof HTMLElement)) return;
      node.style.order = String(index);
      node.hidden = !(entry.visible || state.layoutPanelOpen);
      node.classList.toggle("is-layout-hidden", entry.visible === false);
      node.setAttribute("data-layout-order", String(index + 1));
      node.setAttribute("data-layout-state", entry.visible === false ? "Oculto" : "Visible");
    });
  };

  const applyDashboardLayout = () => {
    applyLayoutSection("kpis");
    applyLayoutSection("panels");
  };

  const buildLayoutRow = (section, definition, entry, index, total) => {
    const hiddenClass = entry.visible === false ? " is-hidden" : "";
    const statusLabel = entry.visible === false ? "Oculto" : "Visible";
    return `
      <div class="crm-layout-row${hiddenClass}">
        <div class="crm-layout-row-copy">
          <strong>${esc(definition.label)}</strong>
          <small>${esc(definition.helper)}</small>
        </div>
        <div class="crm-layout-row-actions">
          <span class="crm-layout-status">${esc(statusLabel)}</span>
          <button
            type="button"
            class="crm-layout-action-button is-toggle"
            data-layout-section="${esc(section)}"
            data-widget-id="${esc(definition.id)}"
            data-layout-action="toggle"
          >
            ${entry.visible === false ? "Mostrar" : "Ocultar"}
          </button>
          <button
            type="button"
            class="crm-layout-action-button"
            data-layout-section="${esc(section)}"
            data-widget-id="${esc(definition.id)}"
            data-layout-action="up"
            ${index === 0 ? "disabled" : ""}
          >
            Subir
          </button>
          <button
            type="button"
            class="crm-layout-action-button"
            data-layout-section="${esc(section)}"
            data-widget-id="${esc(definition.id)}"
            data-layout-action="down"
            ${index === total - 1 ? "disabled" : ""}
          >
            Bajar
          </button>
        </div>
      </div>
    `;
  };

  const renderLayoutList = (section, target) => {
    if (!(target instanceof HTMLElement)) return;
    const definitions = getLayoutDefinitions(section);
    const definitionsById = new Map(definitions.map((item) => [item.id, item]));
    const rows = getSortedLayoutEntries(section);
    target.innerHTML = rows
      .map((entry, index) => {
        const definition = definitionsById.get(entry.id);
        if (!definition) return "";
        return buildLayoutRow(section, definition, entry, index, rows.length);
      })
      .join("");
  };

  const renderLayoutEditor = () => {
    renderLayoutList("kpis", el.layoutKpis);
    renderLayoutList("panels", el.layoutPanels);
  };

  const updateLayoutEntry = (section, widgetId, updater) => {
    const next = getSortedLayoutEntries(section).map((entry) =>
      entry.id === widgetId ? updater({ ...entry }) : { ...entry }
    );
    state.preferences.layout[section] = next.map((entry, index) => ({
      ...entry,
      order: index,
    }));
    persistPreferences();
  };

  const moveLayoutEntry = (section, widgetId, direction) => {
    const current = getSortedLayoutEntries(section);
    const index = current.findIndex((entry) => entry.id === widgetId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    const temp = current[index];
    current[index] = current[targetIndex];
    current[targetIndex] = temp;
    state.preferences.layout[section] = current.map((entry, order) => ({
      ...entry,
      order,
    }));
    persistPreferences();
  };

  const resetPreferences = () => {
    state.preferences = defaultDashboardPreferences();
    persistPreferences();
  };

  const applyLayoutPreset = (presetId) => {
    const executiveKpis = new Set([
      "reservations_total",
      "active_reservations",
      "clients_total",
      "ticket",
      "direct",
      "top_status",
    ]);
    const commercialKpis = new Set([
      "reservations_total",
      "active_reservations",
      "cycle",
      "reservation_paid",
      "adhesion_paid",
      "docs",
      "top_status",
    ]);

    if (presetId === "executive") {
      state.preferences = normalizeDashboardPreferences({
        layout: {
          kpis: FIXED_KPI_WIDGETS.map((widget, index) => ({
            id: widget.id,
            visible: executiveKpis.has(widget.id),
            order: index,
          })),
          panels: FIXED_PANEL_WIDGETS.map((widget, index) => ({
            id: widget.id,
            visible: widget.id !== "monthly",
            order: index,
          })),
        },
      });
    } else if (presetId === "commercial") {
      state.preferences = normalizeDashboardPreferences({
        layout: {
          kpis: FIXED_KPI_WIDGETS.map((widget, index) => ({
            id: widget.id,
            visible: commercialKpis.has(widget.id),
            order: index,
          })),
          panels: FIXED_PANEL_WIDGETS.map((widget, index) => ({
            id: widget.id,
            visible: true,
            order: index,
          })),
        },
      });
    } else {
      state.preferences = defaultDashboardPreferences();
    }

    persistPreferences();
  };

  const loadViewerContext = async () => {
    try {
      const response = await fetch(authMeApiBase);
      const raw = await response.text();
      const payload = parseJsonSafe(raw);
      if (!response.ok || !payload?.ok) {
        state.userId = "anon";
        state.userName = "";
        return;
      }
      state.userId = toText(payload?.data?.user?.id) || "anon";
      state.userName = toText(payload?.data?.user?.full_name) || toText(payload?.data?.user?.email) || "";
    } catch {
      state.userId = "anon";
      state.userName = "";
    }
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
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 220) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
  };

  const promotionLabel = (promotion) => {
    if (!promotion || typeof promotion !== "object") return "Promocion";
    const code = toText(promotion.project_legacy_code);
    const name = toText(promotion.project_name);
    if (code && name) return `${code} | ${name}`;
    return name || code || "Promocion";
  };

  const getPromotions = () => (Array.isArray(state.data?.promotions) ? state.data.promotions : []);

  const isPromotionActive = (promotion) => {
    if (!promotion || typeof promotion !== "object") return false;
    const apiActiveCount = toNumber(promotion.active_reservations_total);
    if (apiActiveCount !== null) return apiActiveCount > 0;
    const total = toNumber(promotion.reservations_total) || 0;
    if (total <= 0) return false;
    const breakdown = Array.isArray(promotion.status_breakdown) ? promotion.status_breakdown : [];
    const activeCount = activeStatusKeys.reduce((sum, key) => {
      const row = breakdown.find((item) => item.status === key);
      return sum + (toNumber(row?.count) || 0);
    }, 0);
    return activeCount > 0;
  };

  const promotionHasStatus = (promotion, status) => {
    if (!status) return true;
    const breakdown = Array.isArray(promotion?.status_breakdown) ? promotion.status_breakdown : [];
    const row = breakdown.find((item) => item.status === status);
    return (toNumber(row?.count) || 0) > 0;
  };

  const getVisiblePromotions = () => {
    let rows = getPromotions();
    if (state.onlyActive) rows = rows.filter((item) => isPromotionActive(item));
    if (state.statusFilter) rows = rows.filter((item) => promotionHasStatus(item, state.statusFilter));
    return rows;
  };

  const getPromotionById = (projectId, rows = getVisiblePromotions()) =>
    rows.find((item) => toText(item.project_id) === toText(projectId)) || null;

  const isAllPromotionsSelected = () => state.selectedPromotionId === ALL_PROMOTIONS_VALUE;

  const getSelectedPromotion = () => (isAllPromotionsSelected() ? null : getPromotionById(state.selectedPromotionId));

  const persistSelectedPromotion = () => {
    if (state.selectedPromotionId) {
      localStorage.setItem(promotionStorageKey, state.selectedPromotionId);
    } else {
      localStorage.removeItem(promotionStorageKey);
    }
  };

  const deriveTopStatus = (rows) => {
    const breakdown = Array.isArray(rows) ? rows : [];
    return breakdown.reduce((best, item) => {
      const bestCount = toNumber(best?.count) || 0;
      const currentCount = toNumber(item?.count) || 0;
      return currentCount > bestCount ? item : best;
    }, null)?.status || "other";
  };

  const buildGlobalPromotionView = () => {
    if (!state.data) return null;
    return {
      project_id: ALL_PROMOTIONS_VALUE,
      project_legacy_code: null,
      project_name: "Todas las promociones",
      clients_total: state.data?.totals?.clients_linked_total,
      reservations_total: state.data?.totals?.reservations_total,
      active_reservations_total: state.data?.kpis?.active_reservations_total,
      active_reservations_pct: state.data?.kpis?.active_reservations_pct,
      avg_ticket_without_vat: state.data?.kpis?.avg_ticket_without_vat,
      avg_cycle_days: state.data?.kpis?.avg_cycle_days,
      reservation_paid_pct: state.data?.kpis?.reservation_paid_pct,
      adhesion_paid_pct: state.data?.kpis?.adhesion_paid_pct,
      document_completion_pct: state.data?.kpis?.document_completion_pct,
      top_status: deriveTopStatus(state.data?.status_breakdown),
      sales_channels: state.data?.sales_channels || {},
      monthly: Array.isArray(state.data?.monthly) ? state.data.monthly : [],
      status_breakdown: Array.isArray(state.data?.status_breakdown) ? state.data.status_breakdown : [],
    };
  };

  const getActiveDashboardView = () => {
    if (isAllPromotionsSelected()) return buildGlobalPromotionView();
    return getSelectedPromotion();
  };

  const ratioReservationsPerClient = (promotion) => {
    const reservations = toNumber(promotion?.reservations_total) || 0;
    const clients = toNumber(promotion?.clients_total) || 0;
    if (clients <= 0) return null;
    return reservations / clients;
  };

  const directPct = (promotion) => {
    const channels = promotion?.sales_channels || {};
    const total = toNumber(channels.total) || 0;
    const direct = toNumber(channels.direct) || 0;
    if (total <= 0) return null;
    return (direct / total) * 100;
  };

  const setCardsEmpty = () => {
    Object.values(el.cards).forEach((node) => {
      if (node) node.textContent = "-";
    });
  };

  const hasECharts = () =>
    typeof window !== "undefined" &&
    Boolean(window.echarts) &&
    typeof window.echarts.init === "function";

  const disposeChart = (key) => {
    const chart = state.charts[key];
    if (!chart) return;
    chart.dispose();
    state.charts[key] = null;
  };

  const ensureChart = (key, node) => {
    if (!node || !hasECharts()) return null;
    let chart = state.charts[key];
    if (chart && chart.getDom() !== node) {
      chart.dispose();
      chart = null;
    }
    if (!chart) {
      node.innerHTML = "";
      chart = window.echarts.init(node);
    }
    state.charts[key] = chart;
    return chart;
  };

  const setChartEmpty = (key, node, message) => {
    disposeChart(key);
    if (!node) return;
    node.innerHTML = `<p class="crm-inline-note">${esc(message)}</p>`;
  };

  const resizeCharts = () => {
    Object.values(state.charts).forEach((chart) => {
      chart?.resize();
    });
  };

  const shortLabel = (value, max = 30) => {
    const text = toText(value) || "";
    if (text.length <= max) return text;
    if (max <= 3) return text.slice(0, max);
    return `${text.slice(0, max - 3)}...`;
  };

  const pickTopPromotion = (rows, metricGetter) => {
    let winner = null;
    let winnerValue = -Infinity;
    rows.forEach((row) => {
      const value = toNumber(metricGetter(row));
      if (value == null) return;
      if (value > winnerValue) {
        winnerValue = value;
        winner = row;
      }
    });
    return { promotion: winner, value: Number.isFinite(winnerValue) ? winnerValue : null };
  };

  const renderCompareSummary = (rows) => {
    if (!el.compareSummary) return;
    if (!rows.length) {
      el.compareSummary.innerHTML = "<p class='crm-inline-note'>Sin promociones para comparar con este filtro.</p>";
      return;
    }

    const topReservations = pickTopPromotion(rows, (item) => item.reservations_total);
    const topActiveRate = pickTopPromotion(rows, (item) => item.active_reservations_pct);
    const topTicket = pickTopPromotion(rows, (item) => item.avg_ticket_without_vat);
    const topDocs = pickTopPromotion(rows, (item) => item.document_completion_pct);

    const cards = [
      {
        key: "volume",
        title: "Mayor volumen",
        metric: topReservations.value != null ? `${fmtInt(topReservations.value)} reservas` : "Sin dato",
        promotion: topReservations.promotion,
      },
      {
        key: "active-rate",
        title: "Mejor % activa",
        metric: topActiveRate.value != null ? `${fmtPct(topActiveRate.value)} activas` : "Sin dato",
        promotion: topActiveRate.promotion,
      },
      {
        key: "ticket",
        title: "Ticket mas alto",
        metric: topTicket.value != null ? `${fmtCurrency(topTicket.value)} medio` : "Sin dato",
        promotion: topTicket.promotion,
      },
      {
        key: "docs",
        title: "Documentacion top",
        metric: topDocs.value != null ? `${fmtPct(topDocs.value)} completa` : "Sin dato",
        promotion: topDocs.promotion,
      },
    ];

    el.compareSummary.innerHTML = cards
      .map((card) => {
        const projectId = toText(card.promotion?.project_id) || "";
        const selectedClass = projectId && projectId === state.selectedPromotionId ? " is-selected" : "";
        const label = shortLabel(promotionLabel(card.promotion), 42);
        return `
          <button type="button" class="crm-compare-summary-card crm-compare-summary-${esc(card.key)}${selectedClass}" data-project-id="${esc(projectId)}">
            <span class="crm-compare-summary-eyebrow">${esc(card.title)}</span>
            <strong>${esc(label || "Sin promocion")}</strong>
            <small>${esc(card.metric)}</small>
          </button>
        `;
      })
      .join("");
  };

  const renderCards = (promotion) => {
    if (!promotion) {
      setCardsEmpty();
      return;
    }

    if (el.cards.reservationsTotal) {
      el.cards.reservationsTotal.textContent = fmtInt(promotion.reservations_total);
    }
    if (el.cards.activeReservationsTotal) {
      el.cards.activeReservationsTotal.textContent = `${fmtInt(promotion.active_reservations_total)} (${fmtPct(
        promotion.active_reservations_pct
      )})`;
    }
    if (el.cards.clientsTotal) {
      el.cards.clientsTotal.textContent = fmtInt(promotion.clients_total);
    }
    if (el.cards.ratio) {
      el.cards.ratio.textContent = fmtDecimal(ratioReservationsPerClient(promotion), 2);
    }
    if (el.cards.ticket) {
      el.cards.ticket.textContent = fmtCurrency(promotion.avg_ticket_without_vat);
    }
    if (el.cards.cycle) {
      el.cards.cycle.textContent = fmtDecimal(promotion.avg_cycle_days, 1);
    }
    if (el.cards.reservationPaid) {
      el.cards.reservationPaid.textContent = fmtPct(promotion.reservation_paid_pct);
    }
    if (el.cards.adhesionPaid) {
      el.cards.adhesionPaid.textContent = fmtPct(promotion.adhesion_paid_pct);
    }
    if (el.cards.docs) {
      el.cards.docs.textContent = fmtPct(promotion.document_completion_pct);
    }
    if (el.cards.direct) {
      el.cards.direct.textContent = fmtPct(directPct(promotion));
    }
    if (el.cards.topStatus) {
      el.cards.topStatus.textContent = statusLabels[promotion.top_status] || promotion.top_status || "-";
    }
  };

  const renderOrganizationMeta = () => {
    if (el.orgInput) el.orgInput.value = state.organizationId;
    if (!el.orgMeta) return;
    if (!state.organizationId) {
      el.orgMeta.textContent = "Sin organization_id activo. Define CRM_ORGANIZATION_ID o aplicalo manualmente.";
      return;
    }
    el.orgMeta.textContent = `Organization activa: ${state.organizationId} | Origen: ${sourceLabel(
      state.organizationSource
    )}`;
  };

  const renderPromotionMeta = (promotion) => {
    if (!el.promoMeta) return;
    const generatedAt = formatDateTime(state.data?.generated_at);
    const filterParts = [];
    if (state.onlyActive) filterParts.push("solo activas");
    if (state.statusFilter) filterParts.push(`estado ${statusLabels[state.statusFilter] || state.statusFilter}`);
    const filterText = filterParts.length ? ` | Filtros: ${filterParts.join(" + ")}` : "";
    if (!promotion) {
      el.promoMeta.textContent = `No hay promocion con datos para los filtros actuales. Ultima actualizacion: ${generatedAt}${filterText}`;
      return;
    }
    if (isAllPromotionsSelected()) {
      el.promoMeta.textContent = `Modo actual: Todas las promociones | Reservas: ${fmtInt(
        promotion.reservations_total
      )} | Activas: ${fmtInt(promotion.active_reservations_total)} (${fmtPct(
        promotion.active_reservations_pct
      )}) | Clientes vinculados: ${fmtInt(promotion.clients_total)} | Promociones: ${fmtInt(
        state.data?.totals?.promotions_total
      )} | Actualizado: ${generatedAt}${filterText}`;
      return;
    }
    el.promoMeta.textContent = `Promocion activa: ${promotionLabel(
      promotion
    )} | Reservas: ${fmtInt(promotion.reservations_total)} | Activas: ${fmtInt(
      promotion.active_reservations_total
    )} (${fmtPct(promotion.active_reservations_pct)}) | Clientes: ${fmtInt(
      promotion.clients_total
    )} | Actualizado: ${generatedAt}${filterText}`;
  };

  const renderFilterControls = () => {
    if (el.onlyActiveCheckbox) el.onlyActiveCheckbox.checked = state.onlyActive;
    if (el.statusFilterSelect) el.statusFilterSelect.value = sanitizeStatusFilter(state.statusFilter);
  };

  const renderPromotionSelect = () => {
    if (!el.promotionSelect) return;
    const promotions = getVisiblePromotions();
    const baseOptions = [`<option value="${esc(ALL_PROMOTIONS_VALUE)}">Todas las promociones</option>`];
    if (!promotions.length) {
      el.promotionSelect.innerHTML = `${baseOptions.join("")}<option value="" disabled>Sin promociones para este filtro</option>`;
      el.promotionSelect.value = isAllPromotionsSelected() ? ALL_PROMOTIONS_VALUE : "";
      return;
    }
    el.promotionSelect.innerHTML = baseOptions
      .concat(
        promotions.map((promotion) => {
        const projectId = toText(promotion.project_id) || "";
        const selected = projectId === state.selectedPromotionId ? " selected" : "";
        return `<option value="${esc(projectId)}"${selected}>${esc(promotionLabel(promotion))}</option>`;
        })
      )
      .join("");
    el.promotionSelect.value = state.selectedPromotionId || ALL_PROMOTIONS_VALUE;
  };

  const renderListDrilldown = () => {
    if (!(el.openListLink instanceof HTMLAnchorElement)) return;
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    if (!isAllPromotionsSelected() && toText(state.selectedPromotionId)) {
      params.set("project_id", state.selectedPromotionId);
    }
    el.openListLink.href = `/crm/clients/${params.toString() ? `?${params.toString()}` : ""}`;
    el.openListLink.textContent = isAllPromotionsSelected()
      ? "Abrir listado completo"
      : "Abrir listado filtrado";
  };

  const renderChannel = (promotion) => {
    if (!el.channelDonut || !el.channelLegend) return;
    if (!isWidgetShown("panels", "overview")) {
      disposeChart("channel");
      return;
    }
    if (!hasECharts()) {
      setChartEmpty("channel", el.channelDonut, "No se pudo cargar la libreria de graficos.");
      el.channelLegend.innerHTML = "<li>Sin datos de canales.</li>";
      return;
    }
    const channels = promotion?.sales_channels || {};
    const total = Number(channels.total || 0);
    const segments = channelConfig.map((item) => {
      const value = Number(channels[item.key] || 0);
      const pct = total > 0 ? (value / total) * 100 : 0;
      return {
        ...item,
        value,
        pct,
      };
    });

    if (total <= 0) {
      setChartEmpty("channel", el.channelDonut, "Sin datos de canales.");
      el.channelLegend.innerHTML = "<li>Sin datos de canales.</li>";
      return;
    }

    const chart = ensureChart("channel", el.channelDonut);
    if (!chart) return;
    chart.setOption({
      animationDuration: 500,
      tooltip: {
        trigger: "item",
        formatter: (params) =>
          `${params.marker} ${params.name}<br/>${fmtInt(params.value)} (${fmtPct(params.percent)})`,
      },
      series: [
        {
          type: "pie",
          radius: ["52%", "76%"],
          center: ["50%", "50%"],
          minAngle: 3,
          label: {
            show: true,
            color: "#243649",
            formatter: "{b}\n{d}%",
            fontSize: 11,
            lineHeight: 14,
          },
          labelLine: {
            length: 10,
            length2: 8,
          },
          itemStyle: {
            borderRadius: 8,
            borderColor: "#fff",
            borderWidth: 2,
            shadowBlur: 6,
            shadowColor: "rgba(18, 38, 58, 0.14)",
          },
          data: segments.map((item) => ({
            value: item.value,
            name: item.label,
            itemStyle: {
              color: item.color,
            },
          })),
        },
      ],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "41%",
          style: {
            text: fmtInt(total),
            fontSize: 27,
            fontWeight: 800,
            fill: "#12324d",
          },
        },
        {
          type: "text",
          left: "center",
          top: "57%",
          style: {
            text: "Total",
            fontSize: 12,
            fontWeight: 700,
            fill: "#63758a",
          },
        },
      ],
    });

    el.channelLegend.innerHTML = segments
      .map(
        (item) => `
        <li>
          <span><span class="crm-metric-dot" style="background:${esc(item.color)}"></span>${esc(item.label)}</span>
          <strong>${esc(fmtInt(item.value))} (${esc(fmtPct(item.pct))})</strong>
        </li>
      `
      )
      .join("");
  };

  const renderStatusBars = (promotion) => {
    if (!el.statusBars) return;
    if (!isWidgetShown("panels", "overview")) {
      disposeChart("status");
      return;
    }
    if (!hasECharts()) {
      setChartEmpty("status", el.statusBars, "No se pudo cargar la libreria de graficos.");
      return;
    }
    const rows = Array.isArray(promotion?.status_breakdown)
      ? promotion.status_breakdown
          .filter((item) => Number(item.count || 0) > 0)
          .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      : [];
    if (!rows.length) {
      setChartEmpty("status", el.statusBars, "Sin datos de estado.");
      return;
    }

    const labels = rows.map((item) => statusLabels[item.status] || item.status || "Estado");
    const counts = rows.map((item) => Number(item.count || 0));
    const pcts = rows.map((item) => Number(item.pct || 0));

    const chart = ensureChart("status", el.statusBars);
    if (!chart) return;
    chart.setOption({
      animationDuration: 500,
      grid: {
        left: 130,
        right: 24,
        top: 20,
        bottom: 22,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          const row = params?.[0];
          if (!row) return "";
          const idx = Number(row.dataIndex || 0);
          return `${row.marker} ${labels[idx]}<br/>${fmtInt(counts[idx])} reservas (${fmtPct(pcts[idx])})`;
        },
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#5a6f86",
        },
        splitLine: {
          lineStyle: {
            color: "rgba(15, 31, 51, 0.1)",
          },
        },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: labels,
        axisLabel: {
          color: "#2a3b50",
          fontWeight: 600,
        },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: counts,
          barWidth: 16,
          itemStyle: {
            borderRadius: [0, 10, 10, 0],
            color: new window.echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: "#1d4ed8" },
              { offset: 1, color: "#0ea5e9" },
            ]),
          },
          label: {
            show: true,
            position: "right",
            color: "#1d3550",
            fontWeight: 700,
            formatter: (params) => `${fmtInt(params.value)} (${fmtPct(pcts[params.dataIndex])})`,
          },
        },
      ],
    });
  };

  const renderMonthly = (promotion) => {
    if (!el.monthly) return;
    if (!isWidgetShown("panels", "monthly")) {
      disposeChart("monthly");
      return;
    }
    if (!hasECharts()) {
      setChartEmpty("monthly", el.monthly, "No se pudo cargar la libreria de graficos.");
      return;
    }
    const rows = Array.isArray(promotion?.monthly) ? promotion.monthly.slice(-18) : [];
    if (!rows.length) {
      setChartEmpty("monthly", el.monthly, "Sin datos mensuales para la promocion.");
      return;
    }

    const months = rows.map((item) => formatMonth(item.month));
    const counts = rows.map((item) => Number(item.count || 0));
    const rollingAverage = counts.map((_, index) => {
      const start = Math.max(0, index - 2);
      const slice = counts.slice(start, index + 1);
      const total = slice.reduce((sum, value) => sum + value, 0);
      return total / slice.length;
    });

    const chart = ensureChart("monthly", el.monthly);
    if (!chart) return;
    chart.setOption({
      animationDuration: 500,
      legend: {
        top: 8,
        right: 10,
        data: ["Reservas", "Media 3m"],
        textStyle: {
          color: "#51657d",
          fontWeight: 600,
        },
      },
      grid: {
        left: 45,
        right: 20,
        top: 52,
        bottom: 40,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
      },
      xAxis: {
        type: "category",
        data: months,
        axisLabel: {
          color: "#5a6f86",
        },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: "#5a6f86",
        },
        splitLine: {
          lineStyle: {
            color: "rgba(15, 31, 51, 0.1)",
          },
        },
      },
      series: [
        {
          name: "Reservas",
          type: "bar",
          data: counts,
          barMaxWidth: 34,
          itemStyle: {
            borderRadius: [7, 7, 0, 0],
            color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#1d4ed8" },
              { offset: 1, color: "#2563eb" },
            ]),
          },
        },
        {
          name: "Media 3m",
          type: "line",
          smooth: true,
          data: rollingAverage,
          lineStyle: {
            color: "#0f8a56",
            width: 2,
          },
          symbolSize: 6,
          itemStyle: {
            color: "#0f8a56",
          },
        },
      ],
    });
  };

  const meter = (value, percent, color = "#1d4ed8") => {
    const pct = Math.max(0, Math.min(100, Number(percent) || 0));
    return `
      <div class="crm-cell-meter">
        <span>${esc(value)}</span>
        <div class="crm-bar-track"><div class="crm-bar-fill" style="width:${pct}%; background:${esc(color)}"></div></div>
      </div>
    `;
  };

  const renderCompare = () => {
    if (!isWidgetShown("panels", "compare")) {
      disposeChart("compare");
      return;
    }
    const visiblePromotions = getVisiblePromotions();
    renderCompareSummary(visiblePromotions);
    if (!el.compare) return;
    if (!hasECharts()) {
      setChartEmpty("compare", el.compare, "No se pudo cargar la libreria de graficos.");
      return;
    }
    const promotions = visiblePromotions
      .slice()
      .sort((a, b) => Number(b.reservations_total || 0) - Number(a.reservations_total || 0))
      .slice(0, 12);
    if (!promotions.length) {
      setChartEmpty("compare", el.compare, "Sin datos de promociones.");
      return;
    }

    const labels = promotions.map((item) => shortLabel(promotionLabel(item), 34));
    const fullLabels = promotions.map((item) => promotionLabel(item));
    const projectIds = promotions.map((item) => toText(item.project_id) || "");
    const reservationsData = promotions.map((item) => ({
      value: Number(item.reservations_total || 0),
      itemStyle: {
        color: (toText(item.project_id) || "") === state.selectedPromotionId ? "#0f8a56" : "#1d4ed8",
      },
    }));
    const activeData = promotions.map((item) => ({
      value: Number(item.active_reservations_total || 0),
      itemStyle: {
        color: (toText(item.project_id) || "") === state.selectedPromotionId ? "#22c55e" : "#0ea5e9",
      },
    }));

    const chart = ensureChart("compare", el.compare);
    if (!chart) return;
    if (!chart.__crmCompareBound) {
      chart.on("click", (params) => {
        const dataIndex = Number(params?.dataIndex);
        if (!Number.isInteger(dataIndex) || dataIndex < 0) return;
        const nextId = chart.__crmProjectIds?.[dataIndex];
        if (!nextId) return;
        selectPromotion(nextId, true);
      });
      chart.__crmCompareBound = true;
    }
    chart.__crmProjectIds = projectIds;

    chart.setOption({
      animationDuration: 500,
      legend: {
        top: 10,
        right: 12,
        data: ["Reservas", "Activas"],
        textStyle: {
          color: "#51657d",
          fontWeight: 600,
        },
      },
      grid: {
        left: 180,
        right: 26,
        top: 54,
        bottom: 32,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          if (!Array.isArray(params) || !params.length) return "";
          const idx = Number(params[0].dataIndex || 0);
          const reserveValue = Number(promotions[idx]?.reservations_total || 0);
          const activeValue = Number(promotions[idx]?.active_reservations_total || 0);
          return [
            `<strong>${esc(fullLabels[idx])}</strong>`,
            `${params[0].marker} Reservas: ${fmtInt(reserveValue)}`,
            `${params[1]?.marker || ""} Activas: ${fmtInt(activeValue)} (${fmtPct(
              promotions[idx]?.active_reservations_pct
            )})`,
            "Haz clic para abrir KPI",
          ].join("<br/>");
        },
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#5a6f86",
        },
        splitLine: {
          lineStyle: {
            color: "rgba(15, 31, 51, 0.1)",
          },
        },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: labels,
        axisLabel: {
          color: "#2a3b50",
          fontWeight: 600,
          width: 168,
          overflow: "truncate",
        },
        axisTick: {
          show: false,
        },
      },
      series: [
        {
          name: "Reservas",
          type: "bar",
          data: reservationsData,
          barMaxWidth: 15,
          barGap: "20%",
          itemStyle: {
            borderRadius: [0, 8, 8, 0],
          },
        },
        {
          name: "Activas",
          type: "bar",
          data: activeData,
          barMaxWidth: 15,
          itemStyle: {
            borderRadius: [0, 8, 8, 0],
          },
        },
      ],
    });
  };

  const renderPromotionsTable = () => {
    if (!el.promotionsTbody) return;
    if (!isWidgetShown("panels", "compare")) return;
    const rows = getVisiblePromotions();
    if (!rows.length) {
      el.promotionsTbody.innerHTML = "<tr><td colspan='13'>Sin promociones con datos.</td></tr>";
      return;
    }

    const maxClients = Math.max(...rows.map((item) => Number(item.clients_total || 0)), 1);
    const maxReservations = Math.max(...rows.map((item) => Number(item.reservations_total || 0)), 1);
    const maxActiveReservations = Math.max(
      ...rows.map((item) => Number(item.active_reservations_total || 0)),
      1
    );

    el.promotionsTbody.innerHTML = rows
      .map((item) => {
        const projectId = toText(item.project_id) || "";
        const selectedClass = projectId === state.selectedPromotionId ? " class='crm-row-selected'" : "";
        const clients = Number(item.clients_total || 0);
        const reservations = Number(item.reservations_total || 0);
        const activeReservations = Number(item.active_reservations_total || 0);
        const clientsPct = (clients / maxClients) * 100;
        const reservationsPct = (reservations / maxReservations) * 100;
        const activeReservationsPct = (activeReservations / maxActiveReservations) * 100;
        return `
          <tr${selectedClass}>
            <td data-label="Promocion"><strong>${esc(promotionLabel(item))}</strong></td>
            <td data-label="Reservas">${meter(fmtInt(reservations), reservationsPct, "#0ea5e9")}</td>
            <td data-label="Activas">${meter(fmtInt(activeReservations), activeReservationsPct, "#0f8a56")}</td>
            <td data-label="% activa">${esc(fmtPct(item.active_reservations_pct))}</td>
            <td data-label="Clientes">${meter(fmtInt(clients), clientsPct, "#1d4ed8")}</td>
            <td data-label="Res/cliente">${esc(fmtDecimal(ratioReservationsPerClient(item), 2))}</td>
            <td data-label="Directo">${esc(fmtPct(directPct(item)))}</td>
            <td data-label="Reserva pagada">${esc(fmtPct(item.reservation_paid_pct))}</td>
            <td data-label="Adhesion pagada">${esc(fmtPct(item.adhesion_paid_pct))}</td>
            <td data-label="Docs OK">${esc(fmtPct(item.document_completion_pct))}</td>
            <td data-label="Ticket">${esc(fmtCurrency(item.avg_ticket_without_vat))}</td>
            <td data-label="Ciclo">${esc(fmtDecimal(item.avg_cycle_days, 1))}</td>
            <td data-label="Estado lider">${esc(statusLabels[item.top_status] || item.top_status || "-")}</td>
          </tr>
        `;
      })
      .join("");
  };

  const renderDashboard = () => {
    renderFilterControls();
    renderPromotionSelect();
    setLayoutPanelOpen(state.layoutPanelOpen);
    applyDashboardLayout();
    renderLayoutEditor();
    const promotion = getActiveDashboardView();
    renderCards(promotion);
    renderChannel(promotion);
    renderStatusBars(promotion);
    renderMonthly(promotion);
    renderCompare();
    renderPromotionsTable();
    renderPromotionMeta(promotion);
    renderListDrilldown();
    resizeCharts();
  };

  const selectPromotion = (projectId, persist = true) => {
    const nextId = toText(projectId);
    if (nextId === ALL_PROMOTIONS_VALUE) {
      state.selectedPromotionId = ALL_PROMOTIONS_VALUE;
      if (persist) persistSelectedPromotion();
      renderDashboard();
      return;
    }
    const visiblePromotions = getVisiblePromotions();
    const exists = nextId ? Boolean(getPromotionById(nextId, visiblePromotions)) : false;
    state.selectedPromotionId = exists ? nextId : ALL_PROMOTIONS_VALUE;
    if (persist) persistSelectedPromotion();
    renderDashboard();
  };

  const loadDashboard = async () => {
    if (!state.organizationId) {
      state.data = null;
      state.selectedPromotionId = "";
      renderDashboard();
      setFeedback("Define organization_id para cargar KPIs.", "error");
      return;
    }

    try {
      const params = new URLSearchParams({ organization_id: state.organizationId });
      const payload = await request(`${apiBase}?${params.toString()}`);
      state.data = payload?.data || null;

      const promotions = getVisiblePromotions();
      const selectedExists =
        isAllPromotionsSelected() || promotions.some((item) => toText(item.project_id) === state.selectedPromotionId);
      if (!selectedExists) {
        state.selectedPromotionId = ALL_PROMOTIONS_VALUE;
      }

      persistSelectedPromotion();
      renderDashboard();
      setFeedback("Dashboard KPI actualizado.", "ok");
    } catch (error) {
      state.data = null;
      state.selectedPromotionId = ALL_PROMOTIONS_VALUE;
      renderDashboard();
      setFeedback(`Error cargando dashboard: ${error.message}`, "error");
    }
  };

  const persistFilters = () => {
    if (state.onlyActive) localStorage.setItem(onlyActiveStorageKey, "1");
    else localStorage.removeItem(onlyActiveStorageKey);

    if (state.statusFilter) localStorage.setItem(statusFilterStorageKey, state.statusFilter);
    else localStorage.removeItem(statusFilterStorageKey);
  };

  const applyFiltersFromUi = () => {
    state.onlyActive = Boolean(el.onlyActiveCheckbox?.checked);
    state.statusFilter = sanitizeStatusFilter(el.statusFilterSelect?.value);
    persistFilters();

    const visiblePromotions = getVisiblePromotions();
    const selectedExists = visiblePromotions.some(
      (item) => toText(item.project_id) === state.selectedPromotionId
    );
    if (!selectedExists && !isAllPromotionsSelected()) {
      state.selectedPromotionId = ALL_PROMOTIONS_VALUE;
      persistSelectedPromotion();
    }

    renderDashboard();
  };

  const bindKpiHelpTitles = () => {
    document.querySelectorAll(".crm-kpi-help").forEach((node) => {
      const help = toText(node.getAttribute("data-help"));
      if (!help) return;
      node.setAttribute("title", help);
      node.setAttribute("aria-label", help);
    });
  };

  el.orgForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextId = toText(el.orgInput?.value);
    const defaultOrgId = toText(window.__crmDefaultOrganizationId);
    const localOrgId = toText(localStorage.getItem("crm.organization_id"));
    const fallbackOrgId = localOrgId || defaultOrgId || state.organizationId;
    state.organizationId = nextId || fallbackOrgId || "";
    state.organizationSource = nextId
      ? "manual"
      : state.organizationId && state.organizationId === defaultOrgId
        ? "default"
        : state.organizationId
          ? "local"
          : "none";
    if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);
    else localStorage.removeItem("crm.organization_id");
    loadPreferences();
    renderOrganizationMeta();
    setFeedback(
      !nextId && fallbackOrgId
        ? "Se mantiene la organizacion activa en CRM."
        : state.organizationId
          ? "Organizacion activa actualizada."
          : "Sin organizacion configurada.",
      state.organizationId ? "ok" : "error"
    );
    await loadDashboard();
  });

  el.promotionSelect?.addEventListener("change", () => {
    selectPromotion(el.promotionSelect?.value || "", true);
  });

  el.onlyActiveCheckbox?.addEventListener("change", () => {
    applyFiltersFromUi();
  });

  el.statusFilterSelect?.addEventListener("change", () => {
    applyFiltersFromUi();
  });

  el.selectTopButton?.addEventListener("click", () => {
    const firstId = toText(getVisiblePromotions()[0]?.project_id);
    selectPromotion(firstId || "", true);
  });

  el.compareSummary?.addEventListener("click", (event) => {
    const trigger = event.target instanceof HTMLElement ? event.target.closest("button[data-project-id]") : null;
    if (!trigger) return;
    const nextId = toText(trigger.getAttribute("data-project-id"));
    if (!nextId) return;
    selectPromotion(nextId, true);
  });

  el.customizeToggleButton?.addEventListener("click", () => {
    setLayoutPanelOpen(!state.layoutPanelOpen);
    renderDashboard();
    if (state.layoutPanelOpen) setFeedback("Modo edicion activo. Ajusta tu vista y se guardara automaticamente.", "ok");
    else setFeedback("Modo edicion cerrado. Tu vista personalizada sigue guardada.", "ok");
  });

  el.customizeCloseButton?.addEventListener("click", () => {
    setLayoutPanelOpen(false);
    renderDashboard();
    setFeedback("Editor cerrado.", "ok");
  });

  el.customizeResetButton?.addEventListener("click", () => {
    resetPreferences();
    renderDashboard();
    setFeedback("Vista restaurada al modelo completo.", "ok");
  });

  el.layoutPanel?.addEventListener("click", (event) => {
    const trigger = event.target instanceof HTMLElement ? event.target.closest("button") : null;
    if (!(trigger instanceof HTMLButtonElement)) return;

    const presetId = toText(trigger.getAttribute("data-layout-preset"));
    if (presetId) {
      applyLayoutPreset(presetId);
      renderDashboard();
      setFeedback("Vista rapida aplicada. Puedes seguir ajustando el detalle si quieres.", "ok");
      return;
    }

    const section = toText(trigger.getAttribute("data-layout-section"));
    const widgetId = toText(trigger.getAttribute("data-widget-id"));
    const action = toText(trigger.getAttribute("data-layout-action"));
    if (!section || !widgetId || !action) return;

    if (action === "toggle") {
      updateLayoutEntry(section, widgetId, (entry) => ({
        ...entry,
        visible: entry.visible === false,
      }));
    } else if (action === "up" || action === "down") {
      moveLayoutEntry(section, widgetId, action);
    } else {
      return;
    }

    renderDashboard();
  });

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      resizeCharts();
    });
  });

  const search = new URLSearchParams(window.location.search);
  const queryOrgId = toText(search.get("organization_id"));
  const queryPromotionId = toText(search.get("promotion_id"));
  const queryOnlyActive = toText(search.get("only_active"));
  const queryStatusFilter = toText(search.get("status"));
  const localOrgId = toText(localStorage.getItem("crm.organization_id"));
  const localPromotionId = toText(localStorage.getItem(promotionStorageKey));
  const localOnlyActive = toText(localStorage.getItem(onlyActiveStorageKey));
  const localStatusFilter = toText(localStorage.getItem(statusFilterStorageKey));
  const defaultOrgId = toText(window.__crmDefaultOrganizationId);

  if (queryOrgId) {
    state.organizationId = queryOrgId;
    state.organizationSource = "url";
  } else if (localOrgId) {
    state.organizationId = localOrgId;
    state.organizationSource = "local";
  } else if (defaultOrgId) {
    state.organizationId = defaultOrgId;
    state.organizationSource = "default";
  }

  state.selectedPromotionId = queryPromotionId || localPromotionId || ALL_PROMOTIONS_VALUE;
  if (queryOnlyActive) {
    const normalized = queryOnlyActive.toLowerCase();
    state.onlyActive = ["1", "true", "si", "yes"].includes(normalized);
  } else {
    state.onlyActive = localOnlyActive === "1";
  }
  state.statusFilter = sanitizeStatusFilter(queryStatusFilter || localStatusFilter || "");

  const boot = async () => {
    await loadViewerContext();
    loadPreferences();
    if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);
    persistFilters();
    renderOrganizationMeta();
    bindKpiHelpTitles();
    renderDashboard();
    await loadDashboard();
  };

  boot();
})();
