(() => {
  const apiBase = "/api/v1/crm/leads";
  const propertiesApiBase = "/api/v1/properties";
  const authMeApiBase = "/api/v1/crm/auth/me";
  const CHART_ITEM_LIMIT = 10;
  const CUSTOM_WIDGET_LIMIT = 6;
  const projectStorageKey = "crm.leads.dashboard.project_id";
  const originTypeStorageKey = "crm.leads.dashboard.origin_type";
  const sourceStorageKey = "crm.leads.dashboard.source";
  const nationalityStorageKey = "crm.leads.dashboard.nationality";
  const dashboardPreferenceStorageKey = "crm.leads.dashboard.preferences.v1";
  const BAR_COLORS = [
    "#1f4c78",
    "#2f6fa3",
    "#3f8bbb",
    "#4ea6c6",
    "#61b6af",
    "#78b17b",
    "#a3984f",
    "#cb8339",
    "#d96b3f",
    "#bf4b5a",
  ];

  const STATUS_LABELS = {
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

  const ORIGIN_LABELS = {
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

  const SOURCE_LABELS = {
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

  const FIXED_KPI_WIDGETS = [
    { id: "total", label: "Total leads", helper: "Volumen global de captacion." },
    { id: "new", label: "Nuevos", helper: "Leads pendientes de primer contacto." },
    { id: "treated", label: "Tratados", helper: "Leads con actividad comercial." },
    { id: "untreated", label: "No tratados", helper: "Backlog pendiente de gestion." },
    { id: "treated_rate", label: "% tratamiento", helper: "Cobertura comercial del filtro activo." },
    { id: "top_origin", label: "Canal lider", helper: "Canal detallado con mayor volumen." },
  ];

  const FIXED_CHART_WIDGETS = [
    { id: "origin_donut", label: "Canales de entrada", helper: "Distribucion por canal detallado." },
    { id: "treated_bars", label: "Tratados vs no tratados", helper: "Comparativa de gestion comercial." },
    { id: "projects_3d", label: "Top promociones", helper: "Ranking de leads por promocion." },
    { id: "sources_treemap", label: "Familias de origen", helper: "Peso por familia agregada." },
    { id: "status_funnel", label: "Embudo por estado", helper: "Distribucion por etapa comercial." },
    {
      id: "nationalities_radar",
      label: "Radar de nacionalidades",
      helper: "Volumen entre nacionalidades dominantes.",
    },
  ];

  const CUSTOM_CHART_TYPE_LABELS = {
    donut: "Donut",
    bar: "Barras",
    treemap: "Treemap",
    funnel: "Embudo",
    radar: "Radar",
  };

  const CUSTOM_DATASET_CONFIG = {
    source: {
      label: "Canal detallado",
      helper: "Idealista, Fotocasa, Formulario Web BR, email, etc.",
      chart_types: ["donut", "bar"],
      default_chart_type: "donut",
    },
    origin_type: {
      label: "Familia de origen",
      helper: "Portal, web, email, WhatsApp, etc.",
      chart_types: ["treemap", "donut", "bar"],
      default_chart_type: "treemap",
    },
    status: {
      label: "Estado comercial",
      helper: "Nuevo, cualificado, visita, negociacion, etc.",
      chart_types: ["funnel", "bar"],
      default_chart_type: "funnel",
    },
    project: {
      label: "Promocion",
      helper: "Promociones con mayor volumen de leads.",
      chart_types: ["bar"],
      default_chart_type: "bar",
    },
    nationality: {
      label: "Nacionalidad",
      helper: "Nacionalidades registradas en el filtro activo.",
      chart_types: ["radar", "bar"],
      default_chart_type: "radar",
    },
  };

  const defaultDashboardPreferences = () => ({
    version: 1,
    layout: {
      kpis: FIXED_KPI_WIDGETS.map((widget, index) => ({
        id: widget.id,
        visible: true,
        order: index,
      })),
      charts: FIXED_CHART_WIDGETS.map((widget, index) => ({
        id: widget.id,
        visible: true,
        order: index,
      })),
    },
    custom_widgets: [],
  });

  const state = {
    organizationId: "",
    userId: "anon",
    userName: "",
    selectedProjectId: "",
    selectedOriginType: "",
    selectedSource: "",
    selectedNationality: "",
    projectOptions: [],
    originOptions: [],
    sourceOptions: [],
    nationalityOptions: [],
    dashboardPayload: null,
    dashboardViewModel: null,
    layoutPanelOpen: false,
    preferences: defaultDashboardPreferences(),
    charts: {
      origin: null,
      treated: null,
      sources: null,
      statuses: null,
      nationalities: null,
    },
  };

  const el = {
    filterForm: document.getElementById("leads-dashboard-filters"),
    projectSelect: document.getElementById("leads-dashboard-project-select"),
    originSelect: document.getElementById("leads-dashboard-origin-select"),
    sourceSelect: document.getElementById("leads-dashboard-source-select"),
    nationalitySelect: document.getElementById("leads-dashboard-nationality-select"),
    resetButton: document.getElementById("leads-dashboard-reset"),
    customizeToggleButton: document.getElementById("leads-dashboard-customize-toggle"),
    customizeResetButton: document.getElementById("leads-dashboard-customize-reset"),
    layoutPanel: document.getElementById("leads-dashboard-layout-panel"),
    layoutPanelCloseButton: document.getElementById("leads-dashboard-customize-close"),
    kpiLayoutList: document.getElementById("leads-dashboard-kpi-layout-list"),
    chartLayoutList: document.getElementById("leads-dashboard-chart-layout-list"),
    customLayoutList: document.getElementById("leads-dashboard-custom-layout-list"),
    customWidgetForm: document.getElementById("leads-dashboard-custom-widget-form"),
    customWidgetTitle: document.getElementById("leads-dashboard-custom-widget-title"),
    customWidgetDataset: document.getElementById("leads-dashboard-custom-widget-dataset"),
    customWidgetChartType: document.getElementById("leads-dashboard-custom-widget-chart-type"),
    customWidgetHelp: document.getElementById("leads-dashboard-custom-widget-help"),
    customGrid: document.getElementById("leads-dashboard-custom-grid"),
    context: document.getElementById("leads-dashboard-context"),
    feedback: document.getElementById("leads-dashboard-feedback"),
    kpiTotal: document.getElementById("leads-kpi-total"),
    kpiNew: document.getElementById("leads-kpi-new"),
    kpiTreated: document.getElementById("leads-kpi-treated"),
    kpiUntreated: document.getElementById("leads-kpi-untreated"),
    kpiTreatedRate: document.getElementById("leads-kpi-treated-rate"),
    kpiTopOrigin: document.getElementById("leads-kpi-top-origin"),
    chartOriginDonut: document.getElementById("leads-chart-origin-donut"),
    chartOriginLegend: document.getElementById("leads-chart-origin-legend"),
    chartTreatedBars: document.getElementById("leads-chart-treated-bars"),
    chartProjects3d: document.getElementById("leads-chart-projects-3d"),
    chartSourcesTreemap: document.getElementById("leads-chart-sources-treemap"),
    chartStatusFunnel: document.getElementById("leads-chart-status-funnel"),
    chartNationalitiesRadar: document.getElementById("leads-chart-nationalities-radar"),
  };

  const threeChartRegistry = new WeakMap();
  const customChartRegistry = new Map();

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

  const fmtInt = (value) => {
    const parsed = toNumber(value);
    if (parsed == null) return "0";
    return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(parsed);
  };

  const fmtPct = (value) => {
    const parsed = toNumber(value);
    if (parsed == null) return "0%";
    return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(parsed)}%`;
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

  const shortLabel = (value, max = 26) => {
    const text = toText(value) || "";
    if (text.length <= max) return text;
    if (max <= 3) return text.slice(0, max);
    return `${text.slice(0, max - 3)}...`;
  };

  const labelStatus = (value) => {
    const key = toText(value)?.toLowerCase() ?? "";
    return STATUS_LABELS[key] || humanizeToken(value);
  };

  const labelOrigin = (value) => {
    const key = toText(value)?.toLowerCase() ?? "";
    return ORIGIN_LABELS[key] || humanizeToken(value);
  };

  const labelSource = (value) => {
    const key = toText(value)?.toLowerCase() ?? "";
    return SOURCE_LABELS[key] || humanizeToken(value);
  };

  const projectLabel = (value) => {
    if (!value || typeof value !== "object") return "Promocion";
    const code = toText(value.project_code);
    const label = toText(value.project_label);
    if (code && label) return `${code} | ${label}`;
    return label || code || "Promocion";
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

  const readScopedStorage = (baseKey, legacyKey = null) => {
    try {
      const scopedValue = toText(localStorage.getItem(buildScopedStorageKey(baseKey)));
      if (scopedValue) return scopedValue;
      if (legacyKey) return toText(localStorage.getItem(legacyKey));
      return null;
    } catch {
      return null;
    }
  };

  const writeScopedStorage = (baseKey, value, legacyKey = null) => {
    try {
      const scopedKey = buildScopedStorageKey(baseKey);
      if (toText(value)) localStorage.setItem(scopedKey, String(value));
      else localStorage.removeItem(scopedKey);
      if (legacyKey) localStorage.removeItem(legacyKey);
    } catch {
      // no-op
    }
  };

  const getCustomDatasetConfig = (dataset) =>
    CUSTOM_DATASET_CONFIG[toText(dataset) || ""] ?? CUSTOM_DATASET_CONFIG.source;

  const getAllowedCustomChartTypes = (dataset) => getCustomDatasetConfig(dataset).chart_types.slice();

  const getDefaultCustomChartType = (dataset) => getCustomDatasetConfig(dataset).default_chart_type;

  const defaultCustomWidgetTitle = (dataset, chartType) => {
    const datasetLabel = getCustomDatasetConfig(dataset).label;
    const chartLabel = CUSTOM_CHART_TYPE_LABELS[chartType] || "Grafico";
    return `${datasetLabel} | ${chartLabel}`;
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
      .sort((a, b) => a.order - b.order);
  };

  const normalizeCustomWidget = (item, index) => {
    const dataset = toText(item?.dataset);
    if (!dataset || !CUSTOM_DATASET_CONFIG[dataset]) return null;
    const allowedChartTypes = getAllowedCustomChartTypes(dataset);
    const requestedChartType = toText(item?.chart_type);
    const chartType = allowedChartTypes.includes(requestedChartType)
      ? requestedChartType
      : getDefaultCustomChartType(dataset);
    const id = toText(item?.id) || `custom_widget_${index + 1}_${chartType}`;
    const title = toText(item?.title) || defaultCustomWidgetTitle(dataset, chartType);
    return {
      id,
      dataset,
      chart_type: chartType,
      title,
    };
  };

  const normalizeDashboardPreferences = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const layout = source.layout && typeof source.layout === "object" ? source.layout : {};
    const customWidgets = Array.isArray(source.custom_widgets) ? source.custom_widgets : [];
    return {
      version: 1,
      layout: {
        kpis: normalizeLayoutSection(FIXED_KPI_WIDGETS, layout.kpis),
        charts: normalizeLayoutSection(FIXED_CHART_WIDGETS, layout.charts),
      },
      custom_widgets: customWidgets
        .map((item, index) => normalizeCustomWidget(item, index))
        .filter(Boolean)
        .slice(0, CUSTOM_WIDGET_LIMIT),
    };
  };

  const findLayoutItem = (section, widgetId) =>
    state.preferences.layout[section].find((entry) => entry.id === widgetId) || null;

  const persistPreferences = () => {
    const payload = {
      version: 1,
      layout: state.preferences.layout,
      custom_widgets: state.preferences.custom_widgets,
    };
    writeScopedStorage(dashboardPreferenceStorageKey, JSON.stringify(payload));
  };

  const loadPreferences = () => {
    const raw = readScopedStorage(dashboardPreferenceStorageKey);
    state.preferences = normalizeDashboardPreferences(parseJsonSafe(raw));
  };

  const setLayoutPanelOpen = (nextOpen) => {
    state.layoutPanelOpen = Boolean(nextOpen);
    if (el.layoutPanel instanceof HTMLElement) {
      el.layoutPanel.classList.toggle("is-visible", state.layoutPanelOpen);
    }
    if (el.customizeToggleButton instanceof HTMLButtonElement) {
      el.customizeToggleButton.textContent = state.layoutPanelOpen ? "Ocultar personalizacion" : "Personalizar";
      el.customizeToggleButton.setAttribute("aria-expanded", String(state.layoutPanelOpen));
    }
  };

  const updateLayoutEntry = (section, widgetId, updater) => {
    const current = state.preferences.layout[section];
    const next = current.map((entry) => (entry.id === widgetId ? updater({ ...entry }) : { ...entry }));
    state.preferences.layout[section] = next;
    persistPreferences();
  };

  const moveLayoutEntry = (section, widgetId, direction) => {
    const current = state.preferences.layout[section].slice().sort((a, b) => a.order - b.order);
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

  const addCustomWidget = (input) => {
    if (state.preferences.custom_widgets.length >= CUSTOM_WIDGET_LIMIT) {
      throw new Error(`maximo_${CUSTOM_WIDGET_LIMIT}_widgets_personalizados`);
    }
    const dataset = toText(input?.dataset);
    if (!dataset || !CUSTOM_DATASET_CONFIG[dataset]) throw new Error("dataset_invalido");
    const allowedChartTypes = getAllowedCustomChartTypes(dataset);
    const chartType = allowedChartTypes.includes(toText(input?.chart_type))
      ? toText(input.chart_type)
      : getDefaultCustomChartType(dataset);
    const title = toText(input?.title) || defaultCustomWidgetTitle(dataset, chartType);
    state.preferences.custom_widgets.push({
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dataset,
      chart_type: chartType,
      title,
    });
    persistPreferences();
  };

  const moveCustomWidget = (widgetId, direction) => {
    const current = state.preferences.custom_widgets.slice();
    const index = current.findIndex((entry) => entry.id === widgetId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    const temp = current[index];
    current[index] = current[targetIndex];
    current[targetIndex] = temp;
    state.preferences.custom_widgets = current;
    persistPreferences();
  };

  const removeCustomWidget = (widgetId) => {
    const next = state.preferences.custom_widgets.filter((entry) => entry.id !== widgetId);
    if (next.length === state.preferences.custom_widgets.length) return;
    state.preferences.custom_widgets = next;
    persistPreferences();
  };

  const resetPreferences = () => {
    state.preferences = defaultDashboardPreferences();
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

  const groupPortalSourceRows = (rows) => {
    const groups = new Map([
      ["idealista", { label: "Idealista", count: 0 }],
      ["fotocasa", { label: "Fotocasa", count: 0 }],
      ["others", { label: "Otros portales", count: 0 }],
    ]);

    rows.forEach((entry) => {
      const key = toText(entry?.code)?.toLowerCase() || "";
      const count = toNumber(entry?.count) || 0;
      if (!count) return;
      if (key === "idealista") groups.get("idealista").count += count;
      else if (key === "fotocasa") groups.get("fotocasa").count += count;
      else groups.get("others").count += count;
    });

    return Array.from(groups.values()).filter((entry) => entry.count > 0);
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

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

  const bindKpiHelpTitles = () => {
    document.querySelectorAll(".crm-kpi-help").forEach((node) => {
      const help = toText(node.getAttribute("data-help"));
      if (!help) return;
      node.setAttribute("title", help);
      node.setAttribute("aria-label", help);
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
    customChartRegistry.forEach((chart) => {
      chart?.resize?.();
    });
  };

  const hasThree = () => typeof window.THREE === "object";

  const disposeMaterial = (material) => {
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach((entry) => disposeMaterial(entry));
      return;
    }
    if (typeof material.dispose === "function") material.dispose();
  };

  const disposeObjectTree = (root) => {
    if (!root || typeof root.traverse !== "function") return;
    root.traverse((node) => {
      if (node?.geometry && typeof node.geometry.dispose === "function") {
        node.geometry.dispose();
      }
      disposeMaterial(node?.material);
    });
  };

  const destroyThreeChart = (node) => {
    const cleanup = threeChartRegistry.get(node);
    if (cleanup && typeof cleanup.destroy === "function") {
      cleanup.destroy();
    }
    threeChartRegistry.delete(node);
  };

  const renderFallbackChartList = (node, rows, emptyMessage) => {
    if (!(node instanceof HTMLElement)) return;
    if (!rows.length) {
      node.innerHTML = `<p class="crm-inline-note">${esc(emptyMessage)}</p>`;
      return;
    }

    const max = Math.max(...rows.map((entry) => entry.count), 1);
    node.innerHTML = rows
      .map((entry) => {
        const label = toText(entry.label) || "-";
        const count = toNumber(entry.count) || 0;
        const percent = Math.max(2, Math.round((count / max) * 100));
        return `
          <div class="crm-chart-row">
            <p class="crm-chart-label">${esc(label)}</p>
            <div class="crm-chart-track">
              <span class="crm-chart-fill" style="width:${percent}%"></span>
            </div>
            <p class="crm-chart-value">${esc(String(count))}</p>
          </div>
        `;
      })
      .join("");
  };

  const renderThreeChart = (node, inputRows, emptyMessage) => {
    if (!(node instanceof HTMLElement)) return;
    destroyThreeChart(node);

    const rows = inputRows
      .map((row) => ({
        label: toText(row.label) || "-",
        count: toNumber(row.count) || 0,
      }))
      .filter((row) => row.count > 0)
      .slice(0, CHART_ITEM_LIMIT);

    if (!rows.length) {
      node.innerHTML = `<p class="crm-inline-note">${esc(emptyMessage)}</p>`;
      return;
    }

    if (!hasThree()) {
      renderFallbackChartList(node, rows, emptyMessage);
      return;
    }

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    node.innerHTML = `
      <div class="crm-chart-3d-shell">
        <div class="crm-chart-3d-canvas" aria-hidden="true"></div>
        <ol class="crm-chart-legend" aria-label="Detalle de valores">
          ${rows
            .map((entry, index) => {
              const percent = total > 0 ? Math.round((entry.count / total) * 100) : 0;
              const color = BAR_COLORS[index % BAR_COLORS.length];
              return `
                <li class="crm-chart-legend-row">
                  <span class="crm-chart-legend-dot" style="background:${esc(color)}"></span>
                  <span class="crm-chart-legend-label">${esc(entry.label)}</span>
                  <span class="crm-chart-legend-value">${esc(String(entry.count))} leads (${esc(String(percent))}%)</span>
                </li>
              `;
            })
            .join("")}
        </ol>
      </div>
    `;

    const canvasHost = node.querySelector(".crm-chart-3d-canvas");
    if (!(canvasHost instanceof HTMLElement)) {
      renderFallbackChartList(node, rows, emptyMessage);
      return;
    }

    try {
      const THREE = window.THREE;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      canvasHost.appendChild(renderer.domElement);

      camera.position.set(0, 5.4, 8.8);
      camera.lookAt(0, 1.4, 0);

      const ambient = new THREE.AmbientLight(0xffffff, 0.7);
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.86);
      keyLight.position.set(4, 7, 4);
      const fillLight = new THREE.DirectionalLight(0xa8c3df, 0.36);
      fillLight.position.set(-5, 4, -2);
      scene.add(ambient, keyLight, fillLight);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 11),
        new THREE.MeshStandardMaterial({ color: 0xe3ebf5, roughness: 0.95, metalness: 0.02 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      scene.add(floor);

      const barsGroup = new THREE.Group();
      const maxCount = Math.max(...rows.map((entry) => entry.count), 1);
      const spacing = rows.length > 7 ? 1.16 : 1.34;
      const startX = -((rows.length - 1) * spacing) / 2;

      rows.forEach((entry, index) => {
        const ratio = entry.count / maxCount;
        const height = 0.32 + ratio * 4.6;
        const geometry = new THREE.BoxGeometry(0.88, height, 0.88);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(BAR_COLORS[index % BAR_COLORS.length]),
          roughness: 0.34,
          metalness: 0.2,
        });
        const bar = new THREE.Mesh(geometry, material);
        bar.position.set(startX + index * spacing, height / 2, 0);
        barsGroup.add(bar);

        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: 0x12314f, transparent: true, opacity: 0.22 })
        );
        edge.position.copy(bar.position);
        barsGroup.add(edge);
      });

      barsGroup.rotation.x = 0.08;
      barsGroup.rotation.y = -0.62;
      scene.add(barsGroup);

      const renderScene = () => {
        renderer.render(scene, camera);
      };

      const resize = () => {
        const width = Math.max(220, Math.floor(canvasHost.clientWidth || node.clientWidth || 320));
        const height = Math.max(220, Math.min(300, Math.round(width * 0.58)));
        canvasHost.style.height = `${height}px`;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderScene();
      };

      let frame = 0;
      let animationRef = 0;
      const animationFrames = 34;
      const startRotation = -0.62;
      const endRotation = -0.4;
      const animateIn = () => {
        frame += 1;
        const progress = Math.min(1, frame / animationFrames);
        barsGroup.rotation.y = startRotation + (endRotation - startRotation) * progress;
        renderScene();
        if (progress < 1) animationRef = window.requestAnimationFrame(animateIn);
      };

      const resizeObserver =
        typeof window.ResizeObserver === "function"
          ? new window.ResizeObserver(() => {
              resize();
            })
          : null;

      resize();
      animateIn();
      resizeObserver?.observe(node);

      threeChartRegistry.set(node, {
        destroy: () => {
          if (animationRef) window.cancelAnimationFrame(animationRef);
          resizeObserver?.disconnect();
          disposeObjectTree(scene);
          renderer.dispose();
          if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
          }
        },
      });
    } catch {
      renderFallbackChartList(node, rows, emptyMessage);
    }
  };

  const renderOrigin = (rows) => {
    if (!(el.chartOriginLegend instanceof HTMLElement)) return;
    if (!hasECharts()) {
      setChartEmpty("origin", el.chartOriginDonut, "No se pudo cargar la libreria de graficos.");
      el.chartOriginLegend.innerHTML = "<li>Sin datos de canales.</li>";
      return;
    }
    if (!rows.length) {
      setChartEmpty("origin", el.chartOriginDonut, "Sin datos de canal de entrada.");
      el.chartOriginLegend.innerHTML = "<li>Sin datos de canales.</li>";
      return;
    }

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const chart = ensureChart("origin", el.chartOriginDonut);
    if (!chart) return;

    chart.setOption({
      animationDuration: 500,
      tooltip: {
        trigger: "item",
        formatter: (params) =>
          `${params.marker} ${params.name}<br/>${fmtInt(params.value)} leads (${fmtPct(params.percent)})`,
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
          data: rows.map((item, index) => ({
            value: item.count,
            name: item.label,
            itemStyle: {
              color: BAR_COLORS[index % BAR_COLORS.length],
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
            fontSize: 26,
            fontWeight: 800,
            fill: "#12324d",
          },
        },
        {
          type: "text",
          left: "center",
          top: "57%",
          style: {
            text: "Leads",
            fontSize: 12,
            fontWeight: 700,
            fill: "#63758a",
          },
        },
      ],
    });

    el.chartOriginLegend.innerHTML = rows
      .map((item, index) => {
        const pct = total > 0 ? (item.count / total) * 100 : 0;
        const color = BAR_COLORS[index % BAR_COLORS.length];
        return `
          <li>
            <span><span class="crm-metric-dot" style="background:${esc(color)}"></span>${esc(item.label)}</span>
            <strong>${esc(fmtInt(item.count))} (${esc(fmtPct(pct))})</strong>
          </li>
        `;
      })
      .join("");
  };

  const renderTreatedBars = (treated, untreated) => {
    if (!hasECharts()) {
      setChartEmpty("treated", el.chartTreatedBars, "No se pudo cargar la libreria de graficos.");
      return;
    }
    const rows = [
      { label: "Tratados", value: treated, color: "#0f8a56" },
      { label: "No tratados", value: untreated, color: "#f97316" },
    ];
    const max = Math.max(...rows.map((row) => row.value), 1);
    const chart = ensureChart("treated", el.chartTreatedBars);
    if (!chart) return;
    chart.setOption({
      animationDuration: 500,
      grid: {
        left: 130,
        right: 24,
        top: 20,
        bottom: 24,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      xAxis: {
        type: "value",
        max,
        axisLabel: { color: "#5a6f86" },
        splitLine: {
          lineStyle: { color: "rgba(15, 31, 51, 0.1)" },
        },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((row) => row.label),
        axisLabel: {
          color: "#2a3b50",
          fontWeight: 600,
        },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: rows.map((row) => ({
            value: row.value,
            itemStyle: { color: row.color, borderRadius: [0, 10, 10, 0] },
          })),
          label: {
            show: true,
            position: "right",
            color: "#1d3550",
            fontWeight: 700,
            formatter: (params) => fmtInt(params.value),
          },
          barWidth: 18,
        },
      ],
    });
  };

  const renderSourcesTreemap = (rows) => {
    if (!hasECharts()) {
      setChartEmpty("sources", el.chartSourcesTreemap, "No se pudo cargar la libreria de graficos.");
      return;
    }
    if (!rows.length) {
      setChartEmpty("sources", el.chartSourcesTreemap, "Sin fuentes registradas.");
      return;
    }
    const chart = ensureChart("sources", el.chartSourcesTreemap);
    if (!chart) return;
    chart.setOption({
      animationDuration: 500,
      tooltip: {
        formatter: (info) => `${info.marker} ${info.name}: ${fmtInt(info.value)} leads`,
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: {
            show: true,
            formatter: (params) => `${shortLabel(params.name, 24)}\n${fmtInt(params.value)}`,
            color: "#0f2135",
            fontWeight: 700,
            lineHeight: 16,
          },
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 2,
            gapWidth: 2,
            borderRadius: 10,
          },
          color: BAR_COLORS,
          data: rows.map((row) => ({
            name: row.label,
            value: row.count,
          })),
        },
      ],
    });
  };

  const renderStatusFunnel = (rows) => {
    if (!hasECharts()) {
      setChartEmpty("statuses", el.chartStatusFunnel, "No se pudo cargar la libreria de graficos.");
      return;
    }
    if (!rows.length) {
      setChartEmpty("statuses", el.chartStatusFunnel, "Sin estados disponibles.");
      return;
    }
    const chart = ensureChart("statuses", el.chartStatusFunnel);
    if (!chart) return;
    chart.setOption({
      animationDuration: 500,
      tooltip: {
        trigger: "item",
        formatter: (params) => `${params.marker} ${params.name}: ${fmtInt(params.value)} leads`,
      },
      series: [
        {
          type: "funnel",
          left: "8%",
          top: 20,
          bottom: 20,
          width: "84%",
          minSize: "22%",
          maxSize: "100%",
          sort: "descending",
          gap: 4,
          label: {
            show: true,
            position: "inside",
            color: "#fff",
            fontWeight: 700,
            formatter: (params) => `${shortLabel(params.name, 20)}: ${fmtInt(params.value)}`,
          },
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 2,
          },
          color: BAR_COLORS,
          data: rows.map((row) => ({ name: row.label, value: row.count })),
        },
      ],
    });
  };

  const renderNationalitiesRadar = (rows) => {
    if (!hasECharts()) {
      setChartEmpty("nationalities", el.chartNationalitiesRadar, "No se pudo cargar la libreria de graficos.");
      return;
    }
    const topRows = rows.slice(0, 6);
    if (!topRows.length) {
      setChartEmpty("nationalities", el.chartNationalitiesRadar, "Sin nacionalidades registradas.");
      return;
    }
    const maxValue = Math.max(...topRows.map((row) => row.count), 1);
    const indicators = topRows.map((row) => ({
      name: shortLabel(row.label, 18),
      max: maxValue,
    }));
    const values = topRows.map((row) => row.count);

    const chart = ensureChart("nationalities", el.chartNationalitiesRadar);
    if (!chart) return;
    chart.setOption({
      animationDuration: 500,
      tooltip: {},
      legend: {
        data: ["Leads por nacionalidad"],
        right: 12,
        top: 8,
        textStyle: {
          color: "#51657d",
          fontWeight: 600,
        },
      },
      radar: {
        radius: "66%",
        indicator: indicators,
        axisName: {
          color: "#2a3b50",
          fontWeight: 700,
        },
        splitLine: {
          lineStyle: { color: "rgba(15, 31, 51, 0.12)" },
        },
        splitArea: {
          areaStyle: {
            color: ["rgba(242, 247, 255, 0.38)", "rgba(233, 241, 252, 0.2)"],
          },
        },
      },
      series: [
        {
          name: "Leads por nacionalidad",
          type: "radar",
          data: [
            {
              value: values,
              itemStyle: { color: "#1d4ed8" },
              lineStyle: { color: "#1d4ed8", width: 2 },
              areaStyle: { color: "rgba(29, 78, 216, 0.28)" },
              symbolSize: 6,
            },
          ],
        },
      ],
    });
  };

  const buildDashboardViewModel = (payload) => {
    const total = toNumber(payload?.meta?.total) || 0;
    const summary = payload?.meta?.summary || {};
    const byStatus = summary.by_status || {};
    const byOriginType = summary.by_origin_type || {};
    const bySource = summary.by_source || {};
    const byTreated = summary.by_treated || {};
    const topProjects = Array.isArray(summary.top_projects) ? summary.top_projects : [];
    const topNationalities = Array.isArray(summary.top_nationalities) ? summary.top_nationalities : [];

    const newCount = toNumber(byStatus.new) || 0;
    const treated = toNumber(byTreated.treated) || 0;
    const untreated = toNumber(byTreated.untreated) || 0;
    const treatedRate = total > 0 ? (treated / total) * 100 : 0;

    const rawChannelRows = Object.entries(bySource)
      .map(([code, count]) => ({
        code,
        label: labelSource(code),
        count: toNumber(count) || 0,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count);

    const channelRows =
      state.selectedOriginType === "portal"
        ? groupPortalSourceRows(rawChannelRows)
        : rawChannelRows.slice(0, CHART_ITEM_LIMIT).map(({ label, count }) => ({ label, count }));

    const originRows = Object.entries(byOriginType)
      .map(([code, count]) => ({ label: labelOrigin(code), count: toNumber(count) || 0 }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, CHART_ITEM_LIMIT);

    const projectRows = topProjects
      .map((entry) => ({
        label: toText(entry.project_label) || toText(entry.project_code) || "Sin promocion",
        count: toNumber(entry.count) || 0,
      }))
      .filter((entry) => entry.count > 0)
      .slice(0, CHART_ITEM_LIMIT);

    const nationalityRows = topNationalities
      .map((entry) => ({
        label: toText(entry.nationality) || "Sin dato",
        count: toNumber(entry.count) || 0,
      }))
      .filter((entry) => entry.count > 0)
      .slice(0, CHART_ITEM_LIMIT);

    const statusRows = Object.entries(byStatus)
      .map(([status, count]) => ({ label: labelStatus(status), count: toNumber(count) || 0 }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, CHART_ITEM_LIMIT);

    const topOrigin = channelRows[0] ? `${channelRows[0].label} (${fmtInt(channelRows[0].count)})` : "-";

    return {
      payload,
      total,
      newCount,
      treated,
      untreated,
      treatedRate,
      topOrigin,
      channelRows,
      originRows,
      projectRows,
      nationalityRows,
      statusRows,
    };
  };

  const applyFixedWidgetLayout = () => {
    const sectionDefinitions = {
      kpis: FIXED_KPI_WIDGETS,
      charts: FIXED_CHART_WIDGETS,
    };

    Object.keys(sectionDefinitions).forEach((section) => {
      const ordered = state.preferences.layout[section]
        .slice()
        .sort((a, b) => a.order - b.order);
      const rank = new Map(ordered.map((entry, index) => [entry.id, { order: index + 1, visible: entry.visible }]));

      document.querySelectorAll(`[data-dashboard-section="${section}"]`).forEach((node) => {
        const widgetId = toText(node.getAttribute("data-widget-id")) || "";
        const layout = rank.get(widgetId);
        node.hidden = layout ? layout.visible === false : false;
        node.style.order = layout ? String(layout.order) : "0";
      });
    });
  };

  const renderCustomWidgetChartTypeOptions = (preferredChartType = null) => {
    if (!(el.customWidgetDataset instanceof HTMLSelectElement)) return;
    if (!(el.customWidgetChartType instanceof HTMLSelectElement)) return;
    const dataset = toText(el.customWidgetDataset.value) || "source";
    const config = getCustomDatasetConfig(dataset);
    const selectedChartType = getAllowedCustomChartTypes(dataset).includes(toText(preferredChartType))
      ? toText(preferredChartType)
      : config.default_chart_type;

    el.customWidgetChartType.innerHTML = config.chart_types
      .map((chartType) => {
        const selected = chartType === selectedChartType ? " selected" : "";
        return `<option value="${esc(chartType)}"${selected}>${esc(CUSTOM_CHART_TYPE_LABELS[chartType])}</option>`;
      })
      .join("");
    el.customWidgetChartType.value = selectedChartType;

    if (el.customWidgetHelp instanceof HTMLElement) {
      el.customWidgetHelp.textContent = `${config.helper} Tipos disponibles: ${config.chart_types
        .map((chartType) => CUSTOM_CHART_TYPE_LABELS[chartType])
        .join(", ")}.`;
    }
  };

  const renderLayoutList = (node, section, definitions) => {
    if (!(node instanceof HTMLElement)) return;
    const ordered = state.preferences.layout[section].slice().sort((a, b) => a.order - b.order);

    const icons = {
      up: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
      down: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
      eye: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>`,
      eyeOff: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`,
    };

    node.innerHTML = ordered
      .map((entry, index) => {
        const definition = definitions.find((item) => item.id === entry.id);
        const label = definition?.label || entry.id;
        const helper = definition?.helper || "";
        const isHidden = entry.visible === false;
        const visibilityIcon = isHidden ? icons.eyeOff : icons.eye;
        const visibilityTitle = isHidden ? "Mostrar" : "Ocultar";

        return `
          <div class="crm-layout-item">
            <div class="crm-layout-item-top">
              <p class="crm-layout-item-label">${esc(label)}</p>
              <p class="crm-layout-item-meta">${esc(helper)}</p>
              <p class="crm-layout-item-meta">Posicion ${esc(index + 1)}</p>
            </div>
            <div class="crm-layout-item-actions">
              <button type="button" class="crm-button crm-button-soft ${isHidden ? "is-hidden" : ""}" 
                      data-layout-action="toggle" data-layout-section="${esc(section)}" data-widget-id="${esc(entry.id)}" 
                      title="${esc(visibilityTitle)}">${visibilityIcon}</button>
              <button type="button" class="crm-button crm-button-soft" 
                      data-layout-action="up" data-layout-section="${esc(section)}" data-widget-id="${esc(entry.id)}" 
                      title="Subir">${icons.up}</button>
              <button type="button" class="crm-button crm-button-soft" 
                      data-layout-action="down" data-layout-section="${esc(section)}" data-widget-id="${esc(entry.id)}" 
                      title="Bajar">${icons.down}</button>
            </div>
          </div>
        `;
      })
      .join("");
  };

  const renderCustomLayoutList = () => {
    if (!(el.customLayoutList instanceof HTMLElement)) return;
    if (!state.preferences.custom_widgets.length) {
      el.customLayoutList.innerHTML = "<p class='crm-inline-note'>Todavia no hay widgets personalizados.</p>";
      return;
    }

    const icons = {
      up: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
      down: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
      trash: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
    };

    el.customLayoutList.innerHTML = state.preferences.custom_widgets
      .map((widget, index) => {
        const datasetConfig = getCustomDatasetConfig(widget.dataset);
        const chartLabel = CUSTOM_CHART_TYPE_LABELS[widget.chart_type] || widget.chart_type;
        return `
          <div class="crm-layout-item">
            <div class="crm-layout-item-top">
              <p class="crm-layout-item-label">${esc(widget.title)}</p>
              <p class="crm-layout-item-meta">${esc(datasetConfig.label)} | ${esc(chartLabel)}</p>
              <p class="crm-layout-item-meta">Widget ${esc(index + 1)} de ${esc(state.preferences.custom_widgets.length)}</p>
            </div>
            <div class="crm-layout-item-actions">
              <button type="button" class="crm-button crm-button-soft" 
                      data-custom-widget-action="up" data-custom-widget-id="${esc(widget.id)}" 
                      title="Subir">${icons.up}</button>
              <button type="button" class="crm-button crm-button-soft" 
                      data-custom-widget-action="down" data-custom-widget-id="${esc(widget.id)}" 
                      title="Bajar">${icons.down}</button>
              <button type="button" class="crm-button crm-button-soft" 
                      data-custom-widget-action="remove" data-custom-widget-id="${esc(widget.id)}" 
                      title="Eliminar">${icons.trash}</button>
            </div>
          </div>
        `;
      })
      .join("");
  };

  const renderLayoutPanel = () => {
    renderLayoutList(el.kpiLayoutList, "kpis", FIXED_KPI_WIDGETS);
    renderLayoutList(el.chartLayoutList, "charts", FIXED_CHART_WIDGETS);
    renderCustomLayoutList();
    renderCustomWidgetChartTypeOptions(toText(el.customWidgetChartType?.value));
  };

  const disposeCustomCharts = () => {
    customChartRegistry.forEach((chart) => {
      chart?.dispose?.();
    });
    customChartRegistry.clear();
  };

  const ensureCustomChart = (widgetId, node) => {
    if (!node || !hasECharts()) return null;
    let chart = customChartRegistry.get(widgetId);
    if (chart && chart.getDom() !== node) {
      chart.dispose();
      chart = null;
    }
    if (!chart) {
      node.innerHTML = "";
      chart = window.echarts.init(node);
      customChartRegistry.set(widgetId, chart);
    }
    return chart;
  };

  const setCustomChartEmpty = (widgetId, node, message) => {
    const chart = customChartRegistry.get(widgetId);
    if (chart) {
      chart.dispose();
      customChartRegistry.delete(widgetId);
    }
    if (node instanceof HTMLElement) {
      node.innerHTML = `<p class="crm-inline-note">${esc(message)}</p>`;
    }
  };

  const renderCustomDonut = (widgetId, node, rows) => {
    if (!hasECharts()) {
      setCustomChartEmpty(widgetId, node, "No se pudo cargar la libreria de graficos.");
      return;
    }
    if (!rows.length) {
      setCustomChartEmpty(widgetId, node, "Sin datos para este widget.");
      return;
    }
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const chart = ensureCustomChart(widgetId, node);
    if (!chart) return;
    chart.setOption({
      animationDuration: 400,
      tooltip: {
        trigger: "item",
        formatter: (params) =>
          `${params.marker} ${params.name}<br/>${fmtInt(params.value)} leads (${fmtPct(params.percent)})`,
      },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 2,
            borderRadius: 8,
          },
          label: {
            formatter: "{b}\n{d}%",
            color: "#26415b",
            fontSize: 11,
          },
          color: BAR_COLORS,
          data: rows.map((item) => ({ name: item.label, value: item.count })),
        },
      ],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "43%",
          style: {
            text: fmtInt(total),
            fontSize: 24,
            fontWeight: 800,
            fill: "#12324d",
          },
        },
      ],
    });
  };

  const renderCustomBar = (widgetId, node, rows) => {
    if (!hasECharts()) {
      setCustomChartEmpty(widgetId, node, "No se pudo cargar la libreria de graficos.");
      return;
    }
    if (!rows.length) {
      setCustomChartEmpty(widgetId, node, "Sin datos para este widget.");
      return;
    }
    const chart = ensureCustomChart(widgetId, node);
    if (!chart) return;
    chart.setOption({
      animationDuration: 400,
      grid: {
        left: 130,
        right: 24,
        top: 18,
        bottom: 22,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      xAxis: {
        type: "value",
        axisLabel: { color: "#5a6f86" },
        splitLine: {
          lineStyle: { color: "rgba(15, 31, 51, 0.1)" },
        },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((row) => shortLabel(row.label, 22)),
        axisLabel: {
          color: "#2a3b50",
          fontWeight: 600,
        },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          barWidth: 16,
          data: rows.map((row, index) => ({
            value: row.count,
            itemStyle: {
              color: BAR_COLORS[index % BAR_COLORS.length],
              borderRadius: [0, 10, 10, 0],
            },
          })),
          label: {
            show: true,
            position: "right",
            color: "#1d3550",
            fontWeight: 700,
            formatter: (params) => fmtInt(params.value),
          },
        },
      ],
    });
  };

  const renderCustomTreemap = (widgetId, node, rows) => {
    if (!hasECharts()) {
      setCustomChartEmpty(widgetId, node, "No se pudo cargar la libreria de graficos.");
      return;
    }
    if (!rows.length) {
      setCustomChartEmpty(widgetId, node, "Sin datos para este widget.");
      return;
    }
    const chart = ensureCustomChart(widgetId, node);
    if (!chart) return;
    chart.setOption({
      animationDuration: 400,
      tooltip: {
        formatter: (info) => `${info.marker} ${info.name}: ${fmtInt(info.value)} leads`,
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          color: BAR_COLORS,
          label: {
            formatter: (params) => `${shortLabel(params.name, 20)}\n${fmtInt(params.value)}`,
            color: "#0f2135",
            fontWeight: 700,
            lineHeight: 16,
          },
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 2,
            gapWidth: 2,
            borderRadius: 10,
          },
          data: rows.map((row) => ({
            name: row.label,
            value: row.count,
          })),
        },
      ],
    });
  };

  const renderCustomFunnel = (widgetId, node, rows) => {
    if (!hasECharts()) {
      setCustomChartEmpty(widgetId, node, "No se pudo cargar la libreria de graficos.");
      return;
    }
    if (!rows.length) {
      setCustomChartEmpty(widgetId, node, "Sin datos para este widget.");
      return;
    }
    const chart = ensureCustomChart(widgetId, node);
    if (!chart) return;
    chart.setOption({
      animationDuration: 400,
      tooltip: {
        trigger: "item",
        formatter: (params) => `${params.marker} ${params.name}: ${fmtInt(params.value)} leads`,
      },
      series: [
        {
          type: "funnel",
          left: "8%",
          top: 14,
          bottom: 16,
          width: "84%",
          minSize: "22%",
          maxSize: "100%",
          sort: "descending",
          gap: 4,
          color: BAR_COLORS,
          label: {
            show: true,
            position: "inside",
            color: "#fff",
            fontWeight: 700,
            formatter: (params) => `${shortLabel(params.name, 18)}: ${fmtInt(params.value)}`,
          },
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 2,
          },
          data: rows.map((row) => ({
            name: row.label,
            value: row.count,
          })),
        },
      ],
    });
  };

  const renderCustomRadar = (widgetId, node, rows) => {
    if (!hasECharts()) {
      setCustomChartEmpty(widgetId, node, "No se pudo cargar la libreria de graficos.");
      return;
    }
    const topRows = rows.slice(0, 6);
    if (!topRows.length) {
      setCustomChartEmpty(widgetId, node, "Sin datos para este widget.");
      return;
    }
    const maxValue = Math.max(...topRows.map((row) => row.count), 1);
    const chart = ensureCustomChart(widgetId, node);
    if (!chart) return;
    chart.setOption({
      animationDuration: 400,
      tooltip: {},
      radar: {
        radius: "66%",
        indicator: topRows.map((row) => ({
          name: shortLabel(row.label, 16),
          max: maxValue,
        })),
        axisName: {
          color: "#2a3b50",
          fontWeight: 700,
        },
        splitLine: {
          lineStyle: { color: "rgba(15, 31, 51, 0.12)" },
        },
        splitArea: {
          areaStyle: {
            color: ["rgba(242, 247, 255, 0.38)", "rgba(233, 241, 252, 0.2)"],
          },
        },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: topRows.map((row) => row.count),
              lineStyle: { color: "#1d4ed8", width: 2 },
              itemStyle: { color: "#1d4ed8" },
              areaStyle: { color: "rgba(29, 78, 216, 0.28)" },
              symbolSize: 6,
            },
          ],
        },
      ],
    });
  };

  const getCustomWidgetRows = (widget, viewModel) => {
    if (!widget || !viewModel) return [];
    if (widget.dataset === "source") return viewModel.channelRows.slice(0, CHART_ITEM_LIMIT);
    if (widget.dataset === "origin_type") return viewModel.originRows.slice(0, CHART_ITEM_LIMIT);
    if (widget.dataset === "status") return viewModel.statusRows.slice(0, CHART_ITEM_LIMIT);
    if (widget.dataset === "project") return viewModel.projectRows.slice(0, CHART_ITEM_LIMIT);
    if (widget.dataset === "nationality") return viewModel.nationalityRows.slice(0, CHART_ITEM_LIMIT);
    return [];
  };

  const renderCustomWidgetChart = (widget, node, rows) => {
    if (widget.chart_type === "donut") return renderCustomDonut(widget.id, node, rows);
    if (widget.chart_type === "treemap") return renderCustomTreemap(widget.id, node, rows);
    if (widget.chart_type === "funnel") return renderCustomFunnel(widget.id, node, rows);
    if (widget.chart_type === "radar") return renderCustomRadar(widget.id, node, rows);
    return renderCustomBar(widget.id, node, rows);
  };

  const renderCustomWidgets = () => {
    if (!(el.customGrid instanceof HTMLElement)) return;
    disposeCustomCharts();

    const widgets = state.preferences.custom_widgets;
    const viewModel = state.dashboardViewModel;
    if (!widgets.length || !viewModel) {
      el.customGrid.hidden = true;
      el.customGrid.innerHTML = "";
      return;
    }

    el.customGrid.hidden = false;
    el.customGrid.innerHTML = widgets
      .map((widget) => {
        const datasetConfig = getCustomDatasetConfig(widget.dataset);
        const isWide = ["treemap", "funnel", "radar"].includes(widget.chart_type);
        return `
          <article class="crm-card ${isWide ? "crm-full" : "crm-half"}">
            <div class="crm-custom-widget-grid">
              <div>
                <h3 class="crm-custom-widget-title">${esc(widget.title)}</h3>
                <p class="crm-custom-widget-subtitle">${esc(datasetConfig.label)} | ${esc(
                  CUSTOM_CHART_TYPE_LABELS[widget.chart_type] || widget.chart_type
                )}</p>
              </div>
              <div class="crm-chart-surface ${isWide ? "crm-chart-surface-wide" : ""}" data-custom-widget-surface="${esc(widget.id)}">
                <p class="crm-inline-note">Preparando widget...</p>
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    widgets.forEach((widget) => {
      const node = el.customGrid.querySelector(`[data-custom-widget-surface="${widget.id}"]`);
      const rows = getCustomWidgetRows(widget, viewModel);
      renderCustomWidgetChart(widget, node, rows);
    });
  };

  const persistFilters = () => {
    writeScopedStorage(projectStorageKey, state.selectedProjectId, projectStorageKey);
    writeScopedStorage(originTypeStorageKey, state.selectedOriginType, originTypeStorageKey);
    writeScopedStorage(sourceStorageKey, state.selectedSource, sourceStorageKey);
    writeScopedStorage(nationalityStorageKey, state.selectedNationality, nationalityStorageKey);
  };

  const renderFilterControls = () => {
    if (el.projectSelect instanceof HTMLSelectElement) {
      const options = [
        "<option value=''>Todas las promociones</option>",
        ...state.projectOptions.map((entry) => {
          const value = toText(entry.project_id) || "";
          const selected = value === state.selectedProjectId ? " selected" : "";
          return `<option value="${esc(value)}"${selected}>${esc(projectLabel(entry))}</option>`;
        }),
      ];
      el.projectSelect.innerHTML = options.join("");
      el.projectSelect.value = state.selectedProjectId || "";
    }

    if (el.originSelect instanceof HTMLSelectElement) {
      const options = [
        "<option value=''>Todos los origenes</option>",
        ...state.originOptions.map((entry) => {
          const value = toText(entry.origin_type) || "";
          const selected = value === state.selectedOriginType ? " selected" : "";
          return `<option value="${esc(value)}"${selected}>${esc(labelOrigin(value))}</option>`;
        }),
      ];
      el.originSelect.innerHTML = options.join("");
      el.originSelect.value = state.selectedOriginType || "";
    }

    if (el.sourceSelect instanceof HTMLSelectElement) {
      const options = [
        "<option value=''>Todos los canales</option>",
        ...state.sourceOptions.map((entry) => {
          const value = toText(entry.source) || "";
          const selected = value === state.selectedSource ? " selected" : "";
          return `<option value="${esc(value)}"${selected}>${esc(labelSource(value))}</option>`;
        }),
      ];
      el.sourceSelect.innerHTML = options.join("");
      el.sourceSelect.value = state.selectedSource || "";
    }

    if (el.nationalitySelect instanceof HTMLSelectElement) {
      const options = [
        "<option value=''>Todas las nacionalidades</option>",
        ...state.nationalityOptions.map((entry) => {
          const value = toText(entry.nationality) || "";
          const selected = value === state.selectedNationality ? " selected" : "";
          return `<option value="${esc(value)}"${selected}>${esc(value)}</option>`;
        }),
      ];
      el.nationalitySelect.innerHTML = options.join("");
      el.nationalitySelect.value = state.selectedNationality || "";
    }
  };

  const renderContext = (payload) => {
    if (!(el.context instanceof HTMLElement)) return;
    const total = toNumber(payload?.meta?.total) || 0;
    const selectedProject =
      state.projectOptions.find((entry) => toText(entry.project_id) === state.selectedProjectId) || null;
    const projectText = selectedProject ? projectLabel(selectedProject) : "Todas las promociones";
    const originText = state.selectedOriginType ? labelOrigin(state.selectedOriginType) : "Todos los origenes";
    const sourceText = state.selectedSource ? labelSource(state.selectedSource) : "Todos los canales";
    const nationalityText = state.selectedNationality || "Todas las nacionalidades";
    const portalHint =
      state.selectedOriginType === "portal" ? " | Detalle portal: Idealista / Fotocasa / Otros portales" : "";
    el.context.textContent = `Ambito: ${projectText} | Origen: ${originText} | Canal: ${sourceText} | Nacionalidad: ${nationalityText} | Leads visibles: ${fmtInt(total)}${portalHint}`;
  };

  const syncFilterOptions = (payload) => {
    const options = payload?.meta?.options || {};
    const projects = Array.isArray(options.projects) ? options.projects : [];
    const origins = Array.isArray(options.origin_types) ? options.origin_types : [];
    const sources = Array.isArray(options.sources) ? options.sources : [];
    const nationalities = Array.isArray(options.nationalities) ? options.nationalities : [];

    if (!state.projectOptions.length && projects.length) {
      state.projectOptions = projects
        .filter((entry) => toText(entry?.project_id))
        .map((entry) => ({
          project_id: toText(entry.project_id) || "",
          project_code: toText(entry.project_code),
          project_label: toText(entry.project_label),
        }));
    }

    state.originOptions = origins
      .map((originType) => ({ origin_type: toText(originType) || "" }))
      .filter((entry) => entry.origin_type);

    state.sourceOptions = sources
      .filter((entry) => toText(entry?.source))
      .map((entry) => ({
        source: toText(entry.source) || "",
      }));

    state.nationalityOptions = nationalities
      .filter((entry) => toText(entry?.nationality))
      .map((entry) => ({
        nationality: toText(entry.nationality) || "",
      }));

    const projectExists = state.selectedProjectId
      ? state.projectOptions.some((entry) => entry.project_id === state.selectedProjectId)
      : true;
    if (!projectExists) state.selectedProjectId = "";

    const originExists = state.selectedOriginType
      ? state.originOptions.some((entry) => entry.origin_type === state.selectedOriginType)
      : true;
    if (!originExists) state.selectedOriginType = "";

    const sourceExists = state.selectedSource
      ? state.sourceOptions.some((entry) => entry.source === state.selectedSource)
      : true;
    if (!sourceExists) state.selectedSource = "";

    const nationalityExists = state.selectedNationality
      ? state.nationalityOptions.some((entry) => entry.nationality === state.selectedNationality)
      : true;
    if (!nationalityExists) state.selectedNationality = "";

    renderFilterControls();
    persistFilters();
  };

  const renderDashboard = (payload) => {
    state.dashboardPayload = payload;
    state.dashboardViewModel = buildDashboardViewModel(payload);
    const viewModel = state.dashboardViewModel;

    if (el.kpiTotal) el.kpiTotal.textContent = fmtInt(viewModel.total);
    if (el.kpiNew) el.kpiNew.textContent = fmtInt(viewModel.newCount);
    if (el.kpiTreated) el.kpiTreated.textContent = fmtInt(viewModel.treated);
    if (el.kpiUntreated) el.kpiUntreated.textContent = fmtInt(viewModel.untreated);
    if (el.kpiTreatedRate) el.kpiTreatedRate.textContent = fmtPct(viewModel.treatedRate);
    if (el.kpiTopOrigin) el.kpiTopOrigin.textContent = viewModel.topOrigin;

    renderOrigin(viewModel.channelRows);
    renderTreatedBars(viewModel.treated, viewModel.untreated);
    renderThreeChart(el.chartProjects3d, viewModel.projectRows, "Sin promociones con leads.");
    renderSourcesTreemap(viewModel.originRows);
    renderStatusFunnel(viewModel.statusRows);
    renderNationalitiesRadar(viewModel.nationalityRows);
    applyFixedWidgetLayout();
    renderLayoutPanel();
    renderCustomWidgets();
    renderContext(payload);
    resizeCharts();
  };

  const rerenderPresentation = () => {
    applyFixedWidgetLayout();
    renderLayoutPanel();
    renderCustomWidgets();
    resizeCharts();
  };

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      resizeCharts();
    });
  });

  const loadProjectOptions = async () => {
    if (!state.organizationId) return;
    try {
      const params = new URLSearchParams();
      params.set("organization_id", state.organizationId);
      params.set("record_type", "project");
      params.set("page", "1");
      params.set("per_page", "500");
      const payload = await request(`${propertiesApiBase}?${params.toString()}`);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const projectMap = new Map();
      rows.forEach((entry) => {
        const projectId = toText(entry?.id);
        if (!projectId) return;
        projectMap.set(projectId, {
          project_id: projectId,
          project_code: toText(entry?.legacy_code),
          project_label: toText(entry?.project_name) || toText(entry?.display_name),
        });
      });
      if (projectMap.size > 0) {
        state.projectOptions = Array.from(projectMap.values()).sort((a, b) =>
          projectLabel(a).localeCompare(projectLabel(b), "es", { sensitivity: "base" })
        );
      }
    } catch {
      // keep fallback from leads meta.options.projects
    }
  };

  const loadDashboard = async () => {
    try {
      const params = new URLSearchParams();
      if (state.organizationId) params.set("organization_id", state.organizationId);
      if (state.selectedProjectId) params.set("project_id", state.selectedProjectId);
      if (state.selectedOriginType) params.set("origin_type", state.selectedOriginType);
      if (state.selectedSource) params.set("source", state.selectedSource);
      if (state.selectedNationality) params.set("nationality", state.selectedNationality);
      params.set("page", "1");
      params.set("per_page", "1");
      const payload = await request(`${apiBase}?${params.toString()}`);
      await loadProjectOptions();
      syncFilterOptions(payload);
      renderDashboard(payload);
      setFeedback("Dashboard actualizado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando dashboard: ${error.message}`, "error");
    }
  };

  const hydrateFilterState = (search) => {
    const queryProjectId = toText(search.get("project_id"));
    const queryOriginType = toText(search.get("origin_type"));
    const querySource = toText(search.get("source"));
    const queryNationality = toText(search.get("nationality"));
    const localProjectId = readScopedStorage(projectStorageKey, projectStorageKey);
    const localOriginType = readScopedStorage(originTypeStorageKey, originTypeStorageKey);
    const localSource = readScopedStorage(sourceStorageKey, sourceStorageKey);
    const localNationality = readScopedStorage(nationalityStorageKey, nationalityStorageKey);

    state.selectedProjectId = queryProjectId || localProjectId || "";
    state.selectedOriginType = queryOriginType || localOriginType || "";
    state.selectedSource = querySource || localSource || "";
    state.selectedNationality = queryNationality || localNationality || "";
  };

  bindKpiHelpTitles();

  el.filterForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.selectedProjectId = toText(el.projectSelect?.value) || "";
    state.selectedOriginType = toText(el.originSelect?.value) || "";
    state.selectedSource = toText(el.sourceSelect?.value) || "";
    state.selectedNationality = toText(el.nationalitySelect?.value) || "";
    persistFilters();
    void loadDashboard();
  });

  el.customizeToggleButton?.addEventListener("click", () => {
    setLayoutPanelOpen(!state.layoutPanelOpen);
  });

  el.layoutPanelCloseButton?.addEventListener("click", () => {
    setLayoutPanelOpen(false);
  });

  el.customizeResetButton?.addEventListener("click", () => {
    resetPreferences();
    rerenderPresentation();
    setFeedback("Vista personalizada restaurada.", "ok");
  });

  const handleLayoutAction = (event) => {
    const trigger = event.target instanceof HTMLElement ? event.target.closest("button[data-layout-action]") : null;
    if (!trigger) return;
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
    }

    rerenderPresentation();
  };

  el.kpiLayoutList?.addEventListener("click", handleLayoutAction);
  el.chartLayoutList?.addEventListener("click", handleLayoutAction);

  el.customLayoutList?.addEventListener("click", (event) => {
    const trigger =
      event.target instanceof HTMLElement ? event.target.closest("button[data-custom-widget-action]") : null;
    if (!trigger) return;
    const widgetId = toText(trigger.getAttribute("data-custom-widget-id"));
    const action = toText(trigger.getAttribute("data-custom-widget-action"));
    if (!widgetId || !action) return;

    if (action === "remove") removeCustomWidget(widgetId);
    if (action === "up" || action === "down") moveCustomWidget(widgetId, action);

    rerenderPresentation();
  });

  el.customWidgetDataset?.addEventListener("change", () => {
    renderCustomWidgetChartTypeOptions();
  });

  el.customWidgetForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      addCustomWidget({
        title: toText(el.customWidgetTitle?.value),
        dataset: toText(el.customWidgetDataset?.value),
        chart_type: toText(el.customWidgetChartType?.value),
      });
      if (el.customWidgetTitle instanceof HTMLInputElement) {
        el.customWidgetTitle.value = "";
      }
      renderCustomWidgetChartTypeOptions();
      rerenderPresentation();
      setFeedback("Widget personalizado creado.", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("maximo_")) {
        setFeedback(`Has alcanzado el limite de ${CUSTOM_WIDGET_LIMIT} widgets personalizados.`, "error");
        return;
      }
      setFeedback(`No se pudo crear el widget: ${message}`, "error");
    }
  });

  el.resetButton?.addEventListener("click", () => {
    state.selectedProjectId = "";
    state.selectedOriginType = "";
    state.selectedSource = "";
    state.selectedNationality = "";
    renderFilterControls();
    persistFilters();
    void loadDashboard();
  });

  const boot = async () => {
    const search = new URLSearchParams(window.location.search);
    const queryOrganizationId = toText(search.get("organization_id"));
    const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
    const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
    state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
    if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

    setLayoutPanelOpen(false);
    await loadViewerContext();
    loadPreferences();
    hydrateFilterState(search);
    renderFilterControls();
    renderLayoutPanel();
    await loadDashboard();
  };

  void boot();
})();
