import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REFERENCE_DIR = path.join(__dirname, "reference");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CORE_PATH = path.join(REFERENCE_DIR, "redirect_map_core_final_v2.csv");
const PROPERTIES_PATH = path.join(REFERENCE_DIR, "redirect_map_properties_final.csv");
const GSC_PRIORITY_PATH = path.join(REFERENCE_DIR, "gsc_priority_urls.csv");
const SEO_AUDIT_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");

const MISSING_OUTPUT = path.join(REFERENCE_DIR, "redirect_map_missing_gsc_candidates.csv");
const MERGED_OUTPUT = path.join(REFERENCE_DIR, "redirect_map_v3_merged_preview.csv");

const MISSING_HEADERS = [
  "old_url",
  "clicks",
  "impressions",
  "category",
  "language",
  "suggested_target_url",
  "suggestion_basis",
  "confidence",
  "manual_review_required",
  "notes",
];

const MERGED_HEADERS = [
  "old_url",
  "target_url",
  "redirect_type",
  "source",
  "confidence",
  "status",
  "notes",
];

const SUPPORTED_LANGS = ["en", "es", "de", "fr", "it", "nl"];
const PROPERTY_PREFIXES = ["property", "propiedad", "propriete", "proprieta", "eigentum"];
const ARCHIVE_PREFIXES = [
  "category",
  "tag",
  "prestacion-propiedad",
  "tipo-propiedad",
  "estado-propiedad",
  "ubicacion-ubicacion",
];
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
  if (!input) {
    return "";
  }

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

function parseInteger(value) {
  const normalized = String(value ?? "").replace(/[^\d.-]/g, "");
  if (!normalized) {
    return "";
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : "";
}

function tryDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractUrlContext(oldUrl) {
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

function absoluteUrl(pathname) {
  return `https://blancareal.com${pathname}`;
}

function sectionTarget(language, section) {
  return absoluteUrl(`/${language}/${section}/`);
}

function firstSegment(context) {
  return context.decodedSegments[0] ?? "";
}

function joinedSegments(context) {
  return context.decodedSegments.join("/");
}

function isProjectLikeText(value) {
  return /obra-nueva|new-build|newly-built|new-construction|off-plan|offplan|promoc|project|projects|developments|neubau|nouvelle-construction|nuova-costruzione|nieuwbouw|almitak|condesa-hills|condesahills|blanca-hills|blancahills|calahonda-sunset|nylva|pernet|balcones-del-pinillo/.test(
    value,
  );
}

function isPropertyPrefix(context) {
  return PROPERTY_PREFIXES.includes(firstSegment(context));
}

function isArchive(context) {
  const joined = joinedSegments(context);
  const first = firstSegment(context);
  return (
    ARCHIVE_PREFIXES.includes(first) ||
    /\/page\/\d+/.test(joined) ||
    /^blog\/page\/\d+/.test(joined) ||
    /^property\/page\/\d+/.test(joined) ||
    /^propiedad\/page\/\d+/.test(joined) ||
    /^propriete\/page\/\d+/.test(joined) ||
    /^proprieta\/page\/\d+/.test(joined) ||
    /^eigentum\/page\/\d+/.test(joined)
  );
}

function isAssetPdf(context) {
  return context.decodedPath.endsWith(".pdf");
}

function isAssetImage(context) {
  const ext = path.posix.extname(context.pathname).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) || context.decodedPath.includes("/wp-content/uploads/");
}

function exactPostTarget(context, auditUrls) {
  const joined = joinedSegments(context);
  const language = context.language;
  const candidates = [];

  if (/5-reasons-invest-costa-del-sol-given-instability-middle-east/.test(joined)) {
    candidates.push(postFamilyTargets.investCostaDelSol[language]);
  }
  if (
    /rent-your-home-to-tourists-andalucia|alquilar-mi-vivienda-para-turistas|wohnung-an-touristen-vermieten-andalusien|wie-kann-ich-meine-immobilie-legal-an-touristen-in-andalusien-vermieten|louer-logement-touristique-andalousie|come-affittare-legalmente-la-propria-casa-ai-turisti-in-andalusia|hoe-kan-ik-mijn-woning-legaal-verhuren-aan-toeristen-in-andalusie/.test(
      joined,
    )
  ) {
    candidates.push(postFamilyTargets.rentTourists[language]);
  }
  if (
    /dorronsoro|arquitectos-detras-de-calahonda-sunset|architectes-derriere-calahonda-sunset|architekten-hinter-calahonda-sunset|architetti-dietro-calahonda-sunset|architecten-achter-calahonda-sunset/.test(
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

  return candidates.find((candidate) => candidate && auditUrls.has(candidate)) ?? "";
}

function classifyCandidate(oldUrl, clicks, impressions, auditUrls) {
  const context = extractUrlContext(oldUrl);
  const joined = joinedSegments(context);
  const segment = firstSegment(context);
  const language = context.language;
  const hasProjects = auditUrls.has(sectionTarget(language, "projects"));
  const hasProperties = auditUrls.has(sectionTarget(language, "properties"));
  const hasPosts = auditUrls.has(sectionTarget(language, "posts"));
  const hasAbout = auditUrls.has(sectionTarget(language, "about"));
  const hasContact = auditUrls.has(sectionTarget(language, "contact"));
  const hasAgents = auditUrls.has(sectionTarget(language, "agents"));
  const hasLegalServices = auditUrls.has(sectionTarget(language, "legal-services"));
  const hasCommercialization = auditUrls.has(sectionTarget(language, "commercialization"));
  const hasSellWithUs = auditUrls.has(sectionTarget(language, "sell-with-us"));

  const result = {
    category: "unknown",
    language,
    suggested_target_url: "",
    suggestion_basis: "",
    confidence: "low",
    manual_review_required: "yes",
    notes: `GSC signal: ${clicks || 0} clicks, ${impressions || 0} impressions.`,
  };

  if (isAssetPdf(context)) {
    result.category = "asset_pdf";
    result.suggestion_basis = "Legacy URL is a PDF asset; no redirect target should be guessed from section heuristics.";
    result.notes += " PDF asset kept for manual handling.";
    return result;
  }

  if (isAssetImage(context)) {
    result.category = "asset_image";
    result.suggestion_basis = "Legacy URL is an image asset; no redirect target should be guessed from section heuristics.";
    result.notes += " Image asset kept for manual handling.";
    return result;
  }

  if (context.hostname.includes("condesahills") || context.hostname.includes("blancahills")) {
    result.category = "project";
    result.suggested_target_url = hasProjects ? sectionTarget(language, "projects") : "";
    result.suggestion_basis = "Legacy URL belongs to a project microsite, so the closest safe section is the projects index.";
    result.confidence = result.suggested_target_url ? "medium" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    result.notes += " Project microsite URL.";
    return result;
  }

  if (
    context.decodedSegments.length === 0 ||
    ["home", "inicio", "inicio-3", "accueil", "thuis", "inizio"].includes(segment)
  ) {
    result.category = "language_home";
    result.suggested_target_url = absoluteUrl(`/${language}/`);
    result.suggestion_basis = "Legacy URL is a language home variant and maps to the equivalent language homepage.";
    result.confidence = "high";
    result.manual_review_required = "no";
    return result;
  }

  if (
    [
      "about-us",
      "about-us-2",
      "quienes-somos",
      "quienes-somos-2",
      "qui-sommes-nous",
      "ueber-uns",
      "ueber-uns-2",
      "over-ons",
      "wie-we-zijn",
      "riguardo-a-noi",
    ].includes(segment)
  ) {
    result.category = "about";
    result.suggested_target_url = hasAbout ? sectionTarget(language, "about") : "";
    result.suggestion_basis = "Legacy URL is an about page variant and maps to the real about section for the same language.";
    result.confidence = result.suggested_target_url ? "high" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    return result;
  }

  if (
    ["contact", "contacto", "contatto", "kontakt"].includes(segment) ||
    joined === "contact-blancareal-costadel-sol"
  ) {
    result.category = "contact";
    result.suggested_target_url = hasContact ? sectionTarget(language, "contact") : "";
    result.suggestion_basis = "Legacy URL is a contact page variant and maps to the real contact section for the same language.";
    result.confidence = result.suggested_target_url ? "high" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    return result;
  }

  if (["blog", "bloggen"].includes(segment) && context.decodedSegments.length === 1) {
    result.category = "blog_index";
    result.suggested_target_url = hasPosts ? sectionTarget(language, "posts") : "";
    result.suggestion_basis = "Legacy URL is a blog index variant and maps to the real posts index for the same language.";
    result.confidence = result.suggested_target_url ? "high" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    return result;
  }

  if (
    [
      "property-search",
      "busqueda-de-inmuebles",
      "recherche-de-propriete",
      "eigentumssuche",
      "recherche-de-propriete",
    ].includes(segment)
  ) {
    result.category = "property_search";
    result.suggested_target_url = hasProperties ? sectionTarget(language, "properties") : "";
    result.suggestion_basis = "Legacy URL is a property search page and maps to the live properties index for the same language.";
    result.confidence = result.suggested_target_url ? "high" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    return result;
  }

  if (
    ["faqs", "preguntas-frecuentes", "questions-frequentes", "haeufig-gestellte-fragen"].includes(segment) &&
    context.decodedSegments.length === 1
  ) {
    result.category = "faq";
    result.suggested_target_url = hasContact ? sectionTarget(language, "contact") : "";
    result.suggestion_basis = "No dedicated FAQ route exists in the new site, so the safest known fallback is the language contact page.";
    result.confidence = result.suggested_target_url ? "medium" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    return result;
  }

  if (joined.startsWith("faq/")) {
    result.category = "faq";
    result.suggestion_basis = "Legacy FAQ detail URL has no clearly validated equivalent in the new site.";
    result.notes += " FAQ detail kept for manual review.";
    return result;
  }

  if (joined.startsWith("agente/") || joined.startsWith("agent/") || joined.startsWith("agents/")) {
    result.category = "agent";
    result.suggested_target_url = hasAgents ? sectionTarget(language, "agents") : "";
    result.suggestion_basis = "Legacy URL belongs to an agent section; the live agents index is the closest validated section-level target.";
    result.confidence = result.suggested_target_url ? "medium" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    result.notes += " Agent detail was not mapped to a specific profile in this pass.";
    return result;
  }

  if (
    segment === "legal-services" ||
    /comercializacion-inmobiliaria-costa-del-sol/.test(joined) ||
    /^servicios$|^services$|^dienstleistungen$|^servizi$|^diensten$/.test(segment)
  ) {
    result.category = "service_page";

    if (/comercializacion-inmobiliaria-costa-del-sol/.test(joined) && hasCommercialization) {
      result.suggested_target_url = sectionTarget(language, "commercialization");
      result.suggestion_basis = "Legacy commercialization page maps to the live commercialization service page.";
      result.confidence = "high";
      result.manual_review_required = "no";
      return result;
    }

    if (segment === "legal-services" && hasLegalServices) {
      result.suggested_target_url = sectionTarget(language, "legal-services");
      result.suggestion_basis = "Legacy legal services page maps to the live legal services section.";
      result.confidence = "high";
      result.manual_review_required = "no";
      return result;
    }

    result.suggestion_basis = "Legacy generic service page has no single validated equivalent in the new site.";
    result.notes += " Generic service page kept for manual review.";
    return result;
  }

  const exactPost = exactPostTarget(context, auditUrls);
  if (exactPost) {
    result.category = "post";
    result.suggested_target_url = exactPost;
    result.suggestion_basis = "A translated editorial equivalent exists in the new site audit and was reused as the candidate target.";
    result.confidence = "high";
    result.manual_review_required = "no";
    return result;
  }

  if (
    /^about-us\/?$/.test(joined) ||
    /^contact\/?$/.test(joined) ||
    /^blog\/?$/.test(joined)
  ) {
    result.category = "category_or_archive";
    result.suggestion_basis = "Legacy archive-like path should be handled by an existing mapped section instead of a new heuristic.";
    result.notes += " Existing high-level mapping should cover this pattern.";
    return result;
  }

  if (isArchive(context)) {
    result.category = "category_or_archive";
    const isBlogArchive = segment === "blog" || segment === "bloggen" || segment === "category" || segment === "tag";
    result.suggested_target_url = isBlogArchive ? sectionTarget(language, "posts") : sectionTarget(language, "properties");
    result.suggestion_basis = isBlogArchive
      ? "Legacy archive is content-driven and maps to the posts index as the closest live section."
      : "Legacy archive/filter URL is property-driven and maps to the live properties index as the closest section.";
    result.confidence = "medium";
    result.manual_review_required = "no";
    return result;
  }

  if (
    /^nuestras-promociones$|^nos-projets$|^onze-projecten$|^unsere-projekte$|^i-nostri-progetti$|^our-developments$|^our-developments-2$/.test(
      segment,
    ) ||
    /^obra-nueva$|^new-construction$|^nouvelle-construction$|^nuova-costruzione$|^nieuwbouw$|^neubau$/.test(segment)
  ) {
    result.category = "project";
    result.suggested_target_url = hasProjects ? sectionTarget(language, "projects") : "";
    result.suggestion_basis = "Legacy URL is a projects or new-build landing and maps to the live projects index for the same language.";
    result.confidence = result.suggested_target_url ? "high" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    return result;
  }

  if (isPropertyPrefix(context)) {
    const propertyText = joined;
    const projectLike = isProjectLikeText(propertyText);
    result.category = projectLike ? "project" : "property";
    result.suggested_target_url = projectLike
      ? (hasProjects ? sectionTarget(language, "projects") : "")
      : (hasProperties ? sectionTarget(language, "properties") : "");
    result.suggestion_basis = projectLike
      ? "Legacy property URL looks like a promotion or new-build project, so the safest candidate is the projects index."
      : "Legacy property URL has no validated like-for-like match in this pass, so the safest candidate is the properties index.";
    result.confidence = result.suggested_target_url ? "medium" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    return result;
  }

  if (
    /^segunda-mano$|^second-hand$|^doccasion$|^seconda-mano$|^tweedehands(-2)?$|^luxury-villas$|^villas-de-lujo$|^alquileres$|^vacacional$|^vacation$|^rentals$|^locations$|^vermietungen$|^vacanze$/.test(
      segment,
    )
  ) {
    result.category = "service_page";

    if (/luxury-villas|villas-de-lujo|second-hand|segunda-mano|seconda-mano|tweedehands|doccasion/.test(segment) && hasProperties) {
      result.suggested_target_url = sectionTarget(language, "properties");
      result.suggestion_basis = "Legacy landing is property-led and the closest validated target is the properties index.";
      result.confidence = "medium";
      result.manual_review_required = "no";
      return result;
    }

    result.suggestion_basis = "Legacy rentals or vacation landing has no clearly validated equivalent in the new site.";
    result.notes += " Rentals or vacation landing kept for manual review.";
    return result;
  }

  if (isProjectLikeText(joined)) {
    result.category = "project";
    result.suggested_target_url = hasProjects ? sectionTarget(language, "projects") : "";
    result.suggestion_basis = "Legacy URL strongly signals a project or promotion page, so the projects index is the safest live target.";
    result.confidence = result.suggested_target_url ? "medium" : "low";
    result.manual_review_required = result.suggested_target_url ? "no" : "yes";
    return result;
  }

  if (/^\w[\w-]*$/.test(segment) || context.decodedSegments.length > 0) {
    result.category = "post";
    result.suggestion_basis = "Legacy editorial-looking URL does not have a clearly validated equivalent in the new site audit.";
    result.notes += " Post candidate kept for manual review.";
    return result;
  }

  result.category = "unknown";
  result.suggestion_basis = "URL pattern does not map cleanly to a validated section or known equivalent.";
  result.notes += " Unknown pattern kept for manual review.";
  return result;
}

function mergeRow(oldUrl, targetUrl, redirectType, source, confidence, status, notes) {
  return {
    old_url: oldUrl,
    target_url: targetUrl,
    redirect_type: redirectType,
    source,
    confidence,
    status,
    notes,
  };
}

async function main() {
  const [coreRaw, propertiesRaw, gscRaw, auditRaw] = await Promise.all([
    fs.readFile(CORE_PATH, "utf8"),
    fs.readFile(PROPERTIES_PATH, "utf8"),
    fs.readFile(GSC_PRIORITY_PATH, "utf8"),
    fs.readFile(SEO_AUDIT_PATH, "utf8"),
  ]);

  const coreRows = readCsvRows(coreRaw);
  const propertyRows = readCsvRows(propertiesRaw);
  const gscRows = readCsvRows(gscRaw);
  const auditRows = readCsvRows(auditRaw);

  const auditUrls = new Set(auditRows.map((row) => normalizeUrl(row.new_url)).filter(Boolean));
  const existingOldUrls = new Set([
    ...coreRows.map((row) => normalizeUrl(row.old_url)),
    ...propertyRows.map((row) => normalizeUrl(row.old_url)),
  ]);

  const missingCandidates = gscRows
    .filter(
      (row) =>
        ["critical", "medium"].includes(String(row.migration_priority ?? "").trim()) &&
        String(row.redirect_status ?? "").trim() === "missing_redirect",
    )
    .map((row) => {
      const normalizedOldUrl = normalizeUrl(row.old_url);
      const clicks = parseInteger(row.clicks);
      const impressions = parseInteger(row.impressions);
      const classified = classifyCandidate(normalizedOldUrl, clicks, impressions, auditUrls);

      return {
        old_url: normalizedOldUrl,
        clicks: clicks,
        impressions: impressions,
        category: classified.category,
        language: classified.language,
        suggested_target_url: classified.suggested_target_url,
        suggestion_basis: classified.suggestion_basis,
        confidence: classified.confidence,
        manual_review_required: classified.manual_review_required,
        notes: classified.notes,
      };
    })
    .sort((left, right) => {
      if ((right.clicks || 0) !== (left.clicks || 0)) {
        return (right.clicks || 0) - (left.clicks || 0);
      }
      if ((right.impressions || 0) !== (left.impressions || 0)) {
        return (right.impressions || 0) - (left.impressions || 0);
      }
      return left.old_url.localeCompare(right.old_url);
    });

  const mergedMap = new Map();

  for (const row of coreRows) {
    const oldUrl = normalizeUrl(row.old_url);
    const targetUrl = normalizeUrl(row.target_url);
    if (!oldUrl || !targetUrl) continue;
    const confidence = row.status === "approved" ? "high" : "medium";
    mergedMap.set(
      oldUrl,
      mergeRow(oldUrl, targetUrl, row.redirect_type || "301", "core", confidence, row.status, row.notes),
    );
  }

  for (const row of propertyRows) {
    const oldUrl = normalizeUrl(row.old_url);
    const targetUrl = normalizeUrl(row.target_url);
    if (!oldUrl || !targetUrl || row.status === "manual_review_hold") continue;
    if (mergedMap.has(oldUrl)) continue;
    const confidence = row.status === "approved" && row.match_strategy === "exact_property_match" ? "high" : "medium";
    mergedMap.set(
      oldUrl,
      mergeRow(oldUrl, targetUrl, row.redirect_type || "301", "properties", confidence, row.status, row.notes),
    );
  }

  for (const row of missingCandidates) {
    const oldUrl = normalizeUrl(row.old_url);
    const targetUrl = normalizeUrl(row.suggested_target_url);
    if (!oldUrl || !targetUrl || row.manual_review_required === "yes") continue;
    if (existingOldUrls.has(oldUrl) || mergedMap.has(oldUrl)) continue;
    mergedMap.set(
      oldUrl,
      mergeRow(
        oldUrl,
        targetUrl,
        "301",
        "gsc_missing",
        row.confidence,
        "proposed_from_gsc_missing",
        `${row.suggestion_basis} ${row.notes}`.trim(),
      ),
    );
  }

  const mergedRows = [...mergedMap.values()].sort((left, right) => left.old_url.localeCompare(right.old_url));

  await Promise.all([
    fs.writeFile(MISSING_OUTPUT, toCsv(MISSING_HEADERS, missingCandidates), "utf8"),
    fs.writeFile(MERGED_OUTPUT, toCsv(MERGED_HEADERS, mergedRows), "utf8"),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
