(() => {
  const apiBase = "/api/v1/crm/dashboard/home";
  const loginPath = "/crm/login/";
  const scopeStorageKey = "crm.home.dashboard.scope.v1";
  const windowStorageKey = "crm.home.dashboard.window.v1";
  const orgStorageKey = "crm.organization_id";
  const defaultVisibleLimit = 8;
  const fetchLimit = 20;
  const chartRegistry = new Map();
  const CHART_COLORS = ["#1d4a74", "#f97316", "#0f8a56", "#dc2626", "#2563eb", "#8b5cf6", "#d97706", "#0f766e"];

  const state = {
    organizationId: "",
    scope: "mine",
    window: "7d",
    expanded: { mine: false, team: false },
    data: null,
    status: "idle",
    errorMessage: "",
    errorCode: "",
  };

  const el = {
    context: document.getElementById("crm-home-context"),
    filtersForm: document.getElementById("crm-home-filters"),
    scopeSelect: document.getElementById("crm-home-scope"),
    windowSelect: document.getElementById("crm-home-window"),
    refreshButton: document.getElementById("crm-home-refresh"),
    quickLinks: document.getElementById("crm-home-quick-links"),
    alerts: document.getElementById("crm-home-alerts"),
    summary: document.getElementById("crm-home-summary"),
    inboxMine: document.getElementById("crm-home-inbox-mine"),
    inboxTeam: document.getElementById("crm-home-inbox-team"),
    mineToggle: document.getElementById("crm-home-mine-toggle"),
    teamToggle: document.getElementById("crm-home-team-toggle"),
    executiveChart: document.getElementById("crm-home-executive-chart"),
    reservationsChart: document.getElementById("crm-home-reservations-chart"),
    pipeline: document.getElementById("crm-home-pipeline"),
    reservations: document.getElementById("crm-home-reservations"),
    portal: document.getElementById("crm-home-portal"),
    notifications: document.getElementById("crm-home-notifications"),
    feedback: document.getElementById("crm-home-feedback"),
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

  const fmtInt = (value) => {
    const parsed = toNumber(value);
    return parsed == null ? "-" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(parsed);
  };

  const fmtCurrency = (value) => {
    const parsed = toNumber(value);
    return parsed == null
      ? "-"
      : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parsed);
  };

  const hasThree = () => typeof window.THREE === "object";

  const disposeMaterial = (material) => {
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
      return;
    }
    if (typeof material.dispose === "function") material.dispose();
  };

  const disposeObjectTree = (root) => {
    if (!root || typeof root.traverse !== "function") return;
    root.traverse((node) => {
      if (node.geometry && typeof node.geometry.dispose === "function") node.geometry.dispose();
      if (node.material) disposeMaterial(node.material);
    });
  };

  const destroyChart = (node) => {
    const current = chartRegistry.get(node);
    if (!current) return;
    current.destroy();
    chartRegistry.delete(node);
  };

  const readStorage = (key, fallback) => {
    try {
      return toText(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const writeStorage = (key, value) => {
    try {
      if (toText(value)) localStorage.setItem(key, String(value));
      else localStorage.removeItem(key);
    } catch {
      // no-op
    }
  };

  const setFeedback = (message) => {
    if (el.feedback) el.feedback.textContent = message;
  };

  const setOrgId = () => {
    state.organizationId = readStorage(orgStorageKey, toText(window.__crmDefaultOrganizationId) ?? "");
  };

  const redirectToLogin = () => {
    const loginUrl = new URL(loginPath, window.location.origin);
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

  const isOrgHintError = (code) =>
    code === "crm_membership_required" || code === "crm_permission_forbidden" || code === "crm_role_forbidden";

  const buildError = (code, message) => {
    const error = new Error(message || code || "dashboard_load_failed");
    error.code = code || "dashboard_load_failed";
    return error;
  };

  const request = async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (isCrmAuthError(response, payload)) {
      redirectToLogin();
      throw buildError(toText(payload?.error) || "crm_auth_required", "Sesion CRM requerida.");
    }

    if (!response.ok || !payload?.ok) {
      const code = toText(payload?.error) || `http_${response.status}`;
      const details = toText(payload?.details) || toText(payload?.message) || (raw ? raw.slice(0, 250) : null);
      throw buildError(code, details || code);
    }

    return payload;
  };

  const buildQuery = (organizationId) => {
    const params = new URLSearchParams();
    if (organizationId) params.set("organization_id", organizationId);
    params.set("scope", state.scope);
    params.set("window", state.window);
    params.set("inbox_limit", String(fetchLimit));
    return params;
  };

  const setResolvedOrganization = (payload) => {
    const resolvedOrgId = toText(payload?.data?.viewer?.organization_id);
    if (!resolvedOrgId) return;
    if (resolvedOrgId !== state.organizationId) {
      state.organizationId = resolvedOrgId;
      writeStorage(orgStorageKey, resolvedOrgId);
    }
  };

  const renderDefaultQuickLinks = () => {
    if (!el.quickLinks) return;
    el.quickLinks.innerHTML = `
      <a class="crm-button crm-button-soft" href="/crm/leads/">Leads</a>
      <a class="crm-button crm-button-soft" href="/crm/clients/">Clientes</a>
      <a class="crm-button crm-button-soft" href="/crm/deals/">Deals</a>
    `;
  };

  const renderQuickLinks = () => {
    if (!el.quickLinks) return;
    const links = Array.isArray(state.data?.quick_links) ? state.data.quick_links : [];
    if (!links.length) {
      renderDefaultQuickLinks();
      return;
    }
    el.quickLinks.innerHTML = links
      .map((item) => `<a class="crm-button crm-button-soft" href="${esc(item.href)}">${esc(item.label)}</a>`)
      .join("");
  };

  const renderAlerts = () => {
    if (!el.alerts) return;
    if (state.status === "loading") {
      el.alerts.innerHTML = "";
      return;
    }
    if (state.status === "error") {
      el.alerts.innerHTML = `
        <article class="crm-home-alert danger crm-full">
          <p class="crm-context-eyebrow">Error</p>
          <h3>No se pudo cargar el dashboard</h3>
          <p>${esc(state.errorMessage || "Error desconocido.")}</p>
        </article>
      `;
      return;
    }
    const alerts = Array.isArray(state.data?.alerts) ? state.data.alerts : [];
    if (!alerts.length) {
      el.alerts.innerHTML = "";
      return;
    }
    el.alerts.innerHTML = alerts
      .map(
        (item) => `
          <article class="crm-home-alert ${esc(item.tone)}">
            <p class="crm-context-eyebrow">Alerta</p>
            <h3>${esc(item.title)}</h3>
            <p>${esc(item.message)}</p>
            ${item.href ? `<a class="crm-link" href="${esc(item.href)}">Abrir</a>` : ""}
          </article>
        `
      )
      .join("");
  };

  const summaryCardClassName = (item) => {
    const classes = ["crm-card", "crm-kpi"];
    if (item.id === "reservations_active" || item.id === "deals_active" || item.id === "leads_open") {
      classes.push("crm-kpi-primary");
    }
    if (item.id === "deals_risk" || item.id === "docs_pending" || item.id === "portal_requested") {
      classes.push("crm-kpi-alert");
    }
    if (item.id === "notifications_overdue") {
      classes.push("crm-kpi-danger");
    }
    if (item.tone === "danger" || item.tone === "warn") {
      classes.push("crm-kpi-highlight");
    }
    return classes.join(" ");
  };

  const buildDerivedSummaryCards = () => {
    if (!state.data) return [];
    const reservations = state.data.reservations;
    const portal = state.data.portal;
    const notifications = state.data.notifications;

    return [
      {
        id: "docs_pending",
        label: "Docs pendientes",
        value: reservations?.enabled ? toNumber(reservations.docs_pending_total) : null,
        sublabel: "Reservas activas con documentacion incompleta",
        href: "/crm/clients/dashboard/",
        tone: "warn",
        enabled: Boolean(reservations?.enabled),
      },
      {
        id: "portal_requested",
        label: "Visitas por responder",
        value: portal?.enabled ? toNumber(portal.visit_requests?.requested) : null,
        sublabel: "Solicitudes del portal pendientes de reaccion",
        href: "/crm/portal/operations/",
        tone: "warn",
        enabled: Boolean(portal?.enabled),
      },
      {
        id: "notifications_overdue",
        label: "Avisos vencidos",
        value: notifications?.enabled ? toNumber(notifications.overdue_count) : null,
        sublabel: "Alertas manuales ya fuera de plazo",
        href: "/crm/notifications/",
        tone: "danger",
        enabled: Boolean(notifications?.enabled),
      },
    ].filter((item) => item.enabled);
  };

  const renderSummary = () => {
    if (!el.summary) return;
    if (state.status === "loading") {
      el.summary.innerHTML = Array.from({ length: 6 })
        .map(
          () => `
            <article class="crm-card crm-kpi">
              <p>Cargando...</p>
              <strong>-</strong>
              <small class="crm-kpi-hint">Preparando datos</small>
            </article>
          `
        )
        .join("");
      return;
    }
    if (state.status === "error") {
      el.summary.innerHTML = `
        <article class="crm-card crm-full">
          <h3>Dashboard no disponible</h3>
          <p class="crm-inline-note">${esc(state.errorMessage || "No se pudo cargar el cockpit.")}</p>
        </article>
      `;
      return;
    }
    const cards = [...(Array.isArray(state.data?.summary) ? state.data.summary : []), ...buildDerivedSummaryCards()];
    el.summary.innerHTML = cards
      .filter((item) => item?.enabled)
      .map(
        (item) => `
          <article class="${summaryCardClassName(item)}">
            <p>${esc(item.label)}</p>
            <strong>${esc(fmtInt(item.value))}</strong>
            <small class="crm-kpi-hint">${esc(item.sublabel || "")}</small>
            ${item.href ? `<a class="crm-link" href="${esc(item.href)}">Abrir modulo</a>` : ""}
          </article>
        `
      )
      .join("");
  };

  const renderInbox = (bucket) => {
    const container = bucket === "mine" ? el.inboxMine : el.inboxTeam;
    const toggle = bucket === "mine" ? el.mineToggle : el.teamToggle;
    if (!container || !toggle) return;

    if (state.status === "loading") {
      container.innerHTML = `<div class="crm-home-empty"><p class="crm-inline-note">Cargando pendientes...</p></div>`;
      toggle.hidden = true;
      return;
    }

    if (state.status === "error") {
      container.innerHTML = `<div class="crm-home-empty"><p class="crm-inline-note">${esc(state.errorMessage || "No se pudo cargar la bandeja.")}</p></div>`;
      toggle.hidden = true;
      return;
    }

    const rows = Array.isArray(state.data?.inbox?.[bucket]) ? state.data.inbox[bucket] : [];
    const total = toNumber(state.data?.inbox?.[`total_${bucket}`]) ?? rows.length;
    const visible = state.expanded[bucket] ? rows : rows.slice(0, defaultVisibleLimit);

    if (!visible.length) {
      container.innerHTML = `<div class="crm-home-empty"><p class="crm-inline-note">Sin pendientes ${bucket === "mine" ? "personales" : "de equipo"}.</p></div>`;
    } else {
      container.innerHTML = visible
        .map(
          (item) => `
            <article class="crm-home-inbox-item">
              <div class="crm-home-inbox-item-head">
                <h4>${esc(item.title)}</h4>
                <span class="crm-home-badge ${esc(item.priority)}">${esc(item.priority)}</span>
              </div>
              <p>${esc(item.reason)}</p>
              <div class="crm-home-inbox-item-meta">
                <span class="crm-home-badge normal">${esc(item.age_label || "-")}</span>
                ${(Array.isArray(item.meta) ? item.meta : [])
                  .filter(Boolean)
                  .map((entry) => `<span class="crm-home-badge normal">${esc(entry)}</span>`)
                  .join("")}
              </div>
              <div class="crm-actions-row">
                <a class="crm-button crm-button-soft" href="${esc(item.href)}">${esc(item.cta_label || "Abrir")}</a>
              </div>
            </article>
          `
        )
        .join("");
    }

    if (total > defaultVisibleLimit) {
      toggle.hidden = false;
      toggle.textContent = state.expanded[bucket] ? "Ver menos" : `Ver mas (${total})`;
    } else {
      toggle.hidden = true;
    }
  };

  const renderFallbackChartList = (node, rows, valueFormatter) => {
    node.innerHTML = `
      <div class="crm-home-chart-block">
        <div class="crm-home-empty">
          <p class="crm-inline-note">Visualizacion local del CRM. Mostrando resumen textual fiable.</p>
        </div>
        <ol class="crm-chart-legend" aria-label="Detalle de valores">
          ${rows
            .map(
              (entry, index) => `
                <li class="crm-chart-legend-row">
                  <span class="crm-chart-legend-dot" style="background:${esc(CHART_COLORS[index % CHART_COLORS.length])}"></span>
                  <span class="crm-chart-legend-label">${esc(entry.label)}</span>
                  <span class="crm-chart-legend-value">${esc(valueFormatter(entry.value))}</span>
                </li>
              `
            )
            .join("")}
        </ol>
      </div>
    `;
  };

  const renderThreeBarsChart = (node, rows, options = {}) => {
    if (!(node instanceof HTMLElement)) return;
    destroyChart(node);

    const normalizedRows = rows
      .map((row) => ({
        label: toText(row.label) || "-",
        value: Math.max(0, toNumber(row.value) || 0),
        hint: toText(row.hint) || "",
      }))
      .filter((row) => row.value > 0);

    if (!normalizedRows.length) {
      node.innerHTML = `<div class="crm-home-empty"><p class="crm-inline-note">${esc(options.emptyText || "Sin datos para representar.")}</p></div>`;
      return;
    }

    const valueFormatter = typeof options.valueFormatter === "function" ? options.valueFormatter : fmtInt;
    const total = normalizedRows.reduce((sum, row) => sum + row.value, 0);

    if (!hasThree()) {
      renderFallbackChartList(node, normalizedRows, valueFormatter);
      return;
    }

    node.innerHTML = `
      <div class="crm-chart-3d-shell">
        <div class="crm-chart-3d-canvas" aria-hidden="true"></div>
        <div class="crm-home-chart-caption">
          ${normalizedRows
            .slice(0, 3)
            .map((entry) => `<span class="crm-home-badge normal">${esc(entry.label)} ${esc(valueFormatter(entry.value))}</span>`)
            .join("")}
        </div>
        <ol class="crm-chart-legend" aria-label="Detalle de valores">
          ${normalizedRows
            .map((entry, index) => {
              const percent = total > 0 ? Math.round((entry.value / total) * 100) : 0;
              return `
                <li class="crm-chart-legend-row">
                  <span class="crm-chart-legend-dot" style="background:${esc(CHART_COLORS[index % CHART_COLORS.length])}"></span>
                  <span class="crm-chart-legend-label">${esc(entry.label)}</span>
                  <span class="crm-chart-legend-value">${esc(valueFormatter(entry.value))}${percent ? ` · ${esc(String(percent))}%` : ""}</span>
                </li>
              `;
            })
            .join("")}
        </ol>
      </div>
    `;

    const canvasHost = node.querySelector(".crm-chart-3d-canvas");
    if (!(canvasHost instanceof HTMLElement)) {
      renderFallbackChartList(node, normalizedRows, valueFormatter);
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

      camera.position.set(0, 5.6, 8.9);
      camera.lookAt(0, 1.6, 0);

      const ambient = new THREE.AmbientLight(0xffffff, 0.78);
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.06);
      keyLight.position.set(4, 8, 4);
      const fillLight = new THREE.DirectionalLight(0xa8c3df, 0.44);
      fillLight.position.set(-6, 4, -3);
      scene.add(ambient, keyLight, fillLight);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(28, 12),
        new THREE.MeshStandardMaterial({ color: 0xe8f0f9, roughness: 0.94, metalness: 0.02 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      scene.add(floor);

      const group = new THREE.Group();
      const maxValue = Math.max(...normalizedRows.map((entry) => entry.value), 1);
      const spacing = normalizedRows.length > 6 ? 1.16 : 1.38;
      const startX = -((normalizedRows.length - 1) * spacing) / 2;

      normalizedRows.forEach((entry, index) => {
        const ratio = entry.value / maxValue;
        const height = 0.4 + ratio * 4.9;
        const geometry = new THREE.BoxGeometry(0.88, height, 0.88);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(CHART_COLORS[index % CHART_COLORS.length]),
          roughness: 0.34,
          metalness: 0.18,
        });
        const bar = new THREE.Mesh(geometry, material);
        bar.position.set(startX + index * spacing, height / 2, 0);
        group.add(bar);

        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: 0x12314f, transparent: true, opacity: 0.24 })
        );
        edge.position.copy(bar.position);
        group.add(edge);
      });

      group.rotation.x = 0.08;
      group.rotation.y = -0.62;
      scene.add(group);

      const renderScene = () => renderer.render(scene, camera);

      const resize = () => {
        const width = Math.max(220, Math.floor(canvasHost.clientWidth || node.clientWidth || 320));
        const height = Math.max(220, Math.min(320, Math.round(width * 0.58)));
        canvasHost.style.height = `${height}px`;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderScene();
      };

      let frame = 0;
      let animationRef = 0;
      const animateIn = () => {
        frame += 1;
        const progress = Math.min(1, frame / 34);
        group.rotation.y = -0.62 + 0.22 * progress;
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

      chartRegistry.set(node, {
        destroy: () => {
          if (animationRef) window.cancelAnimationFrame(animationRef);
          resizeObserver?.disconnect();
          disposeObjectTree(scene);
          renderer.dispose();
          if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
        },
      });
    } catch {
      renderFallbackChartList(node, normalizedRows, valueFormatter);
    }
  };

  const renderExecutiveChart = () => {
    const summary = Array.isArray(state.data?.summary) ? state.data.summary : [];
    const rows = summary
      .filter((item) => item?.enabled)
      .map((item) => ({ label: item.label, value: item.value, hint: item.sublabel }))
      .slice(0, 6);

    renderThreeBarsChart(el.executiveChart, rows, {
      emptyText: "Sin KPIs ejecutivos para el criterio actual.",
      valueFormatter: fmtInt,
    });
  };

  const renderReservationsChart = () => {
    const rows = (Array.isArray(state.data?.reservations?.status_breakdown) ? state.data.reservations.status_breakdown : []).map((item) => ({
      label: item.label,
      value: item.total,
    }));

    renderThreeBarsChart(el.reservationsChart, rows, {
      emptyText: "Sin reservas para representar en el periodo actual.",
      valueFormatter: fmtInt,
    });
  };

  const renderMetricSection = (target, topline, lines, emptyText, permissionLabel) => {
    if (!target) return;
    if (state.status === "loading") {
      target.innerHTML = `<div class="crm-home-empty"><p class="crm-inline-note">Cargando...</p></div>`;
      return;
    }
    if (state.status === "error") {
      target.innerHTML = `<div class="crm-home-empty"><p class="crm-inline-note">${esc(state.errorMessage || "No se pudo cargar.")}</p></div>`;
      return;
    }
    const hasTopline = Array.isArray(topline) && topline.length;
    const hasLines = Array.isArray(lines) && lines.length;
    if (!hasTopline && !hasLines) {
      target.innerHTML = `<div class="crm-home-empty"><p class="crm-inline-note">${esc(permissionLabel || emptyText)}</p></div>`;
      return;
    }
    const toplineHtml = hasTopline
      ? `<div class="crm-home-metric-topline">${topline
          .map(
            (item) => `
              <div class="crm-home-metric-box">
                <p>${esc(item.label)}</p>
                <strong>${esc(item.value)}</strong>
              </div>
            `
          )
          .join("")}</div>`
      : "";
    const linesHtml = hasLines
      ? `<div class="crm-home-status-list">${lines
          .map(
            (item) => `
              <div class="crm-home-status-line">
                <p>${esc(item.label)}</p>
                <strong>${esc(item.value)}</strong>
              </div>
            `
          )
          .join("")}</div>`
      : "";
    target.innerHTML = `${toplineHtml}${linesHtml}`;
  };

  const renderPipeline = () => {
    const pipeline = state.data?.pipeline;
    renderMetricSection(
      el.pipeline,
      pipeline?.enabled
        ? [
            { label: "Deals abiertos", value: fmtInt(pipeline.open_total) },
            { label: "En riesgo", value: fmtInt((pipeline.overdue_total ?? 0) + (pipeline.missing_expected_close_total ?? 0)) },
            { label: "Valor esperado", value: fmtCurrency(pipeline.expected_value_open_total) },
          ]
        : [],
      pipeline?.enabled
        ? (Array.isArray(pipeline.by_stage) ? pipeline.by_stage : []).map((item) => ({
            label: item.label,
            value: `${fmtInt(item.total)} · ${fmtCurrency(item.expected_value_total)}`,
          }))
        : [],
      "Sin deals para el criterio actual.",
      pipeline?.enabled === false && state.status === "ready" ? "Sin permiso para deals o sin deals todavia." : ""
    );
  };

  const renderReservations = () => {
    const reservations = state.data?.reservations;
    renderMetricSection(
      el.reservations,
      reservations?.enabled
        ? [
            { label: "Reservas activas", value: fmtInt(reservations.active_total) },
            { label: "Docs pendientes", value: fmtInt(reservations.docs_pending_total) },
          ]
        : [],
      reservations?.enabled
        ? (Array.isArray(reservations.status_breakdown) ? reservations.status_breakdown : []).map((item) => ({
            label: item.label,
            value: fmtInt(item.total),
          }))
        : [],
      "Sin reservas para el criterio actual.",
      reservations?.enabled === false && state.status === "ready" ? "Sin permiso para clientes/reservas." : ""
    );
  };

  const renderPortal = () => {
    const portal = state.data?.portal;
    renderMetricSection(
      el.portal,
      portal?.enabled
        ? [
            { label: "Visitas requested", value: fmtInt(portal.visit_requests?.requested) },
            { label: "Comisiones pending", value: fmtInt(portal.commissions?.pending) },
          ]
        : [],
      portal?.enabled
        ? [
            { label: "Visitas confirmadas", value: fmtInt(portal.visit_requests?.confirmed) },
            { label: "Visitas canceladas", value: fmtInt(portal.visit_requests?.cancelled) },
            { label: "Comisiones approved", value: fmtInt(portal.commissions?.approved) },
            { label: "Comisiones paid", value: fmtInt(portal.commissions?.paid) },
          ]
        : [],
      "Sin operativa portal registrada.",
      portal?.enabled === false && state.status === "ready" ? "Portal no disponible todavia en este entorno." : ""
    );
  };

  const renderNotifications = () => {
    const notifications = state.data?.notifications;
    renderMetricSection(
      el.notifications,
      notifications?.enabled
        ? [
            { label: "Pending", value: fmtInt(notifications.pending_count) },
            { label: "Scheduled", value: fmtInt(notifications.scheduled_count) },
            { label: "Overdue", value: fmtInt(notifications.overdue_count) },
          ]
        : [],
      notifications?.enabled ? [{ label: "Modulo", value: "Centro de notificaciones" }] : [],
      "Sin notificaciones registradas.",
      notifications?.enabled === false && state.status === "ready" ? "Centro de notificaciones no disponible." : ""
    );
  };

  const renderAll = () => {
    const asOf = toText(state.data?.filters?.as_of);
    if (el.context) {
      if (state.status === "loading") {
        el.context.textContent = "Cargando resumen operativo del CRM...";
      } else if (state.status === "error") {
        el.context.textContent = state.errorMessage || "No se pudo cargar el cockpit.";
      } else {
        el.context.textContent = `Resumen operativo de ${state.scope === "mine" ? "Mi vista" : "Equipo"} · horizonte ${state.window}${asOf ? ` · actualizado ${new Date(asOf).toLocaleString("es-ES")}` : ""}`;
      }
    }
    renderQuickLinks();
    renderAlerts();
    renderSummary();
    renderInbox("mine");
    renderInbox("team");
    renderPipeline();
    renderReservations();
    renderPortal();
    renderNotifications();
  };

  const fetchDashboard = async (organizationId, allowRetryWithoutOrg = true) => {
    const payload = await request(`${apiBase}?${buildQuery(organizationId).toString()}`);
    setResolvedOrganization(payload);
    state.data = payload.data ?? null;
    state.status = "ready";
    state.errorMessage = "";
    state.errorCode = "";
    setFeedback("Cockpit actualizado.");
    return payload;
  };

  const syncControls = () => {
    if (el.scopeSelect) el.scopeSelect.value = state.scope;
    if (el.windowSelect) el.windowSelect.value = state.window;
  };

  const refresh = async () => {
    state.status = "loading";
    state.errorMessage = "";
    state.errorCode = "";
    renderAll();
    setFeedback("Cargando cockpit...");

    try {
      await fetchDashboard(state.organizationId, true);
      renderAll();
    } catch (error) {
      if (state.organizationId && isOrgHintError(error?.code)) {
        state.organizationId = toText(window.__crmDefaultOrganizationId) ?? "";
        writeStorage(orgStorageKey, state.organizationId);
        try {
          await fetchDashboard(state.organizationId, false);
          renderAll();
          return;
        } catch (retryError) {
          error = retryError;
        }
      }

      state.data = null;
      state.status = "error";
      state.errorCode = toText(error?.code) || "dashboard_load_failed";
      state.errorMessage = error instanceof Error ? error.message : String(error);
      renderAll();
      setFeedback(state.errorMessage);
    }
  };

  const handleToggle = (bucket) => {
    state.expanded[bucket] = !state.expanded[bucket];
    renderInbox(bucket);
  };

  const init = () => {
    setOrgId();
    state.scope = readStorage(scopeStorageKey, "mine");
    state.window = readStorage(windowStorageKey, "7d");
    syncControls();
    renderDefaultQuickLinks();

    el.filtersForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.scope = toText(el.scopeSelect?.value) === "team" ? "team" : "mine";
      state.window = toText(el.windowSelect?.value) === "today" || toText(el.windowSelect?.value) === "30d" ? el.windowSelect.value : "7d";
      state.expanded.mine = false;
      state.expanded.team = false;
      writeStorage(scopeStorageKey, state.scope);
      writeStorage(windowStorageKey, state.window);
      void refresh();
    });

    el.refreshButton?.addEventListener("click", () => void refresh());
    el.mineToggle?.addEventListener("click", () => handleToggle("mine"));
    el.teamToggle?.addEventListener("click", () => handleToggle("team"));

    void refresh();
  };

  init();
})();
