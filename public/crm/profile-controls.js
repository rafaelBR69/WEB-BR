(() => {
  const root = document.querySelector("[data-crm-profile='true']");
  if (!(root instanceof HTMLElement)) return;

  const el = {
    state: document.getElementById("crm-profile-state"),
    badge: document.getElementById("crm-profile-badge"),
    user: document.getElementById("crm-profile-user"),
    role: document.getElementById("crm-profile-role"),
    org: document.getElementById("crm-profile-org"),
    avatar: document.getElementById("crm-profile-avatar"),
    logout: document.getElementById("crm-profile-logout"),
  };

  const state = {
    checking: false,
    user: null,
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

  const setText = (node, text) => {
    if (!(node instanceof HTMLElement)) return;
    node.textContent = text;
  };

  const setBadge = (label, kind = "ok") => {
    if (!(el.badge instanceof HTMLElement)) return;
    el.badge.textContent = label;
    el.badge.classList.remove("ok", "warn", "danger");
    if (kind === "ok" || kind === "warn" || kind === "danger") {
      el.badge.classList.add(kind);
    } else {
      el.badge.classList.add("ok");
    }
  };

  const initialsFromText = (value) => {
    const clean = String(value ?? "").trim();
    if (!clean) return "BR";
    const parts = clean
      .split(/[\s@._-]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!parts.length) return "BR";
    const chars = parts.slice(0, 2).map((part) => part.slice(0, 1).toUpperCase());
    return chars.join("").slice(0, 2) || "BR";
  };

  const localOrgId = (() => {
    try {
      return toText(window.localStorage.getItem("crm.organization_id"));
    } catch {
      return null;
    }
  })();
  const defaultOrgId = toText(window.__crmDefaultOrganizationId);
  const organizationId = localOrgId ?? defaultOrgId;

  const setCheckingState = (isChecking) => {
    state.checking = isChecking;
    if (el.logout instanceof HTMLButtonElement) {
      el.logout.disabled = isChecking;
      el.logout.setAttribute("aria-disabled", String(isChecking));
    }
  };

  const render = () => {
    const user = state.user;
    const userName = toText(user?.full_name) ?? toText(user?.email) ?? "Equipo CRM";
    const role = toText(user?.role) ?? "staff";
    const orgLabel = organizationId ?? "-";

    setText(el.user, userName);
    setText(el.role, role);
    setText(el.org, orgLabel);
    if (el.avatar instanceof HTMLElement) {
      el.avatar.textContent = initialsFromText(userName);
    }

    if (state.checking) {
      setText(el.state, "Comprobando sesion CRM...");
      setBadge("Comprobando", "warn");
      return;
    }

    if (!user) {
      setText(el.state, "Sesion CRM no disponible.");
      setBadge("Sin sesion", "danger");
      return;
    }

    setText(el.state, "Sesion CRM activa.");
    setBadge("CRM", "ok");
  };

  const redirectToLogin = () => {
    const loginUrl = new URL("/crm/login/", window.location.origin);
    loginUrl.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
    window.location.href = `${loginUrl.pathname}${loginUrl.search}`;
  };

  const loadProfile = async () => {
    setCheckingState(true);
    render();
    try {
      const response = await fetch("/api/v1/crm/auth/me");
      const raw = await response.text();
      const payload = parseJsonSafe(raw);
      if (response.status === 401) {
        state.user = null;
        render();
        redirectToLogin();
        return;
      }
      if (!response.ok || !payload?.ok) {
        const code = toText(payload?.error) ?? `http_${response.status}`;
        const details = toText(payload?.details);
        throw new Error(details ? `${code}: ${details}` : code);
      }

      state.user = payload?.data?.user ?? null;
      render();
    } catch {
      state.user = null;
      render();
    } finally {
      setCheckingState(false);
      render();
    }
  };

  const logout = async () => {
    setCheckingState(true);
    render();
    try {
      await fetch("/api/v1/crm/auth/logout", { method: "POST" });
    } finally {
      setCheckingState(false);
      render();
      redirectToLogin();
    }
  };

  el.logout?.addEventListener("click", () => {
    void logout();
  });

  render();
  void loadProfile();
})();
