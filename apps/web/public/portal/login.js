import {
  buildPortalApiUrl,
  clearSession,
  escapeHtml,
  getBootstrap,
  isSessionAuthenticated,
  isSessionExpired,
  loadSession,
  portalPath,
  requestJson,
  roleLabel,
  saveSession,
  toText,
} from "/portal/shared.js";

const bootstrap = getBootstrap();
const lang = bootstrap.lang;
const isSpanish = lang === "es";

const copy = {
  ready: isSpanish ? "Listo para iniciar sesion." : "Ready to sign in.",
  noSession: isSpanish ? "No hay sesion activa en este navegador." : "No active session in this browser.",
  validating: isSpanish ? "Validando credenciales..." : "Validating credentials...",
  loginOk: isSpanish ? "Acceso correcto. Redirigiendo al portal..." : "Login successful. Redirecting...",
  sessionCleared: isSpanish ? "Sesion cerrada en este navegador." : "Session cleared on this browser.",
  loadingSession: isSpanish ? "Sesion activa detectada." : "Active session detected.",
  expiredSession: isSpanish ? "La sesion almacenada habia expirado y se elimino." : "Stored session had expired and was removed.",
  requestReady:
    isSpanish
      ? "Completa tus datos profesionales para solicitar acceso al portal."
      : "Complete your professional details to request portal access.",
  requestSending: isSpanish ? "Enviando solicitud..." : "Submitting request...",
  requestCreated:
    isSpanish
      ? "Solicitud enviada. El equipo revisara el alta en CRM Portal y te contactaremos si se aprueba."
      : "Request sent. The team will review the onboarding in CRM Portal and contact you if approved.",
  requestPending:
    isSpanish
      ? "Ya existe una solicitud pendiente para este email en el modulo Portal. Te avisaremos tras revisarla."
      : "There is already a pending request for this email in the Portal module. We will notify you after review.",
  requestInviteExists:
    isSpanish
      ? "Ya existe una invitacion pendiente para este email. Revisa tu canal de recepcion."
      : "There is already a pending invite for this email. Check your delivery channel.",
};

const form = document.getElementById("portal-login-form");
const emailInput = document.getElementById("portal-login-email");
const passwordInput = document.getElementById("portal-login-password");
const rememberInput = document.getElementById("portal-login-remember");
const clearButton = document.getElementById("portal-login-clear");
const feedback = document.getElementById("portal-login-feedback");
const sessionState = document.getElementById("portal-login-session-state");
const requestForm = document.getElementById("portal-access-request-form");
const requestFullNameInput = document.getElementById("portal-access-request-full-name");
const requestEmailInput = document.getElementById("portal-access-request-email");
const requestCompanyNameInput = document.getElementById("portal-access-request-company-name");
const requestCommercialNameInput = document.getElementById("portal-access-request-commercial-name");
const requestLegalNameInput = document.getElementById("portal-access-request-legal-name");
const requestCifInput = document.getElementById("portal-access-request-cif");
const requestPhoneInput = document.getElementById("portal-access-request-phone");
const requestFeedback = document.getElementById("portal-access-request-feedback");

const query = new URLSearchParams(window.location.search);
const nextTarget = (() => {
  const next = toText(query.get("next"));
  if (next && next.startsWith("/")) return next;
  return portalPath(lang, "/portal");
})();

const setFeedback = (message, kind = "warn") => {
  if (!(feedback instanceof HTMLElement)) return;
  feedback.textContent = message;
  feedback.classList.remove("is-ok", "is-warn", "is-error");
  if (kind === "ok") feedback.classList.add("is-ok");
  else if (kind === "error") feedback.classList.add("is-error");
  else feedback.classList.add("is-warn");
};

const setRequestFeedback = (message, kind = "warn") => {
  if (!(requestFeedback instanceof HTMLElement)) return;
  requestFeedback.textContent = message;
  requestFeedback.classList.remove("is-ok", "is-warn", "is-error");
  if (kind === "ok") requestFeedback.classList.add("is-ok");
  else if (kind === "error") requestFeedback.classList.add("is-error");
  else requestFeedback.classList.add("is-warn");
};

const renderSessionState = (session) => {
  if (!(sessionState instanceof HTMLElement)) return;
  if (!session || !isSessionAuthenticated(session)) {
    sessionState.innerHTML = copy.noSession;
    return;
  }

  const expiresAt = Number(session.expiresAt ?? 0);
  const expiresText =
    Number.isFinite(expiresAt) && expiresAt > 0
      ? new Date(expiresAt * 1000).toLocaleString(lang === "es" ? "es-ES" : "en-GB")
      : "-";
  const authState = isSessionExpired(session)
    ? isSpanish
      ? "Expirada"
      : "Expired"
    : isSpanish
      ? "Activa"
      : "Active";

  sessionState.innerHTML = `
    <p><strong>email:</strong> ${escapeHtml(session.email ?? "-")}</p>
    <p><strong>role:</strong> ${escapeHtml(roleLabel(session.role, lang))}</p>
    <p><strong>token_status:</strong> ${escapeHtml(authState)}</p>
    <p><strong>expires_at:</strong> ${escapeHtml(expiresText)}</p>
    <p><strong>updated_at:</strong> ${escapeHtml(session.updatedAt ?? "-")}</p>
  `;
};

const restoreFromSession = () => {
  const existing = loadSession();
  const queryEmail = toText(query.get("email"));

  if (emailInput instanceof HTMLInputElement) {
    emailInput.value = queryEmail ?? existing?.email ?? "";
  }

  if (existing && isSessionExpired(existing)) {
    clearSession();
    renderSessionState(null);
    setFeedback(copy.expiredSession, "warn");
    return;
  }

  renderSessionState(existing);
  if (existing && isSessionAuthenticated(existing)) setFeedback(copy.loadingSession, "ok");
  else setFeedback(copy.ready, "warn");
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = toText(emailInput?.value)?.toLowerCase() ?? null;
  const password = toText(passwordInput?.value);

  if (!email) {
    setFeedback(
      isSpanish
        ? "Debes informar un email valido."
        : "A valid email is required.",
      "error"
    );
    return;
  }
  if (!password) {
    setFeedback(isSpanish ? "La contrasena es obligatoria." : "Password is required.", "error");
    return;
  }

  setFeedback(copy.validating, "warn");

  try {
    const payload = await requestJson(buildPortalApiUrl("/auth/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    const portalAccount = payload?.data?.portal_account ?? {};
    const authUser = payload?.data?.auth_user ?? {};
    const authSession = payload?.data?.session ?? {};
    const remember = rememberInput instanceof HTMLInputElement ? rememberInput.checked : true;
    const saved = saveSession(
      {
        accessToken: toText(authSession.access_token),
        refreshToken: toText(authSession.refresh_token),
        tokenType: toText(authSession.token_type),
        expiresAt: authSession.expires_at,
        expiresIn: authSession.expires_in,
        organizationId: toText(portalAccount.organization_id),
        portalAccountId: toText(portalAccount.id),
        role: toText(portalAccount.role),
        email: toText(authUser.email) ?? email,
        authUserId: toText(authUser.id),
      },
      { remember }
    );
    if (!saved) throw new Error("session_persist_failed");

    renderSessionState(loadSession());
    if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
    setFeedback(copy.loginOk, "ok");
    setTimeout(() => {
      window.location.href = nextTarget;
    }, 250);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `No se pudo iniciar sesion: ${message}` : `Login failed: ${message}`,
      "error"
    );
  }
});

clearButton?.addEventListener("click", () => {
  clearSession();
  renderSessionState(null);
  if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
  setFeedback(copy.sessionCleared, "ok");
});

requestForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fullName = toText(requestFullNameInput?.value);
  const email = toText(requestEmailInput?.value)?.toLowerCase() ?? null;
  const companyName = toText(requestCompanyNameInput?.value);
  const commercialName = toText(requestCommercialNameInput?.value);
  const legalName = toText(requestLegalNameInput?.value);
  const cif = toText(requestCifInput?.value);
  const phone = toText(requestPhoneInput?.value);

  if (!fullName) {
    setRequestFeedback(
      isSpanish ? "Debes indicar tu nombre completo." : "Full name is required.",
      "error"
    );
    return;
  }

  if (!email) {
    setRequestFeedback(
      isSpanish ? "Debes indicar un email valido." : "A valid email is required.",
      "error"
    );
    return;
  }

  if (!companyName) {
    setRequestFeedback(
      isSpanish ? "Debes indicar la empresa o agencia." : "Company or agency is required.",
      "error"
    );
    return;
  }

  if (!commercialName) {
    setRequestFeedback(
      isSpanish ? "Debes indicar el nombre comercial." : "Trade name is required.",
      "error"
    );
    return;
  }

  if (!legalName) {
    setRequestFeedback(
      isSpanish ? "Debes indicar la razon social." : "Legal name is required.",
      "error"
    );
    return;
  }

  if (!cif) {
    setRequestFeedback(
      isSpanish ? "Debes indicar el CIF." : "VAT / Tax ID is required.",
      "error"
    );
    return;
  }

  setRequestFeedback(copy.requestSending, "warn");

  try {
    const payload = await requestJson(buildPortalApiUrl("/auth/request-access"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        full_name: fullName,
        email,
        company_name: companyName,
        commercial_name: commercialName,
        legal_name: legalName,
        cif,
        phone,
        language: lang,
      }),
    });

    const requestStatus = toText(payload?.meta?.request_status);
    if (requestStatus === "already_pending") {
      setRequestFeedback(copy.requestPending, "ok");
    } else if (requestStatus === "invite_already_pending") {
      setRequestFeedback(copy.requestInviteExists, "ok");
    } else {
      setRequestFeedback(copy.requestCreated, "ok");
    }

    if (requestFullNameInput instanceof HTMLInputElement) requestFullNameInput.value = "";
    if (requestEmailInput instanceof HTMLInputElement) requestEmailInput.value = "";
    if (requestCompanyNameInput instanceof HTMLInputElement) requestCompanyNameInput.value = "";
    if (requestCommercialNameInput instanceof HTMLInputElement) requestCommercialNameInput.value = "";
    if (requestLegalNameInput instanceof HTMLInputElement) requestLegalNameInput.value = "";
    if (requestCifInput instanceof HTMLInputElement) requestCifInput.value = "";
    if (requestPhoneInput instanceof HTMLInputElement) requestPhoneInput.value = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRequestFeedback(
      isSpanish ? `No se pudo enviar la solicitud: ${message}` : `Could not submit request: ${message}`,
      "error"
    );
  }
});

restoreFromSession();
setRequestFeedback(copy.requestReady, "warn");
