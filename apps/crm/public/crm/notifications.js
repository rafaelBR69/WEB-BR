(() => {
  const root = document.querySelector("[data-crm-notifications='true']");
  if (!(root instanceof HTMLElement)) return;

  const PORTAL_SESSION_KEY = "portal.session.v1";

  const state = {
    organizationId: "",
    organizationSource: "none",
    rows: [],
    page: 1,
    perPage: 25,
    total: 0,
    totalPages: 1,
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
    filterForm: document.getElementById("crm-notifications-filter-form"),
    filterClearBtn: document.getElementById("crm-notifications-filter-clear"),
    summary: document.getElementById("crm-notifications-summary"),
    meta: document.getElementById("crm-notifications-meta"),
    tbody: document.getElementById("crm-notifications-tbody"),
    feedback: document.getElementById("crm-notifications-feedback"),
  };

  const toText = (value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  };

  const asObject = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
  };

  const crmLabels = window.crmLabels ?? null;
  const dictLabel = (dictionary, value, fallback = "-") => {
    const normalizedValue = toText(value);
    if (!normalizedValue) return fallback;
    return (
      crmLabels?.label?.(dictionary, normalizedValue, null) ??
      crmLabels?.labelAny?.(normalizedValue, null) ??
      normalizedValue
    );
  };

  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const parseJsonSafe = (raw) => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const readPortalSessionFromStorage = (storage) => {
    try {
      const raw = storage.getItem(PORTAL_SESSION_KEY);
      const parsed = parseJsonSafe(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const loadPortalSession = () =>
    readPortalSessionFromStorage(window.localStorage) ?? readPortalSessionFromStorage(window.sessionStorage);

  const buildPortalAuthHeaders = () => {
    const session = loadPortalSession();
    const accessToken = toText(session?.accessToken ?? session?.access_token);
    if (!accessToken) return null;

    const tokenType = toText(session?.tokenType ?? session?.token_type) ?? "bearer";
    const portalAccountId = toText(session?.portalAccountId ?? session?.portal_account_id);
    const organizationId =
      toText(session?.organizationId ?? session?.organization_id) ??
      toText(session?.portalAccount?.organization_id);

    return {
      Authorization: `${tokenType} ${accessToken}`.trim(),
      ...(portalAccountId ? { "X-Portal-Account-Id": portalAccountId } : {}),
      ...(organizationId ? { "X-Portal-Organization-Id": organizationId } : {}),
    };
  };

  const requestAdmin = async (url, init = {}) => {
    const session = loadPortalSession();
    const role = toText(session?.role ?? session?.portalAccount?.role);
    const headers = buildPortalAuthHeaders();
    if (!headers?.Authorization) {
      const error = new Error(
        "Inicia sesion en /es/portal/login con una cuenta admin para operar notificaciones."
      );
      error.code = "portal_admin_session_required";
      throw error;
    }
    if (role && role !== "portal_agent_admin") {
      const error = new Error("La sesion portal activa no tiene rol portal_agent_admin.");
      error.code = "portal_admin_role_required";
      throw error;
    }
    return request(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...headers,
      },
    });
  };

  const isAdminAuthErrorCode = (code) => {
    const normalized = toText(code) || "";
    return (
      normalized === "portal_admin_session_required" ||
      normalized === "portal_admin_role_required" ||
      normalized === "crm_notifications_admin_only" ||
      normalized === "crm_notifications_email_not_allowed" ||
      normalized === "auth_token_required" ||
      normalized === "invalid_auth_token" ||
      normalized === "portal_account_not_found" ||
      normalized === "portal_account_not_found_for_auth_user" ||
      normalized === "portal_account_not_active"
    );
  };

  const request = async (url, init) => {
    const response = await fetch(url, init);
    const raw = await response.text();
    const payload = parseJsonSafe(raw);
    if (!response.ok || !payload?.ok) {
      const code = toText(payload?.error) || `http_${response.status}`;
      const details =
        toText(payload?.details) ?? toText(payload?.message) ?? (toText(raw) ? String(raw).slice(0, 220) : null);
      const error = new Error(details ? `${code}: ${details}` : code);
      error.code = code;
      throw error;
    }
    return payload;
  };

  const buildApiUrl = (path, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value == null) return;
      const text = toText(value);
      if (text) query.set(key, text);
    });
    const queryText = query.toString();
    return queryText ? `${path}?${queryText}` : path;
  };

  const statusClass = (value) => {
    const status = toText(value) || "";
    if (status === "sent" || status === "done") return "ok";
    if (status === "cancelled" || status === "failed") return "danger";
    return "warn";
  };

  const statusLabel = (value) => {
    return dictLabel("notification-status", value, "-");
  };

  const priorityLabel = (value) => {
    return dictLabel("notification-priority", value, "-");
  };

  const typeLabel = (value) => {
    return dictLabel("notification-type", value, "-");
  };

  const channelLabel = (value) => {
    return dictLabel("notification-channel", value, "-");
  };

  const formatDateTime = (value) => {
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

  const toDatetimeLocalValue = (value) => {
    const text = toText(value);
    if (!text) return "";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "";
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  };

  const parseDatetimeLocalToIso = (value) => {
    const text = toText(value);
    if (!text) return null;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };

  const formatDueDateQuery = (value, boundary) => {
    const text = toText(value);
    if (!text) return null;
    if (boundary === "start") return `${text}T00:00:00`;
    return `${text}T23:59:59`;
  };

  const buildDestinationLabel = (entry) => {
    const recipientEmail = toText(entry.recipient_email);
    const recipientPhone = toText(entry.recipient_phone);
    const assigneeEmail = toText(entry.assignee_email);
    const parts = [];
    if (recipientEmail) parts.push(recipientEmail);
    if (recipientPhone) parts.push(recipientPhone);
    if (!parts.length && assigneeEmail) parts.push(`Interno: ${assigneeEmail}`);
    return parts.length ? parts.join(" | ") : "-";
  };

  const buildContactLinks = (entry) => {
    const recipientEmail = toText(entry.recipient_email);
    const recipientPhone = toText(entry.recipient_phone);
    const title = toText(entry.title) || "Notificacion CRM";
    const body = toText(entry.body) || "";

    const links = [];
    if (recipientEmail) {
      const mailto = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      links.push(`<a class="crm-mini-btn" href="${esc(mailto)}" target="_blank" rel="noopener">Email</a>`);
    }
    if (recipientPhone) {
      const message = [title, "", body].filter((item) => toText(item)).join("\n");
      const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
      links.push(`<a class="crm-mini-btn" href="${esc(waUrl)}" target="_blank" rel="noopener">WhatsApp</a>`);
    }
    return links.join(" ");
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
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

  const persistOrganization = () => {
    if (state.organizationId) window.localStorage.setItem("crm.organization_id", state.organizationId);
    else window.localStorage.removeItem("crm.organization_id");
  };

  const updateUrlOrganization = () => {
    const url = new URL(window.location.href);
    if (state.organizationId) url.searchParams.set("organization_id", state.organizationId);
    else url.searchParams.delete("organization_id");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };

  const renderOrganizationContext = () => {
    if (el.orgInput instanceof HTMLInputElement) el.orgInput.value = state.organizationId;
    if (el.orgSource instanceof HTMLElement) {
      el.orgSource.textContent = `Origen: ${organizationSourceLabel(state.organizationSource)}`;
      el.orgSource.className = `crm-badge ${state.organizationId ? "ok" : "warn"}`;
    }
    if (el.orgHelp instanceof HTMLElement) {
      el.orgHelp.textContent = state.organizationId
        ? `Contexto activo: ${state.organizationId}`
        : "Define organization_id para cargar notificaciones.";
    }
  };

  const ensureOrganization = () => {
    if (state.organizationId) return true;
    setFeedback("Debes definir organization_id para continuar.", "error");
    return false;
  };

  const renderSummary = () => {
    if (el.summary instanceof HTMLElement) {
      el.summary.textContent = `Pendientes ${state.pendingCount} | Programadas ${state.scheduledCount} | Vencidas ${state.overdueCount}`;
    }
    if (el.meta instanceof HTMLElement) {
      el.meta.textContent = `${state.rows.length} filas visibles | total ${state.total} | pagina ${state.page}/${state.totalPages}`;
    }
  };

  const renderRows = () => {
    if (!(el.tbody instanceof HTMLElement)) return;
    if (!state.rows.length) {
      el.tbody.innerHTML = '<tr><td colspan="7">No hay notificaciones para el filtro actual.</td></tr>';
      return;
    }

    el.tbody.innerHTML = state.rows
      .map((entry) => {
        const row = asObject(entry);
        const id = toText(row.id) || "";
        const status = toText(row.status) || "pending";
        const dueAt = formatDateTime(row.due_at);
        const createdAt = formatDateTime(row.created_at);
        const typeAndChannel = `${typeLabel(row.notification_type)} / ${channelLabel(row.channel)}`;
        const title = toText(row.title) || "Sin titulo";
        const destination = buildDestinationLabel(row);
        const priority = priorityLabel(row.priority);
        const followUpId = toText(row.lead_id);
        const projectId = toText(row.project_property_id);

        const actionButtons = [];
        if (status === "pending" || status === "scheduled") {
          actionButtons.push(
            `<button type="button" class="crm-mini-btn" data-action="mark-sent" data-id="${esc(id)}">Marcar enviada</button>`
          );
          actionButtons.push(
            `<button type="button" class="crm-mini-btn" data-action="snooze-24h" data-id="${esc(id)}">Posponer 24h</button>`
          );
        }
        if (status !== "done" && status !== "cancelled") {
          actionButtons.push(
            `<button type="button" class="crm-mini-btn" data-action="mark-done" data-id="${esc(id)}">Completar</button>`
          );
        }
        if (status === "done" || status === "cancelled" || status === "failed" || status === "sent") {
          actionButtons.push(
            `<button type="button" class="crm-mini-btn" data-action="reopen" data-id="${esc(id)}">Reabrir</button>`
          );
        }
        if (status !== "cancelled") {
          actionButtons.push(
            `<button type="button" class="crm-mini-btn danger" data-action="cancel" data-id="${esc(id)}">Cancelar</button>`
          );
        }

        const links = buildContactLinks(row);
        const metadataSummary = [followUpId ? `Lead ${followUpId}` : null, projectId ? `Promo ${projectId}` : null]
          .filter((item) => toText(item))
          .join(" | ");

        return `
          <tr>
            <td data-label="Creada">${esc(createdAt)}</td>
            <td data-label="Tipo / Canal">
              <div><strong>${esc(typeAndChannel)}</strong></div>
              <small>${esc(priority)}</small>
            </td>
            <td data-label="Titulo">
              <div><strong>${esc(title)}</strong></div>
              <small>${esc(metadataSummary || "-")}</small>
            </td>
            <td data-label="Destino">${esc(destination)}</td>
            <td data-label="Vence">${esc(dueAt)}</td>
            <td data-label="Estado">
              <span class="crm-badge ${statusClass(status)}">${esc(statusLabel(status))}</span>
            </td>
            <td data-label="Acciones">
              <div class="crm-actions-row">
                ${actionButtons.join(" ")}
                ${links}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  };

  const readFilters = () => {
    if (!(el.filterForm instanceof HTMLFormElement)) {
      return {
        status: null,
        notification_type: null,
        channel: null,
        q: null,
        due_from: null,
        due_to: null,
        per_page: "25",
      };
    }

    const formData = new FormData(el.filterForm);
    return {
      status: toText(formData.get("status")),
      notification_type: toText(formData.get("notification_type")),
      channel: toText(formData.get("channel")),
      q: toText(formData.get("q")),
      due_from: formatDueDateQuery(formData.get("due_from"), "start"),
      due_to: formatDueDateQuery(formData.get("due_to"), "end"),
      per_page: toText(formData.get("per_page")) || "25",
    };
  };

  const loadNotifications = async ({ page = 1 } = {}) => {
    if (!ensureOrganization()) return;
    const filters = readFilters();
    state.perPage = Number(filters.per_page) || 25;

    const params = {
      organization_id: state.organizationId,
      page: String(page),
      per_page: String(state.perPage),
      status: filters.status,
      notification_type: filters.notification_type,
      channel: filters.channel,
      q: filters.q,
      due_from: filters.due_from,
      due_to: filters.due_to,
    };

    const payload = await requestAdmin(buildApiUrl("/api/v1/crm/notifications", params));
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const meta = asObject(payload?.meta);

    state.rows = rows;
    state.page = Number(meta.page || page) || 1;
    state.total = Number(meta.total || rows.length) || rows.length;
    state.totalPages = Number(meta.total_pages || 1) || 1;
    state.pendingCount = Number(meta.pending_count || 0) || 0;
    state.scheduledCount = Number(meta.scheduled_count || 0) || 0;
    state.overdueCount = Number(meta.overdue_count || 0) || 0;

    renderSummary();
    renderRows();
  };

  const createNotification = async (formData) => {
    const title = toText(formData.get("title"));
    if (!title) {
      setFeedback("El titulo es obligatorio.", "error");
      return;
    }

    const payload = {
      organization_id: state.organizationId,
      title,
      notification_type: toText(formData.get("notification_type")),
      channel: toText(formData.get("channel")),
      priority: toText(formData.get("priority")),
      recipient_email: toText(formData.get("recipient_email")),
      recipient_phone: toText(formData.get("recipient_phone")),
      lead_id: toText(formData.get("lead_id")),
      project_property_id: toText(formData.get("project_property_id")),
      due_at: parseDatetimeLocalToIso(formData.get("due_at")),
      body: toText(formData.get("body")),
    };

    await requestAdmin("/api/v1/crm/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
  };

  const patchNotification = async (id, action) => {
    await requestAdmin("/api/v1/crm/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        id,
        action,
      }),
    });
  };

  const cancelNotification = async (id) => {
    await requestAdmin("/api/v1/crm/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        id,
      }),
    });
  };

  const resetCreateForm = () => {
    if (!(el.createForm instanceof HTMLFormElement)) return;
    el.createForm.reset();
  };

  const bindEvents = () => {
    if (el.orgForm instanceof HTMLFormElement) {
      el.orgForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(el.orgForm);
        const manualValue = toText(formData.get("organization_id")) || "";
        state.organizationId = manualValue;
        state.organizationSource = manualValue ? "manual" : "none";
        persistOrganization();
        updateUrlOrganization();
        renderOrganizationContext();

        if (!state.organizationId) {
          state.rows = [];
          renderSummary();
          renderRows();
          setFeedback("Define organization_id para continuar.", "error");
          return;
        }

        try {
          setFeedback("Cargando notificaciones...");
          await loadNotifications({ page: 1 });
          setFeedback("Contexto actualizado.");
        } catch (error) {
          const code = toText(error?.code);
          const details = toText(error?.message) || "No se pudo cargar la bandeja.";
          if (isAdminAuthErrorCode(code)) {
            setFeedback(`Acceso admin requerido: ${details}`, "error");
            return;
          }
          setFeedback(details, "error");
        }
      });
    }

    if (el.createForm instanceof HTMLFormElement) {
      el.createForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!ensureOrganization()) return;
        const formData = new FormData(el.createForm);

        try {
          setFeedback("Creando notificacion...");
          await createNotification(formData);
          resetCreateForm();
          await loadNotifications({ page: 1 });
          setFeedback("Notificacion creada correctamente.");
        } catch (error) {
          const code = toText(error?.code);
          const details = toText(error?.message) || "No se pudo crear la notificacion.";
          if (isAdminAuthErrorCode(code)) {
            setFeedback(`Acceso admin requerido: ${details}`, "error");
            return;
          }
          setFeedback(details, "error");
        }
      });
    }

    if (el.filterForm instanceof HTMLFormElement) {
      el.filterForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!ensureOrganization()) return;
        try {
          setFeedback("Aplicando filtros...");
          await loadNotifications({ page: 1 });
          setFeedback("Filtros aplicados.");
        } catch (error) {
          const code = toText(error?.code);
          const details = toText(error?.message) || "No se pudo filtrar la bandeja.";
          if (isAdminAuthErrorCode(code)) {
            setFeedback(`Acceso admin requerido: ${details}`, "error");
            return;
          }
          setFeedback(details, "error");
        }
      });
    }

    if (el.filterClearBtn instanceof HTMLButtonElement && el.filterForm instanceof HTMLFormElement) {
      el.filterClearBtn.addEventListener("click", async () => {
        el.filterForm.reset();
        try {
          setFeedback("Limpiando filtros...");
          await loadNotifications({ page: 1 });
          setFeedback("Filtros reiniciados.");
        } catch (error) {
          const code = toText(error?.code);
          const details = toText(error?.message) || "No se pudo recargar la bandeja.";
          if (isAdminAuthErrorCode(code)) {
            setFeedback(`Acceso admin requerido: ${details}`, "error");
            return;
          }
          setFeedback(details, "error");
        }
      });
    }

    if (el.tbody instanceof HTMLElement) {
      el.tbody.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("button[data-action][data-id]");
        if (!(button instanceof HTMLButtonElement)) return;

        const action = toText(button.dataset.action);
        const id = toText(button.dataset.id);
        if (!action || !id) return;

        button.disabled = true;
        try {
          if (action === "cancel") {
            setFeedback("Cancelando notificacion...");
            await cancelNotification(id);
            setFeedback("Notificacion cancelada.");
          } else {
            const actionMap = {
              "mark-sent": "mark_sent",
              "mark-done": "mark_done",
              "snooze-24h": "snooze_24h",
              reopen: "reopen",
            };
            const apiAction = actionMap[action];
            if (!apiAction) {
              button.disabled = false;
              return;
            }
            setFeedback("Actualizando notificacion...");
            await patchNotification(id, apiAction);
            setFeedback("Notificacion actualizada.");
          }
          await loadNotifications({ page: state.page });
        } catch (error) {
          const code = toText(error?.code);
          const details = toText(error?.message) || "No se pudo actualizar la notificacion.";
          if (isAdminAuthErrorCode(code)) {
            setFeedback(`Acceso admin requerido: ${details}`, "error");
          } else {
            setFeedback(details, "error");
          }
        } finally {
          button.disabled = false;
        }
      });
    }
  };

  const boot = async () => {
    const queryOrganizationId = toText(new URL(window.location.href).searchParams.get("organization_id"));
    const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
    const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
    const context = resolveOrganizationContext(queryOrganizationId, localOrganizationId, defaultOrganizationId);

    state.organizationId = context.id;
    state.organizationSource = context.source;
    persistOrganization();
    updateUrlOrganization();
    crmLabels?.applySelectDictionaries?.(root);
    renderOrganizationContext();
    renderSummary();
    renderRows();
    bindEvents();

    if (!state.organizationId) {
      setFeedback("Define organization_id para empezar.", "error");
      return;
    }

    try {
      setFeedback("Cargando modulo de notificaciones...");
      await loadNotifications({ page: 1 });

      if (el.createForm instanceof HTMLFormElement) {
        const dueInput = el.createForm.elements.namedItem("due_at");
        if (dueInput instanceof HTMLInputElement && !toText(dueInput.value)) {
          dueInput.value = toDatetimeLocalValue(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
        }
      }

      setFeedback("Modulo de notificaciones listo.");
    } catch (error) {
      const code = toText(error?.code);
      const details = toText(error?.message) || "No se pudo inicializar el modulo.";
      if (isAdminAuthErrorCode(code)) {
        setFeedback(`Acceso admin requerido: ${details}`, "error");
        return;
      }
      setFeedback(details, "error");
    }
  };

  boot();
})();
