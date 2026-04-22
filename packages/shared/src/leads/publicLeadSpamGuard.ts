import { asObject, asText } from "../portal/domain";
import {
  normalizeEmail,
  normalizeLeadKind,
  normalizeOperationInterest,
  normalizePhone,
} from "./domain";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const WEBSITE_FORMS = ["contact", "sell-with-us", "property"] as const;
const ALLOWED_FIELDS = new Set([
  "full_name",
  "email",
  "phone",
  "consent",
  "lang",
  "source",
  "lead_kind",
  "operation_interest",
  "property_legacy_code",
  "message",
  "website_form",
  "hp_field",
  "form_rendered_at",
  "turnstile_token",
]);
const CONSONANT_RUN_RX = /[bcdfghjklmnpqrstvwxyz]{5,}/i;
const RANDOMISH_TOKEN_RX = /^[a-z0-9]+$/i;
const normalizeAscii = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const PUBLIC_LEAD_TEXT_LIMITS = {
  full_name: 120,
  email: 160,
  phone: 50,
  source: 120,
  message: 4000,
} as const;

export const PUBLIC_LEAD_MIN_RENDER_MS = 4000;
export const PUBLIC_LEAD_STATUS_VALUES = ["blocked", "junk", "new"] as const;

export type PublicLeadWebsiteForm = (typeof WEBSITE_FORMS)[number];
export type PublicLeadVerdict = (typeof PUBLIC_LEAD_STATUS_VALUES)[number];

export type ParsedPublicLeadBody = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  consent: boolean;
  lang: string | null;
  source: string;
  leadKind: string;
  operationInterest: string;
  propertyLegacyCode: string | null;
  message: string | null;
  websiteForm: PublicLeadWebsiteForm;
  hpField: string | null;
  formRenderedAt: string | null;
  turnstileToken: string | null;
};

export type ParsedPublicLeadBodyResult =
  | {
      ok: true;
      data: ParsedPublicLeadBody;
    }
  | {
      ok: false;
      error: string;
    };

export type PublicLeadTechnicalGuardResult = {
  blocked: boolean;
  reasons: string[];
  renderMs: number | null;
  turnstileOk: boolean;
};

export type PublicLeadContentGuardResult = {
  verdict: "junk" | "new";
  reasons: string[];
  score: number;
  hasPrimarySignal: boolean;
};

export type PublicLeadTurnstileVerificationResult = {
  ok: boolean;
  turnstileOk: boolean;
  bypassed: boolean;
  reason: string | null;
};

const sanitizeTextField = (
  source: Record<string, unknown>,
  key: string,
  maxLength?: number
): { ok: true; value: string | null } | { ok: false; error: string } => {
  if (!(key in source) || source[key] == null) {
    return { ok: true, value: null };
  }

  const raw = source[key];
  if (typeof raw !== "string") {
    return { ok: false, error: `invalid_${key}` };
  }

  const trimmed = raw.trim();
  if (!trimmed.length) {
    return { ok: true, value: null };
  }

  if (typeof maxLength === "number" && trimmed.length > maxLength) {
    return { ok: false, error: `${key}_too_long` };
  }

  return { ok: true, value: trimmed };
};

const countCaseTransitions = (value: string) => {
  let transitions = 0;
  let previousKind = "";

  for (const char of value) {
    if (!/[a-z]/i.test(char)) continue;
    const currentKind = char === char.toUpperCase() ? "upper" : "lower";
    if (previousKind && previousKind !== currentKind) transitions += 1;
    previousKind = currentKind;
  }

  return transitions;
};

const countDigits = (value: string) => value.replace(/\D/g, "").length;

const countVowels = (value: string) =>
  Array.from(normalizeAscii(value)).reduce((total, char) => (/[aeiou]/i.test(char) ? total + 1 : total), 0);

const hasSingleTokenLongMixedCase = (fullName: string) => {
  const tokens = fullName.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) return false;

  const token = tokens[0];
  if (token.length < 12) return false;
  if (!/[a-z]/.test(token) || !/[A-Z]/.test(token)) return false;

  return countCaseTransitions(token) >= 3;
};

const hasImprobableConsonantRun = (value: string) => {
  const compact = value.replace(/[^a-z]/gi, "");
  if (compact.length < 8) return false;
  return CONSONANT_RUN_RX.test(compact);
};

const hasExcessiveCaseTransitions = (value: string) => {
  const compact = value.replace(/[^a-z]/gi, "");
  if (compact.length < 10) return false;
  return countCaseTransitions(compact) >= 4;
};

const hasRandomShortMessage = (message: string) => {
  const compact = message.replace(/\s+/g, "");
  if (compact.length < 10 || compact.length > 40) return false;
  if (!RANDOMISH_TOKEN_RX.test(compact)) return false;

  return (
    !/\s/.test(message) &&
    (hasImprobableConsonantRun(compact) || hasExcessiveCaseTransitions(compact) || countVowels(compact) <= 2)
  );
};

const hasArtificialEmailAlias = (email: string) => {
  const alias = email.split("@")[0] ?? "";
  if (alias.length < 10) return false;
  if (!RANDOMISH_TOKEN_RX.test(alias.replace(/[._-]/g, ""))) return false;

  const separatorless = alias.replace(/[._-]/g, "");
  return (
    countDigits(alias) >= 3 ||
    hasImprobableConsonantRun(separatorless) ||
    (!/[._-]/.test(alias) && countVowels(separatorless) <= 2)
  );
};

export const PUBLIC_LEAD_WEBSITE_FORMS = WEBSITE_FORMS;

export const resolveDefaultPublicLeadSource = (websiteForm: PublicLeadWebsiteForm) => {
  if (websiteForm === "contact") return "website_contact_form";
  if (websiteForm === "sell-with-us") return "website_sell_with_us_form";
  return "website_property_schedule_visit";
};

export const resolvePublicLeadTurnstileConfig = () => {
  const siteKey = asText(import.meta.env.PUBLIC_TURNSTILE_SITE_KEY);
  const secretKey = asText(import.meta.env.TURNSTILE_SECRET_KEY);
  const bypassedInDev = import.meta.env.DEV === true && (!siteKey || !secretKey);

  return {
    siteKey,
    secretKey,
    bypassedInDev,
    required: !bypassedInDev,
  };
};

export const parsePublicLeadBody = (body: unknown): ParsedPublicLeadBodyResult => {
  const source = asObject(body);

  for (const key of Object.keys(source)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: `unexpected_field_${key}` };
    }
  }

  const websiteFormRaw = asText(source.website_form);
  const websiteForm = WEBSITE_FORMS.find((entry) => entry === websiteFormRaw);
  if (!websiteForm) {
    return { ok: false, error: "invalid_website_form" };
  }

  if ("consent" in source && typeof source.consent !== "boolean") {
    return { ok: false, error: "invalid_consent" };
  }

  const fullNameField = sanitizeTextField(source, "full_name", PUBLIC_LEAD_TEXT_LIMITS.full_name);
  if (!fullNameField.ok) return fullNameField;

  const emailField = sanitizeTextField(source, "email", PUBLIC_LEAD_TEXT_LIMITS.email);
  if (!emailField.ok) return emailField;

  const phoneField = sanitizeTextField(source, "phone", PUBLIC_LEAD_TEXT_LIMITS.phone);
  if (!phoneField.ok) return phoneField;

  const langField = sanitizeTextField(source, "lang", 16);
  if (!langField.ok) return langField;

  const sourceField = sanitizeTextField(source, "source", PUBLIC_LEAD_TEXT_LIMITS.source);
  if (!sourceField.ok) return sourceField;

  const leadKindField = sanitizeTextField(source, "lead_kind", 32);
  if (!leadKindField.ok) return leadKindField;

  const operationField = sanitizeTextField(source, "operation_interest", 32);
  if (!operationField.ok) return operationField;

  const propertyField = sanitizeTextField(source, "property_legacy_code", 120);
  if (!propertyField.ok) return propertyField;

  const messageField = sanitizeTextField(source, "message", PUBLIC_LEAD_TEXT_LIMITS.message);
  if (!messageField.ok) return messageField;

  const honeypotField = sanitizeTextField(source, "hp_field", 255);
  if (!honeypotField.ok) return honeypotField;

  const renderedAtField = sanitizeTextField(source, "form_rendered_at", 64);
  if (!renderedAtField.ok) return renderedAtField;

  const turnstileTokenField = sanitizeTextField(source, "turnstile_token", 4096);
  if (!turnstileTokenField.ok) return turnstileTokenField;

  const defaultLeadKind = websiteForm === "sell-with-us" ? "seller" : "buyer";
  const defaultOperation = websiteForm === "contact" ? "both" : "sale";

  return {
    ok: true,
    data: {
      fullName: fullNameField.value,
      email: normalizeEmail(emailField.value),
      phone: normalizePhone(phoneField.value),
      consent: source.consent === true,
      lang: langField.value,
      source: sourceField.value ?? resolveDefaultPublicLeadSource(websiteForm),
      leadKind: normalizeLeadKind(leadKindField.value, defaultLeadKind),
      operationInterest: normalizeOperationInterest(operationField.value, defaultOperation),
      propertyLegacyCode: propertyField.value,
      message: messageField.value,
      websiteForm,
      hpField: honeypotField.value,
      formRenderedAt: renderedAtField.value,
      turnstileToken: turnstileTokenField.value,
    },
  };
};

export const verifyPublicLeadTurnstile = async (input: {
  token: string | null;
  ip: string | null;
}): Promise<PublicLeadTurnstileVerificationResult> => {
  const config = resolvePublicLeadTurnstileConfig();
  if (config.bypassedInDev) {
    return {
      ok: true,
      turnstileOk: true,
      bypassed: true,
      reason: null,
    };
  }

  if (!config.secretKey || !config.siteKey) {
    return {
      ok: false,
      turnstileOk: false,
      bypassed: false,
      reason: "turnstile_not_configured",
    };
  }

  if (!input.token) {
    return {
      ok: false,
      turnstileOk: false,
      bypassed: false,
      reason: "turnstile_missing",
    };
  }

  try {
    const formData = new URLSearchParams({
      secret: config.secretKey,
      response: input.token,
    });
    if (input.ip) {
      formData.set("remoteip", input.ip);
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      return {
        ok: false,
        turnstileOk: false,
        bypassed: false,
        reason: `turnstile_http_${response.status}`,
      };
    }

    const payload = (await response.json().catch(() => null)) as
      | { success?: boolean; "error-codes"?: string[] }
      | null;

    if (payload?.success === true) {
      return {
        ok: true,
        turnstileOk: true,
        bypassed: false,
        reason: null,
      };
    }

    const firstError = Array.isArray(payload?.["error-codes"]) ? payload?.["error-codes"]?.[0] : null;
    return {
      ok: false,
      turnstileOk: false,
      bypassed: false,
      reason: firstError ? `turnstile_${firstError}` : "turnstile_failed",
    };
  } catch {
    return {
      ok: false,
      turnstileOk: false,
      bypassed: false,
      reason: "turnstile_request_failed",
    };
  }
};

export const evaluatePublicLeadTechnicalGuard = async (input: {
  payload: ParsedPublicLeadBody;
  ip: string | null;
  nowMs?: number;
}): Promise<PublicLeadTechnicalGuardResult> => {
  const reasons: string[] = [];
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  let renderMs: number | null = null;

  if (input.payload.hpField) {
    reasons.push("honeypot_filled");
  }

  if (!input.payload.formRenderedAt) {
    reasons.push("form_rendered_at_missing");
  } else {
    const renderedAtMs = Date.parse(input.payload.formRenderedAt);
    if (!Number.isFinite(renderedAtMs)) {
      reasons.push("form_rendered_at_invalid");
    } else {
      renderMs = Math.max(0, nowMs - renderedAtMs);
      if (nowMs < renderedAtMs || renderMs < PUBLIC_LEAD_MIN_RENDER_MS) {
        reasons.push("form_submitted_too_fast");
      }
    }
  }

  if (reasons.length > 0) {
    return {
      blocked: true,
      reasons,
      renderMs,
      turnstileOk: false,
    };
  }

  const turnstile = await verifyPublicLeadTurnstile({
    token: input.payload.turnstileToken,
    ip: input.ip,
  });

  if (!turnstile.ok) {
    return {
      blocked: true,
      reasons: [turnstile.reason ?? "turnstile_failed"],
      renderMs,
      turnstileOk: false,
    };
  }

  return {
    blocked: false,
    reasons: [],
    renderMs,
    turnstileOk: true,
  };
};

export const classifyPublicLeadContent = (input: {
  fullName: string | null;
  email: string | null;
  message: string | null;
}): PublicLeadContentGuardResult => {
  let score = 0;
  let hasPrimarySignal = false;
  const reasons: string[] = [];

  const addSignal = (reason: string, primary = false) => {
    if (reasons.includes(reason)) return;
    reasons.push(reason);
    score += 1;
    if (primary) hasPrimarySignal = true;
  };

  if (input.fullName) {
    if (hasSingleTokenLongMixedCase(input.fullName)) {
      addSignal("name_single_token_mixed_case", true);
    }
    if (hasImprobableConsonantRun(input.fullName)) {
      addSignal("name_improbable_consonant_run", true);
    }
    if (hasExcessiveCaseTransitions(input.fullName)) {
      addSignal("name_case_transitions_excessive", true);
    }
  }

  if (input.message && hasRandomShortMessage(input.message)) {
    addSignal("message_random_short", true);
  }

  if (input.email && hasArtificialEmailAlias(input.email)) {
    addSignal("email_alias_artificial", false);
  }

  if (score >= 2 && hasPrimarySignal) {
    return {
      verdict: "junk",
      reasons,
      score,
      hasPrimarySignal,
    };
  }

  return {
    verdict: "new",
    reasons: [],
    score,
    hasPrimarySignal,
  };
};
