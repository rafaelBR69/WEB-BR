import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const INPUT_PATH = path.join(__dirname, "reference", "priority_a_properties.csv");
const PROPERTIES_DIR = path.join(REPO_ROOT, "src", "data", "properties");
const MASTER_AUDIT_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");
const OUTPUT_PATH = path.join(__dirname, "reference", "properties_matching_review.csv");

const OUTPUT_HEADERS = [
  "old_url",
  "old_title",
  "old_slug",
  "suggested_new_url",
  "matched_json_id",
  "matched_title",
  "matched_location",
  "matched_property_type",
  "match_score",
  "match_basis",
  "decision",
  "notes",
];

function stripBom(value) {
  return value.replace(/^\uFEFF/, "");
}

function parseCsv(content) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  const normalized = stripBom(content);

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

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

function readCsvRows(content) {
  const parsed = parseCsv(content);
  const [headerRow, ...dataRows] = parsed;

  return dataRows
    .filter((row) => row.some((value) => String(value ?? "").trim().length > 0))
    .map((row) => {
      const record = {};
      headerRow.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
}

function csvEscape(value) {
  const normalized = String(value ?? "");
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function slugFromUrl(url) {
  const pathname = new URL(url).pathname;
  return pathname.replace(/^\/property\//, "").replace(/\/$/, "");
}

function toInt(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jaccardScore(leftTokens, rightTokens) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function inferBedrooms(text) {
  const match = normalizeText(text).match(/\b([1-9])\s*(bed|beds|bedroom|bedrooms|hab|habitaciones|chambres|camere|slaapkamers)\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function inferOldPropertyType(text) {
  const normalized = normalizeText(text);
  if (/penthouse|atico/.test(normalized)) return "penthouse";
  if (/villa/.test(normalized)) return "villa";
  if (/townhouse|townhouses|adosad/.test(normalized)) return "townhouse";
  if (/plot|parcela|solar|terreno/.test(normalized)) return "plot";
  if (/commercial|local|restaurant/.test(normalized)) return "commercial";
  if (/house|casa/.test(normalized)) return "house";
  if (/apartment|apartments|flat|flats|piso|pisos/.test(normalized)) return "apartment";
  return null;
}

function looksProjectLike(text) {
  const normalized = normalizeText(text);
  return /offplan|obra nueva|new build|newly built|new construction|promotion|promocion|project|orion|almitak|nylva|calahonda sunset/.test(
    normalized
  );
}

function propertyTypeMatches(oldType, candidateType) {
  if (!oldType || !candidateType) return false;
  if (oldType === candidateType) return true;

  const equivalences = {
    apartment: new Set(["apartment", "penthouse"]),
    penthouse: new Set(["penthouse", "apartment"]),
    house: new Set(["house", "townhouse", "villa"]),
    townhouse: new Set(["townhouse", "house"]),
  };

  return equivalences[oldType]?.has(candidateType) ?? false;
}

function buildCandidateUrl(propertyJson, lang, auditUrlSet) {
  const preferredSlug = propertyJson.slugs?.[lang] ?? propertyJson.slugs?.en ?? "";
  if (!preferredSlug) return "";

  const url = `https://blancareal.com/${lang}/property/${preferredSlug}/`;
  return auditUrlSet.has(url) ? url : "";
}

function buildPropertyCatalog(propertyJson) {
  const translations = propertyJson.translations ?? {};
  const location = propertyJson.location ?? {};
  const property = propertyJson.property ?? {};
  const listingType = propertyJson.listing_type ?? "";
  const langs = ["en", "es", "de", "fr", "it", "nl"];
  const titlesByLang = Object.fromEntries(
    langs.map((lang) => [
      lang,
      translations?.[lang]?.title ??
        propertyJson.seo?.focus_keyphrase?.[lang] ??
        propertyJson.media?.cover?.alt?.[lang] ??
        propertyJson.slugs?.[lang] ??
        propertyJson.slugs?.en ??
        propertyJson.id,
    ])
  );

  const locationText = [location.city, location.area].filter(Boolean).join(", ");

  return {
    id: propertyJson.id,
    raw: propertyJson,
    listingType,
    status: propertyJson.status ?? "",
    propertyType: property.type ?? "",
    bedrooms: Number.isFinite(property.bedrooms) ? property.bedrooms : null,
    city: normalizeText(location.city ?? ""),
    area: normalizeText(location.area ?? ""),
    locationText,
    titlesByLang,
    slugTokensByLang: Object.fromEntries(
      Object.entries(propertyJson.slugs ?? {}).map(([lang, slug]) => [lang, tokenize(slug)])
    ),
  };
}

function scoreCandidate(oldRow, candidate, auditUrlSet) {
  const oldSlug = slugFromUrl(oldRow.old_url);
  const oldSlugTokens = tokenize(oldSlug);
  const oldTitle = oldRow.old_title;
  const oldTitleTokens = tokenize(oldTitle);
  const oldCombined = `${oldSlug} ${oldTitle}`;
  const oldType = inferOldPropertyType(oldCombined);
  const oldBedrooms = inferBedrooms(oldCombined);
  const projectLike = looksProjectLike(oldCombined);
  const oldLang = oldRow.old_language || "en";

  const candidateSlugTokens =
    candidate.slugTokensByLang[oldLang] ??
    candidate.slugTokensByLang.en ??
    candidate.slugTokensByLang.es ??
    [];
  const candidateTitle = candidate.titlesByLang[oldLang] ?? candidate.titlesByLang.en ?? candidate.id;
  const candidateTitleTokens = tokenize(candidateTitle);

  let score = 0;
  const basis = [];

  const slugSimilarity = jaccardScore(oldSlugTokens, candidateSlugTokens);
  if (slugSimilarity >= 0.75) {
    score += 40;
    basis.push("slug very similar");
  } else if (slugSimilarity >= 0.55) {
    score += 28;
    basis.push("slug similar");
  } else if (slugSimilarity >= 0.4) {
    score += 16;
    basis.push("slug partially similar");
  }

  const titleSimilarity = jaccardScore(oldTitleTokens, candidateTitleTokens);
  if (titleSimilarity >= 0.7) {
    score += 22;
    basis.push("title very similar");
  } else if (titleSimilarity >= 0.5) {
    score += 14;
    basis.push("title similar");
  } else if (titleSimilarity >= 0.35) {
    score += 8;
    basis.push("title partially similar");
  }

  if (candidate.city && normalizeText(oldCombined).includes(candidate.city)) {
    score += 12;
    basis.push(`city=${candidate.raw.location?.city}`);
  }

  if (candidate.area && normalizeText(oldCombined).includes(candidate.area)) {
    score += 10;
    basis.push(`area=${candidate.raw.location?.area}`);
  }

  if (propertyTypeMatches(oldType, candidate.propertyType)) {
    score += 12;
    basis.push(`type=${candidate.propertyType}`);
  }

  if (oldBedrooms && candidate.bedrooms && oldBedrooms === candidate.bedrooms) {
    score += 8;
    basis.push(`bedrooms=${candidate.bedrooms}`);
  }

  if (projectLike && (candidate.listingType === "promotion" || candidate.raw.property?.market === "obra_nueva")) {
    score += 10;
    basis.push("new-build/project intent");
  }

  const existingCandidate = String(oldRow.new_url_candidate ?? "").trim();
  const candidateUrl = buildCandidateUrl(candidate.raw, oldLang, auditUrlSet);
  if (existingCandidate && candidateUrl && existingCandidate === candidateUrl) {
    score += 35;
    basis.push("matches existing candidate");
  }

  if (/rent|rental|vacation/.test(normalizeText(oldCombined)) && candidate.raw.transaction === "sale") {
    score -= 12;
  }

  if (oldType === "commercial" && candidate.propertyType !== "commercial") {
    score -= 10;
  }

  if (oldType === "plot" && candidate.propertyType !== "plot") {
    score -= 8;
  }

  return {
    candidateUrl,
    score: Math.max(0, Math.round(score)),
    basis,
    candidateTitle,
  };
}

function buildDecision(oldRow, best, secondBest, auditUrlSet) {
  const oldCombined = `${oldRow.old_slug} ${oldRow.old_title}`;
  const projectLike = looksProjectLike(oldCombined);
  const margin = best ? best.score - (secondBest?.score ?? 0) : 0;
  const bestUrlExists = best?.candidateUrl && auditUrlSet.has(best.candidateUrl);
  const strongBasisCount = best?.basis?.length ?? 0;

  if (best && bestUrlExists && best.score >= 78 && margin >= 12 && strongBasisCount >= 3) {
    return "map_to_existing_new_property";
  }

  if (best && bestUrlExists && best.score >= 68 && margin >= 18 && best.basis.includes("matches existing candidate")) {
    return "map_to_existing_new_property";
  }

  if (best && best.score >= 52) {
    return "manual_review";
  }

  if (projectLike) {
    return "redirect_to_projects_index";
  }

  return "redirect_to_properties_index";
}

async function main() {
  const [inputRaw, auditRaw, propertyFiles] = await Promise.all([
    fs.readFile(INPUT_PATH, "utf8"),
    fs.readFile(MASTER_AUDIT_PATH, "utf8"),
    fs.readdir(PROPERTIES_DIR),
  ]);

  const inputRows = readCsvRows(inputRaw);
  const auditRows = readCsvRows(auditRaw);
  const auditUrlSet = new Set(auditRows.map((row) => row.new_url).filter(Boolean));
  const jsonFiles = propertyFiles.filter((file) => file.endsWith(".json"));
  const propertyJsons = await Promise.all(
    jsonFiles.map(async (fileName) => {
      const fullPath = path.join(PROPERTIES_DIR, fileName);
      const raw = await fs.readFile(fullPath, "utf8");
      return JSON.parse(raw);
    })
  );

  const catalog = propertyJsons.map(buildPropertyCatalog);

  const rows = inputRows.map((row) => {
    const oldSlug = slugFromUrl(row.old_url);
    const enrichedRow = { ...row, old_slug: oldSlug };
    const oldCombined = `${oldSlug} ${row.old_title}`;
    const oldInferredType = inferOldPropertyType(oldCombined);
    const oldInferredBedrooms = inferBedrooms(oldCombined);

    const scored = catalog
      .map((candidate) => {
        const result = scoreCandidate(enrichedRow, candidate, auditUrlSet);
        return {
          ...candidate,
          ...result,
        };
      })
      .sort((left, right) => right.score - left.score);

    const best = scored[0] ?? null;
    const secondBest = scored[1] ?? null;
    const decision = buildDecision(enrichedRow, best, secondBest, auditUrlSet);

    const useBest = best && (best.score >= 30 || decision === "map_to_existing_new_property" || decision === "manual_review");

    const suggestedNewUrl =
      decision === "redirect_to_properties_index"
        ? ""
        : decision === "redirect_to_projects_index"
          ? ""
          : useBest
            ? best.candidateUrl
            : "";

    const matchBasis = useBest ? best.basis.join(" | ") : "";
    const notes = [];

    if (useBest && secondBest && best.score - secondBest.score < 12) {
      notes.push(`Top candidates are close (${best.score} vs ${secondBest.score}).`);
    }

    if (row.new_url_candidate && suggestedNewUrl && row.new_url_candidate === suggestedNewUrl) {
      notes.push("Preserved existing candidate from previous pass.");
    }

    if (useBest && oldInferredType && best.propertyType && !propertyTypeMatches(oldInferredType, best.propertyType)) {
      notes.push(`Type mismatch to verify: old looks ${oldInferredType}, JSON property.type=${best.propertyType}.`);
    }

    if (useBest && oldInferredBedrooms === null && best.bedrooms && best.listingType === "promotion") {
      notes.push("No bedroom count inferred from old URL/title; candidate was chosen on non-bedroom signals.");
    }

    if (!useBest) {
      notes.push("No strong property-level match found.");
    }

    if (decision === "redirect_to_projects_index") {
      notes.push("Old URL looks closer to a promotion/new-build/project cluster than to a stable like-for-like property detail.");
    }

    if (decision === "redirect_to_properties_index") {
      notes.push("Closest safe fallback is the general properties catalogue.");
    }

    if (row.notes) {
      notes.push(row.notes);
    }

    return {
      old_url: row.old_url,
      old_title: row.old_title,
      old_slug: oldSlug,
      suggested_new_url: suggestedNewUrl,
      matched_json_id: useBest ? best.id : "",
      matched_title: useBest ? best.candidateTitle : "",
      matched_location: useBest ? best.locationText : "",
      matched_property_type: useBest ? `${best.propertyType}${best.listingType ? ` (${best.listingType})` : ""}` : "",
      match_score: useBest ? String(best.score) : "",
      match_basis: matchBasis,
      decision,
      notes: notes.join(" "),
    };
  });

  await fs.writeFile(OUTPUT_PATH, toCsv(OUTPUT_HEADERS, rows), "utf8");

  console.log(
    JSON.stringify(
      {
        input_rows: inputRows.length,
        matched_rows: rows.length,
        map_to_existing_new_property: rows.filter((row) => row.decision === "map_to_existing_new_property").length,
        manual_review: rows.filter((row) => row.decision === "manual_review").length,
        redirect_to_properties_index: rows.filter((row) => row.decision === "redirect_to_properties_index").length,
        redirect_to_projects_index: rows.filter((row) => row.decision === "redirect_to_projects_index").length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
