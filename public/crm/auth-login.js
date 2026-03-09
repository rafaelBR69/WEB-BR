(() => {
  const form = document.getElementById("crm-login-form");
  if (!(form instanceof HTMLFormElement)) return;

  const submitButton = document.getElementById("crm-login-submit");
  const feedback = document.getElementById("crm-login-feedback");
  const nextInput = document.getElementById("crm-login-next");

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

  const setFeedback = (message, kind = "ok") => {
    if (!(feedback instanceof HTMLElement)) return;
    feedback.textContent = message;
    feedback.classList.remove("is-ok", "is-error");
    if (kind === "error") feedback.classList.add("is-error");
    else feedback.classList.add("is-ok");
  };

  const parseJsonSafe = (raw) => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const setSubmitting = (isSubmitting) => {
    if (!(submitButton instanceof HTMLButtonElement)) return;
    submitButton.disabled = isSubmitting;
    submitButton.setAttribute("aria-disabled", String(isSubmitting));
    submitButton.textContent = isSubmitting ? "Validando..." : "Entrar al CRM";
  };

  const queryNext = new URLSearchParams(window.location.search).get("next");
  const defaultNext = safeNextPath(queryNext ?? window.__crmAuthNext ?? "/crm/");
  if (nextInput instanceof HTMLInputElement) nextInput.value = defaultNext;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      setSubmitting(true);
      setFeedback("Validando credenciales...", "ok");

      try {
        const formData = new FormData(form);
        const payload = {
          email: toText(formData.get("email")),
          password: toText(formData.get("password")),
        };

        const response = await fetch("/api/v1/crm/auth/login", {
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

        setFeedback("Sesion iniciada. Redirigiendo...", "ok");
        const requestedNext = toText(formData.get("next"));
        window.location.href = safeNextPath(requestedNext ?? defaultNext);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`No se pudo iniciar sesion: ${message}`, "error");
      } finally {
        setSubmitting(false);
      }
    })();
  });
})();
