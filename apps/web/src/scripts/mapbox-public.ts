import mapboxCssUrl from "mapbox-gl/dist/mapbox-gl.css?url";

type Feature = {
  id?: string | number;
  geometry?: {
    type?: string;
    coordinates?: any;
  };
  properties?: Record<string, unknown>;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

type PoiFilter = {
  id: string;
  label: string;
};

type PoiVisual = {
  color: string;
  svg: string;
};

const MAP_POI_POINT_COLOR = "#ff4f7d";

type MapState = {
  booted: boolean;
  loading: boolean;
  map: any;
  mapboxgl: any;
  observer: IntersectionObserver | null;
  featureCollection: FeatureCollection;
  featureCollectionPromise: Promise<FeatureCollection> | null;
  activePoiCategories: Set<string>;
  extrasLoaded: boolean;
  routeOrigin: [number, number] | null;
  routeDestination: [number, number] | null;
  routeHelperPromise: Promise<typeof import("./mapbox-routing")> | null;
  zoneCollection: FeatureCollection;
  poiCollection: FeatureCollection;
  selectedZoneIds: Set<string>;
  selectedAreaIds: Set<string>;
  spatialHelperPromise: Promise<{
    point: (coordinates: [number, number]) => unknown;
    booleanPointInPolygon: (pointFeature: unknown, polygonFeature: Feature) => boolean;
  }> | null;
  spatialHelpers: {
    point: (coordinates: [number, number]) => unknown;
    booleanPointInPolygon: (pointFeature: unknown, polygonFeature: Feature) => boolean;
  } | null;
};

type InitMapboxOptions = {
  eager?: boolean;
};

const mapStates = new WeakMap<HTMLElement, MapState>();
let mapboxStylesheetPromise: Promise<void> | null = null;

const parseBoolean = (value: string | undefined) => value === "true";

const parseJson = <T>(value: string | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const POPUP_LOCALE_BY_LANG: Record<string, string> = {
  es: "es-ES",
  en: "en-GB",
  de: "de-DE",
  fr: "fr-FR",
  it: "it-IT",
  nl: "nl-NL",
};

const POPUP_PRICE_PREFIX: Record<string, string> = {
  es: "Desde",
  en: "From",
  de: "Ab",
  fr: "Des",
  it: "Da",
  nl: "Vanaf",
};

const inferFeatureLang = (feature: Feature) => {
  const href = String(feature.properties?.href ?? "").trim();
  const match = href.match(/^\/(es|en|de|fr|it|nl)(?:\/|$)/i);
  return (match?.[1]?.toLowerCase() ?? "es") as keyof typeof POPUP_LOCALE_BY_LANG;
};

const formatPopupPrice = (feature: Feature) => {
  const props = feature.properties ?? {};
  const rawValue = props.summaryPrice;
  if (rawValue == null || rawValue === "") return "";

  const lang = inferFeatureLang(feature);
  const locale = POPUP_LOCALE_BY_LANG[lang] ?? POPUP_LOCALE_BY_LANG.es;
  const currency = String(props.summaryCurrency ?? "EUR").trim() || "EUR";
  const listingType = String(props.listingType ?? "").trim().toLowerCase();

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    const amount = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(rawValue);
    return listingType === "promotion"
      ? `${POPUP_PRICE_PREFIX[lang] ?? POPUP_PRICE_PREFIX.es} ${amount}`
      : amount;
  }

  const amount = String(rawValue).trim();
  if (!amount) return "";
  return listingType === "promotion"
    ? `${POPUP_PRICE_PREFIX[lang] ?? POPUP_PRICE_PREFIX.es} ${amount}`
    : amount;
};

const poiVisuals: Record<string, PoiVisual> = {
  restaurant: {
    color: "#c3953b",
    svg: '<path d="M7.6 5v5.8M5.9 5v3.4M9.3 5v3.4M7.6 10.8V19M15.9 5l-2.7 6.4h4.1M15 11.4 14.2 19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  hospital: {
    color: "#d32c43",
    svg: '<path d="M12 6.4v11.2M6.4 12h11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  },
  school: {
    color: "#3c5e94",
    svg: '<path d="M4.8 9 12 5.6 19.2 9 12 12.4 4.8 9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.4 11.5v2.7c0 1.4 2 2.5 4.6 2.5s4.6-1.1 4.6-2.5v-2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  pharmacy: {
    color: "#202f4e",
    svg: '<path d="M12 6.4v11.2M6.4 12h11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="6.6" y="6.6" width="10.8" height="10.8" rx="3" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  },
  airport: {
    color: "#5d7394",
    svg: '<path d="M12 5.4v13.2M5.4 12h13.2M8.1 8.7 12 10.8l3.9-2.1M8.6 15.1 12 13.5l3.4 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  leisure: {
    color: "#8f6a45",
    svg: '<path d="m12 6.3 1.7 3.4 3.8.6-2.8 2.6.7 3.8-3.4-1.9-3.4 1.9.7-3.8-2.8-2.6 3.8-.6L12 6.3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  },
};

const getPoiVisual = (categoryId: string): PoiVisual => {
  return poiVisuals[categoryId] ?? {
    color: "#64748b",
    svg: '<circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
};

const buildPoiChipIconSvg = (categoryId: string) => {
  const visual = getPoiVisual(categoryId);
  return `<svg viewBox="0 0 24 24" class="poi-chip-icon-svg" aria-hidden="true" focusable="false">${visual.svg}</svg>`;
};

const buildPoiMarkerSvg = (categoryId: string) => {
  const visual = getPoiVisual(categoryId);
  const glyph = visual.svg.replaceAll("currentColor", visual.color);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r="14.5" fill="#ffffff" stroke="${visual.color}" stroke-width="2"/>
      <g transform="translate(10 10)">
        ${glyph}
      </g>
    </svg>
  `.trim();
};

const encodeSvgDataUri = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("poi_icon_load_failed"));
    image.src = src;
  });

const ensurePoiMarkerImages = async (map: any, poiFilters: PoiFilter[]) => {
  await Promise.all(
    poiFilters.map(async (filter) => {
      const imageId = `poi-marker-${filter.id}`;
      if (map.hasImage?.(imageId)) return;
      const image = await loadImageElement(encodeSvgDataUri(buildPoiMarkerSvg(filter.id)));
      map.addImage(imageId, image, { pixelRatio: 2 });
    })
  );
};

const toFeatureCollection = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

const normalizeFeatureCollection = (value: FeatureCollection | null | undefined): FeatureCollection =>
  toFeatureCollection(withStableFeatures(Array.isArray(value?.features) ? value.features : []));

const withStableFeatures = (features: Feature[]) =>
  features
    .filter((feature) => Array.isArray(feature.geometry?.coordinates))
    .map((feature, index) => ({
      ...feature,
      id: feature.id ?? `feature-${index + 1}`,
    }));

const slugify = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const getFeatureCoordinates = (feature: Feature): [number, number] | null => {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
};

const normalizePropertyFeatures = (features: Feature[]) =>
  withStableFeatures(features).map((feature) => {
    const properties = feature.properties ?? {};
    const city = String(properties.city ?? "").trim();
    const area = String(properties.area ?? city).trim();
    const areaId = String(properties.areaId ?? "").trim() || `${slugify(city)}::${slugify(area)}`;
    return {
      ...feature,
      properties: {
        ...properties,
        city,
        area,
        areaId,
      },
    };
  });

const normalizePropertyFeatureCollection = (
  value: FeatureCollection | null | undefined
): FeatureCollection => ({
  type: "FeatureCollection",
  features: normalizePropertyFeatures(Array.isArray(value?.features) ? value.features : []),
});

const normalizePoiFeatures = (features: Feature[]) =>
  withStableFeatures(features).map((feature, index) => {
    const properties = feature.properties ?? {};
    const city = String(properties.city ?? "").trim();
    const area = String(properties.area ?? "").trim();
    const areaId =
      String(properties.areaId ?? "").trim() ||
      (city && area ? `${slugify(city)}::${slugify(area)}` : "");
    return {
      ...feature,
      id: feature.id ?? `poi-${index + 1}`,
      properties: {
        ...properties,
        city,
        area,
        areaId,
      },
    };
  });

const normalizePoiFeatureCollection = (
  value: FeatureCollection | null | undefined
): FeatureCollection => ({
  type: "FeatureCollection",
  features: normalizePoiFeatures(Array.isArray(value?.features) ? value.features : []),
});

const normalizeZoneFeatureCollection = (
  value: FeatureCollection | null | undefined
): FeatureCollection => ({
  type: "FeatureCollection",
  features: withStableFeatures(Array.isArray(value?.features) ? value.features : []).map((feature, index) => ({
    ...feature,
    id: feature.id ?? `zone-${index + 1}`,
    properties: {
      ...(feature.properties ?? {}),
      id: String(feature.properties?.id ?? feature.id ?? `zone-${index + 1}`),
      name: String(feature.properties?.name ?? feature.properties?.id ?? `zone-${index + 1}`),
    },
  })),
});

const ensureMapboxStylesheet = () => {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  if (mapboxStylesheetPromise) {
    return mapboxStylesheetPromise;
  }

  const href = String(mapboxCssUrl || "").trim();
  if (!href) {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLLinkElement>(
    `link[rel="stylesheet"][href="${href}"]`
  );
  if (existing) {
    mapboxStylesheetPromise = Promise.resolve();
    return mapboxStylesheetPromise;
  }

  mapboxStylesheetPromise = new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.mapboxStyles = "true";
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    document.head.append(link);
  });

  return mapboxStylesheetPromise;
};

const loadFeatureCollection = async (root: HTMLElement, state: MapState) => {
  if (state.featureCollection.features.length > 0) {
    return state.featureCollection;
  }

  const featuresUrl = String(root.dataset.featuresUrl ?? "").trim();
  if (!featuresUrl) {
    return state.featureCollection;
  }

  if (state.featureCollectionPromise) {
    return state.featureCollectionPromise;
  }

  const promise = fetch(featuresUrl, {
    headers: {
      Accept: "application/json",
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        return state.featureCollection;
      }

      const payload = await response.json();
      const normalized = normalizePropertyFeatureCollection(payload as FeatureCollection);
      state.featureCollection = normalized;
      state.featureCollectionPromise = null;
      return normalized;
    })
    .catch(() => {
      state.featureCollectionPromise = null;
      return state.featureCollection;
    });

  state.featureCollectionPromise = promise;
  return promise;
};

const getMapRoots = (container: ParentNode = document) => {
  if (container instanceof HTMLElement && container.matches("[data-mapbox-root]")) {
    return [container];
  }

  return Array.from(container.querySelectorAll<HTMLElement>("[data-mapbox-root]"));
};

const createInitialState = (root: HTMLElement): MapState => ({
  booted: false,
  loading: false,
  map: null,
  mapboxgl: null,
  observer: null,
  featureCollection: normalizePropertyFeatureCollection(
    parseJson<FeatureCollection>(root.dataset.features, {
      type: "FeatureCollection",
      features: [],
    })
  ),
  featureCollectionPromise: null,
  activePoiCategories: new Set<string>(),
  extrasLoaded: false,
  routeOrigin: null,
  routeDestination: null,
  routeHelperPromise: null,
  zoneCollection: { type: "FeatureCollection", features: [] },
  poiCollection: { type: "FeatureCollection", features: [] },
  selectedZoneIds: new Set<string>(),
  selectedAreaIds: new Set<string>(),
  spatialHelperPromise: null,
  spatialHelpers: null,
});

const ensureState = (root: HTMLElement) => {
  const existing = mapStates.get(root);
  if (existing) return existing;
  const state = createInitialState(root);
  mapStates.set(root, state);
  return state;
};

const resetMapState = (root: HTMLElement, state: MapState) => {
  state.observer?.disconnect();
  state.observer = null;

  if (state.map && typeof state.map.remove === "function") {
    state.map.remove();
  }

  state.booted = false;
  state.loading = false;
  state.map = null;
  state.mapboxgl = null;
  state.featureCollection = normalizePropertyFeatureCollection(
    parseJson<FeatureCollection>(root.dataset.features, {
      type: "FeatureCollection",
      features: [],
    })
  );
  state.featureCollectionPromise = null;
  state.activePoiCategories.clear();
  state.extrasLoaded = false;
  state.routeOrigin = null;
  state.routeDestination = null;
  state.routeHelperPromise = null;
  state.zoneCollection = { type: "FeatureCollection", features: [] };
  state.poiCollection = { type: "FeatureCollection", features: [] };
  state.selectedZoneIds.clear();
  state.selectedAreaIds.clear();
  state.spatialHelperPromise = null;
  state.spatialHelpers = null;
};

const buildPopupHtml = (
  feature: Feature,
  options: {
    openDetailLabel: string;
    routeStartLabel: string;
    enableRouting: boolean;
  }
) => {
  const props = feature.properties ?? {};
  const title = escapeHtml(props.title ?? "Propiedad");
  const coverUrl = escapeHtml(props.coverUrl ?? "");
  const coverFallback = escapeHtml(props.coverUrlFallback ?? props.coverUrl ?? "");
  const locationParts = [props.city, props.area]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index);
  const summaryParts = [
    props.summaryBedroomsMin ? `${props.summaryBedroomsMin} dorm.` : "",
    props.summaryAreaMin ? `${props.summaryAreaMin} m2` : "",
  ].filter(Boolean);
  const priceLabel = formatPopupPrice(feature);
  const media = coverUrl
    ? `<div class="map-popup-media"><img class="map-popup-cover" src="${coverUrl}" data-fallback-src="${coverFallback}" alt="${title}" loading="lazy" decoding="async" onerror="if(!this.dataset.fallbackApplied){this.dataset.fallbackApplied='1';this.src=this.dataset.fallbackSrc||this.src;}" />${priceLabel ? `<p class="map-popup-price">${escapeHtml(priceLabel)}</p>` : ""}</div>`
    : "";
  const locationLine = locationParts.length
    ? `<p class="map-popup-location">${escapeHtml(locationParts.join(" · "))}</p>`
    : "";
  const summaryLine = summaryParts.length
    ? `<p class="map-popup-summary">${escapeHtml(summaryParts.join(" · "))}</p>`
    : "";

  void options;
  return `<div class="map-popup">${media}<div class="map-popup-body">${locationLine}<h3>${title}</h3>${summaryLine}</div></div>`;
};

const updateRoutePanel = (root: HTMLElement, state: MapState, labels: Record<string, string>) => {
  const routePanel = root.querySelector<HTMLElement>("[data-map-route-panel]");
  const status = root.querySelector<HTMLElement>("[data-map-route-status]");
  const metrics = root.querySelector<HTMLElement>("[data-map-route-metrics]");
  const distance = root.querySelector<HTMLElement>("[data-map-route-distance]");
  const duration = root.querySelector<HTMLElement>("[data-map-route-duration]");
  if (!(routePanel && status && metrics && distance && duration)) return;

  if (!state.routeOrigin) {
    routePanel.hidden = true;
    metrics.hidden = true;
    status.textContent = labels.routeSelectionHint;
    distance.textContent = "";
    duration.textContent = "";
    return;
  }

  routePanel.hidden = false;
  status.textContent = state.routeDestination
    ? labels.routeReady
    : labels.routeWaiting;
};

const fitToFeatures = (mapboxgl: any, map: any, features: Feature[], compactMode: boolean) => {
  if (!features.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  features.forEach((feature) => {
    const coords = feature.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) bounds.extend(coords);
  });
  if (bounds.isEmpty()) return;
  map.fitBounds(bounds, {
    padding: compactMode ? 36 : 60,
    duration: 700,
    maxZoom: compactMode ? 14.8 : 15.8,
  });
};

const moveLayerIfPresent = (map: any, layerId: string) => {
  if (!map.getLayer(layerId)) return;
  map.moveLayer(layerId);
};

const prioritizePropertyLayers = (map: any) => {
  ["route-line", "zones-fill", "zones-outline", "zones-selected", "areas-bubbles", "areas-count"].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.moveLayer(layerId);
    }
  });

  const poiLayers = (map.getStyle?.().layers ?? [])
    .map((layer: { id?: string }) => String(layer?.id ?? ""))
    .filter((layerId) => layerId.startsWith("pois-"));
  poiLayers.forEach((layerId) => {
    moveLayerIfPresent(map, layerId);
  });

  ["clusters", "cluster-count", "points-halo", "points"].forEach((layerId) => {
    moveLayerIfPresent(map, layerId);
  });
};

const setPoiVisibility = (
  map: any,
  categoryId: string,
  visible: boolean,
  showLabels = true
) => {
  if (map.getLayer(`pois-${categoryId}`)) {
    map.setLayoutProperty(`pois-${categoryId}`, "visibility", visible ? "visible" : "none");
  }
  if (map.getLayer(`pois-symbol-${categoryId}`)) {
    map.setLayoutProperty(
      `pois-symbol-${categoryId}`,
      "visibility",
      visible && showLabels ? "none" : "none"
    );
  }
};

const ensureRouteLayers = (map: any) => {
  if (!map.getSource("route")) {
    map.addSource("route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer("route-line")) {
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#d32c43",
        "line-width": 4,
        "line-opacity": 0.9,
      },
    });
  }

  prioritizePropertyLayers(map);
};

const ensureSpatialHelpers = async (state: MapState) => {
  if (state.spatialHelpers) {
    return state.spatialHelpers;
  }

  if (!state.spatialHelperPromise) {
    state.spatialHelperPromise = Promise.all([
      import("@turf/helpers"),
      import("@turf/boolean-point-in-polygon"),
    ]).then(([helpersModule, booleanModule]) => ({
      point: helpersModule.point,
      booleanPointInPolygon: booleanModule.default,
    }));
  }

  state.spatialHelpers = await state.spatialHelperPromise;
  return state.spatialHelpers;
};

const getSelectedZoneFeatures = (state: MapState) => {
  if (!state.selectedZoneIds.size) return [];
  return state.zoneCollection.features.filter((feature) =>
    state.selectedZoneIds.has(String(feature.properties?.id ?? ""))
  );
};

const pointInsideSelectedZones = (state: MapState, coordinates: [number, number]) => {
  const selectedZones = getSelectedZoneFeatures(state);
  if (!selectedZones.length) return true;
  if (!state.spatialHelpers) return true;
  return selectedZones.some((zoneFeature) =>
    state.spatialHelpers!.booleanPointInPolygon(
      state.spatialHelpers!.point(coordinates),
      zoneFeature
    )
  );
};

const filterFeaturesBySelection = (state: MapState, features: Feature[]) => {
  const byZone = features.filter((feature) => {
    const coordinates = getFeatureCoordinates(feature);
    if (!coordinates) return false;
    return pointInsideSelectedZones(state, coordinates);
  });

  if (!state.selectedAreaIds.size) {
    return byZone;
  }

  return byZone.filter((feature) =>
    state.selectedAreaIds.has(String(feature.properties?.areaId ?? ""))
  );
};

const getFilteredPropertyCollection = (state: MapState): FeatureCollection => ({
  type: "FeatureCollection",
  features: filterFeaturesBySelection(state, state.featureCollection.features),
});

const getFilteredPoiCollection = (state: MapState): FeatureCollection => ({
  type: "FeatureCollection",
  features: state.poiCollection.features
    .filter((feature) => {
      const coordinates = getFeatureCoordinates(feature);
      return coordinates ? pointInsideSelectedZones(state, coordinates) : false;
    })
    .filter((feature) => {
      if (!state.selectedAreaIds.size) return true;
      const areaId = String(feature.properties?.areaId ?? "");
      return !areaId || state.selectedAreaIds.has(areaId);
    }),
});

const computeAreaFeatures = (state: MapState): FeatureCollection => {
  if (!state.selectedZoneIds.size || !state.map || state.map.getZoom() < 10) {
    return { type: "FeatureCollection", features: [] };
  }

  const grouped = new Map<
    string,
    {
      areaId: string;
      area: string;
      city: string;
      count: number;
      points: [number, number][];
    }
  >();

  filterFeaturesBySelection(
    { ...state, selectedAreaIds: new Set<string>() },
    state.featureCollection.features
  ).forEach((feature) => {
    const coordinates = getFeatureCoordinates(feature);
    if (!coordinates) return;
    const properties = feature.properties ?? {};
    const areaId = String(properties.areaId ?? "").trim();
    const area = String(properties.area ?? "").trim();
    const city = String(properties.city ?? "").trim();
    if (!areaId || !area) return;
    const current = grouped.get(areaId) ?? {
      areaId,
      area,
      city,
      count: 0,
      points: [],
    };
    current.count += 1;
    current.points.push(coordinates);
    grouped.set(areaId, current);
  });

  return {
    type: "FeatureCollection",
    features: Array.from(grouped.values()).map((entry, index) => {
      const lngs = entry.points.map((point) => point[0]);
      const lats = entry.points.map((point) => point[1]);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      return {
        id: `area-${index + 1}`,
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [(minLng + maxLng) / 2, (minLat + maxLat) / 2] as [number, number],
        },
        properties: {
          areaId: entry.areaId,
          area: entry.area,
          city: entry.city,
          count: entry.count,
          minLng,
          maxLng,
          minLat,
          maxLat,
        },
      };
    }),
  };
};

const updateAreasSource = (state: MapState) => {
  const areasSource = state.map?.getSource?.("areas");
  if (!areasSource) return;
  areasSource.setData(computeAreaFeatures(state));
};

const updateZoneSelectionLayers = (state: MapState) => {
  if (!state.map?.getLayer?.("zones-selected")) return;
  const selectedIds = Array.from(state.selectedZoneIds);
  state.map.setFilter(
    "zones-selected",
    selectedIds.length ? ["match", ["get", "id"], selectedIds, true, false] : ["==", ["get", "id"], ""]
  );
};

const updateZoneLayerVisibility = (state: MapState) => {
  const hideBaseZones = state.selectedZoneIds.size > 0 && state.map?.getZoom?.() >= 12.5;
  const zoneVisibility = hideBaseZones ? "none" : "visible";
  ["zones-fill", "zones-outline", "zones-count"].forEach((layerId) => {
    if (state.map?.getLayer?.(layerId)) {
      state.map.setLayoutProperty(layerId, "visibility", zoneVisibility);
    }
  });
  ["areas-bubbles", "areas-count"].forEach((layerId) => {
    if (state.map?.getLayer?.(layerId)) {
      state.map.setLayoutProperty(
        layerId,
        "visibility",
        state.selectedZoneIds.size > 0 ? "visible" : "none"
      );
    }
  });
};

const applySelectionFilters = (state: MapState) => {
  const propertySource = state.map?.getSource?.("properties");
  if (propertySource) {
    propertySource.setData(getFilteredPropertyCollection(state));
  }
  const poiSource = state.map?.getSource?.("pois");
  if (poiSource) {
    poiSource.setData(getFilteredPoiCollection(state));
  }
  updateZoneSelectionLayers(state);
  updateZoneLayerVisibility(state);
  updateAreasSource(state);
};

const extendBoundsWithGeometry = (bounds: any, geometry: Feature["geometry"]) => {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    geometry.coordinates?.forEach((ring: [number, number][]) => {
      ring?.forEach((coordinate) => bounds.extend(coordinate));
    });
    return;
  }
  if (geometry.type === "MultiPolygon") {
    geometry.coordinates?.forEach((polygon: [number, number][][]) => {
      polygon?.forEach((ring) => {
        ring?.forEach((coordinate) => bounds.extend(coordinate));
      });
    });
  }
};

const fitMapToAreaBounds = (map: any, boundsLike: [number, number, number, number]) => {
  const [minLng, minLat, maxLng, maxLat] = boundsLike;
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return;
  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 55, duration: 700, maxZoom: 16.2 }
  );
};

const resetSelections = (state: MapState) => {
  state.selectedZoneIds.clear();
  state.selectedAreaIds.clear();
  applySelectionFilters(state);
};

const dispatchPropertyFocusEvent = (feature: Feature) => {
  const properties = feature.properties ?? {};
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("property-map:focus", {
      detail: {
        id: String(properties.id ?? "").trim(),
        slug: String(properties.slug ?? "").trim(),
        href: String(properties.href ?? "").trim(),
      },
    })
  );
};

const ensureAdvancedExtras = async (root: HTMLElement, state: MapState) => {
  if (state.extrasLoaded || !(state.booted && state.map)) return;

  const map = state.map;
  await ensureSpatialHelpers(state);
  const labels = {
    openDetailLabel: root.dataset.openDetailLabel || "Ver ficha",
    routeStartLabel: root.dataset.routeStartLabel || "Iniciar ruta",
  };
  const poiFilters = parseJson<PoiFilter[]>(root.dataset.poiFilters, []);
  const poiPanel = root.querySelector<HTMLElement>("[data-map-poi-panel]");
  const poiFiltersEl = root.querySelector<HTMLElement>("[data-map-poi-filters]");
  const showPoiLabels = parseBoolean(root.dataset.enableRouting);
  const shouldAutoLoadExtras = parseBoolean(root.dataset.autoLoadExtras);

  if (parseBoolean(root.dataset.showZones) || parseBoolean(root.dataset.canLoadExtras)) {
    try {
      const response = await fetch(root.dataset.zonesUrl || "");
      if (response.ok) {
        state.zoneCollection = normalizeZoneFeatureCollection(
          (await response.json()) as FeatureCollection
        );
        if (!map.getSource("zones")) {
          map.addSource("zones", { type: "geojson", data: state.zoneCollection });
          map.addLayer({
            id: "zones-fill",
            type: "fill",
            source: "zones",
            paint: {
              "fill-color": "#2563eb",
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                0.2,
                0.08,
              ],
            },
          });
          map.addLayer({
            id: "zones-outline",
            type: "line",
            source: "zones",
            paint: {
              "line-color": "#1d4ed8",
              "line-width": 1,
            },
          });
          map.addLayer({
            id: "zones-selected",
            type: "line",
            source: "zones",
            filter: ["==", ["get", "id"], ""],
            paint: {
              "line-color": "#d32c43",
              "line-width": 3,
            },
          });
          map.addLayer({
            id: "zones-count",
            type: "symbol",
            source: "zones",
            layout: {
              "text-field": [
                "case",
                [">", ["coalesce", ["get", "propertyCount"], 0], 0],
                ["to-string", ["get", "propertyCount"]],
                "",
              ],
              "text-size": 12,
            },
            paint: {
              "text-color": "#0f172a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.2,
            },
          });
          map.addSource("areas", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "areas-bubbles",
            type: "circle",
            source: "areas",
            layout: {
              visibility: "none",
            },
            paint: {
              "circle-color": "#1d4ed8",
              "circle-opacity": 0.18,
              "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 18, 12, 30],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.6,
            },
          });
          map.addLayer({
            id: "areas-count",
            type: "symbol",
            source: "areas",
            layout: {
              visibility: "none",
              "text-field": ["to-string", ["get", "count"]],
              "text-size": 11,
            },
            paint: {
              "text-color": "#ffffff",
            },
          });

          let hoveredZoneId: string | number | null = null;
          map.on("mousemove", "zones-fill", (event: any) => {
            const feature = event.features?.[0];
            if (!feature) return;
            if (hoveredZoneId !== null) {
              map.setFeatureState({ source: "zones", id: hoveredZoneId }, { hover: false });
            }
            hoveredZoneId = feature.id ?? null;
            if (hoveredZoneId !== null) {
              map.setFeatureState({ source: "zones", id: hoveredZoneId }, { hover: true });
            }
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "zones-fill", () => {
            if (hoveredZoneId !== null) {
              map.setFeatureState({ source: "zones", id: hoveredZoneId }, { hover: false });
            }
            hoveredZoneId = null;
            map.getCanvas().style.cursor = "";
          });
          map.on("click", "zones-fill", (event: any) => {
            const feature = event.features?.[0] as Feature | undefined;
            if (!feature) return;
            const zoneId = String(feature.properties?.id ?? "");
            if (!zoneId) return;
            const wasSelected = state.selectedZoneIds.has(zoneId);
            if (wasSelected) {
              state.selectedZoneIds.delete(zoneId);
            } else {
              state.selectedZoneIds.add(zoneId);
            }
            state.selectedAreaIds.clear();
            applySelectionFilters(state);
            if (wasSelected) return;
            const bounds = new state.mapboxgl.LngLatBounds();
            extendBoundsWithGeometry(bounds, feature.geometry);
            if (!bounds.isEmpty()) {
              map.fitBounds(bounds, { padding: 55, duration: 700, maxZoom: 11.8 });
            }
          });
          map.on("mouseenter", "areas-bubbles", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "areas-bubbles", () => {
            map.getCanvas().style.cursor = "";
          });
          map.on("click", "areas-bubbles", (event: any) => {
            const feature = event.features?.[0] as Feature | undefined;
            if (!feature) return;
            const areaId = String(feature.properties?.areaId ?? "");
            if (!areaId) return;
            if (state.selectedAreaIds.has(areaId)) {
              state.selectedAreaIds.delete(areaId);
            } else {
              state.selectedAreaIds.add(areaId);
            }
            applySelectionFilters(state);
            fitMapToAreaBounds(map, [
              Number(feature.properties?.minLng),
              Number(feature.properties?.minLat),
              Number(feature.properties?.maxLng),
              Number(feature.properties?.maxLat),
            ]);
          });
          map.on("click", (event: any) => {
            if (!state.selectedZoneIds.size) return;
            const layers = [
              "zones-fill",
              "zones-outline",
              "zones-selected",
              "areas-bubbles",
              "points",
              "clusters",
              ...(map.getStyle?.().layers ?? [])
                .map((layer: { id?: string }) => String(layer?.id ?? ""))
                .filter((layerId: string) => layerId.startsWith("pois-")),
            ].filter((layerId) => map.getLayer(layerId));
            const hits = layers.length ? map.queryRenderedFeatures(event.point, { layers }) : [];
            if (!hits.length) {
              resetSelections(state);
            }
          });
          prioritizePropertyLayers(map);
        }

        const counts = state.zoneCollection.features.map((feature) => {
          const count = state.featureCollection.features.filter((propertyFeature) => {
            const coordinates = getFeatureCoordinates(propertyFeature);
            return coordinates ? pointInsideSelectedZones({ ...state, selectedZoneIds: new Set([String(feature.properties?.id ?? "")]) }, coordinates) : false;
          }).length;
          return {
            ...feature,
            properties: {
              ...(feature.properties ?? {}),
              propertyCount: count,
            },
          };
        });
        state.zoneCollection = { type: "FeatureCollection", features: counts };
        map.getSource("zones")?.setData(state.zoneCollection);
        applySelectionFilters(state);
      }
    } catch {
      // Continue without zones.
    }
  }

  if (parseBoolean(root.dataset.showPois)) {
    try {
      const response = await fetch(root.dataset.poisUrl || "");
      if (response.ok) {
        state.poiCollection = normalizePoiFeatureCollection(
          (await response.json()) as FeatureCollection
        );
        if (!map.getSource("pois")) {
          await ensurePoiMarkerImages(map, poiFilters);
          map.addSource("pois", { type: "geojson", data: getFilteredPoiCollection(state) });

          poiFilters.forEach((filter) => {
            map.addLayer({
              id: `pois-${filter.id}`,
              type: "circle",
              source: "pois",
              filter: ["==", ["get", "category"], filter.id],
              layout: { visibility: "none" },
              paint: {
                "circle-color": MAP_POI_POINT_COLOR,
                "circle-radius": 4.6,
                "circle-opacity": 0.94,
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 1.1,
              },
            });

            map.addLayer({
              id: `pois-symbol-${filter.id}`,
              type: "symbol",
              source: "pois",
              filter: ["==", ["get", "category"], filter.id],
              layout: {
                visibility: "none",
                "icon-image": `poi-marker-${filter.id}`,
                "icon-size": showPoiLabels ? 0.82 : 0.76,
                "icon-anchor": "center",
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
              },
            });

            const handler = async (event: any) => {
              const poi = event.features?.[0];
              if (!poi) return;
              new state.mapboxgl.Popup({ closeButton: true, offset: 10 })
                .setLngLat(poi.geometry.coordinates.slice())
                .setHTML(
                  `<div class="map-popup"><div class="map-popup-body"><h3>${escapeHtml(
                    poi.properties?.name ?? "POI"
                  )}</h3><p>${escapeHtml(
                    [poi.properties?.city, poi.properties?.area].filter(Boolean).join(" · ")
                  )}</p></div></div>`
                )
                .addTo(map);

              if (!parseBoolean(root.dataset.enableRouting)) {
                return;
              }

              if (!state.routeOrigin) return;
              state.routeDestination = poi.geometry.coordinates.slice();
              ensureRouteLayers(map);
              if (!state.routeHelperPromise) {
                state.routeHelperPromise = import("./mapbox-routing");
              }
              try {
                const routeHelper = await state.routeHelperPromise;
                const route = await routeHelper.fetchDrivingRoute(
                  root.dataset.token || "",
                  state.routeOrigin,
                  state.routeDestination
                );
                if (!route) return;
                map.getSource("route")?.setData(route.collection);
                const metrics = root.querySelector<HTMLElement>("[data-map-route-metrics]");
                const distance = root.querySelector<HTMLElement>("[data-map-route-distance]");
                const duration = root.querySelector<HTMLElement>("[data-map-route-duration]");
                if (metrics && distance && duration) {
                  metrics.hidden = false;
                  distance.textContent = route.distanceKm;
                  duration.textContent = route.durationMin;
                }
                const status = root.querySelector<HTMLElement>("[data-map-route-status]");
                if (status) {
                  status.textContent = `${root.dataset.routeDistanceLabel || "Distancia"} y ${root.dataset.routeDurationLabel || "tiempo"} calculados.`;
                }
              } catch {
                // Keep the current map state if route fetch fails.
              }
            };

            map.on("click", `pois-${filter.id}`, handler);
            map.on("click", `pois-symbol-${filter.id}`, handler);
            map.on("mouseenter", `pois-${filter.id}`, () => {
              map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseenter", `pois-symbol-${filter.id}`, () => {
              map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", `pois-${filter.id}`, () => {
              map.getCanvas().style.cursor = "";
            });
            map.on("mouseleave", `pois-symbol-${filter.id}`, () => {
              map.getCanvas().style.cursor = "";
            });
          });

            if (poiFiltersEl) {
              poiFiltersEl.innerHTML = poiFilters
                .map(
                (filter) =>
                    `<button type="button" class="poi-chip" data-poi-category="${escapeHtml(filter.id)}" aria-label="${escapeHtml(filter.label)}" title="${escapeHtml(filter.label)}"><span class="poi-chip-icon" aria-hidden="true">${buildPoiChipIconSvg(filter.id)}</span></button>`
                )
                .join("");

            poiFiltersEl.querySelectorAll<HTMLElement>("[data-poi-category]").forEach((button) => {
              button.addEventListener("click", () => {
                const categoryId = button.dataset.poiCategory;
                if (!categoryId) return;
                const isActive = state.activePoiCategories.has(categoryId);
                if (isActive) {
                  state.activePoiCategories.delete(categoryId);
                } else {
                  state.activePoiCategories.add(categoryId);
                }
                button.classList.toggle("is-active", !isActive);
                setPoiVisibility(map, categoryId, !isActive, showPoiLabels);
              });
            });
          }

          if (poiPanel) {
            poiPanel.hidden = false;
          }

          applySelectionFilters(state);
          prioritizePropertyLayers(map);
        }
      }
    } catch {
      // Continue without POIs.
    }
  }

  if (parseBoolean(root.dataset.enableRouting)) {
    ensureRouteLayers(map);
  }

  applySelectionFilters(state);
  prioritizePropertyLayers(map);

  const routePanel = root.querySelector<HTMLElement>("[data-map-route-panel]");
  if (routePanel && parseBoolean(root.dataset.enableRouting)) {
    routePanel.hidden = false;
  }

  state.extrasLoaded = true;
};

const bootMap = async (root: HTMLElement) => {
  const existing = ensureState(root);
  if (existing?.booted || existing?.loading) return existing;

  const state: MapState = existing;
  state.loading = true;
  mapStates.set(root, state);

  const canvas = root.querySelector<HTMLElement>("[data-mapbox-canvas]");
  const overlay = root.querySelector<HTMLElement>("[data-mapbox-overlay]");
  if (!(canvas instanceof HTMLElement)) return state;

  if (!String(root.dataset.token ?? "").trim()) {
    canvas.innerHTML = `<div class="map-empty">${escapeHtml(root.dataset.empty || "Mapa no disponible.")}</div>`;
    if (overlay) overlay.hidden = true;
    state.loading = false;
    return state;
  }

  const [{ default: mapboxgl }] = await Promise.all([
    import("mapbox-gl"),
    ensureMapboxStylesheet(),
  ]);

  const compactMode = root.closest(".is-compact") instanceof HTMLElement;
  const featureCollection = await loadFeatureCollection(root, state);

  mapboxgl.accessToken = root.dataset.token || "";
  const map = new mapboxgl.Map({
    container: canvas,
    style: root.dataset.style || "mapbox://styles/mapbox/standard",
    center: [-4.92, 36.58],
    zoom: compactMode ? 9.8 : 10.4,
    cooperativeGestures: false,
    attributionControl: false,
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "top-right");
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

  state.map = map;
  state.mapboxgl = mapboxgl;

  const openDetailLabel = root.dataset.openDetailLabel || "Ver ficha";
  const routeStartLabel = root.dataset.routeStartLabel || "Iniciar ruta";
  const labels = {
    routeSelectionHint: root.dataset.routeSelectionHint || "Selecciona una vivienda para comenzar la ruta.",
    routeWaiting: "Selecciona un punto de interes como destino.",
    routeReady: "Ruta lista.",
  };

  map.on("load", async () => {
    const shouldCluster = !compactMode && featureCollection.features.length > 24;

    map.addSource("properties", {
      type: "geojson",
      data: featureCollection,
      cluster: shouldCluster,
      clusterRadius: 54,
    });

    if (shouldCluster) {
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "properties",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#202f4e",
          "circle-radius": ["step", ["get", "point_count"], 19, 12, 24, 24, 29],
          "circle-opacity": 0.92,
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "properties",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });
    }

    map.addLayer({
      id: "points-halo",
      type: "circle",
      source: "properties",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": compactMode ? "#ff3158" : "#d32c43",
        "circle-opacity": compactMode ? 0.18 : 0.14,
        "circle-radius": compactMode ? 10.5 : 8.8,
        "circle-blur": 0.62,
      },
    });

    map.addLayer({
      id: "points",
      type: "circle",
      source: "properties",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": compactMode ? "#ff3158" : "#d32c43",
        "circle-opacity": compactMode ? 0.98 : 0.94,
        "circle-radius": compactMode ? 7.4 : 6.1,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": compactMode ? 0.72 : 0.58,
      },
    });

    prioritizePropertyLayers(map);

    if (shouldCluster) {
      map.on("click", "clusters", (event: any) => {
        const cluster = map.queryRenderedFeatures(event.point, { layers: ["clusters"] })[0];
        const clusterId = cluster?.properties?.cluster_id;
        if (clusterId == null) return;
        map
          .getSource("properties")
          .getClusterExpansionZoom(clusterId, (_error: unknown, zoom: number) => {
            map.easeTo({
              center: cluster.geometry.coordinates,
              zoom,
              duration: 650,
            });
          });
      });
      map.on("mouseenter", "clusters", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "clusters", () => {
        map.getCanvas().style.cursor = "";
      });
    }

    map.on("click", "points", (event: any) => {
      const feature = event.features?.[0] as Feature | undefined;
      if (!feature) return;
      dispatchPropertyFocusEvent(feature);
      const coordinates = getFeatureCoordinates(feature) ?? [-4.92, 36.58];
      map.flyTo({
        center: coordinates,
        zoom: Math.max(map.getZoom(), compactMode ? 14.6 : 16.4),
        duration: 780,
        essential: true,
      });
      new mapboxgl.Popup({ closeButton: true, offset: 12 })
        .setLngLat(coordinates)
        .setHTML(
          buildPopupHtml(feature, {
            openDetailLabel,
            routeStartLabel,
            enableRouting: parseBoolean(root.dataset.enableRouting),
          })
        )
        .addTo(map);
    });

    map.on("mouseenter", "points", () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", "points", () => {
      map.getCanvas().style.cursor = "";
    });

    if (parseBoolean(root.dataset.fitToFeatures)) {
      fitToFeatures(mapboxgl, map, featureCollection.features, compactMode);
    } else if (featureCollection.features[0]?.geometry?.coordinates) {
      map.setCenter(featureCollection.features[0].geometry.coordinates);
      map.setZoom(compactMode ? 11.5 : 12.2);
    }

    if (
      parseBoolean(root.dataset.showPois) ||
      parseBoolean(root.dataset.showZones) ||
      shouldAutoLoadExtras
    ) {
      await ensureAdvancedExtras(root, state);
    }
  });

  map.on("moveend", () => {
    if (!state.extrasLoaded) return;
    updateZoneLayerVisibility(state);
    updateAreasSource(state);
  });

  root.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const routeOriginButton = target.closest<HTMLElement>("[data-route-origin]");
    if (routeOriginButton) {
      const coords = String(routeOriginButton.dataset.routeOrigin || "")
        .split(",")
        .map((value) => Number(value));
      if (coords.length === 2 && coords.every(Number.isFinite)) {
        state.routeOrigin = [coords[0], coords[1]];
        state.routeDestination = null;
        if (state.map?.getSource("route")) {
          state.map.getSource("route").setData({ type: "FeatureCollection", features: [] });
        }
        updateRoutePanel(root, state, labels);
      }
      return;
    }

    if (target.closest("[data-map-load-extras]")) {
      await ensureAdvancedExtras(root, state);
      const button = root.querySelector<HTMLElement>("[data-map-load-extras]");
      if (button) button.hidden = true;
      return;
    }

    if (target.closest("[data-map-route-clear]")) {
      state.routeOrigin = null;
      state.routeDestination = null;
      if (state.map?.getSource("route")) {
        state.map.getSource("route").setData({ type: "FeatureCollection", features: [] });
      }
      updateRoutePanel(root, state, labels);
    }
  });

  if (overlay) {
    overlay.hidden = true;
  }

  state.booted = true;
  state.loading = false;
  return state;
};

const initRoot = (root: HTMLElement) => {
  if (root.dataset.mapboxBound === "true") return;
  root.dataset.mapboxBound = "true";
  const state = ensureState(root);

  const resetButton = root.querySelector<HTMLElement>("[data-map-reset]");
  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      const state = await bootMap(root);
      if (!(state?.map && state?.mapboxgl)) return;
      resetSelections(state);
      state.routeOrigin = null;
      state.routeDestination = null;
      if (state.map.getSource?.("route")) {
        state.map.getSource("route").setData({ type: "FeatureCollection", features: [] });
      }
      updateRoutePanel(root, state, {
        routeSelectionHint: root.dataset.routeSelectionHint || "Selecciona una vivienda para comenzar la ruta.",
        routeWaiting: "Selecciona un punto de interes como destino.",
        routeReady: "Ruta lista.",
      });
      fitToFeatures(
        state.mapboxgl,
        state.map,
        state.featureCollection.features,
        root.closest(".is-compact") instanceof HTMLElement
      );
    });
  }

  if (root.dataset.loadStrategy === "interaction") return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const state = mapStates.get(root);
      if (state) {
        state.observer = null;
      }
      void bootMap(root);
    },
    {
      rootMargin: "180px 0px",
      threshold: 0.15,
    }
  );

  state.observer = observer;
  observer.observe(root);
};

const initRootWithOptions = (root: HTMLElement, options: InitMapboxOptions = {}) => {
  if (root.dataset.mapboxBound !== "true") {
    initRoot(root);
  }

  if (options.eager) {
    const state = mapStates.get(root);
    state?.observer?.disconnect();
    if (state) {
      state.observer = null;
    }
    void bootMap(root);
  }
};

export const initMapboxRoots = (container: ParentNode = document, options: InitMapboxOptions = {}) => {
  getMapRoots(container).forEach((root) => {
    initRootWithOptions(root, options);
  });
};

export const destroyMapboxRoots = (container: ParentNode = document) => {
  getMapRoots(container).forEach((root) => {
    const state = mapStates.get(root);
    if (!state) return;
    resetMapState(root, state);
    mapStates.delete(root);
    delete root.dataset.mapboxBound;
  });
};

initMapboxRoots(document);
