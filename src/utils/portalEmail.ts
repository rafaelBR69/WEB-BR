import { asText } from "@/utils/crmPortal";

type PortalApprovalEmailInput = {
  request: Request;
  email: string;
  organizationId: string;
  language?: string | null;
  fullName?: string | null;
  projectPropertyId?: string | null;
  oneTimeCode: string;
};

type PortalApprovalEmailResult = {
  attempted: boolean;
  sent: boolean;
  provider: string | null;
  error: string | null;
  mode?: "template" | "html" | null;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const resolveOrigin = (request: Request) => {
  try {
    return new URL(request.url).origin;
  } catch {
    return "https://www.blancareal.com";
  }
};

const buildActivationUrl = ({
  request,
  organizationId,
  email,
  projectPropertyId,
  language,
}: {
  request: Request;
  organizationId: string;
  email: string;
  projectPropertyId?: string | null;
  language?: string | null;
}) => {
  const lang = asText(language) === "en" ? "en" : "es";
  const url = new URL(`/${lang}/portal/activate/`, resolveOrigin(request));
  url.searchParams.set("organization_id", organizationId);
  url.searchParams.set("email", email);
  if (projectPropertyId) url.searchParams.set("project_property_id", projectPropertyId);
  return url.toString();
};

const buildSpanishMessage = ({
  fullName,
  activationUrl,
  oneTimeCode,
}: {
  fullName: string | null;
  activationUrl: string;
  oneTimeCode: string;
}) => {
  const greeting = fullName ? `Hola ${fullName},` : "Hola,";
  return {
    subject: "BlancaReal ha aprobado tu solicitud de acceso al portal",
    text: [
      greeting,
      "",
      "Te confirmamos que BlancaReal ha aprobado tu solicitud de acceso al portal.",
      "Ya puedes activar tu acceso con el siguiente enlace:",
      activationUrl,
      "",
      `Codigo de un solo uso: ${oneTimeCode}`,
      "",
      "Si necesitas ayuda, responde a este correo.",
      "",
      "Equipo BlancaReal",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#17385b;line-height:1.6">
        <p>${greeting}</p>
        <p>Te confirmamos que <strong>BlancaReal ha aprobado tu solicitud de acceso al portal</strong>.</p>
        <p>Ya puedes activar tu acceso desde este enlace:</p>
        <p><a href="${activationUrl}">${activationUrl}</a></p>
        <p><strong>Codigo de un solo uso:</strong> ${oneTimeCode}</p>
        <p>Si necesitas ayuda, responde a este correo.</p>
        <p>Equipo BlancaReal</p>
      </div>
    `.trim(),
  };
};

const buildEnglishMessage = ({
  fullName,
  activationUrl,
  oneTimeCode,
}: {
  fullName: string | null;
  activationUrl: string;
  oneTimeCode: string;
}) => {
  const greeting = fullName ? `Hello ${fullName},` : "Hello,";
  return {
    subject: "BlancaReal has approved your portal access request",
    text: [
      greeting,
      "",
      "We confirm that BlancaReal has approved your portal access request.",
      "You can now activate your access using the following link:",
      activationUrl,
      "",
      `One-time code: ${oneTimeCode}`,
      "",
      "If you need help, just reply to this email.",
      "",
      "BlancaReal Team",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#17385b;line-height:1.6">
        <p>${greeting}</p>
        <p>We confirm that <strong>BlancaReal has approved your portal access request</strong>.</p>
        <p>You can now activate your access using this link:</p>
        <p><a href="${activationUrl}">${activationUrl}</a></p>
        <p><strong>One-time code:</strong> ${oneTimeCode}</p>
        <p>If you need help, just reply to this email.</p>
        <p>BlancaReal Team</p>
      </div>
    `.trim(),
  };
};

export const sendPortalApprovalEmail = async (
  input: PortalApprovalEmailInput
): Promise<PortalApprovalEmailResult> => {
  const apiKey = asText(import.meta.env.RESEND_API_KEY);
  const from = asText(import.meta.env.PORTAL_EMAIL_FROM) ?? asText(import.meta.env.EMAIL_FROM);
  const replyTo = asText(import.meta.env.PORTAL_EMAIL_REPLY_TO) ?? asText(import.meta.env.EMAIL_REPLY_TO);
  const templateId =
    asText(import.meta.env.RESEND_PORTAL_APPROVAL_TEMPLATE_ID) ??
    asText(import.meta.env.RESEND_TEMPLATE_PORTAL_APPROVAL_ID);

  if (!apiKey || !from) {
    return {
      attempted: false,
      sent: false,
      provider: null,
      error: "portal_email_not_configured",
    };
  }

  const fullName = asText(input.fullName);
  const activationUrl = buildActivationUrl({
    request: input.request,
    organizationId: input.organizationId,
    email: input.email,
    projectPropertyId: input.projectPropertyId,
    language: input.language,
  });
  const message =
    asText(input.language) === "en"
      ? buildEnglishMessage({
          fullName,
          activationUrl,
          oneTimeCode: input.oneTimeCode,
        })
      : buildSpanishMessage({
          fullName,
          activationUrl,
          oneTimeCode: input.oneTimeCode,
        });

  const templateVariables = {
    CONTACT_NAME: fullName ?? "",
    APPROVAL_SUBJECT: message.subject,
    ACTIVATION_URL: activationUrl,
    ONE_TIME_CODE: input.oneTimeCode,
    ORGANIZATION_ID: input.organizationId,
    PROJECT_PROPERTY_ID: input.projectPropertyId ?? "",
    LANGUAGE: asText(input.language) ?? "es",
    BRAND_NAME: "BlancaReal",
  };

  try {
    const sendPayload = async (payload: Record<string, unknown>, mode: "template" | "html") => {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const raw = await response.text();
        return {
          attempted: true,
          sent: false,
          provider: "resend" as const,
          error: raw || `resend_http_${response.status}`,
          mode,
        };
      }

      return {
        attempted: true,
        sent: true,
        provider: "resend",
        error: null,
        mode,
      };
    };

    const basePayload = {
      from,
      to: [input.email],
      reply_to: replyTo ? [replyTo] : undefined,
    };

    if (templateId) {
      const templateAttempt = await sendPayload(
        {
          ...basePayload,
          template: {
            id: templateId,
            variables: templateVariables,
          },
        },
        "template"
      );

      if (templateAttempt.sent) return templateAttempt;

      const htmlAttempt = await sendPayload(
        {
          ...basePayload,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        "html"
      );

      if (htmlAttempt.sent) {
        console.warn("[portal-email] template delivery failed, html fallback sent", {
          email: input.email,
          templateId,
          templateError: templateAttempt.error,
        });
        return htmlAttempt;
      }

      return {
        ...htmlAttempt,
        error: `template_failed:${templateAttempt.error ?? "unknown"} | html_failed:${htmlAttempt.error ?? "unknown"}`,
      };
    }

    return await sendPayload(
      {
        ...basePayload,
        subject: message.subject,
        text: message.text,
        html: message.html,
      },
      "html"
    );
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      provider: "resend",
      error: error instanceof Error ? error.message : String(error),
      mode: templateId ? "template" : "html",
    };
  }
};
