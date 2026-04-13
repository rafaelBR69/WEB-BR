import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REFERENCE_DIR = path.join(__dirname, "reference");

const INPUT_PATH = path.join(REFERENCE_DIR, "redirect_map_missing_gsc_candidates.csv");
const AUDIT_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");
const OUTPUT_PATH = path.join(REFERENCE_DIR, "redirect_map_missing_gsc_candidates_v2.csv");
const APPROVED_OUTPUT_PATH = path.join(
  REFERENCE_DIR,
  "redirect_map_missing_gsc_candidates_v2_only_approved.csv",
);

const HEADERS = [
  "old_url",
  "clicks",
  "impressions",
  "category",
  "corrected_category",
  "language",
  "suggested_target_url",
  "suggestion_basis",
  "confidence",
  "manual_review_required",
  "final_action",
  "notes",
];

const SUPPORTED_LANGS = ["en", "es", "de", "fr", "it", "nl"];
const PROPERTY_PREFIXES = ["property", "propiedad", "propriete", "proprieta", "eigentum"];
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);

const postFamilyTargets = {
  investCostaDelSol: {
    en: "https://blancareal.com/en/post/5-reasons-invest-costa-del-sol-given-instability-middle-east/",
    es: "https://blancareal.com/es/post/5-reasons-invest-costa-del-sol-given-instability-middle-east/",
  },
  rentTourists: {
    en: "https://blancareal.com/en/post/rent-your-home-to-tourists-andalucia/",
    es: "https://blancareal.com/es/post/alquilar-mi-vivienda-para-turistas/",
    de: "https://blancareal.com/de/post/wohnung-an-touristen-vermieten-andalusien/",
    fr: "https://blancareal.com/fr/post/louer-logement-aux-touristes-andalousie/",
    it: "https://blancareal.com/it/post/affittare-casa-ai-turisti-andalusia/",
    nl: "https://blancareal.com/nl/post/woning-aan-toeristen-verhuren-andalusie/",
  },
  dorronsoro: {
    en: "https://blancareal.com/en/post/dorronsoro-architects-behind-calahonda-sunset/",
    es: "https://blancareal.com/es/post/dorronsoro-los-arquitectos-detras-de-calahonda-sunset/",
    de: "https://blancareal.com/de/post/dorronsoro-architekten-hinter-calahonda-sunset/",
    fr: "https://blancareal.com/fr/post/dorronsoro-les-architectes-derriere-calahonda-sunset/",
    it: "https://blancareal.com/it/post/dorronsoro-gli-architetti-dietro-calahonda-sunset/",
    nl: "https://blancareal.com/nl/post/dorronsoro-de-architecten-achter-calahonda-sunset/",
  },
  legalOccupation: {
    en: "https://blancareal.com/en/post/legal-information-illegal-occupation-spain/",
    es: "https://blancareal.com/es/post/informacion-legal-sobre-la-ocupacion-ilegal-en-espana/",
    de: "https://blancareal.com/de/post/rechtliche-information-illegale-besetzung-spanien/",
    fr: "https://blancareal.com/fr/post/informations-juridiques-occupation-illegale-espagne/",
    it: "https://blancareal.com/it/post/informazioni-legali-occupazione-illegale-spagna/",
    nl: "https://blancareal.com/nl/post/juridische-informatie-illegale-bezetting-spanje/",
  },
  sellHome: {
    en: "https://blancareal.com/en/post/sell-your-home-blancareal/",
    es: "https://blancareal.com/es/post/vender-casa-blancareal/",
    de: "https://blancareal.com/de/post/haus-verkaufen-blancareal/",
    fr: "https://blancareal.com/fr/post/vendre-maison-blancareal/",
    it: "https://blancareal.com/it/post/vendere-casa-blancareal/",
    nl: "https://blancareal.com/nl/post/huis-verkopen-blancareal/",
  },
  whyBuyAgency: {
    en: "https://blancareal.com/en/post/why-buy-house-malaga-with-agency/",
    es: "https://blancareal.com/es/post/por-que-comprar-casa-malaga-con-agencia-inmobiliaria/",
    de: "https://blancareal.com/de/post/warum-haus-kaufen-malaga-mit-immobilienagentur/",
    fr: "https://blancareal.com/fr/post/pourquoi-acheter-maison-malaga-avec-agence-immobiliere/",
    it: "https://blancareal.com/it/post/perche-comprare-casa-malaga-con-agenzia-immobiliare/",
    nl: "https://blancareal.com/nl/post/waarom-huis-kopen-malaga-met-makelaarskantoor/",
  },
  taxes: {
    en: "https://blancareal.com/en/post/taxes-pay-costa-del-sol-property/",
    es: "https://blancareal.com/es/post/impuestos-pagar-propiedad-costa-del-sol/",
    de: "https://blancareal.com/de/post/steuern-zahlen-costa-del-sol-immobilie/",
    fr: "https://blancareal.com/fr/post/taxes-payer-propriete-costa-del-sol/",
    it: "https://blancareal.com/it/post/tasse-pagare-proprieta-costa-del-sol/",
    nl: "https://blancareal.com/nl/post/belastingen-betalen-costa-del-sol-woning/",
  },
};

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

function canonicalHeader(value) {
  return stripBom(String(value ?? ""))
    .trim()
    .toLowerCase()
    .replace(/Ã¡|á/g, "a")
    .replace(/Ã©|é/g, "e")
    .replace(/Ã­|í/g, "i")
    .replace(/Ã³|ó/g, "o")
    .replace(/Ãº|ú/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readCsvRows(content) {
  const parsed = parseCsv(content);
  const [headerRow, ...dataRows] = parsed;
  const headers = headerRow.map((header) => canonicalHeader(header));

  return dataRows
    .filter((row) => row.some((value) => String(value ?? "").trim().length > 0))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
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

function normalizeUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) return "";

  try {
    const url = new URL(input);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (!url.pathname) {
      url.pathname = "/";
    }
    if (!path.posix.extname(url.pathname) && !url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    return input;
  }
}

function tryDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractContext(oldUrl) {
  const url = new URL(oldUrl);
  const rawSegments = url.pathname.split("/").filter(Boolean);
  let language = "en";
  let segments = [...rawSegments];

  if (segments.length > 0 && SUPPORTED_LANGS.includes(segments[0])) {
    language = segments[0];
    segments = segments.slice(1);
  }

  return {
    hostname: url.hostname.toLowerCase(),
    pathname: url.pathname,
    language,
    segments,
    decodedSegments: segments.map((segment) => tryDecode(segment).toLowerCase()),
    decodedPath: tryDecode(url.pathname).toLowerCase(),
  };
}

function firstSegment(context) {
  return context.decodedSegments[0] ?? "";
}

function joinedSegments(context) {
  return context.decodedSegments.join("/");
}

function absoluteUrl(pathname) {
  return `https://blancareal.com${pathname}`;
}

function sectionTarget(language, section) {
  return absoluteUrl(`/${language}/${section}/`);
}

function isProjectLike(context) {
  const joined = joinedSegments(context);
  return /obra-nueva|nueva-construccion|new-build|newly-built|new-construction|off-plan|offplan|promoc|promotion|project|developments|obra_nueva|neubau|nouvelle-construction|nuova-costruzione|nieuwbouw|almitak|blanca-hills|blancahills|condesa-hills|condesahills|calahonda-sunset|nylva|pernet/.test(
    joined,
  );
}

function looksLikePluralSalesListing(context) {
  const joined = joinedSegments(context);
  return /(pisos|apartamentos|appartements|wohnungen|appartementen|appartamenti|villas|casas|hauser|maisons).*(venta|vendita|vente|sale|verkauf|koop)/.test(
    joined,
  );
}

function looksLikeSingleProperty(context) {
  if (!PROPERTY_PREFIXES.includes(firstSegment(context))) {
    return false;
  }
  const joined = joinedSegments(context);
  return !looksLikePluralSalesListing(context) && !/page\/\d+/.test(joined);
}

function isAsset(context) {
  const ext = path.posix.extname(context.pathname).toLowerCase();
  return context.decodedPath.endsWith(".pdf") || IMAGE_EXTENSIONS.has(ext) || context.decodedPath.includes("/wp-content/uploads/");
}

function exactPostTarget(context, auditUrls) {
  const joined = joinedSegments(context);
  const language = context.language;
  const candidates = [];

  if (/5-reasons-invest-costa-del-sol-given-instability-middle-east/.test(joined)) {
    candidates.push(postFamilyTargets.investCostaDelSol[language]);
  }
  if (
    /rent-your-home-to-tourists-andalucia|alquilar-mi-vivienda-para-turistas|wohnung-an-touristen-vermieten-andalusien|wie-kann-ich-meine-immobilie-legal-an-touristen-in-andalusien-vermieten|louer-logement-touristique-andalousie|louer-logement-aux-touristes-andalousie|come-affittare-legalmente-la-propria-casa-ai-turisti-in-andalusia|affittare-casa-ai-turisti-andalusia|hoe-kan-ik-mijn-woning-legaal-verhuren-aan-toeristen-in-andalusie|woning-aan-toeristen-verhuren-andalusie/.test(
      joined,
    )
  ) {
    candidates.push(postFamilyTargets.rentTourists[language]);
  }
  if (
    /dorronsoro|arquitectos-detras-de-calahonda-sunset|architectes-derriere-calahonda-sunset|architekten-hinter-calahonda-sunset|architetti-dietro-calahonda-sunset|gli-architetti-dietro-calahonda-sunset|architecten-achter-calahonda-sunset/.test(
      joined,
    )
  ) {
    candidates.push(postFamilyTargets.dorronsoro[language]);
  }
  if (
    /illegal-occupation|ocupacion-ilegal|occupation-illegale|illegale-besetzung|occupazione-illegale|illegale-bezetting/.test(
      joined,
    )
  ) {
    candidates.push(postFamilyTargets.legalOccupation[language]);
  }
  if (
    /sell-your-home|vender-casa-blancareal|haus-verkaufen-blancareal|vendre-maison-blancareal|vendere-casa-blancareal|huis-verkopen-blancareal|vendemos-su-casa/.test(
      joined,
    )
  ) {
    candidates.push(postFamilyTargets.sellHome[language]);
  }
  if (
    /why-buy-house|por-que-comprar-casa|porque-comprar-casa|warum-haus|pourquoi-acheter-maison|perche-comprare-casa|waarom-huis-kopen/.test(
      joined,
    )
  ) {
    candidates.push(postFamilyTargets.whyBuyAgency[language]);
  }
  if (
    /taxes-pay-costa-del-sol-property|impuestos-pagar-propiedad-costa-del-sol|steuern-zahlen-costa-del-sol-immobilie|tasse-pagare-proprieta-costa-del-sol|taxes-payer-propriete-costa-del-sol|belastingen-betalen-costa-del-sol-woning|gastos-comprar-piso-en-malaga|tasse-comprare-casa-in-spagna/.test(
      joined,
    )
  ) {
    candidates.push(postFamilyTargets.taxes[language]);
  }

  return candidates.find((candidate) => candidate && auditUrls.has(candidate)) ?? "";
}

function buildResult(row, auditUrls) {
  const oldUrl = normalizeUrl(row.old_url);
  const context = extractContext(oldUrl);
  const originalCategory = String(row.category ?? "").trim();
  const clicks = String(row.clicks ?? "").trim();
  const impressions = String(row.impressions ?? "").trim();
  const language = context.language;
  const joined = joinedSegments(context);
  const segment = firstSegment(context);

  let correctedCategory = originalCategory || "unknown";
  let suggestedTargetUrl = "";
  let suggestionBasis = "";
  let confidence = "medium";
  let manualReviewRequired = "no";
  let finalAction = "approve";
  let notes = String(row.notes ?? "").trim();

  if (context.hostname.includes("condesahills") || context.hostname.includes("blancahills")) {
    correctedCategory = "project";
    suggestedTargetUrl = sectionTarget(language, "projects");
    suggestionBasis = "Promotion microsite mapped to the projects index for the detected language.";
    confidence = "high";
  } else if (isAsset(context)) {
    correctedCategory = context.decodedPath.endsWith(".pdf") ? "asset_pdf" : "asset_image";
    suggestedTargetUrl = "";
    suggestionBasis = "Asset URL kept out of automatic redirect approval.";
    confidence = "low";
    manualReviewRequired = "yes";
    finalAction = "manual_review";
  } else if (context.decodedSegments.length === 0 || ["home", "inicio", "inicio-3", "accueil", "thuis", "inizio"].includes(segment)) {
    correctedCategory = "language_home";
    suggestedTargetUrl = absoluteUrl(`/${language}/`);
    suggestionBasis = "Language homepage variant mapped to the equivalent homepage.";
    confidence = "high";
  } else if (["about-us", "about-us-2", "quienes-somos", "quienes-somos-2", "qui-sommes-nous", "ueber-uns", "ueber-uns-2", "over-ons", "wie-we-zijn", "riguardo-a-noi"].includes(segment)) {
    correctedCategory = "about";
    suggestedTargetUrl = sectionTarget(language, "about");
    suggestionBasis = "About-page variant mapped to the equivalent about page.";
    confidence = "high";
  } else if (["contact", "contacto", "contatto", "kontakt"].includes(segment) || joined === "contact-blancareal-costadel-sol") {
    correctedCategory = "contact";
    suggestedTargetUrl = sectionTarget(language, "contact");
    suggestionBasis = "Contact-page variant mapped to the equivalent contact page.";
    confidence = "high";
  } else if (["blog", "bloggen"].includes(segment) && context.decodedSegments.length === 1) {
    correctedCategory = "blog_index";
    suggestedTargetUrl = sectionTarget(language, "posts");
    suggestionBasis = "Blog index variant mapped to the posts index for the same language.";
    confidence = "high";
  } else if (["property-search", "busqueda-de-inmuebles", "recherche-de-propriete", "eigentumssuche"].includes(segment)) {
    correctedCategory = "property_search";
    suggestedTargetUrl = sectionTarget(language, "properties");
    suggestionBasis = "Property search URL mapped to the properties index.";
    confidence = "high";
  } else if (["faqs", "preguntas-frecuentes", "questions-frequentes", "haeufig-gestellte-fragen"].includes(segment) || joined.startsWith("faq/")) {
    correctedCategory = "faq";
    suggestedTargetUrl = exactPostTarget(context, auditUrls) || sectionTarget(language, "posts");
    suggestionBasis = suggestedTargetUrl.includes("/post/")
      ? "FAQ/editorial URL matched to a real post equivalent in the new site."
      : "FAQ/editorial URL has no exact live match, so it falls back to the posts index.";
    confidence = suggestedTargetUrl.includes("/post/") ? "high" : "medium";
  } else if (joined.startsWith("agente/") || joined.startsWith("agent/") || joined.startsWith("agents/")) {
    correctedCategory = "agent";
    suggestedTargetUrl = sectionTarget(language, "agents");
    suggestionBasis = "Agent detail URL mapped to the agents index pending profile-level mapping.";
    confidence = "medium";
  } else if (
    /^nuestras-promociones$|^nos-projets$|^onze-projecten$|^unsere-projekte$|^i-nostri-progetti$|^our-developments$|^our-developments-2$/.test(
      segment,
    ) ||
    /^obra-nueva$|^new-construction$|^nouvelle-construction$|^nuova-costruzione$|^nieuwbouw$|^neubau$/.test(segment)
  ) {
    correctedCategory = "project";
    suggestedTargetUrl = sectionTarget(language, "projects");
    suggestionBasis = "Project or new-build landing mapped to the projects index.";
    confidence = "high";
  } else if (PROPERTY_PREFIXES.includes(segment)) {
    if (isProjectLike(context) || looksLikePluralSalesListing(context)) {
      correctedCategory = "project";
      suggestedTargetUrl = sectionTarget(language, "projects");
      suggestionBasis = "Plural or new-build property URL treated as a promotion/project intent and mapped to the projects index.";
      confidence = "medium";
    } else if (looksLikeSingleProperty(context)) {
      correctedCategory = "property";
      suggestedTargetUrl = sectionTarget(language, "properties");
      suggestionBasis = "Single-property-looking URL has no concrete match here, so it falls back to the properties index.";
      confidence = "medium";
    } else {
      correctedCategory = "property";
      suggestedTargetUrl = sectionTarget(language, "properties");
      suggestionBasis = "Property URL without a validated concrete match falls back to the properties index.";
      confidence = "medium";
    }
  } else {
    const postTarget = exactPostTarget(context, auditUrls);
    if (postTarget) {
      correctedCategory = "post";
      suggestedTargetUrl = postTarget;
      suggestionBasis = "Editorial URL matched to a real post equivalent in the new site.";
      confidence = "high";
    } else {
      correctedCategory = ["post", "faq"].includes(originalCategory) ? originalCategory : "post";
      suggestedTargetUrl = sectionTarget(language, "posts");
      suggestionBasis = "Editorial/FAQ URL has no exact live match, so it falls back to the posts index.";
      confidence = "medium";
    }
  }

  if (!suggestedTargetUrl) {
    manualReviewRequired = "yes";
    finalAction = "manual_review";
    confidence = "low";
  }

  return {
    old_url: oldUrl,
    clicks,
    impressions,
    category: originalCategory,
    corrected_category: correctedCategory,
    language,
    suggested_target_url: suggestedTargetUrl,
    suggestion_basis: suggestionBasis,
    confidence,
    manual_review_required: manualReviewRequired,
    final_action: finalAction,
    notes,
  };
}

async function main() {
  const [inputRaw, auditRaw] = await Promise.all([
    fs.readFile(INPUT_PATH, "utf8"),
    fs.readFile(AUDIT_PATH, "utf8"),
  ]);

  const inputRows = readCsvRows(inputRaw);
  const auditRows = readCsvRows(auditRaw);
  const auditUrls = new Set(auditRows.map((row) => normalizeUrl(row.new_url)).filter(Boolean));

  const v2Rows = inputRows.map((row) => buildResult(row, auditUrls));
  const approvedRows = v2Rows.filter((row) => row.final_action === "approve");

  await Promise.all([
    fs.writeFile(OUTPUT_PATH, toCsv(HEADERS, v2Rows), "utf8"),
    fs.writeFile(APPROVED_OUTPUT_PATH, toCsv(HEADERS, approvedRows), "utf8"),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
