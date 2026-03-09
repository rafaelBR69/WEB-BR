(() => {
  const apiBase = "/api/v1/crm/agencies/contacts";

  const state = {
    organizationId: "",
    agencyContactId: String(window.__crmAgencyContactId || "").trim(),
    payload: null,
    monthlyChartCleanup: null,
  };

  const el = {
    title: document.getElementById("agency-contact-detail-title"),
    meta: document.getElementById("agency-contact-detail-meta"),
    feedback: document.getElementById("agency-contact-detail-feedback"),
    editForm: document.getElementById("agency-contact-edit-form"),
    editStatus: document.getElementById("agency-contact-edit-status"),
    deactivateButton: document.getElementById("agency-contact-deactivate-button"),
    kpiAttributed: document.getElementById("agency-contact-kpi-attributed"),
    kpiAttributedCustomers: document.getElementById("agency-contact-kpi-attributed-customers"),
    kpiDiscarded: document.getElementById("agency-contact-kpi-discarded"),
    kpiLeads: document.getElementById("agency-contact-kpi-leads"),
    kpiOpen: document.getElementById("agency-contact-kpi-open"),
    kpiConverted: document.getElementById("agency-contact-kpi-converted"),
    kpiClients: document.getElementById("agency-contact-kpi-clients"),
    kpiReserved: document.getElementById("agency-contact-kpi-reserved"),
    kpiRate: document.getElementById("agency-contact-kpi-rate"),
    monthly: document.getElementById("agency-contact-detail-monthly"),
    status: document.getElementById("agency-contact-detail-status"),
    projects: document.getElementById("agency-contact-detail-projects"),
    clients: document.getElementById("agency-contact-detail-clients"),
    leads: document.getElementById("agency-contact-detail-leads"),
    attributedLeads: document.getElementById("agency-contact-detail-attributed-leads"),
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

  const buildAgencyUrl = (agencyId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/agencies/${encodeURIComponent(agencyId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const buildAgencyContactUrl = (agencyContactId) => {
    const qs = new URLSearchParams();
    if (state.organizationId) qs.set("organization_id", state.organizationId);
    return `/crm/agencies/contacts/${encodeURIComponent(agencyContactId)}${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  const disposeMonthlyChart = () => {
    if (typeof state.monthlyChartCleanup === "function") {
      state.monthlyChartCleanup();
      state.monthlyChartCleanup = null;
    }
  };

  const renderMonthlyFallback = (rows) => {
    if (!(el.monthly instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      el.monthly.innerHTML = "<p class='crm-inline-note'>Sin historico suficiente.</p>";
      return;
    }
    const maxTotal = Math.max(...rows.map((row) => toNumber(row.total)), 1);
    const maxCustomers = Math.max(...rows.map((row) => toNumber(row.customer_total)), 1);
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
              <div class="crm-mini-bar-track"><div class="crm-mini-bar-fill is-soft" style="width:${Math.max((toNumber(row.customer_total) / maxCustomers) * 100, toNumber(row.customer_total) ? 6 : 0)}%"></div></div>
              <small class="crm-inline-note">clientes ${esc(String(toNumber(row.customer_total)))}</small>
            </div>
          </div>
        </article>
      `)
      .join("");
  };

  const renderMonthly = (rows) => {
    if (!(el.monthly instanceof HTMLElement)) return;
    disposeMonthlyChart();
    if (!Array.isArray(rows) || !rows.length) {
      el.monthly.innerHTML = "<p class='crm-inline-note'>Sin historico suficiente.</p>";
      return;
    }
    if (!window.THREE) {
      renderMonthlyFallback(rows);
      return;
    }

    const width = Math.max(el.monthly.clientWidth - 12, 260);
    const height = 250;
    const monthCount = rows.length;
    const stage = document.createElement("div");
    stage.className = "crm-chart-3d-stage";
    const legend = document.createElement("div");
    legend.className = "crm-chart-3d-legend";
    legend.innerHTML = `
      <span class="is-total">Registros</span>
      <span class="is-customer">Clientes</span>
      <span class="is-discarded">Baja</span>
    `;
    const labels = document.createElement("div");
    labels.className = "crm-chart-3d-labels";
    labels.innerHTML = rows
      .map(
        (row) => `
          <div class="crm-chart-3d-label">
            <strong>${esc(row.month_label || row.month_key || "-")}</strong>
            <span>${esc(String(toNumber(row.total)))} reg</span>
            <span>${esc(String(toNumber(row.customer_total)))} cli</span>
          </div>
        `
      )
      .join("");

    const renderer = new window.THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.className = "crm-chart-3d-canvas";
    stage.appendChild(renderer.domElement);
    el.monthly.innerHTML = "";
    el.monthly.append(stage, legend, labels);

    const scene = new window.THREE.Scene();
    scene.background = null;
    const camera = new window.THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 7.8, 13.2);
    camera.lookAt(0, 1.4, 0);

    const ambientLight = new window.THREE.AmbientLight(0xffffff, 1.35);
    const keyLight = new window.THREE.DirectionalLight(0xffffff, 1.9);
    keyLight.position.set(8, 14, 10);
    const fillLight = new window.THREE.DirectionalLight(0x93c5fd, 0.9);
    fillLight.position.set(-8, 8, 4);
    scene.add(ambientLight, keyLight, fillLight);

    const floor = new window.THREE.Mesh(
      new window.THREE.PlaneGeometry(18, 10),
      new window.THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        transparent: true,
        opacity: 0.55,
        roughness: 0.98,
        metalness: 0.02,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);

    const maxValue = Math.max(
      ...rows.flatMap((row) => [toNumber(row.total), toNumber(row.customer_total), toNumber(row.discarded_total)]),
      1
    );
    const materials = {
      total: new window.THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.35, metalness: 0.12 }),
      customer: new window.THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.35, metalness: 0.08 }),
      discarded: new window.THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4, metalness: 0.06 }),
    };
    const barGeometry = new window.THREE.BoxGeometry(0.42, 1, 0.42);
    const spacing = 1.6;
    const startX = -((monthCount - 1) * spacing) / 2;

    rows.forEach((row, index) => {
      const x = startX + index * spacing;
      [
        { key: "total", value: toNumber(row.total), offset: -0.38 },
        { key: "customer", value: toNumber(row.customer_total), offset: 0 },
        { key: "discarded", value: toNumber(row.discarded_total), offset: 0.38 },
      ].forEach((series) => {
        const barHeight = Math.max((series.value / maxValue) * 5.2, series.value > 0 ? 0.18 : 0.02);
        const mesh = new window.THREE.Mesh(barGeometry, materials[series.key]);
        mesh.scale.y = barHeight;
        mesh.position.set(x + series.offset, barHeight / 2, series.key === "discarded" ? 0.48 : series.key === "customer" ? 0 : -0.48);
        scene.add(mesh);
      });
    });

    const gridMaterial = new window.THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.85 });
    for (let i = 0; i <= 4; i += 1) {
      const y = (i / 4) * 5.2;
      const points = [
        new window.THREE.Vector3(-7.2, y, -1.1),
        new window.THREE.Vector3(7.2, y, -1.1),
      ];
      scene.add(new window.THREE.Line(new window.THREE.BufferGeometry().setFromPoints(points), gridMaterial));
    }

    let frameId = 0;
    const animate = () => {
      frameId = window.requestAnimationFrame(animate);
      scene.rotation.y += 0.0025;
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!(el.monthly instanceof HTMLElement)) return;
      const nextWidth = Math.max(el.monthly.clientWidth - 12, 260);
      camera.aspect = nextWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, height);
    };
    window.addEventListener("resize", handleResize);

    state.monthlyChartCleanup = () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      barGeometry.dispose();
      Object.values(materials).forEach((material) => material.dispose());
      floor.geometry.dispose();
      floor.material.dispose();
      gridMaterial.dispose();
      scene.clear();
    };
  };

  const renderBars = (node, rows, valueKey, metaBuilder, linkBuilder = null) => {
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
        const title = toText(row.status) || toText(row.project_label) || toText(row.billing_name) || "Sin nombre";
        const href = linkBuilder ? linkBuilder(row) : null;
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

  const renderLeadRows = (rows) => {
    if (!(el.leads instanceof HTMLElement)) return;
    if (!Array.isArray(rows) || !rows.length) {
      el.leads.innerHTML = "<p class='crm-inline-note'>No hay leads CRM asignados a este contacto.</p>";
      return;
    }
    el.leads.innerHTML = rows
      .map((row) => {
        const title = toText(row.full_name) || toText(row.email) || toText(row.phone) || "Lead sin nombre";
        const meta = [
          toText(row.status),
          toText(row.project_label),
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
            <p class="crm-ranking-meta">${esc(meta || "Lead CRM del contacto")}</p>
            <p class="crm-ranking-meta">${esc(foot)}</p>
          </article>
        `;
      })
      .join("");
  };

  const renderClients = (crmClients, historicalCustomers) => {
    if (!(el.clients instanceof HTMLElement)) return;
    const combined = []
      .concat(
        Array.isArray(crmClients)
          ? crmClients.map((row) => ({
              ...row,
              item_type: "crm_client",
              title: toText(row.billing_name) || "Cliente CRM",
            }))
          : []
      )
      .concat(
        Array.isArray(historicalCustomers)
          ? historicalCustomers.map((row) => ({
              ...row,
              item_type: "historical_customer",
              title: toText(row.full_name) || "Cliente historico",
            }))
          : []
      );
    if (!combined.length) {
      el.clients.innerHTML = "<p class='crm-inline-note'>No hay clientes atribuidos a este contacto.</p>";
      return;
    }
    el.clients.innerHTML = combined
      .map((row) => {
        const href = row.item_type === "crm_client" && row.client_id ? buildClientUrl(row.client_id) : null;
        const meta =
          row.item_type === "crm_client"
            ? `cliente CRM | ${toText(row.client_code) || "sin codigo"} | reservas ${toNumber(row.reservation_count)}`
            : "cliente historico atribuido desde CSV";
        return `
          <article class="crm-ranking-item">
            <div class="crm-ranking-head">
              ${href ? `<a href="${esc(href)}" class="crm-ranking-title">${esc(row.title)}</a>` : `<span class="crm-ranking-title">${esc(row.title)}</span>`}
              <strong>${esc(row.item_type === "crm_client" ? "CRM" : "CSV")}</strong>
            </div>
            <p class="crm-ranking-meta">${esc(meta)}</p>
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
          <p class="crm-ranking-meta">Registro atribuido al contacto sin ficha CRM enlazada todavia.</p>
        </article>
      `)
      .join("");
  };

  const render = () => {
    const payload = state.payload;
    if (!payload) return;
    const contact = payload.contact || {};
    const kpis = payload.kpis || {};
    const charts = payload.charts || {};

    setText(el.title, toText(contact.full_name) || toText(contact.email) || "Contacto de agencia");
    if (el.meta instanceof HTMLElement) {
      const agencyLink = contact.agency_id
        ? `<a href="${esc(buildAgencyUrl(contact.agency_id))}" class="crm-link">${esc(toText(contact.agency_name) || "Agencia")}</a>`
        : esc(toText(contact.agency_name) || "Agencia");
      el.meta.innerHTML =
        `${agencyLink} | ${esc(toText(contact.role) || "agent")} | ` +
        `${esc([contact.is_primary ? "principal" : null, toText(contact.email), toText(contact.phone)].filter(Boolean).join(" | ") || "sin contacto directo")}`;
    }
    if (el.editForm instanceof HTMLFormElement) {
      setFormValue(el.editForm, "full_name", toText(contact.full_name) || "");
      setFormValue(el.editForm, "email", toText(contact.email) || "");
      setFormValue(el.editForm, "phone", toText(contact.phone) || "");
      setFormValue(el.editForm, "role", toText(contact.role) || "agent");
      setFormValue(el.editForm, "relation_status", toText(contact.relation_status) || "active");
      setFormValue(el.editForm, "is_primary", contact.is_primary ? "true" : "false");
    }

    setText(el.kpiLeads, toNumber(kpis.leads_total));
    setText(el.kpiAttributed, toNumber(kpis.attributed_records_total));
    setText(el.kpiAttributedCustomers, toNumber(kpis.attributed_customer_total));
    setText(el.kpiDiscarded, toNumber(kpis.attributed_discarded_total));
    setText(el.kpiOpen, toNumber(kpis.leads_open_total));
    setText(el.kpiConverted, toNumber(kpis.leads_converted_total));
    setText(el.kpiClients, toNumber(kpis.converted_clients_total));
    setText(el.kpiReserved, toNumber(kpis.reserved_clients_total));
    setText(el.kpiRate, `${toNumber(kpis.attributed_customer_rate_pct)}%`);

    renderMonthly(charts.attributed_monthly_records || []);
    renderBars(el.status, charts.attributed_status_breakdown || [], "total", (row) => `estado ${toText(row.status_label) || "-"}`);
    renderBars(
      el.projects,
      charts.attributed_project_mix || [],
      "total",
      (row) => `registros ${toNumber(row.total)} | clientes ${toNumber(row.customer_total)} | baja ${toNumber(row.discarded_total)}`
    );
    renderClients(payload.converted_clients || [], payload.attributed_customers || []);
    renderLeadRows(payload.crm_leads || []);
    renderHistoricalLeads(payload.attributed_lead_samples || []);
  };

  const load = async () => {
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    const payload = await request(`${apiBase}/${encodeURIComponent(state.agencyContactId)}?${params.toString()}`);
    state.payload = payload.data || null;
    render();
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!(el.editForm instanceof HTMLFormElement)) return;
    const formData = new FormData(el.editForm);
    const payload = {
      organization_id: state.organizationId,
      full_name: toText(formData.get("full_name")),
      email: toText(formData.get("email")),
      phone: toText(formData.get("phone")),
      role: toText(formData.get("role")) || "agent",
      relation_status: toText(formData.get("relation_status")) || "active",
      is_primary: toText(formData.get("is_primary")) === "true",
    };

    setInlineStatus(el.editStatus, "Guardando...");
    try {
      await request(`${apiBase}/${encodeURIComponent(state.agencyContactId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      await load();
      setInlineStatus(el.editStatus, "Cambios guardados.", "success");
      setFeedback("Contacto actualizado.", "ok");
    } catch (error) {
      const duplicateAgencyContactId = toText(error?.meta?.agency_contact_id);
      const duplicateAgencyId = toText(error?.meta?.agency_id);
      if (error?.code === "agency_contact_duplicate_in_agency" && duplicateAgencyContactId) {
        setInlineStatusWithLink(
          el.editStatus,
          "Ese contacto ya existe dentro de esta agencia.",
          buildAgencyContactUrl(duplicateAgencyContactId),
          "Abrir contacto"
        );
        setFeedback("Edicion bloqueada por duplicado dentro de la agencia.", "error");
        return;
      }
      if (error?.code === "agency_contact_identity_in_other_agency" && duplicateAgencyId) {
        const qs = new URLSearchParams();
        if (state.organizationId) qs.set("organization_id", state.organizationId);
        setInlineStatusWithLink(
          el.editStatus,
          "Ese email o telefono ya esta vinculado a otra agencia.",
          `/crm/agencies/${encodeURIComponent(duplicateAgencyId)}${qs.toString() ? `?${qs.toString()}` : ""}`,
          "Abrir agencia"
        );
        setFeedback("Edicion bloqueada: el contacto ya existe en otra agencia.", "error");
        return;
      }
      setInlineStatus(el.editStatus, `No se pudo guardar: ${error.message}`, "error");
      setFeedback(`Error actualizando contacto: ${error.message}`, "error");
    }
  };

  const handleDeactivate = async () => {
    const confirmed = window.confirm("Esto desactivara el contacto en la agencia. Quieres continuar?");
    if (!confirmed) return;
    setInlineStatus(el.editStatus, "Desactivando...");
    try {
      await request(`${apiBase}/${encodeURIComponent(state.agencyContactId)}?organization_id=${encodeURIComponent(state.organizationId)}`, {
        method: "DELETE",
      });
      await load();
      setInlineStatus(el.editStatus, "Contacto desactivado.", "success");
      setFeedback("Contacto desactivado.", "ok");
    } catch (error) {
      setInlineStatus(el.editStatus, `No se pudo desactivar: ${error.message}`, "error");
      setFeedback(`Error desactivando contacto: ${error.message}`, "error");
    }
  };

  const queryOrganizationId = toText(new URLSearchParams(window.location.search).get("organization_id"));
  const localOrganizationId = toText(window.localStorage.getItem("crm.organization_id"));
  const defaultOrganizationId = toText(window.__crmDefaultOrganizationId);
  state.organizationId = queryOrganizationId || localOrganizationId || defaultOrganizationId || "";
  if (state.organizationId) window.localStorage.setItem("crm.organization_id", state.organizationId);

  el.editForm?.addEventListener("submit", handleSave);
  el.deactivateButton?.addEventListener("click", handleDeactivate);

  load()
    .then(() => setFeedback("Ficha de contacto cargada.", "ok"))
    .catch((error) => setFeedback(`Error cargando ficha: ${error.message}`, "error"));
})();
