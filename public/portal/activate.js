import {
  buildPortalApiUrl,
  escapeHtml,
  getBootstrap,
  loadSession,
  portalPath,
  requestJson,
  roleLabel,
  saveSession,
  statusLabel,
  toText,
} from "/portal/shared.js";

const bootstrap = getBootstrap();
const lang = bootstrap.lang;
const isSpanish = lang === "es";

const form = document.getElementById("portal-activate-form");
const validateButton = document.getElementById("portal-activate-validate");
const feedback = document.getElementById("portal-activate-feedback");
const resultBox = document.getElementById("portal-activate-result");

const organizationInput = document.getElementById("portal-activate-organization");
const emailInput = document.getElementById("portal-activate-email");
const codeInput = document.getElementById("portal-activate-code");
const passwordInput = document.getElementById("portal-activate-password");
const fullNameInput = document.getElementById("portal-activate-name");
const projectInput = document.getElementById("portal-activate-project");

const setFeedback = (message, kind = "warn") => {
  if (!(feedback instanceof HTMLElement)) return;
  feedback.textContent = message;
  feedback.classList.remove("is-ok", "is-warn", "is-error");
  if (kind === "ok") feedback.classList.add("is-ok");
  else if (kind === "error") feedback.classList.add("is-error");
  else feedback.classList.add("is-warn");
};

const setResult = (html) => {
  if (!(resultBox instanceof HTMLElement)) return;
  resultBox.innerHTML = html;
};

const getFormState = () => {
  const organizationId = toText(organizationInput?.value);
  const email = toText(emailInput?.value)?.toLowerCase() ?? null;
  const code = toText(codeInput?.value)?.toUpperCase() ?? null;
  const password = toText(passwordInput?.value);
  const fullName = toText(fullNameInput?.value);
  const projectPropertyId = toText(projectInput?.value);

  return {
    organizationId,
    email,
    code,
    password,
    fullName,
    projectPropertyId,
  };
};

const validateMinimal = (state, mode = "activate") => {
  if (!state.organizationId) {
    setFeedback(
      isSpanish ? "organization_id es obligatorio." : "organization_id is required.",
      "error"
    );
    return false;
  }
  if (!state.email) {
    setFeedback(isSpanish ? "Email es obligatorio." : "Email is required.", "error");
    return false;
  }
  if (!state.code) {
    setFeedback(isSpanish ? "Codigo es obligatorio." : "Code is required.", "error");
    return false;
  }
  if (mode === "activate") {
    if (!state.password || state.password.length < 8) {
      setFeedback(
        isSpanish
          ? "Password obligatorio (minimo 8 caracteres)."
          : "Password required (minimum 8 chars).",
        "error"
      );
      return false;
    }
  }
  return true;
};

const renderValidationResult = (payload) => {
  const invite = payload?.data?.invite || {};
  const remaining = payload?.data?.remaining_attempts;
  const lines = [
    `<p><strong>invite_id:</strong> <span class="portal-inline-code">${escapeHtml(invite.id ?? "-")}</span></p>`,
    `<p><strong>email:</strong> ${escapeHtml(invite.email ?? "-")}</p>`,
    `<p><strong>role:</strong> ${escapeHtml(roleLabel(invite.role, lang))}</p>`,
    `<p><strong>status:</strong> ${escapeHtml(statusLabel(invite.status, lang))}</p>`,
  ];
  if (remaining != null) {
    lines.push(`<p><strong>remaining_attempts:</strong> ${escapeHtml(String(remaining))}</p>`);
  }
  setResult(lines.join(""));
};

const renderActivationResult = (payload) => {
  const data = payload?.data || {};
  const account = data.portal_account || {};
  const membership = data.membership || null;
  const invite = data.invite || {};
  const lines = [
    `<p><strong>auth_user_id:</strong> <span class="portal-inline-code">${escapeHtml(data.auth_user_id ?? "-")}</span></p>`,
    `<p><strong>portal_account_id:</strong> <span class="portal-inline-code">${escapeHtml(account.id ?? "-")}</span></p>`,
    `<p><strong>role:</strong> ${escapeHtml(roleLabel(account.role, lang))}</p>`,
    `<p><strong>status:</strong> ${escapeHtml(statusLabel(account.status, lang))}</p>`,
    `<p><strong>invite_status:</strong> ${escapeHtml(statusLabel(invite.status, lang))}</p>`,
  ];
  if (membership?.project_property_id) {
    lines.push(
      `<p><strong>membership_project:</strong> <span class="portal-inline-code">${escapeHtml(
        membership.project_property_id
      )}</span></p>`
    );
  }
  setResult(lines.join(""));
};

validateButton?.addEventListener("click", async () => {
  const state = getFormState();
  if (!validateMinimal(state, "validate")) return;

  setFeedback(isSpanish ? "Validando codigo..." : "Validating code...", "warn");

  try {
    const payload = await requestJson(buildPortalApiUrl("/auth/validate-code"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organization_id: state.organizationId,
        email: state.email,
        code: state.code,
        project_property_id: state.projectPropertyId,
      }),
    });

    renderValidationResult(payload);
    setFeedback(
      isSpanish ? "Codigo valido para esta invitacion." : "Code validated for invite.",
      "ok"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `Validacion fallida: ${message}` : `Validation failed: ${message}`,
      "error"
    );
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const state = getFormState();
  if (!validateMinimal(state, "activate")) return;

  setFeedback(isSpanish ? "Activando cuenta..." : "Activating account...", "warn");

  try {
    const activationPayload = await requestJson(buildPortalApiUrl("/auth/activate"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organization_id: state.organizationId,
        email: state.email,
        code: state.code,
        password: state.password,
        full_name: state.fullName,
        project_property_id: state.projectPropertyId,
      }),
    });

    renderActivationResult(activationPayload);

    try {
      const loginPayload = await requestJson(buildPortalApiUrl("/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: state.email,
          password: state.password,
        }),
      });

      const portalAccount = loginPayload?.data?.portal_account ?? {};
      const authUser = loginPayload?.data?.auth_user ?? {};
      const authSession = loginPayload?.data?.session ?? {};

      const saved = saveSession({
        accessToken: toText(authSession.access_token),
        refreshToken: toText(authSession.refresh_token),
        tokenType: toText(authSession.token_type),
        expiresAt: authSession.expires_at,
        expiresIn: authSession.expires_in,
        organizationId: toText(portalAccount.organization_id) ?? state.organizationId,
        portalAccountId: toText(portalAccount.id),
        role: toText(portalAccount.role),
        email: toText(authUser.email) ?? state.email,
        authUserId: toText(authUser.id),
      });
      if (!saved) throw new Error("session_persist_failed");

      setFeedback(
        isSpanish ? "Cuenta activada. Redirigiendo al dashboard..." : "Account activated. Redirecting...",
        "ok"
      );

      setTimeout(() => {
        window.location.href = portalPath(lang, "/portal");
      }, 420);
    } catch (loginError) {
      const loginMessage = loginError instanceof Error ? loginError.message : String(loginError);
      setFeedback(
        isSpanish
          ? `Cuenta activada, pero el login automatico fallo: ${loginMessage}`
          : `Account activated, but automatic login failed: ${loginMessage}`,
        "warn"
      );

      const loginUrl = new URL(portalPath(lang, "/portal/login"), window.location.origin);
      if (state.email) loginUrl.searchParams.set("email", state.email);
      setTimeout(() => {
        window.location.href = loginUrl.toString();
      }, 900);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFeedback(
      isSpanish ? `No se pudo activar: ${message}` : `Activation failed: ${message}`,
      "error"
    );
  }
});

(() => {
  const query = new URLSearchParams(window.location.search);
  const existing = loadSession();

  if (organizationInput instanceof HTMLInputElement) {
    organizationInput.value =
      toText(query.get("organization_id")) ??
      existing?.organizationId ??
      bootstrap.defaultOrganizationId ??
      "";
  }
  if (emailInput instanceof HTMLInputElement) {
    emailInput.value = toText(query.get("email")) ?? existing?.email ?? "";
  }

  setResult(
    isSpanish
      ? "Valida primero el codigo para verificar intentos restantes antes de activar."
      : "Validate code first to check remaining attempts before activation."
  );
  setFeedback(
    isSpanish ? "Completa el formulario para iniciar activacion." : "Fill the form to start activation.",
    "warn"
  );
})();
