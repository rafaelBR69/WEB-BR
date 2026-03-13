(() => {
  const apiBase = "/api/v1/crm/agencies/contacts";

  const state = {
    organizationId: "",
    items: [],
    agencyId: "",
    agencyOptions: [],
    pagination: {
      page: 1,
      perPage: 25,
      total: 0,
      totalPages: 1,
    },
  };

  const el = {
    createForm: document.getElementById("agency-contacts-create-form"),
    createStatus: document.getElementById("agency-contacts-create-status"),
    createAgencySearch: document.getElementById("agency-contacts-create-agency-search"),
    createAgencyId: document.getElementById("agency-contacts-create-agency-id"),
    createAgencyOptions: document.getElementById("agency-contacts-create-agency-options"),
    filterForm: document.getElementById("agency-contacts-filter-form"),
    filterClear: document.getElementById("agency-contacts-filter-clear"),
    perPageSelect: document.getElementById("agency-contacts-per-page"),
    tbody: document.getElementById("agency-contacts-tbody"),
    meta: document.getElementById("agency-contacts-meta"),
    pagination: document.getElementById("agency-contacts-pagination"),
    pageInfo: document.getElementById("agency-contacts-page-info"),
    feedback: document.getElementById("agency-contacts-feedback"),
    kpiTotal: document.getElementById("agency-contacts-kpi-total"),
    kpiWithLeads: document.getElementById("agency-contacts-kpi-with-leads"),
    kpiLeads: document.getElementById("agency-contacts-kpi-leads"),
    kpiClients: document.getElementById("agency-contacts-kpi-clients"),
    kpiReserved: document.getElementById("agency-contacts-kpi-reserved"),
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
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const request = async (url, init) => {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const details = payload?.details || payload?.error || `http_${response.status}`;
      const error = new Error(details);
      error.code = payload?.error || `http_${response.status}`;
      error.meta = payload?.meta || null;
      throw error;
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

  const setCreateStatus = (message, kind = "muted") => {
    if (!(el.createStatus instanceof HTMLElement)) return;
    el.createStatus.textContent = message;
    el.createStatus.classList.remove("is-error", "is-success");
    if (kind === "error") el.createStatus.classList.add("is-error");
    if (kind === "success") el.createStatus.classList.add("is-success");
  };

  const setCreateStatusWithLink = (message, href, label, kind = "error") => {
    if (!(el.createStatus instanceof HTMLElement)) return;
    el.createStatus.classList.remove("is-error", "is-success");
    if (kind === "error") el.createStatus.classList.add("is-error");
    if (kind === "success") el.createStatus.classList.add("is-success");
    el.createStatus.innerHTML = `${esc(message)} <a class="crm-link" href="${esc(href)}">${esc(label)}</a>`;
  };

  const setText = (node, value) => {
    if (node instanceof HTMLElement) node.textContent = String(value ?? "-");
  };

  const formField = (name) => {
    if (!(el.filterForm instanceof HTMLFormElement)) return null;
    return el.filterForm.elements.namedItem(name);
  };

  const setFormFieldValue = (name, value) => {
    const input = formField(name);
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
      input.value = value == null ? "" : String(value);
    }
  };

  const buildAgencyContactUrl = (agencyContactId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/agencies/contacts/${encodeURIComponent(agencyContactId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const buildAgencyUrl = (agencyId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/agencies/${encodeURIComponent(agencyId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const renderAgencyOptions = () => {
    if (!(el.createAgencyOptions instanceof HTMLElement)) return;
    el.createAgencyOptions.innerHTML = state.agencyOptions
      .map(
        (item) =>
          `<option value="${esc(item.label)}" data-agency-id="${esc(item.id)}"></option>`
      )
      .join("");
  };

  const syncSelectedAgencyFromSearch = () => {
    if (!(el.createAgencySearch instanceof HTMLInputElement) || !(el.createAgencyId instanceof HTMLInputElement)) return;
    const query = toText(el.createAgencySearch.value);
    if (!query) {
      el.createAgencyId.value = "";
      return null;
    }
    const exact = state.agencyOptions.find((item) => item.label === query);
    if (exact) {
      el.createAgencyId.value = exact.id;
      return exact.id;
    }
    const normalizedQuery = query.toLowerCase();
    const partial = state.agencyOptions.find((item) => item.label.toLowerCase() === normalizedQuery);
    if (partial) {
      el.createAgencyId.value = partial.id;
      return partial.id;
    }
    el.createAgencyId.value = "";
    return null;
  };

  const buildQuery = () => {
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("page", String(state.pagination.page));
    params.set("per_page", String(state.pagination.perPage));
    if (state.agencyId) params.set("agency_id", state.agencyId);

    const qField = formField("q");
    const qValue = qField instanceof HTMLInputElement ? toText(qField.value) : null;
    if (qValue) params.set("q", qValue);
    return params;
  };

  const syncUrl = (params) => {
    const next = new URL(window.location.href);
    ["q", "agency_id", "page", "per_page"].forEach((key) => next.searchParams.delete(key));
    params.forEach((value, key) => {
      if (key === "organization_id") return;
      next.searchParams.set(key, value);
    });
    const query = next.searchParams.toString();
    window.history.replaceState({}, "", `${next.pathname}${query ? `?${query}` : ""}`);
  };

  const renderTable = () => {
    if (!(el.tbody instanceof HTMLElement)) return;
    if (!state.items.length) {
      el.tbody.innerHTML = "<tr><td colspan='6'>Sin contactos para los filtros actuales.</td></tr>";
      return;
    }

    el.tbody.innerHTML = state.items
      .map((item) => `
        <tr class="crm-row-clickable" data-agency-contact-id="${esc(item.agency_contact_id || "")}" tabindex="0" role="button" aria-label="Abrir ficha de ${esc(toText(item.full_name) || "contacto")}">
          <td data-label="Contacto">
            <a href="${esc(buildAgencyContactUrl(item.agency_contact_id))}" class="crm-inline-link"><strong>${esc(toText(item.full_name) || toText(item.email) || "Sin nombre")}</strong></a><br />
            <small>${esc([toText(item.role), item.is_primary ? "principal" : null, toText(item.email), toText(item.phone)].filter(Boolean).join(" | ") || "-")}</small>
          </td>
          <td data-label="Agencia">
            <a href="${esc(buildAgencyUrl(item.agency_id))}" class="crm-inline-link">${esc(toText(item.agency_name) || "Agencia")}</a>
          </td>
          <td data-label="Actividad">
            <strong>${esc(String(toNumber(item.attributed_records_total)))}</strong><br />
            <small>clientes ${esc(String(toNumber(item.attributed_customer_total)))} | baja ${esc(String(toNumber(item.attributed_discarded_total)))} | CRM ${esc(String(toNumber(item.leads_total)))}</small>
          </td>
          <td data-label="Clientes">
            <strong>${esc(String(toNumber(item.attributed_customer_total)))}</strong><br />
            <small>CRM ${esc(String(toNumber(item.converted_clients_total)))}</small>
          </td>
          <td data-label="Reserva">
            <strong>${esc(String(toNumber(item.reserved_clients_total)))}</strong>
          </td>
          <td data-label="Rendimiento">
            <strong>${esc(String(toNumber(item.attributed_customer_rate_pct)))}%</strong><br />
            <small>con identidad ${esc(String(toNumber(item.attributed_records_with_identity_total)))} | proyectos CRM ${esc(String(toNumber(item.projects_total)))}</small>
          </td>
        </tr>
      `)
      .join("");
  };

  const renderMeta = (summary) => {
    if (!(el.meta instanceof HTMLElement)) return;
    el.meta.textContent =
      `Mostrando ${state.items.length} | Pagina ${state.pagination.page}/${state.pagination.totalPages} | ` +
      `Contactos ${toNumber(summary?.active_contacts_total)} | Con actividad ${toNumber(summary?.contacts_with_leads_total)} | ` +
      `Registros ${toNumber(summary?.attributed_records_total)} | Clientes atribuidos ${toNumber(summary?.attributed_customer_total)} | Reserva ${toNumber(summary?.reserved_clients_total)}`;
  };

  const renderPagination = () => {
    if (!(el.pagination instanceof HTMLElement) || !(el.pageInfo instanceof HTMLElement)) return;
    el.pageInfo.textContent = `Pagina ${state.pagination.page} de ${state.pagination.totalPages} | ${state.items.length} en pagina | ${state.pagination.total} total`;
    const prevBtn = el.pagination.querySelector("button[data-page-action='prev']");
    const nextBtn = el.pagination.querySelector("button[data-page-action='next']");
    if (prevBtn instanceof HTMLButtonElement) prevBtn.disabled = state.pagination.page <= 1;
    if (nextBtn instanceof HTMLButtonElement) nextBtn.disabled = state.pagination.page >= state.pagination.totalPages;
  };

  const renderSummary = (summary) => {
    setText(el.kpiTotal, toNumber(summary?.active_contacts_total));
    setText(el.kpiWithLeads, toNumber(summary?.contacts_with_leads_total));
    setText(el.kpiLeads, toNumber(summary?.attributed_records_total));
    setText(el.kpiClients, toNumber(summary?.attributed_customer_total));
    setText(el.kpiReserved, toNumber(summary?.reserved_clients_total));
  };

  const load = async () => {
    const params = buildQuery();
    syncUrl(params);
    const payload = await request(`${apiBase}?${params.toString()}`);
    state.items = Array.isArray(payload.data) ? payload.data : [];
    state.pagination.total = Number(payload?.meta?.total ?? 0);
    state.pagination.totalPages = Number(payload?.meta?.total_pages ?? 1);
    state.pagination.page = Number(payload?.meta?.page ?? 1);
    renderTable();
    renderSummary(payload?.meta?.summary ?? {});
    renderMeta(payload?.meta?.summary ?? {});
    renderPagination();
  };

  const loadAgencyOptions = async () => {
    if (!state.organizationId) return;
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("page", "1");
    params.set("per_page", "200");
    const payload = await request(`/api/v1/crm/agencies?${params.toString()}`);
    state.agencyOptions = (Array.isArray(payload?.data) ? payload.data : [])
      .map((item) => {
        const id = toText(item.agency_id || item.id);
        if (!id) return null;
        const labelParts = [toText(item.full_name), toText(item.agency_code)].filter(Boolean);
        return {
          id,
          label: labelParts.join(" | "),
        };
      })
      .filter(Boolean);
    renderAgencyOptions();
  };

  const handleCreateContact = async (event) => {
    event.preventDefault();
    if (!(el.createForm instanceof HTMLFormElement)) return;
    const agencyId = syncSelectedAgencyFromSearch();
    if (!agencyId) {
      setCreateStatus("Selecciona una agencia valida del listado.", "error");
      return;
    }
    const formData = new FormData(el.createForm);
    const payload = {
      organization_id: state.organizationId,
      agency_id: agencyId,
      full_name: toText(formData.get("full_name")),
      email: toText(formData.get("email")),
      phone: toText(formData.get("phone")),
      role: toText(formData.get("role")) || "agent",
      is_primary: toText(formData.get("is_primary")) === "true",
      notes: toText(formData.get("notes")),
    };

    setCreateStatus("Creando contacto...");
    try {
      const response = await request(apiBase, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const agencyContactId = toText(response?.data?.agency_contact_id);
      setCreateStatus("Contacto creado.", "success");
      el.createForm.reset();
      if (el.createAgencyId instanceof HTMLInputElement) el.createAgencyId.value = "";
      await load();
      setFeedback("Contacto de agencia creado.", "ok");
      if (agencyContactId) {
        window.location.href = buildAgencyContactUrl(agencyContactId);
      }
    } catch (error) {
      const duplicateAgencyContactId = toText(error?.meta?.agency_contact_id);
      const duplicateAgencyId = toText(error?.meta?.agency_id);
      if (error?.code === "agency_contact_duplicate_in_agency" && duplicateAgencyContactId) {
        setCreateStatusWithLink(
          "Ese contacto ya existe dentro de la agencia seleccionada.",
          buildAgencyContactUrl(duplicateAgencyContactId),
          "Abrir contacto"
        );
        setFeedback("Alta bloqueada por duplicado dentro de la agencia.", "error");
        return;
      }
      if (error?.code === "agency_contact_identity_in_other_agency" && duplicateAgencyId) {
        setCreateStatusWithLink(
          "Ese email o telefono ya esta vinculado a otra agencia.",
          buildAgencyUrl(duplicateAgencyId),
          "Abrir agencia"
        );
        setFeedback("Alta bloqueada: el contacto ya existe en otra agencia.", "error");
        return;
      }
      setCreateStatus(`No se pudo crear: ${error.message}`, "error");
      setFeedback(`Error creando contacto: ${error.message}`, "error");
    }
  };

  const checkContactDuplicateHint = async () => {
    if (!(el.createForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.createForm);
    const email = toText(formData.get("email"))?.toLowerCase() ?? null;
    const phone = toText(formData.get("phone"));
    if (!email && !phone) return;

    const signal = email || phone;
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("q", signal);
    params.set("page", "1");
    params.set("per_page", "5");

    try {
      const payload = await request(`${apiBase}?${params.toString()}`);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const exact = rows.find((item) => {
        const sameEmail = email && toText(item.email)?.toLowerCase() === email;
        const samePhone = phone && toText(item.phone) === phone;
        return sameEmail || samePhone;
      });
      if (!exact) return;

      const agencyContactId = toText(exact.agency_contact_id);
      const agencyId = toText(exact.agency_id);
      if (agencyContactId) {
        setCreateStatusWithLink(
          state.agencyId && agencyId === state.agencyId
            ? "Posible duplicado detectado en esta agencia."
            : "Posible duplicado detectado antes de crear.",
          buildAgencyContactUrl(agencyContactId),
          "Abrir contacto",
          "error"
        );
      }
    } catch {
      // Keep creation flow silent if pre-check fails.
    }
  };

  const resetFilters = () => {
    el.filterForm?.reset();
    setFormFieldValue("q", "");
    state.pagination.page = 1;
    if (el.perPageSelect instanceof HTMLSelectElement) state.pagination.perPage = Number(el.perPageSelect.value) || 25;
  };

  const bootstrap = () => {
    const search = new URLSearchParams(window.location.search);
    const q = toText(search.get("q"));
    const page = toNumber(search.get("page"));
    const perPage = toNumber(search.get("per_page"));
    state.agencyId = toText(search.get("agency_id")) || "";
    if (q) setFormFieldValue("q", q);
    if (page > 0) state.pagination.page = page;
    if (perPage && el.perPageSelect instanceof HTMLSelectElement) {
      el.perPageSelect.value = String(perPage);
      state.pagination.perPage = perPage;
    }
  };

  const openRow = (target) => {
    const row = target.closest("tr[data-agency-contact-id]");
    if (!(row instanceof HTMLTableRowElement)) return;
    const agencyContactId = toText(row.getAttribute("data-agency-contact-id"));
    if (!agencyContactId) return;
    window.location.href = buildAgencyContactUrl(agencyContactId);
  };

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) window.localStorage.setItem("crm.organization_id", state.organizationId);

  bootstrap();

  el.createAgencySearch?.addEventListener("input", () => {
    syncSelectedAgencyFromSearch();
  });
  el.createForm?.addEventListener("submit", handleCreateContact);
  el.createForm?.addEventListener("focusout", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name !== "email" && target.name !== "phone") return;
    void checkContactDuplicateHint();
  });

  el.filterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.pagination.page = 1;
    try {
      await load();
      setFeedback("Listado de contactos actualizado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando contactos: ${error.message}`, "error");
    }
  });

  el.filterClear?.addEventListener("click", async () => {
    resetFilters();
    try {
      await load();
      setFeedback("Filtros limpiados.", "ok");
    } catch (error) {
      setFeedback(`Error cargando contactos: ${error.message}`, "error");
    }
  });

  el.perPageSelect?.addEventListener("change", async () => {
    state.pagination.page = 1;
    state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    try {
      await load();
      setFeedback("Paginacion actualizada.", "ok");
    } catch (error) {
      setFeedback(`Error cargando contactos: ${error.message}`, "error");
    }
  });

  el.pagination?.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-page-action]") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const action = toText(button.getAttribute("data-page-action"));
    if (action === "prev" && state.pagination.page > 1) state.pagination.page -= 1;
    else if (action === "next" && state.pagination.page < state.pagination.totalPages) state.pagination.page += 1;
    else return;

    try {
      await load();
      setFeedback("Pagina actualizada.", "ok");
    } catch (error) {
      setFeedback(`Error cargando contactos: ${error.message}`, "error");
    }
  });

  el.tbody?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const anchor = target.closest("a");
    if (anchor) return;
    openRow(target);
  });

  el.tbody?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    event.preventDefault();
    openRow(target);
  });

  Promise.all([loadAgencyOptions(), load()])
    .then(() => setFeedback("Modulo de contactos de agencia cargado.", "ok"))
    .catch((error) => setFeedback(`Error cargando contactos: ${error.message}`, "error"));
})();
