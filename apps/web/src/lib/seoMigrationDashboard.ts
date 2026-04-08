import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationTaskRow = {
  sequence: string;
  phase: string;
  task_id: string;
  workstream: string;
  priority: string;
  status: string;
  scope_count: string;
  task: string;
  why_it_matters: string;
  input_files: string;
  output_files: string;
  depends_on: string;
  owner: string;
  success_criteria: string;
  notes: string;
};

export type LegacyRedirectRow = {
  old_url: string;
  old_path: string;
  detected_lang: string;
  old_type: string;
  matched_new_url: string;
  matched_new_type: string;
  redirect_type: string;
  migration_status: string;
  confidence: string;
  notes: string;
};

export type LegacyGapActionRow = {
  old_url: string;
  old_type: string;
  current_target: string;
  current_target_type: string;
  gap_type: string;
  priority_band: string;
  action_owner: string;
  action_type: string;
  implementation_decision: string;
  seo_risk: string;
  rationale: string;
};

export type LegacyContentGapRow = {
  old_url: string;
  old_type: string;
  current_target: string;
  current_target_type: string;
  target_index_status: string;
  gap_type: string;
  recommended_action: string;
  notes: string;
};

export type SeoAuditRow = {
  new_url: string;
  lang: string;
  url_type: string;
  index_status: string;
  included_in_current_sitemap: string;
  canonical_target: string;
  source: string;
  entity_id: string;
  entity_slug: string;
  old_url: string;
  redirect_target: string;
  redirect_type: string;
  migration_status: string;
  priority: string;
  notes: string;
};

export type CountStat = {
  key: string;
  label: string;
  count: number;
};

export type CsvDataset<T> = {
  fileName: string;
  rows: T[];
  error: string | null;
};

export type SeoMigrationDashboardData = {
  generatedAt: string;
  summary: {
    tasksTotal: number;
    phasesTotal: number;
    criticalTasks: number;
    legacyUrlCount: number;
    safeRedirectCount: number;
    mergeToParentCount: number;
    manualDecisionCount: number;
    gapActionCount: number;
    auditUrlCount: number;
  };
  datasets: {
    tasks: CsvDataset<MigrationTaskRow>;
    redirects: CsvDataset<LegacyRedirectRow>;
    gapActions: CsvDataset<LegacyGapActionRow>;
    contentGaps: CsvDataset<LegacyContentGapRow>;
    audit: CsvDataset<SeoAuditRow>;
  };
  taskPhaseCounts: CountStat[];
  taskPriorityCounts: CountStat[];
  redirectTypeCounts: CountStat[];
  safeRedirectBuckets: CountStat[];
  manualReviewRows: LegacyRedirectRow[];
  gapTypeCounts: CountStat[];
  contentGapTargetTypeCounts: CountStat[];
  auditLangCounts: CountStat[];
  auditIndexStatusCounts: CountStat[];
  auditUrlTypeCounts: CountStat[];
  availableDatasets: string[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

const FILES = {
  tasks: "seo_migration_master_task_plan.csv",
  redirects: "seo_url_legacy_redirect_map.csv",
  gapActions: "seo_url_legacy_gap_action_plan.csv",
  contentGaps: "seo_url_legacy_content_gaps.csv",
  audit: "seo_url_audit_master.csv",
} as const;

const labelMaps = {
  priority: {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
  },
  redirectType: {
    exact_match: "Exact match",
    mapped_equivalent: "Mapped equivalent",
    merge_to_parent: "Merge to parent",
    needs_manual_decision: "Needs manual decision",
  },
  gapType: {
    target_currently_noindex: "Target currently noindex",
    content_missing_exact_equivalent: "Content missing exact equivalent",
  },
  targetType: {
    core: "Core",
    post_index: "Posts index",
    property_landing: "Property landing",
  },
  indexStatus: {
    indexable: "Indexable",
    noindex: "Noindex",
    excluded_public: "Excluded public",
    canonical_redirect: "Canonical redirect",
  },
} as const;

const humanizeKey = (value: string) =>
  String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const countBy = <T>(
  items: T[],
  getKey: (item: T) => string,
  options: {
    order?: string[];
    labelMap?: Record<string, string>;
  } = {},
): CountStat[] => {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = String(getKey(item) ?? "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const orderedKeys = options.order?.filter((key) => counts.has(key)) ?? [];
  const remainingKeys = Array.from(counts.keys())
    .filter((key) => !orderedKeys.includes(key))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));

  return [...orderedKeys, ...remainingKeys].map((key) => ({
    key,
    label: options.labelMap?.[key] ?? humanizeKey(key),
    count: counts.get(key) ?? 0,
  }));
};

const normalizeCell = (value: string) =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();

const parseCsv = (rawText: string): string[][] => {
  const text = rawText.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (insideQuotes && nextChar === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "," && !insideQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows
    .map((row) => row.map(normalizeCell))
    .filter((row) => row.some((cell) => cell !== ""));
};

const toObjects = <T extends Record<string, string>>(rawText: string): T[] => {
  const [headerRow, ...dataRows] = parseCsv(rawText);

  if (!headerRow || headerRow.length === 0) {
    throw new Error("CSV sin cabeceras");
  }

  return dataRows.map((row) => {
    const record: Record<string, string> = {};

    for (let index = 0; index < headerRow.length; index += 1) {
      record[headerRow[index]] = row[index] ?? "";
    }

    return record as T;
  });
};

const loadDataset = async <T extends Record<string, string>>(fileName: string): Promise<CsvDataset<T>> => {
  try {
    const filePath = path.join(repoRoot, fileName);
    const rawText = await readFile(filePath, "utf8");
    const rows = toObjects<T>(rawText);
    return { fileName, rows, error: null };
  } catch (error) {
    return {
      fileName,
      rows: [],
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
};

let dashboardPromise: Promise<SeoMigrationDashboardData> | null = null;

export const getSeoMigrationDashboardData = async (): Promise<SeoMigrationDashboardData> => {
  if (!dashboardPromise) {
    dashboardPromise = loadSeoMigrationDashboardData();
  }

  return dashboardPromise;
};

const loadSeoMigrationDashboardData = async (): Promise<SeoMigrationDashboardData> => {
  const [tasks, redirects, gapActions, contentGaps, audit] = await Promise.all([
    loadDataset<MigrationTaskRow>(FILES.tasks),
    loadDataset<LegacyRedirectRow>(FILES.redirects),
    loadDataset<LegacyGapActionRow>(FILES.gapActions),
    loadDataset<LegacyContentGapRow>(FILES.contentGaps),
    loadDataset<SeoAuditRow>(FILES.audit),
  ]);

  const sortedTasks = [...tasks.rows].sort(
    (left, right) => Number(left.sequence || 0) - Number(right.sequence || 0),
  );
  const taskPhaseCounts = countBy(sortedTasks, (row) => row.phase);
  const taskPriorityCounts = countBy(sortedTasks, (row) => row.priority, {
    order: ["critical", "high", "medium", "low"],
    labelMap: labelMaps.priority,
  });

  const redirectRows = [...redirects.rows];
  const redirectTypeCounts = countBy(redirectRows, (row) => row.migration_status, {
    order: ["exact_match", "mapped_equivalent", "merge_to_parent", "needs_manual_decision"],
    labelMap: labelMaps.redirectType,
  });
  const safeRedirectBuckets = redirectTypeCounts.filter(
    (item) => item.key === "exact_match" || item.key === "mapped_equivalent",
  );
  const manualReviewRows = redirectRows
    .filter(
      (row) =>
        row.migration_status === "merge_to_parent" ||
        row.migration_status === "needs_manual_decision",
    )
    .sort((left, right) => {
      const leftWeight = left.migration_status === "needs_manual_decision" ? 0 : 1;
      const rightWeight = right.migration_status === "needs_manual_decision" ? 0 : 1;
      return leftWeight - rightWeight || left.old_url.localeCompare(right.old_url);
    });

  const gapTypeCounts = countBy(gapActions.rows, (row) => row.gap_type, {
    order: ["target_currently_noindex", "content_missing_exact_equivalent"],
    labelMap: labelMaps.gapType,
  });
  const contentGapTargetTypeCounts = countBy(contentGaps.rows, (row) => row.current_target_type, {
    labelMap: labelMaps.targetType,
  });
  const auditLangCounts = countBy(audit.rows, (row) => row.lang, {
    order: ["es", "en", "de", "fr", "it", "nl", "global"],
  });
  const auditIndexStatusCounts = countBy(audit.rows, (row) => row.index_status, {
    order: ["indexable", "noindex", "excluded_public", "canonical_redirect"],
    labelMap: labelMaps.indexStatus,
  });
  const auditUrlTypeCounts = countBy(audit.rows, (row) => row.url_type);

  const criticalTasks =
    taskPriorityCounts.find((item) => item.key === "critical")?.count ?? 0;
  const mergeToParentCount =
    redirectTypeCounts.find((item) => item.key === "merge_to_parent")?.count ?? 0;
  const manualDecisionCount =
    redirectTypeCounts.find((item) => item.key === "needs_manual_decision")?.count ?? 0;
  const safeRedirectCount = safeRedirectBuckets.reduce((sum, item) => sum + item.count, 0);

  const availableDatasets = [tasks, redirects, gapActions, contentGaps, audit]
    .filter((dataset) => !dataset.error)
    .map((dataset) => dataset.fileName);

  return {
    generatedAt: new Intl.DateTimeFormat("es-ES", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Europe/Madrid",
    }).format(new Date()),
    summary: {
      tasksTotal: sortedTasks.length,
      phasesTotal: taskPhaseCounts.length,
      criticalTasks,
      legacyUrlCount: redirectRows.length,
      safeRedirectCount,
      mergeToParentCount,
      manualDecisionCount,
      gapActionCount: gapActions.rows.length,
      auditUrlCount: audit.rows.length,
    },
    datasets: {
      tasks: { ...tasks, rows: sortedTasks },
      redirects,
      gapActions,
      contentGaps,
      audit,
    },
    taskPhaseCounts,
    taskPriorityCounts,
    redirectTypeCounts,
    safeRedirectBuckets,
    manualReviewRows,
    gapTypeCounts,
    contentGapTargetTypeCounts,
    auditLangCounts,
    auditIndexStatusCounts,
    auditUrlTypeCounts,
    availableDatasets,
  };
};
