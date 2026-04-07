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
      ? "Solicitud enviada. El equipo la revisara en CRM y, si se aprueba, recibiras por email el enlace de activacion y tu codigo."
      : "Request sent. The team will review it in CRM and, if approved, you will receive the activation link and one-time code by email.",
  requestPending:
    isSpanish
      ? "Ya existe una solicitud pendiente para este email en el modulo Portal. Te avisaremos tras revisarla."
      : "There is already a pending request for this email in the Portal module. We will notify you after review.",
  requestInviteExists:
    isSpanish
      ? "Ya existe una invitacion pendiente para este email. Revisa tu email: la activacion solo se completa desde el enlace recibido."
      : "There is already a pending invite for this email. Check your email: activation is completed only from the received link.",
  professionalType: {
    company: {
      hint: isSpanish
        ? "Solicitas acceso en nombre de una empresa, despacho o agencia."
        : "You are requesting access on behalf of a company, firm or agency.",
      companyLabel: isSpanish ? "Empresa o agencia" : "Company or agency",
      companyPlaceholder: isSpanish ? "Nombre de la empresa o agencia" : "Company or agency name",
      commercialLabel: isSpanish ? "Nombre comercial" : "Trade name",
      commercialPlaceholder: isSpanish ? "Marca comercial o nombre comercial" : "Trading name or brand",
      legalLabel: isSpanish ? "Razon social" : "Legal name",
      legalPlaceholder: isSpanish ? "Denominacion legal o sociedad" : "Registered legal entity",
      cifLabel: isSpanish ? "CIF" : "VAT / Tax ID",
      cifPlaceholder: isSpanish ? "CIF de la empresa" : "Company VAT / Tax ID",
    },
    selfEmployed: {
      hint: isSpanish
        ? "Solicitas acceso como autonomo. Solo pedimos tus datos fiscales y profesionales."
        : "You are requesting access as a self-employed professional. We only ask for your fiscal and professional details.",
      companyLabel: isSpanish ? "Nombre profesional o despacho (opcional)" : "Professional or practice name (optional)",
      companyPlaceholder: isSpanish ? "Como quieres que identifiquemos tu actividad" : "How should we identify your activity",
      commercialLabel: isSpanish ? "Nombre comercial (opcional)" : "Trading name (optional)",
      commercialPlaceholder: isSpanish ? "Solo si trabajas con una marca comercial" : "Only if you use a trading name",
      legalLabel: isSpanish ? "Nombre fiscal completo" : "Full legal name",
      legalPlaceholder: isSpanish ? "Nombre y apellidos fiscales" : "Full legal name",
      cifLabel: isSpanish ? "NIF / CIF" : "Tax ID",
      cifPlaceholder: isSpanish ? "Tu NIF o CIF profesional" : "Your tax identification number",
    },
  },
};

const form = document.getElementById("portal-login-form");
const emailInput = document.getElementById("portal-login-email");
const passwordInput = document.getElementById("portal-login-password");
const rememberInput = document.getElementById("portal-login-remember");
const clearButton = document.getElementById("portal-login-clear");
const feedback = document.getElementById("portal-login-feedback");
const sessionState = document.getElementById("portal-login-session-state");
const requestForm = document.getElementById("portal-access-request-form");
const requestProfessionalTypeInput = document.getElementById("portal-access-request-professional-type");
const requestFullNameInput = document.getElementById("portal-access-request-full-name");
const requestEmailInput = document.getElementById("portal-access-request-email");
const requestIdentityHint = document.getElementById("portal-access-request-identity-hint");
const requestCompanyField = document.getElementById("portal-access-request-company-field");
const requestCompanyLabel = document.getElementById("portal-access-request-company-label");
const requestCompanyNameInput = document.getElementById("portal-access-request-company-name");
const requestCommercialField = document.getElementById("portal-access-request-commercial-field");
const requestCommercialLabel = document.getElementById("portal-access-request-commercial-label");
const requestCommercialNameInput = document.getElementById("portal-access-request-commercial-name");
const requestLegalLabel = document.getElementById("portal-access-request-legal-label");
const requestLegalNameInput = document.getElementById("portal-access-request-legal-name");
const requestCifLabel = document.getElementById("portal-access-request-cif-label");
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

const getProfessionalType = () =>
  requestProfessionalTypeInput instanceof HTMLSelectElement && requestProfessionalTypeInput.value === "self_employed"
    ? "self_employed"
    : "company";

const syncProfessionalTypeUi = () => {
  const professionalType = getProfessionalType();
  const mode = professionalType === "self_employed" ? copy.professionalType.selfEmployed : copy.professionalType.company;

  if (requestIdentityHint instanceof HTMLElement) requestIdentityHint.textContent = mode.hint;
  if (requestCompanyLabel instanceof HTMLElement) requestCompanyLabel.textContent = mode.companyLabel;
  if (requestCommercialLabel instanceof HTMLElement) requestCommercialLabel.textContent = mode.commercialLabel;
  if (requestLegalLabel instanceof HTMLElement) requestLegalLabel.textContent = mode.legalLabel;
  if (requestCifLabel instanceof HTMLElement) requestCifLabel.textContent = mode.cifLabel;

  if (requestCompanyNameInput instanceof HTMLInputElement) {
    requestCompanyNameInput.placeholder = mode.companyPlaceholder;
    requestCompanyNameInput.required = professionalType === "company";
  }
  if (requestCommercialNameInput instanceof HTMLInputElement) {
    requestCommercialNameInput.placeholder = mode.commercialPlaceholder;
    requestCommercialNameInput.required = professionalType === "company";
  }
  if (requestLegalNameInput instanceof HTMLInputElement) {
    requestLegalNameInput.placeholder = mode.legalPlaceholder;
  }
  if (requestCifInput instanceof HTMLInputElement) {
    requestCifInput.placeholder = mode.cifPlaceholder;
  }

  if (requestCompanyField instanceof HTMLElement) {
    requestCompanyField.hidden = professionalType === "self_employed";
  }
  if (requestCommercialField instanceof HTMLElement) {
    requestCommercialField.hidden = professionalType === "self_employed";
  }
  if (professionalType === "self_employed" && requestCompanyNameInput instanceof HTMLInputElement) {
    requestCompanyNameInput.value = "";
  }
  if (professionalType === "self_employed" && requestCommercialNameInput instanceof HTMLInputElement) {
    requestCommercialNameInput.value = "";
  }
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

  const professionalType = getProfessionalType();
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

  if (professionalType === "company" && !companyName) {
    setRequestFeedback(
      isSpanish ? "Debes indicar la empresa o agencia." : "Company or agency is required.",
      "error"
    );
    return;
  }

  if (professionalType === "company" && !commercialName) {
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
        professional_type: professionalType,
        full_name: fullName,
        email,
        company_name: companyName ?? (professionalType === "self_employed" ? fullName : null),
        commercial_name:
          commercialName ??
          (professionalType === "self_employed" ? companyName ?? legalName ?? fullName : null),
        legal_name: legalName ?? (professionalType === "self_employed" ? fullName : null),
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
requestProfessionalTypeInput?.addEventListener("change", syncProfessionalTypeUi);
syncProfessionalTypeUi();
setRequestFeedback(copy.requestReady, "warn");
