(() => {
  const apiBase = "/api/v1/crm/agencies/duplicates";

  const state = {
    organizationId: "",
    agencies: [],
    contacts: [],
  };

  const el = {
    agenciesList: document.getElementById("agency-duplicates-agencies-list"),
    contactsList: document.getElementById("agency-duplicates-contacts-list"),
    agenciesMeta: document.getElementById("agency-duplicates-agencies-meta"),
    contactsMeta: document.getElementById("agency-duplicates-contacts-meta"),
    kpiAgencies: document.getElementById("agency-duplicates-kpi-agencies"),
    kpiContacts: document.getElementById("agency-duplicates-kpi-contacts"),
    feedback: document.getElementById("agency-duplicates-feedback"),
    refresh: document.getElementById("agency-duplicates-refresh"),
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
      throw new Error(payload?.details || payload?.error || `http_${response.status}`);
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

  const setText = (node, value) => {
    if (node instanceof HTMLElement) node.textContent = String(value ?? "-");
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

  const renderAgencyGroups = () => {
    if (!(el.agenciesList instanceof HTMLElement)) return;
    if (!(el.agenciesMeta instanceof HTMLElement)) return;
    if (!state.agencies.length) {
      el.agenciesMeta.textContent = "No hay grupos de agencias duplicadas pendientes.";
      el.agenciesList.innerHTML = "<article class='crm-card'><p class='crm-inline-note'>Sin duplicados de agencias.</p></article>";
      return;
    }

    el.agenciesMeta.textContent = `${state.agencies.length} grupos detectados. Selecciona la canónica y fusiona el resto sobre ella.`;
    el.agenciesList.innerHTML = state.agencies
      .map((group) => {
        const options = group.rows
          .map(
            (row) =>
              `<option value="${esc(row.agency_id)}" ${row.agency_id === group.recommended_canonical_agency_id ? "selected" : ""}>${esc(row.agency_name)}${row.agency_code ? ` | ${esc(row.agency_code)}` : ""}</option>`
          )
          .join("");

        const rows = group.rows
          .map((row) => {
            const isRecommended = row.agency_id === group.recommended_canonical_agency_id;
            return `
              <tr>
                <td data-label="Agencia"><a class="crm-inline-link" href="${esc(buildAgencyUrl(row.agency_id))}"><strong>${esc(row.agency_name)}</strong></a><br /><small>${esc([row.agency_code, row.tax_id, row.base_contact_email].filter(Boolean).join(" | ") || "-")}</small></td>
                <td data-label="Clientes">${esc(String(toNumber(row.linked_clients_total)))}</td>
                <td data-label="Registros">${esc(String(toNumber(row.attributed_records_total)))}</td>
                <td data-label="CRM">${esc(String(toNumber(row.leads_total)))}</td>
                <td data-label="Contactos">${esc(String(toNumber(row.linked_contacts_total)))}</td>
                <td data-label="Accion">${
                  isRecommended
                    ? "<span class='crm-inline-note'>Canonica recomendada</span>"
                    : `<button type="button" class="crm-button crm-button-soft" data-merge-entity="agency" data-duplicate-id="${esc(row.agency_id)}" data-group-key="${esc(group.group_key)}">Fusionar en canonica</button>`
                }</td>
              </tr>
            `;
          })
          .join("");

        return `
          <article class="crm-card" data-group-key="${esc(group.group_key)}" data-entity="agency">
            <div class="crm-row-between" style="gap:1rem;align-items:flex-start;flex-wrap:wrap">
              <div>
                <h4 style="margin:0 0 0.25rem">${esc(group.group_label)}</h4>
                <p class="crm-inline-note" style="margin:0">${esc(String(group.total_rows))} fichas | ${esc(String(toNumber(group.total_linked_clients)))} clientes ligados | ${esc(String(toNumber(group.total_attributed_records)))} registros atribuidos</p>
              </div>
              <label>Canonica
                <select class="crm-input" data-canonical-select="agency">
                  ${options}
                </select>
              </label>
            </div>
            <div class="crm-table-wrap" style="margin-top:1rem">
              <table class="crm-table">
                <thead>
                  <tr>
                    <th>Agencia</th>
                    <th>Clientes</th>
                    <th>Registros</th>
                    <th>CRM</th>
                    <th>Contactos</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const renderContactGroups = () => {
    if (!(el.contactsList instanceof HTMLElement)) return;
    if (!(el.contactsMeta instanceof HTMLElement)) return;
    if (!state.contacts.length) {
      el.contactsMeta.textContent = "No hay grupos de contactos duplicados pendientes.";
      el.contactsList.innerHTML = "<article class='crm-card'><p class='crm-inline-note'>Sin duplicados de contactos.</p></article>";
      return;
    }

    el.contactsMeta.textContent = `${state.contacts.length} grupos detectados. Solo se muestran duplicados reales dentro de la misma agencia.`;
    el.contactsList.innerHTML = state.contacts
      .map((group) => {
        const options = group.rows
          .map(
            (row) =>
              `<option value="${esc(row.agency_contact_id)}" ${row.agency_contact_id === group.recommended_canonical_agency_contact_id ? "selected" : ""}>${esc(row.full_name || row.email || row.phone || "Contacto")}</option>`
          )
          .join("");

        const rows = group.rows
          .map((row) => {
            const isRecommended = row.agency_contact_id === group.recommended_canonical_agency_contact_id;
            return `
              <tr>
                <td data-label="Contacto"><a class="crm-inline-link" href="${esc(buildAgencyContactUrl(row.agency_contact_id))}"><strong>${esc(row.full_name || row.email || row.phone || "Sin nombre")}</strong></a><br /><small>${esc([row.email, row.phone, row.role, row.is_primary ? "principal" : null].filter(Boolean).join(" | ") || "-")}</small></td>
                <td data-label="Agencia"><a class="crm-inline-link" href="${esc(buildAgencyUrl(row.agency_id))}">${esc(row.agency_name)}</a></td>
                <td data-label="Registros">${esc(String(toNumber(row.attributed_records_total)))}</td>
                <td data-label="Clientes">${esc(String(toNumber(row.attributed_customer_total)))}</td>
                <td data-label="CRM">${esc(String(toNumber(row.leads_total)))}</td>
                <td data-label="Accion">${
                  isRecommended
                    ? "<span class='crm-inline-note'>Canonica recomendada</span>"
                    : `<button type="button" class="crm-button crm-button-soft" data-merge-entity="contact" data-duplicate-id="${esc(row.agency_contact_id)}" data-group-key="${esc(group.group_key)}">Fusionar en canonica</button>`
                }</td>
              </tr>
            `;
          })
          .join("");

        return `
          <article class="crm-card" data-group-key="${esc(group.group_key)}" data-entity="contact">
            <div class="crm-row-between" style="gap:1rem;align-items:flex-start;flex-wrap:wrap">
              <div>
                <h4 style="margin:0 0 0.25rem">${esc(group.group_label)}</h4>
                <p class="crm-inline-note" style="margin:0">${esc(group.agency_name)} | ${esc(String(group.total_rows))} fichas | ${esc(String(toNumber(group.total_attributed_customers)))} clientes atribuidos</p>
              </div>
              <label>Canonica
                <select class="crm-input" data-canonical-select="contact">
                  ${options}
                </select>
              </label>
            </div>
            <div class="crm-table-wrap" style="margin-top:1rem">
              <table class="crm-table">
                <thead>
                  <tr>
                    <th>Contacto</th>
                    <th>Agencia</th>
                    <th>Registros</th>
                    <th>Clientes</th>
                    <th>CRM</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </article>
        `;
      })
      .join("");
  };

  const render = () => {
    setText(el.kpiAgencies, state.agencies.length);
    setText(el.kpiContacts, state.contacts.length);
    renderAgencyGroups();
    renderContactGroups();
  };

  const load = async () => {
    const params = new URLSearchParams();
    params.set("organization_id", state.organizationId);
    const payload = await request(`${apiBase}?${params.toString()}`);
    state.agencies = Array.isArray(payload?.data?.agencies) ? payload.data.agencies : [];
    state.contacts = Array.isArray(payload?.data?.contacts) ? payload.data.contacts : [];
    render();
  };

  const mergeDuplicate = async (entity, groupKey, duplicateId) => {
    const groupNode = document.querySelector(`[data-group-key="${CSS.escape(groupKey)}"][data-entity="${CSS.escape(entity)}"]`);
    if (!(groupNode instanceof HTMLElement)) return;
    const select = groupNode.querySelector(`[data-canonical-select="${entity}"]`);
    if (!(select instanceof HTMLSelectElement)) return;
    const canonicalId = toText(select.value);
    if (!canonicalId || !duplicateId || canonicalId === duplicateId) {
      setFeedback("Selecciona una canonica distinta de la duplicada.", "error");
      return;
    }

    setFeedback(`Fusionando ${entity === "agency" ? "agencia" : "contacto"}...`);
    try {
      await request(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: state.organizationId,
          entity,
          canonical_id: canonicalId,
          duplicate_id: duplicateId,
        }),
      });
      setFeedback(`Fusion ${entity === "agency" ? "de agencia" : "de contacto"} aplicada.`, "ok");
      await load();
    } catch (error) {
      setFeedback(`No se pudo fusionar: ${error.message}`, "error");
    }
  };

  const bindEvents = () => {
    if (el.refresh instanceof HTMLButtonElement) {
      el.refresh.addEventListener("click", () => {
        load().catch((error) => setFeedback(`No se pudo recargar: ${error.message}`, "error"));
      });
    }

    document.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("[data-merge-entity]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const entity = toText(button.dataset.mergeEntity);
      const duplicateId = toText(button.dataset.duplicateId);
      const groupKey = toText(button.dataset.groupKey);
      if (!entity || !duplicateId || !groupKey) return;
      mergeDuplicate(entity, groupKey, duplicateId).catch((error) => {
        setFeedback(`No se pudo fusionar: ${error.message}`, "error");
      });
    });
  };

  const init = async () => {
    try {
      state.organizationId =
        new URLSearchParams(window.location.search).get("organization_id") ||
        window.localStorage.getItem("crm.organization_id") ||
        window.__crmDefaultOrganizationId ||
        "";
      if (!state.organizationId) {
        throw new Error("organization_id_missing");
      }
      bindEvents();
      await load();
      setFeedback("Cola de duplicados cargada.", "ok");
    } catch (error) {
      setFeedback(`Error cargando duplicados: ${error.message}`, "error");
    }
  };

  init();
})();
