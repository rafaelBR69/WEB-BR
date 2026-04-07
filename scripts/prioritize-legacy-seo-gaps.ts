import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const GAP_INPUT_PATH = path.join(REPO_ROOT, "seo_url_legacy_content_gaps.csv");
const OUTPUT_PATH = path.join(REPO_ROOT, "seo_url_legacy_gap_action_plan.csv");

type GapRow = {
  old_url: string;
  old_type: string;
  current_target: string;
  current_target_type: string;
  target_index_status: string;
  gap_type: string;
  recommended_action: string;
  notes: string;
};

type ActionPlanRow = {
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

const headers: Array<keyof ActionPlanRow> = [
  "old_url",
  "old_type",
  "current_target",
  "current_target_type",
  "gap_type",
  "priority_band",
  "action_owner",
  "action_type",
  "implementation_decision",
  "seo_risk",
  "rationale",
];

function csvEscape(value: string) {
  const normalized = String(value ?? "");
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function readGapRows(content: string) {
  const parsed = parseCsv(content);
  const [headerRow, ...dataRows] = parsed;
  return dataRows.map((row) => {
    const record = {} as GapRow;
    headerRow.forEach((header, index) => {
      (record as any)[header] = row[index] ?? "";
    });
    return record;
  });
}

function classifyGap(row: GapRow): ActionPlanRow {
  const oldUrl = row.old_url.toLowerCase();
  const currentTarget = row.current_target;
  const isWpPropertyId = oldUrl.includes("?post_type=property&p=");
  const isCategoryArchive = row.old_type === "category";
  const isPost = row.old_type === "post";
  const isProperty = row.old_type === "property";
  const isNoindexTarget = row.gap_type === "target_currently_noindex";

  if (isWpPropertyId) {
    return {
      old_url: row.old_url,
      old_type: row.old_type,
      current_target: currentTarget,
      current_target_type: row.current_target_type,
      gap_type: row.gap_type,
      priority_band: "P3",
      action_owner: "SEO + Content",
      action_type: "lookup_legacy_source",
      implementation_decision: "Look up the original WordPress property record before deciding whether to recreate or redirect.",
      seo_risk: "medium",
      rationale: "The legacy URL is an opaque WordPress ID. Without the original record we cannot guarantee semantic equivalence.",
    };
  }

  if (isCategoryArchive) {
    return {
      old_url: row.old_url,
      old_type: row.old_type,
      current_target: currentTarget,
      current_target_type: row.current_target_type,
      gap_type: row.gap_type,
      priority_band: "P3",
      action_owner: "SEO",
      action_type: "keep_redirect",
      implementation_decision: "Keep a direct 301 to the posts index unless category pages are intentionally rebuilt.",
      seo_risk: "low",
      rationale: "Category archives are not core conversion pages and can usually be merged safely into the editorial index.",
    };
  }

  if (isNoindexTarget && isProperty) {
    return {
      old_url: row.old_url,
      old_type: row.old_type,
      current_target: currentTarget,
      current_target_type: row.current_target_type,
      gap_type: row.gap_type,
      priority_band: "P1",
      action_owner: "SEO + Product",
      action_type: "make_target_indexable_or_create_exact_equivalent",
      implementation_decision:
        "Review this mapped target immediately. If it should inherit the old intent, remove noindex; otherwise build a dedicated equivalent URL.",
      seo_risk: "high",
      rationale: "A semantically close target exists, but leaving it noindex would block transfer of ranking signals and search intent.",
    };
  }

  if (isNoindexTarget && isPost) {
    return {
      old_url: row.old_url,
      old_type: row.old_type,
      current_target: currentTarget,
      current_target_type: row.current_target_type,
      gap_type: row.gap_type,
      priority_band: "P1",
      action_owner: "SEO + Content",
      action_type: "make_target_indexable_or_recreate_post",
      implementation_decision:
        "If this mapped article is the intended replacement, make it indexable. If not, recreate the missing post and redirect there instead.",
      seo_risk: "high",
      rationale: "Editorial intent is being redirected into a noindex destination, which risks losing the old article's discoverability.",
    };
  }

  if (isPost) {
    return {
      old_url: row.old_url,
      old_type: row.old_type,
      current_target: currentTarget,
      current_target_type: row.current_target_type,
      gap_type: row.gap_type,
      priority_band: "P1",
      action_owner: "SEO + Content",
      action_type: "recreate_or_import_post",
      implementation_decision:
        "Audit this old article for traffic/backlinks and recreate it if it had value. Only keep the redirect to posts index when the content is definitively disposable.",
      seo_risk: "high",
      rationale: "Informational URLs often rank independently. Redirecting them to the blog index is usually not enough to preserve SEO value.",
    };
  }

  if (isProperty) {
    const highIntentPatterns = [
      "new-build",
      "new-construction",
      "newly-built",
      "offplan",
      "sea-view",
      "beachfront",
      "luxury",
      "villa",
      "villas",
      "penthouse",
      "townhouse",
      "apartments",
      "apartment",
      "flat",
      "flats",
      "houses",
      "house-for-sale",
    ];
    const isHighIntent = highIntentPatterns.some((pattern) => oldUrl.includes(pattern));

    return {
      old_url: row.old_url,
      old_type: row.old_type,
      current_target: currentTarget,
      current_target_type: row.current_target_type,
      gap_type: row.gap_type,
      priority_band: isHighIntent ? "P1" : "P2",
      action_owner: "SEO + Product + Content",
      action_type: isHighIntent ? "create_exact_equivalent_property_or_landing" : "review_redirect_vs_rebuild",
      implementation_decision: isHighIntent
        ? "Create an equivalent property/project/landing URL if the legacy intent is still commercially relevant. Do not rely on a generic catalogue redirect."
        : "Check whether this old listing still represents a live commercial intent. If yes, create a closer equivalent; if not, keep a controlled redirect.",
      seo_risk: isHighIntent ? "high" : "medium",
      rationale: isHighIntent
        ? "This is a transactional property URL with explicit search intent, and generic redirects are likely to lose rankings."
        : "This property URL may still matter, but it is less clearly strategic than the highest-intent transactional set.",
    };
  }

  return {
    old_url: row.old_url,
    old_type: row.old_type,
    current_target: currentTarget,
    current_target_type: row.current_target_type,
    gap_type: row.gap_type,
    priority_band: "P2",
    action_owner: "SEO",
    action_type: "manual_review",
    implementation_decision: "Review manually and decide between rebuild and controlled redirect.",
    seo_risk: "medium",
    rationale: "This URL does not fit the standard migration rules cleanly.",
  };
}

function priorityOrder(priority: string) {
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  return 3;
}

async function main() {
  const input = await fs.readFile(GAP_INPUT_PATH, "utf8");
  const gaps = readGapRows(input);
  const plan = gaps
    .map((row) => classifyGap(row))
    .sort((left, right) => {
      const priorityDelta = priorityOrder(left.priority_band) - priorityOrder(right.priority_band);
      if (priorityDelta !== 0) return priorityDelta;
      return left.old_url.localeCompare(right.old_url, undefined, { sensitivity: "base" });
    });

  const csv = [
    headers.join(","),
    ...plan.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  await fs.writeFile(OUTPUT_PATH, csv, "utf8");

  const summary = plan.reduce<Record<string, number>>((acc, row) => {
    acc[row.priority_band] = (acc[row.priority_band] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Generated ${plan.length} prioritized gap actions at ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
