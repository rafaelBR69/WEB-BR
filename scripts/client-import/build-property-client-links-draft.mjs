import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const arg = (name) => {
  const prefix = `--${name}=`;
  const direct = process.argv.find((entry) => entry.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const npmConfigKey = `npm_config_${name.replaceAll("-", "_")}`;
  const npmConfigValue = process.env[npmConfigKey];
  if (typeof npmConfigValue === "string" && npmConfigValue.trim().length > 0) {
    return npmConfigValue.trim();
  }
  return null;
};

const text = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const lower = (value) => {
  const valueText = text(value);
  return valueText ? valueText.toLowerCase() : null;
};

const canonical = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const compact = (value) => canonical(value).replace(/\s+/g, "");

const upperNoAccent = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

const extractFirstNumber = (value) => {
  const raw = text(String(value ?? ""));
  if (!raw) return null;
  const match = raw.match(/[0-9]{1,3}/);
  if (!match) return null;
  return String(Number(match[0]));
};

const normalizeFloorToken = (value) => {
  const raw = upperNoAccent(value);
  if (!text(raw)) return null;

  if (/\b(ATICO|PENTHOUSE)\b/.test(raw)) return "AT";
  if (/\b(BAJO|PLANTA BAJA|GROUND|P0|PO)\b/.test(raw)) return "0";

  const explicitMatch = raw.match(/\b(?:PLANTA|FLOOR|P)\s*([0-9]{1,2})\b/);
  if (explicitMatch) return String(Number(explicitMatch[1]));

  const ordinalMatch = raw.match(/\b([0-9]{1,2})\s*(?:O|º)?\b/);
  if (ordinalMatch) return String(Number(ordinalMatch[1]));

  return null;
};

const normalizeLetterToken = (value) => {
  const raw = upperNoAccent(value);
  if (!text(raw)) return null;

  const namedMatch = raw.match(/\b(?:LETRA|PUERTA|DOOR|LETTER)\s*([A-C])\b/);
  if (namedMatch) return namedMatch[1];

  const contextualMatch = raw.match(
    /\b(?:ATICO|BAJO|PLANTA\s*[0-9]{1,2}|FLOOR\s*[0-9]{1,2}|P\s*[0-9]{1,2}|[0-9]{1,2}\s*(?:O|º)?)\s*([A-C])\b/
  );
  if (contextualMatch) return contextualMatch[1];

  const isolatedMatch = raw.match(/\b([A-C])\b/);
  if (isolatedMatch) return isolatedMatch[1];

  const tailMatch = raw.match(/([A-C])\s*$/);
  if (tailMatch) return tailMatch[1];

  return null;
};

const parseSuffixFloorLetter = (suffix) => {
  const raw = upperNoAccent(suffix).replace(/\s+/g, "");
  if (!raw) return null;

  let match = raw.match(/^AT([A-C])$/);
  if (match) return { floor: "AT", letter: match[1] };

  match = raw.match(/^B([A-C])$/);
  if (match) return { floor: "0", letter: match[1] };

  match = raw.match(/^([0-9]{1,2})([A-C])$/);
  if (match) return { floor: String(Number(match[1])), letter: match[2] };

  return null;
};

const localPropertyHintsCache = new Map();

const parseLocalPropertyHints = (legacyCode) => {
  const key = text(legacyCode);
  if (!key) return null;
  if (localPropertyHintsCache.has(key)) return localPropertyHintsCache.get(key);

  const filePath = path.join(ROOT, "src", "data", "properties", `${key}.json`);
  if (!fs.existsSync(filePath)) {
    localPropertyHintsCache.set(key, null);
    return null;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const property = payload?.property ?? {};
    const floorLabel = text(property.floor_label);
    const floorLevel = property?.floor_level != null ? String(property.floor_level) : null;
    const typeLabel = text(property.type_label);
    const unitCode = text(property.unit_code);
    const block = property?.block != null ? String(property.block) : null;
    const portal = property?.portal != null ? String(property.portal) : null;

    const floorplan = Array.isArray(payload?.media?.gallery?.floorplan)
      ? payload.media.gallery.floorplan
      : [];
    const floorplanUrl = text(floorplan[0]?.url);
    const floorplanFile = floorplanUrl ? path.basename(floorplanUrl) : null;
    const floorplanMatch = floorplanFile ? floorplanFile.match(/^(\d+)-(\d+)-([A-Z])\.pdf$/i) : null;

    const floorFromLabel = normalizeFloorToken(floorLabel || floorLevel);
    const floorFromPlan =
      floorplanMatch && floorplanMatch[2] === "5"
        ? "AT"
        : floorplanMatch
          ? String(Number(floorplanMatch[2]))
          : null;

    const hint = {
      block: block || (floorplanMatch ? String(Number(floorplanMatch[1])) : null),
      portal,
      floor: floorFromLabel || floorFromPlan,
      letter: normalizeLetterToken(typeLabel || (floorplanMatch ? floorplanMatch[3] : null)),
      unit_code: unitCode,
    };

    localPropertyHintsCache.set(key, hint);
    return hint;
  } catch {
    localPropertyHintsCache.set(key, null);
    return null;
  }
};

const parseUnitHints = (row) => {
  const unitReference = text(row.unit_reference);
  const rawReference = upperNoAccent(unitReference);

  const hints = {
    unit_number: null,
    block: null,
    portal: extractFirstNumber(row.unit_portal),
    floor: normalizeFloorToken(row.unit_floor),
    letter: normalizeLetterToken(row.unit_letter),
  };

  if (unitReference && /^\s*[0-9]{1,3}\s*$/.test(unitReference)) {
    hints.unit_number = String(Number(unitReference));
  }

  if (rawReference) {
    const directBlock =
      rawReference.match(/\b(?:EDIF(?:ICIO|I)?|BLOQUE|BLOCK)\s*[\.\-:]*\s*([0-9]{1,2})\b/) ||
      rawReference.match(/\bB([0-9]{1,2})\b/);
    if (directBlock) hints.block = String(Number(directBlock[1]));

    const directPortal = rawReference.match(/\bPORTAL\s*([0-9]{1,2})\b/);
    if (directPortal) hints.portal = String(Number(directPortal[1]));

    if (!hints.floor) hints.floor = normalizeFloorToken(rawReference);
    if (!hints.letter) hints.letter = normalizeLetterToken(rawReference);

    const firstDash = rawReference.match(/^\s*([0-9]{1,2})\s*[-|]\s*(.+)$/);
    if (firstDash) {
      if (!hints.block && !hints.portal) hints.block = String(Number(firstDash[1]));
      const tail = firstDash[2];
      if (!hints.floor) hints.floor = normalizeFloorToken(tail);
      if (!hints.letter) hints.letter = normalizeLetterToken(tail);
    }

    const inlinePortalFloorLetter = rawReference.match(
      /\bPORTAL\s*([0-9]{1,2})\s*[-| ]*\s*(?:P|PLANTA|FLOOR)?\s*([0-9]{1,2}|0)\s*[-| ]*([A-C])\b/
    );
    if (inlinePortalFloorLetter) {
      hints.portal = hints.portal || String(Number(inlinePortalFloorLetter[1]));
      hints.floor = hints.floor || String(Number(inlinePortalFloorLetter[2]));
      hints.letter = hints.letter || inlinePortalFloorLetter[3];
    }
  }

  return hints;
};

const reservationStateKey = (value) => canonical(value);

const isInactiveReservationState = (value) => {
  const key = reservationStateKey(value);
  if (!key) return false;
  return (
    key.includes("cancel") ||
    key.includes("cancelacion") ||
    key.includes("cancelada") ||
    key.includes("baja") ||
    key.includes("descart")
  );
};

const reservationStatePriority = (value) => {
  const key = reservationStateKey(value);
  if (!key) return 0;
  if (key.includes("contrato firmado")) return 80;
  if (key.includes("contrato compraventa enviado")) return 70;
  if (key.includes("reserva firmado")) return 60;
  if (key.includes("reserva enviado")) return 50;
  if (key.includes("reserva")) return 40;
  if (key.includes("preinscrip")) return 30;
  if (key.includes("interes")) return 20;
  return 10;
};

const parseCsv = (raw) => {
  const textRaw = String(raw ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < textRaw.length; i += 1) {
    const ch = textRaw[i];

    if (inQuotes) {
      if (ch === '"') {
        if (textRaw[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch === "\r") continue;
    field += ch;
  }

  row.push(field);
  if (row.some((entry) => String(entry ?? "").length > 0) || rows.length === 0) rows.push(row);
  return rows;
};

const toCsvValue = (value) => {
  const raw = value == null ? "" : String(value);
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n") || raw.includes("\r")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
};

const toCsv = (rows, headers) => {
  const lines = [];
  lines.push(headers.map((header) => toCsvValue(header)).join(","));
  rows.forEach((row) => {
    lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
  });
  return `${lines.join("\n")}\n`;
};

const ensureDir = (absolutePath) => {
  if (!fs.existsSync(absolutePath)) fs.mkdirSync(absolutePath, { recursive: true });
};

const parseReferencesCsv = (filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`reference_file_not_found:${filePath}`);
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (!rows.length) return [];
  const headers = rows[0].map((entry) => text(entry) ?? "");
  return rows
    .slice(1)
    .map((values) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = text(values[index]);
      });
      return row;
    })
    .filter((row) => Object.values(row).some((entry) => text(entry)));
};

const parseJobFile = (jobPathArg) => {
  const absolutePath = path.isAbsolute(jobPathArg) ? jobPathArg : path.join(ROOT, jobPathArg);
  if (!fs.existsSync(absolutePath)) throw new Error(`job_file_not_found:${absolutePath}`);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  if (!sources.length) throw new Error("sources_required");
  return { absolutePath, sources };
};

const detectHeaderRowIndex = (rows) => {
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const values = rows[i].map((entry) => text(entry)).filter(Boolean);
    const packed = canonical(values.join(" "));
    const score =
      values.length +
      (packed.includes("comprador") ? 6 : 0) +
      (packed.includes("reserva") ? 4 : 0) +
      (packed.includes("mail") || packed.includes("email") ? 3 : 0) +
      (packed.includes("dni") || packed.includes("id") ? 2 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
};

const buildLookup = (headers) => {
  const normalizedHeaders = headers.map((header) =>
    String(header ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  const byCanonical = new Map();

  normalizedHeaders.forEach((header, index) => {
    const key = canonical(header);
    if (!key) return;
    const bucket = byCanonical.get(key) ?? [];
    bucket.push(index);
    byCanonical.set(key, bucket);
  });

  return { headers: normalizedHeaders, byCanonical };
};

const pickByAliases = (row, lookup, aliases) => {
  for (const alias of aliases) {
    const key = canonical(alias);
    const indexes = lookup.byCanonical.get(key) ?? [];
    for (const index of indexes) {
      const value = text(row[index]);
      if (value) return value;
    }
  }
  return null;
};

const firstTaxId = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const first = raw.split(/[\/,|]/).map((entry) => entry.trim()).find((entry) => entry.length > 0);
  return first || raw;
};

const firstEmail = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : lower(raw);
};

const parseSourceRows = (source) => {
  const sourceFile = text(source.file);
  if (!sourceFile) throw new Error("source_file_required");
  const sourcePath = path.isAbsolute(sourceFile) ? sourceFile : path.join(ROOT, sourceFile);
  if (!fs.existsSync(sourcePath)) throw new Error(`source_file_not_found:${sourcePath}`);

  const rows = parseCsv(fs.readFileSync(sourcePath, "utf8"));
  const headerRowIndex = Number.isInteger(source.header_row) && source.header_row > 0
    ? source.header_row - 1
    : detectHeaderRowIndex(rows);

  const lookup = buildLookup(rows[headerRowIndex] ?? []);
  const parsed = [];

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const current = lookup.headers.map((_, index) => text(rows[i]?.[index]) ?? "");

    const fullName = pickByAliases(current, lookup, ["COMPRADOR /ES", "COMPRADOR/ES", "COMPRADOR", "Nombre comprador"]);
    const taxId = firstTaxId(pickByAliases(current, lookup, ["DNI", "DNI o DNIS", "ID", "NIF", "NIF/CIF"]));
    const email = firstEmail(pickByAliases(current, lookup, ["Mail", "Email", "Correo"]));

    if (!fullName && !taxId && !email) continue;

    parsed.push({
      source_file: path.basename(sourcePath),
      source_file_path: sourcePath,
      source_row_number: i + 1,
      project_legacy_code: text(source.project_legacy_code),
      project_label: text(source.project_label),
      full_name: fullName,
      email,
      phone: pickByAliases(current, lookup, ["Telefono", "Teléfono", "Movil", "Móvil"]),
      tax_id: taxId,
      unit_reference: pickByAliases(current, lookup, ["Unidad Vivienda", "Unidad", "Vivienda"]),
      unit_portal: pickByAliases(current, lookup, ["Unidad Vivienda Portal", "Portal"]),
      unit_floor: pickByAliases(current, lookup, ["Unidad Vivienda Piso", "Piso", "Planta"]),
      unit_letter: pickByAliases(current, lookup, ["Unidad Vivienda Letra", "Letra", "Puerta"]),
      buyer_civil_status: pickByAliases(current, lookup, ["Estado civil compradores", "Estado civil"]),
      reservation_state_text: pickByAliases(current, lookup, ["Estado"]),
    });
  }

  return {
    source_file: sourceFile,
    source_path: sourcePath,
    header_row: headerRowIndex + 1,
    rows: parsed,
  };
};

const dedupePush = (map, key, value) => {
  if (!key) return;
  const bucket = map.get(key) ?? [];
  const valueIdentity =
    text(value?.property_id) ||
    text(value?.client_id) ||
    text(value?.legacy_code) ||
    text(value?.full_name) ||
    null;

  if (valueIdentity) {
    const alreadyExists = bucket.some((entry) => {
      const entryIdentity =
        text(entry?.property_id) ||
        text(entry?.client_id) ||
        text(entry?.legacy_code) ||
        text(entry?.full_name) ||
        null;
      return entryIdentity === valueIdentity;
    });
    if (alreadyExists) {
      map.set(key, bucket);
      return;
    }
  }

  bucket.push(value);
  map.set(key, bucket);
};

const buildClientIndexes = (clientsRows) => {
  const byTax = new Map();
  const byEmail = new Map();
  const byName = new Map();

  clientsRows.forEach((row) => {
    const taxKey = compact(row.tax_id);
    const emailKey = compact(row.email);
    const nameKey = compact(row.full_name);

    dedupePush(byTax, taxKey, row);
    dedupePush(byEmail, emailKey, row);
    dedupePush(byName, nameKey, row);
  });

  return { byTax, byEmail, byName };
};

const buildPropertyIndexes = (propertiesRows) => {
  const byLegacy = new Map();
  const byProjectLegacy = new Map();
  const byComposite = new Map();
  const byProjectUnitNumber = new Map();
  const byProjectBlockPortalFloorLetter = new Map();
  const byProjectBlockFloorLetter = new Map();
  const byProjectPortalFloorLetter = new Map();

  const pushStructured = (projectKey, block, portal, floor, letter, row) => {
    if (!projectKey) return;
    const normalizedFloor = normalizeFloorToken(floor);
    const normalizedLetter = normalizeLetterToken(letter);
    if (!normalizedFloor || !normalizedLetter) return;

    const normalizedBlock = extractFirstNumber(block);
    const normalizedPortal = extractFirstNumber(portal);

    if (normalizedBlock && normalizedPortal) {
      dedupePush(
        byProjectBlockPortalFloorLetter,
        `${projectKey}|${normalizedBlock}|${normalizedPortal}|${normalizedFloor}|${normalizedLetter}`,
        row
      );
    }

    if (normalizedBlock) {
      dedupePush(
        byProjectBlockFloorLetter,
        `${projectKey}|${normalizedBlock}|${normalizedFloor}|${normalizedLetter}`,
        row
      );
    }

    if (normalizedPortal) {
      dedupePush(
        byProjectPortalFloorLetter,
        `${projectKey}|${normalizedPortal}|${normalizedFloor}|${normalizedLetter}`,
        row
      );
    }
  };

  propertiesRows
    .filter((row) => row.record_type !== "project")
    .forEach((row) => {
      const legacyKey = compact(row.legacy_code);
      dedupePush(byLegacy, legacyKey, row);

      const projectKey = compact(row.project_legacy_code);
      dedupePush(byProjectLegacy, projectKey, row);

      const portal = extractFirstNumber(row.building_portal);
      const floor = normalizeFloorToken(row.floor_label || row.floor_level);
      const door = normalizeLetterToken(row.building_door);

      if (projectKey && portal && floor && door) {
        dedupePush(byComposite, `${projectKey}|${portal}|${floor}|${door}`, row);
      }

      const legacyCode = text(row.legacy_code);
      if (projectKey && legacyCode) {
        const numericLegacy = upperNoAccent(legacyCode).match(/^[A-Z0-9]+-([0-9]{1,3})$/);
        if (numericLegacy) {
          dedupePush(byProjectUnitNumber, `${projectKey}|${String(Number(numericLegacy[1]))}`, row);
        }

        const codedLegacy = upperNoAccent(legacyCode).match(
          /^[A-Z0-9]+-B([0-9]{1,2})P([0-9]{1,2})_([A-Z0-9]+)$/
        );
        if (codedLegacy) {
          const suffix = parseSuffixFloorLetter(codedLegacy[3]);
          if (suffix) {
            pushStructured(
              projectKey,
              codedLegacy[1],
              codedLegacy[2],
              suffix.floor,
              suffix.letter,
              row
            );
          }
        }
      }

      const localHints = parseLocalPropertyHints(legacyCode);
      if (projectKey && localHints) {
        pushStructured(projectKey, localHints.block, localHints.portal, localHints.floor, localHints.letter, row);

        const unitCode = text(localHints.unit_code);
        if (unitCode) {
          const unitCodeMatch = upperNoAccent(unitCode).match(/^([0-9]{1,2})-([0-9]{1,2})-([A-Z0-9]+)$/);
          if (unitCodeMatch) {
            const suffix = parseSuffixFloorLetter(unitCodeMatch[3]);
            if (suffix) {
              pushStructured(
                projectKey,
                unitCodeMatch[1],
                unitCodeMatch[2],
                suffix.floor,
                suffix.letter,
                row
              );
            }
          }
        }
      }
    });

  return {
    byLegacy,
    byProjectLegacy,
    byComposite,
    byProjectUnitNumber,
    byProjectBlockPortalFloorLetter,
    byProjectBlockFloorLetter,
    byProjectPortalFloorLetter,
  };
};

const resolveClient = (indexes, row) => {
  const taxKey = compact(row.tax_id);
  if (taxKey) {
    const bucket = indexes.byTax.get(taxKey) ?? [];
    if (bucket.length === 1) {
      return {
        client_id: bucket[0].client_id,
        method: "tax_id",
        confidence: "high",
        notes: "match exacto por tax_id",
      };
    }
    if (bucket.length > 1) {
      return {
        client_id: bucket[0].client_id,
        method: "tax_id_ambiguous",
        confidence: "medium",
        notes: `tax_id ambiguo (${bucket.length} coincidencias)` ,
      };
    }
  }

  const emailKey = compact(row.email);
  if (emailKey) {
    const bucket = indexes.byEmail.get(emailKey) ?? [];
    if (bucket.length === 1) {
      return {
        client_id: bucket[0].client_id,
        method: "email",
        confidence: "high",
        notes: "match exacto por email",
      };
    }
    if (bucket.length > 1) {
      return {
        client_id: bucket[0].client_id,
        method: "email_ambiguous",
        confidence: "medium",
        notes: `email ambiguo (${bucket.length} coincidencias)`,
      };
    }
  }

  const nameKey = compact(row.full_name);
  if (nameKey) {
    const bucket = indexes.byName.get(nameKey) ?? [];
    if (bucket.length === 1) {
      return {
        client_id: bucket[0].client_id,
        method: "full_name",
        confidence: "medium",
        notes: "match exacto por nombre",
      };
    }
    if (bucket.length > 1) {
      return {
        client_id: bucket[0].client_id,
        method: "full_name_ambiguous",
        confidence: "low",
        notes: `nombre ambiguo (${bucket.length} coincidencias)`,
      };
    }
  }

  return {
    client_id: null,
    method: "none",
    confidence: "none",
    notes: "sin match de cliente",
  };
};

const resolveProperty = (indexes, row) => {
  const unitKey = compact(row.unit_reference);
  const projectKey = compact(row.project_legacy_code);
  const unitHints = parseUnitHints(row);

  if (unitKey) {
    const bucket = indexes.byLegacy.get(unitKey) ?? [];
    if (bucket.length === 1) {
      return {
        property_id: bucket[0].property_id,
        method: "legacy_code",
        confidence: "high",
        notes: "match exacto por unit_reference->legacy_code",
      };
    }
    if (bucket.length > 1 && projectKey) {
      const filtered = bucket.filter((entry) => compact(entry.project_legacy_code) === projectKey);
      if (filtered.length === 1) {
        return {
          property_id: filtered[0].property_id,
          method: "legacy_code+project",
          confidence: "high",
          notes: "match por unit_reference filtrado por proyecto",
        };
      }
    }
  }

  if (projectKey && unitHints.unit_number) {
    const bucket = indexes.byProjectUnitNumber.get(`${projectKey}|${unitHints.unit_number}`) ?? [];
    if (bucket.length === 1) {
      return {
        property_id: bucket[0].property_id,
        method: "project+unit_number",
        confidence: "high",
        notes: "match por numero de unidad dentro del proyecto",
      };
    }
    if (bucket.length > 1) {
      return {
        property_id: bucket[0].property_id,
        method: "project+unit_number_ambiguous",
        confidence: "low",
        notes: `numero de unidad ambiguo (${bucket.length} coincidencias)`,
      };
    }
  }

  if (projectKey) {
    const block = unitHints.block;
    const portal = unitHints.portal;
    const floor = unitHints.floor;
    const door = unitHints.letter;

    if (block && portal && floor && door) {
      const strictKey = `${projectKey}|${block}|${portal}|${floor}|${door}`;
      const bucket = indexes.byProjectBlockPortalFloorLetter.get(strictKey) ?? [];
      if (bucket.length === 1) {
        return {
          property_id: bucket[0].property_id,
          method: "block+portal+floor+door",
          confidence: "high",
          notes: "match por bloque/portal/planta/puerta",
        };
      }
      if (bucket.length > 1) {
        return {
          property_id: bucket[0].property_id,
          method: "block+portal+floor+door_ambiguous",
          confidence: "low",
          notes: `estructura bloque/portal ambigua (${bucket.length} coincidencias)`,
        };
      }
    }

    if (block && floor && door) {
      const blockKey = `${projectKey}|${block}|${floor}|${door}`;
      const bucket = indexes.byProjectBlockFloorLetter.get(blockKey) ?? [];
      if (bucket.length === 1) {
        return {
          property_id: bucket[0].property_id,
          method: "block+floor+door",
          confidence: "medium",
          notes: "match por bloque/planta/puerta",
        };
      }
      if (bucket.length > 1) {
        return {
          property_id: bucket[0].property_id,
          method: "block+floor+door_ambiguous",
          confidence: "low",
          notes: `estructura bloque ambigua (${bucket.length} coincidencias)`,
        };
      }
    }

    if (portal && floor && door) {
      const portalKey = `${projectKey}|${portal}|${floor}|${door}`;
      const bucket = indexes.byProjectPortalFloorLetter.get(portalKey) ?? [];
      if (bucket.length === 1) {
        return {
          property_id: bucket[0].property_id,
          method: "portal+floor+door",
          confidence: "medium",
          notes: "match por portal/planta/puerta",
        };
      }
      if (bucket.length > 1) {
        return {
          property_id: bucket[0].property_id,
          method: "portal+floor+door_ambiguous",
          confidence: "low",
          notes: `estructura portal ambigua (${bucket.length} coincidencias)`,
        };
      }
    }

    if (portal && floor && door) {
      const compositeKey = `${projectKey}|${portal}|${floor}|${door}`;
      const bucket = indexes.byComposite.get(compositeKey) ?? [];
      if (bucket.length === 1) {
        return {
          property_id: bucket[0].property_id,
          method: "portal+floor+door",
          confidence: "medium",
          notes: "match por portal/planta/puerta dentro del proyecto",
        };
      }
      if (bucket.length > 1) {
        return {
          property_id: bucket[0].property_id,
          method: "portal+floor+door_ambiguous",
          confidence: "low",
          notes: `composite ambiguo (${bucket.length} coincidencias)`,
        };
      }
    }

    if (unitKey) {
      const scoped = (indexes.byProjectLegacy.get(projectKey) ?? []).filter((entry) => {
        const legacy = compact(entry.legacy_code);
        return legacy && (legacy.includes(unitKey) || unitKey.includes(legacy));
      });
      if (scoped.length === 1) {
        return {
          property_id: scoped[0].property_id,
          method: "project+legacy_partial",
          confidence: "low",
          notes: "match parcial de unit_reference dentro del proyecto",
        };
      }
    }
  }

  return {
    property_id: null,
    method: "none",
    confidence: "none",
    notes: "sin match de propiedad",
  };
};

const main = async () => {
  const defaultJobFile = path.join(ROOT, "scripts", "client-import", "jobs", "default-client-reservations.json");
  const jobFile =
    text(arg("job-file")) ??
    text(process.env.CLIENT_IMPORT_JOB_FILE) ??
    (fs.existsSync(defaultJobFile) ? defaultJobFile : null);
  if (!jobFile) throw new Error("job_file_required");

  const { absolutePath: jobPath, sources } = parseJobFile(jobFile);

  const propertiesCsvArg = text(arg("properties-csv"));
  const clientsCsvArg = text(arg("clients-csv"));
  const outFileArg = text(arg("out-file"));

  const propertiesCsv = propertiesCsvArg
    ? (path.isAbsolute(propertiesCsvArg) ? propertiesCsvArg : path.join(ROOT, propertiesCsvArg))
    : path.join(ROOT, "scripts", "client-import", "reference", "properties-reference.csv");

  const clientsCsv = clientsCsvArg
    ? (path.isAbsolute(clientsCsvArg) ? clientsCsvArg : path.join(ROOT, clientsCsvArg))
    : path.join(ROOT, "scripts", "client-import", "reference", "clients-reference.csv");

  const outFile = outFileArg
    ? (path.isAbsolute(outFileArg) ? outFileArg : path.join(ROOT, outFileArg))
    : path.join(ROOT, "scripts", "client-import", "reference", "property-client-links-draft.csv");

  const limitRaw = Number(arg("limit"));
  const rowLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;

  const propertiesRows = parseReferencesCsv(propertiesCsv);
  const clientsRows = parseReferencesCsv(clientsCsv);

  if (!propertiesRows.length) throw new Error("properties_reference_empty");
  if (!clientsRows.length) throw new Error("clients_reference_empty");

  const propertyIndexes = buildPropertyIndexes(propertiesRows);
  const clientIndexes = buildClientIndexes(clientsRows);

  const draftRows = [];
  const sourceReports = [];

  let processed = 0;
  let readyCount = 0;
  let clientMatchedCount = 0;
  let propertyMatchedCount = 0;

  for (const sourceRaw of sources) {
    const source = sourceRaw ?? {};
    const parsed = parseSourceRows(source);
    const sourceReport = {
      file: source.file,
      header_row: parsed.header_row,
      rows: parsed.rows.length,
      processed: 0,
      ready: 0,
      missing_client: 0,
      missing_property: 0,
    };

    for (const row of parsed.rows) {
      if (rowLimit && processed >= rowLimit) break;

      const clientResolution = resolveClient(clientIndexes, row);
      const propertyResolution = resolveProperty(propertyIndexes, row);
      const confidenceAllowsAutoApply =
        (clientResolution.confidence === "high" || clientResolution.confidence === "medium") &&
        (propertyResolution.confidence === "high" || propertyResolution.confidence === "medium");
      const readyToApply =
        clientResolution.client_id && propertyResolution.property_id && confidenceAllowsAutoApply
          ? "1"
          : "0";
      const isActive = isInactiveReservationState(row.reservation_state_text) ? "false" : "true";
      if (clientResolution.client_id) clientMatchedCount += 1;
      if (propertyResolution.property_id) propertyMatchedCount += 1;
      if (readyToApply === "1") readyCount += 1;

      if (!clientResolution.client_id) sourceReport.missing_client += 1;
      if (!propertyResolution.property_id) sourceReport.missing_property += 1;

      draftRows.push({
        source_file: row.source_file,
        source_row_number: row.source_row_number,
        project_legacy_code: row.project_legacy_code,
        project_label: row.project_label,
        reservation_state_text: row.reservation_state_text,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        tax_id: row.tax_id,
        unit_reference: row.unit_reference,
        unit_portal: row.unit_portal,
        unit_floor: row.unit_floor,
        unit_letter: row.unit_letter,
        buyer_civil_status: row.buyer_civil_status,
        client_id: clientResolution.client_id,
        client_match_method: clientResolution.method,
        client_match_confidence: clientResolution.confidence,
        property_id: propertyResolution.property_id,
        property_match_method: propertyResolution.method,
        property_match_confidence: propertyResolution.confidence,
        buyer_role: "primary",
        civil_status: row.buyer_civil_status,
        marital_regime: "",
        ownership_share: "",
        is_active: isActive,
        link_source: "script",
        notes: `${clientResolution.notes}; ${propertyResolution.notes}`,
        ready_to_apply: readyToApply,
      });

      sourceReport.processed += 1;
      if (readyToApply === "1") sourceReport.ready += 1;
      processed += 1;
    }

    sourceReports.push(sourceReport);
    if (rowLimit && processed >= rowLimit) break;
  }

  const activeByProperty = new Map();
  draftRows.forEach((entry, index) => {
    if (entry.ready_to_apply !== "1") return;
    if (entry.is_active !== "true") return;
    const propertyId = text(entry.property_id);
    if (!propertyId) return;
    const bucket = activeByProperty.get(propertyId) ?? [];
    bucket.push({ index, entry });
    activeByProperty.set(propertyId, bucket);
  });

  activeByProperty.forEach((bucket) => {
    if (bucket.length <= 1) return;
    bucket.sort((left, right) => {
      const priorityDiff =
        reservationStatePriority(right.entry.reservation_state_text) -
        reservationStatePriority(left.entry.reservation_state_text);
      if (priorityDiff !== 0) return priorityDiff;

      const rowRight = Number(right.entry.source_row_number ?? 0);
      const rowLeft = Number(left.entry.source_row_number ?? 0);
      return rowRight - rowLeft;
    });

    for (let i = 1; i < bucket.length; i += 1) {
      const current = bucket[i].entry;
      current.is_active = "false";
      current.notes = `${current.notes}; marcado inactivo por conflicto de comprador en la misma vivienda`;
    }
  });

  const headers = [
    "source_file",
    "source_row_number",
    "project_legacy_code",
    "project_label",
    "reservation_state_text",
    "full_name",
    "email",
    "phone",
    "tax_id",
    "unit_reference",
    "unit_portal",
    "unit_floor",
    "unit_letter",
    "buyer_civil_status",
    "client_id",
    "client_match_method",
    "client_match_confidence",
    "property_id",
    "property_match_method",
    "property_match_confidence",
    "buyer_role",
    "civil_status",
    "marital_regime",
    "ownership_share",
    "is_active",
    "link_source",
    "notes",
    "ready_to_apply",
  ];

  const outDir = path.dirname(outFile);
  ensureDir(outDir);

  const csvText = toCsv(draftRows, headers);
  fs.writeFileSync(outFile, csvText, "utf8");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(outDir, `property-client-links-draft-${stamp}.csv`);
  fs.writeFileSync(snapshotPath, csvText, "utf8");

  const reportDir = path.join(ROOT, "scripts", "client-import", "reports");
  ensureDir(reportDir);
  const reportPath = path.join(reportDir, `property-client-links-draft-${stamp}.json`);

  const reportPayload = {
    ok: true,
    generated_at: new Date().toISOString(),
    job_file: jobPath,
    properties_reference_csv: propertiesCsv,
    clients_reference_csv: clientsCsv,
    output_csv: outFile,
    output_csv_snapshot: snapshotPath,
    stats: {
      rows_processed: processed,
      rows_ready_to_apply: readyCount,
      rows_with_client_match: clientMatchedCount,
      rows_with_property_match: propertyMatchedCount,
      rows_missing_client: processed - clientMatchedCount,
      rows_missing_property: processed - propertyMatchedCount,
    },
    sources: sourceReports,
  };

  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        report_path: reportPath,
        output_csv: outFile,
        output_csv_snapshot: snapshotPath,
        stats: reportPayload.stats,
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

