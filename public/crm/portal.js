(() => {
  const root = document.querySelector("[data-portal-page]");
  if (!(root instanceof HTMLElement)) return;

  const page = String(root.dataset.portalPage || "").trim() || "dashboard";

  const state = {
    organizationId: "",
    organizationSource: "none",
    portalProjects: [],
    portalProjectsLoadedForOrg: null,
    lastInviteShare: null,
  };

  const el = {
    orgForm: document.getElementById("crm-portal-org-form"),
    orgInput: document.getElementById("crm-portal-organization-id"),
    orgSource: document.getElementById("crm-portal-org-source"),
    orgHelp: document.getElementById("crm-portal-org-help"),
    feedback: document.getElementById("crm-portal-feedback"),
    kpiInvites: document.getElementById("portal-kpi-invites"),
    kpiUsers: document.getElementById("portal-kpi-users"),
    kpiContent: document.getElementById("portal-kpi-content"),
    kpiLogs: document.getElementById("portal-kpi-logs"),
    inviteForm: document.getElementById("portal-invite-form"),
    inviteTypeInput: document.getElementById("portal-invite-type"),
    inviteRoleInput: document.getElementById("portal-invite-role"),
    inviteProjectSelect: document.getElementById("portal-invite-project-select"),
    inviteProjectManualInput: document.getElementById("portal-invite-project-manual"),
    inviteCode: document.getElementById("portal-invite-code"),
    inviteShare: document.getElementById("portal-invite-share"),
    inviteShareSummary: document.getElementById("portal-invite-share-summary"),
    inviteShareWhatsapp: document.getElementById("portal-invite-share-whatsapp"),
    inviteShareEmail: document.getElementById("portal-invite-share-email"),
    inviteCopyMessage: document.getElementById("portal-invite-copy-message"),
    inviteCopyCode: document.getElementById("portal-invite-copy-code"),
    invitesFilterForm: document.getElementById("portal-invites-filter"),
    invitesClearBtn: document.getElementById("portal-invites-clear"),
    invitesMeta: document.getElementById("portal-invites-meta"),
    invitesTbody: document.getElementById("portal-invites-tbody"),
    usersFilterForm: document.getElementById("portal-users-filter"),
    usersClearBtn: document.getElementById("portal-users-clear"),
    usersMeta: document.getElementById("portal-users-meta"),
    usersTbody: document.getElementById("portal-users-tbody"),
    membershipForm: document.getElementById("portal-membership-form"),
    membershipAccountInput: document.getElementById("portal-membership-account-id"),
    membershipProjectSelect: document.getElementById("portal-membership-project-select"),
    membershipProjectManualInput: document.getElementById("portal-membership-project-manual"),
    membershipsFilterForm: document.getElementById("portal-memberships-filter"),
    membershipsTbody: document.getElementById("portal-memberships-tbody"),
    contentFilterForm: document.getElementById("portal-content-filter"),
    contentFilterClearBtn: document.getElementById("portal-content-filter-clear"),
    contentForm: document.getElementById("portal-content-form"),
    contentIdInput: document.getElementById("portal-content-id"),
    contentNewBtn: document.getElementById("portal-content-new"),
    contentMeta: document.getElementById("portal-content-meta"),
    contentTbody: document.getElementById("portal-content-tbody"),
    logsFilterForm: document.getElementById("portal-logs-filter"),
    logsClearBtn: document.getElementById("portal-logs-clear"),
    logsMeta: document.getElementById("portal-logs-meta"),
    logsTbody: document.getElementById("portal-logs-tbody"),
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

  const asObject = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
  };

  const statusClass = (value) => {
    const status = toText(value) || "";
    if (
      status === "active" ||
      status === "approved" ||
      status === "paid" ||
      status === "used" ||
      status === "confirmed"
    ) {
      return "ok";
    }
    if (
      status === "revoked" ||
      status === "blocked" ||
      status === "declined" ||
      status === "cancelled" ||
      status === "rejected_duplicate" ||
      status === "expired"
    ) {
      return "danger";
    }
    return "warn";
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

  const copyTextToClipboard = async (value) => {
    const text = toText(value);
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fallback below
      }
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  };

  const getProjectDisplayName = (project) => {
    const row = asObject(project);
    const displayName = toText(row.display_name);
    const projectName = toText(row.project_name);
    const legacyCode = toText(row.legacy_code);
    const id = toText(row.id);
    const status = toText(row.status);
    const main = displayName || projectName || legacyCode || id || "Promocion";
    if (!status) return main;
    return `${main} | ${status}`;
  };

  const isPortalEnabledProject = (project) => {
    const row = asObject(project);
    const portal = asObject(row.portal);
    if (typeof portal.is_enabled === "boolean") return portal.is_enabled;
    const propertyData = asObject(row.property_data);
    if (typeof propertyData.portal_enabled === "boolean") return propertyData.portal_enabled;
    return true;
  };

  const getProjectById = (projectId) => {
    const normalized = toText(projectId);
    if (!normalized) return null;
    return state.portalProjects.find((item) => toText(item.id) === normalized) ?? null;
  };

  const resolveProjectPropertyIdFromForm = (formData, selectFieldName, manualFieldName) => {
    const selected = toText(formData.get(selectFieldName));
    const manual = toText(formData.get(manualFieldName));
    return manual ?? selected ?? null;
  };

  const renderInviteShare = (share) => {
    if (!(el.inviteShare instanceof HTMLElement)) return;
    if (!share) {
      el.inviteShare.hidden = true;
      if (el.inviteShareSummary instanceof HTMLElement) {
        el.inviteShareSummary.textContent = "Genera una invitacion para desbloquear envio por WhatsApp o correo.";
      }
      if (el.inviteShareWhatsapp instanceof HTMLAnchorElement) {
        el.inviteShareWhatsapp.href = "#";
      }
      if (el.inviteShareEmail instanceof HTMLAnchorElement) {
        el.inviteShareEmail.href = "#";
      }
      return;
    }

    el.inviteShare.hidden = false;
    if (el.inviteShareSummary instanceof HTMLElement) {
      const projectLine = share.projectLabel ? `<br /><small>Promocion: ${esc(share.projectLabel)}</small>` : "";
      el.inviteShareSummary.innerHTML = `
        <strong>${esc(share.email)}</strong><br />
        <a class="crm-link" href="${esc(share.activationUrl)}" target="_blank" rel="noopener noreferrer">
          Abrir enlace de activacion
        </a>
        <br />
        <small>Codigo: ${esc(share.code)}</small>${projectLine}
      `;
    }
    if (el.inviteShareWhatsapp instanceof HTMLAnchorElement) {
      el.inviteShareWhatsapp.href = share.whatsappUrl;
    }
    if (el.inviteShareEmail instanceof HTMLAnchorElement) {
      el.inviteShareEmail.href = share.mailtoUrl;
    }
  };

  const setProjectSelectOptions = (select, projects, emptyLabel) => {
    if (!(select instanceof HTMLSelectElement)) return;
    const current = toText(select.value);
    const options = [
      `<option value="">${esc(emptyLabel)}</option>`,
      ...projects.map((entry) => {
        const id = toText(entry.id);
        if (!id) return "";
        const selected = current === id ? " selected" : "";
        return `<option value="${esc(id)}"${selected}>${esc(getProjectDisplayName(entry))}</option>`;
      }),
    ];
    select.innerHTML = options.join("");

    if (current && !projects.some((entry) => toText(entry.id) === current)) {
      const orphan = document.createElement("option");
      orphan.value = current;
      orphan.textContent = `${current} (manual)`;
      orphan.selected = true;
      select.appendChild(orphan);
    }
  };

  const renderProjectSelectors = () => {
    setProjectSelectOptions(
      el.inviteProjectSelect,
      state.portalProjects,
      "Sin vincular a promocion concreta"
    );
    setProjectSelectOptions(
      el.membershipProjectSelect,
      state.portalProjects,
      "Selecciona una promocion"
    );
  };

  const loadPortalProjects = async ({ force = false } = {}) => {
    if (!ensureOrganization()) return [];
    if (!force && state.portalProjectsLoadedForOrg === state.organizationId) {
      return state.portalProjects;
    }

    const payload = await request(
      buildApiUrl("/api/v1/properties", {
        organization_id: state.organizationId,
        record_type: "project",
        per_page: "200",
        page: "1",
      })
    );

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    state.portalProjects = rows
      .filter((entry) => toText(entry?.id) && isPortalEnabledProject(entry))
      .sort((a, b) => getProjectDisplayName(a).localeCompare(getProjectDisplayName(b), "es"));
    state.portalProjectsLoadedForOrg = state.organizationId;
    renderProjectSelectors();
    return state.portalProjects;
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

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

  const renderOrganizationContext = () => {
    if (el.orgInput instanceof HTMLInputElement) {
      el.orgInput.value = state.organizationId;
    }
    if (el.orgSource instanceof HTMLElement) {
      el.orgSource.textContent = `Origen: ${organizationSourceLabel(state.organizationSource)}`;
      el.orgSource.className = `crm-badge ${state.organizationId ? "ok" : "warn"}`;
    }
    if (el.orgHelp instanceof HTMLElement) {
      el.orgHelp.textContent = state.organizationId
        ? `Contexto activo: ${state.organizationId}`
        : "Define organization_id para operar el modulo portal.";
    }
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
      const code = toText(payload?.error) || `http_${response.status}`;
      const details = toText(payload?.details) || toText(payload?.message) || null;
      const message = details ? `${code}: ${details}` : code;
      const error = new Error(message);
      error.code = code;
      throw error;
    }

    return payload;
  };

  const buildApiUrl = (path, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value == null) return;
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          const text = toText(entry);
          if (text) query.append(key, text);
        });
        return;
      }
      const text = toText(value);
      if (text) query.set(key, text);
    });
    const queryText = query.toString();
    return queryText ? `${path}?${queryText}` : path;
  };

  const ensureOrganization = () => {
    if (state.organizationId) return true;
    setFeedback("Debes definir organization_id para continuar.", "error");
    return false;
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

  const clearForm = (form) => {
    if (!(form instanceof HTMLFormElement)) return;
    form.reset();
  };

  const normalizeInviteRoleByType = () => {
    if (!(el.inviteTypeInput instanceof HTMLSelectElement) || !(el.inviteRoleInput instanceof HTMLSelectElement)) return;
    const inviteType = el.inviteTypeInput.value;
    if (inviteType === "client") {
      el.inviteRoleInput.value = "portal_client";
      Array.from(el.inviteRoleInput.options).forEach((option) => {
        option.disabled = option.value !== "portal_client";
      });
      return;
    }
    Array.from(el.inviteRoleInput.options).forEach((option) => {
      option.disabled = false;
    });
    if (el.inviteRoleInput.value === "portal_client") {
      el.inviteRoleInput.value = "portal_agent_member";
    }
  };

  // INVITES
  const renderInvites = (rows = [], meta = {}) => {
    if (!(el.invitesTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.invitesTbody.innerHTML = '<tr><td colspan="7">No hay invitaciones para este filtro.</td></tr>';
    } else {
      el.invitesTbody.innerHTML = rows
        .map((entry) => {
          const id = toText(entry.id) || "";
          const status = toText(entry.status) || "pending";
          const projectId = toText(entry.project_property_id);
          const linkedProject = getProjectById(projectId);
          const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : null;
          const maxAttempts = Number(entry.max_attempts || 0);
          const attemptCount = Number(entry.attempt_count || 0);
          const isRevokable = status === "pending" || status === "blocked";

          return `
            <tr>
              <td>
                <strong>${esc(entry.email || "-")}</strong>
                <br />
                <small>${esc(id)}</small>
              </td>
              <td>
                ${esc(entry.invite_type || "-")}
                <br />
                <small>${esc(entry.role || "-")}</small>
              </td>
              <td>${
                projectLabel
                  ? `<strong>${esc(projectLabel)}</strong><br /><small>${esc(projectId || "-")}</small>`
                  : esc(projectId || "-")
              }</td>
              <td><span class="crm-badge ${statusClass(status)}">${esc(status)}</span></td>
              <td>${esc(formatDateTime(entry.expires_at))}</td>
              <td>${esc(`${attemptCount}/${maxAttempts}`)}</td>
              <td>
                <button
                  type="button"
                  class="crm-mini-btn danger"
                  data-action="revoke-invite"
                  data-invite-id="${esc(id)}"
                  ${isRevokable ? "" : "disabled"}
                >
                  Revocar
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (el.invitesMeta instanceof HTMLElement) {
      const count = Number(meta.count || rows.length || 0);
      const total = Number(meta.total || count);
      const pageValue = Number(meta.page || 1);
      const totalPages = Number(meta.total_pages || 1);
      el.invitesMeta.textContent = `${count} filas visibles | total ${total} | pagina ${pageValue}/${totalPages}`;
    }
  };

  const loadInvites = async () => {
    if (!ensureOrganization()) return;
    const filterForm = el.invitesFilterForm instanceof HTMLFormElement ? new FormData(el.invitesFilterForm) : null;
    const params = {
      organization_id: state.organizationId,
      status: toText(filterForm?.get("status")),
      email: toText(filterForm?.get("email")),
      project_property_id: toText(filterForm?.get("project_property_id")),
      per_page: toText(filterForm?.get("per_page")) || "25",
      page: "1",
    };

    const payload = await request(buildApiUrl("/api/v1/portal/invites", params));
    renderInvites(Array.isArray(payload?.data) ? payload.data : [], asObject(payload?.meta));
  };

  const createInvite = async () => {
    if (!ensureOrganization() || !(el.inviteForm instanceof HTMLFormElement)) return;
    state.lastInviteShare = null;
    renderInviteShare(null);
    const formData = new FormData(el.inviteForm);
    const projectPropertyId = resolveProjectPropertyIdFromForm(
      formData,
      "project_property_id",
      "project_property_id_manual"
    );
    const payload = {
      organization_id: state.organizationId,
      email: toText(formData.get("email")),
      invite_type: toText(formData.get("invite_type")),
      role: toText(formData.get("role")),
      project_property_id: projectPropertyId,
      expires_hours: Number(formData.get("expires_hours") || 72),
      max_attempts: Number(formData.get("max_attempts") || 5),
    };

    if (!payload.email) {
      setFeedback("Debes indicar un email para crear la invitacion.", "error");
      return;
    }

    const response = await request("/api/v1/portal/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const createdInvite = asObject(response?.data);
    const code = toText(response?.meta?.one_time_code);
    const inviteEmail = toText(createdInvite.email) ?? payload.email;
    const inviteProjectId = toText(createdInvite.project_property_id) ?? projectPropertyId;

    if (el.inviteCode instanceof HTMLElement) {
      el.inviteCode.textContent = code
        ? `Codigo de un solo uso: ${code}. Envia esta invitacion ahora desde los botones de abajo.`
        : "Invite creada. No se recibio codigo visible en la respuesta.";
    }

    if (code && inviteEmail) {
      const activationUrl = new URL("/es/portal/activate/", window.location.origin);
      activationUrl.searchParams.set("organization_id", state.organizationId);
      activationUrl.searchParams.set("email", inviteEmail);
      if (inviteProjectId) activationUrl.searchParams.set("project_property_id", inviteProjectId);

      const linkedProject = getProjectById(inviteProjectId);
      const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : inviteProjectId;
      const activationUrlText = activationUrl.toString();
      const subject = "Invitacion de acceso al portal de BlancaReal";
      const message = [
        "Hola,",
        "",
        "Te compartimos tu acceso al portal de BlancaReal.",
        `Enlace de activacion: ${activationUrlText}`,
        `Email invitado: ${inviteEmail}`,
        `Codigo de un solo uso: ${code}`,
        "",
        projectLabel ? `Promocion asignada: ${projectLabel}` : "Promocion asignada: acceso general",
        "",
        "Si necesitas ayuda para activar, responde a este mensaje.",
      ].join("\n");

      state.lastInviteShare = {
        email: inviteEmail,
        code,
        activationUrl: activationUrlText,
        projectLabel,
        message,
        whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
        mailtoUrl: `mailto:${encodeURIComponent(inviteEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
      };
    } else {
      state.lastInviteShare = null;
    }
    renderInviteShare(state.lastInviteShare);

    el.inviteForm.reset();
    normalizeInviteRoleByType();
    renderProjectSelectors();
    const emailInput = el.inviteForm.querySelector("input[name='email']");
    if (emailInput instanceof HTMLInputElement) emailInput.focus();

    await loadInvites();
    setFeedback("Invite creada correctamente.", "ok");
  };

  const revokeInvite = async (inviteId) => {
    if (!ensureOrganization() || !inviteId) return;
    const confirmed = window.confirm("Se revocara la invitacion seleccionada. Continuar?");
    if (!confirmed) return;

    await request(`/api/v1/portal/invites/${encodeURIComponent(inviteId)}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: state.organizationId }),
    });

    await loadInvites();
    setFeedback("Invite revocada.", "ok");
  };

  // USERS + MEMBERSHIPS
  const renderUsers = (rows = [], meta = {}) => {
    if (!(el.usersTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.usersTbody.innerHTML = '<tr><td colspan="6">No hay cuentas portal con este filtro.</td></tr>';
    } else {
      el.usersTbody.innerHTML = rows
        .map((entry) => {
          const id = toText(entry.id) || "";
          const metadata = asObject(entry.metadata);
          const email = toText(metadata.email) || "-";
          const fullName = toText(metadata.full_name) || "-";
          const status = toText(entry.status) || "pending";
          const stats = asObject(entry.membership_stats);
          const membershipsActive = Number(stats.memberships_active || 0);
          const membershipsTotal = Number(stats.memberships_total || 0);

          return `
            <tr>
              <td>
                <strong>${esc(email)}</strong>
                <br />
                <small>${esc(fullName)}</small>
                <br />
                <small>${esc(id)}</small>
              </td>
              <td>${esc(entry.role || "-")}</td>
              <td><span class="crm-badge ${statusClass(status)}">${esc(status)}</span></td>
              <td>${esc(`${membershipsActive}/${membershipsTotal}`)}</td>
              <td>${esc(formatDateTime(entry.last_login_at))}</td>
              <td>
                <div class="crm-actions-row">
                  <select data-account-status="${esc(id)}" aria-label="Estado de cuenta ${esc(email)}">
                    <option value="pending" ${status === "pending" ? "selected" : ""}>pending</option>
                    <option value="active" ${status === "active" ? "selected" : ""}>active</option>
                    <option value="blocked" ${status === "blocked" ? "selected" : ""}>blocked</option>
                    <option value="revoked" ${status === "revoked" ? "selected" : ""}>revoked</option>
                  </select>
                  <button type="button" class="crm-mini-btn" data-action="save-account-status" data-account-id="${esc(id)}">
                    Guardar
                  </button>
                  <button type="button" class="crm-mini-btn" data-action="use-account-id" data-account-id="${esc(id)}">
                    Usar
                  </button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (el.usersMeta instanceof HTMLElement) {
      const count = Number(meta.count || rows.length || 0);
      const total = Number(meta.total || count);
      const pageValue = Number(meta.page || 1);
      const totalPages = Number(meta.total_pages || 1);
      el.usersMeta.textContent = `${count} filas visibles | total ${total} | pagina ${pageValue}/${totalPages}`;
    }
  };

  const renderMemberships = (rows = []) => {
    if (!(el.membershipsTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.membershipsTbody.innerHTML = '<tr><td colspan="6">No hay membresias para el filtro seleccionado.</td></tr>';
      return;
    }

    el.membershipsTbody.innerHTML = rows
      .map((entry) => {
        const id = toText(entry.id) || "";
        const status = toText(entry.status) || "active";
        const projectId = toText(entry.project_property_id);
        const linkedProject = getProjectById(projectId);
        const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : null;
        return `
          <tr>
            <td><small>${esc(entry.portal_account_id || "-")}</small></td>
            <td>${
              projectLabel
                ? `<strong>${esc(projectLabel)}</strong><br /><small>${esc(projectId || "-")}</small>`
                : `<small>${esc(projectId || "-")}</small>`
            }</td>
            <td>${esc(entry.access_scope || "-")}</td>
            <td><span class="crm-badge ${statusClass(status)}">${esc(status)}</span></td>
            <td>${esc(String(entry.dispute_window_hours ?? "-"))} h</td>
            <td>
              <button
                type="button"
                class="crm-mini-btn danger"
                data-action="revoke-membership"
                data-membership-id="${esc(id)}"
                ${status === "revoked" ? "disabled" : ""}
              >
                Revocar
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  };

  const loadUsers = async () => {
    if (!ensureOrganization()) return;
    const filterForm = el.usersFilterForm instanceof HTMLFormElement ? new FormData(el.usersFilterForm) : null;
    const params = {
      organization_id: state.organizationId,
      q: toText(filterForm?.get("q")),
      role: toText(filterForm?.get("role")),
      status: toText(filterForm?.get("status")),
      per_page: toText(filterForm?.get("per_page")) || "25",
      page: "1",
    };

    const payload = await request(buildApiUrl("/api/v1/crm/portal/users", params));
    renderUsers(Array.isArray(payload?.data) ? payload.data : [], asObject(payload?.meta));
  };

  const loadMemberships = async () => {
    if (!ensureOrganization()) return;
    const filterForm =
      el.membershipsFilterForm instanceof HTMLFormElement ? new FormData(el.membershipsFilterForm) : null;
    const params = {
      organization_id: state.organizationId,
      portal_account_id: toText(filterForm?.get("portal_account_id")),
      per_page: "50",
      page: "1",
    };
    const payload = await request(buildApiUrl("/api/v1/crm/portal/memberships", params));
    renderMemberships(Array.isArray(payload?.data) ? payload.data : []);
  };

  const saveMembership = async () => {
    if (!ensureOrganization() || !(el.membershipForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.membershipForm);
    const projectPropertyId = resolveProjectPropertyIdFromForm(
      formData,
      "project_property_id",
      "project_property_id_manual"
    );
    const payload = {
      organization_id: state.organizationId,
      portal_account_id: toText(formData.get("portal_account_id")),
      project_property_id: projectPropertyId,
      access_scope: toText(formData.get("access_scope")) || "read",
      status: toText(formData.get("status")) || "active",
      dispute_window_hours: Number(formData.get("dispute_window_hours") || 48),
    };

    if (!payload.portal_account_id || !payload.project_property_id) {
      setFeedback("Debes indicar portal_account_id y una promocion valida.", "error");
      return;
    }

    await request("/api/v1/crm/portal/memberships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (el.membershipProjectManualInput instanceof HTMLInputElement) {
      el.membershipProjectManualInput.value = "";
    }
    await Promise.all([loadUsers(), loadMemberships()]);
    setFeedback("Membresia guardada correctamente.", "ok");
  };

  const updateAccountStatus = async (portalAccountId) => {
    if (!ensureOrganization() || !portalAccountId) return;
    const selector = document.querySelector(`select[data-account-status="${portalAccountId}"]`);
    if (!(selector instanceof HTMLSelectElement)) return;
    const status = toText(selector.value);
    if (!status) return;

    await request("/api/v1/crm/portal/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        portal_account_id: portalAccountId,
        status,
      }),
    });

    await loadUsers();
    setFeedback("Estado de cuenta actualizado.", "ok");
  };

  const revokeMembership = async (membershipId) => {
    if (!ensureOrganization() || !membershipId) return;
    const confirmed = window.confirm("Se revocara esta membresia. Continuar?");
    if (!confirmed) return;

    await request("/api/v1/crm/portal/memberships", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        id: membershipId,
      }),
    });

    await Promise.all([loadUsers(), loadMemberships()]);
    setFeedback("Membresia revocada.", "ok");
  };

  // CONTENT
  const renderContent = (rows = [], meta = {}) => {
    if (!(el.contentTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.contentTbody.innerHTML = '<tr><td colspan="7">No hay bloques para el filtro actual.</td></tr>';
    } else {
      el.contentTbody.innerHTML = rows
        .map((entry) => {
          const id = toText(entry.id) || "";
          const published = Boolean(entry.is_published);
          return `
            <tr>
              <td><small>${esc(entry.project_property_id || "-")}</small></td>
              <td>${esc(`${entry.language || "-"} / ${entry.audience || "-"}`)}</td>
              <td>${esc(entry.section_key || "-")}</td>
              <td>${esc(entry.title || "-")}</td>
              <td>${esc(String(entry.sort_order ?? 0))}</td>
              <td><span class="crm-badge ${published ? "ok" : "warn"}">${published ? "published" : "draft"}</span></td>
              <td>
                <div class="crm-actions-row">
                  <button type="button" class="crm-mini-btn" data-action="edit-content" data-content-id="${esc(id)}">Editar</button>
                  <button type="button" class="crm-mini-btn" data-action="toggle-content-published" data-content-id="${esc(id)}" data-content-published="${published ? "1" : "0"}">
                    ${published ? "Despublicar" : "Publicar"}
                  </button>
                  <button type="button" class="crm-mini-btn danger" data-action="delete-content" data-content-id="${esc(id)}">Borrar</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (el.contentMeta instanceof HTMLElement) {
      const count = Number(meta.count || rows.length || 0);
      const total = Number(meta.total || count);
      const pageValue = Number(meta.page || 1);
      const totalPages = Number(meta.total_pages || 1);
      el.contentMeta.textContent = `${count} filas visibles | total ${total} | pagina ${pageValue}/${totalPages}`;
    }
  };

  const loadContent = async () => {
    if (!ensureOrganization()) return;
    const filterForm = el.contentFilterForm instanceof HTMLFormElement ? new FormData(el.contentFilterForm) : null;
    const params = {
      organization_id: state.organizationId,
      project_property_id: toText(filterForm?.get("project_property_id")),
      language: toText(filterForm?.get("language")),
      audience: toText(filterForm?.get("audience")),
      q: toText(filterForm?.get("q")),
      is_published: toText(filterForm?.get("is_published")),
      page: "1",
      per_page: "50",
    };
    const payload = await request(buildApiUrl("/api/v1/crm/portal/content", params));
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    renderContent(rows, asObject(payload?.meta));
    root.dataset.contentRows = JSON.stringify(rows);
  };

  const resetContentForm = () => {
    if (!(el.contentForm instanceof HTMLFormElement)) return;
    el.contentForm.reset();
    if (el.contentIdInput instanceof HTMLInputElement) {
      el.contentIdInput.value = "";
    }
    const languageInput = el.contentForm.querySelector("input[name='language']");
    if (languageInput instanceof HTMLInputElement && !toText(languageInput.value)) {
      languageInput.value = "es";
    }
  };

  const getCachedContentRows = () => {
    const raw = toText(root.dataset.contentRows);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const fillContentForm = (contentId) => {
    if (!contentId || !(el.contentForm instanceof HTMLFormElement)) return;
    const rows = getCachedContentRows();
    const row = rows.find((entry) => toText(entry.id) === contentId);
    if (!row) return;

    const setValue = (name, value) => {
      const field = el.contentForm.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
        field.value = value == null ? "" : String(value);
      }
    };

    setValue("id", row.id);
    setValue("project_property_id", row.project_property_id);
    setValue("language", row.language);
    setValue("audience", row.audience);
    setValue("section_key", row.section_key);
    setValue("title", row.title || "");
    setValue("body_markdown", row.body_markdown || "");
    setValue("sort_order", row.sort_order ?? 0);

    const publishedField = el.contentForm.elements.namedItem("is_published");
    if (publishedField instanceof HTMLInputElement) {
      publishedField.checked = Boolean(row.is_published);
    }

    const projectInput = el.contentForm.elements.namedItem("project_property_id");
    if (projectInput instanceof HTMLInputElement) projectInput.focus();
  };

  const saveContent = async () => {
    if (!ensureOrganization() || !(el.contentForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.contentForm);
    const contentId = toText(formData.get("id"));
    const payload = {
      organization_id: state.organizationId,
      id: contentId,
      project_property_id: toText(formData.get("project_property_id")),
      language: toText(formData.get("language")),
      audience: toText(formData.get("audience")) || "both",
      section_key: toText(formData.get("section_key")),
      title: toText(formData.get("title")),
      body_markdown: toText(formData.get("body_markdown")),
      sort_order: Number(formData.get("sort_order") || 0),
      is_published: formData.get("is_published") === "on",
    };

    if (!payload.project_property_id || !payload.language || !payload.section_key) {
      setFeedback("Proyecto, idioma y section_key son obligatorios.", "error");
      return;
    }

    const url = "/api/v1/crm/portal/content";
    const method = contentId ? "PATCH" : "POST";
    await request(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await loadContent();
    if (!contentId) {
      resetContentForm();
      const projectField = el.contentForm.elements.namedItem("project_property_id");
      if (projectField instanceof HTMLInputElement) projectField.focus();
    }
    setFeedback(contentId ? "Bloque actualizado." : "Bloque creado.", "ok");
  };

  const togglePublished = async (contentId, current) => {
    if (!ensureOrganization() || !contentId) return;
    await request("/api/v1/crm/portal/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        id: contentId,
        is_published: !current,
      }),
    });
    await loadContent();
    setFeedback(!current ? "Bloque publicado." : "Bloque despublicado.", "ok");
  };

  const deleteContent = async (contentId) => {
    if (!ensureOrganization() || !contentId) return;
    const confirmed = window.confirm("Se eliminara el bloque de contenido. Continuar?");
    if (!confirmed) return;

    await request("/api/v1/crm/portal/content", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        id: contentId,
      }),
    });

    await loadContent();
    setFeedback("Bloque eliminado.", "ok");
  };

  // LOGS
  const renderLogs = (rows = [], meta = {}) => {
    if (!(el.logsTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.logsTbody.innerHTML = '<tr><td colspan="7">No hay eventos para el filtro aplicado.</td></tr>';
    } else {
      el.logsTbody.innerHTML = rows
        .map((entry) => {
          const eventType = toText(entry.event_type) || "-";
          return `
            <tr>
              <td>${esc(formatDateTime(entry.created_at))}</td>
              <td><span class="crm-badge ${statusClass(eventType)}">${esc(eventType)}</span></td>
              <td>${esc(entry.email || "-")}</td>
              <td><small>${esc(entry.portal_account_id || "-")}</small></td>
              <td>
                <small>${esc(entry.project_property_id || "-")}</small>
                <br />
                <small>${esc(entry.lead_id || "-")}</small>
              </td>
              <td>${esc(entry.ip || "-")}</td>
              <td><small>${esc(toText(entry.user_agent) || "-")}</small></td>
            </tr>
          `;
        })
        .join("");
    }

    if (el.logsMeta instanceof HTMLElement) {
      const count = Number(meta.count || rows.length || 0);
      const total = Number(meta.total || count);
      const pageValue = Number(meta.page || 1);
      const totalPages = Number(meta.total_pages || 1);
      el.logsMeta.textContent = `${count} filas visibles | total ${total} | pagina ${pageValue}/${totalPages}`;
    }
  };

  const loadLogs = async () => {
    if (!ensureOrganization()) return;
    const filterForm = el.logsFilterForm instanceof HTMLFormElement ? new FormData(el.logsFilterForm) : null;
    const params = {
      organization_id: state.organizationId,
      event_type: toText(filterForm?.get("event_type")),
      email: toText(filterForm?.get("email")),
      project_property_id: toText(filterForm?.get("project_property_id")),
      lead_id: toText(filterForm?.get("lead_id")),
      from: toText(filterForm?.get("from")),
      to: toText(filterForm?.get("to")),
      per_page: toText(filterForm?.get("per_page")) || "50",
      page: "1",
    };

    const payload = await request(buildApiUrl("/api/v1/portal/access-logs", params));
    renderLogs(Array.isArray(payload?.data) ? payload.data : [], asObject(payload?.meta));
  };

  // DASHBOARD
  const loadDashboard = async () => {
    if (!ensureOrganization()) return;
    const base = { organization_id: state.organizationId, page: "1", per_page: "1" };

    const [invitesPayload, usersPayload, contentPayload, logsPayload] = await Promise.all([
      request(buildApiUrl("/api/v1/portal/invites", base)),
      request(buildApiUrl("/api/v1/crm/portal/users", base)),
      request(buildApiUrl("/api/v1/crm/portal/content", base)),
      request(buildApiUrl("/api/v1/portal/access-logs", { ...base, per_page: "5" })),
    ]);

    if (el.kpiInvites instanceof HTMLElement) {
      el.kpiInvites.textContent = String(Number(invitesPayload?.meta?.total || invitesPayload?.meta?.count || 0));
    }
    if (el.kpiUsers instanceof HTMLElement) {
      el.kpiUsers.textContent = String(Number(usersPayload?.meta?.total || usersPayload?.meta?.count || 0));
    }
    if (el.kpiContent instanceof HTMLElement) {
      el.kpiContent.textContent = String(Number(contentPayload?.meta?.total || contentPayload?.meta?.count || 0));
    }
    if (el.kpiLogs instanceof HTMLElement) {
      el.kpiLogs.textContent = String(Number(logsPayload?.meta?.total || logsPayload?.meta?.count || 0));
    }
  };

  const handleOrgSubmit = async (event) => {
    event.preventDefault();
    const nextId = toText(el.orgInput instanceof HTMLInputElement ? el.orgInput.value : "");
    state.organizationId = nextId || "";
    state.organizationSource = nextId ? "manual" : "none";
    state.portalProjects = [];
    state.portalProjectsLoadedForOrg = null;
    state.lastInviteShare = null;
    persistOrganization();
    updateUrlOrganization();
    renderOrganizationContext();
    renderProjectSelectors();
    renderInviteShare(null);
    await loadCurrentPage();
  };

  const initContext = () => {
    const search = new URLSearchParams(window.location.search);
    const queryOrganizationId = toText(search.get("organization_id"));
    const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
    const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);

    const context = resolveOrganizationContext(queryOrganizationId, localOrganizationId, defaultOrganizationId);
    state.organizationId = context.id;
    state.organizationSource = context.source;
    state.portalProjects = [];
    state.portalProjectsLoadedForOrg = null;
    state.lastInviteShare = null;
    persistOrganization();
    updateUrlOrganization();
    renderOrganizationContext();
    renderProjectSelectors();
    renderInviteShare(null);
  };

  const loadCurrentPage = async () => {
    if (!state.organizationId) {
      if (page === "dashboard") {
        if (el.kpiInvites instanceof HTMLElement) el.kpiInvites.textContent = "-";
        if (el.kpiUsers instanceof HTMLElement) el.kpiUsers.textContent = "-";
        if (el.kpiContent instanceof HTMLElement) el.kpiContent.textContent = "-";
        if (el.kpiLogs instanceof HTMLElement) el.kpiLogs.textContent = "-";
      }
      setFeedback("Define organization_id para cargar datos.", "error");
      return;
    }

    setFeedback("Cargando datos del modulo portal...", "ok");
    try {
      if (page === "dashboard") {
        await loadDashboard();
      } else if (page === "invites") {
        try {
          await loadPortalProjects();
        } catch {
          state.portalProjects = [];
          state.portalProjectsLoadedForOrg = null;
          renderProjectSelectors();
        }
        normalizeInviteRoleByType();
        await loadInvites();
      } else if (page === "users") {
        try {
          await loadPortalProjects();
        } catch {
          state.portalProjects = [];
          state.portalProjectsLoadedForOrg = null;
          renderProjectSelectors();
        }
        await Promise.all([loadUsers(), loadMemberships()]);
      } else if (page === "content") {
        await loadContent();
      } else if (page === "logs") {
        await loadLogs();
      }
      setFeedback("Datos actualizados.", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`No se pudo cargar el modulo portal: ${message}`, "error");
    }
  };

  if (el.orgForm instanceof HTMLFormElement) {
    el.orgForm.addEventListener("submit", (event) => {
      void handleOrgSubmit(event);
    });
  }

  if (el.inviteTypeInput instanceof HTMLSelectElement) {
    el.inviteTypeInput.addEventListener("change", normalizeInviteRoleByType);
  }

  if (el.inviteProjectSelect instanceof HTMLSelectElement && el.inviteProjectManualInput instanceof HTMLInputElement) {
    el.inviteProjectSelect.addEventListener("change", () => {
      if (toText(el.inviteProjectSelect.value)) {
        el.inviteProjectManualInput.value = "";
      }
    });
  }

  if (el.membershipProjectSelect instanceof HTMLSelectElement && el.membershipProjectManualInput instanceof HTMLInputElement) {
    el.membershipProjectSelect.addEventListener("change", () => {
      if (toText(el.membershipProjectSelect.value)) {
        el.membershipProjectManualInput.value = "";
      }
    });
  }

  if (el.inviteForm instanceof HTMLFormElement) {
    el.inviteForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await createInvite();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo crear invite: ${message}`, "error");
        }
      })();
    });
  }

  if (el.inviteCopyMessage instanceof HTMLButtonElement) {
    el.inviteCopyMessage.addEventListener("click", () => {
      void (async () => {
        const message = toText(state.lastInviteShare?.message);
        if (!message) {
          setFeedback("No hay mensaje de invite para copiar.", "error");
          return;
        }
        const copied = await copyTextToClipboard(message);
        setFeedback(
          copied ? "Mensaje copiado. Pegalo en WhatsApp o correo." : "No se pudo copiar el mensaje.",
          copied ? "ok" : "error"
        );
      })();
    });
  }

  if (el.inviteCopyCode instanceof HTMLButtonElement) {
    el.inviteCopyCode.addEventListener("click", () => {
      void (async () => {
        const code = toText(state.lastInviteShare?.code);
        if (!code) {
          setFeedback("No hay codigo disponible para copiar.", "error");
          return;
        }
        const copied = await copyTextToClipboard(code);
        setFeedback(
          copied ? "Codigo copiado al portapapeles." : "No se pudo copiar el codigo.",
          copied ? "ok" : "error"
        );
      })();
    });
  }

  if (el.invitesFilterForm instanceof HTMLFormElement) {
    el.invitesFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadInvites();
          setFeedback("Invitaciones actualizadas.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando invites: ${message}`, "error");
        }
      })();
    });
  }

  el.invitesClearBtn?.addEventListener("click", () => {
    clearForm(el.invitesFilterForm);
    void (async () => {
      try {
        await loadInvites();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`Error limpiando filtros de invites: ${message}`, "error");
      }
    })();
  });

  el.invitesTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-action='revoke-invite']");
    if (!button) return;
    const inviteId = toText(button.getAttribute("data-invite-id"));
    if (!inviteId) return;
    void (async () => {
      try {
        await revokeInvite(inviteId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`No se pudo revocar invite: ${message}`, "error");
      }
    })();
  });

  if (el.usersFilterForm instanceof HTMLFormElement) {
    el.usersFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadUsers();
          setFeedback("Usuarios actualizados.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando usuarios: ${message}`, "error");
        }
      })();
    });
  }

  el.usersClearBtn?.addEventListener("click", () => {
    clearForm(el.usersFilterForm);
    void (async () => {
      try {
        await loadUsers();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`Error limpiando filtros de usuarios: ${message}`, "error");
      }
    })();
  });

  if (el.membershipForm instanceof HTMLFormElement) {
    el.membershipForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await saveMembership();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo guardar la membresia: ${message}`, "error");
        }
      })();
    });
  }

  if (el.membershipsFilterForm instanceof HTMLFormElement) {
    el.membershipsFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadMemberships();
          setFeedback("Membresias actualizadas.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando membresias: ${message}`, "error");
        }
      })();
    });
  }

  el.usersTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const saveButton = target.closest("button[data-action='save-account-status']");
    if (saveButton) {
      const accountId = toText(saveButton.getAttribute("data-account-id"));
      if (!accountId) return;
      void (async () => {
        try {
          await updateAccountStatus(accountId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo actualizar estado de cuenta: ${message}`, "error");
        }
      })();
      return;
    }

    const useButton = target.closest("button[data-action='use-account-id']");
    if (useButton) {
      const accountId = toText(useButton.getAttribute("data-account-id"));
      if (!accountId) return;
      if (el.membershipAccountInput instanceof HTMLInputElement) {
        el.membershipAccountInput.value = accountId;
        el.membershipAccountInput.focus();
        setFeedback("Portal account ID copiado al formulario de membresia.", "ok");
      }
    }
  });

  el.membershipsTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-action='revoke-membership']");
    if (!button) return;
    const membershipId = toText(button.getAttribute("data-membership-id"));
    if (!membershipId) return;
    void (async () => {
      try {
        await revokeMembership(membershipId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`No se pudo revocar membresia: ${message}`, "error");
      }
    })();
  });

  if (el.contentFilterForm instanceof HTMLFormElement) {
    el.contentFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadContent();
          setFeedback("Contenido actualizado.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando contenido: ${message}`, "error");
        }
      })();
    });
  }

  el.contentFilterClearBtn?.addEventListener("click", () => {
    clearForm(el.contentFilterForm);
    void (async () => {
      try {
        await loadContent();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`Error limpiando filtros de contenido: ${message}`, "error");
      }
    })();
  });

  if (el.contentForm instanceof HTMLFormElement) {
    el.contentForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await saveContent();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo guardar contenido: ${message}`, "error");
        }
      })();
    });
  }

  el.contentNewBtn?.addEventListener("click", () => {
    resetContentForm();
    setFeedback("Formulario listo para crear un bloque nuevo.", "ok");
  });

  el.contentTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editButton = target.closest("button[data-action='edit-content']");
    if (editButton) {
      const contentId = toText(editButton.getAttribute("data-content-id"));
      if (!contentId) return;
      fillContentForm(contentId);
      setFeedback("Bloque cargado en formulario para edicion.", "ok");
      return;
    }

    const toggleButton = target.closest("button[data-action='toggle-content-published']");
    if (toggleButton) {
      const contentId = toText(toggleButton.getAttribute("data-content-id"));
      const current = toText(toggleButton.getAttribute("data-content-published")) === "1";
      if (!contentId) return;
      void (async () => {
        try {
          await togglePublished(contentId, current);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo cambiar publicacion: ${message}`, "error");
        }
      })();
      return;
    }

    const deleteButton = target.closest("button[data-action='delete-content']");
    if (deleteButton) {
      const contentId = toText(deleteButton.getAttribute("data-content-id"));
      if (!contentId) return;
      void (async () => {
        try {
          await deleteContent(contentId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo borrar contenido: ${message}`, "error");
        }
      })();
    }
  });

  if (el.logsFilterForm instanceof HTMLFormElement) {
    el.logsFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadLogs();
          setFeedback("Logs actualizados.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando logs: ${message}`, "error");
        }
      })();
    });
  }

  el.logsClearBtn?.addEventListener("click", () => {
    clearForm(el.logsFilterForm);
    void (async () => {
      try {
        await loadLogs();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`Error limpiando filtros de logs: ${message}`, "error");
      }
    })();
  });

  initContext();
  void loadCurrentPage();
})();
