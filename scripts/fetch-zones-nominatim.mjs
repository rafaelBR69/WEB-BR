import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PROPERTIES_DIR = path.join(ROOT, "src", "data", "properties");
const ZONES_PATH = path.join(ROOT, "public", "data", "zones.geojson");

const DEFAULT_CONTEXT = {
  county: "Malaga",
  state: "Andalucia",
  country: "Spain",
  countrycodes: "es",
};

const DEFAULT_EXTRA_CITIES = ["Marbella"];

const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  "web-br/1.0 (contact: equipo@blancareal.com)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const slugify = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const roundCoordValue = (num) => Number(Number(num).toFixed(6));

const roundGeometry = (geometry) => {
  if (!geometry || !geometry.coordinates) return geometry;
  const roundDeep = (coords) =>
    Array.isArray(coords[0])
      ? coords.map(roundDeep)
      : [roundCoordValue(coords[0]), roundCoordValue(coords[1])];
  return {
    ...geometry,
    coordinates: roundDeep(geometry.coordinates),
  };
};

const readCitiesFromProperties = () => {
  const files = fs
    .readdirSync(PROPERTIES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(PROPERTIES_DIR, entry.name));

  const cities = new Set();
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    const city = data?.location?.city;
    if (city) cities.add(String(city).trim());
  }
  return [...cities];
};

const readCitiesFromExistingZones = () => {
  if (!fs.existsSync(ZONES_PATH)) return [];
  try {
    const raw = fs.readFileSync(ZONES_PATH, "utf8");
    const data = JSON.parse(raw);
    return (data?.features || [])
      .map((feature) => String(feature?.properties?.name || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const uniqueCities = () => {
  const fromProperties = readCitiesFromProperties();
  const fromExisting = readCitiesFromExistingZones();
  const fromDefaults = DEFAULT_EXTRA_CITIES;
  const unique = new Map();
  for (const city of [...fromProperties, ...fromExisting, ...fromDefaults]) {
    const key = slugify(city);
    if (!key) continue;
    if (!unique.has(key)) unique.set(key, city);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
};

const buildQueryUrl = (city, context) => {
  const params = new URLSearchParams({
    format: "jsonv2",
    polygon_geojson: "1",
    limit: "8",
    city,
    county: context.county,
    state: context.state,
    country: context.country,
    countrycodes: context.countrycodes,
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
};

const fallbackQueryUrl = (city, context) => {
  const params = new URLSearchParams({
    format: "jsonv2",
    polygon_geojson: "1",
    limit: "8",
    city,
    country: context.country,
    countrycodes: context.countrycodes,
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
};

const isPolygonGeometry = (candidate) =>
  candidate?.geojson &&
  (candidate.geojson.type === "Polygon" ||
    candidate.geojson.type === "MultiPolygon");

const pickBestResult = (items, city) => {
  const normalizedCity = slugify(city);
  const filtered = (items || []).filter(isPolygonGeometry);
  if (!filtered.length) return null;

  const exact = filtered.find((item) => {
    const display = slugify(item.display_name || "");
    return display.includes(normalizedCity);
  });

  return exact || filtered[0];
};

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

const fetchCityBoundary = async (city, context) => {
  const primaryUrl = buildQueryUrl(city, context);
  const fallbackUrl = fallbackQueryUrl(city, context);

  let data = [];
  try {
    data = await fetchJson(primaryUrl);
  } catch {
    data = [];
  }

  let picked = pickBestResult(data, city);
  if (!picked) {
    try {
      const fallbackData = await fetchJson(fallbackUrl);
      picked = pickBestResult(fallbackData, city);
    } catch {
      picked = null;
    }
  }

  if (!picked) return null;

  return {
    type: "Feature",
    properties: {
      id: slugify(city),
      name: city,
      source: "nominatim",
      osm_type: picked.osm_type || "",
      osm_id: String(picked.osm_id || ""),
    },
    geometry: roundGeometry(picked.geojson),
  };
};

const run = async () => {
  const cities = uniqueCities();
  if (!cities.length) {
    throw new Error("No se encontraron ciudades para generar zonas.");
  }

  console.log(`Generando zonas reales para ${cities.length} ciudades...`);
  const features = [];
  const failed = [];

  for (const city of cities) {
    process.stdout.write(`- ${city}... `);
    const feature = await fetchCityBoundary(city, DEFAULT_CONTEXT);
    if (feature) {
      features.push(feature);
      console.log("ok");
    } else {
      failed.push(city);
      console.log("sin resultado");
    }
    await sleep(1100);
  }

  const collection = {
    type: "FeatureCollection",
    generated_at: new Date().toISOString(),
    source: "Nominatim OpenStreetMap",
    features: features.sort((a, b) =>
      String(a.properties?.name || "").localeCompare(
        String(b.properties?.name || "")
      )
    ),
  };

  fs.mkdirSync(path.dirname(ZONES_PATH), { recursive: true });
  fs.writeFileSync(ZONES_PATH, `${JSON.stringify(collection, null, 2)}\n`);

  console.log(`\nZonas guardadas en ${ZONES_PATH}`);
  console.log(`Total zonas generadas: ${features.length}`);
  if (failed.length) {
    console.log(`Ciudades sin resultado: ${failed.join(", ")}`);
  }
};

run().catch((error) => {
  console.error("Error generando zonas:", error.message);
  process.exit(1);
});
