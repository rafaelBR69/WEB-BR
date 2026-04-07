import mapboxCssUrl from "mapbox-gl/dist/mapbox-gl.css?url";

type Feature = {
  id?: string | number;
  geometry?: {
    type?: string;
    coordinates?: [number, number];
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
      const normalized = normalizeFeatureCollection(payload as FeatureCollection);
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
  featureCollection: normalizeFeatureCollection(
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
  state.featureCollection = normalizeFeatureCollection(
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
  const href = escapeHtml(props.href ?? "#");
  const coverUrl = escapeHtml(props.coverUrl ?? "");
  const coverFallback = escapeHtml(props.coverUrlFallback ?? props.coverUrl ?? "");
  const locationParts = [props.city, props.area]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index);
  const summaryParts = [
    props.summaryPrice ? String(props.summaryPrice) : "",
    props.summaryBedroomsMin ? `${props.summaryBedroomsMin} dorm.` : "",
    props.summaryAreaMin ? `${props.summaryAreaMin} m2` : "",
  ].filter(Boolean);
  const media = coverUrl
    ? `<img class="map-popup-cover" src="${coverUrl}" data-fallback-src="${coverFallback}" alt="${title}" loading="lazy" decoding="async" onerror="if(!this.dataset.fallbackApplied){this.dataset.fallbackApplied='1';this.src=this.dataset.fallbackSrc||this.src;}" />`
    : "";
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  const routeButton =
    options.enableRouting && Number.isFinite(lng) && Number.isFinite(lat)
      ? `<button type="button" data-route-origin="${lng},${lat}" data-route-name="${title}">${escapeHtml(options.routeStartLabel)}</button>`
      : "";

  return `<div class="map-popup">${media}<div class="map-popup-body"><h3>${title}</h3><p>${escapeHtml(locationParts.join(" · "))}</p>${summaryParts.length ? `<p>${escapeHtml(summaryParts.join(" · "))}</p>` : ""}<div class="map-popup-actions">${routeButton}<a href="${href}">${escapeHtml(options.openDetailLabel)}</a></div></div></div>`;
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

const setPoiVisibility = (map: any, categoryId: string, visible: boolean) => {
  const visibility = visible ? "visible" : "none";
  [`pois-${categoryId}`, `pois-symbol-${categoryId}`].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visibility);
    }
  });
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
};

const ensureAdvancedExtras = async (root: HTMLElement, state: MapState) => {
  if (state.extrasLoaded || !(state.booted && state.map)) return;

  const map = state.map;
  const labels = {
    openDetailLabel: root.dataset.openDetailLabel || "Ver ficha",
    routeStartLabel: root.dataset.routeStartLabel || "Iniciar ruta",
  };
  const poiFilters = parseJson<PoiFilter[]>(root.dataset.poiFilters, []);
  const poiPanel = root.querySelector<HTMLElement>("[data-map-poi-panel]");
  const poiFiltersEl = root.querySelector<HTMLElement>("[data-map-poi-filters]");

  if (parseBoolean(root.dataset.showZones) || parseBoolean(root.dataset.canLoadExtras)) {
    try {
      const response = await fetch(root.dataset.zonesUrl || "");
      if (response.ok) {
        const zoneCollection = await response.json();
        if (!map.getSource("zones")) {
          map.addSource("zones", { type: "geojson", data: zoneCollection });
          map.addLayer({
            id: "zones-fill",
            type: "fill",
            source: "zones",
            paint: {
              "fill-color": "#2563eb",
              "fill-opacity": 0.08,
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
        }
      }
    } catch {
      // Continue without zones.
    }
  }

  if (parseBoolean(root.dataset.showPois) || parseBoolean(root.dataset.canLoadExtras)) {
    try {
      const response = await fetch(root.dataset.poisUrl || "");
      if (response.ok) {
        const poiCollection = await response.json();
        if (!map.getSource("pois")) {
          map.addSource("pois", { type: "geojson", data: poiCollection });

          poiFilters.forEach((filter) => {
            map.addLayer({
              id: `pois-${filter.id}`,
              type: "circle",
              source: "pois",
              filter: ["==", ["get", "category"], filter.id],
              layout: { visibility: "none" },
              paint: {
                "circle-color":
                  filter.id === "restaurant"
                    ? "#f97316"
                    : filter.id === "hospital"
                      ? "#ef4444"
                      : filter.id === "school"
                        ? "#2563eb"
                        : filter.id === "pharmacy"
                          ? "#16a34a"
                          : filter.id === "airport"
                            ? "#0ea5e9"
                            : "#9333ea",
                "circle-radius": 5,
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
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-anchor": "top",
                "text-offset": [0, 1.1],
              },
              paint: {
                "text-color": "#202f4e",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1,
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

              if (!(parseBoolean(root.dataset.enableRouting) || parseBoolean(root.dataset.canLoadExtras))) {
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
                  `<button type="button" class="poi-chip" data-poi-category="${escapeHtml(filter.id)}">${escapeHtml(filter.label)}</button>`
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
                setPoiVisibility(map, categoryId, !isActive);
              });
            });
          }

          if (poiPanel) {
            poiPanel.hidden = false;
          }
        }
      }
    } catch {
      // Continue without POIs.
    }
  }

  if (parseBoolean(root.dataset.enableRouting) || parseBoolean(root.dataset.canLoadExtras)) {
    ensureRouteLayers(map);
  }

  const routePanel = root.querySelector<HTMLElement>("[data-map-route-panel]");
  if (routePanel && (parseBoolean(root.dataset.enableRouting) || parseBoolean(root.dataset.canLoadExtras))) {
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
      id: "points",
      type: "circle",
      source: "properties",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#d32c43",
        "circle-radius": compactMode ? 9 : 8,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": compactMode ? 2.6 : 2,
      },
    });

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
    }

    map.on("click", "points", (event: any) => {
      const feature = event.features?.[0] as Feature | undefined;
      if (!feature) return;
      new mapboxgl.Popup({ closeButton: true, offset: 12 })
        .setLngLat(feature.geometry?.coordinates ?? [-4.92, 36.58])
        .setHTML(
          buildPopupHtml(feature, {
            openDetailLabel,
            routeStartLabel,
            enableRouting: parseBoolean(root.dataset.enableRouting) || state.extrasLoaded,
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

    if (parseBoolean(root.dataset.showPois) || parseBoolean(root.dataset.showZones)) {
      await ensureAdvancedExtras(root, state);
    }
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
