import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const ROOT = process.cwd();
export const PROPERTIES_DIR = path.join(ROOT, "src", "data", "properties");
export const DEFAULT_ROOT_DIR = path.join(ROOT, "media-intake", "unit-covers");
export const DEFAULT_BUCKET = "properties";
export const DEFAULT_MAX_DIMENSION = 2000;
export const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);

export const asText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const readArg = (flagName) => {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${flagName}`);
  if (index >= 0) return process.argv[index + 1] || null;
  return null;
};

export const hasFlag = (flagName) => process.argv.includes(`--${flagName}`);

export const splitList = (value) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const sanitizeLabel = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

export const normalizeCode = (value) => String(value ?? "").trim().toUpperCase();

const normalizeFolderLabel = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[_-]+/g, " ")
    .replace(/[^\w\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const toRelativePath = (absolutePath) => path.relative(ROOT, absolutePath).replaceAll("\\", "/");

export const loadProperties = () => {
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

export const buildProjects = (entries) =>
  entries
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
          status: asText(child?.status) ?? "unknown",
          filePath: childFilePath,
          data: child,
        }))
        .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));

      return {
        id: projectId,
        title,
        filePath,
        dirName: `${projectId}-${sanitizeLabel(title) || projectId}`,
        children,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));

const selectProjects = (allProjects, requestedProjects) => {
  if (!requestedProjects?.size) return allProjects;
  return allProjects.filter((project) => requestedProjects.has(normalizeCode(project.id)));
};

const listImageFiles = (directoryPath) =>
  fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

const resolveDirectoryContext = (dirName, allProjectsById) => {
  for (const project of allProjectsById.values()) {
    if (dirName === project.dirName || dirName.startsWith(`${project.id}-`)) {
      return {
        projectCode: project.id,
        directoryRule: "canonical_directory",
        directoryContext: {},
      };
    }
  }

  const label = normalizeFolderLabel(dirName);
  const blockMatch = label.match(/^BLOQUE\s+(\d+)$/);
  if (blockMatch) {
    return {
      projectCode: "PM0011",
      directoryRule: "pm0011_operational_directory",
      directoryContext: { block: Number(blockMatch[1]) },
    };
  }

  const buildingMatch = label.match(/^EDIFICIO\s+(\d+)$/);
  if (buildingMatch) {
    return {
      projectCode: "PM0079",
      directoryRule: "pm0079_operational_directory",
      directoryContext: { building: Number(buildingMatch[1]) },
    };
  }

  if (label.includes("ALMITAK")) {
    return {
      projectCode: "PM0074",
      directoryRule: "pm0074_operational_directory",
      directoryContext: {},
    };
  }

  return {
    projectCode: null,
    directoryRule: "unknown_directory",
    directoryContext: {},
  };
};

const discoverFiles = (rootDir, scopedProjects, allProjects) => {
  const scopedProjectsById = new Map(scopedProjects.map((project) => [project.id, project]));
  const allProjectsById = new Map(allProjects.map((project) => [project.id, project]));
  const directories = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));

  return directories.flatMap((entry) => {
    const absoluteDirPath = path.join(rootDir, entry.name);
    const context = resolveDirectoryContext(entry.name, allProjectsById);
    if (context.projectCode && !scopedProjectsById.has(context.projectCode)) {
      return [];
    }

    return listImageFiles(absoluteDirPath).map((fileName) => ({
      directoryName: entry.name,
      directoryPath: absoluteDirPath,
      sourcePath: path.join(absoluteDirPath, fileName),
      sourcePathRelative: toRelativePath(path.join(absoluteDirPath, fileName)),
      fileName,
      baseName: path.basename(fileName, path.extname(fileName)),
      projectCode: context.projectCode,
      directoryRule: context.directoryRule,
      directoryContext: context.directoryContext,
    }));
  });
};

const buildFloorSuffix = (levelCode, letter) => {
  if (levelCode === "0") return `B${letter}`;
  if (levelCode === "5") return `AT${letter}`;
  if (/^[1-9]$/.test(levelCode)) return `${levelCode}${letter}`;
  return null;
};

const extractLeadingToken = (value) => {
  const match = normalizeCode(value).match(/^(\d{2,3}[A-Z])\b/);
  return match?.[1] ?? null;
};

const unresolvedResult = (candidate, resolverRule, reason, extra = {}) => ({
  kind: "unresolved",
  sourcePath: candidate.sourcePathRelative,
  projectCode: candidate.projectCode,
  fileName: candidate.fileName,
  directoryRule: candidate.directoryRule,
  resolverRule,
  reason,
  ...extra,
});

const buildMatchResult = (candidate, project, childCode, resolverRule) => {
  const child = project.childrenByCode.get(normalizeCode(childCode));
  if (!child) {
    return unresolvedResult(candidate, resolverRule, "derived_child_not_found", {
      attemptedChildCode: childCode,
    });
  }

  return {
    kind: "match",
    sourcePath: candidate.sourcePathRelative,
    sourceAbsolutePath: candidate.sourcePath,
    projectCode: project.id,
    projectTitle: project.title,
    childCode: child.id,
    status: child.status,
    resolverRule,
    directoryRule: candidate.directoryRule,
    objectPath: `${project.id}/cover/units/${child.id}.webp`,
    child,
  };
};

const resolveCanonicalFile = (candidate, project) => {
  const child = project.childrenByCode.get(normalizeCode(candidate.baseName));
  if (!child) {
    return unresolvedResult(candidate, "canonical_exact_filename", "canonical_child_not_found", {
      attemptedChildCode: normalizeCode(candidate.baseName),
    });
  }

  return {
    kind: "match",
    sourcePath: candidate.sourcePathRelative,
    sourceAbsolutePath: candidate.sourcePath,
    projectCode: project.id,
    projectTitle: project.title,
    childCode: child.id,
    status: child.status,
    resolverRule: "canonical_exact_filename",
    directoryRule: candidate.directoryRule,
    objectPath: `${project.id}/cover/units/${child.id}.webp`,
    child,
  };
};

const resolvePm0011File = (candidate, project) => {
  const token = extractLeadingToken(candidate.baseName);
  if (!token) {
    return unresolvedResult(candidate, "pm0011_operational_token", "pm0011_missing_token");
  }

  const match = token.match(/^(\d{2,3})([A-Z])$/);
  if (!match) {
    return unresolvedResult(candidate, "pm0011_operational_token", "pm0011_invalid_token");
  }

  const block = Number(candidate.directoryContext?.block);
  if (!Number.isFinite(block) || block <= 0) {
    return unresolvedResult(candidate, "pm0011_operational_token", "pm0011_missing_block_context");
  }

  let digits = match[1];
  const letter = match[2];

  if (digits.length === 3) {
    if (Number(digits[0]) !== block) {
      return unresolvedResult(candidate, "pm0011_operational_token", "pm0011_block_prefix_mismatch", {
        extractedToken: token,
      });
    }
    digits = digits.slice(1);
  }

  if (digits.length !== 2) {
    return unresolvedResult(candidate, "pm0011_operational_token", "pm0011_invalid_digit_length", {
      extractedToken: token,
    });
  }

  const portal = Number(digits[0]);
  if (!Number.isFinite(portal) || portal <= 0) {
    return unresolvedResult(candidate, "pm0011_operational_token", "pm0011_invalid_portal", {
      extractedToken: token,
    });
  }

  const suffix = buildFloorSuffix(digits[1], letter);
  if (!suffix) {
    return unresolvedResult(candidate, "pm0011_operational_token", "pm0011_invalid_floor_code", {
      extractedToken: token,
    });
  }

  return buildMatchResult(candidate, project, `PM0011-B${block}P${portal}_${suffix}`, "pm0011_operational_token");
};

const resolvePm0074File = (candidate, project) => {
  const token = extractLeadingToken(candidate.baseName);
  if (!token) {
    return unresolvedResult(candidate, "pm0074_operational_token", "pm0074_missing_token");
  }

  const match = token.match(/^(\d)(\d)([A-Z])$/);
  if (!match) {
    return unresolvedResult(candidate, "pm0074_operational_token", "pm0074_invalid_token", {
      extractedToken: token,
    });
  }

  const portal = Number(match[1]);
  if (!Number.isFinite(portal) || portal <= 0) {
    return unresolvedResult(candidate, "pm0074_operational_token", "pm0074_invalid_portal", {
      extractedToken: token,
    });
  }

  const suffix = buildFloorSuffix(match[2], match[3]);
  if (!suffix) {
    return unresolvedResult(candidate, "pm0074_operational_token", "pm0074_invalid_floor_code", {
      extractedToken: token,
    });
  }

  return buildMatchResult(candidate, project, `PM0074-P${portal}_${suffix}`, "pm0074_operational_token");
};

const resolvePm0079File = (candidate, project) => {
  const match = candidate.baseName.match(/\bUNIT[\s_-]*0?(\d{1,2})\b/i);
  if (!match) {
    return unresolvedResult(candidate, "pm0079_operational_unit_token", "pm0079_missing_unit_token");
  }

  const childCode = `PM0079-${String(Number(match[1])).padStart(2, "0")}`;
  return buildMatchResult(candidate, project, childCode, "pm0079_operational_unit_token");
};

const resolveCandidate = (candidate, projectsById) => {
  if (!candidate.projectCode) {
    return unresolvedResult(candidate, "unresolved_directory", "unknown_directory");
  }

  const project = projectsById.get(candidate.projectCode);
  if (!project) {
    return unresolvedResult(candidate, "project_scope_filter", "project_not_in_scope");
  }

  if (candidate.directoryRule === "canonical_directory") {
    return resolveCanonicalFile(candidate, project);
  }

  if (candidate.projectCode === "PM0011") {
    return resolvePm0011File(candidate, project);
  }

  if (candidate.projectCode === "PM0074") {
    return resolvePm0074File(candidate, project);
  }

  if (candidate.projectCode === "PM0079") {
    return resolvePm0079File(candidate, project);
  }

  return unresolvedResult(candidate, "unsupported_project_directory", "unsupported_project_directory");
};

const serializeMatch = (match) => ({
  sourcePath: match.sourcePath,
  projectCode: match.projectCode,
  childCode: match.childCode,
  status: match.status,
  resolverRule: match.resolverRule,
  directoryRule: match.directoryRule,
  objectPath: match.objectPath,
});

const serializeDuplicate = (group) => ({
  projectCode: group[0].projectCode,
  childCode: group[0].childCode,
  status: group[0].status,
  sources: group.map((item) => ({
    sourcePath: item.sourcePath,
    resolverRule: item.resolverRule,
    directoryRule: item.directoryRule,
  })),
});

export const createUnitCoverPlan = ({ rootDir = DEFAULT_ROOT_DIR, requestedProjects = new Set() } = {}) => {
  const resolvedRootDir = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRootDir)) {
    throw new Error(`root_dir_not_found:${resolvedRootDir}`);
  }

  const entries = loadProperties();
  const allProjects = buildProjects(entries);
  const projects = selectProjects(allProjects, requestedProjects);
  if (!projects.length) {
    throw new Error("no_projects_found_for_requested_scope");
  }

  const scopedProjects = projects.map((project) => ({
    ...project,
    childrenByCode: new Map(project.children.map((child) => [normalizeCode(child.id), child])),
  }));
  const projectsById = new Map(scopedProjects.map((project) => [project.id, project]));
  const discoveredFiles = discoverFiles(resolvedRootDir, scopedProjects, allProjects);

  const rawMatches = [];
  const unresolved = [];
  const projectReportIndex = new Map(
    scopedProjects.map((project) => [
      project.id,
      {
        projectCode: project.id,
        projectTitle: project.title,
        directories: new Set(),
        matched: [],
        unresolved: [],
        duplicates: [],
      },
    ])
  );

  for (const candidate of discoveredFiles) {
    if (candidate.projectCode && projectReportIndex.has(candidate.projectCode)) {
      projectReportIndex.get(candidate.projectCode).directories.add(candidate.directoryName);
    }

    const result = resolveCandidate(candidate, projectsById);
    if (result.kind === "match") {
      rawMatches.push(result);
    } else {
      unresolved.push(result);
      if (result.projectCode && projectReportIndex.has(result.projectCode)) {
        projectReportIndex.get(result.projectCode).unresolved.push(result);
      }
    }
  }

  const groupedMatches = new Map();
  for (const match of rawMatches) {
    const key = `${match.projectCode}::${match.childCode}`;
    if (!groupedMatches.has(key)) {
      groupedMatches.set(key, []);
    }
    groupedMatches.get(key).push(match);
  }

  const matched = [];
  const duplicates = [];
  const importItems = [];

  for (const group of groupedMatches.values()) {
    if (group.length === 1) {
      const serialized = serializeMatch(group[0]);
      matched.push(serialized);
      importItems.push(group[0]);
      if (projectReportIndex.has(group[0].projectCode)) {
        projectReportIndex.get(group[0].projectCode).matched.push(serialized);
      }
      continue;
    }

    const duplicate = serializeDuplicate(group);
    duplicates.push(duplicate);
    if (projectReportIndex.has(group[0].projectCode)) {
      projectReportIndex.get(group[0].projectCode).duplicates.push(duplicate);
    }
  }

  matched.sort((a, b) =>
    `${a.projectCode}:${a.childCode}:${a.sourcePath}`.localeCompare(
      `${b.projectCode}:${b.childCode}:${b.sourcePath}`,
      "es",
      { numeric: true }
    )
  );
  unresolved.sort((a, b) =>
    `${a.projectCode ?? ""}:${a.sourcePath}`.localeCompare(`${b.projectCode ?? ""}:${b.sourcePath}`, "es", {
      numeric: true,
    })
  );
  duplicates.sort((a, b) =>
    `${a.projectCode}:${a.childCode}`.localeCompare(`${b.projectCode}:${b.childCode}`, "es", {
      numeric: true,
    })
  );

  const projectsReport = scopedProjects.map((project) => {
    const data = projectReportIndex.get(project.id);
    return {
      projectCode: project.id,
      projectTitle: project.title,
      directories: [...data.directories].sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
      matchedCount: data.matched.length,
      unresolvedCount: data.unresolved.length,
      duplicateCount: data.duplicates.length,
      matched: data.matched,
      unresolved: data.unresolved,
      duplicates: data.duplicates,
    };
  });

  return {
    importItems,
    report: {
      rootDir: resolvedRootDir,
      projectFilter: [...requestedProjects].sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
      summary: {
        projectCount: scopedProjects.length,
        fileCount: discoveredFiles.length,
        matchedCount: matched.length,
        unresolvedCount: unresolved.length,
        duplicateCount: duplicates.length,
        importableCount: importItems.length,
      },
      matched,
      unresolved,
      duplicates,
      projects: projectsReport,
    },
  };
};
