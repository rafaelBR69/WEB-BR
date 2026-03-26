(() => {
  const apiBase = "/api/v1/crm/leads";

  const statusLabels = {
    new: "Nuevo",
    contacted: "Contactado",
    qualified: "Cualificado",
    proposal: "Propuesta",
    negotiation: "Negociación",
    won: "Ganado",
    lost: "Perdido",
    discarded: "Descartado",
    in_process: "En proceso",
    converted: "Convertido",
    junk: "No válido",
  };

  const statusColors = {
    new: "#3b82f6",
    contacted: "#6366f1",
    qualified: "#f59e0b",
    proposal: "#8b5cf6",
    negotiation: "#f97316",
    won: "#10b981",
    lost: "#ef4444",
    discarded: "#94a3b8",
    converted: "#10b981",
    junk: "#94a3b8",
  };

  const kindLabels = {
    buyer: "Comprador",
    seller: "Vendedor",
    investor: "Inversor",
    landlord: "Propietario",
    tenant: "Inquilino",
    agency: "Agencia",
    provider: "Proveedor",
    other: "Otro",
  };

  const interestLabels = {
    sale: "Compra",
    rental: "Alquiler",
    rent: "Alquiler",
    mixed: "Mixto",
    both: "Compra y alquiler",
  };

  const originLabels = {
    direct: "Directo",
    website: "Web corporativa",
    portal: "Portal inmobiliario",
    agency: "Agencia",
    provider: "Proveedor",
    phone: "Llamada",
    whatsapp: "WhatsApp",
    email: "Email",
    other: "Otros",
    unknown: "Desconocido",
  };

  const priorityLabels = {
    1: "Baja",
    2: "Media-Baja",
    3: "Media",
    4: "Alta",
    5: "Crítica",
  };

  const priorityColors = {
    1: "#94a3b8",
    2: "#64748b",
    3: "#3b82f6",
    4: "#f59e0b",
    5: "#ef4444",
  };

  const state = { leadId: "", lead: null, editMode: false };

  const $ = (id) => document.getElementById(id);

  const el = {
    title: $("lead-detail-title"),
    subtitle: $("lead-detail-subtitle"),
    avatar: $("lead-hero-avatar"),
    statusBadge: $("lead-status-badge"),
    priorityBadge: $("lead-priority-badge"),
    kindBadge: $("lead-kind-badge"),
    signalStatus: $("lead-signal-status"),
    signalOrigin: $("lead-signal-origin"),
    signalPriority: $("lead-signal-priority"),
    signalKind: $("lead-signal-kind"),
    signalAgency: $("lead-signal-agency"),
    signalAgencyContact: $("lead-signal-agency-contact"),
    signalInterest: $("lead-signal-interest"),
    signalProperty: $("lead-signal-property"),
    editToggle: $("lead-edit-toggle"),
    deleteButton: $("lead-delete"),
    convertButton: $("lead-convert-btn"),
    editPanel: $("lead-edit-panel"),
    editForm: $("lead-edit-form"),
    editCancel: $("lead-edit-cancel"),
    editCancel2: $("lead-edit-cancel2"),
    feedback: $("lead-detail-feedback"),
    timeline: $("lead-timeline"),
    // action cards
    actionWhatsApp: $("action-whatsapp"),
    actionEmail: $("action-email"),
    actionCall: $("action-call"),
    dealSummary: $("lead-deal-summary"),
    dealButton: $("lead-deal-open-btn"),
    notificationsSummary: $("lead-notifications-summary"),
    notificationsList: $("lead-notifications-list"),
    // data fields
    dFullName: $("d-full-name"),
    dEmail: $("d-email"),
    dPhone: $("d-phone"),
    dNationality: $("d-nationality"),
    dStatus: $("d-status"),
    dKind: $("d-kind"),
    dInterest: $("d-interest"),
    dPriority: $("d-priority"),
    dOrigin: $("d-origin"),
    dSource: $("d-source"),
    dBudgetMin: $("d-budget-min"),
    dBudgetMax: $("d-budget-max"),
    dMessage: $("d-message"),
    dAgency: $("d-agency"),
    dProperty: $("d-property"),
  };

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));

  const toText = (v) => String(v ?? "").trim();

  const fmt = (v) => toText(v) || "—";

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

  const formatCurrency = (v) => {
    const n = Number(v);
    if (isNaN(n) || n === 0) return "—";
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  };

  const formatDate = (v) => {
    const t = toText(v);
    if (!t) return "—";
    const d = new Date(t);
    return isNaN(d.getTime()) ? t : d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  };

  const currentOrganizationId = () =>
    new URLSearchParams(location.search).get("organization_id")
      || localStorage.getItem("crm.organization_id")
      || "";

  const buildAgencyUrl = (agencyId) => {
    const orgId = currentOrganizationId();
    return `/crm/agencies/${encodeURIComponent(agencyId)}${orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""}`;
  };

  const buildDealUrl = (dealId) => {
    const orgId = currentOrganizationId();
    return `/crm/deals/${encodeURIComponent(dealId)}${orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""}`;
  };

  const buildNotificationsUrl = () => {
    const orgId = currentOrganizationId();
    return `/crm/notifications/${orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""}`;
  };

  const setText = (node, value) => {
    if (node) node.textContent = value;
  };

  const setFeedback = (msg, kind = "ok") => {
    if (!el.feedback) return;
    el.feedback.textContent = msg;
    el.feedback.className = `ld-feedback is-${kind}`;
  };

  const request = async (url, init) => {
    const res = await fetch(url, init);
    const payload = await res.json().catch(() => ({}));
    if (isCrmAuthError(res, payload)) {
      redirectToLogin();
      throw new Error(payload.error || `Error ${res.status}`);
    }
    if (!res.ok || !payload.ok) throw new Error(payload.error || payload.message || `Error ${res.status}`);
    return payload;
  };

  const syncConvertButton = () => {
    if (!el.convertButton) return;
    el.convertButton.textContent = state.lead?.lead_kind === "agency" ? "Convertir a Agencia" : "Convertir a Cliente";
  };

  const renderDealSummary = (lead) => {
    if (!el.dealSummary || !el.dealButton) return;
    const summary = lead?.deals_summary || null;
    const openDeal = summary?.open_deal || null;
    const recent = Array.isArray(summary?.recent) ? summary.recent : [];

    if (!summary || !summary.total) {
      el.dealSummary.innerHTML = `<span class="ld-empty">No hay deals ligados a este lead.</span>`;
      el.dealButton.textContent = "Crear deal";
      return;
    }

    const recentHtml = recent
      .slice(0, 3)
      .map((deal) => `<li><a href="${esc(buildDealUrl(deal.id))}" style="color:inherit">${esc(deal.title || deal.id)}</a> | ${esc(deal.stage || "-")}</li>`)
      .join("");

    el.dealSummary.innerHTML = `
      <div style="display:grid;gap:0.55rem">
        <div><strong>${esc(String(summary.total))}</strong> deals | abiertos ${esc(String(summary.open_total ?? 0))}</div>
        ${
          openDeal
            ? `<div><a href="${esc(buildDealUrl(openDeal.id))}" style="color:var(--ld-primary);font-weight:700;text-decoration:none">${esc(openDeal.title || openDeal.id)}</a></div>`
            : `<div class="ld-label">No hay deal abierto en este momento.</div>`
        }
        ${recentHtml ? `<ul style="margin:0;padding-left:1.1rem">${recentHtml}</ul>` : ""}
      </div>
    `;
    el.dealButton.textContent = openDeal ? "Abrir deal" : "Crear deal";
  };

  const renderAgencySource = (lead) => {
    if (!el.dAgency) return;
    const source = lead?.agency_source || null;
    if (!source) {
      el.dAgency.innerHTML = `<span class="ld-empty">No consta origen por agencia en este lead.</span>`;
      setText(el.signalAgency, "Sin agencia");
      setText(el.signalAgencyContact, "Sin contacto");
      return;
    }

    const agencyName = toText(source.agency_name) || toText(source.raw_agency_name) || "Agencia sin nombre";
    const contactName = toText(source.primary_contact_name) || toText(source.raw_agency_agent_name);
    const meta = [
      toText(source.agency_code),
      toText(source.agency_status),
      source.linked === false ? "pendiente de enlazar" : "enlazada en CRM",
    ].filter(Boolean).join(" | ");

    el.dAgency.innerHTML = `
      <div style="display:grid;gap:0.55rem">
        <div style="font-weight:700;color:var(--ld-primary)">
          ${source.agency_id ? `<a href="${esc(buildAgencyUrl(source.agency_id))}" style="color:inherit;text-decoration:none">${esc(agencyName)}</a>` : esc(agencyName)}
        </div>
        <div class="ld-label">${esc(meta || "Origen por agencia detectado")}</div>
        <div class="ld-value">${esc(contactName || "Sin contacto principal detectado")}</div>
        <div class="ld-value">${esc([toText(source.email), toText(source.phone)].filter(Boolean).join(" | ") || "Sin email ni telefono de agencia")}</div>
      </div>
    `;
    setText(el.signalAgency, agencyName);
    setText(el.signalAgencyContact, contactName || "Sin contacto principal");
  };

  const renderNotifications = (lead) => {
    if (!el.notificationsSummary || !el.notificationsList) return;
    const summary = lead?.notifications_summary || null;
    const active = Array.isArray(summary?.active_notifications) ? summary.active_notifications : [];

    if (!summary || !summary.total) {
      el.notificationsSummary.innerHTML = `<span class="ld-empty">Sin alertas activas para este lead.</span>`;
      el.notificationsList.innerHTML = "";
      return;
    }

    const priority = toText(summary.max_priority) || "normal";
    el.notificationsSummary.innerHTML = `
      <div style="display:grid;gap:0.55rem">
        <div><strong>${esc(String(summary.open_total ?? 0))}</strong> abiertas | urgentes ${esc(String(summary.urgent_total ?? 0))} | overdue ${esc(String(summary.overdue_total ?? 0))}</div>
        <div class="ld-label">Prioridad maxima: ${esc(priority)}</div>
        <div><a href="${esc(buildNotificationsUrl())}" style="color:var(--ld-primary);font-weight:700;text-decoration:none">Abrir centro de notificaciones</a></div>
      </div>
    `;

    el.notificationsList.innerHTML = active.length
      ? active
          .slice(0, 4)
          .map(
            (item) => `
              <article style="padding:0.8rem 0.9rem;border:1px solid rgba(20,50,77,0.1);border-radius:16px;background:#fff9ef">
                <strong style="display:block;color:var(--ld-primary)">${esc(item.title || "Alerta")}</strong>
                <small style="display:block;margin-top:0.25rem;color:#5e7288">${esc(item.priority || "normal")} | ${esc(item.rule_key || "manual")}</small>
                <small style="display:block;margin-top:0.35rem;color:#334155">${esc(item.body || "")}</small>
              </article>
            `
          )
          .join("")
      : `<span class="ld-empty">Sin alertas abiertas.</span>`;
  };

  const renderLead = () => {
    const l = state.lead;
    if (!l) return;

    // Avatar initials
    const initials = toText(l.full_name).split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
    setText(el.avatar, initials);

    // Hero title / subtitle
    setText(el.title, fmt(l.full_name));
    const subParts = [l.email, l.phone].filter(Boolean);
    setText(el.subtitle, subParts.join("  ·  ") || "Sin información de contacto");

    // Status badge
    if (el.statusBadge) {
      const label = statusLabels[l.status] || l.status || "—";
      const color = statusColors[l.status] || "#64748b";
      el.statusBadge.textContent = label;
      el.statusBadge.style.background = `${color}25`;
      el.statusBadge.style.color = color;
    }

    // Priority badge
    if (el.priorityBadge) {
      const p = l.priority || 3;
      const color = priorityColors[p] || "#3b82f6";
      el.priorityBadge.textContent = `P${p}: ${priorityLabels[p] || "—"}`;
      el.priorityBadge.style.background = `${color}25`;
      el.priorityBadge.style.color = color;
    }

    // Kind badge
    setText(el.kindBadge, kindLabels[l.lead_kind] || l.lead_kind || "—");

    // Communication actions
    const phone = toText(l.phone).replace(/\D/g, "");
    if (el.actionWhatsApp) {
      el.actionWhatsApp.href = phone ? `https://wa.me/${phone}` : "#";
      el.actionWhatsApp.classList.toggle("is-disabled", !phone);
    }
    if (el.actionEmail) {
      el.actionEmail.href = l.email ? `mailto:${l.email}` : "#";
      el.actionEmail.classList.toggle("is-disabled", !l.email);
    }
    if (el.actionCall) {
      el.actionCall.href = l.phone ? `tel:${l.phone}` : "#";
      el.actionCall.classList.toggle("is-disabled", !l.phone);
    }

    setText(el.signalStatus, statusLabels[l.status] || fmt(l.status));
    setText(el.signalOrigin, `${originLabels[l.origin_type] || fmt(l.origin_type)} | ${fmt(l.source)}`);
    setText(el.signalPriority, l.priority ? `P${l.priority}` : "Sin prioridad");
    setText(el.signalKind, `${kindLabels[l.lead_kind] || fmt(l.lead_kind)} | ${interestLabels[l.operation_interest] || fmt(l.operation_interest)}`);

    // Identity & Contact
    setText(el.dFullName, fmt(l.full_name));
    if (el.dEmail) el.dEmail.innerHTML = l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : "—";
    if (el.dPhone) el.dPhone.innerHTML = l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : "—";
    setText(el.dNationality, fmt(l.nationality));

    // Commercial status
    setText(el.dStatus, statusLabels[l.status] || fmt(l.status));
    setText(el.dKind, kindLabels[l.lead_kind] || fmt(l.lead_kind));
    setText(el.dInterest, interestLabels[l.operation_interest] || fmt(l.operation_interest));
    setText(el.dPriority, l.priority ? `${l.priority} — ${priorityLabels[l.priority]}` : "—");
    setText(el.dOrigin, originLabels[l.origin_type] || fmt(l.origin_type));
    setText(el.dSource, fmt(l.source));

    // Budget
    setText(el.dBudgetMin, formatCurrency(l.budget_min));
    setText(el.dBudgetMax, formatCurrency(l.budget_max));

    // Message
    setText(el.dMessage, fmt(l.message || l.body));
    
    // Property
    if (el.dProperty) {
      const prop = l.property_label || l.property_code || (l.property && (l.property.display_name || l.property.legacy_code));
      el.dProperty.innerHTML = prop
        ? `<div style="font-weight:600;color:var(--ld-primary)">${esc(prop)}</div>`
        : `<span class="ld-empty">Sin propiedad vinculada</span>`;
      setText(el.signalProperty, prop || "Sin propiedad");
    }
    renderAgencySource(l);
    setText(el.signalInterest, interestLabels[l.operation_interest] || fmt(l.operation_interest));
    renderDealSummary(l);
    renderNotifications(l);

    // Timeline
    if (el.timeline) {
      const events = [
        { label: "Lead creado", date: l.created_at, icon: "✨", cls: "accent" },
        ...(l.converted_at ? [{ label: "Convertido a cliente", date: l.converted_at, icon: "🤝", cls: "success" }] : []),
        { label: "Última actualización", date: l.updated_at, icon: "📝", cls: "" },
      ].filter(e => e.date);

      el.timeline.innerHTML = events.map(e => `
        <div class="ld-timeline-event">
          <div class="ld-timeline-dot ${esc(e.cls)}">${esc(e.icon)}</div>
          <div class="ld-timeline-body">
            <strong>${esc(e.label)}</strong>
            <time>${esc(formatDate(e.date))}</time>
          </div>
        </div>
      `).join("");
    }

    syncConvertButton();
  };

  const fillForm = () => {
    if (!el.editForm || !state.lead) return;
    const l = state.lead;
    const f = el.editForm.elements;
    const set = (name, val) => { if (f[name]) f[name].value = val ?? ""; };
    set("full_name", l.full_name);
    set("email", l.email);
    set("phone", l.phone);
    set("nationality", l.nationality);
    set("status", l.status || "new");
    set("lead_kind", l.lead_kind || "buyer");
    set("operation_interest", l.operation_interest || "sale");
    set("priority", String(l.priority || 3));
    set("budget_min", l.budget_min || "");
    set("budget_max", l.budget_max || "");
  };

  const toggleEdit = (on) => {
    state.editMode = on;
    if (el.editPanel) el.editPanel.hidden = !on;
    setText(el.editToggle, on ? "Cancelar edición" : "Editar");
    if (on) el.editPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const loadLead = async () => {
    const orgId = new URLSearchParams(location.search).get("organization_id")
      || localStorage.getItem("crm.organization_id")
      || "";
    try {
      const payload = await request(`${apiBase}/${state.leadId}?organization_id=${orgId}`);
      state.lead = payload.data;
      renderLead();
      fillForm();
    } catch (err) {
      setFeedback(err.message || "Error cargando el lead.", "error");
      setText(el.title, "Error al cargar");
    }
  };

  // Edit toggle
  el.editToggle?.addEventListener("click", () => toggleEdit(!state.editMode));
  el.editCancel?.addEventListener("click", () => toggleEdit(false));
  el.editCancel2?.addEventListener("click", () => toggleEdit(false));

  // Save form
  el.editForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(el.editForm);
    const body = Object.fromEntries(fd.entries());
    body.organization_id = new URLSearchParams(location.search).get("organization_id")
      || localStorage.getItem("crm.organization_id");
    try {
      const payload = await request(`${apiBase}/${state.leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      state.lead = payload.data;
      renderLead();
      toggleEdit(false);
      setFeedback("Lead actualizado correctamente.", "ok");
    } catch (err) {
      setFeedback(err.message, "error");
    }
  });

  // Delete
  el.deleteButton?.addEventListener("click", async () => {
    if (!confirm("¿Eliminar este lead permanentemente? Esta acción no se puede deshacer.")) return;
    try {
      const orgId = new URLSearchParams(location.search).get("organization_id")
        || localStorage.getItem("crm.organization_id");
      await request(`${apiBase}/${state.leadId}?organization_id=${orgId}`, { method: "DELETE" });
      window.location.href = `/crm/leads/${location.search}`;
    } catch (err) {
      setFeedback(err.message, "error");
    }
  });

  // Convert lead
  el.convertButton?.addEventListener("click", async () => {
    if (!confirm("¿Convertir este lead en cliente? Se creará una ficha de cliente vinculada.")) return;
    try {
      const orgId = new URLSearchParams(location.search).get("organization_id")
        || localStorage.getItem("crm.organization_id");
      const payload = await request(`${apiBase}/${state.leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId }),
      });
      setFeedback("Lead convertido. Redirigiendo a la ficha de cliente...", "ok");
      setTimeout(() => { window.location.href = `/crm/clients/${payload.data.id}`; }, 1500);
    } catch (err) {
      setFeedback(err.message, "error");
    }
  });

  if (el.convertButton instanceof HTMLButtonElement) {
    const replacementConvertButton = el.convertButton.cloneNode(true);
    el.convertButton.replaceWith(replacementConvertButton);
    el.convertButton = replacementConvertButton;

    el.convertButton.addEventListener("click", async () => {
      const isAgencyLead = state.lead?.lead_kind === "agency";
      const confirmMessage = isAgencyLead
        ? "Convertir este lead en agencia? Se creara o reutilizara la entidad cliente/agencia vinculada."
        : "Convertir este lead en cliente? Se creara o reutilizara una ficha de cliente vinculada.";
      if (!confirm(confirmMessage)) return;

      try {
        const orgId = new URLSearchParams(location.search).get("organization_id")
          || localStorage.getItem("crm.organization_id");
        const payload = await request(`${apiBase}/${state.leadId}/convert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organization_id: orgId }),
        });
        const entityType = toText(payload?.data?.entity_type) || "client";
        const redirectClientId =
          toText(payload?.data?.redirect_client_id) || toText(payload?.data?.client_id) || toText(payload?.data?.id);

        setFeedback(
          entityType === "agency"
            ? "Lead convertido a agencia. Redirigiendo a la ficha base..."
            : "Lead convertido a cliente. Redirigiendo a la ficha...",
          "ok"
        );

        if (redirectClientId) {
          setTimeout(() => { window.location.href = `/crm/clients/${redirectClientId}`; }, 1500);
        }
      } catch (err) {
        setFeedback(err.message, "error");
      }
    });
  }

  el.dealButton?.addEventListener("click", async () => {
    const openDealId = toText(state.lead?.deals_summary?.open_deal?.id);
    if (openDealId) {
      window.location.href = buildDealUrl(openDealId);
      return;
    }

    try {
      const orgId = currentOrganizationId();
      const payload = await request(`${apiBase}/${state.leadId}/deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId || null }),
      });
      const dealId = toText(payload?.data?.id);
      if (dealId) {
        setFeedback(payload?.meta?.created === false ? "Deal abierto existente localizado. Redirigiendo..." : "Deal creado. Redirigiendo...", "ok");
        setTimeout(() => { window.location.href = buildDealUrl(dealId); }, 700);
      }
    } catch (err) {
      setFeedback(err.message, "error");
    }
  });

  state.leadId = window.__crmLeadDetailId;
  if (state.leadId) loadLead();
})();
