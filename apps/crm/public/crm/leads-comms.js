(() => {
  const apiBase = "/api/v1/crm/leads";

  const el = {
    form: document.getElementById("leads-mass-form"),
    projectSelect: document.getElementById("leads-mass-project-select"),
    buildBtn: document.getElementById("leads-mass-build"),
    openBtn: document.getElementById("leads-mass-open"),
    meta: document.getElementById("leads-mass-meta"),
    emails: document.getElementById("leads-mass-emails"),
  };

  const state = {
    organizationId: "",
    emails: [],
  };

  const toText = (value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  };

  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const request = async (url, init) => {
    const response = await fetch(url, init);
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!response.ok || !payload?.ok) {
      const errorCode = payload?.error || `http_${response.status}`;
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 220) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
  };

  const setMeta = (message, kind = "ok") => {
    if (!(el.meta instanceof HTMLElement)) return;
    el.meta.textContent = message;
    el.meta.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.meta.classList.add("is-ok");
    if (kind === "error") el.meta.classList.add("is-error");
  };

  const projectLabel = (row) => {
    const data = row && typeof row.property_data === "object" && !Array.isArray(row.property_data) ? row.property_data : {};
    return (
      toText(data.display_name) ||
      toText(data.project_name) ||
      toText(data.promotion_name) ||
      toText(data.name) ||
      toText(data.title) ||
      toText(row?.legacy_code) ||
      "Promocion"
    );
  };

  const loadProjectOptions = async () => {
    if (!(el.projectSelect instanceof HTMLSelectElement)) return;
    if (!state.organizationId) {
      el.projectSelect.innerHTML = '<option value="">Todas</option>';
      return;
    }

    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("record_type", "project");
    params.set("per_page", "300");
    const payload = await request(`/api/v1/properties?${params.toString()}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    rows.sort((a, b) => projectLabel(a).localeCompare(projectLabel(b), "es"));
    el.projectSelect.innerHTML = [
      '<option value="">Todas</option>',
      ...rows
        .filter((item) => toText(item?.id))
        .map((item) => `<option value="${esc(item.id)}">${esc(projectLabel(item))}</option>`),
    ].join("");
  };

  const buildMassQuery = (formData, page, perPage) => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    params.set("page", String(page));
    params.set("per_page", String(perPage));

    ["status", "origin_type", "treated", "nationality", "project_id"].forEach((key) => {
      const value = toText(formData.get(key));
      if (value) params.set(key, value);
    });

    return params;
  };

  const loadMassEmails = async () => {
    if (!(el.form instanceof HTMLFormElement)) return [];
    const formData = new FormData(el.form);
    const seen = new Set();
    let page = 1;
    let totalPages = 1;
    const perPage = 200;

    while (page <= totalPages) {
      const params = buildMassQuery(formData, page, perPage);
      const payload = await request(`${apiBase}?${params.toString()}`);
      const rows = Array.isArray(payload.data) ? payload.data : [];
      rows.forEach((row) => {
        const email = toText(row.email)?.toLowerCase();
        if (email) seen.add(email);
      });
      totalPages = Number(payload.meta?.total_pages ?? 1);
      page += 1;
      if (page > 80) break;
    }

    const emails = Array.from(seen);
    state.emails = emails;
    if (el.emails instanceof HTMLTextAreaElement) el.emails.value = emails.join(", ");
    setMeta(`Destinatarios cargados: ${emails.length}`, "ok");
    return emails;
  };

  const openMassEmail = async () => {
    if (!(el.form instanceof HTMLFormElement)) return;
    let emails = state.emails;
    if (!emails.length) emails = await loadMassEmails();
    if (!emails.length) {
      setMeta("No hay emails para los filtros actuales.", "error");
      return;
    }

    const formData = new FormData(el.form);
    const subject = toText(formData.get("subject")) || "Comunicacion BlancaReal";
    const body = toText(formData.get("body")) || "";
    const bccAll = emails.join(",");
    let mailtoUrl = `mailto:?bcc=${encodeURIComponent(bccAll)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    if (mailtoUrl.length > 1800) {
      const partial = emails.slice(0, 40).join(",");
      mailtoUrl = `mailto:?bcc=${encodeURIComponent(partial)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(bccAll);
          setMeta("Se abre email parcial (limite navegador). BCC completo copiado al portapapeles.", "ok");
        } else {
          setMeta("Se abre email parcial por limite de longitud. Usa el textarea para BCC completo.", "ok");
        }
      } catch {
        setMeta("Se abre email parcial por limite de longitud. Usa el textarea para BCC completo.", "ok");
      }
    } else {
      setMeta(`Abriendo cliente de correo con ${emails.length} destinatarios.`, "ok");
    }

    window.location.href = mailtoUrl;
  };

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

  el.buildBtn?.addEventListener("click", async () => {
    try {
      await loadMassEmails();
    } catch (error) {
      setMeta(`Error cargando emails: ${error.message}`, "error");
    }
  });

  el.openBtn?.addEventListener("click", async () => {
    try {
      await openMassEmail();
    } catch (error) {
      setMeta(`Error en email masivo: ${error.message}`, "error");
    }
  });

  void (async () => {
    try {
      await loadProjectOptions();
      setMeta("Configuracion lista para email masivo.", "ok");
    } catch (error) {
      setMeta(`Error cargando promociones: ${error.message}`, "error");
    }
  })();
})();
