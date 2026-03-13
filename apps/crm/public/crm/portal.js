(() => {
  const root = document.querySelector("[data-portal-page]");
  if (!(root instanceof HTMLElement)) return;

  const page = String(root.dataset.portalPage || "").trim() || "dashboard";

  const state = {
    organizationId: "",
    organizationSource: "none",
    portalProjects: [],
    portalProjectsLoadedForOrg: null,
    portalProjectsById: new Map(),
    portalAccountsById: new Map(),
    lastInviteShare: null,
  };

  const PORTAL_SESSION_KEY = "portal.session.v1";

  const el = {
    orgForm: document.getElementById("crm-portal-org-form"),
    orgInput: document.getElementById("crm-portal-organization-id"),
    orgSource: document.getElementById("crm-portal-org-source"),
    orgHelp: document.getElementById("crm-portal-org-help"),
    feedback: document.getElementById("crm-portal-feedback"),
    kpiInvites: document.getElementById("portal-kpi-invites"),
    kpiSignupRequests: document.getElementById("portal-kpi-signup-requests"),
    kpiUsers: document.getElementById("portal-kpi-users"),
    kpiContent: document.getElementById("portal-kpi-content"),
    kpiDocuments: document.getElementById("portal-kpi-documents"),
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
    registrationFilterForm: document.getElementById("portal-registration-filter"),
    registrationClearBtn: document.getElementById("portal-registration-clear"),
    registrationKpiRequested: document.getElementById("portal-registration-kpi-requested"),
    registrationKpiApproved: document.getElementById("portal-registration-kpi-approved"),
    registrationKpiRejected: document.getElementById("portal-registration-kpi-rejected"),
    registrationMeta: document.getElementById("portal-registration-meta"),
    invitesFilterForm: document.getElementById("portal-invites-filter"),
    invitesClearBtn: document.getElementById("portal-invites-clear"),
    invitesMeta: document.getElementById("portal-invites-meta"),
    registrationRequestsNote: document.getElementById("portal-registration-requests-note"),
    registrationTbody: document.getElementById("portal-registration-tbody"),
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
    documentsFilterForm: document.getElementById("portal-documents-filter"),
    documentsFilterClearBtn: document.getElementById("portal-documents-filter-clear"),
    documentsFilterPropertySelect: document.getElementById("portal-documents-filter-property-select"),
    documentsForm: document.getElementById("portal-documents-form"),
    documentsIdInput: document.getElementById("portal-documents-id"),
    documentsPropertySelect: document.getElementById("portal-documents-property-select"),
    documentsPropertyResolution: document.getElementById("portal-documents-property-resolution"),
    documentsTreeForm: document.getElementById("portal-documents-tree-form"),
    documentsTreeProjectSelect: document.getElementById("portal-documents-tree-project-select"),
    documentsTreeList: document.getElementById("portal-documents-tree-list"),
    documentsNewBtn: document.getElementById("portal-documents-new"),
    documentsMeta: document.getElementById("portal-documents-meta"),
    documentsTbody: document.getElementById("portal-documents-tbody"),
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

  const portalRoleLabel = (value) => dictLabel("portal-role", value, "-");
  const portalStatusLabel = (value) => dictLabel("portal-status", value, "-");
  const inviteTypeLabel = (value) => dictLabel("invite-type", value, "-");
  const inviteStatusLabel = (value) => dictLabel("invite-status", value, portalStatusLabel(value));
  const membershipScopeLabel = (value) => dictLabel("membership-scope", value, "-");
  const audienceLabel = (value) => dictLabel("audience", value, "-");
  const publicationLabel = (published) =>
    published ? dictLabel("publication", "published", "Publicado") : dictLabel("publication", "draft", "Borrador");
  const logEventTypeLabel = (value) => dictLabel("log-event-type", value, value || "-");

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
    return {
      Authorization: `${tokenType} ${accessToken}`.trim(),
    };
  };

  const createErrorWithCode = (code, details) => {
    const error = new Error(details || code);
    error.code = code;
    return error;
  };

  const isLogsAccessErrorCode = (value) => {
    const code = toText(value) || "";
    return (
      code === "portal_admin_session_required" ||
      code === "portal_admin_role_required" ||
      code === "portal_logs_admin_only" ||
      code === "portal_logs_email_not_allowed" ||
      code === "auth_token_required" ||
      code === "invalid_auth_token" ||
      code === "portal_account_not_found" ||
      code === "portal_account_not_found_for_auth_user" ||
      code === "portal_account_not_active"
    );
  };

  const requestPortalAdmin = async (url, init = {}) => {
    const session = loadPortalSession();
    const role = toText(session?.role ?? session?.portalAccount?.role);
    const headers = buildPortalAuthHeaders();
    if (!headers?.Authorization) {
      throw createErrorWithCode(
        "portal_admin_session_required",
        "Inicia sesion en /es/portal/login con cuenta admin para acceder a logs."
      );
    }
    if (role && role !== "portal_agent_admin") {
      throw createErrorWithCode(
        "portal_admin_role_required",
        "La sesion portal activa no tiene rol portal_agent_admin."
      );
    }
    return request(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...headers,
      },
    });
  };

  const statusClass = (value) => {
    const status = toText(value) || "";
    if (
      status === "active" ||
      status === "approved" ||
      status === "paid" ||
      status === "used" ||
      status === "confirmed" ||
      status === "document_downloaded"
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

  const approvalStatusClass = (value) => {
    const status = toText(value) || "requested";
    if (status === "approved") return "ok";
    if (status === "rejected") return "danger";
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

  const formatBytes = (value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "-";
    if (bytes < 1024) return `${Math.floor(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const portalVisibilityLabel = (value) => {
    return dictLabel("portal-visibility", value, "Shared Kit (ambos)");
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

  const getPropertyMainLabel = (project, fallback = "Propiedad") => {
    const row = asObject(project);
    return (
      toText(row.display_name) ??
      toText(row.project_name) ??
      toText(row.legacy_code) ??
      toText(row.id) ??
      fallback
    );
  };

  const getProjectDisplayName = (project) => {
    const row = asObject(project);
    const id = toText(row.id);
    const status = toText(row.status);
    const recordType = toText(row.record_type) ?? "project";

    if (recordType === "unit") {
      const unitLabel = getPropertyMainLabel(row, "Unidad");
      const parentId = toText(row.parent_property_id);
      const parent = parentId ? state.portalProjectsById.get(parentId) : null;
      const parentLabel = parent ? getPropertyMainLabel(parent, "Promocion") : parentId ?? "sin padre";
      const typedLabel = `Unidad hija | ${unitLabel} | Padre: ${parentLabel}`;
      return status ? `${typedLabel} | ${status}` : typedLabel;
    }

    const main = getPropertyMainLabel(row, "Promocion");
    const typedLabel = recordType === "project" ? `Promocion | ${main}` : `Propiedad | ${main}`;
    if (!status) return typedLabel;
    return `${typedLabel} | ${status}`;
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
    return state.portalProjectsById.get(normalized) ?? null;
  };

  const getPortalAccountLabel = (portalAccountId) => {
    const normalized = toText(portalAccountId);
    if (!normalized) return "Cuenta portal";
    const label = state.portalAccountsById.get(normalized);
    return label ?? "Cuenta portal";
  };

  const resolveProjectPropertyIdFromForm = (formData, selectFieldName, manualFieldName) => {
    const selected = toText(formData.get(selectFieldName));
    const manual = toText(formData.get(manualFieldName));
    return manual ?? selected ?? null;
  };

  const isSelfSignupInvite = (entry) => {
    const row = asObject(entry);
    const metadata = asObject(row.metadata);
    return toText(metadata.request_type) === "self_signup";
  };

  const isPendingRegistrationRequest = (entry) => {
    const row = asObject(entry);
    const metadata = asObject(row.metadata);
    const approvalStatus = toText(metadata.approval_status) ?? "requested";
    const inviteStatus = toText(row.status) ?? "";
    return isSelfSignupInvite(row) && approvalStatus === "requested" && inviteStatus === "pending";
  };

  const buildInviteSharePayload = ({ email, code, projectId }) => {
    const inviteEmail = toText(email);
    const inviteCode = toText(code);
    if (!inviteEmail || !inviteCode) return null;

    const activationUrl = new URL("/es/portal/activate/", window.location.origin);
    activationUrl.searchParams.set("organization_id", state.organizationId);
    activationUrl.searchParams.set("email", inviteEmail);
    if (projectId) activationUrl.searchParams.set("project_property_id", projectId);

    const linkedProject = getProjectById(projectId);
    const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : projectId;
    const activationUrlText = activationUrl.toString();
    const subject = "Invitacion de acceso al portal de BlancaReal";
    const message = [
      "Hola,",
      "",
      "Te compartimos tu acceso al portal de BlancaReal.",
      `Enlace de activacion: ${activationUrlText}`,
      `Email invitado: ${inviteEmail}`,
      `Codigo de un solo uso: ${inviteCode}`,
      "",
      projectLabel ? `Promocion asignada: ${projectLabel}` : "Promocion asignada: acceso general",
      "",
      "Si necesitas ayuda para activar, responde a este mensaje.",
    ].join("\n");

    return {
      email: inviteEmail,
      code: inviteCode,
      activationUrl: activationUrlText,
      projectLabel,
      message,
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
      mailtoUrl: `mailto:${encodeURIComponent(inviteEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
    };
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
    setProjectSelectOptions(
      el.documentsFilterPropertySelect,
      state.portalProjects,
      "Todas las propiedades"
    );
    setProjectSelectOptions(
      el.documentsPropertySelect,
      state.portalProjects,
      "Selecciona una propiedad"
    );
    setProjectSelectOptions(
      el.documentsTreeProjectSelect,
      state.portalProjects.filter((entry) => (toText(entry?.record_type) ?? "project") === "project"),
      "Selecciona una promocion"
    );
  };

  const loadPortalProjects = async ({ force = false } = {}) => {
    if (!ensureOrganization()) return [];
    if (!force && state.portalProjectsLoadedForOrg === state.organizationId) {
      return state.portalProjects;
    }

    const firstPagePayload = await request(
      buildApiUrl("/api/v1/properties", {
        organization_id: state.organizationId,
        ...(page === "documents" ? {} : { record_type: "project" }),
        per_page: "200",
        page: "1",
      })
    );

    const firstRows = Array.isArray(firstPagePayload?.data) ? firstPagePayload.data : [];
    const totalPages = Math.max(1, Number(firstPagePayload?.meta?.total_pages || 1));
    const extraPayloads =
      totalPages > 1
        ? await Promise.all(
            Array.from({ length: totalPages - 1 }, (_, index) =>
              request(
                buildApiUrl("/api/v1/properties", {
                  organization_id: state.organizationId,
                  ...(page === "documents" ? {} : { record_type: "project" }),
                  per_page: "200",
                  page: String(index + 2),
                })
              )
            )
          )
        : [];

    const rows = [
      ...firstRows,
      ...extraPayloads.flatMap((payload) => (Array.isArray(payload?.data) ? payload.data : [])),
    ].filter((entry) => toText(entry?.id));

    if (page === "documents") {
      const allById = new Map();
      rows.forEach((entry) => {
        const id = toText(entry?.id);
        if (!id) return;
        allById.set(id, entry);
      });

      const projects = rows.filter(
        (entry) => (toText(entry?.record_type) ?? "") === "project" && isPortalEnabledProject(entry)
      );
      const projectIds = new Set(projects.map((entry) => toText(entry?.id)).filter(Boolean));
      const units = rows.filter((entry) => {
        const recordType = toText(entry?.record_type) ?? "";
        if (recordType !== "unit") return false;
        const parentId = toText(entry?.parent_property_id);
        return Boolean(parentId && projectIds.has(parentId));
      });

      state.portalProjects = [...projects, ...units]
        .filter((entry) => {
          const recordType = toText(entry?.record_type) ?? "project";
          return recordType === "project" || recordType === "unit";
        })
        .sort((a, b) => getProjectDisplayName(a).localeCompare(getProjectDisplayName(b), "es"));
      state.portalProjectsById = allById;
    } else {
      state.portalProjects = rows
        .filter((entry) => toText(entry?.id) && isPortalEnabledProject(entry))
        .sort((a, b) => getProjectDisplayName(a).localeCompare(getProjectDisplayName(b), "es"));
      state.portalProjectsById = new Map(
        state.portalProjects
          .map((entry) => {
            const id = toText(entry?.id);
            return id ? [id, entry] : null;
          })
          .filter(Boolean)
      );
    }

    state.portalProjectsLoadedForOrg = state.organizationId;
    renderProjectSelectors();
    renderDocumentsPropertyTree();
    syncDocumentsPropertyResolution();
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
  const renderRegistrationCounters = (counts = {}) => {
    if (el.registrationKpiRequested instanceof HTMLElement) {
      el.registrationKpiRequested.textContent = String(Number(counts.requested || 0));
    }
    if (el.registrationKpiApproved instanceof HTMLElement) {
      el.registrationKpiApproved.textContent = String(Number(counts.approved || 0));
    }
    if (el.registrationKpiRejected instanceof HTMLElement) {
      el.registrationKpiRejected.textContent = String(Number(counts.rejected || 0));
    }
  };

  const renderRegistrationRequests = (rows = [], meta = {}) => {
    if (!(el.registrationTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.registrationTbody.innerHTML = '<tr><td colspan="6">No hay solicitudes para este filtro.</td></tr>';
    } else {
      el.registrationTbody.innerHTML = rows
        .map((entry) => {
          const id = toText(entry.id) || "";
          const request = asObject(entry.request);
          const requester = asObject(request.requester);
          const approvalStatus = toText(request.approval_status) ?? "requested";
          const approvalText = dictLabel("registration-approval", approvalStatus, approvalStatus);
          const projectId = toText(entry.project_property_id);
          const linkedProject = getProjectById(projectId);
          const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : null;
          const requesterName = toText(requester.full_name);
          const requesterEmail = toText(requester.email) ?? toText(entry.email);
          const requesterCompanyName = toText(requester.company_name);
          const requesterCommercialName = toText(requester.commercial_name);
          const requesterLegalName = toText(requester.legal_name);
          const requesterCif = toText(requester.cif);
          const requesterPhone = toText(requester.phone);
          const requesterNotes = toText(requester.notes);
          const reviewedAt = toText(request.reviewed_at);
          const reviewedBy = toText(request.reviewed_by);
          const approvedInviteId = toText(request.approved_invite_id);
          const isPending = approvalStatus === "requested" && toText(entry.status) === "pending";

          const actionHtml = isPending
            ? `
                <div class="crm-actions-row">
                  <button
                    type="button"
                    class="crm-mini-btn"
                    data-action="approve-registration-request"
                    data-request-id="${esc(id)}"
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    class="crm-mini-btn danger"
                    data-action="reject-registration-request"
                    data-request-id="${esc(id)}"
                  >
                    Rechazar
                  </button>
                </div>
              `
            : approvedInviteId
              ? `<small>Invite generada<br />${esc(approvedInviteId)}</small>`
              : "<small>Sin acciones pendientes</small>";

          return `
            <tr>
              <td>
                <strong>${esc(requesterName ?? requesterEmail ?? "-")}</strong>
                ${requesterEmail ? `<br /><small>${esc(requesterEmail)}</small>` : ""}
                ${requesterCompanyName ? `<br /><small><strong>Empresa:</strong> ${esc(requesterCompanyName)}</small>` : ""}
                ${requesterCommercialName ? `<br /><small><strong>Comercial:</strong> ${esc(requesterCommercialName)}</small>` : ""}
                ${requesterLegalName ? `<br /><small><strong>Legal:</strong> ${esc(requesterLegalName)}</small>` : ""}
                ${requesterCif ? `<br /><small><strong>CIF:</strong> ${esc(requesterCif)}</small>` : ""}
                ${requesterPhone ? `<br /><small>${esc(requesterPhone)}</small>` : ""}
                ${requesterNotes ? `<br /><small class="portal-request-note">${esc(requesterNotes)}</small>` : ""}
              </td>
              <td>${
                projectLabel
                  ? `<strong>${esc(projectLabel)}</strong>`
                  : projectId
                    ? `<strong>${esc(projectId)}</strong>`
                    : "Sin promocion concreta"
              }</td>
              <td>
                <span class="crm-badge ${approvalStatusClass(approvalStatus)}">${esc(approvalText)}</span>
                <br />
                <small>${esc(inviteStatusLabel(entry.status))}</small>
              </td>
              <td>${esc(formatDateTime(request.requested_at || entry.created_at))}</td>
              <td>${
                reviewedAt
                  ? `${esc(formatDateTime(reviewedAt))}${reviewedBy ? `<br /><small>${esc(reviewedBy)}</small>` : ""}`
                  : "<small>Pendiente</small>"
              }</td>
              <td>${actionHtml}</td>
            </tr>
          `;
        })
        .join("");
    }

    if (el.registrationMeta instanceof HTMLElement) {
      const count = Number(meta.count || rows.length || 0);
      const total = Number(meta.total || count);
      const pageValue = Number(meta.page || 1);
      const totalPages = Number(meta.total_pages || 1);
      el.registrationMeta.textContent = `${count} filas visibles | total ${total} | pagina ${pageValue}/${totalPages}`;
    }

    if (el.registrationRequestsNote instanceof HTMLElement) {
      const pendingRequests = rows.filter((entry) => (toText(asObject(entry.request).approval_status) ?? "requested") === "requested").length;
      el.registrationRequestsNote.textContent =
        pendingRequests > 0
          ? `Pendientes en esta vista: ${pendingRequests}. Aprobando una solicitud se genera una invite real y aparece en el bloque inferior.`
          : "No hay aprobaciones pendientes en esta vista.";
      el.registrationRequestsNote.className = `crm-inline-note ${pendingRequests > 0 ? "warn" : ""}`;
    }
  };

  const renderInvites = (rows = [], meta = {}) => {
    if (!(el.invitesTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.invitesTbody.innerHTML = '<tr><td colspan="7">No hay invitaciones para este filtro.</td></tr>';
    } else {
      el.invitesTbody.innerHTML = rows
        .map((entry) => {
          const id = toText(entry.id) || "";
          const status = toText(entry.status) || "pending";
          const statusText = inviteStatusLabel(status);
          const projectId = toText(entry.project_property_id);
          const linkedProject = getProjectById(projectId);
          const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : null;
          const maxAttempts = Number(entry.max_attempts || 0);
          const attemptCount = Number(entry.attempt_count || 0);
          const isRevokable = status === "pending" || status === "blocked";
          const inviteTypeText = inviteTypeLabel(entry.invite_type);
          const roleText = portalRoleLabel(entry.role);
          const actionHtml = `
            <button
              type="button"
              class="crm-mini-btn danger"
              data-action="revoke-invite"
              data-invite-id="${esc(id)}"
              ${isRevokable ? "" : "disabled"}
            >
              Revocar
            </button>
          `;

          return `
            <tr>
              <td>
                <strong>${esc(entry.email || "-")}</strong>
              </td>
              <td>
                ${esc(inviteTypeText)}
                <br />
                <small>${esc(roleText)}</small>
              </td>
              <td>${
                projectLabel
                  ? `<strong>${esc(projectLabel)}</strong>`
                  : projectId
                    ? "Promocion vinculada"
                    : "Acceso general"
              }</td>
              <td><span class="crm-badge ${statusClass(status)}">${esc(statusText)}</span></td>
              <td>${esc(formatDateTime(entry.expires_at))}</td>
              <td>${esc(`${attemptCount}/${maxAttempts}`)}</td>
              <td>${actionHtml}</td>
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

  const loadRegistrationRequests = async () => {
    if (!ensureOrganization()) return;
    const filterForm =
      el.registrationFilterForm instanceof HTMLFormElement ? new FormData(el.registrationFilterForm) : null;
    const selectedStatus = toText(filterForm?.get("approval_status")) || "requested";
    const perPage = toText(filterForm?.get("per_page")) || "25";
    const email = toText(filterForm?.get("email"));

    const baseCounters = { organization_id: state.organizationId, page: "1", per_page: "1" };
    const [listPayload, requestedPayload, approvedPayload, rejectedPayload] = await Promise.all([
      request(
        buildApiUrl("/api/v1/crm/portal/registration-requests", {
          organization_id: state.organizationId,
          approval_status: selectedStatus,
          email,
          per_page: perPage,
          page: "1",
        })
      ),
      request(buildApiUrl("/api/v1/crm/portal/registration-requests", { ...baseCounters, approval_status: "requested" })),
      request(buildApiUrl("/api/v1/crm/portal/registration-requests", { ...baseCounters, approval_status: "approved" })),
      request(buildApiUrl("/api/v1/crm/portal/registration-requests", { ...baseCounters, approval_status: "rejected" })),
    ]);

    renderRegistrationCounters({
      requested: requestedPayload?.meta?.total || requestedPayload?.meta?.count || 0,
      approved: approvedPayload?.meta?.total || approvedPayload?.meta?.count || 0,
      rejected: rejectedPayload?.meta?.total || rejectedPayload?.meta?.count || 0,
    });

    renderRegistrationRequests(Array.isArray(listPayload?.data) ? listPayload.data : [], asObject(listPayload?.meta));
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
    const rows = (Array.isArray(payload?.data) ? payload.data : []).filter((entry) => !isSelfSignupInvite(entry));
    const meta = asObject(payload?.meta);
    renderInvites(rows, {
      ...meta,
      count: rows.length,
      total: rows.length,
      page: 1,
      total_pages: 1,
    });
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

    state.lastInviteShare = buildInviteSharePayload({
      email: inviteEmail,
      code,
      projectId: inviteProjectId,
    });
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

  const approveRegistrationRequest = async (requestId) => {
    if (!ensureOrganization() || !requestId) return;

    const response = await request("/api/v1/crm/portal/registration-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        request_id: requestId,
        action: "approve",
      }),
    });

    const approvedInvite = asObject(response?.data?.invite);
    const code = toText(response?.data?.one_time_code);
    const inviteEmail = toText(approvedInvite.email);
    const inviteProjectId = toText(approvedInvite.project_property_id);
    const approvalEmail = asObject(response?.meta?.approval_email);
    const emailSent = approvalEmail.sent === true;
    const emailAttempted = approvalEmail.attempted === true;
    const emailConfigMissing = toText(approvalEmail.error) === "portal_email_not_configured";
    const emailError = toText(approvalEmail.error);

    state.lastInviteShare = buildInviteSharePayload({
      email: inviteEmail,
      code,
      projectId: inviteProjectId,
    });
    renderInviteShare(state.lastInviteShare);

    if (el.inviteCode instanceof HTMLElement) {
      el.inviteCode.textContent = code
        ? `Solicitud aprobada. Codigo de un solo uso: ${code}.`
        : "Solicitud aprobada, pero no se pudo recuperar codigo visible.";
    }

    await loadRegistrationRequests();
    await loadInvites();
    if (emailSent) {
      setFeedback("Solicitud aprobada, invitacion generada y email de confirmacion enviado.", "ok");
      return;
    }
    if (emailConfigMissing) {
      setFeedback("Solicitud aprobada e invitacion generada. Falta configurar el envio automatico de email.", "warn");
      return;
    }
    if (emailAttempted) {
      setFeedback(
        emailError
          ? `Solicitud aprobada e invitacion generada, pero el email de confirmacion fallo: ${emailError}`
          : "Solicitud aprobada e invitacion generada, pero el email de confirmacion no pudo enviarse.",
        "warn"
      );
      return;
    }
    setFeedback("Solicitud aprobada e invitacion generada.", "ok");
  };

  const rejectRegistrationRequest = async (requestId) => {
    if (!ensureOrganization() || !requestId) return;
    const confirmed = window.confirm("Se rechazara esta solicitud de registro. Continuar?");
    if (!confirmed) return;

    await request("/api/v1/crm/portal/registration-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        request_id: requestId,
        action: "reject",
      }),
    });

    await loadRegistrationRequests();
    await loadInvites();
    setFeedback("Solicitud de registro rechazada.", "ok");
  };

  // USERS + MEMBERSHIPS
  const renderUsers = (rows = [], meta = {}) => {
    if (!(el.usersTbody instanceof HTMLElement)) return;
    state.portalAccountsById.clear();
    rows.forEach((entry) => {
      const id = toText(entry?.id);
      if (!id) return;
      const metadata = asObject(entry?.metadata);
      const email = toText(metadata.email);
      const fullName = toText(metadata.full_name);
      const label = fullName && email ? `${fullName} | ${email}` : fullName || email || "Cuenta portal";
      state.portalAccountsById.set(id, label);
    });

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
          const statusText = portalStatusLabel(status);
          const roleText = portalRoleLabel(entry.role);
          const stats = asObject(entry.membership_stats);
          const membershipsActive = Number(stats.memberships_active || 0);
          const membershipsTotal = Number(stats.memberships_total || 0);

          return `
            <tr>
              <td>
                <strong>${esc(email)}</strong>
                <br />
                <small>${esc(fullName)}</small>
              </td>
              <td>${esc(roleText)}</td>
              <td><span class="crm-badge ${statusClass(status)}">${esc(statusText)}</span></td>
              <td>${esc(`${membershipsActive}/${membershipsTotal}`)}</td>
              <td>${esc(formatDateTime(entry.last_login_at))}</td>
              <td>
                <div class="crm-actions-row">
                  <select data-account-status="${esc(id)}" data-dictionary="portal-status" aria-label="Estado de cuenta ${esc(email)}">
                    <option value="pending" ${status === "pending" ? "selected" : ""}>${esc(portalStatusLabel("pending"))}</option>
                    <option value="active" ${status === "active" ? "selected" : ""}>${esc(portalStatusLabel("active"))}</option>
                    <option value="blocked" ${status === "blocked" ? "selected" : ""}>${esc(portalStatusLabel("blocked"))}</option>
                    <option value="revoked" ${status === "revoked" ? "selected" : ""}>${esc(portalStatusLabel("revoked"))}</option>
                  </select>
                  <button type="button" class="crm-mini-btn" data-action="save-account-status" data-account-id="${esc(id)}">
                    Guardar
                  </button>
                  <button type="button" class="crm-mini-btn" data-action="use-account-id" data-account-id="${esc(id)}">
                    Usar en membresia
                  </button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    crmLabels?.applySelectDictionaries?.(el.usersTbody);

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
        const statusText = portalStatusLabel(status);
        const accessScopeText = membershipScopeLabel(entry.access_scope);
        const projectId = toText(entry.project_property_id);
        const linkedProject = getProjectById(projectId);
        const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : null;
        return `
          <tr>
            <td>${esc(getPortalAccountLabel(entry.portal_account_id))}</td>
            <td>${
              projectLabel ? `<strong>${esc(projectLabel)}</strong>` : "Promocion asignada"
            }</td>
            <td>${esc(accessScopeText)}</td>
            <td><span class="crm-badge ${statusClass(status)}">${esc(statusText)}</span></td>
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
      setFeedback("Debes indicar una cuenta portal y una promocion valida.", "error");
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
          const publicationText = publicationLabel(published);
          const projectId = toText(entry.project_property_id);
          const linkedProject = getProjectById(projectId);
          const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : "Promocion asignada";
          const audienceText = audienceLabel(entry.audience);
          return `
            <tr>
              <td>${esc(projectLabel)}</td>
              <td>${esc(`${entry.language || "-"} / ${audienceText}`)}</td>
              <td>${esc(entry.section_key || "-")}</td>
              <td>${esc(entry.title || "-")}</td>
              <td>${esc(String(entry.sort_order ?? 0))}</td>
              <td><span class="crm-badge ${published ? "ok" : "warn"}">${esc(publicationText)}</span></td>
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

  // DOCUMENTS
  const getCurrentDocumentsPropertyId = () => {
    if (!(el.documentsForm instanceof HTMLFormElement)) return null;
    const formData = new FormData(el.documentsForm);
    return toText(formData.get("property_id"));
  };

  const syncDocumentsPropertyResolution = () => {
    if (!(el.documentsPropertyResolution instanceof HTMLElement)) return;
    const selectedPropertyId = getCurrentDocumentsPropertyId();
    if (!selectedPropertyId) {
      el.documentsPropertyResolution.textContent =
        "Selecciona una propiedad. Si eliges unidad hija, se vinculara automaticamente a su promocion padre.";
      return;
    }

    const selectedProperty = getProjectById(selectedPropertyId);
    const selectedType = toText(selectedProperty?.record_type) ?? "project";
    const parentId =
      selectedType === "unit"
        ? toText(selectedProperty?.parent_property_id)
        : toText(selectedProperty?.id) ?? selectedPropertyId;
    const parentProject = parentId ? getProjectById(parentId) : null;

    if (selectedType === "unit") {
      el.documentsPropertyResolution.textContent = `Unidad hija seleccionada. El documento quedara publicado en la promocion padre: ${getProjectDisplayName(
        parentProject ?? { id: parentId }
      )}.`;
      return;
    }

    el.documentsPropertyResolution.textContent = `Promocion padre seleccionada: ${getProjectDisplayName(
      selectedProperty ?? { id: selectedPropertyId }
    )}.`;
  };

  const renderDocumentsPropertyTree = () => {
    if (!(el.documentsTreeList instanceof HTMLElement)) return;
    const selectedProjectId =
      el.documentsTreeProjectSelect instanceof HTMLSelectElement ? toText(el.documentsTreeProjectSelect.value) : null;

    if (!selectedProjectId) {
      el.documentsTreeList.innerHTML = "<li>Selecciona una promocion para ver las propiedades hijas.</li>";
      return;
    }

    const project = getProjectById(selectedProjectId);
    const units = state.portalProjects.filter((entry) => {
      const recordType = toText(entry?.record_type) ?? "";
      const parentId = toText(entry?.parent_property_id);
      return recordType === "unit" && parentId === selectedProjectId;
    });

    const projectLabel = getProjectDisplayName(project ?? { id: selectedProjectId });
    if (!units.length) {
      el.documentsTreeList.innerHTML = `<li><strong>${esc(projectLabel)}</strong>: sin unidades hijas registradas.</li>`;
      return;
    }

    el.documentsTreeList.innerHTML = [
      `<li><strong>${esc(projectLabel)}</strong> (${units.length} unidades hijas)</li>`,
      ...units.map((entry) => {
        const unitId = toText(entry?.id) ?? "-";
        const unitLabel = getProjectDisplayName(entry);
        return `<li><small>${esc(unitId)}</small> | ${esc(unitLabel)}</li>`;
      }),
    ].join("");
  };

  const renderDocuments = (rows = [], meta = {}) => {
    if (!(el.documentsTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.documentsTbody.innerHTML = '<tr><td colspan="7">No hay documentos para el filtro actual.</td></tr>';
    } else {
      el.documentsTbody.innerHTML = rows
        .map((entry) => {
          const id = toText(entry.id) || "";
          const projectId = toText(entry.project_property_id);
          const sourcePropertyId = toText(entry.property_id) ?? projectId;
          const sourceProperty = getProjectById(sourcePropertyId);
          const linkedProject = getProjectById(projectId);
          const projectLabel = linkedProject ? getProjectDisplayName(linkedProject) : "Promocion asignada";
          const sourceLabel = sourceProperty ? getProjectDisplayName(sourceProperty) : sourcePropertyId ?? projectLabel;
          const relationLabel =
            sourcePropertyId && projectId && sourcePropertyId !== projectId
              ? `${sourceLabel} -> Padre: ${projectLabel}`
              : projectLabel;
          const visibility = toText(entry.portal_visibility) || "both";
          const published = Boolean(entry.portal_is_published);
          const publicationText = publicationLabel(published);
          const createdAt = toText(entry.portal_published_at) ?? toText(entry.created_at);
          const downloadUrl = toText(entry.download_url);
          const title = toText(entry.title) || "Documento";
          const mimeType = toText(entry.mime_type) || "-";
          const sizeText = formatBytes(entry.file_size_bytes);

          return `
            <tr>
              <td>
                <strong>${esc(title)}</strong><br />
                <small>${esc(`${mimeType} | ${sizeText}`)}</small>
              </td>
              <td>${esc(relationLabel)}</td>
              <td><span class="crm-badge ${statusClass(visibility)}">${esc(portalVisibilityLabel(visibility))}</span></td>
              <td><span class="crm-badge ${published ? "ok" : "warn"}">${esc(publicationText)}</span></td>
              <td>${esc(formatDateTime(createdAt))}</td>
              <td>
                ${
                  downloadUrl
                    ? `<a class="crm-mini-btn" href="${esc(downloadUrl)}" target="_blank" rel="noopener noreferrer">Descargar</a>`
                    : '<small class="crm-inline-note">No disponible</small>'
                }
              </td>
              <td>
                <div class="crm-actions-row">
                  <button type="button" class="crm-mini-btn" data-action="edit-document" data-document-id="${esc(id)}">Editar</button>
                  <button type="button" class="crm-mini-btn" data-action="toggle-document-published" data-document-id="${esc(id)}" data-document-published="${published ? "1" : "0"}">
                    ${published ? "Ocultar" : "Publicar"}
                  </button>
                  <button type="button" class="crm-mini-btn danger" data-action="delete-document" data-document-id="${esc(id)}">Borrar</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (el.documentsMeta instanceof HTMLElement) {
      const count = Number(meta.count || rows.length || 0);
      const total = Number(meta.total || count);
      const pageValue = Number(meta.page || 1);
      const totalPages = Number(meta.total_pages || 1);
      el.documentsMeta.textContent = `${count} filas visibles | total ${total} | pagina ${pageValue}/${totalPages}`;
    }
  };

  const loadDocuments = async () => {
    if (!ensureOrganization()) return;
    const filterForm = el.documentsFilterForm instanceof HTMLFormElement ? new FormData(el.documentsFilterForm) : null;
    const propertyId = filterForm ? toText(filterForm.get("property_id")) : null;
    const params = {
      organization_id: state.organizationId,
      property_id: propertyId,
      portal_visibility: toText(filterForm?.get("portal_visibility")),
      portal_is_published: toText(filterForm?.get("portal_is_published")),
      q: toText(filterForm?.get("q")),
      page: "1",
      per_page: toText(filterForm?.get("per_page")) || "25",
    };

    const payload = await request(buildApiUrl("/api/v1/crm/portal/documents", params));
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    renderDocuments(rows, asObject(payload?.meta));
    root.dataset.documentRows = JSON.stringify(rows);
  };

  const resetDocumentsForm = () => {
    if (!(el.documentsForm instanceof HTMLFormElement)) return;
    el.documentsForm.reset();
    if (el.documentsIdInput instanceof HTMLInputElement) el.documentsIdInput.value = "";
    if (el.documentsPropertySelect instanceof HTMLSelectElement) el.documentsPropertySelect.value = "";
    const publishedField = el.documentsForm.elements.namedItem("portal_is_published");
    if (publishedField instanceof HTMLInputElement) publishedField.checked = true;
    syncDocumentsPropertyResolution();
  };

  const getCachedDocumentRows = () => {
    const raw = toText(root.dataset.documentRows);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const fillDocumentForm = (documentId) => {
    if (!documentId || !(el.documentsForm instanceof HTMLFormElement)) return;
    const rows = getCachedDocumentRows();
    const row = rows.find((entry) => toText(entry.id) === documentId);
    if (!row) return;

    const setFieldValue = (name, value) => {
      const field = el.documentsForm.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
        field.value = value == null ? "" : String(value);
      }
    };

    const propertyId = toText(row.property_id) ?? toText(row.project_property_id);
    if (el.documentsPropertySelect instanceof HTMLSelectElement && propertyId) {
      const hasPropertyOption = Array.from(el.documentsPropertySelect.options).some(
        (option) => toText(option.value) === propertyId
      );
      if (hasPropertyOption) {
        el.documentsPropertySelect.value = propertyId;
      } else {
        el.documentsPropertySelect.value = "";
      }
    }

    setFieldValue("id", row.id);
    setFieldValue("title", row.title || "");
    setFieldValue("portal_visibility", row.portal_visibility || "both");

    const publishedField = el.documentsForm.elements.namedItem("portal_is_published");
    if (publishedField instanceof HTMLInputElement) {
      publishedField.checked = Boolean(row.portal_is_published);
    }

    syncDocumentsPropertyResolution();
    const titleField = el.documentsForm.elements.namedItem("title");
    if (titleField instanceof HTMLInputElement) titleField.focus();
  };

  const saveDocument = async () => {
    if (!ensureOrganization() || !(el.documentsForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.documentsForm);
    const documentId = toText(formData.get("id"));
    const propertyId = toText(formData.get("property_id"));
    const title = toText(formData.get("title"));
    const portalVisibility = toText(formData.get("portal_visibility")) || "both";
    const portalIsPublished = formData.get("portal_is_published") === "on";

    if (!propertyId || !title) {
      setFeedback("Propiedad y titulo son obligatorios.", "error");
      return;
    }

    if (documentId) {
      await request("/api/v1/crm/portal/documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: state.organizationId,
          id: documentId,
          property_id: propertyId,
          title,
          portal_visibility: portalVisibility,
          portal_is_published: portalIsPublished,
        }),
      });

      await loadDocuments();
      setFeedback("Documento actualizado.", "ok");
      return;
    }

    const fileValue = formData.get("file");
    if (!(fileValue instanceof File) || fileValue.size <= 0) {
      setFeedback("Debes seleccionar un archivo para subir.", "error");
      return;
    }

    const uploadPayload = new FormData();
    uploadPayload.set("organization_id", state.organizationId);
    uploadPayload.set("property_id", propertyId);
    uploadPayload.set("title", title);
    uploadPayload.set("portal_visibility", portalVisibility);
    uploadPayload.set("portal_is_published", portalIsPublished ? "true" : "false");
    uploadPayload.set("is_private", "true");
    uploadPayload.set("file", fileValue);

    await request("/api/v1/crm/portal/documents/upload", {
      method: "POST",
      body: uploadPayload,
    });

    await loadDocuments();
    resetDocumentsForm();
    const titleField = el.documentsForm.elements.namedItem("title");
    if (titleField instanceof HTMLInputElement) titleField.focus();
    setFeedback("Documento subido y guardado.", "ok");
  };

  const toggleDocumentPublished = async (documentId, current) => {
    if (!ensureOrganization() || !documentId) return;
    await request("/api/v1/crm/portal/documents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        id: documentId,
        portal_is_published: !current,
      }),
    });
    await loadDocuments();
    setFeedback(!current ? "Documento publicado." : "Documento ocultado.", "ok");
  };

  const deleteDocument = async (documentId) => {
    if (!ensureOrganization() || !documentId) return;
    const confirmed = window.confirm("Se eliminara este documento del portal. Continuar?");
    if (!confirmed) return;

    await request("/api/v1/crm/portal/documents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId,
        id: documentId,
      }),
    });

    await loadDocuments();
    setFeedback("Documento eliminado.", "ok");
  };

  // LOGS
  const renderLogs = (rows = [], meta = {}) => {
    if (!(el.logsTbody instanceof HTMLElement)) return;
    if (!rows.length) {
      el.logsTbody.innerHTML = '<tr><td colspan="5">No hay eventos para el filtro aplicado.</td></tr>';
    } else {
      el.logsTbody.innerHTML = rows
        .map((entry) => {
          const eventType = toText(entry.event_type) || "-";
          const eventTypeText = logEventTypeLabel(eventType);
          return `
            <tr>
              <td>${esc(formatDateTime(entry.created_at))}</td>
              <td><span class="crm-badge ${statusClass(eventType)}">${esc(eventTypeText)}</span></td>
              <td>${esc(entry.email || "-")}</td>
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
    try {
      const payload = await requestPortalAdmin(buildApiUrl("/api/v1/portal/access-logs", params));
      renderLogs(Array.isArray(payload?.data) ? payload.data : [], asObject(payload?.meta));
    } catch (error) {
      if (!isLogsAccessErrorCode(error?.code)) throw error;
      renderLogs([], {
        count: 0,
        total: 0,
        page: 1,
        total_pages: 1,
      });
      if (el.logsMeta instanceof HTMLElement) {
        el.logsMeta.textContent =
          "Acceso restringido: inicia sesion con portal_agent_admin autorizado (rafael@blancareal.com).";
      }
      setFeedback(
        "Logs bloqueados para esta sesion. Solo admin autorizado puede acceder.",
        "error"
      );
    }
  };

  // DASHBOARD
  const loadDashboard = async () => {
    if (!ensureOrganization()) return;
    const base = { organization_id: state.organizationId, page: "1", per_page: "1" };

    const [invitesPayload, signupRequestsPayload, usersPayload, contentPayload, documentsPayload] = await Promise.all([
      request(buildApiUrl("/api/v1/portal/invites", base)),
      request(
        buildApiUrl("/api/v1/crm/portal/registration-requests", {
          ...base,
          approval_status: "requested",
        })
      ),
      request(buildApiUrl("/api/v1/crm/portal/users", base)),
      request(buildApiUrl("/api/v1/crm/portal/content", base)),
      request(buildApiUrl("/api/v1/crm/portal/documents", base)),
    ]);

    let logsPayload = null;
    try {
      logsPayload = await requestPortalAdmin(buildApiUrl("/api/v1/portal/access-logs", { ...base, per_page: "5" }));
    } catch (error) {
      if (!isLogsAccessErrorCode(error?.code)) throw error;
      logsPayload = null;
    }

    if (el.kpiInvites instanceof HTMLElement) {
      el.kpiInvites.textContent = String(Number(invitesPayload?.meta?.total || invitesPayload?.meta?.count || 0));
    }
    if (el.kpiSignupRequests instanceof HTMLElement) {
      el.kpiSignupRequests.textContent = String(
        Number(signupRequestsPayload?.meta?.total || signupRequestsPayload?.meta?.count || 0)
      );
    }
    if (el.kpiUsers instanceof HTMLElement) {
      el.kpiUsers.textContent = String(Number(usersPayload?.meta?.total || usersPayload?.meta?.count || 0));
    }
    if (el.kpiContent instanceof HTMLElement) {
      el.kpiContent.textContent = String(Number(contentPayload?.meta?.total || contentPayload?.meta?.count || 0));
    }
    if (el.kpiDocuments instanceof HTMLElement) {
      el.kpiDocuments.textContent = String(
        Number(documentsPayload?.meta?.total || documentsPayload?.meta?.count || 0)
      );
    }
    if (el.kpiLogs instanceof HTMLElement) {
      if (logsPayload) {
        el.kpiLogs.textContent = String(Number(logsPayload?.meta?.total || logsPayload?.meta?.count || 0));
      } else {
        el.kpiLogs.textContent = "Privado";
      }
    }
  };

  const handleOrgSubmit = async (event) => {
    event.preventDefault();
    const nextId = toText(el.orgInput instanceof HTMLInputElement ? el.orgInput.value : "");
    const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
    const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
    const fallbackOrganizationId = localOrganizationId || defaultOrganizationId || state.organizationId;
    state.organizationId = nextId || fallbackOrganizationId || "";
    state.organizationSource = nextId
      ? "manual"
      : state.organizationId && state.organizationId === defaultOrganizationId
        ? "default"
        : state.organizationId
          ? "local"
          : "none";
    state.portalProjects = [];
    state.portalProjectsLoadedForOrg = null;
    state.portalProjectsById = new Map();
    state.portalAccountsById.clear();
    state.lastInviteShare = null;
    persistOrganization();
    updateUrlOrganization();
    renderOrganizationContext();
    renderProjectSelectors();
    renderInviteShare(null);
    setFeedback(
      !nextId && fallbackOrganizationId
        ? "Se mantiene la organizacion activa en CRM."
        : state.organizationId
          ? "Organizacion activa actualizada."
          : "Sin organizacion configurada.",
      state.organizationId ? "ok" : "error"
    );
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
    state.portalProjectsById = new Map();
    state.portalAccountsById.clear();
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
        if (el.kpiSignupRequests instanceof HTMLElement) el.kpiSignupRequests.textContent = "-";
        if (el.kpiUsers instanceof HTMLElement) el.kpiUsers.textContent = "-";
        if (el.kpiContent instanceof HTMLElement) el.kpiContent.textContent = "-";
        if (el.kpiDocuments instanceof HTMLElement) el.kpiDocuments.textContent = "-";
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
          state.portalProjectsById = new Map();
          renderProjectSelectors();
        }
        normalizeInviteRoleByType();
        await loadRegistrationRequests();
        await loadInvites();
      } else if (page === "users") {
        try {
          await loadPortalProjects();
        } catch {
          state.portalProjects = [];
          state.portalProjectsLoadedForOrg = null;
          state.portalProjectsById = new Map();
          renderProjectSelectors();
        }
        await loadUsers();
        await loadMemberships();
      } else if (page === "content") {
        try {
          await loadPortalProjects();
        } catch {
          state.portalProjects = [];
          state.portalProjectsLoadedForOrg = null;
          state.portalProjectsById = new Map();
          renderProjectSelectors();
        }
        await loadContent();
      } else if (page === "documents") {
        try {
          await loadPortalProjects();
        } catch {
          state.portalProjects = [];
          state.portalProjectsLoadedForOrg = null;
          state.portalProjectsById = new Map();
          renderProjectSelectors();
          renderDocumentsPropertyTree();
          syncDocumentsPropertyResolution();
        }
        await loadDocuments();
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

  if (el.documentsPropertySelect instanceof HTMLSelectElement) {
    el.documentsPropertySelect.addEventListener("change", () => {
      syncDocumentsPropertyResolution();
    });
  }

  if (el.documentsTreeForm instanceof HTMLFormElement) {
    el.documentsTreeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      renderDocumentsPropertyTree();
    });
  }

  if (el.documentsTreeProjectSelect instanceof HTMLSelectElement) {
    el.documentsTreeProjectSelect.addEventListener("change", () => {
      renderDocumentsPropertyTree();
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

  if (el.registrationFilterForm instanceof HTMLFormElement) {
    el.registrationFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadRegistrationRequests();
          setFeedback("Solicitudes actualizadas.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando solicitudes: ${message}`, "error");
        }
      })();
    });
  }

  el.registrationClearBtn?.addEventListener("click", () => {
    clearForm(el.registrationFilterForm);
    void (async () => {
      try {
        await loadRegistrationRequests();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`Error limpiando filtros de solicitudes: ${message}`, "error");
      }
    })();
  });

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

  el.registrationTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const approveButton = target.closest("button[data-action='approve-registration-request']");
    if (approveButton) {
      const requestId = toText(approveButton.getAttribute("data-request-id"));
      if (!requestId) return;
      void (async () => {
        try {
          await approveRegistrationRequest(requestId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo aprobar solicitud: ${message}`, "error");
        }
      })();
      return;
    }

    const rejectButton = target.closest("button[data-action='reject-registration-request']");
    if (rejectButton) {
      const requestId = toText(rejectButton.getAttribute("data-request-id"));
      if (!requestId) return;
      void (async () => {
        try {
          await rejectRegistrationRequest(requestId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo rechazar solicitud: ${message}`, "error");
        }
      })();
      return;
    }
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
        setFeedback("Cuenta portal preparada en el formulario de membresia.", "ok");
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

  if (el.documentsFilterForm instanceof HTMLFormElement) {
    el.documentsFilterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await loadDocuments();
          setFeedback("Documentos actualizados.", "ok");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`Error cargando documentos: ${message}`, "error");
        }
      })();
    });
  }

  el.documentsFilterClearBtn?.addEventListener("click", () => {
    clearForm(el.documentsFilterForm);
    void (async () => {
      try {
        await loadDocuments();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`Error limpiando filtros de documentos: ${message}`, "error");
      }
    })();
  });

  if (el.documentsForm instanceof HTMLFormElement) {
    el.documentsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          await saveDocument();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo guardar documento: ${message}`, "error");
        }
      })();
    });
  }

  el.documentsNewBtn?.addEventListener("click", () => {
    resetDocumentsForm();
    setFeedback("Formulario listo para subir un documento nuevo.", "ok");
  });

  el.documentsTbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editButton = target.closest("button[data-action='edit-document']");
    if (editButton) {
      const documentId = toText(editButton.getAttribute("data-document-id"));
      if (!documentId) return;
      fillDocumentForm(documentId);
      setFeedback("Documento cargado en formulario para edicion.", "ok");
      return;
    }

    const toggleButton = target.closest("button[data-action='toggle-document-published']");
    if (toggleButton) {
      const documentId = toText(toggleButton.getAttribute("data-document-id"));
      const current = toText(toggleButton.getAttribute("data-document-published")) === "1";
      if (!documentId) return;
      void (async () => {
        try {
          await toggleDocumentPublished(documentId, current);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo cambiar publicacion: ${message}`, "error");
        }
      })();
      return;
    }

    const deleteButton = target.closest("button[data-action='delete-document']");
    if (deleteButton) {
      const documentId = toText(deleteButton.getAttribute("data-document-id"));
      if (!documentId) return;
      void (async () => {
        try {
          await deleteDocument(documentId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedback(`No se pudo borrar documento: ${message}`, "error");
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

  crmLabels?.applySelectDictionaries?.(root);
  initContext();
  void loadCurrentPage();
})();
