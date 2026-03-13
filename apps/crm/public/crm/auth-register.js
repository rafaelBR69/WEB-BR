(() => {
  const form = document.getElementById("crm-register-form");
  if (!(form instanceof HTMLFormElement)) return;

  const submitButton = document.getElementById("crm-register-submit");
  const feedback = document.getElementById("crm-register-feedback");
  const nextInput = document.getElementById("crm-register-next");

  const toText = (value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  };

  const safeNextPath = (value) => {
    const fallback = "/crm/";
    const text = toText(value) ?? fallback;
    if (!text.startsWith("/crm")) return fallback;
    return text;
  };

  const parseJsonSafe = (raw) => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(feedback instanceof HTMLElement)) return;
    feedback.textContent = message;
    feedback.classList.remove("is-ok", "is-error");
    if (kind === "error") feedback.classList.add("is-error");
    else feedback.classList.add("is-ok");
  };

  const setSubmitting = (isSubmitting) => {
    if (!(submitButton instanceof HTMLButtonElement)) return;
    submitButton.disabled = isSubmitting;
    submitButton.setAttribute("aria-disabled", String(isSubmitting));
    submitButton.textContent = isSubmitting ? "Creando..." : "Crear cuenta";
  };

  const queryNext = new URLSearchParams(window.location.search).get("next");
  const defaultNext = safeNextPath(queryNext ?? window.__crmAuthNext ?? "/crm/");
  if (nextInput instanceof HTMLInputElement) nextInput.value = defaultNext;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      setSubmitting(true);
      setFeedback("Creando usuario CRM...", "ok");

      try {
        const formData = new FormData(form);
        const password = toText(formData.get("password"));
        const passwordConfirm = toText(formData.get("password_confirm"));
        if (!password || password.length < 8) {
          throw new Error("password_too_short: minimo 8 caracteres");
        }
        if (password !== passwordConfirm) {
          throw new Error("password_mismatch: las contrasenas no coinciden");
        }

        const payload = {
          full_name: toText(formData.get("full_name")),
          email: toText(formData.get("email")),
          password,
        };

        const response = await fetch("/api/v1/crm/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const raw = await response.text();
        const result = parseJsonSafe(raw);

        if (!response.ok || !result?.ok) {
          const code = toText(result?.error) ?? `http_${response.status}`;
          const details = toText(result?.details);
          throw new Error(details ? `${code}: ${details}` : code);
        }

        setFeedback("Cuenta creada. Redirigiendo al CRM...", "ok");
        const requestedNext = toText(formData.get("next"));
        window.location.href = safeNextPath(requestedNext ?? defaultNext);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`No se pudo registrar: ${message}`, "error");
      } finally {
        setSubmitting(false);
      }
    })();
  });
})();
