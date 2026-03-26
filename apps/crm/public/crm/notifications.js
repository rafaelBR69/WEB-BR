(() => {
  const root = document.querySelector("[data-crm-notifications='true']");
  if (!(root instanceof HTMLElement)) return;

  const orgKey = "crm.organization_id";
  const viewKey = "crm.notifications.view.v2";
  const state = {
    organizationId: "",
    organizationSource: "none",
    rows: [],
    leads: [],
    clients: [],
    deals: [],
    page: 1,
    perPage: 25,
    hasNextPage: false,
    pendingCount: 0,
    scheduledCount: 0,
    overdueCount: 0,
  };

  const el = {
    orgForm: document.getElementById("crm-notifications-org-form"),
    orgInput: document.getElementById("crm-notifications-organization-id"),
    orgSource: document.getElementById("crm-notifications-org-source"),
    orgHelp: document.getElementById("crm-notifications-org-help"),
    createForm: document.getElementById("crm-notification-create-form"),
    createEntityType: document.getElementById("crm-notifications-create-entity-type"),
    createEntityTypeApi: document.getElementById("crm-notifications-create-entity-type-api"),
    createEntityHelp: document.getElementById("crm-notifications-create-entity-help"),
    createLeadField: document.getElementById("crm-notifications-create-lead-field"),
    createLeadSearch: document.getElementById("crm-notifications-create-lead-search"),
    createLeadId: document.getElementById("crm-notifications-create-lead-id"),
    createLeadList: document.getElementById("crm-notifications-create-lead-options"),
    createClientField: document.getElementById("crm-notifications-create-client-field"),
    createClientSearch: document.getElementById("crm-notifications-create-client-search"),
    createClientId: document.getElementById("crm-notifications-create-client-id"),
    createClientList: document.getElementById("crm-notifications-create-client-options"),
    createDealField: document.getElementById("crm-notifications-create-deal-field"),
    createDealSearch: document.getElementById("crm-notifications-create-deal-search"),
    createDealId: document.getElementById("crm-notifications-create-deal-id"),
    createDealList: document.getElementById("crm-notifications-create-deal-options"),
    filterForm: document.getElementById("crm-notifications-filter-form"),
    filterClearBtn: document.getElementById("crm-notifications-filter-clear"),
    syncDryBtn: document.getElementById("crm-notifications-sync-dry"),
    syncRunBtn: document.getElementById("crm-notifications-sync-run"),
    summary: document.getElementById("crm-notifications-summary"),
    meta: document.getElementById("crm-notifications-meta"),
    pagePrevBtn: document.getElementById("crm-notifications-page-prev"),
    pageNextBtn: document.getElementById("crm-notifications-page-next"),
    pageLabel: document.getElementById("crm-notifications-page-label"),
    tbody: document.getElementById("crm-notifications-tbody"),
    detail: document.getElementById("crm-notifications-detail"),
    detailClearBtn: document.getElementById("crm-notifications-detail-clear"),
    feedback: document.getElementById("crm-notifications-feedback"),
  };

  const crmLabels = window.crmLabels ?? null;
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const toText = (v) => {
    const t = String(v ?? "").trim();
    return t.length ? t : null;
  };
  const parseJsonSafe = (raw) => {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const dictLabel = (dict, value, fallback = "-") => {
    const t = toText(value);
    return t ? crmLabels?.label?.(dict, t, null) ?? crmLabels?.labelAny?.(t, null) ?? t : fallback;
  };
  const readStorage = (key) => {
    try { return toText(localStorage.getItem(key)); } catch { return null; }
  };
  const writeStorage = (key, value) => {
    try {
      if (toText(value)) localStorage.setItem(key, String(value));
      else localStorage.removeItem(key);
    } catch {}
  };
  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };
  const redirectToLogin = () => {
    const u = new URL("/crm/login/", window.location.origin);
    u.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
    window.location.href = `${u.pathname}${u.search}`;
  };
  const isCrmAuthError = (response, payload) => {
    const code = toText(payload?.error);
    return response.status === 401 || code === "auth_token_required" || code === "refresh_token_required" || code === "invalid_refresh_token" || code === "crm_auth_required";
  };
  const humanizeError = (error) => {
    const raw = error instanceof Error ? error.message : String(error ?? "unknown_error");
    if (raw.includes("notifications_backend_unavailable")) return "Backend de notifications no disponible.";
    if (raw.includes("notifications_schema_incomplete")) return "Schema de notifications incompleto. Falta la capa de orquestacion.";
    if (raw.includes("crm_permission_forbidden") || raw.includes("crm_role_forbidden")) return "No tienes permisos para esta operacion.";
    if (raw.includes("assigned_user_id_required_for_reassign")) return "Debes indicar un assigned_user_id valido para reasignar.";
    return raw;
  };
  const request = async (url, init) => {
    const response = await fetch(url, { credentials: "same-origin", ...init });
    const raw = await response.text();
    const payload = parseJsonSafe(raw);
    if (isCrmAuthError(response, payload)) {
      redirectToLogin();
      throw new Error("Sesion CRM requerida.");
    }
    if (!response.ok || !payload?.ok) {
      const code = toText(payload?.error) || `http_${response.status}`;
      const details = toText(payload?.details) || toText(payload?.message) || (toText(raw) ? raw.slice(0, 250) : null);
      throw new Error(details ? `${code}: ${details}` : code);
    }
    return payload;
  };
  const buildApiUrl = (path, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      const t = toText(v);
      if (t) query.set(k, t);
    });
    return query.toString() ? `${path}?${query.toString()}` : path;
  };
  const formatDateTime = (value) => {
    const t = toText(value);
    if (!t) return "-";
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return t;
    return d.toLocaleString("es-ES", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const toDatetimeLocalValue = (value) => {
    const t = toText(value);
    if (!t) return "";
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  };
  const parseDatetimeLocalToIso = (value) => {
    const t = toText(value);
    if (!t) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const formatDueQuery = (value, boundary) => {
    const t = toText(value);
    return t ? `${t}${boundary === "start" ? "T00:00:00" : "T23:59:59"}` : null;
  };
  const orgLabel = (source) => source === "url" ? "URL" : source === "local" ? "Guardada" : source === "default" ? "Por defecto CRM" : source === "manual" ? "Manual" : "Sin configurar";
  const resolveOrg = () => {
    const q = toText(new URL(window.location.href).searchParams.get("organization_id"));
    const local = readStorage(orgKey);
    const fallback = toText(window.__crmDefaultOrganizationId);
    if (q) return { id: q, source: "url" };
    if (local) return { id: local, source: "local" };
    if (fallback) return { id: fallback, source: "default" };
    return { id: "", source: "none" };
  };
  const updateUrlOrg = () => {
    const url = new URL(window.location.href);
    if (state.organizationId) url.searchParams.set("organization_id", state.organizationId);
    else url.searchParams.delete("organization_id");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };
  const renderOrg = () => {
    if (el.orgInput instanceof HTMLInputElement) el.orgInput.value = state.organizationId;
    if (el.orgSource instanceof HTMLElement) {
      el.orgSource.textContent = orgLabel(state.organizationSource);
      el.orgSource.className = `crm-badge ${state.organizationId ? "ok" : "warn"}`;
    }
    if (el.orgHelp instanceof HTMLElement) {
      el.orgHelp.textContent = state.organizationId ? `Contexto activo: ${state.organizationId}` : "Define organization_id para cargar bandeja, detalle y sync.";
    }
  };
  const ensureOrg = () => {
    if (state.organizationId) return true;
    setFeedback("Debes definir organization_id para continuar.", "error");
    return false;
  };
  const leadLabel = (row) => [toText(row?.full_name) || toText(row?.email) || toText(row?.phone) || "Lead", [toText(row?.status), toText(row?.project_label), toText(row?.email), toText(row?.phone)].filter(Boolean).join(" | ") || null].filter(Boolean).join(" || ");
  const clientLabel = (row) => [toText(row?.full_name) || toText(row?.billing_name) || toText(row?.client_code) || "Cliente", [toText(row?.client_code), toText(row?.client_status), toText(row?.email), toText(row?.phone)].filter(Boolean).join(" | ") || null].filter(Boolean).join(" || ");
  const dealLabel = (row) => [toText(row?.title) || "Deal", [toText(row?.stage), toText(row?.client?.full_name), toText(row?.lead?.full_name), toText(row?.property?.display_name), toText(row?.property?.project_label)].filter(Boolean).join(" | ") || null].filter(Boolean).join(" || ");
  const renderLeadOptions = () => {
    if (el.createLeadList instanceof HTMLDataListElement) {
      el.createLeadList.innerHTML = state.leads.filter((row) => toText(row?.id)).map((row) => `<option value="${esc(leadLabel(row))}"></option>`).join("");
    }
  };
  const renderClientOptions = () => {
    if (el.createClientList instanceof HTMLDataListElement) {
      el.createClientList.innerHTML = state.clients.filter((row) => toText(row?.id)).map((row) => `<option value="${esc(clientLabel(row))}"></option>`).join("");
    }
  };
  const renderDealOptions = () => {
    if (el.createDealList instanceof HTMLDataListElement) {
      el.createDealList.innerHTML = state.deals.filter((row) => toText(row?.id)).map((row) => `<option value="${esc(dealLabel(row))}"></option>`).join("");
    }
  };
  const findLead = () => {
    const row = state.leads.find((entry) => leadLabel(entry) === toText(el.createLeadSearch?.value)) ?? null;
    if (el.createLeadId instanceof HTMLInputElement) el.createLeadId.value = toText(row?.id) || "";
    return row;
  };
  const findClient = () => {
    const row = state.clients.find((entry) => clientLabel(entry) === toText(el.createClientSearch?.value)) ?? null;
    if (el.createClientId instanceof HTMLInputElement) el.createClientId.value = toText(row?.id) || "";
    return row;
  };
  const findDeal = () => {
    const row = state.deals.find((entry) => dealLabel(entry) === toText(el.createDealSearch?.value)) ?? null;
    if (el.createDealId instanceof HTMLInputElement) el.createDealId.value = toText(row?.id) || "";
    return row;
  };
  const clearEntityFields = (keep = "generic") => {
    if (keep !== "lead") {
      if (el.createLeadSearch instanceof HTMLInputElement) el.createLeadSearch.value = "";
      if (el.createLeadId instanceof HTMLInputElement) el.createLeadId.value = "";
    }
    if (keep !== "client") {
      if (el.createClientSearch instanceof HTMLInputElement) el.createClientSearch.value = "";
      if (el.createClientId instanceof HTMLInputElement) el.createClientId.value = "";
    }
    if (keep !== "deal") {
      if (el.createDealSearch instanceof HTMLInputElement) el.createDealSearch.value = "";
      if (el.createDealId instanceof HTMLInputElement) el.createDealId.value = "";
    }
  };
  const syncEntityUi = () => {
    const type = toText(el.createEntityType?.value) || "generic";
    if (el.createLeadField instanceof HTMLElement) el.createLeadField.hidden = type !== "lead";
    if (el.createClientField instanceof HTMLElement) el.createClientField.hidden = type !== "client";
    if (el.createDealField instanceof HTMLElement) el.createDealField.hidden = type !== "deal";
    if (el.createEntityTypeApi instanceof HTMLInputElement) {
      el.createEntityTypeApi.value = type === "lead" || type === "client" || type === "deal" ? type : "generic";
    }
    if (el.createEntityHelp instanceof HTMLElement) {
      el.createEntityHelp.textContent = type === "lead" ? "Relaciona la notificacion con un lead concreto." : type === "client" ? "Relaciona la notificacion con un cliente concreto." : type === "deal" ? "Relaciona la notificacion con un deal concreto." : "Notificacion manual generica sin entidad ligada.";
    }
    clearEntityFields(type);
  };
  const loadEntityOptions = async () => {
    if (!ensureOrg()) {
      state.leads = [];
      state.clients = [];
      state.deals = [];
      renderLeadOptions();
      renderClientOptions();
      renderDealOptions();
      return;
    }
    const [leadsPayload, clientsPayload, dealsPayload] = await Promise.all([
      request(buildApiUrl("/api/v1/crm/leads", { organization_id: state.organizationId, per_page: "200" })),
      request(buildApiUrl("/api/v1/clients", { organization_id: state.organizationId, per_page: "200" })),
      request(buildApiUrl("/api/v1/crm/deals", { organization_id: state.organizationId, per_page: "200", only_open: "1" })),
    ]);
    state.leads = Array.isArray(leadsPayload?.data) ? leadsPayload.data : [];
    state.clients = Array.isArray(clientsPayload?.data) ? clientsPayload.data : [];
    state.deals = Array.isArray(dealsPayload?.data) ? dealsPayload.data : [];
    renderLeadOptions();
    renderClientOptions();
    renderDealOptions();
  };
  const entityLink = (entry) => {
    const suffix = state.organizationId ? `?organization_id=${encodeURIComponent(state.organizationId)}` : "";
    const entityType = toText(entry.entity_type);
    const leadId = toText(entry.lead_id);
    const dealId = toText(entry.deal_id);
    const clientId = toText(entry.client_id);
    const reservationId = toText(entry.reservation_id);
    if (entityType === "lead" && leadId) return { href: `/crm/leads/${encodeURIComponent(leadId)}${suffix}`, label: "Lead" };
    if (entityType === "deal" && dealId) return { href: `/crm/deals/${encodeURIComponent(dealId)}${suffix}`, label: "Deal" };
    if (entityType === "client" && clientId) return { href: `/crm/clients/${encodeURIComponent(clientId)}${suffix}`, label: "Cliente" };
    if (entityType === "reservation" && clientId) return { href: `/crm/clients/${encodeURIComponent(clientId)}${suffix}`, label: reservationId ? `Reserva ${reservationId}` : "Cliente" };
    if (leadId) return { href: `/crm/leads/${encodeURIComponent(leadId)}${suffix}`, label: "Lead" };
    if (dealId) return { href: `/crm/deals/${encodeURIComponent(dealId)}${suffix}`, label: "Deal" };
    if (clientId) return { href: `/crm/clients/${encodeURIComponent(clientId)}${suffix}`, label: "Cliente" };
    return null;
  };
  const renderSummary = () => {
    if (el.summary instanceof HTMLElement) {
      el.summary.textContent = `Pendientes ${state.pendingCount} | Programadas ${state.scheduledCount} | Vencidas ${state.overdueCount}`;
    }
    if (el.meta instanceof HTMLElement) {
      el.meta.textContent = `${state.rows.length} filas visibles | pagina ${state.page} | ${state.hasNextPage ? "hay mas resultados" : "fin de resultados"}`;
    }
    if (el.pageLabel instanceof HTMLElement) el.pageLabel.textContent = `Pagina ${state.page}`;
    if (el.pagePrevBtn instanceof HTMLButtonElement) el.pagePrevBtn.disabled = state.page <= 1;
    if (el.pageNextBtn instanceof HTMLButtonElement) el.pageNextBtn.disabled = state.hasNextPage !== true;
  };
  const renderDetailPlaceholder = (message = "Selecciona una alerta para ver body, metadata y contexto completo.") => {
    if (el.detail instanceof HTMLElement) el.detail.innerHTML = `<p class="crm-inline-note">${esc(message)}</p>`;
  };
  const renderDetail = (entry) => {
    if (!(el.detail instanceof HTMLElement)) return;
    if (!entry) return renderDetailPlaceholder();
    const entity = entityLink(entry);
    const metadata = entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {};
    const metadataRows = Object.entries(metadata);
    el.detail.innerHTML = `<div style="display:grid;gap:1rem"><div><p class="crm-context-eyebrow">Notificacion</p><h4 style="margin:0.25rem 0 0.35rem">${esc(toText(entry.title) || "Sin titulo")}</h4><p class="crm-inline-note">${esc(toText(entry.body) || "Sin body registrado.")}</p></div><div class="crm-grid"><article class="crm-card"><small class="crm-inline-note">Prioridad</small><strong>${esc(dictLabel("notification-priority", entry.priority))}</strong></article><article class="crm-card"><small class="crm-inline-note">Estado</small><strong>${esc(dictLabel("notification-status", entry.status))}</strong></article><article class="crm-card"><small class="crm-inline-note">Entidad</small><strong>${esc(toText(entry.entity_type) || "generic")}</strong></article><article class="crm-card"><small class="crm-inline-note">Vence</small><strong>${esc(formatDateTime(entry.due_at))}</strong></article></div><div><strong>Relacion</strong><br />${entity ? `<a class="crm-link" href="${esc(entity.href)}">Abrir ${esc(entity.label)}</a>` : `<span class="crm-inline-note">Sin entidad enlazada</span>`}</div><div><strong>Metadata</strong>${metadataRows.length ? `<div style="margin-top:0.6rem;display:grid;gap:0.45rem">${metadataRows.map(([key, value]) => `<div style="padding:0.7rem 0.8rem;border:1px solid rgba(20,50,77,0.08);border-radius:12px"><strong>${esc(key)}</strong><br /><small>${esc(typeof value === "string" ? value : JSON.stringify(value))}</small></div>`).join("")}</div>` : `<p class="crm-inline-note" style="margin-top:0.5rem">Sin metadata relevante.</p>`}</div>${toText(entry.resolution_note) ? `<div><strong>Nota de resolucion</strong><p class="crm-inline-note">${esc(entry.resolution_note)}</p></div>` : ""}</div>`;
  };
  const renderRows = () => {
    if (!(el.tbody instanceof HTMLElement)) return;
    if (!state.rows.length) {
      el.tbody.innerHTML = '<tr><td colspan="6">No hay notificaciones para el filtro actual.</td></tr>';
      return;
    }
    el.tbody.innerHTML = state.rows.map((entry) => {
      const id = toText(entry.id) || "";
      const status = toText(entry.status) || "pending";
      const sourceType = toText(entry.source_type) || "manual";
      const entityType = toText(entry.entity_type) || "generic";
      const entity = entityLink(entry);
      const assignment = [toText(entry.assignee_email), toText(entry.assigned_user_id), toText(entry.manager_user_id)].filter(Boolean).join(" | ");
      const actions = [];
      if (status === "pending" || status === "scheduled") {
        actions.push(`<button type="button" class="crm-mini-btn" data-action="acknowledge" data-id="${esc(id)}">Ack</button>`);
        actions.push(`<button type="button" class="crm-mini-btn" data-action="snooze_24h" data-id="${esc(id)}">+24h</button>`);
        actions.push(`<button type="button" class="crm-mini-btn" data-action="snooze_72h" data-id="${esc(id)}">+72h</button>`);
        actions.push(`<button type="button" class="crm-mini-btn" data-action="mark_done" data-id="${esc(id)}">Done</button>`);
      }
      if (status !== "cancelled") actions.push(`<button type="button" class="crm-mini-btn danger" data-action="cancel" data-id="${esc(id)}">Cancelar</button>`);
      if (["done", "cancelled", "failed", "sent"].includes(status)) actions.push(`<button type="button" class="crm-mini-btn" data-action="reopen" data-id="${esc(id)}">Reabrir</button>`);
      actions.push(`<button type="button" class="crm-mini-btn" data-action="open-detail" data-id="${esc(id)}">Abrir detalle</button>`);
      actions.push(`<button type="button" class="crm-mini-btn" data-action="reassign" data-id="${esc(id)}">Reasignar</button>`);
      return `<tr><td data-label="Creada / vence"><div><strong>${esc(formatDateTime(entry.created_at))}</strong></div><small>${esc(formatDateTime(entry.due_at))}</small></td><td data-label="Prioridad"><div><span class="crm-badge ${esc(toText(entry.priority) === "urgent" ? "danger" : toText(entry.priority) === "high" ? "warn" : "ok")}">${esc(dictLabel("notification-priority", entry.priority))}</span></div><small>${esc(sourceType)} | ${esc(entityType)}</small></td><td data-label="Titulo / entidad"><div><strong>${esc(toText(entry.title) || "Sin titulo")}</strong></div><small>${esc(toText(entry.rule_key) || "-")} | ${esc(entityType)}</small><div style="margin-top:0.35rem">${entity ? `<a class="crm-link" href="${esc(entity.href)}">Abrir ${esc(entity.label)}</a>` : `<span class="crm-inline-note">Sin entidad ligada</span>`}</div></td><td data-label="Asignacion"><div>${esc(assignment || "Cola equipo")}</div><small>${esc(toText(entry.rule_key) || "manual")}</small></td><td data-label="Estado"><span class="crm-badge ${esc(status === "done" ? "ok" : status === "cancelled" || status === "failed" ? "danger" : "warn")}">${esc(dictLabel("notification-status", status))}</span></td><td data-label="Acciones"><div class="crm-actions-row">${actions.join(" ")}</div></td></tr>`;
    }).join("");
  };
  const readFilters = () => {
    if (!(el.filterForm instanceof HTMLFormElement)) return { per_page: "25" };
    const fd = new FormData(el.filterForm);
    return {
      view: toText(fd.get("view")),
      status: toText(fd.get("status")),
      source_type: toText(fd.get("source_type")),
      entity_type: toText(fd.get("entity_type")),
      priority: toText(fd.get("priority")),
      q: toText(fd.get("q")),
      due_from: formatDueQuery(fd.get("due_from"), "start"),
      due_to: formatDueQuery(fd.get("due_to"), "end"),
      per_page: toText(fd.get("per_page")) || "25",
    };
  };
  const loadNotifications = async ({ page = 1 } = {}) => {
    if (!ensureOrg()) return;
    const filters = readFilters();
    state.perPage = Number(filters.per_page) || 25;
    const payload = await request(buildApiUrl("/api/v1/crm/notifications", { organization_id: state.organizationId, page: String(page), per_page: String(state.perPage), view: filters.view, status: filters.status, source_type: filters.source_type, entity_type: filters.entity_type, priority: filters.priority, q: filters.q, due_from: filters.due_from, due_to: filters.due_to }));
    const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
    state.rows = Array.isArray(payload?.data) ? payload.data : [];
    state.page = Number(meta.page || page) || 1;
    state.hasNextPage = meta.has_next_page === true;
    state.pendingCount = Number(meta.pending_count_page || 0) || 0;
    state.scheduledCount = Number(meta.scheduled_count_page || 0) || 0;
    state.overdueCount = Number(meta.overdue_count_page || 0) || 0;
    renderSummary();
    renderRows();
  };
  const loadDetail = async (id) => {
    const payload = await request(buildApiUrl(`/api/v1/crm/notifications/${encodeURIComponent(id)}`, { organization_id: state.organizationId }));
    renderDetail(payload?.data || null);
  };
  const resolveEntityPayload = () => {
    const type = toText(el.createEntityType?.value) || "generic";
    if (type === "lead") {
      const row = findLead();
      if (!toText(row?.id)) throw new Error("Selecciona un lead valido de la lista guiada.");
      return { entity_type: "lead", lead_id: toText(row.id), client_id: null, deal_id: null, recipient_email: toText(row.email), recipient_phone: toText(row.phone) };
    }
    if (type === "client") {
      const row = findClient();
      if (!toText(row?.id)) throw new Error("Selecciona un cliente valido de la lista guiada.");
      return { entity_type: "client", lead_id: null, client_id: toText(row.id), deal_id: null, recipient_email: toText(row.email), recipient_phone: toText(row.phone) };
    }
    if (type === "deal") {
      const row = findDeal();
      if (!toText(row?.id)) throw new Error("Selecciona un deal valido de la lista guiada.");
      return { entity_type: "deal", lead_id: null, client_id: null, deal_id: toText(row.id), recipient_email: toText(row?.client?.email) || toText(row?.lead?.email), recipient_phone: toText(row?.client?.phone) || toText(row?.lead?.phone) };
    }
    return { entity_type: "generic", lead_id: null, client_id: null, deal_id: null, recipient_email: null, recipient_phone: null };
  };
  const createNotification = async (fd) => {
    const entity = resolveEntityPayload();
    await request("/api/v1/crm/notifications", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ organization_id: state.organizationId, title: toText(fd.get("title")), notification_type: toText(fd.get("notification_type")), channel: toText(fd.get("channel")), priority: toText(fd.get("priority")), recipient_email: toText(fd.get("recipient_email")) || entity.recipient_email, recipient_phone: toText(fd.get("recipient_phone")) || entity.recipient_phone, lead_id: entity.lead_id, client_id: entity.client_id, deal_id: entity.deal_id, entity_type: entity.entity_type, due_at: parseDatetimeLocalToIso(fd.get("due_at")), body: toText(fd.get("body")) }) });
  };
  const patchNotification = async (id, action, extra = {}) => request("/api/v1/crm/notifications", { method: "PATCH", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ organization_id: state.organizationId, id, action, ...extra }) });
  const cancelNotification = async (id) => request("/api/v1/crm/notifications", { method: "DELETE", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ organization_id: state.organizationId, id }) });
  const runSync = async (dryRun) => {
    const payload = await request("/api/v1/crm/notifications/sync", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ organization_id: state.organizationId, scope: "all", dry_run: dryRun }) });
    const data = payload?.data || {};
    return `Sync ${dryRun ? "dry-run" : "real"}: create ${data.created ?? 0}, update ${data.updated ?? 0}, resolve ${data.resolved ?? 0}, unchanged ${data.unchanged ?? 0}`;
  };
  const resetCreateForm = () => {
    if (!(el.createForm instanceof HTMLFormElement)) return;
    el.createForm.reset();
    syncEntityUi();
    const dueInput = el.createForm.elements.namedItem("due_at");
    if (dueInput instanceof HTMLInputElement) dueInput.value = toDatetimeLocalValue(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  };
  const bindEvents = () => {
    el.createEntityType?.addEventListener("change", () => syncEntityUi());
    el.createLeadSearch?.addEventListener("change", () => findLead());
    el.createClientSearch?.addEventListener("change", () => findClient());
    el.createDealSearch?.addEventListener("change", () => findDeal());
    el.orgForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(el.orgForm);
      state.organizationId = toText(fd.get("organization_id")) || "";
      state.organizationSource = state.organizationId ? "manual" : "none";
      writeStorage(orgKey, state.organizationId);
      updateUrlOrg();
      renderOrg();
      if (!state.organizationId) {
        state.rows = [];
        renderSummary();
        renderRows();
        renderDetailPlaceholder();
        setFeedback("Define organization_id para continuar.", "error");
        return;
      }
      try {
        setFeedback("Actualizando contexto operativo...");
        await Promise.all([loadEntityOptions(), loadNotifications({ page: 1 })]);
        renderDetailPlaceholder();
        setFeedback("Contexto actualizado.");
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      }
    });
    el.createForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ensureOrg()) return;
      try {
        setFeedback("Creando notificacion...");
        await createNotification(new FormData(el.createForm));
        resetCreateForm();
        await loadNotifications({ page: 1 });
        setFeedback("Notificacion creada.");
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      }
    });
    el.filterForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ensureOrg()) return;
      const viewInput = el.filterForm.elements.namedItem("view");
      if (viewInput instanceof HTMLSelectElement) writeStorage(viewKey, viewInput.value);
      try {
        setFeedback("Aplicando filtros...");
        await loadNotifications({ page: 1 });
        setFeedback("Filtros aplicados.");
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      }
    });
    el.filterClearBtn?.addEventListener("click", async () => {
      if (!(el.filterForm instanceof HTMLFormElement)) return;
      el.filterForm.reset();
      const viewInput = el.filterForm.elements.namedItem("view");
      if (viewInput instanceof HTMLSelectElement) viewInput.value = readStorage(viewKey) || "mine";
      try {
        setFeedback("Limpiando filtros...");
        await loadNotifications({ page: 1 });
        setFeedback("Filtros reiniciados.");
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      }
    });
    el.pagePrevBtn?.addEventListener("click", async () => {
      if (state.page <= 1) return;
      try {
        setFeedback("Cargando pagina anterior...");
        await loadNotifications({ page: state.page - 1 });
        setFeedback("Pagina cargada.");
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      }
    });
    el.pageNextBtn?.addEventListener("click", async () => {
      if (!state.hasNextPage) return;
      try {
        setFeedback("Cargando pagina siguiente...");
        await loadNotifications({ page: state.page + 1 });
        setFeedback("Pagina cargada.");
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      }
    });
    el.syncDryBtn?.addEventListener("click", async () => {
      if (!ensureOrg()) return;
      try {
        setFeedback("Ejecutando dry-run...");
        setFeedback(await runSync(true));
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      }
    });
    el.syncRunBtn?.addEventListener("click", async () => {
      if (!ensureOrg()) return;
      try {
        setFeedback("Ejecutando sync real...");
        const message = await runSync(false);
        await loadNotifications({ page: 1 });
        renderDetailPlaceholder();
        setFeedback(message);
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      }
    });
    el.tbody?.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button[data-action][data-id]");
      if (!(button instanceof HTMLButtonElement)) return;
      const id = toText(button.dataset.id);
      const action = toText(button.dataset.action);
      if (!id || !action) return;
      button.disabled = true;
      try {
        if (action === "cancel") await cancelNotification(id);
        else if (action === "open-detail") {
          await loadDetail(id);
          setFeedback("Detalle cargado.");
          return;
        } else if (action === "reassign") {
          const assignedUserId = window.prompt("Nuevo assigned_user_id para la notificacion:");
          if (!toText(assignedUserId)) return;
          await patchNotification(id, "reassign", { assigned_user_id: assignedUserId });
        } else {
          await patchNotification(id, action);
        }
        await loadNotifications({ page: state.page });
        setFeedback("Notificacion actualizada.");
      } catch (error) {
        setFeedback(humanizeError(error), "error");
      } finally {
        button.disabled = false;
      }
    });
    el.detailClearBtn?.addEventListener("click", () => renderDetailPlaceholder());
  };
  const boot = async () => {
    const ctx = resolveOrg();
    state.organizationId = ctx.id;
    state.organizationSource = ctx.source;
    renderOrg();
    crmLabels?.applySelectDictionaries?.(root);
    if (el.filterForm instanceof HTMLFormElement) {
      const viewInput = el.filterForm.elements.namedItem("view");
      if (viewInput instanceof HTMLSelectElement) viewInput.value = readStorage(viewKey) || "mine";
    }
    bindEvents();
    resetCreateForm();
    renderSummary();
    renderRows();
    renderDetailPlaceholder();
    if (!state.organizationId) {
      setFeedback("Define organization_id para empezar.", "error");
      return;
    }
    try {
      setFeedback("Cargando centro de notificaciones...");
      await Promise.all([loadEntityOptions(), loadNotifications({ page: 1 })]);
      setFeedback("Centro de notificaciones listo.");
    } catch (error) {
      setFeedback(humanizeError(error), "error");
    }
  };
  boot();
})();
