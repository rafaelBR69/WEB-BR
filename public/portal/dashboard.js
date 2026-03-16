import {
  asObject,
  buildPortalApiUrl,
  buildPortalAuthHeaders,
  clearSession,
  escapeHtml,
  getBootstrap,
  isPortalAuthErrorCode,
  isSessionAuthenticated,
  isSessionExpired,
  loadSession,
  pickProjectTitle,
  portalPath,
  refreshPortalSession,
  requestJson,
  roleLabel,
  statusBadgeClass,
  statusLabel,
  toText,
  withSessionOrganization,
} from "/portal/shared.js";

const bootstrap = getBootstrap();
const lang = bootstrap.lang;
const isSpanish = lang === "es";

const feedback = document.getElementById("portal-dashboard-feedback");
const accountBox = document.getElementById("portal-dashboard-account");
const projectsList = document.getElementById("portal-dashboard-projects");
const refreshButton = document.getElementById("portal-dashboard-refresh");
const logoutButton = document.getElementById("portal-dashboard-logout");

const kpiProjects = document.getElementById("portal-kpi-projects");
const kpiDocuments = document.getElementById("portal-kpi-documents");
const loadingShell = document.getElementById("portal-auth-loading");
const loadingShellText = document.querySelector("[data-portal-loading-text]");
const privateShell = document.getElementById("portal-private-shell");

const state = {
  session: null,
  me: null,
  projects: [],
  documentsCount: 0,
};

const setFeedback = (message, kind = "warn") => {
  if (!(feedback instanceof HTMLElement)) return;
  feedback.textContent = message;
  feedback.classList.remove("is-ok", "is-warn", "is-error");
  if (kind === "ok") feedback.classList.add("is-ok");
  else if (kind === "error") feedback.classList.add("is-error");
  else feedback.classList.add("is-warn");
};

const setLoadingMessage = (message) => {
  if (!(loadingShellText instanceof HTMLElement)) return;
  loadingShellText.textContent = message;
};

const showPrivateShell = () => {
  if (privateShell instanceof HTMLElement) {
    privateShell.removeAttribute("hidden");
  }
  if (loadingShell instanceof HTMLElement) {
    loadingShell.setAttribute("hidden", "");
  }
};

const redirectToLogin = (reason = null) => {
  const loginUrl = new URL(portalPath(lang, "/portal/login"), window.location.origin);
  loginUrl.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
  if (reason) loginUrl.searchParams.set("reason", reason);
  window.location.href = loginUrl.toString();
};

const ensureSession = async () => {
  const session = loadSession();
  if (!session || !isSessionAuthenticated(session)) {
    redirectToLogin("missing_session");
    return null;
  }
  if (isSessionExpired(session)) {
    const refreshed = await refreshPortalSession(session);
    if (refreshed && !isSessionExpired(refreshed)) {
      return refreshed;
    }
    clearSession();
    redirectToLogin("expired_session");
    return null;
  }
  return session;
};

const requestAuthed = async (path, params = {}, init = {}) => {
  const requestOnce = () => {
    const headers = buildPortalAuthHeaders(state.session, init.headers ?? {});
    const scopedParams = withSessionOrganization(params, state.session);
    return requestJson(buildPortalApiUrl(path, scopedParams), {
      ...init,
      headers,
    });
  };

  try {
    return await requestOnce();
  } catch (error) {
    const code = toText(error?.code);
    const canRetry = code === "invalid_auth_token" || code === "auth_token_required";
    if (!canRetry || !state.session) throw error;

    const refreshed = await refreshPortalSession(state.session);
    if (!refreshed || isSessionExpired(refreshed)) throw error;
    state.session = refreshed;
    return requestOnce();
  }
};

const handlePossibleAuthFailure = (error) => {
  const code = toText(error?.code);
  if (!isPortalAuthErrorCode(code)) return false;
  clearSession();
  redirectToLogin(code);
  return true;
};

const renderAccount = () => {
  if (!(accountBox instanceof HTMLElement)) return;

  const session = state.session;
  const portalAccount = asObject(state.me?.portal_account);
  const memberships = Array.isArray(state.me?.memberships) ? state.me.memberships : [];

  if (!session) {
    accountBox.innerHTML = isSpanish ? "Sesion no disponible." : "Session not available.";
    return;
  }

  accountBox.innerHTML = `
    <div class="portal-badges">
      <span class="portal-badge role">${escapeHtml(roleLabel(portalAccount.role ?? session.role, lang))}</span>
      <span class="portal-badge ${escapeHtml(statusBadgeClass(portalAccount.status))}">
        ${escapeHtml(statusLabel(portalAccount.status, lang))}
      </span>
    </div>
    <p><strong>${isSpanish ? "Cuenta" : "Account"}:</strong> ${escapeHtml(toText(session.email) ?? "-")}</p>
    <p><strong>${isSpanish ? "Accesos" : "Accesses"}:</strong> ${escapeHtml(String(memberships.length))}</p>
    <p class="portal-note">${escapeHtml(
      isSpanish
        ? "Usa una promocion para abrir contenidos y descargar documentacion publicada."
        : "Open a project to review content and download published documentation."
    )}</p>
  `;
};

const renderKpis = () => {
  if (kpiProjects instanceof HTMLElement) kpiProjects.textContent = String(state.projects.length);
  if (kpiDocuments instanceof HTMLElement) kpiDocuments.textContent = String(state.documentsCount);
};

const renderProjects = () => {
  if (!(projectsList instanceof HTMLElement)) return;
  if (!state.projects.length) {
    projectsList.innerHTML = `<li class="portal-empty">${
      isSpanish ? "No hay promociones activas asignadas." : "No active assigned projects."
    }</li>`;
    return;
  }

  projectsList.innerHTML = state.projects
    .map((project) => {
      const projectId = toText(project.id) ?? "";
      const title = pickProjectTitle(project, lang);
      const status = toText(project.status) ?? "-";
      const availableUnitsCount = Number(project.available_units_count ?? 0);
      return `
        <li class="portal-item">
          <p class="portal-item-title">${escapeHtml(title)}</p>
          <p class="portal-item-meta">${escapeHtml(
            isSpanish ? "Biblioteca visual y documental disponible para esta promocion." : "Visual and document library available for this project."
          )}</p>
          <p class="portal-item-meta">${escapeHtml(
            isSpanish
              ? `Viviendas disponibles: ${availableUnitsCount}`
              : `Available units: ${availableUnitsCount}`
          )}</p>
          <div class="portal-badges">
            <span class="portal-badge ${statusBadgeClass(status)}">${escapeHtml(statusLabel(status, lang))}</span>
          </div>
          <div class="portal-actions">
            <a class="portal-button portal-button-soft" href="${escapeHtml(
              portalPath(lang, `/portal/project/${projectId}`)
            )}">${isSpanish ? "Abrir biblioteca" : "Open library"}</a>
          </div>
        </li>
      `;
    })
    .join("");
};

const loadDocumentsCount = async () => {
  const projectIds = state.projects
    .map((project) => toText(project.id))
    .filter((value) => Boolean(value))
    .slice(0, 12);

  if (!projectIds.length) {
    state.documentsCount = 0;
    renderKpis();
    return;
  }

  const payloads = await Promise.all(
    projectIds.map((id) => requestAuthed(`/projects/${encodeURIComponent(id)}/documents`))
  );

  state.documentsCount = payloads.reduce((acc, payload) => {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return acc + rows.length;
  }, 0);

  renderKpis();
};

const loadDashboard = async () => {
  const session = await ensureSession();
  if (!session) return;
  state.session = session;
  showPrivateShell();

  const loadingMessage = isSpanish ? "Cargando panel..." : "Loading dashboard...";
  setLoadingMessage(loadingMessage);
  setFeedback(loadingMessage, "warn");

  try {
    const [mePayload, projectsPayload] = await Promise.all([requestAuthed("/me"), requestAuthed("/projects")]);

    state.me = mePayload?.data ?? null;
    const projectsFromProjectsApi = Array.isArray(projectsPayload?.data) ? projectsPayload.data : [];
    const projectsFromMe = Array.isArray(state.me?.projects) ? state.me.projects : [];
    state.projects = projectsFromProjectsApi.length ? projectsFromProjectsApi : projectsFromMe;
    state.documentsCount = 0;

    renderAccount();
    renderProjects();
    renderKpis();

    try {
      await loadDocumentsCount();
    } catch {
      state.documentsCount = 0;
      renderKpis();
    }

    setFeedback(
      isSpanish
        ? `Panel actualizado (${state.projects.length} promociones, ${state.documentsCount} docs).`
        : `Dashboard updated (${state.projects.length} projects, ${state.documentsCount} docs).`,
      "ok"
    );
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(isSpanish ? `Error cargando dashboard: ${message}` : `Dashboard load error: ${message}`, "error");
  }
};

refreshButton?.addEventListener("click", async () => {
  await loadDashboard();
});

logoutButton?.addEventListener("click", () => {
  clearSession();
  const loginUrl = new URL(portalPath(lang, "/portal/login"), window.location.origin);
  window.location.href = loginUrl.toString();
});

loadDashboard();
