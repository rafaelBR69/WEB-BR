import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PROPERTIES_DIR = path.join(ROOT, "src", "data", "properties");
const DEFAULT_ROOT_DIR = path.join(ROOT, "media-intake", "unit-covers");

const asText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const readArg = (flagName) => {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${flagName}`);
  if (index >= 0) return process.argv[index + 1] || null;
  return null;
};

const sanitizeLabel = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const loadProperties = () => {
  const entries = fs
    .readdirSync(PROPERTIES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

  return entries.map((fileName) => {
    const filePath = path.join(PROPERTIES_DIR, fileName);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { fileName, filePath, data };
  });
};

const buildProjects = (entries) => {
  const projects = entries
    .filter(({ data }) => data.listing_type === "promotion")
    .map(({ data, filePath }) => {
      const projectId = String(data.id);
      const title =
        asText(data?.translations?.es?.title) ??
        asText(data?.seo?.es?.title) ??
        asText(data?.translations?.en?.title) ??
        projectId;
      const children = entries
        .filter(({ data: child }) => asText(child.parent_id) === projectId)
        .map(({ data: child, filePath: childFilePath }) => ({
          id: String(child.id),
          title:
            asText(child?.translations?.es?.title) ??
            asText(child?.seo?.es?.title) ??
            asText(child?.translations?.en?.title) ??
            String(child.id),
          file: path.relative(ROOT, childFilePath).replaceAll("\\", "/"),
        }))
        .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));

      return {
        id: projectId,
        title,
        file: path.relative(ROOT, filePath).replaceAll("\\", "/"),
        dirName: `${projectId}-${sanitizeLabel(title) || projectId}`,
        children,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));

  return projects;
};

const buildRootReadme = (projects) => `# Unit Cover Intake

Coloca aqui las portadas por unidad para promociones de obra nueva.

## Regla de nombres

- Usa el \`legacy_code\` exacto de la unidad como nombre de archivo.
- Ejemplos:
  - \`PM0074-P1_1A.png\`
  - \`PM0011-B1P1_1A.jpg\`
  - \`PM0079-21.webp\`

## Carpetas operativas aceptadas

- \`Bloque 1\`, \`Bloque 2\`, \`Bloque 3\` para \`PM0011\`
- \`Edificio 1\`, \`Edificio 2\`, \`Edificio 3\` para \`PM0079\`
- \`New WEB BlancaReal Disponibilidad Almitak\` para \`PM0074\`

## Flujo

1. Deja cada imagen dentro de la carpeta de su proyecto.
2. Revisa el mapeo detectado:
   - \`npm run unit-covers:map\`
3. Ejecuta una prueba:
   - \`npm run unit-covers:import -- --dry-run\`
4. Cuando el mapeo sea correcto:
   - \`npm run unit-covers:import -- --apply --sync-crm\`

## Responsive

La importacion genera un master optimizado en Supabase. La web publica ya sirve variantes para movil, tablet y escritorio via \`srcset\`.

## Proyectos preparados

${projects.map((project) => `- \`${project.dirName}\` (${project.children.length} unidades)`).join("\n")}
`;

const buildProjectReadme = (project) => `# ${project.id} - ${project.title}

- Proyecto JSON: \`${project.file}\`
- Unidades hijas: ${project.children.length}
- Sube aqui una imagen por unidad.
- El nombre del archivo debe ser el \`legacy_code\` exacto de la hija.

## Ejemplos validos

${project.children.slice(0, 8).map((child) => `- \`${child.id}.png\``).join("\n")}

## Unidades esperadas

${project.children.map((child) => `- \`${child.id}\` -> ${child.title}`).join("\n")}
`;

const run = () => {
  const rootDir = path.resolve(readArg("root-dir") ?? DEFAULT_ROOT_DIR);
  const entries = loadProperties();
  const projects = buildProjects(entries);

  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, "README.md"), buildRootReadme(projects), "utf8");

  for (const project of projects) {
    const projectDir = path.join(rootDir, project.dirName);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "README.md"), buildProjectReadme(project), "utf8");
    fs.writeFileSync(
      path.join(projectDir, "children.json"),
      JSON.stringify(
        {
          project_id: project.id,
          project_title: project.title,
          expected_filename_pattern: "<LEGACY_CODE>.<ext>",
          children: project.children,
        },
        null,
        2
      ),
      "utf8"
    );
  }

  console.log(
    JSON.stringify(
      {
        rootDir,
        projects: projects.map((project) => ({
          id: project.id,
          dirName: project.dirName,
          units: project.children.length,
        })),
      },
      null,
      2
    )
  );
};

run();
