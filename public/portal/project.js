import {
  asObject,
  buildPortalApiUrl,
  buildPortalAuthHeaders,
  clearSession,
  escapeHtml,
  formatCurrency,
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
  statusBadgeClass,
  statusLabel,
  toNumber,
  toText,
  truncate,
} from "/portal/shared.js";

const bootstrap = getBootstrap();
const lang = bootstrap.lang;
const locale = lang === "es" ? "es-ES" : "en-GB";
const isSpanish = lang === "es";

const projectIdFromPath = (() => {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((part) => part === "project");
  if (idx < 0) return null;
  return toText(parts[idx + 1]);
})();

const projectId = bootstrap.projectId ?? projectIdFromPath;

const feedback = document.getElementById("portal-project-feedback");
const projectHeader = document.getElementById("portal-project-header");
const contentList = document.getElementById("portal-project-content");
const documentsList = document.getElementById("portal-project-documents");
const docsSearch = document.getElementById("portal-documents-search");
const leadForm = document.getElementById("portal-project-lead-form");
const visitForm = document.getElementById("portal-project-visit-form");
const leadTbody = document.getElementById("portal-project-leads-tbody");
const leadDetailBox = document.getElementById("portal-project-lead-detail");
const visitLeadSelect = document.getElementById("portal-visit-lead-select");

const state = {
  session: null,
  project: null,
  contentBlocks: [],
  documents: [],
  leads: [],
  selectedLeadId: null,
  selectedLeadDetail: null,
  docsSearchTimer: null,
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

const getLeadLabel = (entry) => {
  const row = asObject(entry);
  const contact = asObject(row.contact);
  const lead = asObject(row.lead);
  const leadId = getLeadId(entry);
  return (
    toText(contact.full_name) ??
    toText(contact.email) ??
    toText(lead.reference_code) ??
    (leadId ? `Lead ${leadId.slice(0, 8)}` : "Lead")
  );
};

const renderProjectHeader = () => {
  if (!(projectHeader instanceof HTMLElement)) return;

  if (!state.project) {
    projectHeader.innerHTML = isSpanish
      ? `Proyecto ID: <span class="portal-inline-code">${escapeHtml(projectId ?? "-")}</span>`
      : `Project ID: <span class="portal-inline-code">${escapeHtml(projectId ?? "-")}</span>`;
    return;
  }

  const title = pickProjectTitle(state.project, lang);
  const status = statusLabel(toText(state.project.status), lang);
  const code = toText(state.project.legacy_code) ?? "-";
  const identifier = toText(state.project.id) ?? projectId ?? "-";
  projectHeader.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    |
    <span class="portal-inline-code">${escapeHtml(identifier)}</span>
    |
    ${escapeHtml(status)}
    |
    ${escapeHtml(code)}
  `;
};

const renderContent = () => {
  if (!(contentList instanceof HTMLElement)) return;
  if (!state.contentBlocks.length) {
    contentList.innerHTML = `<li class="portal-empty">${
      isSpanish ? "No hay bloques publicados para este contexto." : "No published blocks for this context."
    }</li>`;
    return;
  }

  contentList.innerHTML = state.contentBlocks
    .map((block) => {
      const row = asObject(block);
      const sectionKey = toText(row.section_key) ?? "section";
      const title = toText(row.title) ?? humanizeKey(sectionKey);
      const body = truncate(toText(row.body_markdown), 240);
      const audience = toText(row.audience) ?? "both";
      return `
        <li class="portal-item">
          <p class="portal-item-title">${escapeHtml(title)}</p>
          <p class="portal-item-meta">${escapeHtml(humanizeKey(sectionKey))}</p>
          <div class="portal-badges">
            <span class="portal-badge ${statusBadgeClass("active")}">${escapeHtml(audience)}</span>
          </div>
          ${body ? `<p class="portal-item-meta">${escapeHtml(body)}</p>` : ""}
        </li>
      `;
    })
    .join("");
};

const renderDocuments = () => {
  if (!(documentsList instanceof HTMLElement)) return;
  if (!state.documents.length) {
    documentsList.innerHTML = `<li class="portal-empty">${
      isSpanish ? "No hay documentos visibles." : "No visible documents."
    }</li>`;
    return;
  }

  documentsList.innerHTML = state.documents
    .map((doc) => {
      const row = asObject(doc);
      const title = toText(row.title) ?? toText(row.storage_path) ?? "Documento";
      const bucket = toText(row.storage_bucket) ?? "-";
      const path = toText(row.storage_path) ?? "-";
      const mime = toText(row.mime_type) ?? "-";
      const publishedAt = formatDateTime(toText(row.portal_published_at) ?? toText(row.created_at), locale);
      return `
        <li class="portal-item">
          <p class="portal-item-title">${escapeHtml(title)}</p>
          <p class="portal-item-meta">${escapeHtml(mime)}</p>
          <p class="portal-item-meta"><span class="portal-inline-code">${escapeHtml(`${bucket}/${path}`)}</span></p>
          <p class="portal-item-meta">${escapeHtml(publishedAt)}</p>
        </li>
      `;
    })
    .join("");
};

const renderLeadRows = () => {
  if (!(leadTbody instanceof HTMLElement)) return;
  if (!state.leads.length) {
    leadTbody.innerHTML = `<tr><td colspan="4">${
      isSpanish ? "No hay leads para este proyecto." : "No leads for this project."
    }</td></tr>`;
    return;
  }

  leadTbody.innerHTML = state.leads
    .map((entry) => {
      const tracking = asObject(entry.tracking);
      const leadId = getLeadId(entry);
      const status = toText(tracking.attribution_status) ?? "pending_review";
      const createdAt = toText(tracking.created_at) ?? toText(entry?.lead?.created_at);
      const selectedClass = leadId && leadId === state.selectedLeadId ? "portal-row-selected" : "";
      return `
        <tr class="${selectedClass}">
          <td>${escapeHtml(formatDateTime(createdAt, locale))}</td>
          <td>
            <strong>${escapeHtml(getLeadLabel(entry))}</strong>
            <br />
            <small>${escapeHtml(leadId ?? "-")}</small>
          </td>
          <td><span class="portal-badge ${statusBadgeClass(status)}">${escapeHtml(
            statusLabel(status, lang)
          )}</span></td>
          <td>
            <button class="portal-button portal-button-soft" data-action="lead-detail" data-lead-id="${escapeHtml(
              leadId ?? ""
            )}">${isSpanish ? "Ver" : "View"}</button>
          </td>
        </tr>
      `;
    })
    .join("");
};

const renderVisitLeadOptions = () => {
  if (!(visitLeadSelect instanceof HTMLSelectElement)) return;
  if (!state.leads.length) {
    visitLeadSelect.innerHTML = `<option value="">${
      isSpanish ? "Sin leads disponibles" : "No leads available"
    }</option>`;
    return;
  }

  visitLeadSelect.innerHTML = state.leads
    .map((entry) => {
      const leadId = getLeadId(entry);
      if (!leadId) return "";
      const selected = state.selectedLeadId === leadId ? "selected" : "";
      return `<option value="${escapeHtml(leadId)}" ${selected}>${escapeHtml(
        `${getLeadLabel(entry)} | ${leadId.slice(0, 8)}`
      )}</option>`;
    })
    .join("");
};

const renderLeadDetail = () => {
  if (!(leadDetailBox instanceof HTMLElement)) return;
  if (!state.selectedLeadDetail) {
    leadDetailBox.innerHTML = isSpanish
      ? "Selecciona un lead para ver timeline, visitas y comisiones."
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
    : `<li><small>${isSpanish ? "Sin eventos timeline." : "No timeline entries."}</small></li>`;

  const visitsHtml = visits.length
    ? visits
        .map((visit) => {
          const row = asObject(visit);
          const status = toText(row.status);
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
    : `<li class="portal-empty">${isSpanish ? "Sin solicitudes de visita." : "No visit requests."}</li>`;

  const commissionsHtml = commissions.length
    ? commissions
        .map((item) => {
          const row = asObject(item);
          const status = toText(row.status);
          const amount = formatCurrency(row.commission_value, toText(row.currency) ?? "EUR", locale);
          return `
            <li class="portal-item">
              <p class="portal-item-title">${escapeHtml(statusLabel(status, lang))}</p>
              <p class="portal-item-meta">${escapeHtml(amount)}</p>
            </li>
          `;
        })
        .join("")
    : `<li class="portal-empty">${isSpanish ? "Sin comisiones asociadas." : "No related commissions."}</li>`;

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
    <ul class="portal-list">${visitsHtml}</ul>
    <h3>${isSpanish ? "Comisiones" : "Commissions"}</h3>
    <ul class="portal-list">${commissionsHtml}</ul>
  `;
};

const loadLeadDetail = async (leadId) => {
  if (!leadId || !state.session) return;
  try {
    const payload = await requestAuthed(`/leads/${encodeURIComponent(leadId)}`);
    state.selectedLeadId = leadId;
    state.selectedLeadDetail = payload?.data ?? null;
    renderLeadRows();
    renderVisitLeadOptions();
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

const loadDocuments = async (q = "") => {
  if (!state.session || !projectId) return;
  const params = { q: toText(q) };
  const payload = await requestAuthed(`/projects/${encodeURIComponent(projectId)}/documents`, params);
  state.documents = Array.isArray(payload?.data) ? payload.data : [];
  renderDocuments();
};

const loadBaseData = async () => {
  if (!state.session || !projectId) return;

  const [projectsPayload, contentPayload, leadsPayload] = await Promise.all([
    requestAuthed("/projects"),
    requestAuthed(`/projects/${encodeURIComponent(projectId)}/content`, {
      language: lang,
    }),
    requestAuthed("/leads", {
      project_property_id: projectId,
      per_page: "50",
    }),
  ]);

  const projects = Array.isArray(projectsPayload?.data) ? projectsPayload.data : [];
  state.project = projects.find((row) => toText(row?.id) === projectId) ?? null;
  state.contentBlocks = Array.isArray(contentPayload?.data) ? contentPayload.data : [];
  state.leads = Array.isArray(leadsPayload?.data) ? leadsPayload.data : [];

  renderProjectHeader();
  renderContent();
  renderLeadRows();
  renderVisitLeadOptions();

  const firstLeadId = getLeadId(state.leads[0]);
  if (!state.selectedLeadId && firstLeadId) {
    await loadLeadDetail(firstLeadId);
  } else if (state.selectedLeadId) {
    await loadLeadDetail(state.selectedLeadId);
  } else {
    state.selectedLeadDetail = null;
    renderLeadDetail();
  }
};

const refreshAll = async () => {
  if (!projectId) {
    setFeedback(isSpanish ? "project_id no valido." : "Invalid project_id.", "error");
    return;
  }

  const session = ensureSession();
  if (!session) return;
  state.session = session;

  setFeedback(isSpanish ? "Cargando workspace del proyecto..." : "Loading project workspace...", "warn");

  try {
    await Promise.all([loadBaseData(), loadDocuments(toText(docsSearch?.value) ?? "")]);
    setFeedback(
      isSpanish
        ? `Workspace cargado (${state.leads.length} leads, ${state.documents.length} docs).`
        : `Workspace loaded (${state.leads.length} leads, ${state.documents.length} docs).`,
      "ok"
    );
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `Error cargando proyecto: ${message}` : `Project load error: ${message}`,
      "error"
    );
  }
};

leadTbody?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button[data-action='lead-detail']");
  if (!button) return;
  const leadId = toText(button.getAttribute("data-lead-id"));
  if (!leadId) return;
  await loadLeadDetail(leadId);
});

docsSearch?.addEventListener("input", () => {
  if (state.docsSearchTimer) clearTimeout(state.docsSearchTimer);
  state.docsSearchTimer = setTimeout(async () => {
    try {
      await loadDocuments(toText(docsSearch?.value) ?? "");
    } catch (error) {
      if (handlePossibleAuthFailure(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(
        isSpanish ? `Error buscando documentos: ${message}` : `Document search error: ${message}`,
        "error"
      );
    }
  }, 260);
});

leadForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.session || !projectId || !(leadForm instanceof HTMLFormElement)) return;

  const formData = new FormData(leadForm);
  const fullName = toText(formData.get("full_name"));
  const email = toText(formData.get("email"));
  const phone = toText(formData.get("phone"));

  if (!fullName) {
    setFeedback(isSpanish ? "El nombre del lead es obligatorio." : "Lead full name is required.", "error");
    return;
  }
  if (!email && !phone) {
    setFeedback(
      isSpanish ? "Debes informar email o telefono." : "Provide at least email or phone.",
      "error"
    );
    return;
  }

  const payload = {
    full_name: fullName,
    email,
    phone,
    language: toText(formData.get("language")) ?? lang,
    operation_interest: toText(formData.get("operation_interest")) ?? "sale",
    timeline: toText(formData.get("timeline")),
    notes: toText(formData.get("notes")),
    budget_min: toNumber(formData.get("budget_min")),
    budget_max: toNumber(formData.get("budget_max")),
    consent: formData.get("consent") === "on",
  };

  setFeedback(isSpanish ? "Creando lead..." : "Creating lead...", "warn");

  try {
    const response = await requestAuthed(
      `/projects/${encodeURIComponent(projectId)}/leads`,
      {},
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const createdLeadId = toText(response?.data?.lead?.id);
    leadForm.reset();
    if (createdLeadId) state.selectedLeadId = createdLeadId;
    await loadBaseData();

    setFeedback(
      isSpanish ? "Lead creado correctamente." : "Lead created successfully.",
      "ok"
    );
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `No se pudo crear lead: ${message}` : `Lead creation failed: ${message}`,
      "error"
    );
  }
});

visitForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.session || !(visitForm instanceof HTMLFormElement)) return;

  const formData = new FormData(visitForm);
  const leadId = toText(formData.get("lead_id"));
  const mode = toText(formData.get("request_mode")) ?? "proposal_slots";
  const notes = toText(formData.get("notes"));

  const slotValues = [formData.get("slot_1"), formData.get("slot_2"), formData.get("slot_3")]
    .map((value) => toText(value))
    .filter(Boolean)
    .map((value) => {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return value;
      return parsed.toISOString();
    });

  if (!leadId) {
    setFeedback(isSpanish ? "Selecciona un lead para solicitar visita." : "Select a lead first.", "error");
    return;
  }
  if (mode === "proposal_slots" && (slotValues.length < 2 || slotValues.length > 3)) {
    setFeedback(
      isSpanish
        ? "proposal_slots requiere 2 o 3 horarios propuestos."
        : "proposal_slots requires 2 or 3 proposed slots.",
      "error"
    );
    return;
  }

  setFeedback(isSpanish ? "Enviando solicitud de visita..." : "Submitting visit request...", "warn");

  try {
    await requestAuthed(
      `/leads/${encodeURIComponent(leadId)}/visit-requests`,
      {},
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_mode: mode,
          proposed_slots: slotValues,
          notes,
        }),
      }
    );

    await loadLeadDetail(leadId);
    setFeedback(
      isSpanish ? "Solicitud de visita registrada." : "Visit request created.",
      "ok"
    );
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `No se pudo registrar visita: ${message}` : `Visit request failed: ${message}`,
      "error"
    );
  }
});

if (!projectId) {
  setFeedback(isSpanish ? "project_id no detectado en ruta." : "project_id missing in route.", "error");
} else {
  refreshAll();
}
