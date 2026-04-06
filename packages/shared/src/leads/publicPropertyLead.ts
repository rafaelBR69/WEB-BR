import { asObject, asText } from "@shared/portal/domain";
import { formatPrice } from "@shared/presentation/common";
import {
  getProjectNameFromRow,
  getPropertyDisplayNameFromRow,
  normalizeMediaModel,
} from "@shared/properties/domain";
import {
  DEFAULT_PROPERTY_LEAD_RECIPIENTS,
  getConfiguredPropertyLeadRecipients,
} from "./propertyEmailRouting";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_RX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const SUPPORTED_LANGS = new Set(["es", "en", "de", "fr", "it", "nl"]);
const PROPERTY_LEAD_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "legacy_code",
  "parent_property_id",
  "record_type",
  "operation_type",
  "price_sale",
  "price_rent_monthly",
  "price_currency",
  "media",
  "translations",
  "slugs",
  "property_data",
].join(", ");

export type PropertyLeadEmailSnapshot = {
  propertyLegacyCode: string;
  propertyRecordType: string | null;
  projectLegacyCode: string | null;
  displayName: string;
  coverUrl: string | null;
  price: number | null;
  currency: string;
  publicUrl: string | null;
  lang: string;
};

export type ResolvedPublicPropertyLeadContext = {
  propertyId: string;
  propertyLegacyCode: string;
  propertyRecordType: string | null;
  projectId: string | null;
  projectLegacyCode: string | null;
  projectDisplayName: string | null;
  snapshot: PropertyLeadEmailSnapshot;
  recipients: string[];
  routingSource: "property" | "project" | "fallback";
};

export type PropertyLeadEmailResult = {
  attempted: boolean;
  sent: boolean;
  provider: string | null;
  error: string | null;
  recipientCount: number;
};

const resolveOrigin = (request: Request) => {
  try {
    return new URL(request.url).origin;
  } catch {
    return "https://www.blancareal.com";
  }
};

const normalizeLang = (value: string | null) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return SUPPORTED_LANGS.has(normalized) ? normalized : "es";
};

const asFiniteNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatMessageHtml = (value: string | null) =>
  value ? escapeHtml(value).replace(/\r?\n/g, "<br />") : "Sin mensaje adicional.";

const formatMessageText = (value: string | null) => value ?? "Sin mensaje adicional.";

const resolvePropertyPrice = (row: Record<string, unknown>) => {
  const operationType = asText(row.operation_type);
  const salePrice = asFiniteNumber(row.price_sale);
  const rentPrice = asFiniteNumber(row.price_rent_monthly);

  if (operationType === "rent") return rentPrice;
  if (operationType === "both") return salePrice ?? rentPrice;
  return salePrice;
};

const resolveCoverUrl = (
  propertyRow: Record<string, unknown>,
  projectRow: Record<string, unknown> | null
) => {
  const propertyCover = normalizeMediaModel(propertyRow.media).cover?.url ?? null;
  if (propertyCover) return propertyCover;
  if (!projectRow) return null;
  return normalizeMediaModel(projectRow.media).cover?.url ?? null;
};

const resolveSlug = (row: Record<string, unknown>, lang: string) => {
  const slugs = asObject(row.slugs);
  const langSlug = asText(slugs[lang]);
  if (langSlug) return langSlug;
  const esSlug = asText(slugs.es);
  if (esSlug) return esSlug;
  return Object.values(slugs)
    .map((entry) => asText(entry))
    .find(Boolean) ?? null;
};

const buildPublicUrl = (row: Record<string, unknown>, lang: string, request: Request) => {
  const slug = resolveSlug(row, lang);
  if (!slug) return null;
  return new URL(`/${lang}/property/${slug}/`, resolveOrigin(request)).toString();
};

const cleanRecipients = (values: string[]) =>
  Array.from(
    new Set(
      values
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => EMAIL_RX.test(entry))
    )
  );

const resolveRecipients = (propertyLegacyCode: string | null, projectLegacyCode: string | null) => {
  const propertyRecipients = cleanRecipients(getConfiguredPropertyLeadRecipients(propertyLegacyCode));
  if (propertyRecipients.length > 0) {
    return {
      recipients: propertyRecipients,
      routingSource: "property" as const,
    };
  }

  const projectRecipients = cleanRecipients(getConfiguredPropertyLeadRecipients(projectLegacyCode));
  if (projectRecipients.length > 0) {
    return {
      recipients: projectRecipients,
      routingSource: "project" as const,
    };
  }

  return {
    recipients: DEFAULT_PROPERTY_LEAD_RECIPIENTS,
    routingSource: "fallback" as const,
  };
};

const buildEmailMessage = (input: {
  leadId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  snapshot: PropertyLeadEmailSnapshot;
  projectDisplayName: string | null;
}) => {
  const { snapshot } = input;
  const priceLabel = formatPrice(snapshot.price, snapshot.currency, snapshot.lang);
  const propertyUrlLabel = snapshot.publicUrl ?? "No disponible";
  const projectLabel = input.projectDisplayName ?? snapshot.projectLegacyCode ?? "-";
  const subject = `[Lead web] ${snapshot.displayName} (${snapshot.propertyLegacyCode})`;

  const text = [
    "Nuevo lead web desde ficha de propiedad",
    "",
    `Lead ID: ${input.leadId}`,
    `Propiedad/unidad: ${snapshot.displayName}`,
    `Referencia: ${snapshot.propertyLegacyCode}`,
    `Tipo: ${snapshot.propertyRecordType ?? "-"}`,
    `Proyecto: ${projectLabel}`,
    `Referencia proyecto: ${snapshot.projectLegacyCode ?? "-"}`,
    `Precio: ${priceLabel}`,
    `URL publica: ${propertyUrlLabel}`,
    `Idioma: ${snapshot.lang}`,
    "",
    "Datos del contacto",
    `Nombre: ${input.fullName}`,
    `Email: ${input.email ?? "-"}`,
    `Telefono: ${input.phone ?? "-"}`,
    "",
    "Mensaje",
    formatMessageText(input.message),
  ].join("\n");

  const coverBlock = snapshot.coverUrl
    ? `
        <div style="margin:0 0 20px 0;">
          <img
            src="${escapeHtml(snapshot.coverUrl)}"
            alt="${escapeHtml(snapshot.displayName)}"
            style="display:block;width:100%;max-width:680px;height:auto;border-radius:16px;"
          />
        </div>
      `
    : "";

  const urlBlock = snapshot.publicUrl
    ? `<a href="${escapeHtml(snapshot.publicUrl)}" style="color:#0f4c81;text-decoration:none;font-weight:700;">Abrir ficha publica</a>`
    : '<span style="color:#64748b;">URL publica no disponible</span>';

  const html = `
    <div style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,sans-serif;color:#17324d;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:24px;padding:28px;border:1px solid #dbe4f0;">
        <p style="margin:0 0 16px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8a9ab0;">
          Nuevo lead web
        </p>
        <h1 style="margin:0 0 20px 0;font-size:28px;line-height:1.15;color:#10243b;">
          ${escapeHtml(snapshot.displayName)}
        </h1>
        ${coverBlock}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:0 0 24px 0;">
          <div style="padding:16px;border-radius:16px;background:#f7fafc;border:1px solid #e2e8f0;">
            <strong style="display:block;font-size:12px;text-transform:uppercase;color:#64748b;">Referencia</strong>
            <span style="display:block;margin-top:6px;font-size:16px;color:#10243b;">${escapeHtml(snapshot.propertyLegacyCode)}</span>
          </div>
          <div style="padding:16px;border-radius:16px;background:#f7fafc;border:1px solid #e2e8f0;">
            <strong style="display:block;font-size:12px;text-transform:uppercase;color:#64748b;">Precio</strong>
            <span style="display:block;margin-top:6px;font-size:16px;color:#10243b;">${escapeHtml(priceLabel)}</span>
          </div>
          <div style="padding:16px;border-radius:16px;background:#f7fafc;border:1px solid #e2e8f0;">
            <strong style="display:block;font-size:12px;text-transform:uppercase;color:#64748b;">Tipo</strong>
            <span style="display:block;margin-top:6px;font-size:16px;color:#10243b;">${escapeHtml(
              snapshot.propertyRecordType ?? "-"
            )}</span>
          </div>
          <div style="padding:16px;border-radius:16px;background:#f7fafc;border:1px solid #e2e8f0;">
            <strong style="display:block;font-size:12px;text-transform:uppercase;color:#64748b;">Proyecto</strong>
            <span style="display:block;margin-top:6px;font-size:16px;color:#10243b;">${escapeHtml(projectLabel)}</span>
          </div>
        </div>
        <div style="margin:0 0 24px 0;padding:18px;border-radius:18px;background:#fff7ed;border:1px solid #fed7aa;">
          <strong style="display:block;font-size:13px;text-transform:uppercase;color:#9a3412;">Contacto</strong>
          <p style="margin:10px 0 0 0;line-height:1.7;">
            <strong>Nombre:</strong> ${escapeHtml(input.fullName)}<br />
            <strong>Email:</strong> ${escapeHtml(input.email ?? "-")}<br />
            <strong>Telefono:</strong> ${escapeHtml(input.phone ?? "-")}
          </p>
        </div>
        <div style="margin:0 0 24px 0;padding:18px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0;">
          <strong style="display:block;font-size:13px;text-transform:uppercase;color:#475569;">Mensaje</strong>
          <p style="margin:10px 0 0 0;line-height:1.7;color:#0f172a;">${formatMessageHtml(input.message)}</p>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
          <div style="font-size:13px;color:#64748b;">
            Lead ID: <strong style="color:#10243b;">${escapeHtml(input.leadId)}</strong><br />
            Idioma: <strong style="color:#10243b;">${escapeHtml(snapshot.lang)}</strong>
          </div>
          <div>${urlBlock}</div>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
};

export const resolveDefaultLeadOrganizationId = () => {
  const fromPublic = asText(import.meta.env.PUBLIC_CRM_ORGANIZATION_ID);
  if (fromPublic) return fromPublic;
  return asText(import.meta.env.CRM_ORGANIZATION_ID);
};

export const resolvePublicPropertyLeadContext = async (
  client: any,
  organizationId: string,
  propertyLegacyCode: string,
  lang: string,
  request: Request
): Promise<ResolvedPublicPropertyLeadContext | null> => {
  const normalizedLang = normalizeLang(lang);
  const { data: propertyRow, error: propertyError } = await client
    .schema("crm")
    .from("properties")
    .select(PROPERTY_LEAD_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("legacy_code", propertyLegacyCode)
    .maybeSingle();

  if (propertyError) {
    throw new Error(`db_property_lookup_error:${propertyError.message}`);
  }

  const currentProperty = (propertyRow as Record<string, unknown> | null) ?? null;
  if (!currentProperty) return null;

  const parentId = asText(currentProperty.parent_property_id);
  let projectRow: Record<string, unknown> | null = null;
  if (parentId) {
    const { data: parentProperty, error: parentError } = await client
      .schema("crm")
      .from("properties")
      .select(PROPERTY_LEAD_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", parentId)
      .maybeSingle();

    if (parentError) {
      throw new Error(`db_parent_property_lookup_error:${parentError.message}`);
    }

    projectRow = (parentProperty as Record<string, unknown> | null) ?? null;
  } else if (asText(currentProperty.record_type) === "project") {
    projectRow = currentProperty;
  }

  const snapshot: PropertyLeadEmailSnapshot = {
    propertyLegacyCode: asText(currentProperty.legacy_code) ?? propertyLegacyCode,
    propertyRecordType: asText(currentProperty.record_type),
    projectLegacyCode:
      projectRow && projectRow !== currentProperty
        ? asText(projectRow.legacy_code)
        : asText(projectRow?.legacy_code),
    displayName: getPropertyDisplayNameFromRow(currentProperty) ?? propertyLegacyCode,
    coverUrl: resolveCoverUrl(currentProperty, projectRow),
    price: resolvePropertyPrice(currentProperty),
    currency: asText(currentProperty.price_currency) ?? "EUR",
    publicUrl: buildPublicUrl(currentProperty, normalizedLang, request),
    lang: normalizedLang,
  };

  const projectLegacyCode =
    projectRow && projectRow !== currentProperty
      ? asText(projectRow.legacy_code)
      : asText(projectRow?.legacy_code);
  const recipientResolution = resolveRecipients(snapshot.propertyLegacyCode, projectLegacyCode);

  return {
    propertyId: asText(currentProperty.id) ?? "",
    propertyLegacyCode: snapshot.propertyLegacyCode,
    propertyRecordType: snapshot.propertyRecordType,
    projectId: projectRow ? asText(projectRow.id) : null,
    projectLegacyCode,
    projectDisplayName: projectRow ? getProjectNameFromRow(projectRow) ?? getPropertyDisplayNameFromRow(projectRow) : null,
    snapshot,
    recipients: recipientResolution.recipients,
    routingSource: recipientResolution.routingSource,
  };
};

export const sendPropertyLeadNotificationEmail = async (input: {
  request: Request;
  to: string[];
  leadId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  snapshot: PropertyLeadEmailSnapshot;
  projectDisplayName: string | null;
}): Promise<PropertyLeadEmailResult> => {
  const recipients = cleanRecipients(input.to);
  const apiKey = asText(import.meta.env.RESEND_API_KEY);
  const from = asText(import.meta.env.PORTAL_EMAIL_FROM) ?? asText(import.meta.env.EMAIL_FROM);
  const fallbackReplyTo = asText(import.meta.env.PORTAL_EMAIL_REPLY_TO) ?? asText(import.meta.env.EMAIL_REPLY_TO);
  const replyTo = input.email ?? fallbackReplyTo;

  if (!apiKey || !from || recipients.length === 0) {
    return {
      attempted: false,
      sent: false,
      provider: null,
      error: "property_lead_email_not_configured",
      recipientCount: recipients.length,
    };
  }

  const message = buildEmailMessage(input);
  const errors: string[] = [];
  let sentCount = 0;

  try {
    for (const recipient of recipients) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          reply_to: replyTo ? [replyTo] : undefined,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        errors.push(`${recipient}: ${raw || `resend_http_${response.status}`}`);
        continue;
      }

      sentCount += 1;
    }

    return {
      attempted: true,
      sent: sentCount > 0,
      provider: "resend",
      error: errors.length > 0 ? errors.join(" | ") : null,
      recipientCount: recipients.length,
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      provider: "resend",
      error: error instanceof Error ? error.message : String(error),
      recipientCount: recipients.length,
    };
  }
};
