import {
  asObject,
  buildPortalApiUrl,
  buildPortalAuthHeaders,
  clearSession,
  escapeHtml,
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  getBootstrap,
  humanizeKey,
  isPortalAuthErrorCode,
  isSessionAuthenticated,
  isSessionExpired,
  loadSession,
  pickProjectTitle,
  portalPath,
  requestJson,
  roleLabel,
  statusBadgeClass,
  statusLabel,
  toText,
} from "/portal/shared.js";

const bootstrap = getBootstrap();
const lang = bootstrap.lang;
const locale = lang === "es" ? "es-ES" : "en-GB";
const isSpanish = lang === "es";

const feedback = document.getElementById("portal-dashboard-feedback");
const accountBox = document.getElementById("portal-dashboard-account");
const projectsList = document.getElementById("portal-dashboard-projects");
const leadsTbody = document.getElementById("portal-dashboard-leads-tbody");
const leadDetailBox = document.getElementById("portal-dashboard-lead-detail");
const commissionsTbody = document.getElementById("portal-dashboard-commissions-tbody");
const refreshButton = document.getElementById("portal-dashboard-refresh");
const logoutButton = document.getElementById("portal-dashboard-logout");

const kpiProjects = document.getElementById("portal-kpi-projects");
const kpiLeads = document.getElementById("portal-kpi-leads");
const kpiVisits = document.getElementById("portal-kpi-visits");
const kpiCommissions = document.getElementById("portal-kpi-commissions");

const state = {
  session: null,
  me: null,
  projects: [],
  leads: [],
  commissions: [],
  selectedLeadId: null,
  selectedLeadDetail: null,
};

const setFeedback = (message, kind = "warn") => {
  if (!(feedback instanceof HTMLElement)) return;
  feedback.textContent = message;
  feedback.classList.remove("is-ok", "is-warn", "is-error");
  if (kind === "ok") feedback.classList.add("is-ok");
  else if (kind === "error") feedback.classList.add("is-error");
  else feedback.classList.add("is-warn");
};

const redirectToLogin = (reason = null) => {
  const loginUrl = new URL(portalPath(lang, "/portal/login"), window.location.origin);
  loginUrl.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
  if (reason) loginUrl.searchParams.set("reason", reason);
  window.location.href = loginUrl.toString();
};

const ensureSession = () => {
  const session = loadSession();
  if (!session || !isSessionAuthenticated(session)) {
    redirectToLogin("missing_session");
    return null;
  }
  if (isSessionExpired(session)) {
    clearSession();
    redirectToLogin("expired_session");
    return null;
  }
  return session;
};

const requestAuthed = (path, params = {}, init = {}) => {
  const headers = buildPortalAuthHeaders(state.session, init.headers ?? {});
  return requestJson(buildPortalApiUrl(path, params), {
    ...init,
    headers,
  });
};

const handlePossibleAuthFailure = (error) => {
  const code = toText(error?.code);
  if (!isPortalAuthErrorCode(code)) return false;
  clearSession();
  redirectToLogin(code);
  return true;
};

const getLeadId = (entry) => {
  const row = asObject(entry);
  const tracking = asObject(row.tracking);
  const lead = asObject(row.lead);
  return toText(tracking.lead_id) ?? toText(lead.id);
};

const getLeadProjectId = (entry) => {
  const row = asObject(entry);
  const tracking = asObject(row.tracking);
  const lead = asObject(row.lead);
  return toText(tracking.project_property_id) ?? toText(lead.property_id);
};

const getLeadLabel = (entry) => {
  const row = asObject(entry);
  const contact = asObject(row.contact);
  const lead = asObject(row.lead);
  const leadId = getLeadId(entry);
  return (
    toText(contact.full_name) ??
    toText(lead.reference_code) ??
    (leadId ? `Lead ${leadId.slice(0, 8)}` : "Lead")
  );
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
    <p><strong>organization_id:</strong> <span class="portal-inline-code">${escapeHtml(
      session.organizationId
    )}</span></p>
    <p><strong>portal_account_id:</strong> <span class="portal-inline-code">${escapeHtml(
      session.portalAccountId
    )}</span></p>
    <p><strong>role:</strong> ${escapeHtml(roleLabel(portalAccount.role ?? session.role, lang))}</p>
    <p><strong>status:</strong> ${escapeHtml(statusLabel(portalAccount.status, lang))}</p>
    <p><strong>memberships:</strong> ${escapeHtml(String(memberships.length))}</p>
  `;
};

const renderKpis = () => {
  if (kpiProjects instanceof HTMLElement) kpiProjects.textContent = String(state.projects.length);
  if (kpiLeads instanceof HTMLElement) kpiLeads.textContent = String(state.leads.length);

  const pendingReview = state.leads.filter((entry) => {
    const tracking = asObject(entry?.tracking);
    return toText(tracking.attribution_status) === "pending_review";
  }).length;

  if (kpiVisits instanceof HTMLElement) kpiVisits.textContent = String(pendingReview);

  const activeCommissions = state.commissions.filter((row) => {
    const status = toText(row?.status);
    return status === "pending" || status === "approved";
  }).length;
  if (kpiCommissions instanceof HTMLElement) kpiCommissions.textContent = String(activeCommissions);
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
      const legacyCode = toText(project.legacy_code) ?? "-";
      return `
        <li class="portal-item">
          <p class="portal-item-title">${escapeHtml(title)}</p>
          <p class="portal-item-meta">ID: <span class="portal-inline-code">${escapeHtml(projectId)}</span></p>
          <div class="portal-badges">
            <span class="portal-badge role">${escapeHtml(legacyCode)}</span>
            <span class="portal-badge ${statusBadgeClass(status)}">${escapeHtml(statusLabel(status, lang))}</span>
          </div>
          <div class="portal-actions">
            <a class="portal-button portal-button-soft" href="${escapeHtml(
              portalPath(lang, `/portal/project/${projectId}`)
            )}">${isSpanish ? "Abrir proyecto" : "Open project"}</a>
          </div>
        </li>
      `;
    })
    .join("");
};

const renderLeadsTable = () => {
  if (!(leadsTbody instanceof HTMLElement)) return;
  if (!state.leads.length) {
    leadsTbody.innerHTML = `<tr><td colspan="5">${
      isSpanish ? "No hay leads registrados para esta cuenta." : "No leads for this account."
    }</td></tr>`;
    return;
  }

  const projectMap = new Map(
    state.projects.map((project) => [toText(project.id), pickProjectTitle(project, lang)])
  );

  leadsTbody.innerHTML = state.leads
    .map((entry) => {
      const tracking = asObject(entry.tracking);
      const leadId = getLeadId(entry);
      const createdAt = toText(tracking.created_at) ?? toText(entry?.lead?.created_at);
      const status = toText(tracking.attribution_status) ?? "pending_review";
      const projectId = getLeadProjectId(entry);
      const projectTitle = projectMap.get(projectId) ?? projectId ?? "-";
      const selectedClass = leadId && leadId === state.selectedLeadId ? "portal-row-selected" : "";

      return `
        <tr class="${selectedClass}">
          <td>${escapeHtml(formatDateOnly(createdAt, locale))}</td>
          <td>
            <strong>${escapeHtml(getLeadLabel(entry))}</strong>
            <br />
            <small>${escapeHtml(leadId ?? "-")}</small>
          </td>
          <td>
            <span class="portal-badge ${statusBadgeClass(status)}">${escapeHtml(statusLabel(status, lang))}</span>
          </td>
          <td>${escapeHtml(projectTitle)}</td>
          <td>
            <button class="portal-button portal-button-soft" data-action="lead-detail" data-lead-id="${escapeHtml(
              leadId ?? ""
            )}">${isSpanish ? "Ver detalle" : "View detail"}</button>
          </td>
        </tr>
      `;
    })
    .join("");
};

const renderLeadDetail = () => {
  if (!(leadDetailBox instanceof HTMLElement)) return;
  if (!state.selectedLeadDetail) {
    leadDetailBox.innerHTML = isSpanish
      ? "Selecciona un lead para ver timeline, visitas y comisiones asociadas."
      : "Select a lead to inspect timeline, visits and commissions.";
    return;
  }

  const detail = asObject(state.selectedLeadDetail);
  const lead = asObject(detail.lead);
  const contact = asObject(detail.contact);
  const tracking = asObject(detail.tracking);
  const visits = Array.isArray(detail.visits) ? detail.visits : [];
  const commissions = Array.isArray(detail.commissions) ? detail.commissions : [];
  const timeline = Array.isArray(tracking.timeline) ? tracking.timeline : [];

  const timelineHtml = timeline.length
    ? timeline
        .map((entry) => {
          const row = asObject(entry);
          return `
            <li>
              <strong>${escapeHtml(statusLabel(toText(row.status), lang))}</strong>
              <small>${escapeHtml(formatDateTime(row.at, locale))} | ${escapeHtml(toText(row.actor) ?? "-")}</small>
            </li>
          `;
        })
        .join("")
    : `<li><small>${isSpanish ? "Sin eventos de timeline." : "No timeline events."}</small></li>`;

  const visitHtml = visits.length
    ? visits
        .map((visit) => {
          const row = asObject(visit);
          const status = toText(row.status) ?? "requested";
          return `
            <li class="portal-item">
              <p class="portal-item-title">${escapeHtml(statusLabel(status, lang))}</p>
              <p class="portal-item-meta">${escapeHtml(
                formatDateTime(toText(row.confirmed_slot) ?? toText(row.created_at), locale)
              )}</p>
            </li>
          `;
        })
        .join("")
    : `<li class="portal-empty">${isSpanish ? "Sin visitas." : "No visit requests."}</li>`;

  const commissionHtml = commissions.length
    ? commissions
        .map((item) => {
          const row = asObject(item);
          const amount = formatCurrency(row.commission_value, toText(row.currency) ?? "EUR", locale);
          const status = toText(row.status);
          return `
            <li class="portal-item">
              <p class="portal-item-title">${escapeHtml(statusLabel(status, lang))}</p>
              <p class="portal-item-meta">${escapeHtml(amount)}</p>
            </li>
          `;
        })
        .join("")
    : `<li class="portal-empty">${isSpanish ? "Sin comisiones para este lead." : "No commissions for this lead."}</li>`;

  leadDetailBox.innerHTML = `
    <p><strong>lead_id:</strong> <span class="portal-inline-code">${escapeHtml(toText(lead.id) ?? "-")}</span></p>
    <p><strong>${isSpanish ? "contacto" : "contact"}:</strong> ${escapeHtml(
      toText(contact.full_name) ?? toText(contact.email) ?? "-"
    )}</p>
    <p><strong>${isSpanish ? "estado lead" : "lead status"}:</strong> ${escapeHtml(
      humanizeKey(toText(lead.status))
    )}</p>
    <p><strong>${isSpanish ? "atribucion" : "attribution"}:</strong> ${escapeHtml(
      statusLabel(toText(tracking.attribution_status), lang)
    )}</p>
    <h3>${isSpanish ? "Timeline" : "Timeline"}</h3>
    <ul class="portal-timeline">${timelineHtml}</ul>
    <h3>${isSpanish ? "Visitas" : "Visits"}</h3>
    <ul class="portal-list">${visitHtml}</ul>
    <h3>${isSpanish ? "Comisiones del lead" : "Lead commissions"}</h3>
    <ul class="portal-list">${commissionHtml}</ul>
  `;
};

const renderCommissions = () => {
  if (!(commissionsTbody instanceof HTMLElement)) return;
  if (!state.commissions.length) {
    commissionsTbody.innerHTML = `<tr><td colspan="5">${
      isSpanish ? "No hay comisiones registradas." : "No commissions registered."
    }</td></tr>`;
    return;
  }

  commissionsTbody.innerHTML = state.commissions
    .map((item) => {
      const row = asObject(item);
      const status = toText(row.status);
      const amount = formatCurrency(row.commission_value, toText(row.currency) ?? "EUR", locale);
      const leadOrDeal = toText(row.lead_id) ?? toText(row.deal_id) ?? "-";

      return `
        <tr>
          <td><span class="portal-badge ${statusBadgeClass(status)}">${escapeHtml(
            statusLabel(status, lang)
          )}</span></td>
          <td>${escapeHtml(amount)}</td>
          <td>${escapeHtml(toText(row.project_property_id) ?? "-")}</td>
          <td>${escapeHtml(leadOrDeal)}</td>
          <td>${escapeHtml(formatDateOnly(toText(row.payment_date), locale))}</td>
        </tr>
      `;
    })
    .join("");
};

const loadLeadDetail = async (leadId) => {
  if (!leadId || !state.session) return;
  try {
    const payload = await requestAuthed(`/leads/${encodeURIComponent(leadId)}`);
    state.selectedLeadId = leadId;
    state.selectedLeadDetail = payload?.data ?? null;
    renderLeadsTable();
    renderLeadDetail();
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `No se pudo cargar detalle lead: ${message}` : `Could not load lead detail: ${message}`,
      "error"
    );
  }
};

const loadDashboard = async () => {
  const session = ensureSession();
  if (!session) return;
  state.session = session;

  setFeedback(isSpanish ? "Cargando panel..." : "Loading dashboard...", "warn");

  try {
    const [mePayload, projectsPayload, leadsPayload, commissionsPayload] = await Promise.all([
      requestAuthed("/me"),
      requestAuthed("/projects"),
      requestAuthed("/leads", { per_page: "30" }),
      requestAuthed("/commissions", { per_page: "30" }),
    ]);

    state.me = mePayload?.data ?? null;
    state.projects = Array.isArray(projectsPayload?.data) ? projectsPayload.data : [];
    state.leads = Array.isArray(leadsPayload?.data) ? leadsPayload.data : [];
    state.commissions = Array.isArray(commissionsPayload?.data) ? commissionsPayload.data : [];

    renderAccount();
    renderProjects();
    renderKpis();
    renderLeadsTable();
    renderCommissions();

    const fallbackLeadId = getLeadId(state.leads[0]);
    if (!state.selectedLeadId && fallbackLeadId) {
      await loadLeadDetail(fallbackLeadId);
    } else if (state.selectedLeadId) {
      await loadLeadDetail(state.selectedLeadId);
    } else {
      state.selectedLeadDetail = null;
      renderLeadDetail();
    }

    setFeedback(
      isSpanish
        ? `Panel actualizado (${state.projects.length} proyectos, ${state.leads.length} leads).`
        : `Dashboard updated (${state.projects.length} projects, ${state.leads.length} leads).`,
      "ok"
    );
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `Error cargando dashboard: ${message}` : `Dashboard load error: ${message}`,
      "error"
    );
  }
};

leadsTbody?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button[data-action='lead-detail']");
  if (!button) return;
  const leadId = toText(button.getAttribute("data-lead-id"));
  if (!leadId) return;
  await loadLeadDetail(leadId);
});

refreshButton?.addEventListener("click", async () => {
  await loadDashboard();
});

logoutButton?.addEventListener("click", () => {
  clearSession();
  const loginUrl = new URL(portalPath(lang, "/portal/login"), window.location.origin);
  window.location.href = loginUrl.toString();
});

loadDashboard();
