import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";

type QueueMode = "db_queue" | "disabled";

export type EnqueueMediaOptimizeJobResult = {
  enqueued: boolean;
  mode: QueueMode;
  job_id: string | null;
  error: string | null;
};

export type QueueWorkerKickResult = {
  kicked: boolean;
  reason: string | null;
};

let lastKickAtMs = 0;

const toText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
};

const formatSupabaseError = (error: unknown) => {
  if (!error || typeof error !== "object") return "unknown_error";
  const anyError = error as { message?: string; details?: string; hint?: string };
  const message = String(anyError.message ?? "unknown_error");
  const details = anyError.details ? `details=${String(anyError.details)}` : null;
  const hint = anyError.hint ? `hint=${String(anyError.hint)}` : null;
  return [message, details, hint].filter(Boolean).join(" | ");
};

const isQueueEnabled = () => toBoolean(import.meta.env.CRM_MEDIA_OPTIMIZER_QUEUE_ENABLED, true);

const isAutoKickEnabled = () => toBoolean(import.meta.env.CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK, true);

const getAutoKickMaxJobs = () =>
  toPositiveInt(import.meta.env.CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK_MAX_JOBS, 1);

const getAutoKickThrottleMs = () =>
  toPositiveInt(import.meta.env.CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK_THROTTLE_MS, 5000);

const getWorkerScriptPath = () => path.join(process.cwd(), "scripts", "process-media-optimize-queue.mjs");

export const enqueueMediaOptimizeJob = async (
  client: SupabaseClient,
  options: {
    organizationId: string;
    propertyId: string;
    legacyCode?: string | null;
    reason?: string | null;
    priority?: number | null;
    payload?: Record<string, unknown> | null;
  }
): Promise<EnqueueMediaOptimizeJobResult> => {
  if (!isQueueEnabled()) {
    return {
      enqueued: false,
      mode: "disabled",
      job_id: null,
      error: null,
    };
  }

  const priority = toPositiveInt(options.priority ?? 100, 100);
  const payload = options.payload && typeof options.payload === "object" ? options.payload : {};
  const legacyCode = toText(options.legacyCode);
  const reason = toText(options.reason);

  const { data, error } = await client
    .schema("crm")
    .rpc("enqueue_media_optimize_job", {
      p_organization_id: options.organizationId,
      p_property_id: options.propertyId,
      p_legacy_code: legacyCode,
      p_reason: reason,
      p_priority: priority,
      p_payload: payload,
    })
    .maybeSingle();

  if (error) {
    return {
      enqueued: false,
      mode: "db_queue",
      job_id: null,
      error: formatSupabaseError(error),
    };
  }

  return {
    enqueued: Boolean(toText((data as { id?: unknown } | null)?.id)),
    mode: "db_queue",
    job_id: toText((data as { id?: unknown } | null)?.id),
    error: null,
  };
};

export const triggerMediaOptimizeQueueWorker = (
  options: {
    maxJobs?: number;
    maxRuntimeMs?: number;
    force?: boolean;
  } = {}
): QueueWorkerKickResult => {
  if (!isQueueEnabled()) {
    return { kicked: false, reason: "queue_disabled" };
  }
  if (!isAutoKickEnabled()) {
    return { kicked: false, reason: "auto_kick_disabled" };
  }

  const now = Date.now();
  const throttleMs = getAutoKickThrottleMs();
  if (!options.force && now - lastKickAtMs < throttleMs) {
    return { kicked: false, reason: "throttled" };
  }

  const workerScriptPath = getWorkerScriptPath();
  if (!fs.existsSync(workerScriptPath)) {
    return { kicked: false, reason: "worker_script_missing" };
  }

  const maxJobs = toPositiveInt(options.maxJobs, getAutoKickMaxJobs());
  const maxRuntimeMs = toPositiveInt(options.maxRuntimeMs, 90000);
  const args = [
    workerScriptPath,
    "--max-jobs",
    String(maxJobs),
    "--max-runtime-ms",
    String(maxRuntimeMs),
    "--quiet",
  ];

  try {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    lastKickAtMs = now;
    return { kicked: true, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kicked: false, reason: `spawn_failed:${message}` };
  }
};
