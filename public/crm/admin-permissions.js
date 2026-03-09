(() => {
  const root = document.querySelector("[data-crm-admin-permissions-page='true']");
  if (!(root instanceof HTMLElement)) return;

  const ORG_STORAGE_KEY = "crm.organization_id";

  const state = {
    organizationId: "",
    organizationSource: "none",
    rows: [],
    availablePermissions: [],
    availableRoles: ["owner", "admin", "agent", "finance", "legal", "viewer"],
    selectedMembershipId: null,
  };

  const el = {
    orgForm: document.getElementById("crm-admin-org-form"),
    orgInput: document.getElementById("crm-admin-organization-id"),
    clearBtn: document.getElementById("crm-admin-clear"),
    orgSource: document.getElementById("crm-admin-org-source"),
    orgHelp: document.getElementById("crm-admin-org-help"),
    perPage: document.getElementById("crm-admin-users-per-page"),
    q: document.getElementById("crm-admin-users-q"),
    usersMeta: document.getElementById("crm-admin-users-meta"),
    usersTbody: document.getElementById("crm-admin-users-tbody"),
    createForm: document.getElementById("crm-admin-create-form"),
    createEmail: document.getElementById("crm-admin-create-email"),
    createPassword: document.getElementById("crm-admin-create-password"),
    createFullName: document.getElementById("crm-admin-create-full-name"),
    createRole: document.getElementById("crm-admin-create-role"),
    createIsActive: document.getElementById("crm-admin-create-active"),
    form: document.getElementById("crm-admin-permissions-form"),
    membershipId: document.getElementById("crm-admin-membership-id"),
    userId: document.getElementById("crm-admin-user-id"),
    userDisplay: document.getElementById("crm-admin-user-display"),
    role: document.getElementById("crm-admin-role"),
    isActive: document.getElementById("crm-admin-is-active"),
    fullName: document.getElementById("crm-admin-full-name"),
    grantedList: document.getElementById("crm-admin-granted-list"),
    revokedList: document.getElementById("crm-admin-revoked-list"),
    feedback: document.getElementById("crm-admin-feedback"),
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

  const parseJsonSafe = (raw) => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const roleLabel = (value) =>
    window.crmLabels?.label?.("crm-role", value, value || "-") ??
    window.crmLabels?.labelAny?.(value, value || "-") ??
    value ||
    "-";

  const permissionLabel = (value) =>
    window.crmLabels?.label?.("crm-permission", value, value || "-") ??
    window.crmLabels?.labelAny?.(value, value || "-") ??
    value ||
    "-";

  const setFeedback = (message, tone = "ok") => {
    if (!(el.feedback instanceof HTMLElement)) return;
    el.feedback.classList.remove("is-ok", "is-error");
    el.feedback.classList.add(tone === "error" ? "is-error" : "is-ok");
    el.feedback.textContent = message;
  };

  const setOrgSource = () => {
    if (el.orgSource instanceof HTMLElement) {
      const sourceText =
        state.organizationSource === "local_storage"
          ? "Origen organizacion: localStorage."
          : state.organizationSource === "default_env"
            ? "Origen organizacion: configuracion por defecto."
            : "Origen organizacion: manual.";
      el.orgSource.textContent = sourceText;
    }
    if (el.orgHelp instanceof HTMLElement) {
      el.orgHelp.textContent = state.organizationId
        ? `Organizacion activa: ${state.organizationId}`
        : "Define una organizacion para poder administrar permisos.";
    }
  };

  const request = async (url, init = {}) => {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      ...init,
    });
    const raw = await response.text();
    const payload = parseJsonSafe(raw);
    if (!response.ok || !payload?.ok) {
      const code = toText(payload?.error) ?? `http_${response.status}`;
      const details = toText(payload?.details);
      const error = new Error(details ? `${code}: ${details}` : code);
      error.code = code;
      throw error;
    }
    return payload;
  };

  const readInitialOrganizationId = () => {
    let localOrg = null;
    try {
      localOrg = toText(window.localStorage.getItem(ORG_STORAGE_KEY));
    } catch {
      localOrg = null;
    }
    const defaultOrg = toText(window.__crmDefaultOrganizationId);
    if (localOrg) {
      state.organizationId = localOrg;
      state.organizationSource = "local_storage";
      return;
    }
    if (defaultOrg) {
      state.organizationId = defaultOrg;
      state.organizationSource = "default_env";
      return;
    }
    state.organizationId = "";
    state.organizationSource = "manual";
  };

  const statusBadge = (isActive) =>
    isActive
      ? '<span class="crm-badge ok">Activo</span>'
      : '<span class="crm-badge danger">Inactivo</span>';

  const formatDateTime = (value) => {
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

  const renderUsersTable = () => {
    if (!(el.usersTbody instanceof HTMLElement)) return;
    if (!Array.isArray(state.rows) || state.rows.length === 0) {
      el.usersTbody.innerHTML = "<tr><td colspan='6'>No hay usuarios para esta organizacion.</td></tr>";
      return;
    }

    el.usersTbody.innerHTML = state.rows
      .map((row) => {
        const fullName = toText(row?.user?.full_name);
        const email = toText(row?.user?.email) ?? "-";
        const userLabel = fullName ? `${fullName} (${email})` : email;
        const permissions = Array.isArray(row.permissions_effective) ? row.permissions_effective : [];
        const preview = permissions.slice(0, 3).map((entry) => permissionLabel(entry));
        const remaining = Math.max(0, permissions.length - preview.length);
        const permissionsText = preview.length
          ? `${preview.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`
          : "Sin permisos efectivos";
        const role = toText(row.role) ?? "viewer";
        const membershipId = toText(row.membership_id) ?? "";

        return `
          <tr>
            <td>${esc(userLabel)}</td>
            <td><span class="crm-badge warn">${esc(roleLabel(role))}</span></td>
            <td>${statusBadge(row.is_active === true)}</td>
            <td>${esc(permissionsText)}</td>
            <td>${esc(formatDateTime(row?.user?.last_sign_in_at))}</td>
            <td>
              <button type="button" class="crm-button crm-button-soft" data-action="edit-user" data-membership-id="${esc(membershipId)}">
                Editar
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  };

  const renderUsersMeta = (meta) => {
    if (!(el.usersMeta instanceof HTMLElement)) return;
    const count = Number(meta?.count ?? state.rows.length);
    const total = Number(meta?.total ?? count);
    const page = Number(meta?.page ?? 1);
    const pages = Number(meta?.total_pages ?? 1);
    const actorRole = roleLabel(toText(meta?.actor_role) ?? "");
    el.usersMeta.textContent = `Usuarios: ${count}/${total} | Pagina ${page}/${pages} | Rol actual: ${actorRole}`;
  };

  const getSelectedRow = () => {
    if (!state.selectedMembershipId) return null;
    return state.rows.find((entry) => toText(entry.membership_id) === state.selectedMembershipId) ?? null;
  };

  const renderPermissionCheckboxes = (row) => {
    if (!(el.grantedList instanceof HTMLElement) || !(el.revokedList instanceof HTMLElement)) return;
    if (!row) {
      el.grantedList.innerHTML = "<p class='crm-inline-note'>Selecciona un usuario para editar permisos.</p>";
      el.revokedList.innerHTML = "<p class='crm-inline-note'>Selecciona un usuario para editar permisos.</p>";
      return;
    }

    const grantedSet = new Set(Array.isArray(row.permissions_granted) ? row.permissions_granted : []);
    const revokedSet = new Set(Array.isArray(row.permissions_revoked) ? row.permissions_revoked : []);
    const permissionsCatalog = Array.isArray(state.availablePermissions)
      ? state.availablePermissions
      : [];

    const listHtml = (group, selectedSet) =>
      permissionsCatalog
        .map((entry) => {
          const key = toText(entry?.key);
          if (!key) return "";
          const normalizedId = key.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
          const checked = selectedSet.has(key) ? "checked" : "";
          const hintRoles = Array.isArray(entry?.default_roles) ? entry.default_roles.map((role) => roleLabel(role)).join(", ") : "";
          return `
            <label class="crm-checkbox-label" for="${group}-${normalizedId}">
              <input
                type="checkbox"
                id="${group}-${normalizedId}"
                value="${esc(key)}"
                data-permission-group="${group}"
                data-permission-key="${esc(key)}"
                ${checked}
              />
              <span>${esc(permissionLabel(key))}${hintRoles ? ` <small class="crm-field-help">(${esc(hintRoles)})</small>` : ""}</span>
            </label>
          `;
        })
        .join("");

    el.grantedList.innerHTML = listHtml("granted", grantedSet);
    el.revokedList.innerHTML = listHtml("revoked", revokedSet);
  };

  const fillForm = (row) => {
    if (!(el.form instanceof HTMLFormElement)) return;
    state.selectedMembershipId = toText(row?.membership_id);

    if (el.membershipId instanceof HTMLInputElement) {
      el.membershipId.value = toText(row?.membership_id) ?? "";
    }
    if (el.userId instanceof HTMLInputElement) {
      el.userId.value = toText(row?.user_id) ?? "";
    }
    if (el.userDisplay instanceof HTMLInputElement) {
      const fullName = toText(row?.user?.full_name);
      const email = toText(row?.user?.email) ?? "sin email";
      el.userDisplay.value = fullName ? `${fullName} (${email})` : email;
    }
    if (el.role instanceof HTMLSelectElement) {
      el.role.value = toText(row?.role) ?? "viewer";
    }
    if (el.isActive instanceof HTMLInputElement) {
      el.isActive.checked = row?.is_active === true;
    }
    if (el.fullName instanceof HTMLInputElement) {
      el.fullName.value = toText(row?.user?.full_name) ?? "";
    }

    renderPermissionCheckboxes(row);
  };

  const readCheckedPermissions = (groupName) => {
    const selector = `input[type="checkbox"][data-permission-group="${groupName}"]:checked`;
    return Array.from(root.querySelectorAll(selector))
      .map((entry) => toText(entry.value))
      .filter((value) => Boolean(value));
  };

  const loadUsers = async () => {
    if (!state.organizationId) {
      setFeedback("Define una organizacion valida para cargar permisos.", "error");
      return;
    }

    const q = toText(el.q instanceof HTMLInputElement ? el.q.value : "");
    const perPage = toText(el.perPage instanceof HTMLSelectElement ? el.perPage.value : "25") ?? "25";
    const params = new URLSearchParams({
      organization_id: state.organizationId,
      per_page: perPage,
      page: "1",
    });
    if (q) params.set("q", q);

    setFeedback("Cargando usuarios internos...", "ok");
    try {
      const payload = await request(`/api/v1/crm/admin/permissions?${params.toString()}`);
      state.rows = Array.isArray(payload.data) ? payload.data : [];
      state.availablePermissions = Array.isArray(payload.meta?.available_permissions)
        ? payload.meta.available_permissions
        : [];
      state.availableRoles = Array.isArray(payload.meta?.available_roles)
        ? payload.meta.available_roles
        : state.availableRoles;

      const optionsHtml = state.availableRoles
        .map((role) => `<option value="${esc(role)}">${esc(roleLabel(role))}</option>`)
        .join("");

      if (el.role instanceof HTMLSelectElement) {
        const currentRole = toText(el.role.value) ?? "viewer";
        el.role.innerHTML = optionsHtml;
        el.role.value = state.availableRoles.includes(currentRole) ? currentRole : state.availableRoles[0] ?? "viewer";
      }

      if (el.createRole instanceof HTMLSelectElement) {
        const currentCreateRole = toText(el.createRole.value) ?? "viewer";
        el.createRole.innerHTML = optionsHtml;
        el.createRole.value = state.availableRoles.includes(currentCreateRole)
          ? currentCreateRole
          : state.availableRoles.includes("viewer")
            ? "viewer"
            : state.availableRoles[0] ?? "viewer";
      }

      renderUsersTable();
      renderUsersMeta(payload.meta);

      const selected = getSelectedRow();
      if (selected) {
        fillForm(selected);
      } else {
        state.selectedMembershipId = null;
        fillForm(null);
      }

      setFeedback("Listado de permisos actualizado.", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar el listado.";
      setFeedback(`Error al cargar permisos: ${message}`, "error");
    }
  };

  const savePermissions = async () => {
    const membershipId = toText(el.membershipId instanceof HTMLInputElement ? el.membershipId.value : "");
    const userId = toText(el.userId instanceof HTMLInputElement ? el.userId.value : "");
    if (!membershipId || !userId) {
      setFeedback("Selecciona primero un usuario de la tabla.", "error");
      return;
    }

    const role = toText(el.role instanceof HTMLSelectElement ? el.role.value : "");
    const isActive = el.isActive instanceof HTMLInputElement ? el.isActive.checked : true;
    const fullNameValue = toText(el.fullName instanceof HTMLInputElement ? el.fullName.value : "");
    const permissionsGranted = readCheckedPermissions("granted");
    const permissionsRevoked = readCheckedPermissions("revoked");

    const payload = {
      organization_id: state.organizationId,
      membership_id: membershipId,
      user_id: userId,
      role,
      is_active: isActive,
      full_name: fullNameValue,
      permissions_granted: permissionsGranted,
      permissions_revoked: permissionsRevoked,
    };

    setFeedback("Guardando cambios de permisos...", "ok");
    try {
      await request("/api/v1/crm/admin/permissions", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await loadUsers();
      state.selectedMembershipId = membershipId;
      const selected = getSelectedRow();
      if (selected) fillForm(selected);
      setFeedback("Permisos actualizados correctamente.", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar.";
      setFeedback(`Error al guardar permisos: ${message}`, "error");
    }
  };

  const createUser = async () => {
    if (!state.organizationId) {
      setFeedback("Define una organizacion valida antes de crear usuarios.", "error");
      return;
    }

    const email = toText(el.createEmail instanceof HTMLInputElement ? el.createEmail.value : "");
    const password = toText(el.createPassword instanceof HTMLInputElement ? el.createPassword.value : "");
    const fullName = toText(el.createFullName instanceof HTMLInputElement ? el.createFullName.value : "");
    const role = toText(el.createRole instanceof HTMLSelectElement ? el.createRole.value : "") ?? "viewer";
    const isActive = el.createIsActive instanceof HTMLInputElement ? el.createIsActive.checked : true;

    if (!email) {
      setFeedback("El email es obligatorio para crear usuario.", "error");
      return;
    }
    if (!password || password.length < 8) {
      setFeedback("La contrasena debe tener al menos 8 caracteres.", "error");
      return;
    }

    const payload = {
      organization_id: state.organizationId,
      email,
      password,
      full_name: fullName,
      role,
      is_active: isActive,
    };

    setFeedback("Creando usuario interno...", "ok");
    try {
      const result = await request("/api/v1/crm/admin/permissions", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      state.selectedMembershipId = toText(result?.data?.membership_id);
      await loadUsers();
      const selected = getSelectedRow();
      if (selected) fillForm(selected);

      if (el.createPassword instanceof HTMLInputElement) el.createPassword.value = "";
      if (el.createEmail instanceof HTMLInputElement) el.createEmail.value = "";
      if (el.createFullName instanceof HTMLInputElement) el.createFullName.value = "";

      const action = toText(result?.meta?.action);
      if (action === "updated") {
        setFeedback("Usuario existente actualizado y vinculado a la organizacion.", "ok");
      } else {
        setFeedback("Usuario creado correctamente en el CRM.", "ok");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo crear el usuario.";
      setFeedback(`Error al crear usuario: ${message}`, "error");
    }
  };

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editButton = target.closest("[data-action='edit-user']");
    if (editButton instanceof HTMLElement) {
      const membershipId = toText(editButton.dataset.membershipId);
      if (!membershipId) return;
      const row = state.rows.find((entry) => toText(entry.membership_id) === membershipId) ?? null;
      if (!row) return;
      fillForm(row);
      setFeedback("Usuario seleccionado para edicion.", "ok");
      return;
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "checkbox") return;
    const key = toText(target.dataset.permissionKey);
    const group = toText(target.dataset.permissionGroup);
    if (!key || !group || !target.checked) return;

    const oppositeGroup = group === "granted" ? "revoked" : "granted";
    const oppositeSelector = `input[type="checkbox"][data-permission-group="${oppositeGroup}"][data-permission-key="${key}"]`;
    const oppositeCheckbox = root.querySelector(oppositeSelector);
    if (oppositeCheckbox instanceof HTMLInputElement) {
      oppositeCheckbox.checked = false;
    }
  });

  el.orgForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const orgId = toText(el.orgInput instanceof HTMLInputElement ? el.orgInput.value : "");
    if (!orgId) {
      setFeedback("Introduce un organization_id valido.", "error");
      return;
    }
    state.organizationId = orgId;
    state.organizationSource = "manual";
    try {
      window.localStorage.setItem(ORG_STORAGE_KEY, orgId);
    } catch {
      // no-op
    }
    setOrgSource();
    void loadUsers();
  });

  el.clearBtn?.addEventListener("click", () => {
    if (el.q instanceof HTMLInputElement) el.q.value = "";
    if (el.perPage instanceof HTMLSelectElement) el.perPage.value = "25";
    void loadUsers();
  });

  el.createForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createUser();
  });

  el.form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePermissions();
  });

  readInitialOrganizationId();
  if (el.orgInput instanceof HTMLInputElement) {
    el.orgInput.value = state.organizationId;
  }
  setOrgSource();
  renderPermissionCheckboxes(null);
  void loadUsers();
})();
