(() => {
  const apiBase = "/api/v1/crm/deals";
  const propertiesApiBase = "/api/v1/properties";

  const stageLabels = {
    qualification: "Cualificacion",
    visit: "Visita",
    offer: "Oferta",
    negotiation: "Negociacion",
    reservation: "Reserva",
    contract: "Contrato",
    won: "Ganada",
    lost: "Perdida",
  };

  const state = {
    organizationId: "",
    dealId: "",
    deal: null,
    properties: [],
    propertySelectionDirty: false,
  };

  const el = {
    title: document.getElementById("deal-detail-title"),
    subtitle: document.getElementById("deal-detail-subtitle"),
    stage: document.getElementById("deal-stage"),
    value: document.getElementById("deal-value"),
    probability: document.getElementById("deal-probability"),
    closeDate: document.getElementById("deal-close-date"),
    form: document.getElementById("deal-edit-form"),
    stageQuickActions: document.getElementById("deal-stage-quick-actions"),
    propertySearch: document.getElementById("deal-property-search"),
    propertyId: document.getElementById("deal-property-id"),
    propertyList: document.getElementById("deal-property-options"),
    propertyHelper: document.getElementById("deal-property-helper"),
    leadSummary: document.getElementById("deal-lead-summary"),
    clientSummary: document.getElementById("deal-client-summary"),
    propertySummary: document.getElementById("deal-property-summary"),
    linksSummary: document.getElementById("deal-links-summary"),
    notificationsSummary: document.getElementById("deal-notifications-summary"),
    notificationsList: document.getElementById("deal-notifications-list"),
    openLead: document.getElementById("deal-open-lead"),
    openClient: document.getElementById("deal-open-client"),
    openProperty: document.getElementById("deal-open-property"),
    feedback: document.getElementById("deal-detail-feedback"),
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

  const redirectToLogin = () => {
    const loginUrl = new URL("/crm/login/", window.location.origin);
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

  const request = async (url, init) => {
    const response = await fetch(url, init);
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (isCrmAuthError(response, payload)) {
      redirectToLogin();
      throw new Error(toText(payload?.error) || `http_${response.status}`);
    }
    if (!response.ok || !payload?.ok) {
      const errorCode = payload?.error || `http_${response.status}`;
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 250) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
  };

  const humanizeDealError = (error) => {
    const raw = error instanceof Error ? error.message : String(error ?? "unknown_error");
    if (raw.includes("invalid_deal_property_record_type")) {
      return "Solo puedes vincular una vivienda operativa al deal.";
    }
    if (raw.includes("property_archived_for_deal")) {
      return "La vivienda seleccionada esta archivada y no se puede usar.";
    }
    if (raw.includes("property_not_found_for_deal")) {
      return "La vivienda seleccionada ya no existe o no pertenece a tu organizacion.";
    }
    return raw;
  };

  const formatCurrency = (value, currency = "EUR") => {
    const amount = toNumber(value);
    if (amount == null) return "-";
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: currency || "EUR",
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${amount} ${currency || "EUR"}`;
    }
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

  const buildNotificationsUrl = () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    return `/crm/notifications/${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const buildLeadUrl = (leadId) => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    return `/crm/leads/${encodeURIComponent(leadId)}/${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const buildClientUrl = (clientId) => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    return `/crm/clients/${encodeURIComponent(clientId)}/${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const buildPropertyUrl = (property) => {
    const propertyId = toText(property?.id);
    if (!propertyId) return "#";
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    const recordType = toText(property?.record_type);
    const pathname =
      recordType === "project"
        ? `/crm/properties/promocion/${encodeURIComponent(propertyId)}/`
        : `/crm/properties/propiedad/${encodeURIComponent(propertyId)}/`;
    return `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const propertyLabel = (row) => {
    const display =
      toText(row?.display_name) ||
      toText(row?.project_name) ||
      toText(row?.legacy_code) ||
      toText(row?.id) ||
      "Propiedad";
    const meta = [
      toText(row?.legacy_code) !== display ? toText(row?.legacy_code) : null,
      toText(row?.record_type),
      toText(row?.status),
      toText(row?.project_label) || toText(row?.project_name),
    ].filter(Boolean);
    return [display, meta.length ? meta.join(" | ") : null].filter(Boolean).join(" || ");
  };

  const isSelectableProperty = (row) => {
    const recordType = toText(row?.record_type);
    const status = toText(row?.status);
    return (recordType === "unit" || recordType === "single") && status !== "archived";
  };

  const currentPropertyIsEditable = () => isSelectableProperty(state.deal?.property);

  const setAnchorState = (node, href, enabled) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    node.href = enabled && href ? href : "#";
    node.classList.toggle("is-disabled", !enabled || !href);
    if (!enabled || !href) node.setAttribute("aria-disabled", "true");
    else node.removeAttribute("aria-disabled");
  };

  const renderPropertyOptions = () => {
    if (!(el.propertyList instanceof HTMLDataListElement)) return;
    const rows = state.properties.filter(isSelectableProperty);
    const currentProperty = state.deal?.property || null;
    const currentPropertyId = toText(currentProperty?.id);

    if (
      currentProperty &&
      currentPropertyId &&
      !rows.some((row) => toText(row?.id) === currentPropertyId)
    ) {
      rows.push(currentProperty);
    }

    rows.sort((left, right) => propertyLabel(left).localeCompare(propertyLabel(right), "es"));
    el.propertyList.innerHTML = rows
      .filter((row) => toText(row?.id))
      .map((row) => `<option value="${esc(propertyLabel(row))}"></option>`)
      .join("");

    if (!(el.propertyHelper instanceof HTMLElement)) return;
    if (!currentProperty) {
      el.propertyHelper.textContent = "Sin propiedad vinculada.";
      return;
    }
    if (currentPropertyIsEditable()) {
      el.propertyHelper.textContent = "Puedes cambiar la vivienda vinculada por otra operativa.";
      return;
    }
    el.propertyHelper.textContent =
      "La vinculacion actual es heredada o no operativa. Solo se cambiara si eliges una vivienda valida.";
  };

  const syncPropertyInput = () => {
    const property = state.deal?.property || null;
    if (el.propertySearch instanceof HTMLInputElement) {
      el.propertySearch.value = property ? propertyLabel(property) : "";
    }
    if (el.propertyId instanceof HTMLInputElement) {
      el.propertyId.value = property ? toText(property.id) || "" : "";
    }
    state.propertySelectionDirty = false;
  };

  const resolvePropertyFromInput = () => {
    const query = toText(el.propertySearch?.value);
    const match = state.properties.find((row) => propertyLabel(row) === query) ?? null;
    if (match) {
      if (el.propertyId instanceof HTMLInputElement) el.propertyId.value = toText(match.id) || "";
      return match;
    }
    if (!query) {
      if (el.propertyId instanceof HTMLInputElement) el.propertyId.value = "";
      return null;
    }
    if (el.propertyId instanceof HTMLInputElement) el.propertyId.value = "";
    return null;
  };

  const patchDeal = async (patch, successMessage) => {
    const payload = await request(`${apiBase}/${encodeURIComponent(state.dealId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId || null,
        ...patch,
      }),
    });
    state.deal = payload?.data || state.deal;
    renderDeal(payload?.meta || {});
    setFeedback(successMessage, "ok");
  };

  const renderQuickActions = () => {
    if (!(el.stageQuickActions instanceof HTMLElement) || !state.deal) return;
    const stage = toText(state.deal.stage) || "qualification";
    if (stage === "won" || stage === "lost") {
      el.stageQuickActions.innerHTML =
        '<button type="button" class="crm-button crm-button-soft" data-stage-action="negotiation">Reabrir en negociacion</button>';
      return;
    }
    el.stageQuickActions.innerHTML = [
      '<button type="button" class="crm-button crm-button-soft" data-stage-action="won">Marcar ganada</button>',
      '<button type="button" class="crm-button crm-button-soft" data-stage-action="lost">Marcar perdida</button>',
    ].join("");
  };

  const renderDeal = (meta = {}) => {
    const deal = state.deal;
    if (!deal) return;

    if (el.title) el.title.textContent = toText(deal.title) || "Ficha de deal";
    if (el.subtitle) {
      el.subtitle.textContent =
        [
          toText(deal.client?.full_name),
          toText(deal.lead?.full_name),
          toText(deal.property?.display_name),
        ].filter(Boolean).join(" | ") || "Oportunidad comercial";
    }
    if (el.stage) el.stage.textContent = stageLabels[deal.stage] || deal.stage || "-";
    if (el.value) el.value.textContent = formatCurrency(deal.expected_value, deal.currency);
    if (el.probability) {
      el.probability.textContent = toNumber(deal.probability) == null ? "-" : `${toNumber(deal.probability)}%`;
    }
    if (el.closeDate) el.closeDate.textContent = toText(deal.expected_close_date) || "-";

    if (el.form instanceof HTMLFormElement) {
      const setValue = (name, value) => {
        const input = el.form.elements.namedItem(name);
        if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
          input.value = value == null ? "" : String(value);
        }
      };
      setValue("title", deal.title);
      setValue("stage", deal.stage);
      setValue("expected_close_date", deal.expected_close_date);
      setValue("expected_value", deal.expected_value);
      setValue("probability", deal.probability);
    }

    renderQuickActions();
    renderPropertyOptions();
    syncPropertyInput();

    if (el.leadSummary) {
      el.leadSummary.innerHTML = deal.lead?.id
        ? `<strong>${esc(deal.lead.full_name || deal.lead.id)}</strong><br /><small>${esc(deal.lead.status || "")}</small>`
        : "Sin lead vinculado.";
    }
    if (el.clientSummary) {
      el.clientSummary.innerHTML = deal.client?.id
        ? `<strong>${esc(deal.client.full_name || deal.client.id)}</strong><br /><small>${esc(deal.client.client_code || deal.client.client_status || "")}</small>`
        : "Sin cliente vinculado.";
    }
    if (el.propertySummary) {
      el.propertySummary.innerHTML = deal.property?.id
        ? `<strong>${esc(deal.property.display_name || deal.property.legacy_code || deal.property.id)}</strong><br /><small>${esc(deal.property.project_label || deal.property.status || "")}</small>`
        : "Sin propiedad vinculada.";
    }
    if (el.linksSummary) {
      el.linksSummary.textContent = `Contratos ${meta.linked_contracts ?? 0} | Comisiones ${meta.linked_commissions ?? 0}`;
    }

    const summary = deal.notifications_summary || null;
    const activeNotifications = Array.isArray(summary?.active_notifications) ? summary.active_notifications : [];
    if (el.notificationsSummary && el.notificationsList) {
      if (!summary || !summary.total) {
        el.notificationsSummary.innerHTML = "Sin alertas activas para este deal.";
        el.notificationsList.innerHTML = "";
      } else {
        el.notificationsSummary.innerHTML = `
          <strong>${esc(String(summary.open_total ?? 0))}</strong> abiertas |
          urgentes ${esc(String(summary.urgent_total ?? 0))} |
          overdue ${esc(String(summary.overdue_total ?? 0))}<br />
          <a class="crm-link" href="${esc(buildNotificationsUrl())}">Abrir centro de notificaciones</a>
        `;
        el.notificationsList.innerHTML = activeNotifications.length
          ? activeNotifications
              .slice(0, 4)
              .map(
                (item) => `
                  <article style="padding:0.8rem 0.9rem;border:1px solid rgba(20,50,77,0.08);border-radius:14px">
                    <strong>${esc(item.title || "Alerta")}</strong><br />
                    <small>${esc(item.priority || "normal")} | ${esc(item.rule_key || "manual")}</small><br />
                    <small>${esc(item.body || "")}</small>
                  </article>
                `
              )
              .join("")
          : "";
      }
    }

    setAnchorState(el.openLead, deal.lead?.id ? buildLeadUrl(deal.lead.id) : null, Boolean(deal.lead?.id));
    setAnchorState(el.openClient, deal.client?.id ? buildClientUrl(deal.client.id) : null, Boolean(deal.client?.id));
    setAnchorState(
      el.openProperty,
      deal.property?.id ? buildPropertyUrl(deal.property) : null,
      Boolean(deal.property?.id)
    );
  };

  const loadDeal = async () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    const payload = await request(`${apiBase}/${encodeURIComponent(state.dealId)}?${params.toString()}`);
    state.deal = payload?.data || null;
    renderDeal(payload?.meta || {});
  };

  const loadProperties = async () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    params.set("per_page", "300");
    const payload = await request(`${propertiesApiBase}?${params.toString()}`);
    state.properties = Array.isArray(payload?.data) ? payload.data : [];
    renderPropertyOptions();
    syncPropertyInput();
  };

  const search = new URLSearchParams(window.location.search);
  state.organizationId =
    toText(search.get("organization_id")) ||
    toText(localStorage.getItem("crm.organization_id")) ||
    toText(window.__crmDefaultOrganizationId) ||
    "";
  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);
  state.dealId = toText(window.__crmDealDetailId) || "";

  el.propertySearch?.addEventListener("input", () => {
    state.propertySelectionDirty = true;
    resolvePropertyFromInput();
  });

  el.propertySearch?.addEventListener("change", () => {
    state.propertySelectionDirty = true;
    resolvePropertyFromInput();
  });

  el.stageQuickActions?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-stage-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const nextStage = toText(button.dataset.stageAction);
    if (!nextStage) return;
    try {
      await patchDeal({ stage: nextStage }, "Stage actualizado.");
    } catch (error) {
      setFeedback(`Error actualizando stage: ${humanizeDealError(error)}`, "error");
    }
  });

  el.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(el.form instanceof HTMLFormElement)) return;

    const formData = new FormData(el.form);
    const body = {
      title: toText(formData.get("title")),
      stage: toText(formData.get("stage")),
      expected_close_date: toText(formData.get("expected_close_date")),
      expected_value: toNumber(formData.get("expected_value")),
      probability: toNumber(formData.get("probability")),
    };

    if (state.propertySelectionDirty) {
      if (toText(el.propertySearch?.value) && !toText(el.propertyId?.value)) {
        setFeedback("Selecciona una vivienda valida de la lista.", "error");
        return;
      }
      body.property_id = toText(formData.get("property_id"));
    }

    try {
      await patchDeal(body, "Deal actualizado.");
    } catch (error) {
      setFeedback(`Error actualizando deal: ${humanizeDealError(error)}`, "error");
    }
  });

  if (state.dealId) {
    void (async () => {
      try {
        await loadDeal();
        await loadProperties();
        setFeedback("Ficha de deal cargada.", "ok");
      } catch (error) {
        setFeedback(`Error cargando deal: ${humanizeDealError(error)}`, "error");
      }
    })();
  }
})();
