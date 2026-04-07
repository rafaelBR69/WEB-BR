import {
  asObject,
  buildPortalApiUrl,
  buildPortalAuthHeaders,
  clearSession,
  escapeHtml,
  formatCurrency,
  formatDateTime,
  getPortalMediaAlt,
  getPortalMediaCover,
  getPortalMediaItems,
  getBootstrap,
  humanizeKey,
  isPortalAuthErrorCode,
  isSessionAuthenticated,
  isSessionExpired,
  loadSession,
  pickProjectTitle,
  portalPath,
  refreshPortalSession,
  requestJson,
  statusBadgeClass,
  statusLabel,
  toText,
  truncate,
  withSessionOrganization,
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
const projectGallery = document.getElementById("portal-project-gallery");
const contentList = document.getElementById("portal-project-content");
const unitsList = document.getElementById("portal-project-units");
const documentsList = document.getElementById("portal-project-documents");
const docsSearch = document.getElementById("portal-documents-search");
const loadingShell = document.getElementById("portal-auth-loading");
const loadingShellText = document.querySelector("[data-portal-loading-text]");
const privateShell = document.getElementById("portal-private-shell");

const state = {
  session: null,
  project: null,
  contentBlocks: [],
  availableUnits: [],
  documents: [],
  docsSearchTimer: null,
};

const buildMediaShell = (media, title, href = null) => {
  const mediaItems = getPortalMediaItems(media, 8);
  const cover = getPortalMediaCover(media) ?? mediaItems[0] ?? null;
  const extraCount = Math.max(0, mediaItems.length - 5);
  const thumbItems = mediaItems.slice(1, 5);
  const altFallback = isSpanish ? `Imagen de ${title}` : `Image of ${title}`;
  const tagName = href ? "a" : "div";
  const hrefAttr = href ? ` href="${escapeHtml(href)}"` : "";
  const coverHtml = cover
    ? `
        <${tagName} class="portal-media-cover"${hrefAttr} aria-label="${escapeHtml(title)}">
          <img src="${escapeHtml(cover.url)}" alt="${escapeHtml(getPortalMediaAlt(cover, lang, altFallback))}" loading="lazy" decoding="async" />
          <span class="portal-media-count">${escapeHtml(String(mediaItems.length || 1))} ${escapeHtml(isSpanish ? "fotos" : "photos")}</span>
        </${tagName}>
      `
    : `
        <${tagName} class="portal-media-cover"${hrefAttr} aria-label="${escapeHtml(title)}">
          <div class="portal-media-fallback">${escapeHtml(title)}</div>
        </${tagName}>
      `;

  const thumbsHtml = thumbItems.length
    ? `
        <div class="portal-media-thumbs" aria-hidden="true">
          ${thumbItems
            .map((entry, index) => `
              <span class="portal-media-thumb">
                <img src="${escapeHtml(entry.url)}" alt="" loading="lazy" decoding="async" />
                ${
                  index === thumbItems.length - 1 && extraCount > 0
                    ? `<span class="portal-media-thumb-more">+${escapeHtml(String(extraCount))}</span>`
                    : ""
                }
              </span>
            `)
            .join("")}
        </div>
      `
    : "";

  return `<div class="portal-media-shell">${coverHtml}${thumbsHtml}</div>`;
};

const renderProjectGallery = () => {
  if (!(projectGallery instanceof HTMLElement)) return;
  if (!state.project) {
    projectGallery.innerHTML = `<div class="portal-empty">${
      isSpanish ? "Promocion no disponible para esta cuenta." : "Project unavailable for this account."
    }</div>`;
    return;
  }

  const title = pickProjectTitle(state.project, lang);
  const mediaItems = getPortalMediaItems(state.project.media, 32);
  if (!mediaItems.length) {
    projectGallery.innerHTML = `<div class="portal-empty">${
      isSpanish ? "No hay imagenes publicadas para esta promocion." : "No published images for this project."
    }</div>`;
    return;
  }

  projectGallery.innerHTML = mediaItems
    .map(
      (item, index) => `
        <a class="portal-media-gallery-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(
          `${title} ${index + 1}`
        )}">
          <img src="${escapeHtml(item.url)}" alt="${escapeHtml(getPortalMediaAlt(item, lang, title))}" loading="lazy" decoding="async" />
        </a>
      `
    )
    .join("");
};

const audienceLabel = (value) => {
  const audience = toText(value) ?? "both";
  if (audience === "agent") return isSpanish ? "Kit agencia" : "Agency kit";
  if (audience === "client") return isSpanish ? "Kit cliente" : "Client kit";
  if (audience === "both") return isSpanish ? "Shared kit" : "Shared kit";
  return audience;
};

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

const renderProjectHeader = () => {
  if (!(projectHeader instanceof HTMLElement)) return;

  if (!state.project) {
    projectHeader.textContent = isSpanish
      ? "Promocion no disponible para esta cuenta."
      : "Project unavailable for this account.";
    return;
  }

  const title = pickProjectTitle(state.project, lang);
  const status = statusLabel(toText(state.project.status), lang);
  const availableUnitsCount = state.availableUnits.length;
  const unitsLabel = isSpanish ? "viviendas disponibles" : "available units";
  projectHeader.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    |
    ${escapeHtml(status)}
    |
    ${escapeHtml(`${availableUnitsCount} ${unitsLabel}`)}
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
      const audience = audienceLabel(row.audience);
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
      const title = toText(row.title) ?? "Documento";
      const mime = toText(row.mime_type) ?? "-";
      const size = formatBytes(row.file_size_bytes);
      const publishedAt = formatDateTime(toText(row.portal_published_at) ?? toText(row.created_at), locale);
      const downloadEndpoint = toText(row.download_endpoint);
      const downloadLabel = isSpanish ? "Descargar documento" : "Download document";
      const unavailableLabel = isSpanish ? "Descarga no disponible" : "Download unavailable";
      return `
        <li class="portal-item">
          <p class="portal-item-title">${escapeHtml(title)}</p>
          <p class="portal-item-meta">${escapeHtml(mime)}</p>
          <p class="portal-item-meta">
            ${escapeHtml(publishedAt)}
            ${size ? ` | ${escapeHtml(size)}` : ""}
          </p>
          <div class="portal-actions">
            ${
              downloadEndpoint
                ? `<button class="portal-button portal-button-soft" type="button" data-action="download-document" data-download-endpoint="${escapeHtml(downloadEndpoint)}">${escapeHtml(downloadLabel)}</button>`
                : `<span class="portal-item-meta">${escapeHtml(unavailableLabel)}</span>`
            }
          </div>
        </li>
      `;
    })
    .join("");
};

const renderUnits = () => {
  if (!(unitsList instanceof HTMLElement)) return;
  if (!state.availableUnits.length) {
    unitsList.innerHTML = `<li class="portal-empty">${
      isSpanish ? "No hay viviendas disponibles en este momento." : "No available units right now."
    }</li>`;
    return;
  }

  unitsList.innerHTML = state.availableUnits
    .map((unit) => {
      const row = asObject(unit);
      const title = toText(row.title) ?? toText(row.legacy_code) ?? (isSpanish ? "Unidad" : "Unit");
      const legacyCode = toText(row.legacy_code);
      const currency = toText(row.currency) ?? "EUR";
      const salePrice = formatCurrency(row.price_sale, currency, locale);
      const rentPrice = formatCurrency(row.price_rent_monthly, currency, locale);
      const areaValue = Number(row.area_m2);
      const areaText = Number.isFinite(areaValue) && areaValue > 0 ? `${areaValue.toFixed(0)} m2` : null;
      const bedroomsValue = Number(row.bedrooms);
      const bathroomsValue = Number(row.bathrooms);
      const bedroomsText =
        Number.isFinite(bedroomsValue) && bedroomsValue >= 0
          ? `${bedroomsValue.toFixed(0)} ${isSpanish ? "hab" : "beds"}`
          : null;
      const bathroomsText =
        Number.isFinite(bathroomsValue) && bathroomsValue >= 0
          ? `${bathroomsValue.toFixed(0)} ${isSpanish ? "banos" : "baths"}`
          : null;
      const floorLabel = toText(row.floor_label);
      const updatedAt = formatDateTime(toText(row.updated_at), locale);
      const specs = [areaText, bedroomsText, bathroomsText].filter((value) => Boolean(value)).join(" | ");
      const priceLines = [
        Number.isFinite(Number(row.price_sale)) ? `${isSpanish ? "Venta" : "Sale"}: ${salePrice}` : null,
        Number.isFinite(Number(row.price_rent_monthly)) ? `${isSpanish ? "Alquiler" : "Rent"}: ${rentPrice}` : null,
      ].filter((value) => Boolean(value));
      const ownMediaItems = getPortalMediaItems(row.media, 8);
      const mediaSource = ownMediaItems.length ? row.media : state.project?.media;

      return `
        <li class="portal-item">
          ${buildMediaShell(mediaSource, title)}
          <p class="portal-item-title">${escapeHtml(title)}</p>
          ${
            legacyCode
              ? `<p class="portal-item-meta">${escapeHtml((isSpanish ? "Codigo" : "Code") + ": " + legacyCode)}</p>`
              : ""
          }
          ${
            floorLabel
              ? `<p class="portal-item-meta">${escapeHtml((isSpanish ? "Planta" : "Floor") + ": " + floorLabel)}</p>`
              : ""
          }
          ${
            specs
              ? `<p class="portal-item-meta">${escapeHtml(specs)}</p>`
              : ""
          }
          ${
            priceLines.length
              ? `<p class="portal-item-meta">${escapeHtml(priceLines.join(" | "))}</p>`
              : `<p class="portal-item-meta">${escapeHtml(isSpanish ? "Precio a consultar" : "Price on request")}</p>`
          }
          <div class="portal-badges">
            <span class="portal-badge ok">${escapeHtml(isSpanish ? "Disponible" : "Available")}</span>
          </div>
          <p class="portal-item-meta">${escapeHtml((isSpanish ? "Actualizado" : "Updated") + ": " + updatedAt)}</p>
        </li>
      `;
    })
    .join("");
};

const triggerDownload = (url) => {
  const downloadUrl = toText(url);
  if (!downloadUrl) return;
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
};

const loadDocuments = async (q = "") => {
  if (!state.session || !projectId) return;
  const params = { q: toText(q) };
  const payload = await requestAuthed(`/projects/${encodeURIComponent(projectId)}/documents`, params);
  state.documents = Array.isArray(payload?.data) ? payload.data : [];
  renderDocuments();
};

const loadUnits = async () => {
  if (!state.session || !projectId) return;
  const payload = await requestAuthed(`/projects/${encodeURIComponent(projectId)}/units`);
  state.availableUnits = Array.isArray(payload?.data) ? payload.data : [];
  renderUnits();
  renderProjectHeader();
};

const loadBaseData = async () => {
  if (!state.session || !projectId) return;

  const [projectsPayload, contentPayload] = await Promise.all([
    requestAuthed("/projects"),
    requestAuthed(`/projects/${encodeURIComponent(projectId)}/content`, {
      language: lang,
    }),
  ]);

  const projects = Array.isArray(projectsPayload?.data) ? projectsPayload.data : [];
  state.project = projects.find((row) => toText(row?.id) === projectId) ?? null;
  state.contentBlocks = Array.isArray(contentPayload?.data) ? contentPayload.data : [];

  renderProjectHeader();
  renderProjectGallery();
  renderContent();
};

const refreshAll = async () => {
  if (!projectId) {
    setFeedback(isSpanish ? "project_id no valido." : "Invalid project_id.", "error");
    return;
  }

  const session = await ensureSession();
  if (!session) return;
  state.session = session;
  showPrivateShell();

  const loadingMessage = isSpanish ? "Cargando workspace del proyecto..." : "Loading project workspace...";
  setLoadingMessage(loadingMessage);
  setFeedback(loadingMessage, "warn");

  try {
    await Promise.all([loadBaseData(), loadUnits(), loadDocuments(toText(docsSearch?.value) ?? "")]);
    setFeedback(
      isSpanish
        ? `Workspace cargado (${state.contentBlocks.length} bloques, ${state.availableUnits.length} viviendas, ${state.documents.length} docs).`
        : `Workspace loaded (${state.contentBlocks.length} blocks, ${state.availableUnits.length} units, ${state.documents.length} docs).`,
      "ok"
    );
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(isSpanish ? `Error cargando proyecto: ${message}` : `Project load error: ${message}`, "error");
  }
};

docsSearch?.addEventListener("input", () => {
  if (state.docsSearchTimer) clearTimeout(state.docsSearchTimer);
  state.docsSearchTimer = setTimeout(async () => {
    try {
      await loadDocuments(toText(docsSearch?.value) ?? "");
    } catch (error) {
      if (handlePossibleAuthFailure(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(isSpanish ? `Error buscando documentos: ${message}` : `Document search error: ${message}`, "error");
    }
  }, 260);
});

documentsList?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button[data-action='download-document']");
  if (!button) return;

  const endpoint = toText(button.getAttribute("data-download-endpoint"));
  if (!endpoint) return;

  const previousText = button.textContent;
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("disabled", "true");
  button.textContent = isSpanish ? "Generando enlace..." : "Generating link...";

  try {
    const payload = await requestAuthed(endpoint);
    const downloadUrl = toText(payload?.data?.download_url);
    if (!downloadUrl) {
      throw new Error(isSpanish ? "No se pudo generar la descarga." : "Download link not available.");
    }
    triggerDownload(downloadUrl);
    setFeedback(isSpanish ? "Descarga preparada." : "Download prepared.", "ok");
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `No se pudo descargar documento: ${message}` : `Could not download document: ${message}`,
      "error"
    );
  } finally {
    button.removeAttribute("aria-disabled");
    button.removeAttribute("disabled");
    button.textContent = previousText;
  }
});

if (!projectId) {
  setFeedback(isSpanish ? "project_id no detectado en ruta." : "project_id missing in route.", "error");
} else {
  refreshAll();
}
