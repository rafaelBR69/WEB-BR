(() => {
  const apiBase = "/api/v1/crm/leads";

  const el = {
    form: document.getElementById("leads-create-form"),
    projectSelect: document.getElementById("leads-create-project-select"),
    agencyField: document.getElementById("leads-create-agency-field"),
    agencySearch: document.getElementById("leads-create-agency-search"),
    agencyId: document.getElementById("leads-create-agency-id"),
    agencyList: document.getElementById("leads-create-agency-options"),
    agencyContactField: document.getElementById("leads-create-agency-contact-field"),
    agencyContactSearch: document.getElementById("leads-create-agency-contact-search"),
    agencyContactId: document.getElementById("leads-create-agency-contact-id"),
    agencyContactList: document.getElementById("leads-create-agency-contact-options"),
    originSelect: document.querySelector("#leads-create-form select[name='origin_type']"),
    leadKindSelect: document.querySelector("#leads-create-form select[name='lead_kind']"),
    feedback: document.getElementById("leads-create-feedback"),
  };

  const state = {
    agencies: [],
    agencyContacts: [],
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

  const setFeedback = (message, kind = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
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
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 220) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
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

  const agencyLabel = (row) => {
    const fullName = toText(row?.full_name) || toText(row?.billing_name) || toText(row?.agency_code) || "Agencia";
    const code = toText(row?.agency_code);
    const scope = toText(row?.agency_scope);
    const parts = [fullName];
    if (code && code !== fullName) parts.push(code);
    if (scope) parts.push(scope);
    return parts.join(" | ");
  };

  const agencyContactLabel = (row) => {
    const fullName = toText(row?.full_name) || toText(row?.email) || toText(row?.phone) || "Contacto";
    const agencyName = toText(row?.agency_name);
    const role = toText(row?.role);
    const meta = [agencyName, role, toText(row?.email), toText(row?.phone)].filter(Boolean);
    return [fullName, meta.length ? meta.join(" | ") : null].filter(Boolean).join(" || ");
  };

  const loadProjectOptions = async (organizationId) => {
    if (!(el.projectSelect instanceof HTMLSelectElement)) return;
    if (!organizationId) {
      el.projectSelect.innerHTML = '<option value="">Sin asignar</option>';
      return;
    }

    const params = new URLSearchParams();
    params.set("organization_id", organizationId);
    params.set("record_type", "project");
    params.set("per_page", "300");
    const payload = await request(`/api/v1/properties?${params.toString()}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    rows.sort((a, b) => projectLabel(a).localeCompare(projectLabel(b), "es"));
    el.projectSelect.innerHTML = [
      '<option value="">Sin asignar</option>',
      ...rows
        .filter((item) => toText(item?.id))
        .map((item) => `<option value="${esc(item.id)}">${esc(projectLabel(item))}</option>`),
    ].join("");
  };

  const renderAgencyOptions = (rows) => {
    state.agencies = Array.isArray(rows) ? rows : [];
    if (!(el.agencyList instanceof HTMLDataListElement)) return;
    el.agencyList.innerHTML = state.agencies
      .filter((item) => toText(item?.agency_id))
      .map((item) => `<option value="${esc(agencyLabel(item))}"></option>`)
      .join("");
  };

  const resolveAgencyFromInput = () => {
    const query = toText(el.agencySearch?.value);
    const match = state.agencies.find((row) => agencyLabel(row) === query) ?? null;
    if (el.agencyId instanceof HTMLInputElement) {
      el.agencyId.value = toText(match?.agency_id) || "";
    }
    return match;
  };

  const fillAgencySearchFromId = (agencyId) => {
    if (!(el.agencySearch instanceof HTMLInputElement)) return null;
    const match = state.agencies.find((row) => toText(row?.agency_id) === agencyId) ?? null;
    if (match) {
      el.agencySearch.value = agencyLabel(match);
      if (el.agencyId instanceof HTMLInputElement) el.agencyId.value = agencyId;
    }
    return match;
  };

  const renderAgencyContactOptions = (rows) => {
    state.agencyContacts = Array.isArray(rows) ? rows : [];
    if (el.agencyContactList instanceof HTMLDataListElement) {
      el.agencyContactList.innerHTML = state.agencyContacts
        .filter((item) => toText(item?.agency_contact_id))
        .map((item) => `<option value="${esc(agencyContactLabel(item))}"></option>`)
        .join("");
    }
    const hasContacts = state.agencyContacts.length > 0;
    if (el.agencyContactField instanceof HTMLElement) el.agencyContactField.hidden = !hasContacts;
    if (el.agencyContactSearch instanceof HTMLInputElement) {
      el.agencyContactSearch.value = "";
      el.agencyContactSearch.disabled = !hasContacts;
    }
    if (el.agencyContactId instanceof HTMLInputElement) {
      el.agencyContactId.value = "";
    }
  };

  const resolveAgencyContactFromInput = () => {
    const query = toText(el.agencyContactSearch?.value);
    const match = state.agencyContacts.find((row) => agencyContactLabel(row) === query) ?? null;
    if (el.agencyContactId instanceof HTMLInputElement) {
      el.agencyContactId.value = toText(match?.agency_contact_id) || "";
    }
    return match;
  };

  const loadAgencyOptions = async (organizationId) => {
    if (!(el.agencySearch instanceof HTMLInputElement)) return;
    if (!organizationId) {
      renderAgencyOptions([]);
      return;
    }

    const params = new URLSearchParams();
    params.set("organization_id", organizationId);
    params.set("per_page", "200");
    params.set("agency_status", "active");
    const payload = await request(`/api/v1/crm/agencies?${params.toString()}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    rows.sort((a, b) => agencyLabel(a).localeCompare(agencyLabel(b), "es"));
    renderAgencyOptions(rows);
  };

  const loadAgencyContactOptions = async (organizationId, agencyId) => {
    if (!organizationId || !agencyId) {
      renderAgencyContactOptions([]);
      return;
    }
    const params = new URLSearchParams();
    params.set("organization_id", organizationId);
    params.set("agency_id", agencyId);
    params.set("per_page", "200");
    const payload = await request(`/api/v1/crm/agencies/contacts?${params.toString()}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    rows.sort((a, b) => agencyContactLabel(a).localeCompare(agencyContactLabel(b), "es"));
    renderAgencyContactOptions(rows);
  };

  const toggleAgencyField = () => {
    const needsAgency = toText(el.originSelect?.value) === "agency";
    if (el.agencyField instanceof HTMLElement) {
      el.agencyField.hidden = !needsAgency;
    }
    if (!needsAgency) {
      if (el.agencySearch instanceof HTMLInputElement) el.agencySearch.value = "";
      if (el.agencyId instanceof HTMLInputElement) el.agencyId.value = "";
      renderAgencyContactOptions([]);
    }
  };

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  const organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (organizationId) localStorage.setItem("crm.organization_id", organizationId);

  const prefillFromUrl = () => {
    ["lead_kind", "origin_type", "source", "project_id"].forEach((key) => {
      const value = toText(search.get(key));
      if (!value) return;
      const field =
        key === "project_id"
          ? el.projectSelect
          : document.querySelector(`#leads-create-form [name='${key}']`);
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        field.value = value;
      }
    });
    const agencyIdFromUrl = toText(search.get("agency_id"));
    if (agencyIdFromUrl && el.agencyId instanceof HTMLInputElement) {
      el.agencyId.value = agencyIdFromUrl;
    }
    toggleAgencyField();
  };

  el.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(el.form instanceof HTMLFormElement)) return;
    const formData = new FormData(el.form);
    const body = {
      organization_id: organizationId || null,
      full_name: toText(formData.get("full_name")),
      email: toText(formData.get("email")),
      phone: toText(formData.get("phone")),
      nationality: toText(formData.get("nationality")),
      project_id: toText(formData.get("project_id")),
      source: toText(formData.get("source")),
      status: toText(formData.get("status")),
      origin_type: toText(formData.get("origin_type")),
      agency_id: toText(formData.get("agency_id")),
      agency_contact_id: toText(formData.get("agency_contact_id")),
      operation_interest: toText(formData.get("operation_interest")),
      lead_kind: toText(formData.get("lead_kind")),
      message: toText(formData.get("message")),
    };

    if (!body.full_name) {
      setFeedback("Nombre completo obligatorio.", "error");
      return;
    }
    if (!body.email && !body.phone) {
      setFeedback("Debes indicar email o telefono.", "error");
      return;
    }
    if (body.origin_type === "agency" && !body.agency_id) {
      setFeedback("Selecciona una agencia registrada para usar origen agency.", "error");
      return;
    }
    if (body.origin_type !== "agency") {
      body.agency_id = null;
      body.agency_contact_id = null;
    }

    try {
      const payload = await request(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
      const createdId = toText(payload?.data?.id);
      if (createdId) {
        setFeedback("Lead creado. Redirigiendo...", "ok");
        const url = `/crm/leads/${createdId}${window.location.search}`;
        setTimeout(() => {
          window.location.href = url;
        }, 1000);
      } else {
        setFeedback("Lead creado correctamente.", "ok");
        el.form.reset();
      }
    } catch (error) {
      setFeedback(`Error creando lead: ${error.message}`, "error");
    }
  });

  el.originSelect?.addEventListener("change", () => {
    toggleAgencyField();
  });

  el.agencySearch?.addEventListener("input", async () => {
    const match = resolveAgencyFromInput();
    await loadAgencyContactOptions(organizationId, toText(match?.agency_id) || null);
  });

  el.agencySearch?.addEventListener("change", async () => {
    const match = resolveAgencyFromInput();
    await loadAgencyContactOptions(organizationId, toText(match?.agency_id) || null);
  });

  el.agencyContactSearch?.addEventListener("input", () => {
    resolveAgencyContactFromInput();
  });

  el.agencyContactSearch?.addEventListener("change", () => {
    resolveAgencyContactFromInput();
  });

  void (async () => {
    try {
      prefillFromUrl();
      await loadProjectOptions(organizationId);
      await loadAgencyOptions(organizationId);
      fillAgencySearchFromId(toText(el.agencyId?.value));
      resolveAgencyFromInput();
      toggleAgencyField();
      await loadAgencyContactOptions(organizationId, toText(el.agencyId?.value) || null);
      setFeedback("Formulario listo para crear leads.", "ok");
    } catch (error) {
      setFeedback(`Error cargando promociones: ${error.message}`, "error");
    }
  })();
})();
