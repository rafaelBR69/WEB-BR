import { writeFile } from "node:fs/promises";

const DEFAULT_BBOX = [-5.65, 36.2, -4.15, 36.85]; // Costa del Sol
const OUTPUT_PATH = "public/data/pois.geojson";

const categories = {
  restaurant: [
    '["amenity"="restaurant"]',
    '["amenity"="cafe"]',
    '["amenity"="bar"]'
  ],
  hospital: [
    '["amenity"="hospital"]',
    '["amenity"="clinic"]',
    '["healthcare"="hospital"]'
  ],
  school: [
    '["amenity"="school"]',
    '["amenity"="college"]',
    '["amenity"="university"]'
  ],
  pharmacy: [
    '["amenity"="pharmacy"]'
  ],
  leisure: [
    '["leisure"~"sports_centre|fitness_centre|stadium|golf_course|marina"]',
    '["tourism"~"attraction|museum|theme_park|zoo|aquarium"]'
  ]
};

const argBbox = process.argv.find((arg) => arg.startsWith("--bbox="));
const bbox = argBbox
  ? argBbox.replace("--bbox=", "").split(",").map(Number)
  : DEFAULT_BBOX;

if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => Number.isNaN(n))) {
  throw new Error("Invalid bbox. Use --bbox=minLon,minLat,maxLon,maxLat");
}

const [minLon, minLat, maxLon, maxLat] = bbox;
const areaBbox = `${minLat},${minLon},${maxLat},${maxLon}`;

const buildCategoryQuery = (tag) => `
  node${tag}(${areaBbox});
  way${tag}(${areaBbox});
  relation${tag}(${areaBbox});
`;

const query = `
[out:json][timeout:120];
(
${Object.values(categories).flat().map(buildCategoryQuery).join("\n")}
);
out center tags;
`;

const response = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
  body: `data=${encodeURIComponent(query)}`,
});

if (!response.ok) {
  throw new Error(`Overpass error: ${response.status} ${response.statusText}`);
}

const data = await response.json();

const inferCategory = (tags = {}) => {
  if (["restaurant", "cafe", "bar"].includes(tags.amenity)) return "restaurant";
  if (["hospital", "clinic"].includes(tags.amenity) || tags.healthcare === "hospital") return "hospital";
  if (["school", "college", "university"].includes(tags.amenity)) return "school";
  if (tags.amenity === "pharmacy") return "pharmacy";
  if (tags.leisure || tags.tourism) return "leisure";
  return null;
};

const toPoint = (el) => {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return [lon, lat];
};

const features = data.elements
  .map((el) => {
    const tags = el.tags ?? {};
    const category = inferCategory(tags);
    if (!category) return null;
    if (!tags.name) return null;

    const point = toPoint(el);
    if (!point) return null;

    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: point,
      },
      properties: {
        id: `${el.type}-${el.id}`,
        name: tags.name ?? `${category}-${el.id}`,
        category,
        city: tags["addr:city"] ?? "",
        area: tags["addr:suburb"] ?? tags["addr:neighbourhood"] ?? "",
        address: [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
      },
    };
  })
  .filter(Boolean);

const featureCollection = {
  type: "FeatureCollection",
  features,
};

await writeFile(OUTPUT_PATH, JSON.stringify(featureCollection, null, 2), "utf8");

console.log(`POIs saved: ${features.length}`);
console.log(`Output: ${OUTPUT_PATH}`);
