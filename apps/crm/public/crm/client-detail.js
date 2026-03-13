(() => {
  const apiBase = "/api/v1/clients";

  const statusLabels = {
    active: "Activo",
    inactive: "Inactivo",
    discarded: "Descartado",
    blacklisted: "Blacklisted",
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

  const documentKindLabels = {
    dni_front: "DNI anverso",
    dni_back: "DNI reverso",
    nie_front: "NIE anverso",
    nie_back: "NIE reverso",
    passport: "Pasaporte",
    cif: "CIF",
    bank_proof: "Justificante bancario",
    reservation: "Reserva",
    contract: "Contrato",
    authorization: "Autorizacion",
    other: "Otro",
  };

  const linkedProjectSourceLabels = {
    provider_link: "Proveedor en promocion",
    reservation: "Reserva importada",
    assigned_property_parent: "Vivienda asignada",
  };

  const state = {
    organizationId: "",
    clientId: "",
    client: null,
    documents: [],
    properties: [],
    assignment: null,
    editMode: false,
  };

  const el = {
    title: document.getElementById("client-detail-title"),
    subtitle: document.getElementById("client-detail-subtitle"),
    editToggle: document.getElementById("client-edit-toggle"),
    deleteButton: document.getElementById("client-delete"),
    editForm: document.getElementById("client-edit-form"),
    editPanel: document.getElementById("client-edit-panel"),
    editCancel: document.getElementById("client-edit-cancel"),
    editCancel2: document.getElementById("client-edit-cancel2"),
    docForm: document.getElementById("client-doc-form"),
    docsList: document.getElementById("client-docs-list"),
    assignmentSummary: document.getElementById("client-assignment-summary"),
    linkedProjectsList: document.getElementById("client-linked-projects"),
    linkedProjectsBlock: document.getElementById("client-linked-projects-block"),
    propertyForm: document.getElementById("client-property-form"),
    propertySelect: document.getElementById("client-property-id"),
    propertyClear: document.getElementById("client-property-clear"),
    feedback: document.getElementById("client-detail-feedback"),
    // Premium UI elements
    avatar: document.getElementById("client-hero-avatar"),
    statusBadge: document.getElementById("client-status-badge"),
    typeBadge: document.getElementById("client-type-badge"),
    channelBadge: document.getElementById("client-channel-badge"),
    signalStatus: document.getElementById("client-signal-status"),
    signalChannel: document.getElementById("client-signal-channel"),
    signalAgency: document.getElementById("client-signal-agency"),
    signalAgent: document.getElementById("client-signal-agent"),
    signalBudget: document.getElementById("client-signal-budget"),
    signalLocation: document.getElementById("client-signal-location"),
    signalProperty: document.getElementById("client-signal-property"),
    signalDocs: document.getElementById("client-signal-docs"),
    timeline: document.getElementById("client-timeline"),
    actionWhatsApp: document.getElementById("action-whatsapp"),
    actionEmail: document.getElementById("action-email"),
    actionCall: document.getElementById("action-call"),
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
      const details = payload?.details || payload?.message || (raw ? raw.slice(0, 220) : null);
      throw new Error(details ? `${errorCode}: ${details}` : errorCode);
    }
    return payload;
  };

  const field = (name) => {
    if (!el.editForm || !el.editForm.elements) return null;
    return el.editForm.elements.namedItem(name);
  };

  const setFieldValue = (name, value) => {
    const input = field(name);
    if (!input) return;
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
      input.value = value == null ? "" : String(value);
    }
  };

  const setCheckbox = (name, checked) => {
    const input = field(name);
    if (input instanceof HTMLInputElement) {
      input.checked = Boolean(checked);
    }
  };

  const checkboxChecked = (name) => {
    const input = field(name);
    return input instanceof HTMLInputElement ? input.checked : false;
  };

  const setFieldDisabled = (name, disabled) => {
    const input = field(name);
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
      input.disabled = disabled;
    }
  };

  const setRoleFieldStates = () => {
    const providerEnabled = checkboxChecked("as_provider");
    const agencyEnabled = checkboxChecked("as_agency");

    ["provider_code", "provider_type", "provider_status", "provider_is_billable", "provider_notes"].forEach(
      (name) => setFieldDisabled(name, !providerEnabled)
    );

    ["agency_code", "agency_scope", "agency_status", "agency_is_referral_source", "agency_notes"].forEach(
      (name) => setFieldDisabled(name, !agencyEnabled)
    );
  };

  const propertyLabel = (row) => {
    const display = toText(row?.display_name) || toText(row?.project_name) || toText(row?.legacy_code) || toText(row?.id);
    const code = toText(row?.legacy_code);
    const status = toText(row?.status);
    const recordType = toText(row?.record_type);
    const parts = [display || "Propiedad"];
    if (code && code !== display) parts.push(code);
    if (recordType) parts.push(recordType);
    if (status) parts.push(status);
    return parts.join(" | ");
  };

  const linkedProjectLabel = (row) => {
    const mapped = row?.project;
    const display =
      toText(mapped?.display_name) ||
      toText(mapped?.project_name) ||
      toText(mapped?.legacy_code) ||
      toText(row?.project_id);
    const code = toText(mapped?.legacy_code);
    const status = toText(mapped?.status);
    const parts = [display || "Promocion"];
    if (code && code !== display) parts.push(code);
    if (status) parts.push(status);
    return parts.join(" | ");
  };

  const normalizeClientId = () => {
    const fromInline = toText(window.__crmClientDetailId);
    if (fromInline) return fromInline;
    const parts = window.location.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((part) => part === "clients");
    if (idx >= 0 && parts[idx + 1]) return toText(parts[idx + 1]);
    return null;
  };

  const setText = (id, value) => {
    const el2 = document.getElementById(id);
    if (el2) el2.textContent = String(value ?? "") || "—";
  };

  const setHtml = (id, html) => {
    const el2 = document.getElementById(id);
    if (el2) el2.innerHTML = html;
  };

  const renderHeader = () => {
    if (!state.client) return;
    const c = state.client;

    // Hero Avatar (initials)
    if (el.avatar) {
      el.avatar.textContent = (c.full_name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
    }
    if (el.title) el.title.textContent = `Ficha de ${c.full_name || "cliente"}`;
    const subParts = [c.email, c.phone].filter(Boolean);
    if (el.subtitle) el.subtitle.textContent = subParts.join("  ·  ") || `Ref: ${c.client_code || "N/A"}`;

    // Badges
    const statusColors = { active: "#10b981", inactive: "#94a3b8", discarded: "#ef4444", blacklisted: "#7c3aed" };
    if (el.statusBadge) {
      const label = statusLabels[c.client_status] || c.client_status || "—";
      const color = statusColors[c.client_status] || "#64748b";
      el.statusBadge.textContent = label;
      el.statusBadge.style.background = `${color}25`;
      el.statusBadge.style.color = color;
    }
    if (el.typeBadge) el.typeBadge.textContent = typeLabels[c.client_type] || c.client_type || "—";
    if (el.channelBadge) el.channelBadge.textContent = channelLabels[c.entry_channel] || c.entry_channel || "—";

    // Communication actions
    const phone = String(c.phone || "").replace(/\D/g, "");
    if (el.actionWhatsApp) {
      el.actionWhatsApp.href = phone ? `https://wa.me/${phone}` : "#";
      el.actionWhatsApp.classList.toggle("is-disabled", !phone);
    }
    if (el.actionEmail) {
      el.actionEmail.href = c.email ? `mailto:${c.email}` : "#";
      el.actionEmail.classList.toggle("is-disabled", !c.email);
    }
    if (el.actionCall) {
      el.actionCall.href = c.phone ? `tel:${c.phone}` : "#";
      el.actionCall.classList.toggle("is-disabled", !c.phone);
    }
  };

  const renderDataFields = () => {
    if (!state.client) return;
    const c = state.client;

    // Identity & Contact
    setText("d-full-name", c.full_name);
    setText("d-client-type", typeLabels[c.client_type] || c.client_type);
    setHtml("d-email", c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—");
    setHtml("d-phone", c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : "—");
    setText("d-nationality", c.nationality);
    setText("d-intake-date", formatDate(c.intake_date || c.created_at));

    // Commercial status
    setText("d-status", statusLabels[c.client_status] || c.client_status);
    setText("d-entry-channel", channelLabels[c.entry_channel] || c.entry_channel);
    setText("d-agency-name", c.agency_name);
    setText("d-agent-name", c.agent_name);

    // Fiscal
    setText("d-tax-id-type", c.tax_id_type ? c.tax_id_type.toUpperCase() : null);
    setText("d-tax-id", c.tax_id);

    // Preferences
    setText("d-budget", formatCurrency(c.budget_amount));
    setText("d-typology", c.typology);
    setText("d-location", c.preferred_location);
    setText(el.signalStatus, statusLabels[c.client_status] || c.client_status || "Sin estado");
    setText(el.signalChannel, channelLabels[c.entry_channel] || c.entry_channel || "Sin canal");
    setText(el.signalAgency, c.agency_name || "Sin agencia");
    setText(el.signalAgent, c.agent_name || "Sin agente");
    setText(el.signalBudget, formatCurrency(c.budget_amount));
    setText(el.signalLocation, c.preferred_location || c.typology || "Sin preferencia");

    // Notes — only show blocks with content
    const noteMap = [
      ["notes-comments", "d-comments", c.comments],
      ["notes-report", "d-report-notes", c.report_notes],
      ["notes-visit", "d-visit-notes", c.visit_notes],
      ["notes-reservation", "d-reservation-notes", c.reservation_notes],
      ["notes-other", "d-other-notes", c.other_notes],
    ];
    let hasNotes = false;
    noteMap.forEach(([blockId, textId, value]) => {
      const block = document.getElementById(blockId);
      const text = String(value || "").trim();
      if (block) block.hidden = !text;
      if (text) { setText(textId, text); hasNotes = true; }
    });
    const noNotes = document.getElementById("d-no-notes");
    if (noNotes) noNotes.hidden = hasNotes;

    // Timeline
    if (el.timeline) {
      const events = [
        { label: "Cliente creado", date: c.created_at, icon: "✨", cls: "accent" },
        ...(c.intake_date ? [{ label: "Fecha de alta", date: c.intake_date, icon: "📋", cls: "" }] : []),
        { label: "Última actualización", date: c.updated_at, icon: "📝", cls: "" },
      ].filter(e => e.date);
      el.timeline.innerHTML = events.map(e => `
        <div class="cd-timeline-event">
          <div class="cd-timeline-dot ${esc(e.cls)}">${esc(e.icon)}</div>
          <div class="cd-timeline-body">
            <strong>${esc(e.label)}</strong>
            <time>${esc(formatDate(e.date))}</time>
          </div>
        </div>
      `).join("");
    }
  };

  const fillEditForm = () => {
    if (!el.editForm || !state.client) return;
    const c = state.client;
    setFieldValue("intake_date", c.intake_date || "");
    setFieldValue("client_type", c.client_type || "individual");
    setFieldValue("entry_channel", c.entry_channel || "other");
    setFieldValue("client_status", c.client_status || "active");
    setFieldValue("agency_name", c.agency_name || "");
    setFieldValue("agent_name", c.agent_name || "");
    setFieldValue("full_name", c.full_name || "");
    setFieldValue("phone", c.phone || "");
    setFieldValue("email", c.email || "");
    setFieldValue("nationality", c.nationality || "");
    setFieldValue("budget_amount", c.budget_amount ?? "");
    setFieldValue("typology", c.typology || "");
    setFieldValue("preferred_location", c.preferred_location || "");
    setFieldValue("tax_id_type", c.tax_id_type || "");
    setFieldValue("tax_id", c.tax_id || "");

    setCheckbox("as_provider", c.is_provider === true);
    setFieldValue("provider_code", c.provider_code || "");
    setFieldValue("provider_type", c.provider_type || "other");
    setFieldValue("provider_status", c.provider_status || "active");
    setCheckbox("provider_is_billable", c.provider_is_billable !== false);
    setFieldValue("provider_notes", c.provider_notes || "");

    setCheckbox("as_agency", c.is_agency === true);
    setFieldValue("agency_code", c.agency_code || "");
    setFieldValue("agency_scope", c.agency_scope || "mixed");
    setFieldValue("agency_status", c.agency_status || "active");
    setCheckbox("agency_is_referral_source", c.agency_is_referral_source !== false);
    setFieldValue("agency_notes", c.agency_notes || "");

    setFieldValue("comments", c.comments || "");
    setFieldValue("report_notes", c.report_notes || "");
    setFieldValue("visit_notes", c.visit_notes || "");
    setFieldValue("reservation_notes", c.reservation_notes || "");
    setFieldValue("discarded_by", c.discarded_by || "");
    setFieldValue("other_notes", c.other_notes || "");

    setRoleFieldStates();
  };

  const payloadFromEditForm = () => {
    if (!el.editForm) return null;
    const formData = new FormData(el.editForm);
    return {
      organization_id: state.organizationId || null,
      intake_date: toText(formData.get("intake_date")),
      client_type: toText(formData.get("client_type")),
      entry_channel: toText(formData.get("entry_channel")),
      client_status: toText(formData.get("client_status")),
      agency_name: toText(formData.get("agency_name")),
      agent_name: toText(formData.get("agent_name")),
      full_name: toText(formData.get("full_name")),
      phone: toText(formData.get("phone")),
      email: toText(formData.get("email")),
      nationality: toText(formData.get("nationality")),
      budget_amount: toNumber(formData.get("budget_amount")),
      typology: toText(formData.get("typology")),
      preferred_location: toText(formData.get("preferred_location")),
      tax_id_type: toText(formData.get("tax_id_type")),
      tax_id: toText(formData.get("tax_id")),
      as_provider: checkboxChecked("as_provider"),
      provider_code: toText(formData.get("provider_code")),
      provider_type: toText(formData.get("provider_type")),
      provider_status: toText(formData.get("provider_status")),
      provider_is_billable: checkboxChecked("provider_is_billable"),
      provider_notes: toText(formData.get("provider_notes")),
      as_agency: checkboxChecked("as_agency"),
      agency_code: toText(formData.get("agency_code")),
      agency_scope: toText(formData.get("agency_scope")),
      agency_status: toText(formData.get("agency_status")),
      agency_is_referral_source: checkboxChecked("agency_is_referral_source"),
      agency_notes: toText(formData.get("agency_notes")),
      comments: toText(formData.get("comments")),
      report_notes: toText(formData.get("report_notes")),
      visit_notes: toText(formData.get("visit_notes")),
      reservation_notes: toText(formData.get("reservation_notes")),
      discarded_by: toText(formData.get("discarded_by")),
      other_notes: toText(formData.get("other_notes")),
    };
  };

  const toggleEditMode = (enabled) => {
    state.editMode = Boolean(enabled);
    if (el.editForm) el.editForm.hidden = !state.editMode;
    if (el.editToggle) {
      el.editToggle.textContent = state.editMode ? "Cerrar edición" : "Editar";
      el.editToggle.classList.add("crm-button");
      el.editToggle.classList.toggle("crm-button-soft", state.editMode);
    }
  };

  const renderDocuments = () => {
    if (!el.docsList) return;
    if (!state.documents.length) {
      el.docsList.innerHTML = "<li>Sin documentos cargados.</li>";
      setText(el.signalDocs, "0 documentos");
      return;
    }
    setText(el.signalDocs, `${state.documents.length} documentos`);

    el.docsList.innerHTML = state.documents
      .map((doc) => {
        const createdAt = formatDate(doc.created_at);
        const kindLabel = documentKindLabels[doc.document_kind] || doc.document_kind || "Documento";
        const fileSize =
          typeof doc.file_size_bytes === "number" && doc.file_size_bytes > 0
            ? `${Math.round(doc.file_size_bytes / 1024)} KB`
            : "-";
        const pathLabel = doc.storage_path || "-";
        const link = doc.public_url
          ? `<a href="${esc(doc.public_url)}" target="_blank" rel="noreferrer">Abrir</a>`
          : "<span>Sin URL publica</span>";
        return `
          <li>
            <strong>${esc(doc.title || kindLabel)}</strong><br />
            <small>${esc(kindLabel)} | ${esc(createdAt)} | ${esc(fileSize)}</small><br />
            <small>${esc(pathLabel)}</small><br />
            ${link}
          </li>
        `;
      })
      .join("");
  };

  const renderPropertyOptions = () => {
    if (!(el.propertySelect instanceof HTMLSelectElement)) return;
    const selectedValue = toText(el.propertySelect.value);
    const baseOptions = [
      '<option value="">Sin asignar</option>',
      ...state.properties
        .filter((item) => toText(item?.id))
        .map((item) => `<option value="${esc(item.id)}">${esc(propertyLabel(item))}</option>`),
    ];

    const assignmentPropertyId = toText(state.assignment?.assigned_property_id);
    const assignmentProperty = state.assignment?.assigned_property;
    if (assignmentPropertyId && !state.properties.some((item) => item.id === assignmentPropertyId)) {
      const fallbackLabel = assignmentProperty ? propertyLabel(assignmentProperty) : assignmentPropertyId;
      baseOptions.push(`<option value="${esc(assignmentPropertyId)}">${esc(fallbackLabel)}</option>`);
    }

    el.propertySelect.innerHTML = baseOptions.join("");
    if (selectedValue && el.propertySelect.querySelector(`option[value="${selectedValue}"]`)) {
      el.propertySelect.value = selectedValue;
    }
  };

  const renderLinkedProjects = () => {
    if (!el.linkedProjectsList) return;
    const rows = Array.isArray(state.assignment?.linked_projects) ? state.assignment.linked_projects : [];
    if (!rows.length) {
      el.linkedProjectsList.innerHTML = "<li>Sin promociones vinculadas.</li>";
      return;
    }

    el.linkedProjectsList.innerHTML = rows
      .map((row) => {
        const sources = Array.isArray(row?.sources)
          ? row.sources
              .map((key) => {
                const sourceKey = toText(key);
                if (!sourceKey) return null;
                return linkedProjectSourceLabels[sourceKey] || sourceKey;
              })
              .filter((value) => Boolean(value))
          : [];
        const reservationStatus = toText(row?.reservation_status);
        const reservationDate = toText(row?.reservation_date);
        const noteParts = [];
        if (sources.length) noteParts.push(`Origen: ${sources.join(", ")}`);
        if (reservationStatus) noteParts.push(`Estado: ${reservationStatus}`);
        if (reservationDate) noteParts.push(`Fecha: ${formatDate(reservationDate)}`);

        return `
          <li>
            <strong>${esc(linkedProjectLabel(row))}</strong><br />
            <small>${esc(noteParts.join(" | ") || "Vinculo sin detalles extra")}</small>
          </li>
        `;
      })
      .join("");
  };

  const renderAssignment = () => {
    if (!el.assignmentSummary) return;
    renderPropertyOptions();
    renderLinkedProjects();

    const assignment = state.assignment;
    const assignedProperty = assignment?.assigned_property;
    const assignedPropertyId = toText(assignment?.assigned_property_id);
    const assignedBuyerRole = toText(assignment?.assigned_buyer_role) || "primary";
    const assignedNotes = toText(assignment?.assigned_notes) || "";

    if (el.propertySelect instanceof HTMLSelectElement) {
      el.propertySelect.value = assignedPropertyId || "";
    }
    if (el.propertyForm instanceof HTMLFormElement) {
      const roleField = el.propertyForm.elements.namedItem("buyer_role");
      if (roleField instanceof HTMLSelectElement) {
        roleField.value = assignedBuyerRole;
      }
      const notesField = el.propertyForm.elements.namedItem("notes");
      if (notesField instanceof HTMLTextAreaElement) {
        notesField.value = assignedNotes;
      }
    }

    const label = assignedProperty
      ? propertyLabel(assignedProperty)
      : assignedPropertyId
        ? `Propiedad ${assignedPropertyId}`
        : "Sin vivienda asignada";
    setText(el.signalProperty, label);

    const linkedProjectsTotal = Array.isArray(assignment?.linked_projects)
      ? assignment.linked_projects.length
      : 0;
    el.assignmentSummary.textContent = assignedPropertyId
      ? `Asignada: ${label}. Puedes cambiarla o quitarla.`
      : linkedProjectsTotal
        ? `Sin vivienda asignada. Tiene ${linkedProjectsTotal} promocion(es) vinculadas.`
        : "Este cliente no tiene vivienda asignada.";
  };

  const loadClient = async () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    const payload = await request(`${apiBase}/${encodeURIComponent(state.clientId)}?${params.toString()}`);
    state.client = payload?.data || null;
    renderHeader();
    renderDataFields();
    fillEditForm();
  };

  const loadDocuments = async () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    const payload = await request(
      `${apiBase}/${encodeURIComponent(state.clientId)}/documents?${params.toString()}`
    );
    state.documents = Array.isArray(payload.data) ? payload.data : [];
    renderDocuments();
  };

  const loadProperties = async () => {
    if (!state.organizationId) {
      state.properties = [];
      renderPropertyOptions();
      return;
    }
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    params.set("per_page", "250");
    const payload = await request(`/api/v1/properties?${params.toString()}`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    state.properties = rows
      .filter((row) => row && (row.record_type === "unit" || row.record_type === "single"))
      .sort((a, b) => propertyLabel(a).localeCompare(propertyLabel(b), "es"));
    renderPropertyOptions();
  };

  const loadAssignment = async () => {
    const params = new URLSearchParams();
    if (state.organizationId) params.set("organization_id", state.organizationId);
    const payload = await request(
      `${apiBase}/${encodeURIComponent(state.clientId)}/property?${params.toString()}`
    );
    state.assignment = payload?.data || null;
    renderAssignment();
  };

  const persistAssignment = async ({ propertyId, buyerRole, notes }) => {
    await request(`${apiBase}/${encodeURIComponent(state.clientId)}/property`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: state.organizationId || null,
        property_id: propertyId,
        buyer_role: buyerRole || "primary",
        notes: notes || null,
      }),
    });
    await loadAssignment();
  };

  el.editToggle?.addEventListener("click", () => {
    if (!state.client) return;
    if (!state.editMode) fillEditForm();
    toggleEditMode(!state.editMode);
  });

  el.editCancel?.addEventListener("click", () => {
    fillEditForm();
    toggleEditMode(false);
  });

  el.editForm?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const name = target.getAttribute("name");
    if (name === "as_provider" || name === "as_agency") {
      setRoleFieldStates();
    }
  });

  el.editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = payloadFromEditForm();
    if (!payload?.full_name) {
      setFeedback("El nombre es obligatorio.", "error");
      return;
    }

    try {
      const response = await request(`${apiBase}/${encodeURIComponent(state.clientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.client = response?.data || state.client;
      renderHeader();
      renderDataFields();
      fillEditForm();
      toggleEditMode(false);
      setFeedback("Ficha actualizada correctamente.", "ok");
    } catch (error) {
      setFeedback(`Error guardando cliente: ${error.message}`, "error");
    }
  });

  el.deleteButton?.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Se eliminara este cliente del CRM. Esta accion no se puede deshacer."
    );
    if (!confirmed) return;

    try {
      const params = new URLSearchParams();
      if (state.organizationId) params.set("organization_id", state.organizationId);
      await request(`${apiBase}/${encodeURIComponent(state.clientId)}?${params.toString()}`, {
        method: "DELETE",
      });
      window.location.href = "/crm/clients/";
    } catch (error) {
      setFeedback(`Error eliminando cliente: ${error.message}`, "error");
    }
  });

  el.propertyForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!el.propertyForm) return;
    const data = new FormData(el.propertyForm);
    const propertyId = toText(data.get("property_id"));
    const buyerRole = toText(data.get("buyer_role")) || "primary";
    const notes = toText(data.get("notes"));
    try {
      await persistAssignment({ propertyId, buyerRole, notes });
      setFeedback(
        propertyId ? "Vivienda asignada actualizada." : "Asignacion de vivienda eliminada.",
        "ok"
      );
    } catch (error) {
      setFeedback(`Error guardando propiedad asignada: ${error.message}`, "error");
    }
  });

  el.propertyClear?.addEventListener("click", async () => {
    try {
      await persistAssignment({ propertyId: null, buyerRole: "primary", notes: null });
      setFeedback("Asignacion de vivienda eliminada.", "ok");
    } catch (error) {
      setFeedback(`Error quitando asignacion: ${error.message}`, "error");
    }
  });

  el.docForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!el.docForm) return;
    const docData = new FormData(el.docForm);
    const file = docData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      setFeedback("Debes seleccionar un archivo.", "error");
      return;
    }

    docData.set("organization_id", state.organizationId || "");
    try {
      await request(`${apiBase}/${encodeURIComponent(state.clientId)}/documents/upload`, {
        method: "POST",
        body: docData,
      });
      el.docForm.reset();
      if (el.docForm.elements.is_private) el.docForm.elements.is_private.checked = true;
      setFeedback("Documento subido y vinculado al cliente.", "ok");
      await loadDocuments();
    } catch (error) {
      setFeedback(`Error subiendo documento: ${error.message}`, "error");
    }
  });

  const search = new URLSearchParams(window.location.search);
  const queryOrganizationId = toText(search.get("organization_id"));
  const localOrganizationId = toText(localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) localStorage.setItem("crm.organization_id", state.organizationId);

  state.clientId = normalizeClientId();
  if (!state.clientId) {
    setFeedback("No se encontro el ID del cliente en la URL.", "error");
    if (el.docsList) el.docsList.innerHTML = "<li>Cliente no valido.</li>";
    return;
  }

  toggleEditMode(false);

  const boot = async () => {
    try {
      await loadClient();
      const secondaryResults = await Promise.allSettled([loadProperties(), loadDocuments(), loadAssignment()]);
      const secondaryFailures = secondaryResults.filter((entry) => entry.status === "rejected");

      if (secondaryFailures.length) {
        if (el.assignmentSummary) {
          const assignmentFailed = secondaryFailures.some((entry) =>
            String(entry.status === "rejected" ? entry.reason?.message ?? "" : "").toLowerCase().includes("property")
          );
          if (assignmentFailed) {
            el.assignmentSummary.textContent =
              "No se pudo cargar la asignacion de propiedad o faltan tablas auxiliares.";
          }
        }

        if (el.docsList) {
          const docsFailed = secondaryFailures.some((entry) =>
            String(entry.status === "rejected" ? entry.reason?.message ?? "" : "").toLowerCase().includes("document")
          );
          if (docsFailed) {
            el.docsList.innerHTML = "<p class='cd-empty'>No se pudo cargar la documentacion.</p>";
          }
        }

        const firstFailure = secondaryFailures[0];
        const failureMessage =
          firstFailure.status === "rejected" && firstFailure.reason instanceof Error
            ? firstFailure.reason.message
            : "unknown_secondary_error";
        setFeedback(`Ficha cargada con avisos: ${failureMessage}`, "error");
        return;
      }

      setFeedback("Ficha cargada.", "ok");
    } catch (error) {
      setFeedback(`Error cargando ficha: ${error.message}`, "error");
      if (el.docsList) {
        el.docsList.innerHTML = "<li>No se pudo cargar la documentacion.</li>";
      }
    }
  };

  boot();
})();
