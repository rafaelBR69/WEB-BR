(() => {
  const normalizeValue = (value) => String(value ?? "").trim().toLowerCase();

  const dictionaries = {
    "crm-role": {
      owner: "Propietario",
      admin: "Administrador",
      agent: "Agente",
      finance: "Finanzas",
      legal: "Legal",
      viewer: "Solo lectura",
    },
    "crm-permission": {
      "crm.dashboard.view": "Ver dashboard",
      "crm.profile.view": "Ver perfil",
      "crm.leads.read": "Leer leads",
      "crm.leads.write": "Editar leads",
      "crm.properties.read": "Leer propiedades",
      "crm.properties.write": "Editar propiedades",
      "crm.clients.read": "Leer clientes",
      "crm.clients.write": "Editar clientes",
      "crm.portal.read": "Leer portal",
      "crm.portal.write": "Editar portal",
      "crm.documents.manage": "Gestionar documentos",
      "crm.notifications.read": "Leer notificaciones",
      "crm.notifications.write": "Editar notificaciones",
      "crm.contracts.read": "Leer contratos",
      "crm.contracts.write": "Editar contratos",
      "crm.invoices.read": "Leer facturas",
      "crm.invoices.write": "Editar facturas",
      "crm.users.manage": "Gestionar usuarios y permisos",
    },
    "portal-role": {
      portal_agent_admin: "Agente admin",
      portal_agent_member: "Agente comercial",
      portal_client: "Cliente portal",
    },
    "invite-type": {
      agent: "Agente",
      client: "Cliente",
    },
    "portal-status": {
      pending: "Pendiente",
      active: "Activa",
      blocked: "Bloqueada",
      revoked: "Revocada",
      paused: "Pausada",
      used: "Usada",
      expired: "Expirada",
      requested: "Solicitada",
      confirmed: "Confirmada",
      declined: "Rechazada",
      done: "Realizada",
      no_show: "No asistio",
      cancelled: "Cancelada",
      approved: "Aprobada",
      paid: "Pagada",
      failed: "Fallida",
      sent: "Enviada",
      scheduled: "Programada",
      draft: "Borrador",
    },
    "invite-status": {
      request_pending: "Solicitud de alta",
      pending: "Pendiente",
      used: "Usada",
      expired: "Expirada",
      revoked: "Revocada",
      blocked: "Bloqueada",
    },
    "registration-approval": {
      requested: "Pendiente revision",
      approved: "Aprobada",
      rejected_duplicate: "Rechazada (duplicada)",
      rejected: "Rechazada",
    },
    "membership-scope": {
      read: "Solo lectura",
      read_write: "Lectura y edicion",
      full: "Acceso completo",
    },
    audience: {
      agent: "Agente",
      client: "Cliente",
      both: "Ambos",
    },
    "portal-visibility": {
      agent: "Agency Kit (agentes)",
      client: "Client Kit (clientes)",
      both: "Shared Kit (ambos)",
      crm_only: "Solo CRM",
    },
    "visit-status": {
      requested: "Solicitada",
      confirmed: "Confirmada",
      declined: "Rechazada",
      done: "Realizada",
      no_show: "No asistio",
      cancelled: "Cancelada",
    },
    "commission-status": {
      pending: "Pendiente",
      approved: "Aprobada",
      paid: "Pagada",
      cancelled: "Cancelada",
    },
    "commission-type": {
      fixed: "Importe fijo",
      percent: "Porcentaje",
    },
    "notification-type": {
      in_app_message: "Mensaje in-app",
      email_outreach: "Correo comercial",
      lead_follow_up: "Seguimiento de lead",
      call_reminder: "Recordatorio de llamada",
      system_alert: "Aviso de sistema",
    },
    "notification-channel": {
      in_app: "In-app",
      email: "Email",
      whatsapp: "WhatsApp",
      phone: "Llamada",
    },
    "notification-priority": {
      low: "Baja",
      normal: "Normal",
      high: "Alta",
      urgent: "Urgente",
    },
    "notification-status": {
      pending: "Pendiente",
      scheduled: "Programada",
      sent: "Enviada",
      done: "Completada",
      cancelled: "Cancelada",
      failed: "Fallida",
    },
    publication: {
      published: "Publicado",
      draft: "Borrador",
      hidden: "Oculto",
    },
    "log-event-type": {
      invite_sent: "Invite enviada",
      invite_revoked: "Invite revocada",
      signup_ok: "Alta validada",
      signup_fail: "Alta rechazada",
      login_ok: "Login correcto",
      login_fail: "Login fallido",
      code_fail: "Codigo fallido",
      blocked: "Cuenta bloqueada",
      logout: "Cierre de sesion",
      visit_confirmed: "Visita confirmada",
      commission_updated: "Comision actualizada",
      document_downloaded: "Documento descargado",
    },
  };

  const genericByValue = Object.values(dictionaries).reduce((acc, map) => {
    Object.entries(map).forEach(([key, value]) => {
      const normalizedKey = normalizeValue(key);
      if (!normalizedKey) return;
      if (!acc[normalizedKey]) acc[normalizedKey] = value;
    });
    return acc;
  }, {});

  const getDictionary = (name) => {
    const normalizedName = normalizeValue(name);
    if (!normalizedName) return null;
    return dictionaries[normalizedName] ?? null;
  };

  const label = (dictionaryName, value, fallback = null) => {
    const normalizedValue = normalizeValue(value);
    if (!normalizedValue) return fallback;

    const dictionary = getDictionary(dictionaryName);
    if (dictionary && dictionary[normalizedValue]) return dictionary[normalizedValue];
    if (genericByValue[normalizedValue]) return genericByValue[normalizedValue];
    return fallback ?? String(value);
  };

  const labelAny = (value, fallback = null) => {
    const normalizedValue = normalizeValue(value);
    if (!normalizedValue) return fallback;
    return genericByValue[normalizedValue] ?? fallback ?? String(value);
  };

  const shouldReplaceOptionLabel = (option, optionValue) => {
    const currentText = String(option.textContent ?? "").trim();
    if (!currentText) return true;
    const normalizedText = normalizeValue(currentText);
    if (!normalizedText) return true;
    if (normalizedText === optionValue) return true;
    if (currentText === "-") return true;
    return false;
  };

  const applySelectDictionary = (select, dictionaryName = null) => {
    if (!(select instanceof HTMLSelectElement)) return;
    const dictionary = getDictionary(dictionaryName ?? select.dataset.dictionary ?? "");
    const force = select.hasAttribute("data-dictionary-force");

    Array.from(select.options).forEach((option) => {
      const optionValue = normalizeValue(option.value);
      if (!optionValue) return;

      const resolvedLabel =
        (dictionary && dictionary[optionValue]) ||
        (!dictionary ? genericByValue[optionValue] : null);

      if (!resolvedLabel) return;
      if (force || shouldReplaceOptionLabel(option, optionValue)) {
        option.textContent = resolvedLabel;
      }
    });
  };

  const applySelectDictionaries = (root = document) => {
    if (!(root instanceof Document || root instanceof Element)) return;
    const selects = root.querySelectorAll("select");
    selects.forEach((select) => applySelectDictionary(select));
  };

  window.crmLabels = {
    getDictionary,
    label,
    labelAny,
    applySelectDictionary,
    applySelectDictionaries,
  };
})();
