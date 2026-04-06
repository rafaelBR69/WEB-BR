import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const REPORT_PATH = path.join(ROOT_DIR, "docs", "translation-audit-report.md");
const WRITE_JSON_FIXES = process.argv.includes("--write-json-fixes");
const WRITE_SOURCE_FIXES = process.argv.includes("--write-source-fixes");

const SOURCE_GROUPS = [
  { name: "src/i18n", roots: ["src/i18n"] },
  { name: "apps/web pages", roots: ["apps/web/src/pages/[lang]"] },
  { name: "src/data", roots: ["src/data"] },
  { name: "shared page data", roots: ["packages/shared/src/data/pages"] },
];

const REPORT_EXTENSIONS = new Set([".astro", ".ts", ".js", ".json"]);
const JSON_FIXABLE_ROOTS = new Set([
  path.join(ROOT_DIR, "src", "data"),
  path.join(ROOT_DIR, "packages", "shared", "src", "data", "pages"),
]);

const NON_VISIBLE_STACK_KEYS = new Set([
  "slug",
  "slugs",
  "href",
  "url",
  "image",
  "images",
  "canonicalPath",
  "path",
]);

const ENCODING_REPLACEMENTS = [
  ["â€œ", "“"],
  ["â€", "”"],
  ["â€˜", "‘"],
  ["â€™", "’"],
  ["â€”", "—"],
  ["â€“", "–"],
  ["â€¦", "…"],
  ["ÃƒÂ«", "ë"],
  ["ÃƒÂ¨", "è"],
  ["ÃƒÂ©", "é"],
  ["ÃƒÂ¶", "ö"],
  ["ÃƒÂ¼", "ü"],
  ["Â¿", "¿"],
  ["Â¡", "¡"],
  ["Â·", "·"],
  ["Ã", "Á"],
  ["Ã‰", "É"],
  ["Ã", "Í"],
  ["Ã“", "Ó"],
  ["Ãš", "Ú"],
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ã‘", "Ñ"],
  ["Ã±", "ñ"],
  ["Ãœ", "Ü"],
  ["Ã¼", "ü"],
  ["Ã„", "Ä"],
  ["Ã¤", "ä"],
  ["Ã–", "Ö"],
  ["Ã¶", "ö"],
  ["Ã‹", "Ë"],
  ["Ã«", "ë"],
  ["Ã", "Ï"],
  ["Ã¯", "ï"],
  ["ÃŸ", "ß"],
];

const CONSISTENCY_TERMS = new Map([
  ["Telefono", "Teléfono"],
  ["Telefono de contacto", "Teléfono de contacto"],
  ["politica de privacidad", "política de privacidad"],
  ["Politica de privacidad", "Política de privacidad"],
  ["Comercializacion", "Comercialización"],
  ["comercializacion", "comercialización"],
  ["Portal de Agentes", "Portal de agentes"],
]);

const SPANISH_PHRASE_REPLACEMENTS = [
  ["Por que", "Por qué"],
  ["Que verifica", "Qué verifica"],
  ["Que incluye", "Qué incluye"],
  ["Que hemos", "Qué hemos"],
  ["Que mas", "Qué más"],
  ["Como funciona", "Cómo funciona"],
  ["Donde estamos", "Dónde estamos"],
  ["Quienes somos", "Quiénes somos"],
  ["Cuentanos", "Cuéntanos"],
  ["Dejanos", "Déjanos"],
  ["Mas abajo", "Más abajo"],
  ["Ficha rapida", "Ficha rápida"],
  ["Una vision", "Una visión"],
  ["Segun", "Según"],
  ["segun", "según"],
  ["politica de privacidad", "política de privacidad"],
  ["Politica de privacidad", "Política de privacidad"],
];

const SPANISH_TOKEN_REPLACEMENTS = new Map([
  ["Telefono", "Teléfono"],
  ["telefono", "teléfono"],
  ["politica", "política"],
  ["Politica", "Política"],
  ["tramites", "trámites"],
  ["Tramites", "Trámites"],
  ["captacion", "captación"],
  ["Captacion", "Captación"],
  ["coordinacion", "coordinación"],
  ["Coordinacion", "Coordinación"],
  ["documentacion", "documentación"],
  ["Documentacion", "Documentación"],
  ["representacion", "representación"],
  ["Representacion", "Representación"],
  ["comercializacion", "comercialización"],
  ["Comercializacion", "Comercialización"],
  ["promocion", "promoción"],
  ["Promocion", "Promoción"],
  ["seleccion", "selección"],
  ["Seleccion", "Selección"],
  ["ubicacion", "ubicación"],
  ["Ubicacion", "Ubicación"],
  ["localizacion", "localización"],
  ["Localizacion", "Localización"],
  ["analisis", "análisis"],
  ["Analisis", "Análisis"],
  ["guias", "guías"],
  ["Guias", "Guías"],
  ["asesoria", "asesoría"],
  ["Asesoria", "Asesoría"],
  ["sesion", "sesión"],
  ["Sesion", "Sesión"],
  ["contrasena", "contraseña"],
  ["Contrasena", "Contraseña"],
  ["razon", "razón"],
  ["Razon", "Razón"],
  ["juridico", "jurídico"],
  ["Juridico", "Jurídico"],
  ["juridica", "jurídica"],
  ["Juridica", "Jurídica"],
  ["juridicas", "jurídicas"],
  ["Juridicas", "Jurídicas"],
  ["juridicos", "jurídicos"],
  ["Juridicos", "Jurídicos"],
  ["acompanamiento", "acompañamiento"],
  ["Acompanamiento", "Acompañamiento"],
  ["acompanamos", "acompañamos"],
  ["Acompanamos", "Acompañamos"],
  ["acompana", "acompaña"],
  ["Acompana", "Acompaña"],
  ["acompanar", "acompañar"],
  ["Acompanar", "Acompañar"],
  ["compania", "compañía"],
  ["Compania", "Compañía"],
  ["campanas", "campañas"],
  ["Campanas", "Campañas"],
  ["senal", "señal"],
  ["Senal", "Señal"],
  ["senales", "señales"],
  ["Senales", "Señales"],
  ["contrasena", "contraseña"],
  ["vision", "visión"],
  ["Vision", "Visión"],
  ["rapida", "rápida"],
  ["Rapida", "Rápida"],
  ["notaria", "notaría"],
  ["Notaria", "Notaría"],
  ["energia", "energía"],
  ["Energia", "Energía"],
  ["aereas", "aéreas"],
  ["Aereas", "Aéreas"],
  ["mas", "más"],
  ["Mas", "Más"],
  ["facil", "fácil"],
  ["Facil", "Fácil"],
  ["maximo", "máximo"],
  ["Maximo", "Máximo"],
  ["operacion", "operación"],
  ["Operacion", "Operación"],
  ["operacion.", "operación."],
  ["operacion,", "operación,"],
  ["operacion:", "operación:"],
  ["valoracion", "valoración"],
  ["Valoracion", "Valoración"],
  ["regularizacion", "regularización"],
  ["Regularizacion", "Regularización"],
  ["revision", "revisión"],
  ["Revision", "Revisión"],
  ["difusion", "difusión"],
  ["Difusion", "Difusión"],
  ["intencion", "intención"],
  ["Intencion", "Intención"],
  ["economica", "económica"],
  ["Economica", "Económica"],
  ["aerea", "aérea"],
  ["Aerea", "Aérea"],
  ["deteccion", "detección"],
  ["Deteccion", "Detección"],
  ["via", "vía"],
  ["Via", "Vía"],
  ["estres", "estrés"],
  ["Estres", "Estrés"],
  ["Malaga", "Málaga"],
  ["Espana", "España"],
  ["Cadiz", "Cádiz"],
  ["Jaen", "Jaén"],
  ["Belgica", "Bélgica"],
  ["Serrania", "Serranía"],
  ["Velez", "Vélez"],
  ["Maria", "María"],
  ["Noemi", "Noemí"],
  ["Cristobal", "Cristóbal"],
  ["Cordobes", "Cordobés"],
  ["cordobes", "cordobés"],
  ["italo-aleman", "italo-alemán"],
  ["nacio", "nació"],
  ["Nacio", "Nació"],
  ["crecio", "creció"],
  ["Crecio", "Creció"],
  ["estudio", "estudió"],
  ["Estudio", "Estudió"],
  ["perfeccion", "perfección"],
  ["Perfeccion", "Perfección"],
  ["pasion", "pasión"],
  ["Pasion", "Pasión"],
  ["imagenes", "imágenes"],
  ["Imagenes", "Imágenes"],
  ["fotografica", "fotográfica"],
  ["Fotografica", "Fotográfica"],
  ["anos", "años"],
  ["Anos", "Años"],
  ["ademas", "además"],
  ["Ademas", "Además"],
  ["tambien", "también"],
  ["Tambien", "También"],
  ["relacion", "relación"],
  ["Relacion", "Relación"],
  ["suenos", "sueños"],
  ["Suenos", "Sueños"],
  ["montana", "montaña"],
  ["Montana", "Montaña"],
  ["expresion", "expresión"],
  ["Expresion", "Expresión"],
  ["despues", "después"],
  ["Despues", "Después"],
  ["dia", "día"],
  ["Dia", "Día"],
  ["comunicara", "comunicará"],
  ["Comunicara", "Comunicará"],
  ["espanol", "español"],
  ["Espanol", "Español"],
  ["abogacia", "abogacía"],
  ["Abogacia", "Abogacía"],
  ["demas", "demás"],
  ["Demas", "Demás"],
  ["eligio", "eligió"],
  ["Eligio", "Eligió"],
  ["autentico", "auténtico"],
  ["Autentico", "Auténtico"],
  ["tecnologia", "tecnología"],
  ["Tecnologia", "Tecnología"],
  ["dedicacion", "dedicación"],
  ["Dedicacion", "Dedicación"],
  ["ambicion", "ambición"],
  ["Ambicion", "Ambición"],
  ["comod", "cómod"],
  ["padel", "pádel"],
  ["Padel", "Pádel"],
  ["habitos", "hábitos"],
  ["Habitos", "Hábitos"],
  ["economia", "economía"],
  ["Economia", "Economía"],
  ["alegria", "alegría"],
  ["Alegria", "Alegría"],
  ["motivation", "motivación"],
  ["motivacion", "motivación"],
  ["Motivacion", "Motivación"],
  ["empatica", "empática"],
  ["Empatica", "Empática"],
  ["carinosa", "cariñosa"],
  ["Carinosa", "Cariñosa"],
  ["formacion", "formación"],
  ["Formacion", "Formación"],
  ["organizacion", "organización"],
  ["Organizacion", "Organización"],
  ["atencion", "atención"],
  ["Atencion", "Atención"],
  ["gestion", "gestión"],
  ["Gestion", "Gestión"],
]);

const FORMALITY_PATTERNS = {
  es: [
    {
      pattern: /Hablemos de tu operaci[oó]n/u,
      detected: "Hablemos de tu operación",
      proposed: "Hablemos de su operación",
      type: "formal_pronouns",
    },
    {
      pattern: /Te contactaremos/u,
      detected: "Te contactaremos",
      proposed: "Le contactaremos",
      type: "formal_pronouns",
    },
    {
      pattern: /Tus datos/u,
      detected: "Tus datos",
      proposed: "Sus datos",
      type: "formal_pronouns",
    },
    {
      pattern: /D[eé]janos tu email/u,
      detected: "Déjanos tu email",
      proposed: "Déjenos su email",
      type: "formal_pronouns",
    },
    {
      pattern: /Cu[eé]ntanos/u,
      detected: "Cuéntanos",
      proposed: "Indíquenos",
      type: "informal_cta",
    },
    {
      pattern: /Entra con tu cuenta/u,
      detected: "Entra con tu cuenta",
      proposed: "Acceda con su cuenta",
      type: "formal_pronouns",
    },
    {
      pattern: /Rellena tus datos/u,
      detected: "Rellena tus datos",
      proposed: "Complete sus datos",
      type: "formal_pronouns",
    },
    {
      pattern: /Encuentra tu propiedad ideal/u,
      detected: "Encuentra tu propiedad ideal",
      proposed: "Encuentre la propiedad ideal",
      type: "informal_cta",
    },
    {
      pattern: /Contactanos/u,
      detected: "Contactanos",
      proposed: "Contáctenos",
      type: "informal_cta",
    },
    {
      pattern: /Buscas propiedades/u,
      detected: "Buscas propiedades",
      proposed: "¿Busca propiedades?",
      type: "informal_cta",
    },
    {
      pattern: /Te asesoramos/u,
      detected: "Te asesoramos",
      proposed: "Le asesoramos",
      type: "formal_pronouns",
    },
    {
      pattern: /Te acompa[nñ]amos/u,
      detected: "Te acompañamos",
      proposed: "Le acompañamos",
      type: "formal_pronouns",
    },
    {
      pattern: /tu solicitud/u,
      detected: "tu solicitud",
      proposed: "su solicitud",
      type: "formal_pronouns",
    },
    {
      pattern: /tu compra/u,
      detected: "tu compra",
      proposed: "su compra",
      type: "formal_pronouns",
    },
    {
      pattern: /tu vivienda/u,
      detected: "tu vivienda",
      proposed: "la vivienda",
      type: "formal_pronouns",
    },
    {
      pattern: /tu propiedad/u,
      detected: "tu propiedad",
      proposed: "la propiedad",
      type: "formal_pronouns",
    },
  ],
  en: [
    {
      pattern: /Talk to the team/u,
      detected: "Talk to the team",
      proposed: "Contact the team",
      type: "informal_cta",
    },
    {
      pattern: /Talk to an agent/u,
      detected: "Talk to an agent",
      proposed: "Contact an agent",
      type: "informal_cta",
    },
    {
      pattern: /Talk to legal team/u,
      detected: "Talk to legal team",
      proposed: "Contact the legal team",
      type: "informal_cta",
    },
    {
      pattern: /Tell us/u,
      detected: "Tell us",
      proposed: "Describe",
      type: "informal_cta",
    },
    {
      pattern: /Leave your email/u,
      detected: "Leave your email",
      proposed: "Please share your email",
      type: "informal_cta",
    },
    {
      pattern: /Find your ideal property/u,
      detected: "Find your ideal property",
      proposed: "Find the right property",
      type: "informal_cta",
    },
  ],
  it: [
    {
      pattern: /la tua /u,
      detected: "la tua",
      proposed: "la Sua / formulazione neutra",
      type: "formal_pronouns",
    },
    {
      pattern: /I tuoi dati/u,
      detected: "I tuoi dati",
      proposed: "I Suoi dati",
      type: "formal_pronouns",
    },
    {
      pattern: /Ti contatteremo/u,
      detected: "Ti contatteremo",
      proposed: "La contatteremo",
      type: "formal_pronouns",
    },
    {
      pattern: /Raccontaci/u,
      detected: "Raccontaci",
      proposed: "Descriva",
      type: "informal_cta",
    },
    {
      pattern: /Parla con/u,
      detected: "Parla con",
      proposed: "Contatti",
      type: "informal_cta",
    },
    {
      pattern: /per te/u,
      detected: "per te",
      proposed: "formulazione neutra",
      type: "formal_pronouns",
    },
  ],
  nl: [
    {
      pattern: /jouw/u,
      detected: "jouw",
      proposed: "uw",
      type: "formal_pronouns",
    },
    {
      pattern: /je woning/u,
      detected: "je woning",
      proposed: "de woning / uw woning",
      type: "formal_pronouns",
    },
    {
      pattern: /Zoek je/u,
      detected: "Zoek je",
      proposed: "Zoekt u",
      type: "informal_cta",
    },
    {
      pattern: /Wij adviseren je/u,
      detected: "Wij adviseren je",
      proposed: "Wij adviseren u",
      type: "formal_pronouns",
    },
    {
      pattern: /met je/u,
      detected: "met je",
      proposed: "met u / formulering neutra",
      type: "formal_pronouns",
    },
  ],
};

const findings = [];
const inventory = [];

function escapeInline(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPreciseMatch(text, candidate) {
  if (/^[\p{L}]+$/u.test(candidate)) {
    const pattern = new RegExp(`(^|[^\\p{L}])${escapeRegex(candidate)}(?=$|[^\\p{L}])`, "u");
    return pattern.test(text);
  }
  return text.includes(candidate);
}

function inferLangFromPath(stack) {
  if (stack.includes("es")) return "es";
  if (stack.includes("en")) return "en";
  if (stack.includes("de")) return "de";
  if (stack.includes("fr")) return "fr";
  if (stack.includes("it")) return "it";
  if (stack.includes("nl")) return "nl";
  return "mixed";
}

function addFinding({ file, lang, type, detected, proposed, status }) {
  findings.push({
    file: path.relative(ROOT_DIR, file),
    property: inferPropertyId(file),
    lang,
    type,
    detected,
    proposed,
    status,
  });
}

function inferPropertyId(file) {
  const relative = path.relative(ROOT_DIR, file);
  if (!relative.startsWith(path.join("src", "data", "properties"))) {
    return "";
  }
  return path.basename(relative, path.extname(relative));
}

function isVisibleCopyStack(stack) {
  return !stack.some((segment) => NON_VISIBLE_STACK_KEYS.has(segment));
}

function replaceAll(value, replacements) {
  let next = value;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }
  return next;
}

function applySpanishFixes(input) {
  let next = input;

  for (const [from, to] of SPANISH_PHRASE_REPLACEMENTS) {
    next = next.split(from).join(to);
  }

  for (const [from, to] of SPANISH_TOKEN_REPLACEMENTS.entries()) {
    next = next.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }

  next = next.replace(/([¿¡])\s+/g, "$1");
  next = next.replace(/\s+\?/g, "?");

  return next;
}

function classifyReplacement(from) {
  if (from.includes("Ã") || from.includes("Â") || from.includes("â€") || from.includes("�")) {
    return "encoding";
  }
  if (CONSISTENCY_TERMS.has(from)) {
    return "consistency";
  }
  return "spanish_orthography";
}

function detectFormalityFindings(file, text, lang, status, stack = []) {
  if (stack.length && !isVisibleCopyStack(stack)) return;
  const patterns = FORMALITY_PATTERNS[lang] ?? [];
  for (const entry of patterns) {
    if (!entry.pattern.test(text)) continue;
    addFinding({
      file,
      lang,
      type: entry.type,
      detected: entry.detected,
      proposed: entry.proposed,
      status,
    });
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
      continue;
    }
    files.push(absolute);
  }
  return files;
}

function isInsideRoots(file, roots) {
  return roots.some((root) => file.startsWith(root));
}

function shouldFixJson(file) {
  return file.endsWith(".json") && isInsideRoots(file, [...JSON_FIXABLE_ROOTS]);
}

function scanPlainTextFile(file, content) {
  const patterns = [
    ...ENCODING_REPLACEMENTS.map(([from, to]) => ({ from, to, type: "encoding", lang: "mixed" })),
    ...[...CONSISTENCY_TERMS.entries()].map(([from, to]) => ({
      from,
      to,
      type: "consistency",
      lang: "es",
    })),
    ...SPANISH_PHRASE_REPLACEMENTS.map(([from, to]) => ({
      from,
      to,
      type: "spanish_orthography",
      lang: "es",
    })),
  ];

  for (const { from, to, type, lang } of patterns) {
    if (!hasPreciseMatch(content, from)) continue;
    addFinding({
      file,
      lang,
      type,
      detected: from,
      proposed: to,
      status: "pending",
    });
  }
}

function findLanguageBlocks(content) {
  const blocks = [];
  const pattern = /\b(es|en|de|fr|it|nl):\s*\{/g;
  let match;

  while ((match = pattern.exec(content))) {
    const lang = match[1];
    const openBraceIndex = content.indexOf("{", match.index);
    if (openBraceIndex === -1) continue;

    let depth = 0;
    let quote = null;
    let escaped = false;
    let end = -1;

    for (let index = openBraceIndex; index < content.length; index += 1) {
      const char = content[index];

      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }

    if (end !== -1) {
      blocks.push({
        lang,
        start: openBraceIndex,
        end,
      });
      pattern.lastIndex = end + 1;
    }
  }

  return blocks;
}

function transformSourceContent(file, content) {
  const blocks = findLanguageBlocks(content);
  if (!blocks.length) {
    return { content, changed: false };
  }

  let changed = false;
  let nextContent = content;

  for (const block of [...blocks].reverse()) {
    const originalSlice = nextContent.slice(block.start, block.end + 1);
    let nextSlice = replaceAll(originalSlice, ENCODING_REPLACEMENTS);

    if (block.lang === "es") {
      nextSlice = applySpanishFixes(nextSlice);
    }

    if (nextSlice === originalSlice) continue;

    changed = true;
    nextContent =
      nextContent.slice(0, block.start) +
      nextSlice +
      nextContent.slice(block.end + 1);

    if (originalSlice !== replaceAll(originalSlice, ENCODING_REPLACEMENTS)) {
      for (const [from, to] of ENCODING_REPLACEMENTS) {
        if (!hasPreciseMatch(originalSlice, from)) continue;
        addFinding({
          file,
          lang: block.lang,
          type: "encoding",
          detected: from,
          proposed: to,
          status: WRITE_SOURCE_FIXES ? "fixed" : "pending",
        });
      }
    }

    if (block.lang === "es") {
      const checks = [
        ...CONSISTENCY_TERMS.entries(),
        ...SPANISH_PHRASE_REPLACEMENTS,
        ...SPANISH_TOKEN_REPLACEMENTS.entries(),
      ];
      for (const [from, to] of checks) {
        if (!hasPreciseMatch(originalSlice, from)) continue;
        addFinding({
          file,
          lang: "es",
          type: classifyReplacement(from),
          detected: from,
          proposed: to,
          status: WRITE_SOURCE_FIXES ? "fixed" : "pending",
        });
      }
    }

    detectFormalityFindings(file, nextSlice, block.lang, "pending");
  }

  return { content: nextContent, changed };
}

function transformJsonValue(file, value, stack) {
  if (typeof value === "string") {
    let next = value;
    let changed = false;

    const fixedEncoding = replaceAll(next, ENCODING_REPLACEMENTS);
    if (fixedEncoding !== next) {
      for (const [from, to] of ENCODING_REPLACEMENTS) {
        if (!hasPreciseMatch(next, from)) continue;
        addFinding({
          file,
          lang: inferLangFromPath(stack),
          type: "encoding",
          detected: from,
          proposed: to,
          status: WRITE_JSON_FIXES ? "fixed" : "pending",
        });
      }
      next = fixedEncoding;
      changed = true;
    }

    if (inferLangFromPath(stack) === "es") {
      const beforeSpanish = next;
      const fixedSpanish = applySpanishFixes(next);
      if (fixedSpanish !== beforeSpanish) {
        const checks = [
          ...CONSISTENCY_TERMS.entries(),
          ...SPANISH_PHRASE_REPLACEMENTS,
          ...SPANISH_TOKEN_REPLACEMENTS.entries(),
        ];
        for (const [from, to] of checks) {
          if (!hasPreciseMatch(beforeSpanish, from)) continue;
          addFinding({
            file,
            lang: "es",
            type: classifyReplacement(from),
            detected: from,
            proposed: to,
            status: WRITE_JSON_FIXES ? "fixed" : "pending",
          });
        }
        next = fixedSpanish;
        changed = true;
      }
    }

    detectFormalityFindings(file, next, inferLangFromPath(stack), "pending", stack);

    return { value: next, changed };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item, index) => {
      const transformed = transformJsonValue(file, item, [...stack, String(index)]);
      changed ||= transformed.changed;
      return transformed.value;
    });
    return { value: next, changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      const transformed = transformJsonValue(file, child, [...stack, key]);
      changed ||= transformed.changed;
      next[key] = transformed.value;
    }
    return { value: next, changed };
  }

  return { value, changed: false };
}

async function run() {
  const allFiles = [];
  for (const group of SOURCE_GROUPS) {
    const resolvedRoots = group.roots.map((root) => path.join(ROOT_DIR, root));
    let count = 0;
    for (const root of resolvedRoots) {
      try {
        const files = await walk(root);
        const filtered = files.filter((file) => REPORT_EXTENSIONS.has(path.extname(file)));
        count += filtered.length;
        allFiles.push(...filtered);
      } catch {}
    }
    inventory.push({ group: group.name, files: count });
  }

  const uniqueFiles = [...new Set(allFiles)].sort((a, b) => a.localeCompare(b));

  for (const file of uniqueFiles) {
    const rawContent = await fs.readFile(file, "utf8");
    const content = rawContent.replace(/^\uFEFF/, "");
    if (shouldFixJson(file)) {
      const parsed = JSON.parse(content);
      const transformed = transformJsonValue(file, parsed, []);
      if (WRITE_JSON_FIXES && transformed.changed) {
        await fs.writeFile(file, `${JSON.stringify(transformed.value, null, 2)}\n`, "utf8");
      }
      continue;
    }

    const hasLanguageBlocks = findLanguageBlocks(content).length > 0;

    if (WRITE_SOURCE_FIXES) {
      const transformed = transformSourceContent(file, content);
      if (transformed.changed) {
        await fs.writeFile(file, transformed.content, "utf8");
        continue;
      }
    }

    if (hasLanguageBlocks) {
      continue;
    }

    scanPlainTextFile(file, content);
  }

  findings.sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.lang.localeCompare(b.lang) ||
    a.type.localeCompare(b.type) ||
    a.detected.localeCompare(b.detected)
  );

  const summary = new Map();
  for (const finding of findings) {
    const key = `${finding.type}:${finding.status}`;
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }

  const lines = [
    "# Translation Audit Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Inventory",
    "",
    "| Grupo | Archivos |",
    "| --- | ---: |",
    ...inventory.map((row) => `| ${row.group} | ${row.files} |`),
    "",
    "## Summary",
    "",
    "| Tipo:estado | Total |",
    "| --- | ---: |",
    ...(summary.size
      ? [...summary.entries()].map(([key, total]) => `| ${key} | ${total} |`)
      : ["| clean | 0 |"]),
    "",
    "## Findings",
    "",
    "| archivo | propiedad | idioma | tipo | texto detectado | corrección propuesta | estado |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(findings.length
      ? findings.map(
          (row) =>
            `| ${escapeInline(row.file)} | ${escapeInline(row.property || "-")} | ${row.lang} | ${row.type} | ${escapeInline(row.detected)} | ${escapeInline(row.proposed)} | ${row.status} |`
        )
      : ["| - | - | - | - | - | - | clean |"]),
    "",
  ];

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, lines.join("\n"), "utf8");

  process.stdout.write(
    `translation-audit: ${findings.length} findings, report written to ${path.relative(ROOT_DIR, REPORT_PATH)}\n`
  );
}

await run();
