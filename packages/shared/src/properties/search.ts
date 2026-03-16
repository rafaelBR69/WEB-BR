const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const NON_WORD_REGEX = /[^\p{L}\p{N}]+/gu;
const SEARCH_SYNONYM_GROUPS = [
  ["atico", "penthouse", "attic", "ph"],
  ["piso", "pisos", "apartamento", "apartamentos", "apartment", "apartments", "flat", "flats"],
  ["duplex", "maisonette"],
  ["villa", "villas", "house", "houses", "casa", "casas", "maison", "maisons", "haus", "huizen", "woning", "woningen"],
  ["adosado", "adosada", "townhouse", "townhome", "terraced house"],
  ["pareado", "pareada", "semi detached", "semi detached house", "semi detached villa"],
  ["finca", "country house", "rural home", "rustic home"],
  ["bajo", "planta baja", "ground floor", "garden apartment"],
  ["obra", "newbuild", "new", "nieuwbouw", "neubau", "neuf"],
  ["nueva", "newbuild", "new", "nieuwbouw", "neubau", "neuf"],
  ["obra nueva", "new build", "newbuild", "new development", "off plan"],
  ["promocion", "promociones", "promotion", "promotions", "development", "developments", "project", "projects"],
  ["reventa", "resale", "segunda mano", "existing home"],
  ["lujo", "luxury", "premium", "prestige", "exclusive", "exclusivo"],
  ["playa", "beach", "beachfront", "strand", "plage", "spiaggia"],
  ["mar", "sea", "ocean", "mediterranean", "meer"],
  ["vistas al mar", "sea view", "sea views", "ocean view", "ocean views"],
  ["frontal mar", "first line beach", "front line beach", "beachfront"],
  ["primera linea", "first line", "front line"],
  ["golf", "golfe"],
  ["primera linea golf", "first line golf", "front line golf", "golf front"],
  ["llave en mano", "turnkey", "key ready", "move in ready", "ready to move in"],
  ["inversion", "investment", "investor", "yield", "roi", "rentabilidad"],
  ["solarium", "roof terrace", "sun deck"],
  ["terraza", "terrace", "teras", "terrasse"],
  ["garaje", "garage", "parking", "car space"],
  ["trastero", "storage room", "store room"],
  ["mijas costa", "mijas", "mijas coast"],
  ["la cala", "la cala de mijas"],
  ["las lagunas", "las lagunas de mijas"],
  ["torreblanca", "torreblanca del sol"],
  ["manilva sotogrande", "manilva - sotogrande", "sotogrande"],
  ["benalmadena costa", "benalmadena"],
  ["malaga centro", "malaga"],
  ["sur", "south", "south facing", "southern exposure"],
  ["norte", "north", "north facing"],
  ["este", "east", "east facing"],
  ["oeste", "west", "west facing"],
  ["sureste", "south east", "southeast", "south east facing", "southeast facing"],
  ["suroeste", "south west", "southwest", "south west facing", "southwest facing"],
  ["noreste", "north east", "northeast", "north east facing", "northeast facing"],
  ["noroeste", "north west", "northwest", "north west facing", "northwest facing"],
];

const SEARCH_SYNONYM_MAP = new Map(
  SEARCH_SYNONYM_GROUPS.flatMap((group) => {
    const normalizedGroup = group.map((term) => normalizeSearchText(term)).filter(Boolean);
    return normalizedGroup.map((term) => [term, normalizedGroup]);
  })
);

export function normalizeSearchText(value: unknown): string {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .replace(NON_WORD_REGEX, " ")
    .trim();
}

export function tokenizeSearchText(value: unknown): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

export function buildSearchPhrases(value: unknown, maxWords = 3): string[] {
  const tokens = tokenizeSearchText(value);
  const phrases: string[] = [];

  for (let size = 2; size <= maxWords; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      phrases.push(tokens.slice(index, index + size).join(" "));
    }
  }

  return Array.from(new Set(phrases));
}

export function expandSearchTerm(term: unknown): string[] {
  const normalized = normalizeSearchText(term);
  if (!normalized) return [];
  const synonyms = SEARCH_SYNONYM_MAP.get(normalized) ?? [normalized];
  return Array.from(new Set([normalized, ...synonyms]));
}

const getTypoThreshold = (term: string) => {
  if (term.length <= 4) return 0;
  if (term.length <= 7) return 1;
  return 2;
};

const getEditDistance = (left: string, right: string) => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
};

const scoreCandidateAgainstToken = (candidate: string, token: string) => {
  if (!candidate || !token) return 0;
  if (token === candidate) return 12;
  if (token.startsWith(candidate) || candidate.startsWith(token)) return 9;
  if (token.includes(candidate) || candidate.includes(token)) return 7;
  if (candidate.length < 5 || token.length < 5) return 0;

  const threshold = getTypoThreshold(candidate);
  if (!threshold) return 0;
  const distance = getEditDistance(candidate, token);
  if (distance > threshold) return 0;
  return threshold === 1 ? 5 : 4;
};

export function scoreSearchQueryMatch(
  rawQuery: unknown,
  haystack: unknown,
  rawTokens: unknown
): { matched: boolean; score: number; terms: string[] } {
  const normalizedQuery = normalizeSearchText(rawQuery);
  const haystackText = normalizeSearchText(haystack);
  const tokens = Array.isArray(rawTokens)
    ? rawTokens.map((token) => normalizeSearchText(token)).filter(Boolean)
    : tokenizeSearchText(haystackText);
  const terms = tokenizeSearchText(normalizedQuery);
  const phrases = buildSearchPhrases(normalizedQuery);

  if (!terms.length) {
    return { matched: true, score: 0, terms: [] };
  }

  let score = 0;
  const matchedTerms = new Set<string>();

  for (const phrase of [normalizedQuery, ...phrases]) {
    const candidates = expandSearchTerm(phrase);
    let bestScore = 0;

    for (const candidate of candidates) {
      if (haystackText.includes(candidate)) {
        bestScore = Math.max(bestScore, phrase === normalizedQuery ? 16 : 13);
      }
      for (const token of tokens) {
        bestScore = Math.max(bestScore, scoreCandidateAgainstToken(candidate, token));
      }
    }

    if (bestScore === 0) continue;

    phrase.split(" ").forEach((term) => matchedTerms.add(term));
    score += bestScore;
  }

  for (const term of terms) {
    if (matchedTerms.has(term)) continue;

    const candidates = expandSearchTerm(term);
    let bestScore = 0;

    for (const candidate of candidates) {
      if (haystackText.includes(candidate)) {
        bestScore = Math.max(bestScore, 8);
      }
      for (const token of tokens) {
        bestScore = Math.max(bestScore, scoreCandidateAgainstToken(candidate, token));
      }
    }

    if (bestScore === 0) {
      return { matched: false, score: 0, terms };
    }

    score += bestScore;
  }

  if (normalizedQuery && haystackText.includes(normalizedQuery)) {
    score += Math.min(10, terms.length * 3);
  }

  return { matched: true, score, terms };
}

export function buildSearchText(property: any): string {
  if (!property) return "";

  const translations = property.translations ?? {};
  const translationText = Object.values(translations)
    .map((entry: any) => {
      if (!entry) return "";
      const description = Array.isArray(entry.description)
        ? entry.description.map((block: any) => block?.text ?? "").join(" ")
        : "";
      return [entry.title, entry.intro, description].filter(Boolean).join(" ");
    })
    .join(" ");

  const location = property.location ?? {};
  const raw = property.property ?? {};

  return [
    translationText,
    location.country,
    location.province,
    location.city,
    location.area,
    raw.type,
    raw.floor_label,
    raw.orientation,
    raw.bedrooms,
    raw.bathrooms,
    raw.area_m2,
    raw.market,
    property.listing_type,
    property.status,
    Array.isArray(property.features) ? property.features.join(" ") : "",
    property.id,
    property.parent_id,
    property.slugs ? Object.values(property.slugs).join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ");
}
