(() => {
  const apiBase = "/api/v1/clients/kpis";
  const promotionStorageKey = "crm.clients.dashboard.promotion_id";
  const onlyActiveStorageKey = "crm.clients.dashboard.only_active";
  const statusFilterStorageKey = "crm.clients.dashboard.status_filter";

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

  const state = {
    organizationId: "",
    organizationSource: "none",
    data: null,
    selectedPromotionId: "",
    onlyActive: false,
    statusFilter: "",
  };

  const el = {
    orgForm: document.getElementById("clients-kpi-org-form"),
    orgInput: document.getElementById("clients-kpi-organization-id"),
    orgMeta: document.getElementById("clients-kpi-org-meta"),
    promoMeta: document.getElementById("clients-kpi-promo-meta"),
    promotionSelect: document.getElementById("clients-kpi-promotion-select"),
    statusFilterSelect: document.getElementById("clients-kpi-status-filter"),
    onlyActiveCheckbox: document.getElementById("clients-kpi-only-active"),
    selectTopButton: document.getElementById("clients-kpi-select-top"),
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
    channelTotal: document.getElementById("clients-kpi-channel-total"),
    channelLegend: document.getElementById("clients-kpi-channel-legend"),
    statusBars: document.getElementById("clients-kpi-status-bars"),
    monthly: document.getElementById("clients-kpi-monthly"),
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

  const getSelectedPromotion = () => getPromotionById(state.selectedPromotionId);

  const persistSelectedPromotion = () => {
    if (state.selectedPromotionId) {
      localStorage.setItem(promotionStorageKey, state.selectedPromotionId);
    } else {
      localStorage.removeItem(promotionStorageKey);
    }
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
    if (!promotions.length) {
      el.promotionSelect.innerHTML = "<option value=''>Sin promociones para este filtro</option>";
      return;
    }
    el.promotionSelect.innerHTML = promotions
      .map((promotion) => {
        const projectId = toText(promotion.project_id) || "";
        const selected = projectId === state.selectedPromotionId ? " selected" : "";
        return `<option value="${esc(projectId)}"${selected}>${esc(promotionLabel(promotion))}</option>`;
      })
      .join("");
  };

  const renderChannel = (promotion) => {
    if (!el.channelDonut || !el.channelLegend || !el.channelTotal) return;
    const channels = promotion?.sales_channels || {};
    const total = Number(channels.total || 0);
    el.channelTotal.textContent = fmtInt(total);

    if (total <= 0) {
      el.channelDonut.style.background = "conic-gradient(#d0d9e6 0deg 360deg)";
      el.channelLegend.innerHTML = "<li>Sin datos de canales.</li>";
      return;
    }

    let cumulative = 0;
    const segments = channelConfig.map((item) => {
      const value = Number(channels[item.key] || 0);
      const pct = (value / total) * 100;
      const start = cumulative;
      cumulative += pct;
      return {
        ...item,
        value,
        pct,
        startDeg: start * 3.6,
        endDeg: cumulative * 3.6,
      };
    });

    const gradient = segments
      .map((item) => `${item.color} ${item.startDeg.toFixed(2)}deg ${item.endDeg.toFixed(2)}deg`)
      .join(", ");
    el.channelDonut.style.background = `conic-gradient(${gradient})`;

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
    const rows = Array.isArray(promotion?.status_breakdown)
      ? promotion.status_breakdown.filter((item) => Number(item.count || 0) > 0)
      : [];
    if (!rows.length) {
      el.statusBars.innerHTML = "<li class='crm-bar-list-empty'>Sin datos de estado.</li>";
      return;
    }

    const maxCount = Math.max(...rows.map((item) => Number(item.count || 0)), 1);
    el.statusBars.innerHTML = rows
      .map((item) => {
        const count = Number(item.count || 0);
        const pct = Number(item.pct || 0);
        const width = (count / maxCount) * 100;
        return `
        <li class="crm-bar-row">
          <div class="crm-bar-head">
            <span>${esc(statusLabels[item.status] || item.status)}</span>
            <span>${esc(fmtInt(count))} | ${esc(fmtPct(pct))}</span>
          </div>
          <div class="crm-bar-track"><div class="crm-bar-fill" style="width:${width}%;"></div></div>
        </li>
      `;
      })
      .join("");
  };

  const renderMonthly = (promotion) => {
    if (!el.monthly) return;
    const rows = Array.isArray(promotion?.monthly) ? promotion.monthly.slice(-18) : [];
    if (!rows.length) {
      el.monthly.innerHTML = "<p class='crm-inline-note'>Sin datos mensuales para la promocion.</p>";
      return;
    }

    const maxCount = Math.max(...rows.map((item) => Number(item.count || 0)), 1);
    el.monthly.innerHTML = rows
      .map((item) => {
        const count = Number(item.count || 0);
        const barHeight = Math.max(10, Math.round((count / maxCount) * 170));
        return `
        <div class="crm-monthly-item">
          <span class="crm-monthly-value">${esc(fmtInt(count))}</span>
          <div class="crm-monthly-bar" style="height:${barHeight}px"></div>
          <span>${esc(formatMonth(item.month))}</span>
        </div>
      `;
      })
      .join("");
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
    if (!el.compare) return;
    const promotions = getVisiblePromotions().slice(0, 10);
    if (!promotions.length) {
      el.compare.innerHTML = "<p class='crm-inline-note'>Sin datos de promociones.</p>";
      return;
    }

    const maxReservations = Math.max(...promotions.map((item) => Number(item.reservations_total || 0)), 1);
    el.compare.innerHTML = promotions
      .map((promotion) => {
        const projectId = toText(promotion.project_id) || "";
        const selectedClass = projectId === state.selectedPromotionId ? " is-selected" : "";
        const reservations = Number(promotion.reservations_total || 0);
        const width = (reservations / maxReservations) * 100;
        const info = [
          `${fmtInt(promotion.clients_total)} clientes`,
          `${fmtInt(promotion.active_reservations_total)} activas`,
          `${fmtPct(promotion.reservation_paid_pct)} reserva pagada`,
          `${fmtPct(promotion.document_completion_pct)} docs`,
        ].join(" | ");
        return `
          <div class="crm-promo-compare-row${selectedClass}">
            <div class="crm-promo-compare-head">
              <span>${esc(promotionLabel(promotion))}</span>
              <button type="button" data-project-id="${esc(projectId)}">Ver KPI</button>
            </div>
            <div class="crm-bar-track"><div class="crm-bar-fill" style="width:${width}%;"></div></div>
            <small>${esc(fmtInt(reservations))} reservas | ${esc(info)}</small>
          </div>
        `;
      })
      .join("");
  };

  const renderPromotionsTable = () => {
    if (!el.promotionsTbody) return;
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
    const promotion = getSelectedPromotion();
    renderCards(promotion);
    renderChannel(promotion);
    renderStatusBars(promotion);
    renderMonthly(promotion);
    renderCompare();
    renderPromotionsTable();
    renderPromotionMeta(promotion);
  };

  const selectPromotion = (projectId, persist = true) => {
    const nextId = toText(projectId);
    const visiblePromotions = getVisiblePromotions();
    const exists = nextId ? Boolean(getPromotionById(nextId, visiblePromotions)) : false;
    state.selectedPromotionId = exists ? nextId : "";
    if (!state.selectedPromotionId) {
      const firstId = toText(visiblePromotions[0]?.project_id);
      state.selectedPromotionId = firstId || "";
    }
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
      const selectedExists = promotions.some((item) => toText(item.project_id) === state.selectedPromotionId);
      if (!selectedExists) {
        state.selectedPromotionId = toText(promotions[0]?.project_id) || "";
      }

      persistSelectedPromotion();
      renderDashboard();
      setFeedback("Dashboard por promocion actualizado.", "ok");
    } catch (error) {
      state.data = null;
      state.selectedPromotionId = "";
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
    if (!selectedExists) {
      state.selectedPromotionId = toText(visiblePromotions[0]?.project_id) || "";
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
    state.organizationId = nextId || "";
    state.organizationSource = "manual";
    if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);
    else localStorage.removeItem("crm.organization_id");
    renderOrganizationMeta();
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

  el.compare?.addEventListener("click", (event) => {
    const trigger = event.target instanceof HTMLElement ? event.target.closest("button[data-project-id]") : null;
    if (!trigger) return;
    const nextId = toText(trigger.getAttribute("data-project-id"));
    if (!nextId) return;
    selectPromotion(nextId, true);
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

  state.selectedPromotionId = queryPromotionId || localPromotionId || "";
  if (queryOnlyActive) {
    const normalized = queryOnlyActive.toLowerCase();
    state.onlyActive = ["1", "true", "si", "yes"].includes(normalized);
  } else {
    state.onlyActive = localOnlyActive === "1";
  }
  state.statusFilter = sanitizeStatusFilter(queryStatusFilter || localStatusFilter || "");

  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);
  persistFilters();
  renderOrganizationMeta();
  bindKpiHelpTitles();
  loadDashboard();
})();
