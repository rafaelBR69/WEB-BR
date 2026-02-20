import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_MAX_JOBS = 3;
const DEFAULT_MAX_RUNTIME_MS = 120000;
const DEFAULT_JOB_TIMEOUT_MS = 180000;
const BASE_RETRY_DELAY_MS = 30000;
const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;
const DEFAULT_REPORTS_DIR = path.join(ROOT, "scripts", "media-optimizer", "reports");

const HELP_TEXT = `
Procesa en segundo plano la cola de optimizacion de media CRM.

Uso:
  node scripts/process-media-optimize-queue.mjs [opciones]

Opciones:
  --max-jobs <n>            Maximo de jobs a procesar (default: ${DEFAULT_MAX_JOBS})
  --max-runtime-ms <ms>     Tiempo maximo total del worker (default: ${DEFAULT_MAX_RUNTIME_MS})
  --job-timeout-ms <ms>     Timeout por job de optimizacion (default: ${DEFAULT_JOB_TIMEOUT_MS})
  --worker-id <texto>       Identificador del worker
  --quiet                   Salida minima (solo resumen final)
  --help                    Muestra esta ayuda
`.trim();

const parseEnvFile = (absolutePath) => {
  if (!fs.existsSync(absolutePath)) return {};
  const out = {};
  const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (!key) continue;

    const hashIndex = value.indexOf(" #");
    if (hashIndex >= 0) {
      value = value.slice(0, hashIndex).trim();
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
};

const envFromFiles = {
  ...parseEnvFile(path.join(ROOT, ".env")),
  ...parseEnvFile(path.join(ROOT, ".env.local")),
};

const asText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asPositiveInteger = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
};

const asEnv = (key) => asText(process.env[key] ?? envFromFiles[key] ?? null);

const hasFlag = (flagName) => process.argv.includes(`--${flagName}`);

const readArg = (flagName) => {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${flagName}`);
  if (index >= 0) return process.argv[index + 1] || null;
  return null;
};

const formatSupabaseError = (error) => {
  if (!error) return "unknown_error";
  const message = String(error.message ?? "unknown_error");
  const details = error.details ? `details=${String(error.details)}` : null;
  const hint = error.hint ? `hint=${String(error.hint)}` : null;
  return [message, details, hint].filter(Boolean).join(" | ");
};

const ensureDirectory = (absolutePath) => {
  fs.mkdirSync(absolutePath, { recursive: true });
};

const buildQueueReportPath = (jobId) => {
  ensureDirectory(DEFAULT_REPORTS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(DEFAULT_REPORTS_DIR, `media-optimize-queue-${stamp}-${jobId}.json`);
};

const runNodeCommand = (args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.killed) {
        child.kill();
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: 1,
        signal: null,
        stdout,
        stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}`.trim(),
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 0,
        signal: signal ?? null,
        stdout,
        stderr,
        timedOut,
      });
    });
  });

const parseOptimizerStdout = (stdout) => {
  const text = String(stdout ?? "").trim();
  const reportMatch = text.match(/Reporte guardado en:\s*(.+)\s*$/m);
  const reportPath = reportMatch ? reportMatch[1].trim() : null;

  const markerIndex = reportMatch ? text.indexOf(reportMatch[0]) : -1;
  const summaryText = (markerIndex >= 0 ? text.slice(0, markerIndex) : text).trim();

  let summary = null;
  if (summaryText.startsWith("{")) {
    try {
      summary = JSON.parse(summaryText);
    } catch {
      summary = null;
    }
  }

  return { summary, reportPath };
};

const dequeueJob = async (client, workerId) => {
  const { data, error } = await client
    .schema("crm")
    .rpc("dequeue_media_optimize_job", {
      p_worker_id: workerId,
    })
    .maybeSingle();

  if (error) {
    const message = formatSupabaseError(error);
    if (message.toLowerCase().includes("could not find the function")) {
      throw new Error(
        "queue_not_initialized: aplica supabase/sql/005_media_optimize_queue.sql antes de ejecutar el worker"
      );
    }
    throw new Error(`queue_dequeue_failed:${message}`);
  }

  return data ?? null;
};

const updateJob = async (client, jobId, patch) => {
  const { error } = await client
    .schema("crm")
    .from("media_optimize_jobs")
    .update(patch)
    .eq("id", jobId);
  if (error) {
    throw new Error(`queue_update_failed:${formatSupabaseError(error)}`);
  }
};

const calculateRetryDelayMs = (attempts) => {
  const normalizedAttempts = Math.max(1, attempts);
  const exponential = BASE_RETRY_DELAY_MS * 2 ** (normalizedAttempts - 1);
  const capped = Math.min(exponential, MAX_RETRY_DELAY_MS);
  const jitter = Math.floor(Math.random() * 3000);
  return capped + jitter;
};

const processJob = async (client, job, options) => {
  const optimizerScriptPath = path.join(ROOT, "scripts", "optimize-crm-property-media.mjs");
  if (!fs.existsSync(optimizerScriptPath)) {
    throw new Error(`optimizer_script_not_found:${optimizerScriptPath}`);
  }

  const organizationId = asText(job.organization_id);
  const propertyId = asText(job.property_id);
  if (!organizationId || !propertyId) {
    throw new Error("job_missing_organization_or_property_id");
  }

  const reportPath = buildQueueReportPath(String(job.id));
  const args = [
    optimizerScriptPath,
    "--apply",
    "--organization-id",
    organizationId,
    "--property-ids",
    propertyId,
    "--report-file",
    reportPath,
  ];

  const result = await runNodeCommand(args, options.jobTimeoutMs);
  if (result.code !== 0 || result.timedOut) {
    const reason = result.timedOut ? "optimizer_timeout" : `optimizer_exit_code_${result.code}`;
    const detail = [reason, result.stderr, result.stdout]
      .filter((entry) => String(entry ?? "").trim().length > 0)
      .join(" | ")
      .slice(0, 4000);
    throw new Error(detail || reason);
  }

  const parsed = parseOptimizerStdout(result.stdout);
  const nowIso = new Date().toISOString();
  await updateJob(client, String(job.id), {
    status: "completed",
    finished_at: nowIso,
    run_after: null,
    last_error: null,
    last_report_path: parsed.reportPath ?? reportPath,
    last_summary: parsed.summary ?? null,
  });

  return {
    reportPath: parsed.reportPath ?? reportPath,
    summary: parsed.summary ?? null,
  };
};

const markJobFailure = async (client, job, errorMessage) => {
  const attempts = asPositiveInteger(job.attempts) ?? 1;
  const maxAttempts = asPositiveInteger(job.max_attempts) ?? 3;
  const nowIso = new Date().toISOString();
  const retryable = attempts < maxAttempts;

  const patch = retryable
    ? {
        status: "queued",
        run_after: new Date(Date.now() + calculateRetryDelayMs(attempts)).toISOString(),
        finished_at: nowIso,
        last_error: errorMessage.slice(0, 4000),
      }
    : {
        status: "failed",
        run_after: null,
        finished_at: nowIso,
        last_error: errorMessage.slice(0, 4000),
      };

  await updateJob(client, String(job.id), patch);
  return retryable;
};

const run = async () => {
  if (hasFlag("help")) {
    console.log(HELP_TEXT);
    return;
  }

  const maxJobs = asPositiveInteger(readArg("max-jobs")) ?? DEFAULT_MAX_JOBS;
  const maxRuntimeMs = asPositiveInteger(readArg("max-runtime-ms")) ?? DEFAULT_MAX_RUNTIME_MS;
  const jobTimeoutMs = asPositiveInteger(readArg("job-timeout-ms")) ?? DEFAULT_JOB_TIMEOUT_MS;
  const quiet = hasFlag("quiet");
  const workerId =
    asText(readArg("worker-id")) ?? `media-opt-worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

  const supabaseUrl = asEnv("SUPABASE_URL") ?? asEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = asEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const startedAt = Date.now();
  const output = {
    worker_id: workerId,
    max_jobs: maxJobs,
    max_runtime_ms: maxRuntimeMs,
    processed_jobs: 0,
    completed_jobs: 0,
    retried_jobs: 0,
    failed_jobs: 0,
    empty_queue: false,
    elapsed_ms: 0,
    errors: [],
  };

  while (output.processed_jobs < maxJobs) {
    if (Date.now() - startedAt >= maxRuntimeMs) break;

    const job = await dequeueJob(client, workerId);
    if (!job) {
      output.empty_queue = true;
      break;
    }

    output.processed_jobs += 1;
    const jobId = asText(job.id) ?? "(unknown_job)";
    if (!quiet) {
      console.log(`processing_job:${jobId}`);
    }

    try {
      await processJob(client, job, { jobTimeoutMs });
      output.completed_jobs += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = await markJobFailure(client, job, message);
      if (retryable) {
        output.retried_jobs += 1;
      } else {
        output.failed_jobs += 1;
      }
      output.errors.push({
        job_id: jobId,
        retryable,
        error: message,
      });
      if (!quiet) {
        console.error(`job_failed:${jobId} | retryable=${retryable} | ${message}`);
      }
    }
  }

  output.elapsed_ms = Date.now() - startedAt;
  console.log(JSON.stringify(output, null, 2));
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`media_optimize_queue_failed: ${message}`);
  process.exitCode = 1;
});
