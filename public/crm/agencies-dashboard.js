(() => {
  const apiBase = "/api/v1/crm/agencies/dashboard";

  const state = {
    organizationId: "",
    data: null,
  };

  const el = {
    context: document.getElementById("agencies-dashboard-context"),
    feedback: document.getElementById("agencies-dashboard-feedback"),
    kpiTotal: document.getElementById("agencies-kpi-total"),
    kpiActive: document.getElementById("agencies-kpi-active"),
    kpiReferral: document.getElementById("agencies-kpi-referral"),
    kpiAttributed: document.getElementById("agencies-kpi-attributed"),
    kpiWithIdentity: document.getElementById("agencies-kpi-with-identity"),
    kpiWithoutIdentity: document.getElementById("agencies-kpi-without-identity"),
    kpiCustomer: document.getElementById("agencies-kpi-customer"),
    kpiDiscarded: document.getElementById("agencies-kpi-discarded"),
    kpiCrmLeads: document.getElementById("agencies-kpi-crm-leads"),
    kpiLinkedClients: document.getElementById("agencies-kpi-linked-clients"),
    kpiRate: document.getElementById("agencies-kpi-rate"),
    funnel: document.getElementById("agencies-dashboard-funnel"),
    health: document.getElementById("agencies-dashboard-attribution-health"),
    monthly: document.getElementById("agencies-dashboard-monthly"),
    topAgenciesChart: document.getElementById("agencies-dashboard-top-agencies-chart"),
    topContactsChart: document.getElementById("agencies-dashboard-top-contacts-chart"),
    signalMain: document.getElementById("agencies-signal-main"),
    signalMainCopy: document.getElementById("agencies-signal-main-copy"),
    signalLeak: document.getElementById("agencies-signal-leak"),
    signalLeakCopy: document.getElementById("agencies-signal-leak-copy"),
    signalReserve: document.getElementById("agencies-signal-reserve"),
    signalReserveCopy: document.getElementById("agencies-signal-reserve-copy"),
    signalIdentityGap: document.getElementById("agencies-signal-identity-gap"),
    signalIdentityGapCopy: document.getElementById("agencies-signal-identity-gap-copy"),
    topLeads: document.getElementById("agencies-dashboard-top-leads"),
    topClients: document.getElementById("agencies-dashboard-top-clients"),
    topConversion: document.getElementById("agencies-dashboard-top-conversion"),
    topProjects: document.getElementById("agencies-dashboard-top-projects"),
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
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const request = async (url) => {
    const response = await fetch(url);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const details = payload?.details || payload?.error || `http_${response.status}`;
      throw new Error(details);
    }
    return payload;
  };

  const buildAgencyUrl = (agencyId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/agencies/${encodeURIComponent(agencyId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const buildAgencyContactUrl = (agencyContactId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/agencies/contacts/${encodeURIComponent(agencyContactId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

  const setText = (node, value) => {
    if (node instanceof HTMLElement) node.textContent = String(value ?? "-");
  };

  const ensureChart = (node) => {
    if (!(node instanceof HTMLElement) || !window.echarts) return null;
    const existing = window.echarts.getInstanceByDom(node);
    return existing || window.echarts.init(node);
  };

  const clearChartNode = (node, message) => {
    if (!(node instanceof HTMLElement)) return;
    if (window.echarts) {
      const existing = window.echarts.getInstanceByDom(node);
      if (existing) existing.dispose();
    }
    node.innerHTML = `<p class='crm-inline-note'>${esc(message)}</p>`;
  };

  const renderMonthly = (rows) => {
    if (!(el.monthly instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      clearChartNode(el.monthly, "Sin actividad mensual todavia.");
      return;
    }
    const chart = ensureChart(el.monthly);
    if (!chart) {
      clearChartNode(el.monthly, "No se pudo cargar el grafico mensual.");
      return;
    }
    chart.setOption({
      animationDuration: 500,
      color: ["#0f766e", "#f97316", "#dc2626", "#2563eb"],
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { bottom: 0, textStyle: { color: "#475569" } },
      grid: { top: 20, right: 18, bottom: 50, left: 42 },
      xAxis: {
        type: "category",
        data: rows.map((row) => row.month_label || row.month_key || "-"),
        axisLine: { lineStyle: { color: "#cbd5e1" } },
        axisLabel: { color: "#475569" },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.16)" } },
        axisLabel: { color: "#64748b" },
      },
      series: [
        {
          name: "Registros",
          type: "bar",
          barMaxWidth: 28,
          data: rows.map((row) => toNumber(row.total)),
          itemStyle: { borderRadius: [10, 10, 0, 0] },
        },
        {
          name: "Clientes",
          type: "line",
          smooth: true,
          symbolSize: 8,
          data: rows.map((row) => toNumber(row.customer_total)),
        },
        {
          name: "Baja",
          type: "line",
          smooth: true,
          symbolSize: 7,
          data: rows.map((row) => toNumber(row.discarded_total)),
        },
        {
          name: "Con identidad",
          type: "line",
          smooth: true,
          symbolSize: 7,
          data: rows.map((row) => toNumber(row.with_identity_total)),
        },
      ],
    });
  };

  const renderFunnel = (summary) => {
    if (!(el.funnel instanceof HTMLElement)) return;
    const seriesRows = [
      { label: "Registros atribuidos", value: toNumber(summary.attributed_records_total) },
      { label: "Con identidad", value: toNumber(summary.attributed_records_with_identity_total) },
      { label: "Customer historico", value: toNumber(summary.attributed_records_customer_total) },
      { label: "Clientes vinculados", value: toNumber(summary.linked_clients_total) },
      { label: "Clientes con reserva", value: toNumber(summary.linked_reserved_clients_total) },
    ].filter((row) => row.value > 0);
    if (!seriesRows.length) {
      clearChartNode(el.funnel, "Sin embudo suficiente.");
      return;
    }
    const chart = ensureChart(el.funnel);
    if (!chart) {
      clearChartNode(el.funnel, "No se pudo cargar el embudo.");
      return;
    }
    chart.setOption({
      animationDuration: 500,
      color: ["#0f766e", "#2563eb", "#f97316", "#14b8a6", "#0f8a56"],
      tooltip: { trigger: "item" },
      series: [
        {
          type: "funnel",
          left: "8%",
          top: 20,
          bottom: 20,
          width: "84%",
          minSize: "18%",
          maxSize: "100%",
          sort: "descending",
          gap: 6,
          label: { show: true, color: "#0f172a", formatter: "{b}\n{c}" },
          labelLine: { length: 14, lineStyle: { color: "#94a3b8" } },
          itemStyle: { borderColor: "#fff", borderWidth: 2, opacity: 0.94 },
          data: seriesRows.map((row) => ({ name: row.label, value: row.value })),
        },
      ],
    });
  };

  const renderHealth = (summary) => {
    if (!(el.health instanceof HTMLElement)) return;
    const chart = ensureChart(el.health);
    if (!chart) {
      clearChartNode(el.health, "No se pudo cargar la calidad de atribucion.");
      return;
    }
    chart.setOption({
      animationDuration: 500,
      color: ["#2563eb", "#f97316", "#dc2626", "#0f766e", "#7c3aed"],
      tooltip: { trigger: "item" },
      legend: { bottom: 0, textStyle: { color: "#475569" } },
      series: [
        {
          type: "pie",
          radius: ["42%", "72%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          label: { color: "#0f172a", formatter: "{b}\n{c}" },
          data: [
            { name: "Con identidad", value: toNumber(summary.attributed_records_with_identity_total) },
            { name: "Sin identidad", value: toNumber(summary.attributed_records_without_identity_total) },
            { name: "Baja o descartado", value: toNumber(summary.attributed_records_discarded_total) },
            { name: "Customer", value: toNumber(summary.attributed_records_customer_total) },
            { name: "Activo", value: toNumber(summary.attributed_records_active_total) },
          ].filter((row) => row.value > 0),
        },
      ],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "37%",
          style: {
            text: `${toNumber(summary.attributed_records_total)}`,
            fill: "#0f172a",
            font: "700 28px sans-serif",
            textAlign: "center",
          },
        },
        {
          type: "text",
          left: "center",
          top: "49%",
          style: {
            text: "registros",
            fill: "#64748b",
            font: "600 12px sans-serif",
            textAlign: "center",
          },
        },
      ],
    });
  };

  const renderTopAgenciesChart = (rows) => {
    if (!(el.topAgenciesChart instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      clearChartNode(el.topAgenciesChart, "Sin agencias comparables.");
      return;
    }
    const chart = ensureChart(el.topAgenciesChart);
    if (!chart) {
      clearChartNode(el.topAgenciesChart, "No se pudo cargar la comparativa.");
      return;
    }
    const items = rows.slice(0, 7).reverse();
    chart.setOption({
      animationDuration: 500,
      color: ["#0f766e", "#f97316", "#2563eb"],
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { bottom: 0, textStyle: { color: "#475569" } },
      grid: { top: 20, right: 20, bottom: 50, left: 150 },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.16)" } },
        axisLabel: { color: "#64748b" },
      },
      yAxis: {
        type: "category",
        data: items.map((row) => toText(row.agency_name) || "Agencia"),
        axisLabel: { color: "#334155" },
        axisLine: { show: false },
      },
      series: [
        { name: "Registros", type: "bar", barMaxWidth: 18, data: items.map((row) => toNumber(row.attributed_records_total)) },
        { name: "Clientes", type: "bar", barMaxWidth: 18, data: items.map((row) => toNumber(row.linked_clients_total)) },
        { name: "Reserva", type: "bar", barMaxWidth: 18, data: items.map((row) => toNumber(row.linked_reserved_clients_total)) },
      ],
    });
  };

  const renderTopContactsChart = (rows) => {
    if (!(el.topContactsChart instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      clearChartNode(el.topContactsChart, "Sin agentes con historico.");
      return;
    }
    const chart = ensureChart(el.topContactsChart);
    if (!chart) {
      clearChartNode(el.topContactsChart, "No se pudo cargar el ranking de agentes.");
      return;
    }
    const items = rows.slice(0, 8).reverse();
    chart.setOption({
      animationDuration: 500,
      color: ["#f97316", "#0f766e"],
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { bottom: 0, textStyle: { color: "#475569" } },
      grid: { top: 20, right: 20, bottom: 50, left: 155 },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.16)" } },
        axisLabel: { color: "#64748b" },
      },
      yAxis: {
        type: "category",
        data: items.map((row) => toText(row.full_name) || toText(row.email) || "Contacto"),
        axisLabel: { color: "#334155" },
        axisLine: { show: false },
      },
      series: [
        { name: "Clientes atribuidos", type: "bar", barMaxWidth: 18, data: items.map((row) => toNumber(row.attributed_customer_total)) },
        { name: "Registros atribuidos", type: "bar", barMaxWidth: 18, data: items.map((row) => toNumber(row.attributed_records_total)) },
      ],
    });
  };

  const renderRanking = (node, rows, options) => {
    if (!(node instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      node.innerHTML = "<p class='crm-inline-note'>Sin datos por ahora.</p>";
      return;
    }
    const maxValue = Math.max(...rows.map((row) => toNumber(row[options.valueKey])), 1);
    node.innerHTML = rows
      .map((row) => {
        const title = toText(row[options.titleKey]) || "Sin nombre";
        const href = options.hrefBuilder ? options.hrefBuilder(row) : null;
        const value = toNumber(row[options.valueKey]);
        const width = Math.max((value / maxValue) * 100, value ? 6 : 0);
        return `
          <article class="crm-ranking-item">
            <div class="crm-ranking-head">
              ${href ? `<a href="${esc(href)}" class="crm-ranking-title">${esc(title)}</a>` : `<span class="crm-ranking-title">${esc(title)}</span>`}
              <strong>${esc(String(value))}${esc(options.valueSuffix || "")}</strong>
            </div>
            <p class="crm-ranking-meta">${esc(options.metaBuilder(row))}</p>
            <div class="crm-ranking-bar"><span style="width:${width}%"></span></div>
          </article>
        `;
      })
      .join("");
  };

  const render = () => {
    const data = state.data;
    if (!data) return;
    const summary = data.summary || {};
    setText(el.kpiTotal, toNumber(summary.agencies_total));
    setText(el.kpiActive, toNumber(summary.active_agencies_total));
    setText(el.kpiReferral, toNumber(summary.referral_sources_total));
    setText(el.kpiAttributed, toNumber(summary.attributed_records_total));
    setText(el.kpiWithIdentity, toNumber(summary.attributed_records_with_identity_total));
    setText(el.kpiWithoutIdentity, toNumber(summary.attributed_records_without_identity_total));
    setText(el.kpiCustomer, toNumber(summary.attributed_records_customer_total));
    setText(el.kpiDiscarded, toNumber(summary.attributed_records_discarded_total));
    setText(el.kpiCrmLeads, toNumber(summary.leads_total));
    setText(el.kpiLinkedClients, toNumber(summary.linked_clients_total));
    setText(el.kpiRate, `${toNumber(summary.attributed_to_linked_client_rate_pct)}%`);
    setText(el.signalMain, `${toNumber(summary.linked_clients_total)} clientes`);
    setText(
      el.signalMainCopy,
      `${toNumber(summary.linked_clients_total)} clientes vinculados desde ${toNumber(summary.attributed_records_total)} registros detectados.`
    );
    setText(el.signalLeak, `${toNumber(summary.attributed_records_discarded_total)} bajas`);
    setText(
      el.signalLeakCopy,
      `${toNumber(summary.attributed_records_discarded_total)} registros terminaron en baja o descartado.`
    );
    setText(el.signalReserve, `${toNumber(summary.linked_client_reservation_rate_pct)}%`);
    setText(
      el.signalReserveCopy,
      `${toNumber(summary.linked_reserved_clients_total)} clientes con reserva sobre ${toNumber(summary.linked_clients_total)} vinculados.`
    );
    setText(el.signalIdentityGap, `${toNumber(summary.attributed_records_without_identity_total)}`);
    setText(
      el.signalIdentityGapCopy,
      `${toNumber(summary.attributed_records_without_identity_total)} registros siguen sin identidad fuerte y limitan conversion y trazabilidad.`
    );

    if (el.context instanceof HTMLElement) {
      el.context.textContent =
        `${toNumber(summary.agencies_total)} agencias activas en mapa | ${toNumber(summary.attributed_records_total)} registros historicos atribuidos | ` +
        `${toNumber(summary.linked_clients_total)} clientes vinculados | ${toNumber(summary.linked_reserved_clients_total)} con reserva | ` +
        `${toNumber(summary.attributed_records_without_identity_total)} siguen sin identidad util`;
    }

    renderMonthly(data.monthly || []);
    renderFunnel(summary);
    renderHealth(summary);
    renderTopAgenciesChart(data.top_by_leads || []);
    renderTopContactsChart(data.top_contacts || []);
    renderRanking(el.topLeads, data.top_by_leads || [], {
      titleKey: "agency_name",
      valueKey: "attributed_records_total",
      metaBuilder: (row) =>
        `registros ${toNumber(row.attributed_records_total)} | con identidad ${toNumber(row.attributed_records_with_identity_total)} | clientes ${toNumber(row.linked_clients_total)}`,
      hrefBuilder: (row) => (row.agency_id ? buildAgencyUrl(row.agency_id) : null),
    });
    renderRanking(el.topClients, data.top_by_clients || [], {
      titleKey: "agency_name",
      valueKey: "linked_clients_total",
      metaBuilder: (row) =>
        `registros ${toNumber(row.attributed_records_total)} | customer ${toNumber(row.attributed_records_customer_total)} | con reserva ${toNumber(row.linked_reserved_clients_total)}`,
      hrefBuilder: (row) => (row.agency_id ? buildAgencyUrl(row.agency_id) : null),
    });
    renderRanking(el.topConversion, data.top_by_conversion || [], {
      titleKey: "agency_name",
      valueKey: "attributed_to_linked_client_rate_pct",
      valueSuffix: "%",
      metaBuilder: (row) =>
        `${toNumber(row.linked_clients_total)} clientes vinculados sobre ${toNumber(row.attributed_records_total)} registros`,
      hrefBuilder: (row) => (row.agency_id ? buildAgencyUrl(row.agency_id) : null),
    });
    renderRanking(el.topProjects, data.top_projects || [], {
      titleKey: "project_label",
      valueKey: "attributed_records_total",
      metaBuilder: (row) =>
        `${toNumber(row.attributed_with_identity_total)} con identidad | ${toNumber(row.customer_total)} clientes | ${toNumber(row.linked_clients_total)} vinculados`,
    });
  };

  const load = async () => {
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    const payload = await request(`${apiBase}?${params.toString()}`);
    state.data = payload.data || null;
    render();
  };

  const queryOrganizationId = toText(new URLSearchParams(window.location.search).get("organization_id"));
  const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) window.localStorage.setItem("crm.organization_id", state.organizationId);

  window.addEventListener("resize", () => {
    if (!window.echarts) return;
    [el.funnel, el.health, el.monthly, el.topAgenciesChart, el.topContactsChart].forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const instance = window.echarts.getInstanceByDom(node);
      instance?.resize();
    });
  });

  load()
    .then(() => setFeedback("Dashboard de agencias cargado.", "ok"))
    .catch((error) => setFeedback(`Error cargando dashboard: ${error.message}`, "error"));
})();
