(() => {
  const apiBase = "/api/v1/crm/agencies";

  const state = {
    organizationId: "",
    agencyId: String(window.__crmAgencyId || "").trim(),
    payload: null,
  };

  const el = {
    title: document.getElementById("agency-detail-title"),
    meta: document.getElementById("agency-detail-meta"),
    feedback: document.getElementById("agency-detail-feedback"),
    contactsLink: document.getElementById("agency-detail-contacts-link"),
    editForm: document.getElementById("agency-edit-form"),
    editStatus: document.getElementById("agency-edit-status"),
    archiveButton: document.getElementById("agency-archive-button"),
    contactCreateForm: document.getElementById("agency-contact-create-form"),
    contactCreateStatus: document.getElementById("agency-contact-create-status"),
    kpiAttributed: document.getElementById("agency-kpi-attributed"),
    kpiCrmLeads: document.getElementById("agency-kpi-crm-leads"),
    kpiWithIdentity: document.getElementById("agency-kpi-with-identity"),
    kpiWithoutIdentity: document.getElementById("agency-kpi-without-identity"),
    kpiCustomer: document.getElementById("agency-kpi-customer"),
    kpiDiscarded: document.getElementById("agency-kpi-discarded"),
    kpiConvertedClients: document.getElementById("agency-kpi-converted-clients"),
    kpiClients: document.getElementById("agency-kpi-clients"),
    kpiReserved: document.getElementById("agency-kpi-reserved"),
    kpiRate: document.getElementById("agency-kpi-rate"),
    kpiProjects: document.getElementById("agency-kpi-projects"),
    monthly: document.getElementById("agency-detail-monthly"),
    status: document.getElementById("agency-detail-status"),
    projects: document.getElementById("agency-detail-projects"),
    contacts: document.getElementById("agency-detail-contacts"),
    leads: document.getElementById("agency-detail-leads"),
    clients: document.getElementById("agency-detail-clients"),
    attributedLeads: document.getElementById("agency-detail-attributed-leads"),
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

  const setText = (node, value) => {
    if (node instanceof HTMLElement) node.textContent = String(value ?? "-");
  };

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.textContent = message;
    el.feedback.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.feedback.classList.add("is-ok");
    if (kind === "error") el.feedback.classList.add("is-error");
  };

  const setInlineStatus = (node, message, kind = "muted") => {
    if (!(node instanceof HTMLElement)) return;
    node.textContent = message;
    node.classList.remove("is-error", "is-success");
    if (kind === "error") node.classList.add("is-error");
    if (kind === "success") node.classList.add("is-success");
  };

  const setInlineStatusWithLink = (node, message, href, label, kind = "error") => {
    if (!(node instanceof HTMLElement)) return;
    node.classList.remove("is-error", "is-success");
    if (kind === "error") node.classList.add("is-error");
    if (kind === "success") node.classList.add("is-success");
    node.innerHTML = `${esc(message)} <a class="crm-link" href="${esc(href)}">${esc(label)}</a>`;
  };

  const buildClientUrl = (clientId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/clients/${encodeURIComponent(clientId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const buildLeadUrl = (leadId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/leads/${encodeURIComponent(leadId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
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

  const buildAgencyContactsListUrl = () => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    if (state.agencyId) qs.set("agency_id", state.agencyId);
    return `/crm/agencies/contacts/${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const setFormValue = (form, name, value) => {
    if (!(form instanceof HTMLFormElement)) return;
    const field = form.elements.namedItem(name);
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    ) {
      field.value = value == null ? "" : String(value);
    }
  };

  const renderMonthly = (rows) => {
    if (!(el.monthly instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      el.monthly.innerHTML = "<p class='crm-inline-note'>Sin historico suficiente.</p>";
      return;
    }
    const maxTotal = Math.max(...rows.map((row) => toNumber(row.total)), 1);
    const maxIdentity = Math.max(...rows.map((row) => toNumber(row.with_identity_total)), 1);
    const maxCustomer = Math.max(...rows.map((row) => toNumber(row.customer_total)), 1);
    el.monthly.innerHTML = rows
      .map((row) => `
        <article class="crm-mini-bar-card">
          <div class="crm-mini-bar-head">
            <strong>${esc(row.month_label || row.month_key || "-")}</strong>
            <span>${esc(String(toNumber(row.total)))} registros</span>
          </div>
          <div class="crm-mini-bar-stack">
            <div>
              <div class="crm-mini-bar-track"><div class="crm-mini-bar-fill" style="width:${Math.max((toNumber(row.total) / maxTotal) * 100, 6)}%"></div></div>
              <small class="crm-inline-note">atribuidos ${esc(String(toNumber(row.total)))}</small>
            </div>
            <div>
              <div class="crm-mini-bar-track"><div class="crm-mini-bar-fill is-soft" style="width:${Math.max((toNumber(row.with_identity_total) / maxIdentity) * 100, toNumber(row.with_identity_total) ? 6 : 0)}%"></div></div>
              <small class="crm-inline-note">con identidad ${esc(String(toNumber(row.with_identity_total)))}</small>
            </div>
            <div>
              <div class="crm-mini-bar-track"><div class="crm-mini-bar-fill is-accent" style="width:${Math.max((toNumber(row.customer_total) / maxCustomer) * 100, toNumber(row.customer_total) ? 6 : 0)}%"></div></div>
              <small class="crm-inline-note">clientes ${esc(String(toNumber(row.customer_total)))}</small>
            </div>
          </div>
        </article>
      `)
      .join("");
  };

  const renderBars = (node, rows, valueKey, metaBuilder) => {
    if (!(node instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      node.innerHTML = "<p class='crm-inline-note'>Sin datos todavia.</p>";
      return;
    }
    const maxValue = Math.max(...rows.map((row) => toNumber(row[valueKey])), 1);
    node.innerHTML = rows
      .map((row) => {
        const value = toNumber(row[valueKey]);
        const width = Math.max((value / maxValue) * 100, value ? 6 : 0);
        const title =
          toText(row.status_label) ||
          toText(row.status) ||
          toText(row.project_label) ||
          toText(row.full_name) ||
          toText(row.billing_name) ||
          "Sin nombre";
        const href = row.client_id ? buildClientUrl(row.client_id) : null;
        return `
          <article class="crm-ranking-item">
            <div class="crm-ranking-head">
              ${href ? `<a href="${esc(href)}" class="crm-ranking-title">${esc(title)}</a>` : `<span class="crm-ranking-title">${esc(title)}</span>`}
              <strong>${esc(String(value))}</strong>
            </div>
            <p class="crm-ranking-meta">${esc(metaBuilder(row))}</p>
            <div class="crm-ranking-bar"><span style="width:${width}%"></span></div>
          </article>
        `;
      })
      .join("");
  };

  const renderContacts = (rows) => {
    if (!(el.contacts instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      el.contacts.innerHTML = "<p class='crm-inline-note'>Sin contactos activos asociados.</p>";
      return;
    }
    el.contacts.innerHTML = rows
      .map((row) => `
        <article class="crm-ranking-item">
          <div class="crm-ranking-head">
            <a href="${esc(buildAgencyContactUrl(row.agency_contact_id || row.id))}" class="crm-ranking-title">${esc(toText(row.full_name) || "Sin nombre")}</a>
            <strong>${esc(String(toNumber(row.converted_clients_total)))} clientes</strong>
          </div>
          <p class="crm-ranking-meta">${esc([
            toText(row.role) || "agent",
            row.is_primary ? "principal" : null,
            toText(row.email),
            toText(row.phone),
          ].filter(Boolean).join(" | ") || "Sin contacto directo")}</p>
          <div class="crm-ranking-bar"><span style="width:${Math.max(toNumber(row.lead_conversion_rate_pct), row.leads_total ? 6 : 0)}%"></span></div>
          <p class="crm-ranking-meta">Leads ${esc(String(toNumber(row.leads_total)))} | Convertidos ${esc(String(toNumber(row.leads_converted_total)))} | % ${esc(String(toNumber(row.lead_conversion_rate_pct)))}</p>
        </article>
      `)
      .join("");
  };

  const renderLeads = (rows) => {
    if (!(el.leads instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      el.leads.innerHTML = "<p class='crm-inline-note'>No hay leads CRM enlazados todavia.</p>";
      return;
    }
    el.leads.innerHTML = rows
      .map((row) => {
        const title = toText(row.full_name) || toText(row.email) || toText(row.phone) || "Lead sin nombre";
        const meta = [
          toText(row.status) || "sin estado",
          toText(row.project_label),
          toText(row.agency_contact_name) ? `contacto ${toText(row.agency_contact_name)}` : null,
          toText(row.source),
        ]
          .filter(Boolean)
          .join(" | ");
        const foot = row.converted_client_name
          ? `Cliente generado: ${toText(row.converted_client_name)}`
          : `Creado ${toText(row.created_at) || "-"}`;
        return `
          <article class="crm-ranking-item">
            <div class="crm-ranking-head">
              <a href="${esc(buildLeadUrl(row.lead_id))}" class="crm-ranking-title">${esc(title)}</a>
              <strong>${esc(toText(row.status) || "-")}</strong>
            </div>
            <p class="crm-ranking-meta">${esc(meta || "Lead CRM asociado a la agencia")}</p>
            <p class="crm-ranking-meta">${esc(foot)}</p>
          </article>
        `;
      })
      .join("");
  };

  const renderClients = (rows) => {
    if (!(el.clients instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      el.clients.innerHTML = "<p class='crm-inline-note'>No hay clientes vinculados a esta agencia.</p>";
      return;
    }
    el.clients.innerHTML = rows
      .map((row) => {
        const title = toText(row.billing_name) || "Cliente sin nombre";
        const meta = [
          row.is_from_converted_lead ? "desde lead convertido" : "vinculado por reservas/datos",
          toText(row.client_code),
          toText(row.client_status),
        ]
          .filter(Boolean)
          .join(" | ");
        return `
          <article class="crm-ranking-item">
            <div class="crm-ranking-head">
              <a href="${esc(buildClientUrl(row.client_id))}" class="crm-ranking-title">${esc(title)}</a>
              <strong>${esc(String(toNumber(row.reservation_count)))} reservas</strong>
            </div>
            <p class="crm-ranking-meta">${esc(meta || "Cliente vinculado a la agencia")}</p>
            <p class="crm-ranking-meta">${esc(`match ${toNumber(row.linked_agency_match_score)} | ${toText(row.linked_agency_match_status) || "sin clasificar"}`)}</p>
          </article>
        `;
      })
      .join("");
  };

  const renderHistoricalLeads = (rows) => {
    if (!(el.attributedLeads instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      el.attributedLeads.innerHTML = "<p class='crm-inline-note'>No hay historico adicional fuera de CRM.</p>";
      return;
    }
    el.attributedLeads.innerHTML = rows
      .map((row) => `
        <article class="crm-ranking-item">
          <div class="crm-ranking-head">
            <span class="crm-ranking-title">${esc(toText(row.full_name) || "Lead historico")}</span>
            <strong>CSV</strong>
          </div>
          <p class="crm-ranking-meta">Registro atribuido a la agencia sin ficha CRM enlazada todavia.</p>
        </article>
      `)
      .join("");
  };

  const render = () => {
    const payload = state.payload;
    if (!payload) return;
    const agency = payload.agency || {};
    const kpis = payload.kpis || {};
    const charts = payload.charts || {};

    setText(el.title, toText(agency.full_name) || "Agencia");
    if (el.meta instanceof HTMLElement) {
      el.meta.textContent =
        `${toText(agency.agency_code) || "Sin codigo"} | ${toText(agency.agency_status) || "Sin estado"} | ` +
        `${toText(agency.agency_scope) || "Sin scope"} | cliente base ${toText(agency.client_code) || "sin codigo"}`;
    }
    if (el.contactsLink instanceof HTMLAnchorElement) {
      el.contactsLink.href = buildAgencyContactsListUrl();
    }
    if (el.editForm instanceof HTMLFormElement) {
      setFormValue(el.editForm, "full_name", toText(agency.full_name) || "");
      setFormValue(el.editForm, "agent_name", toText(agency.agent_name) || "");
      setFormValue(el.editForm, "email", toText(agency.email) || "");
      setFormValue(el.editForm, "phone", toText(agency.phone) || "");
      setFormValue(el.editForm, "client_status", toText(agency.client_status) || "active");
      setFormValue(el.editForm, "agency_status", toText(agency.agency_status) || "active");
      setFormValue(el.editForm, "agency_scope", toText(agency.agency_scope) || "mixed");
      setFormValue(
        el.editForm,
        "agency_is_referral_source",
        agency.agency_is_referral_source === false ? "false" : "true"
      );
      setFormValue(el.editForm, "agency_notes", toText(agency.agency_notes) || "");
    }

    setText(el.kpiAttributed, toNumber(kpis.attributed_records_total));
    setText(el.kpiCrmLeads, toNumber(kpis.leads_total));
    setText(el.kpiWithIdentity, toNumber(kpis.attributed_records_with_identity_total));
    setText(el.kpiWithoutIdentity, toNumber(kpis.attributed_records_without_identity_total));
    setText(el.kpiCustomer, toNumber(kpis.attributed_records_customer_total));
    setText(el.kpiDiscarded, toNumber(kpis.attributed_records_discarded_total));
    setText(el.kpiConvertedClients, toNumber(kpis.converted_clients_total));
    setText(el.kpiClients, toNumber(kpis.linked_clients_total));
    setText(el.kpiReserved, toNumber(kpis.linked_reserved_clients_total));
    setText(el.kpiRate, `${toNumber(kpis.attributed_to_linked_client_rate_pct)}%`);
    setText(el.kpiProjects, toNumber(kpis.projects_total));

    renderMonthly(charts.monthly_leads || []);
    renderBars(el.status, charts.status_breakdown || [], "total", (row) => `estado ${toText(row.status_label) || toText(row.status) || "-"}`);
    renderBars(
      el.projects,
      charts.project_mix || [],
      "attributed_records_total",
      (row) =>
        `crm ${toNumber(row.crm_leads_total)} | clientes ${toNumber(row.customer_total)} | vinculados ${toNumber(row.linked_clients_total)}`
    );
    renderContacts(payload.contacts || []);
    renderLeads(payload.crm_leads || []);
    renderClients(payload.clients_brought || payload.linked_clients || []);
    renderHistoricalLeads(payload.attributed_lead_samples || []);
  };

  const load = async () => {
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    const payload = await request(`${apiBase}/${encodeURIComponent(state.agencyId)}?${params.toString()}`);
    state.payload = payload.data || null;
    render();
  };

  const handleAgencySave = async (event) => {
    event.preventDefault();
    if (!(el.editForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.editForm);
    const payload = {
      organization_id: state.organizationId,
      full_name: toText(formData.get("full_name")),
      agent_name: toText(formData.get("agent_name")),
      email: toText(formData.get("email")),
      phone: toText(formData.get("phone")),
      client_status: toText(formData.get("client_status")),
      agency_status: toText(formData.get("agency_status")),
      agency_scope: toText(formData.get("agency_scope")),
      agency_is_referral_source: toText(formData.get("agency_is_referral_source")) !== "false",
      agency_notes: toText(formData.get("agency_notes")),
    };

    setInlineStatus(el.editStatus, "Guardando...");
    try {
      await request(`${apiBase}/${encodeURIComponent(state.agencyId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      await load();
      setInlineStatus(el.editStatus, "Cambios guardados.", "success");
      setFeedback("Agencia actualizada.", "ok");
    } catch (error) {
      const duplicateAgencyId = toText(error?.meta?.agency_id);
      if (error?.code === "agency_duplicate_identity" && duplicateAgencyId) {
        setInlineStatusWithLink(
          el.editStatus,
          "Ese email o telefono ya pertenece a otra agencia.",
          buildAgencyUrl(duplicateAgencyId),
          "Abrir agencia"
        );
        setFeedback("Edicion bloqueada por duplicado de agencia.", "error");
        return;
      }
      setInlineStatus(el.editStatus, `No se pudo guardar: ${error.message}`, "error");
      setFeedback(`Error actualizando agencia: ${error.message}`, "error");
    }
  };

  const handleAgencyArchive = async () => {
    const confirmed = window.confirm("Esto archivara la agencia y su cliente base. Quieres continuar?");
    if (!confirmed) return;
    setInlineStatus(el.editStatus, "Archivando...");
    try {
      await request(`${apiBase}/${encodeURIComponent(state.agencyId)}?organization_id=${encodeURIComponent(state.organizationId)}`, {
        method: "DELETE",
      });
      await load();
      setInlineStatus(el.editStatus, "Agencia archivada.", "success");
      setFeedback("Agencia archivada.", "ok");
    } catch (error) {
      setInlineStatus(el.editStatus, `No se pudo archivar: ${error.message}`, "error");
      setFeedback(`Error archivando agencia: ${error.message}`, "error");
    }
  };

  const handleContactCreate = async (event) => {
    event.preventDefault();
    if (!(el.contactCreateForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.contactCreateForm);
    const payload = {
      organization_id: state.organizationId,
      agency_id: state.agencyId,
      full_name: toText(formData.get("full_name")),
      email: toText(formData.get("email")),
      phone: toText(formData.get("phone")),
      role: toText(formData.get("role")) || "agent",
      is_primary: toText(formData.get("is_primary")) === "true",
      notes: toText(formData.get("notes")),
    };

    setInlineStatus(el.contactCreateStatus, "Creando contacto...");
    try {
      await request("/api/v1/crm/agencies/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      el.contactCreateForm.reset();
      await load();
      setInlineStatus(el.contactCreateStatus, "Contacto creado.", "success");
      setFeedback("Contacto de agencia creado.", "ok");
    } catch (error) {
      const duplicateAgencyContactId = toText(error?.meta?.agency_contact_id);
      const duplicateAgencyId = toText(error?.meta?.agency_id);
      if (error?.code === "agency_contact_duplicate_in_agency" && duplicateAgencyContactId) {
        setInlineStatusWithLink(
          el.contactCreateStatus,
          "Ese contacto ya existe dentro de esta agencia.",
          buildAgencyContactUrl(duplicateAgencyContactId),
          "Abrir contacto"
        );
        setFeedback("Alta bloqueada por duplicado dentro de la agencia.", "error");
        return;
      }
      if (error?.code === "agency_contact_identity_in_other_agency" && duplicateAgencyId) {
        setInlineStatusWithLink(
          el.contactCreateStatus,
          "Ese email o telefono ya esta vinculado a otra agencia.",
          buildAgencyUrl(duplicateAgencyId),
          "Abrir agencia"
        );
        setFeedback("Alta bloqueada: el contacto ya existe en otra agencia.", "error");
        return;
      }
      setInlineStatus(el.contactCreateStatus, `No se pudo crear: ${error.message}`, "error");
      setFeedback(`Error creando contacto: ${error.message}`, "error");
    }
  };

  const checkAgencyContactDuplicateHint = async () => {
    if (!(el.contactCreateForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.contactCreateForm);
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
      const payload = await request(`/api/v1/crm/agencies/contacts?${params.toString()}`);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const exact = rows.find((item) => {
        const sameEmail = email && toText(item.email)?.toLowerCase() === email;
        const samePhone = phone && toText(item.phone) === phone;
        return sameEmail || samePhone;
      });
      if (!exact) return;
      const agencyContactId = toText(exact.agency_contact_id);
      if (agencyContactId) {
        setInlineStatusWithLink(
          el.contactCreateStatus,
          exact.agency_id === state.agencyId
            ? "Posible duplicado detectado en esta agencia."
            : "Posible duplicado detectado antes de crear.",
          buildAgencyContactUrl(agencyContactId),
          "Abrir contacto"
        );
      }
    } catch {
      // Keep creation flow silent if pre-check fails.
    }
  };

  const queryOrganizationId = toText(new URLSearchParams(window.location.search).get("organization_id"));
  const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) window.localStorage.setItem("crm.organization_id", state.organizationId);

  el.editForm?.addEventListener("submit", handleAgencySave);
  el.archiveButton?.addEventListener("click", handleAgencyArchive);
  el.contactCreateForm?.addEventListener("submit", handleContactCreate);
  el.contactCreateForm?.addEventListener("focusout", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name !== "email" && target.name !== "phone") return;
    void checkAgencyContactDuplicateHint();
  });

  load()
    .then(() => setFeedback("Ficha de agencia cargada.", "ok"))
    .catch((error) => setFeedback(`Error cargando ficha: ${error.message}`, "error"));
})();
