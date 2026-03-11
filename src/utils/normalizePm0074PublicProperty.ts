const PM0074_ID = "PM0074";

const getFloorplanUrl = (property: any) => {
  const floorplans = Array.isArray(property?.media?.gallery?.floorplan)
    ? property.media.gallery.floorplan
    : [];
  const item = floorplans.find(
    (entry: any) => typeof entry?.url === "string" && entry.url.toLowerCase().endsWith(".pdf")
  );
  return item?.url ?? "";
};

const parseUnitFromFloorplan = (url: string) => {
  const fileName = url.split("/").pop()?.replace(/\.pdf$/i, "") ?? "";
  const [portalRaw, floorRaw, letterRaw] = fileName.split("-");
  const portal = Number(portalRaw);
  const floorToken = String(floorRaw ?? "").trim().toLowerCase();
  const letter = String(letterRaw ?? "").trim().toUpperCase();

  if (!Number.isFinite(portal) || !floorToken || !letter) return null;

  const floorNumber =
    floorToken === "atico" || floorToken === "ático" ? 5 : Number(floorToken);
  if (!Number.isFinite(floorNumber)) return null;

  const isGroundFloor = floorNumber === 0;
  const isPenthouse = floorNumber === 5;
  const suffix = isGroundFloor
    ? `B${letter}`
    : isPenthouse
      ? `AT${letter}`
      : `${floorNumber}${letter}`;
  const slugFloor = isGroundFloor ? "bajo" : isPenthouse ? "atico" : `planta-${floorNumber}`;
  const floorLabelEs = isGroundFloor ? "Bajo" : isPenthouse ? "Atico" : `Planta ${floorNumber}`;
  const floorLabelEn = isGroundFloor
    ? "Ground floor"
    : isPenthouse
      ? "Penthouse"
      : `Floor ${floorNumber}`;
  const floorLabelDe = isGroundFloor
    ? "Erdgeschoss"
    : isPenthouse
      ? "Penthouse"
      : `Etage ${floorNumber}`;
  const floorLabelFr = isGroundFloor
    ? "Rez-de-chaussee"
    : isPenthouse
      ? "Penthouse"
      : `Etage ${floorNumber}`;
  const floorLabelIt = isGroundFloor
    ? "Piano terra"
    : isPenthouse
      ? "Attico"
      : `Piano ${floorNumber}`;
  const floorLabelNl = isGroundFloor
    ? "Begane grond"
    : isPenthouse
      ? "Penthouse"
      : `Verdieping ${floorNumber}`;

  return {
    portal,
    floorNumber,
    letter,
    suffix,
    slugFloor,
    unitCode: `P${portal}-${suffix}`,
    id: `${PM0074_ID}-P${portal}_${suffix}`,
    phase: `Portal ${portal}`,
    floorLabelJson: isGroundFloor ? "Planta baja" : isPenthouse ? "Atico" : `Planta ${floorNumber}`,
    labels: {
      es: floorLabelEs,
      en: floorLabelEn,
      de: floorLabelDe,
      fr: floorLabelFr,
      it: floorLabelIt,
      nl: floorLabelNl,
    },
  };
};

const unitSlugs = (portal: number, slugFloor: string, letter: string) => ({
  es: `unidad-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  en: `unit-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  de: `einheit-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  fr: `unite-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  it: `unita-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  nl: `unit-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
});

export const normalizePm0074PublicProperty = (property: any) => {
  if (!property || typeof property !== "object") return property;

  const id = String(property.id ?? "");
  const parentId = String(property.parent_id ?? "");
  const isParent = id === PM0074_ID && property.listing_type === "promotion";
  const isUnit = property.listing_type === "unit" && (id.startsWith(`${PM0074_ID}-`) || parentId === PM0074_ID);

  if (isParent) {
    return {
      ...property,
      slugs: {
        es: "obra-nueva-almitak-mijas",
        en: "new-build-almitak-mijas",
        de: "neubau-almitak-mijas",
        fr: "programme-neuf-almitak-mijas",
        it: "nuova-costruzione-almitak-mijas",
        nl: "nieuwbouw-almitak-mijas",
      },
      translations: {
        ...(property.translations ?? {}),
        es: {
          ...(property.translations?.es ?? {}),
          title: "Almitak (Orion Collection): obra nueva en Mijas",
          intro: "Promocion de apartamentos en Las Lagunas de Mijas con diseno moderno y terrazas amplias.",
        },
        en: {
          ...(property.translations?.en ?? {}),
          title: "Almitak (Orion Collection): new build in Mijas",
          intro: "Apartment development in Las Lagunas de Mijas with contemporary design and generous terraces.",
        },
      },
    };
  }

  if (!isUnit) return property;

  const parsed = parseUnitFromFloorplan(getFloorplanUrl(property));
  if (!parsed) return property;

  return {
    ...property,
    id: parsed.id,
    phase: parsed.phase,
    slugs: unitSlugs(parsed.portal, parsed.slugFloor, parsed.letter),
    property: {
      ...(property.property ?? {}),
      portal: parsed.portal,
      unit_code: parsed.unitCode,
      floor_level: parsed.floorNumber,
      floor_label: parsed.floorLabelJson,
      type_label: parsed.letter,
    },
    seo: {
      ...(property.seo ?? {}),
      meta_description: {
        ...(property.seo?.meta_description ?? {}),
        es: `Unidad ${parsed.unitCode} en Orion Collection: Almitak, Las Lagunas de Mijas. Consulte disponibilidad, superficies y precio.`,
        en: `Unit ${parsed.unitCode} at Orion Collection: Almitak, Las Lagunas de Mijas. Check availability, areas and price.`,
      },
    },
    translations: {
      ...(property.translations ?? {}),
      es: {
        ...(property.translations?.es ?? {}),
        title: `Unidad ${parsed.unitCode} en Orion Collection: Almitak`,
        intro: `Unidad disponible en portal ${parsed.portal}, ${parsed.labels.es}, letra ${parsed.letter} con ${property.property?.bedrooms ?? "-"} dormitorios.`,
      },
      en: {
        ...(property.translations?.en ?? {}),
        title: `Unit ${parsed.unitCode} at Orion Collection: Almitak`,
        intro: `Available unit in portal ${parsed.portal}, ${parsed.labels.en}, letter ${parsed.letter} with ${property.property?.bedrooms ?? "-"} bedrooms.`,
      },
      de: {
        ...(property.translations?.de ?? {}),
        title: `Einheit ${parsed.unitCode} in Orion Collection: Almitak`,
        intro: `Verfuegbare Einheit in Portal ${parsed.portal}, ${parsed.labels.de}, Buchstabe ${parsed.letter} mit ${property.property?.bedrooms ?? "-"} Schlafzimmern.`,
      },
      fr: {
        ...(property.translations?.fr ?? {}),
        title: `Unite ${parsed.unitCode} a Orion Collection: Almitak`,
        intro: `Unite disponible au portail ${parsed.portal}, ${parsed.labels.fr}, lettre ${parsed.letter} avec ${property.property?.bedrooms ?? "-"} chambres.`,
      },
      it: {
        ...(property.translations?.it ?? {}),
        title: `Unita ${parsed.unitCode} a Orion Collection: Almitak`,
        intro: `Unita disponibile nel portale ${parsed.portal}, ${parsed.labels.it}, lettera ${parsed.letter} con ${property.property?.bedrooms ?? "-"} camere.`,
      },
      nl: {
        ...(property.translations?.nl ?? {}),
        title: `Unit ${parsed.unitCode} in Orion Collection: Almitak`,
        intro: `Beschikbare unit in portaal ${parsed.portal}, ${parsed.labels.nl}, letter ${parsed.letter} met ${property.property?.bedrooms ?? "-"} slaapkamers.`,
      },
    },
  };
};
