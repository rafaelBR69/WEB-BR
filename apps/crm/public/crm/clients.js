(() => {
  const apiBase = "/api/v1/clients";

  const statusLabels = {
    active: "Activo",
    inactive: "Inactivo",
    discarded: "Descartado",
    blacklisted: "Blacklisted",
  };

  const statusClass = {
    active: "ok",
    inactive: "warn",
    discarded: "danger",
    blacklisted: "danger",
  };

  const typeLabels = {
    individual: "Persona fisica",
    company: "Persona juridica",
  };

  const channelLabels = {
    website: "Web",
    agency: "Agencia",
    phone: "Telefono",
    whatsapp: "WhatsApp",
    email: "Email",
    provider: "Proveedor",
    walkin: "Oficina",
    portal: "Portal",
    other: "Otro",
  };

  const providerTypeLabels = {
    developer: "Developer",
    promoter: "Promotor",
    constructor: "Constructor",
    architect: "Arquitecto",
    agency: "Agencia",
    owner: "Propietario",
    other: "Otro",
  };

  const agencyScopeLabels = {
    buyer: "Comprador",
    seller: "Vendedor",
    rental: "Alquiler",
    mixed: "Mixto",
  };

  const FILTER_FIELD_NAMES = ["q", "client_type", "client_status", "entry_channel", "client_role", "project_id"];

  const state = {
    organizationId: "",
    items: [],
    prefillProjectId: "",
    pagination: {
      page: 1,
      perPage: 25,
      total: 0,
      totalPages: 1,
    },
  };

  const el = {
    filterForm: document.getElementById("client-filter-form"),
    filterClear: document.getElementById("clients-filter-clear"),
    perPageSelect: document.getElementById("clients-per-page"),
    projectSelect: document.getElementById("clients-project-select"),
    tbody: document.getElementById("clients-tbody"),
    meta: document.getElementById("clients-meta"),
    pagination: document.getElementById("clients-pagination"),
    pageInfo: document.getElementById("clients-page-info"),
    feedback: document.getElementById("clients-feedback"),
  };

  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const toText = (value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  };

  const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formField = (name) => {
    if (!el.filterForm || !el.filterForm.elements) return null;
    return el.filterForm.elements.namedItem(name);
  };

  const setFormFieldValue = (name, value) => {
    const input = formField(name);
    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLSelectElement ||
      input instanceof HTMLTextAreaElement
    ) {
      input.value = value == null ? "" : String(value);
    }
  };

  const formatDate = (value) => {
    const text = toText(value);
    if (!text) return "-";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [year, month, day] = text.split("-");
      return `${day}/${month}/${year}`;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString("es-ES");
  };

  const formatCurrency = (value) => {
    const amount = toNumber(value);
    if (amount == null) return "-";
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${amount} EUR`;
    }
  };

  const setFeedback = (message, kind = "ok") => {
    if (!el.feedback) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

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
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 200) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
  };

  const buildRoleBadges = (item) => {
    const badges = [];
    const hasProjectLink = item.is_provider_for_project === true;

    if (item.is_provider) {
      const providerLabel = providerTypeLabels[item.provider_type] || item.provider_type || "Proveedor";
      const suffix = hasProjectLink ? " (promo)" : "";
      badges.push(`<span class="crm-badge ok">${esc(`Proveedor ${providerLabel}${suffix}`)}</span>`);
    }

    if (item.is_agency) {
      const agencyLabel = agencyScopeLabels[item.agency_scope] || item.agency_scope || "Agencia";
      badges.push(`<span class="crm-badge warn">${esc(`Agencia ${agencyLabel}`)}</span>`);
    }

    if (hasProjectLink && !item.is_provider) {
      badges.push('<span class="crm-badge ok">Cliente promocion</span>');
    }

    if (!badges.length) {
      badges.push('<span class="crm-badge warn">Cliente base</span>');
    }

    return badges.join(" ");
  };

  const clientStatusLabel = (item) => {
    if (item?.is_ex_client === true) return "Baja";
    return statusLabels[item?.client_status] || item?.client_status || "-";
  };

  const clientStatusClass = (item) => {
    if (item?.is_ex_client === true) return "violet";
    return statusClass[item?.client_status] || "warn";
  };

  const projectLabel = (row) => {
    const display = toText(row?.display_name) || toText(row?.project_name) || toText(row?.legacy_code) || "Promocion";
    const code = toText(row?.legacy_code);
    const status = toText(row?.status);
    const parts = [display];
    if (code && code !== display) parts.push(code);
    if (status) parts.push(status);
    return parts.join(" | ");
  };

  const renderProjectOptions = (rows) => {
    if (!(el.projectSelect instanceof HTMLSelectElement)) return;
    const selectedValue = toText(el.projectSelect.value) || state.prefillProjectId;
    const options = [
      '<option value="">Todas</option>',
      ...rows
        .filter((item) => toText(item?.id))
        .map((item) => `<option value="${esc(item.id)}">${esc(projectLabel(item))}</option>`),
    ];
    el.projectSelect.innerHTML = options.join("");
    if (selectedValue && el.projectSelect.querySelector(`option[value="${selectedValue}"]`)) {
      el.projectSelect.value = selectedValue;
      state.prefillProjectId = selectedValue;
    } else {
      state.prefillProjectId = "";
    }
  };

  const renderTable = () => {
    if (!el.tbody) return;
    if (!state.items.length) {
      el.tbody.innerHTML = "<tr><td colspan='9'>Sin clientes para los filtros actuales.</td></tr>";
      return;
    }

    el.tbody.innerHTML = state.items
      .map((item) => {
        return `
          <tr class="crm-row-clickable" data-client-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Abrir ficha de ${esc(item.full_name || "cliente")}">
            <td data-label="Fecha">${esc(formatDate(item.intake_date || item.created_at))}</td>
            <td data-label="Nombre"><strong>${esc(item.full_name || "-")}</strong><br /><small>${esc(item.client_code || "-")}</small></td>
            <td data-label="Tipo">${esc(typeLabels[item.client_type] || item.client_type || "-")}</td>
            <td data-label="Canal">${esc(channelLabels[item.entry_channel] || item.entry_channel || "-")}</td>
            <td data-label="Rol Fase 2">${buildRoleBadges(item)}</td>
            <td data-label="Agencia/Agente">${esc(item.agency_name || "-")}<br /><small>${esc(item.agent_name || "-")}</small></td>
            <td data-label="Contacto">${esc(item.phone || "-")}<br /><small>${esc(item.email || "-")}</small></td>
            <td data-label="Presupuesto">${esc(formatCurrency(item.budget_amount))}</td>
            <td data-label="Estado"><span class="crm-badge ${esc(clientStatusClass(item))}">${esc(clientStatusLabel(item))}</span></td>
          </tr>
        `;
      })
      .join("");
  };

  const renderMeta = () => {
    if (!el.meta) return;
    el.meta.textContent =
      `Mostrando ${state.items.length} | Pagina ${state.pagination.page}/${state.pagination.totalPages} | ` +
      `Total ${state.pagination.total}`;
  };

  const renderPagination = () => {
    if (!el.pagination || !el.pageInfo) return;
    const total = Number(state.pagination.total ?? 0);
    const page = Number(state.pagination.page ?? 1);
    const totalPages = Number(state.pagination.totalPages ?? 1);

    el.pageInfo.textContent = `Pagina ${page} de ${totalPages} | ${state.items.length} en pagina | ${total} total`;

    const prevBtn = el.pagination.querySelector("button[data-page-action='prev']");
    const nextBtn = el.pagination.querySelector("button[data-page-action='next']");
    if (prevBtn instanceof HTMLButtonElement) prevBtn.disabled = page <= 1;
    if (nextBtn instanceof HTMLButtonElement) nextBtn.disabled = page >= totalPages;
  };

  const loadProjectOptions = async () => {
    if (!(el.projectSelect instanceof HTMLSelectElement)) return;
    if (!state.organizationId) {
      renderProjectOptions([]);
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("organization_id", state.organizationId);
      params.set("record_type", "project");
      params.set("per_page", "200");

      const payload = await request(`/api/v1/properties?${params.toString()}`);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      rows.sort((a, b) => projectLabel(a).localeCompare(projectLabel(b), "es"));
      renderProjectOptions(rows);
    } catch (error) {
      renderProjectOptions([]);
      setFeedback(`Error cargando promociones: ${error.message}`, "error");
    }
  };

  const clearFilterQueryFromUrl = () => {
    const next = new URL(window.location.href);
    ["q", "client_type", "client_status", "entry_channel", "client_role", "project_id", "page", "per_page"].forEach(
      (key) => next.searchParams.delete(key)
    );
    const qs = next.searchParams.toString();
    window.history.replaceState({}, "", `${next.pathname}${qs ? `?${qs}` : ""}`);
  };

  const resetFilters = () => {
    el.filterForm?.reset();
    FILTER_FIELD_NAMES.forEach((name) => setFormFieldValue(name, ""));
    if (el.projectSelect instanceof HTMLSelectElement) {
      el.projectSelect.value = "";
    }
    state.prefillProjectId = "";
    state.pagination.page = 1;
    if (el.perPageSelect instanceof HTMLSelectElement) {
      state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    }
    clearFilterQueryFromUrl();
  };

  const buildListQuery = () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    params.set("page", String(state.pagination.page));
    params.set("per_page", String(state.pagination.perPage));

    if (el.filterForm) {
      const formData = new FormData(el.filterForm);
      for (const [key, value] of formData.entries()) {
        if (key === "per_page") continue;
        const text = String(value ?? "").trim();
        if (text) params.set(key, text);
      }
    }

    return params;
  };

  const openClient = (clientId) => {
    const id = toText(clientId);
    if (!id) return;
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    const qs = params.toString();
    window.location.href = `/crm/clients/${encodeURIComponent(id)}/${qs ? `?${qs}` : ""}`;
  };

  const loadClients = async () => {
    try {
      const params = buildListQuery();
      const payload = await request(`${apiBase}?${params.toString()}`);
      state.items = Array.isArray(payload.data) ? payload.data : [];
      state.pagination.total = Number(payload.meta?.total ?? state.items.length);
      state.pagination.page = Number(payload.meta?.page ?? state.pagination.page);
      state.pagination.perPage = Number(payload.meta?.per_page ?? state.pagination.perPage);
      state.pagination.totalPages = Number(payload.meta?.total_pages ?? 1);
      if (el.perPageSelect) el.perPageSelect.value = String(state.pagination.perPage);
      renderTable();
      renderMeta();
      renderPagination();
      setFeedback("Listado de clientes actualizado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando clientes: ${error.message}`, "error");
    }
  };

  el.filterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.pagination.page = 1;
    if (el.perPageSelect) state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    await loadClients();
  });

  el.filterClear?.addEventListener("click", async () => {
    resetFilters();
    await loadClients();
  });

  el.tbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest("tr[data-client-id]");
    if (!(row instanceof HTMLTableRowElement)) return;
    if (target.closest("a, button, input, select, textarea, label")) return;
    openClient(row.getAttribute("data-client-id"));
  });

  el.tbody?.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = target.closest("tr[data-client-id]");
    if (!(row instanceof HTMLTableRowElement)) return;
    event.preventDefault();
    openClient(row.getAttribute("data-client-id"));
  });

  el.pagination?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-page-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const action = button.getAttribute("data-page-action");
    if (action === "prev" && state.pagination.page > 1) {
      state.pagination.page -= 1;
      await loadClients();
      return;
    }
    if (action === "next" && state.pagination.page < state.pagination.totalPages) {
      state.pagination.page += 1;
      await loadClients();
    }
  });

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  state.prefillProjectId = toText(search.get("project_id")) || "";
  const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

  const perPageFromQuery = Number(search.get("per_page"));
  if (Number.isFinite(perPageFromQuery) && perPageFromQuery > 0) {
    state.pagination.perPage = Math.floor(perPageFromQuery);
  }
  const pageFromQuery = Number(search.get("page"));
  if (Number.isFinite(pageFromQuery) && pageFromQuery > 0) {
    state.pagination.page = Math.floor(pageFromQuery);
  }

  if (el.filterForm) {
    ["q", "client_type", "client_status", "entry_channel", "client_role", "project_id"].forEach((key) => {
      const value = toText(search.get(key));
      if (!value) return;
      const input = el.filterForm.elements.namedItem(key);
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLSelectElement ||
        input instanceof HTMLTextAreaElement
      ) {
        input.value = value;
      }
    });
  }

  if (!state.organizationId) {
    setFeedback("No hay organization_id activo en CRM.", "error");
  }

  const boot = async () => {
    await loadProjectOptions();
    await loadClients();
  };

  boot();
})();
