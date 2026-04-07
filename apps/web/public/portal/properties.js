import {
  buildPortalApiUrl,
  clearSession,
  escapeHtml,
  formatCurrency,
  formatDateTime,
  getPortalMediaAlt,
  getPortalMediaCover,
  getPortalMediaItems,
  getBootstrap,
  isPortalAuthErrorCode,
  isSessionAuthenticated,
  isSessionExpired,
  loadSession,
  portalPath,
  refreshPortalSession,
  requestJson,
  statusBadgeClass,
  statusLabel,
  toText,
} from "/portal/shared.js";

const bootstrap = getBootstrap();
const lang = bootstrap.lang;
const locale = lang === "es" ? "es-ES" : "en-GB";
const isSpanish = lang === "es";

const feedback = document.getElementById("portal-properties-feedback");
const list = document.getElementById("portal-properties-list");
const refreshButton = document.getElementById("portal-properties-refresh");
const logoutButton = document.getElementById("portal-properties-logout");
const searchInput = document.getElementById("portal-properties-search");
const projectCount = document.getElementById("portal-properties-project-count");
const unitCount = document.getElementById("portal-properties-unit-count");
const loadingShell = document.getElementById("portal-auth-loading");
const loadingShellText = document.querySelector("[data-portal-loading-text]");
const privateShell = document.getElementById("portal-private-shell");

const state = {
  session: null,
  properties: [],
  projectCount: 0,
  searchTimer: null,
};

const renderPropertyMedia = (item, title, projectHref) => {
  const mediaItems = getPortalMediaItems(item?.media, 8);
  const cover = getPortalMediaCover(item?.media) ?? mediaItems[0] ?? null;
  const imageAltFallback = isSpanish ? `Imagen de ${title}` : `Image of ${title}`;
  const thumbItems = mediaItems.slice(1, 5);
  const extraCount = Math.max(0, mediaItems.length - 5);

  const coverHtml = cover
    ? `
        <a class="portal-media-cover" href="${escapeHtml(projectHref)}" aria-label="${escapeHtml(title)}">
          <img src="${escapeHtml(cover.url)}" alt="${escapeHtml(getPortalMediaAlt(cover, lang, imageAltFallback))}" loading="lazy" decoding="async" />
          <span class="portal-media-count">${escapeHtml(String(mediaItems.length || 1))} ${escapeHtml(isSpanish ? "fotos" : "photos")}</span>
        </a>
      `
    : `
        <a class="portal-media-cover" href="${escapeHtml(projectHref)}" aria-label="${escapeHtml(title)}">
          <div class="portal-media-fallback">${escapeHtml(title)}</div>
        </a>
      `;

  const thumbsHtml = thumbItems.length
    ? `
        <div class="portal-media-thumbs" aria-hidden="true">
          ${thumbItems
            .map((entry, index) => {
              const isLastVisible = index === thumbItems.length - 1 && extraCount > 0;
              return `
                <span class="portal-media-thumb">
                  <img src="${escapeHtml(entry.url)}" alt="" loading="lazy" decoding="async" />
                  ${isLastVisible ? `<span class="portal-media-thumb-more">+${escapeHtml(String(extraCount))}</span>` : ""}
                </span>
              `;
            })
            .join("")}
        </div>
      `
    : "";

  return `<div class="portal-media-shell">${coverHtml}${thumbsHtml}</div>`;
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
  if (loadingShellText instanceof HTMLElement) loadingShellText.textContent = message;
};

const showPrivateShell = () => {
  if (privateShell instanceof HTMLElement) privateShell.removeAttribute("hidden");
  if (loadingShell instanceof HTMLElement) loadingShell.setAttribute("hidden", "");
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
    if (refreshed && !isSessionExpired(refreshed)) return refreshed;
    clearSession();
    redirectToLogin("expired_session");
    return null;
  }
  return session;
};

const requestAuthed = async (path, params = {}) => {
  const requestOnce = () =>
    requestJson(buildPortalApiUrl(path, params), {
      headers: {
        Authorization: `${toText(state.session?.tokenType) ?? "bearer"} ${toText(state.session?.accessToken) ?? ""}`.trim(),
      },
    });

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

const updateStats = () => {
  if (projectCount instanceof HTMLElement) projectCount.textContent = String(state.projectCount);
  if (unitCount instanceof HTMLElement) unitCount.textContent = String(state.properties.length);
};

const renderProperties = () => {
  if (!(list instanceof HTMLElement)) return;
  if (!state.properties.length) {
    list.innerHTML = `<div class="portal-empty">${
      isSpanish
        ? "No hay propiedades disponibles para esta cuenta en este momento."
        : "There are no available properties for this account right now."
    }</div>`;
    return;
  }

  list.innerHTML = state.properties
    .map((item) => {
      const title = toText(item.title) ?? (isSpanish ? "Unidad" : "Unit");
      const projectTitle = toText(item.project_title) ?? (isSpanish ? "Proyecto" : "Project");
      const projectId = toText(item.project_property_id);
      const legacyCode = toText(item.legacy_code);
      const floorLabel = toText(item.floor_label);
      const areaValue = Number(item.area_m2);
      const areaText = Number.isFinite(areaValue) && areaValue > 0 ? `${areaValue.toFixed(0)} m2` : null;
      const bedroomsValue = Number(item.bedrooms);
      const bedroomsText = Number.isFinite(bedroomsValue) ? `${bedroomsValue.toFixed(0)} ${isSpanish ? "hab" : "beds"}` : null;
      const bathroomsValue = Number(item.bathrooms);
      const bathroomsText = Number.isFinite(bathroomsValue) ? `${bathroomsValue.toFixed(0)} ${isSpanish ? "banos" : "baths"}` : null;
      const salePrice = formatCurrency(item.price_sale, item.currency ?? "EUR", locale);
      const rentPrice = formatCurrency(item.price_rent_monthly, item.currency ?? "EUR", locale);
      const updatedAt = formatDateTime(toText(item.updated_at), locale);
      const specs = [areaText, bedroomsText, bathroomsText].filter(Boolean).join(" | ");
      const projectHref = projectId ? portalPath(lang, `/portal/project/${projectId}`) : portalPath(lang, "/portal/");

      return `
        <article class="portal-property-card">
          ${renderPropertyMedia(item, title, projectHref)}
          <p class="portal-item-title">${escapeHtml(title)}</p>
          <p class="portal-item-meta">${escapeHtml(projectTitle)}</p>
          ${legacyCode ? `<p class="portal-item-meta">${escapeHtml((isSpanish ? "Referencia" : "Reference") + ": " + legacyCode)}</p>` : ""}
          ${floorLabel ? `<p class="portal-item-meta">${escapeHtml((isSpanish ? "Planta" : "Floor") + ": " + floorLabel)}</p>` : ""}
          ${specs ? `<p class="portal-item-meta">${escapeHtml(specs)}</p>` : ""}
          <div class="portal-badges">
            <span class="portal-badge ${statusBadgeClass(item.project_status)}">${escapeHtml(statusLabel(item.project_status, lang))}</span>
          </div>
          <p class="portal-item-meta">${escapeHtml(
            salePrice
              ? `${isSpanish ? "Venta" : "Sale"}: ${salePrice}`
              : isSpanish
                ? "Precio de venta a consultar"
                : "Sale price on request"
          )}</p>
          ${rentPrice ? `<p class="portal-item-meta">${escapeHtml((isSpanish ? "Alquiler" : "Rent") + ": " + rentPrice)}</p>` : ""}
          <p class="portal-item-meta">${escapeHtml((isSpanish ? "Actualizado" : "Updated") + ": " + updatedAt)}</p>
          <div class="portal-actions">
            ${projectId ? `<a class="portal-button-soft" href="${escapeHtml(portalPath(lang, `/portal/project/${projectId}`))}">${isSpanish ? "Abrir proyecto" : "Open project"}</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
};

const loadProperties = async (q = "") => {
  const session = await ensureSession();
  if (!session) return;
  state.session = session;
  showPrivateShell();

  const loadingMessage = isSpanish ? "Cargando propiedades..." : "Loading properties...";
  setLoadingMessage(loadingMessage);
  setFeedback(loadingMessage, "warn");

  try {
    const payload = await requestAuthed("/properties", {
      q: toText(q),
      organization_id: toText(state.session?.organizationId),
    });

    state.properties = Array.isArray(payload?.data) ? payload.data : [];
    state.projectCount = Number(payload?.meta?.projects_count ?? 0);
    updateStats();
    renderProperties();

    setFeedback(
      isSpanish
        ? `Listado actualizado (${state.properties.length} propiedades en ${state.projectCount} promociones).`
        : `List updated (${state.properties.length} properties across ${state.projectCount} projects).`,
      "ok"
    );
  } catch (error) {
    if (handlePossibleAuthFailure(error)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(isSpanish ? `Error cargando propiedades: ${message}` : `Properties load error: ${message}`, "error");
  }
};

refreshButton?.addEventListener("click", async () => {
  await loadProperties(toText(searchInput?.value) ?? "");
});

logoutButton?.addEventListener("click", () => {
  clearSession();
  window.location.href = portalPath(lang, "/portal/login");
});

searchInput?.addEventListener("input", () => {
  if (state.searchTimer) clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(async () => {
    await loadProperties(toText(searchInput?.value) ?? "");
  }, 240);
});

loadProperties();
