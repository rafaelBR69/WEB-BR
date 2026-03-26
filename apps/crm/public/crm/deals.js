(() => {
  const apiBase = "/api/v1/crm/deals";

  const stageLabels = {
    qualification: "Cualificacion",
    visit: "Visita",
    offer: "Oferta",
    negotiation: "Negociacion",
    reservation: "Reserva",
    contract: "Contrato",
    won: "Ganada",
    lost: "Perdida",
  };

  const state = {
    organizationId: "",
    items: [],
    projectOptions: [],
    contextFilters: {
      leadId: "",
      clientId: "",
      propertyId: "",
      projectId: "",
    },
    pagination: {
      page: 1,
      perPage: 25,
      total: 0,
      totalPages: 1,
    },
  };

  const el = {
    filterForm: document.getElementById("deals-filter-form"),
    filterClear: document.getElementById("deals-filter-clear"),
    perPageSelect: document.getElementById("deals-per-page"),
    projectSelect: document.getElementById("deals-project-select"),
    createLink: document.getElementById("deals-create-link"),
    contextNote: document.getElementById("deals-context-note"),
    tbody: document.getElementById("deals-tbody"),
    meta: document.getElementById("deals-meta"),
    pagination: document.getElementById("deals-pagination"),
    pageInfo: document.getElementById("deals-page-info"),
    feedback: document.getElementById("deals-feedback"),
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

  const redirectToLogin = () => {
    const loginUrl = new URL("/crm/login/", window.location.origin);
    loginUrl.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
    window.location.href = `${loginUrl.pathname}${loginUrl.search}`;
  };

  const isCrmAuthError = (response, payload) => {
    const code = toText(payload?.error);
    return (
      response.status === 401 ||
      code === "auth_token_required" ||
      code === "refresh_token_required" ||
      code === "invalid_refresh_token" ||
      code === "crm_auth_required"
    );
  };

  const formatDate = (value) => {
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

  const formatCurrency = (value, currency = "EUR") => {
    const amount = toNumber(value);
    if (amount == null) return "-";
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: currency || "EUR",
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${amount} ${currency || "EUR"}`;
    }
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
    if (isCrmAuthError(response, payload)) {
      redirectToLogin();
      throw new Error(toText(payload?.error) || `http_${response.status}`);
    }
    if (!response.ok || !payload?.ok) {
      const errorCode = payload?.error || `http_${response.status}`;
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 250) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

  const projectLabel = (row) =>
    toText(row?.display_name) ||
    toText(row?.project_name) ||
    toText(row?.property_data?.display_name) ||
    toText(row?.legacy_code) ||
    "Promocion";

  const dealHref = (dealId) => {
    const params = currentUrlParams();
    return `/crm/deals/${encodeURIComponent(dealId)}/${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const currentUrlParams = () => {
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

    const onlyOpen = document.getElementById("deals-only-open");
    if (onlyOpen instanceof HTMLInputElement && onlyOpen.checked) {
      params.set("only_open", "1");
    }

    if (state.contextFilters.leadId) params.set("lead_id", state.contextFilters.leadId);
    if (state.contextFilters.clientId) params.set("client_id", state.contextFilters.clientId);
    if (state.contextFilters.propertyId) params.set("property_id", state.contextFilters.propertyId);
    return params;
  };

  const syncBrowserUrl = () => {
    const params = currentUrlParams();
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };

  const syncCreateLink = () => {
    if (!(el.createLink instanceof HTMLAnchorElement)) return;
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    if (state.contextFilters.leadId) params.set("lead_id", state.contextFilters.leadId);
    if (state.contextFilters.clientId) params.set("client_id", state.contextFilters.clientId);
    if (state.contextFilters.propertyId) params.set("property_id", state.contextFilters.propertyId);
    const selectedProjectId = toText(el.projectSelect?.value) || state.contextFilters.projectId;
    if (selectedProjectId) params.set("project_id", selectedProjectId);
    el.createLink.href = `/crm/deals/nuevo/${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const renderContextNote = () => {
    if (!(el.contextNote instanceof HTMLElement)) return;
    const pieces = [];
    const selectedProjectId = toText(el.projectSelect?.value);
    const selectedProject = state.projectOptions.find((row) => toText(row?.id) === selectedProjectId) ?? null;

    if (state.contextFilters.leadId) pieces.push("Contexto heredado desde lead");
    if (state.contextFilters.clientId) pieces.push("Contexto heredado desde cliente");
    if (state.contextFilters.propertyId) pieces.push("Contexto heredado desde propiedad");
    if (selectedProject) pieces.push(`Promocion filtrada: ${projectLabel(selectedProject)}`);

    el.contextNote.textContent = pieces.length
      ? pieces.join(" | ")
      : "Sin contexto heredado.";
  };

  const renderProjectOptions = (rows) => {
    state.projectOptions = Array.isArray(rows) ? rows : [];
    if (!(el.projectSelect instanceof HTMLSelectElement)) return;
    const selectedValue = toText(el.projectSelect.value) || state.contextFilters.projectId;
    el.projectSelect.innerHTML = [
      '<option value="">Todas</option>',
      ...state.projectOptions
        .filter((item) => toText(item?.id))
        .map((item) => `<option value="${esc(item.id)}">${esc(projectLabel(item))}</option>`),
    ].join("");
    if (selectedValue && el.projectSelect.querySelector(`option[value="${selectedValue}"]`)) {
      el.projectSelect.value = selectedValue;
      state.contextFilters.projectId = selectedValue;
    } else {
      state.contextFilters.projectId = "";
    }
    renderContextNote();
    syncCreateLink();
  };

  const loadProjectOptions = async () => {
    if (!(el.projectSelect instanceof HTMLSelectElement)) return;
    if (!state.organizationId) {
      renderProjectOptions([]);
      return;
    }
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("record_type", "project");
    params.set("per_page", "300");
    const payload = await request(`/api/v1/properties?${params.toString()}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    rows.sort((left, right) => projectLabel(left).localeCompare(projectLabel(right), "es"));
    renderProjectOptions(rows);
  };

  const renderTable = () => {
    if (!(el.tbody instanceof HTMLElement)) return;
    if (!state.items.length) {
      el.tbody.innerHTML = "<tr><td colspan='8'>Sin deals para los filtros actuales.</td></tr>";
      return;
    }

    el.tbody.innerHTML = state.items
      .map((item) => {
        const id = toText(item?.id);
        const title = toText(item?.title) || "Deal";
        const stage = toText(item?.stage) || "-";
        const client = toText(item?.client?.full_name) || toText(item?.client?.client_code) || "-";
        const lead = toText(item?.lead?.full_name) || "-";
        const property =
          toText(item?.property?.display_name) ||
          toText(item?.property?.project_label) ||
          toText(item?.property?.legacy_code) ||
          "-";
        return `
          <tr class="crm-row-clickable" data-deal-id="${esc(id)}" tabindex="0" role="button" aria-label="Abrir ${esc(title)}">
            <td data-label="Titulo"><strong>${esc(title)}</strong></td>
            <td data-label="Stage"><span class="crm-badge ${esc(item?.is_terminal ? "warn" : "ok")}">${esc(stageLabels[stage] || stage)}</span></td>
            <td data-label="Cliente">${esc(client)}</td>
            <td data-label="Lead">${esc(lead)}</td>
            <td data-label="Propiedad">${esc(property)}</td>
            <td data-label="Valor">${esc(formatCurrency(item?.expected_value, item?.currency))}</td>
            <td data-label="Probabilidad">${esc(toNumber(item?.probability) == null ? "-" : `${toNumber(item?.probability)}%`)}</td>
            <td data-label="Actualizado">${esc(formatDate(item?.updated_at))}</td>
          </tr>
        `;
      })
      .join("");
  };

  const renderMeta = () => {
    if (!(el.meta instanceof HTMLElement)) return;
    el.meta.textContent = `Mostrando ${state.items.length} | Pagina ${state.pagination.page}/${state.pagination.totalPages} | Total ${state.pagination.total}`;
  };

  const renderPagination = () => {
    if (!(el.pageInfo instanceof HTMLElement) || !(el.pagination instanceof HTMLElement)) return;
    el.pageInfo.textContent = `Pagina ${state.pagination.page} de ${state.pagination.totalPages} | ${state.pagination.total} total`;
    const prev = el.pagination.querySelector("button[data-page-action='prev']");
    const next = el.pagination.querySelector("button[data-page-action='next']");
    if (prev instanceof HTMLButtonElement) prev.disabled = state.pagination.page <= 1;
    if (next instanceof HTMLButtonElement) next.disabled = state.pagination.page >= state.pagination.totalPages;
  };

  const loadDeals = async () => {
    const payload = await request(`${apiBase}?${currentUrlParams().toString()}`);
    state.items = Array.isArray(payload?.data) ? payload.data : [];
    state.pagination.total = Number(payload?.meta?.total ?? state.items.length);
    state.pagination.page = Number(payload?.meta?.page ?? state.pagination.page);
    state.pagination.perPage = Number(payload?.meta?.per_page ?? state.pagination.perPage);
    state.pagination.totalPages = Number(payload?.meta?.total_pages ?? 1);

    if (el.perPageSelect instanceof HTMLSelectElement) {
      el.perPageSelect.value = String(state.pagination.perPage);
    }

    renderTable();
    renderMeta();
    renderPagination();
    renderContextNote();
    syncCreateLink();
    syncBrowserUrl();
  };

  const clearFilters = () => {
    el.filterForm?.reset();
    if (el.projectSelect instanceof HTMLSelectElement) el.projectSelect.value = "";
    state.contextFilters.projectId = "";
    state.pagination.page = 1;
    if (el.perPageSelect instanceof HTMLSelectElement) {
      el.perPageSelect.value = "25";
      state.pagination.perPage = 25;
    }
    const onlyOpen = document.getElementById("deals-only-open");
    if (onlyOpen instanceof HTMLInputElement) onlyOpen.checked = true;
  };

  const search = new URLSearchParams(window.location.search);
  state.organizationId =
    toText(search.get("organization_id")) ||
    toText(localStorage.getItem("crm.organization_id")) ||
    toText(window.__crmDefaultOrganizationId) ||
    "";
  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

  state.contextFilters = {
    leadId: toText(search.get("lead_id")) || "",
    clientId: toText(search.get("client_id")) || "",
    propertyId: toText(search.get("property_id")) || "",
    projectId: toText(search.get("project_id")) || "",
  };

  if (el.filterForm instanceof HTMLFormElement) {
    ["q", "stage"].forEach((name) => {
      const input = el.filterForm.elements.namedItem(name);
      const value = toText(search.get(name));
      if ((input instanceof HTMLInputElement || input instanceof HTMLSelectElement) && value) {
        input.value = value;
      }
    });
  }

  const onlyOpenFromUrl = toText(search.get("only_open"));
  const onlyOpen = document.getElementById("deals-only-open");
  if (onlyOpen instanceof HTMLInputElement) {
    onlyOpen.checked = !onlyOpenFromUrl || ["1", "true", "yes", "si"].includes(onlyOpenFromUrl.toLowerCase());
  }

  const queryPerPage = toNumber(search.get("per_page"));
  if (queryPerPage && el.perPageSelect instanceof HTMLSelectElement) {
    el.perPageSelect.value = String(queryPerPage);
    state.pagination.perPage = queryPerPage;
  } else if (el.perPageSelect instanceof HTMLSelectElement) {
    state.pagination.perPage = Number(el.perPageSelect.value) || 25;
  }
  state.pagination.page = toNumber(search.get("page")) || 1;

  el.filterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.pagination.page = 1;
    if (el.perPageSelect instanceof HTMLSelectElement) {
      state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    }
    state.contextFilters.projectId = toText(el.projectSelect?.value) || "";
    try {
      await loadDeals();
      setFeedback("Listado de deals actualizado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando deals: ${error.message}`, "error");
    }
  });

  el.filterClear?.addEventListener("click", async () => {
    clearFilters();
    try {
      await loadDeals();
      setFeedback("Filtros limpiados y listado restaurado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando deals: ${error.message}`, "error");
    }
  });

  el.projectSelect?.addEventListener("change", () => {
    state.contextFilters.projectId = toText(el.projectSelect?.value) || "";
    renderContextNote();
    syncCreateLink();
  });

  el.pagination?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-page-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const action = button.getAttribute("data-page-action");
    if (action === "prev" && state.pagination.page > 1) state.pagination.page -= 1;
    if (action === "next" && state.pagination.page < state.pagination.totalPages) state.pagination.page += 1;
    try {
      await loadDeals();
      setFeedback("Listado de deals actualizado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando deals: ${error.message}`, "error");
    }
  });

  el.tbody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest("tr[data-deal-id]");
    if (!(row instanceof HTMLTableRowElement)) return;
    const dealId = toText(row.getAttribute("data-deal-id"));
    if (!dealId) return;
    window.location.href = dealHref(dealId);
  });

  el.tbody?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest("tr[data-deal-id]");
    if (!(row instanceof HTMLTableRowElement)) return;
    const dealId = toText(row.getAttribute("data-deal-id"));
    if (!dealId) return;
    event.preventDefault();
    window.location.href = dealHref(dealId);
  });

  void (async () => {
    try {
      await loadProjectOptions();
      await loadDeals();
      setFeedback("Listado de deals cargado.", "ok");
    } catch (error) {
      setFeedback(`Error inicializando modulo: ${error.message}`, "error");
    }
  })();
})();
