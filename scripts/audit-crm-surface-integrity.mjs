import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const crmScriptsRoot = path.join(repoRoot, "apps", "crm", "public", "crm");
const crmRoutesRoot = path.join(repoRoot, "apps", "crm", "src", "pages");

const ROUTE_REF_RX = /(["'`])(\/api\/v1\/[^"'`\r\n]*)\1/g;
const DYNAMIC_SEGMENT_RX = /^\[[^\]]+\]$/;

const walk = (dir, filter) => {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath, filter));
      continue;
    }
    if (!filter || filter(fullPath)) results.push(fullPath);
  }
  return results;
};

const toRoutePattern = (filePath) => {
  const rel = path.relative(crmRoutesRoot, filePath).replaceAll("\\", "/");
  if (!rel.startsWith("api/v1/") || !rel.endsWith(".ts")) return null;
  const withoutExt = rel.slice(0, -3);
  const normalized = withoutExt.endsWith("/index")
    ? withoutExt.slice(0, -"/index".length)
    : withoutExt;
  return `/${normalized.replace(/\/index$/, "")}`.replace(/\/+/g, "/");
};

const normalizeScriptRoute = (routeRef) =>
  routeRef
    .replace(/\$\{[^}]+\}/g, "[param]")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/");

const splitSegments = (pattern) => pattern.split("/").filter(Boolean);
const isDynamicSegment = (segment) => DYNAMIC_SEGMENT_RX.test(segment) || segment === "[param]";

const routePatterns = walk(crmRoutesRoot, (filePath) => filePath.endsWith(".ts"))
  .map((filePath) => ({
    filePath,
    route: toRoutePattern(filePath),
  }))
  .filter((entry) => entry.route);

const matchesRoute = (scriptRoute, routePattern) => {
  const left = splitSegments(scriptRoute);
  const right = splitSegments(routePattern);
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const candidate = right[index];
    return segment === candidate || (isDynamicSegment(segment) && isDynamicSegment(candidate));
  });
};

const scriptFiles = walk(crmScriptsRoot, (filePath) => filePath.endsWith(".js"));
const references = [];

for (const filePath of scriptFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const match of source.matchAll(ROUTE_REF_RX)) {
    const raw = match[2];
    const normalized = normalizeScriptRoute(raw);
    if (!normalized.startsWith("/api/v1/")) continue;
    references.push({
      filePath,
      raw,
      normalized,
    });
  }
}

const deduped = new Map();
for (const ref of references) {
  const key = `${ref.filePath}::${ref.normalized}`;
  if (!deduped.has(key)) deduped.set(key, ref);
}

const missing = [];
for (const ref of deduped.values()) {
  const found = routePatterns.find((route) => matchesRoute(ref.normalized, route.route));
  if (!found) {
    missing.push(ref);
  }
}

if (missing.length) {
  console.error("CRM surface integrity audit failed.");
  for (const ref of missing) {
    const relFile = path.relative(repoRoot, ref.filePath).replaceAll("\\", "/");
    console.error(`- ${ref.normalized} <- ${relFile}`);
  }
  process.exit(1);
}

console.log(
  `CRM surface integrity OK. ${deduped.size} route references validated against ${routePatterns.length} CRM routes.`
);
