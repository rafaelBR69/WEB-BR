(() => {
  const root = document.getElementById("crm-profile-page-feedback");
  if (!(root instanceof HTMLElement)) return;

  const el = {
    fullName: document.getElementById("crm-profile-page-full-name"),
    email: document.getElementById("crm-profile-page-email"),
    role: document.getElementById("crm-profile-page-role"),
    id: document.getElementById("crm-profile-page-id"),
    lastSignIn: document.getElementById("crm-profile-page-last-sign-in"),
    createdAt: document.getElementById("crm-profile-page-created-at"),
    refresh: document.getElementById("crm-profile-page-refresh"),
    logout: document.getElementById("crm-profile-page-logout"),
    feedback: root,
  };

  const toText = (value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  };

  const parseJsonSafe = (raw) => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const formatDateTime = (value) => {
    const text = toText(value);
    if (!text) return "-";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleString("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const setText = (node, value) => {
    if (!(node instanceof HTMLElement)) return;
    node.textContent = value;
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "error") el.feedback.classList.add("is-error");
    else el.feedback.classList.add("is-ok");
  };

  const redirectToLogin = () => {
    const loginUrl = new URL("/crm/login/", window.location.origin);
    loginUrl.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
    window.location.href = `${loginUrl.pathname}${loginUrl.search}`;
  };

  const loadProfile = async () => {
    setFeedback("Cargando perfil...", "ok");
    const response = await fetch("/api/v1/crm/auth/me");
    const raw = await response.text();
    const payload = parseJsonSafe(raw);

    if (response.status === 401) {
      redirectToLogin();
      return null;
    }
    if (!response.ok || !payload?.ok) {
      const code = toText(payload?.error) ?? `http_${response.status}`;
      const details = toText(payload?.details);
      throw new Error(details ? `${code}: ${details}` : code);
    }

    const user = payload?.data?.user ?? {};
    setText(el.fullName, toText(user.full_name) ?? "-");
    setText(el.email, toText(user.email) ?? "-");
    setText(el.role, toText(user.role) ?? "-");
    setText(el.id, toText(user.id) ?? "-");
    setText(el.lastSignIn, formatDateTime(user.last_sign_in_at));
    setText(el.createdAt, formatDateTime(user.created_at));
    setFeedback("Perfil actualizado.", "ok");
    return user;
  };

  const logout = async () => {
    const response = await fetch("/api/v1/crm/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error(`http_${response.status}`);
    redirectToLogin();
  };

  el.refresh?.addEventListener("click", () => {
    void (async () => {
      try {
        await loadProfile();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`No se pudo cargar perfil: ${message}`, "error");
      }
    })();
  });

  el.logout?.addEventListener("click", () => {
    void (async () => {
      try {
        await logout();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFeedback(`No se pudo cerrar sesion: ${message}`, "error");
      }
    })();
  });

  void (async () => {
    try {
      await loadProfile();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`No se pudo cargar perfil: ${message}`, "error");
    }
  })();
})();
