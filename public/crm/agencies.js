(() => {
  const apiBase = "/api/v1/crm/agencies";

  const agencyStatusLabels = {
    active: "Activa",
    inactive: "Inactiva",
    discarded: "Descartada",
  };

  const agencyStatusClass = {
    active: "ok",
    inactive: "warn",
    discarded: "danger",
  };

  const clientStatusLabels = {
    active: "Activo",
    inactive: "Inactivo",
    discarded: "Descartado",
    blacklisted: "Blacklisted",
  };

  const scopeLabels = {
    buyer: "Comprador",
    seller: "Vendedor",
    rental: "Alquiler",
    mixed: "Mixto",
  };

  const state = {
    organizationId: "",
    items: [],
    pagination: {
      page: 1,
      perPage: 25,
      total: 0,
      totalPages: 1,
    },
  };

  const el = {
    createForm: document.getElementById("agency-create-form"),
    createStatus: document.getElementById("agency-create-status"),
    filterForm: document.getElementById("agencies-filter-form"),
    filterClear: document.getElementById("agencies-filter-clear"),
    perPageSelect: document.getElementById("agencies-per-page"),
    tbody: document.getElementById("agencies-tbody"),
    meta: document.getElementById("agencies-meta"),
    pagination: document.getElementById("agencies-pagination"),
    pageInfo: document.getElementById("agencies-page-info"),
    feedback: document.getElementById("agencies-feedback"),
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
    if (!(el.filterForm instanceof HTMLFormElement)) return null;
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
      const error = new Error(details ? `${errorCode}: ${details}` : errorCode);
      error.code = errorCode;
      error.meta = payload?.meta || null;
      throw error;
    }
    return payload;
  };

  const buildListQuery = () => {
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("page", String(state.pagination.page));
    params.set("per_page", String(state.pagination.perPage));

    ["q", "agency_status", "agency_scope", "client_status", "is_referral_source"].forEach((name) => {
      const field = formField(name);
      const value =
        field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement
          ? toText(field.value)
          : null;
      if (value) params.set(name, value);
    });

    return params;
  };

  const syncUrl = (params) => {
    const next = new URL(window.location.href);
    ["q", "agency_status", "agency_scope", "client_status", "is_referral_source", "page", "per_page"].forEach((key) =>
      next.searchParams.delete(key)
    );
    params.forEach((value, key) => {
      if (key === "organization_id") return;
      next.searchParams.set(key, value);
    });
    const query = next.searchParams.toString();
    window.history.replaceState({}, "", `${next.pathname}${query ? `?${query}` : ""}`);
  };

  const buildClientUrl = (clientId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/clients/${encodeURIComponent(clientId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const buildAgencyUrl = (agencyId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/agencies/${encodeURIComponent(agencyId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const handleCreateAgency = async (event) => {
    event.preventDefault();
    if (!(el.createForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.createForm);
    const payload = {
      organization_id: state.organizationId,
      full_name: toText(formData.get("full_name")),
      agent_name: toText(formData.get("agent_name")),
      email: toText(formData.get("email")),
      phone: toText(formData.get("phone")),
      agency_scope: toText(formData.get("agency_scope")) || "mixed",
      agency_status: toText(formData.get("agency_status")) || "active",
      agency_is_referral_source: toText(formData.get("agency_is_referral_source")) !== "false",
      agency_notes: toText(formData.get("agency_notes")),
    };

    setCreateStatus("Creando agencia...");

    try {
      const payloadResponse = await request(apiBase, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const agencyId = toText(payloadResponse?.data?.agency_id);
      setCreateStatus("Agencia creada.", "success");
      el.createForm.reset();
      await loadAgencies();
      setFeedback("Agencia creada correctamente.", "ok");
      if (agencyId) {
        window.location.href = buildAgencyUrl(agencyId);
      }
    } catch (error) {
      const duplicateAgencyId = toText(error?.meta?.agency_id);
      if (error?.code === "agency_duplicate_identity" && duplicateAgencyId) {
        setCreateStatusWithLink(
          "Ya existe una agencia con ese email o telefono.",
          buildAgencyUrl(duplicateAgencyId),
          "Abrir agencia"
        );
        setFeedback("Alta bloqueada por duplicado de agencia.", "error");
        return;
      }
      setCreateStatus(`No se pudo crear: ${error.message}`, "error");
      setFeedback(`Error creando agencia: ${error.message}`, "error");
    }
  };

  const checkAgencyDuplicateHint = async () => {
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
      if (exact) {
        const agencyId = toText(exact.agency_id || exact.id);
        if (agencyId) {
          setCreateStatusWithLink(
            "Posible duplicado detectado antes de crear.",
            buildAgencyUrl(agencyId),
            "Abrir agencia",
            "error"
          );
        }
      }
    } catch {
      // Keep creation flow silent if pre-check fails.
    }
  };

  const renderTable = () => {
    if (!(el.tbody instanceof HTMLElement)) return;
    if (!state.items.length) {
      el.tbody.innerHTML = "<tr><td colspan='8'>Sin agencias para los filtros actuales.</td></tr>";
      return;
    }

    el.tbody.innerHTML = state.items
      .map((item) => {
        const clientId = toText(item.client_id);
        const agencyId = toText(item.agency_id);
        const fullName = toText(item.full_name) || "Agencia";
        const agencyCode = toText(item.agency_code) || "-";
        const contactText = [toText(item.phone), toText(item.email)].filter(Boolean).join(" | ") || "-";
        const scope = scopeLabels[item.agency_scope] || item.agency_scope || "-";
        const leadsTotal = toNumber(item.leads_total) ?? 0;
        const openLeads = toNumber(item.leads_open_total) ?? 0;
        const convertedLeads = toNumber(item.leads_converted_total) ?? 0;
        const attributedRecords = toNumber(item.attributed_records_total) ?? 0;
        const attributedWithIdentity = toNumber(item.attributed_records_with_identity_total) ?? 0;
        const attributedWithoutIdentity = toNumber(item.attributed_records_without_identity_total) ?? 0;
        const attributedCustomer = toNumber(item.attributed_records_customer_total) ?? 0;
        const attributedDiscarded = toNumber(item.attributed_records_discarded_total) ?? 0;
        const linkedClients = toNumber(item.linked_clients_total) ?? 0;
        const linkedReservedClients = toNumber(item.linked_reserved_clients_total) ?? 0;
        const contactsTotal = toNumber(item.linked_contacts_total) ?? 0;
        const primaryContacts = toNumber(item.linked_primary_contacts_total) ?? 0;
        const clientCode = toText(item.client_code) || "-";
        const clientStatus = clientStatusLabels[item.client_status] || item.client_status || "-";
        const agencyStatus = agencyStatusLabels[item.agency_status] || item.agency_status || "-";
        const referralBadge =
          item.agency_is_referral_source === false
            ? '<span class="crm-badge violet">Sin referidos</span>'
            : '<span class="crm-badge ok">Referral source</span>';
        const rowHref = clientId ? buildClientUrl(clientId) : "#";

        return `
          <tr class="crm-row-clickable" data-agency-id="${esc(agencyId || "")}" tabindex="0" role="button" aria-label="Abrir ficha de ${esc(fullName)}">
            <td data-label="Agencia">
              <a href="${esc(agencyId ? buildAgencyUrl(agencyId) : rowHref)}" class="crm-inline-link"><strong>${esc(fullName)}</strong></a><br />
              <small>${esc(agencyCode)}</small><br />
              ${referralBadge}
            </td>
            <td data-label="Contacto base">
              ${esc(contactText)}<br />
              <small>${esc(toText(item.agent_name) || "Sin agente principal")}</small>
            </td>
            <td data-label="Scope">${esc(scope)}</td>
            <td data-label="Leads aportados">
              <strong>${esc(String(attributedRecords))}</strong><br />
              <small>identidad ${esc(String(attributedWithIdentity))} | cliente ${esc(String(attributedCustomer))} | baja ${esc(String(attributedDiscarded))}</small><br />
              <small>CRM ${esc(String(leadsTotal))} | abiertos ${esc(String(openLeads))} | convertidos ${esc(String(convertedLeads))}</small>
            </td>
            <td data-label="Clientes">
              <strong>${esc(String(linkedClients))}</strong><br />
              <small>con reserva ${esc(String(linkedReservedClients))}</small>
            </td>
            <td data-label="Contactos">
              <strong>${esc(String(contactsTotal))}</strong><br />
              <small>primarios ${esc(String(primaryContacts))}</small>
            </td>
            <td data-label="Cliente base">
              ${esc(clientCode)}<br />
              <small>${esc(clientStatus)}</small>
            </td>
            <td data-label="Estado">
              <span class="crm-badge ${esc(agencyStatusClass[item.agency_status] || "warn")}">${esc(agencyStatus)}</span>
            </td>
          </tr>
        `;
      })
      .join("");
  };

  const renderMeta = (summary = null) => {
    if (!(el.meta instanceof HTMLElement)) return;
    const active = toNumber(summary?.active) ?? 0;
    const referralSources = toNumber(summary?.referral_sources) ?? 0;
    const withOpenLeads = toNumber(summary?.with_open_leads) ?? 0;
    const withLinkedClients = toNumber(summary?.with_linked_clients) ?? 0;
    const attributedRecords = toNumber(summary?.attributed_records_total) ?? 0;
    const attributedWithIdentity = toNumber(summary?.attributed_records_with_identity_total) ?? 0;
    const attributedWithoutIdentity = toNumber(summary?.attributed_records_without_identity_total) ?? 0;
    const linkedClientsTotal = toNumber(summary?.linked_clients_total) ?? 0;
    el.meta.textContent =
      `Mostrando ${state.items.length} | Pagina ${state.pagination.page}/${state.pagination.totalPages} | ` +
      `Total ${state.pagination.total} | Activas ${active} | Referral ${referralSources} | Con leads abiertos ${withOpenLeads} | ` +
      `Registros ${attributedRecords} | Con identidad ${attributedWithIdentity} | Sin identidad ${attributedWithoutIdentity} | ` +
      `Con clientes ${withLinkedClients} | Clientes vinculados ${linkedClientsTotal}`;
  };

  const renderPagination = () => {
    if (!(el.pagination instanceof HTMLElement) || !(el.pageInfo instanceof HTMLElement)) return;
    const page = Number(state.pagination.page ?? 1);
    const totalPages = Number(state.pagination.totalPages ?? 1);
    const total = Number(state.pagination.total ?? 0);
    el.pageInfo.textContent = `Pagina ${page} de ${totalPages} | ${state.items.length} en pagina | ${total} total`;

    const prevBtn = el.pagination.querySelector("button[data-page-action='prev']");
    const nextBtn = el.pagination.querySelector("button[data-page-action='next']");
    if (prevBtn instanceof HTMLButtonElement) prevBtn.disabled = page <= 1;
    if (nextBtn instanceof HTMLButtonElement) nextBtn.disabled = page >= totalPages;
  };

  const loadAgencies = async () => {
    if (!state.organizationId) {
      setFeedback("No hay organizacion CRM activa.", "error");
      return;
    }

    const params = buildListQuery();
    syncUrl(params);
    const payload = await request(`${apiBase}?${params.toString()}`);
    state.items = Array.isArray(payload?.data) ? payload.data : [];
    state.pagination.total = Number(payload?.meta?.total ?? state.items.length ?? 0);
    state.pagination.totalPages = Number(payload?.meta?.total_pages ?? 1);
    state.pagination.page = Number(payload?.meta?.page ?? state.pagination.page ?? 1);
    renderTable();
    renderMeta(payload?.meta?.summary ?? null);
    renderPagination();
  };

  const resetFilters = () => {
    el.filterForm?.reset();
    ["q", "agency_status", "agency_scope", "client_status", "is_referral_source"].forEach((name) =>
      setFormFieldValue(name, "")
    );
    state.pagination.page = 1;
    if (el.perPageSelect instanceof HTMLSelectElement) {
      state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    }
  };

  const bootstrapFiltersFromUrl = () => {
    const search = new URLSearchParams(window.location.search);
    ["q", "agency_status", "agency_scope", "client_status", "is_referral_source"].forEach((name) => {
      const value = toText(search.get(name));
      if (value) setFormFieldValue(name, value);
    });

    const page = toNumber(search.get("page"));
    const perPage = toNumber(search.get("per_page"));
    if (page && page > 0) state.pagination.page = page;
    if (perPage && el.perPageSelect instanceof HTMLSelectElement) {
      el.perPageSelect.value = String(perPage);
      state.pagination.perPage = perPage;
    }
  };

  const handleRowOpen = (target) => {
    const row = target.closest("tr[data-agency-id]");
    if (!(row instanceof HTMLTableRowElement)) return;
    const agencyId = toText(row.getAttribute("data-agency-id"));
    if (!agencyId) return;
    window.location.href = buildAgencyUrl(agencyId);
  };

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) {
    window.localStorage.setItem("crm.organization_id", state.organizationId);
  }

  bootstrapFiltersFromUrl();

  el.filterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.pagination.page = 1;
    try {
      await loadAgencies();
      setFeedback("Listado de agencias actualizado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando agencias: ${error.message}`, "error");
    }
  });

  el.createForm?.addEventListener("submit", handleCreateAgency);
  el.createForm?.addEventListener("focusout", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name !== "email" && target.name !== "phone") return;
    void checkAgencyDuplicateHint();
  });

  el.filterClear?.addEventListener("click", async () => {
    resetFilters();
    try {
      await loadAgencies();
      setFeedback("Filtros limpiados.", "ok");
    } catch (error) {
      setFeedback(`Error cargando agencias: ${error.message}`, "error");
    }
  });

  el.perPageSelect?.addEventListener("change", async () => {
    state.pagination.page = 1;
    state.pagination.perPage = Number(el.perPageSelect.value) || 25;
    try {
      await loadAgencies();
      setFeedback("Paginacion actualizada.", "ok");
    } catch (error) {
      setFeedback(`Error cargando agencias: ${error.message}`, "error");
    }
  });

  el.pagination?.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-page-action]") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const action = toText(button.getAttribute("data-page-action"));
    if (action === "prev" && state.pagination.page > 1) {
      state.pagination.page -= 1;
    } else if (action === "next" && state.pagination.page < state.pagination.totalPages) {
      state.pagination.page += 1;
    } else {
      return;
    }

    try {
      await loadAgencies();
      setFeedback("Pagina actualizada.", "ok");
    } catch (error) {
      setFeedback(`Error cargando agencias: ${error.message}`, "error");
    }
  });

  el.tbody?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const anchor = target.closest("a");
    if (anchor) return;
    handleRowOpen(target);
  });

  el.tbody?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    event.preventDefault();
    handleRowOpen(target);
  });

  void (async () => {
    try {
      await loadAgencies();
      setFeedback("Modulo de agencias cargado.", "ok");
    } catch (error) {
      setFeedback(`Error cargando agencias: ${error.message}`, "error");
    }
  })();
})();
