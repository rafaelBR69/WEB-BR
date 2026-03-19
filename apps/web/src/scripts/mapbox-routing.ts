type RouteFeatureCollection = {
  type: "FeatureCollection";
  features: Array<Record<string, unknown>>;
};

type RouteResponse = {
  collection: RouteFeatureCollection;
  distanceKm: string;
  durationMin: string;
};

export async function fetchDrivingRoute(
  token: string,
  origin: [number, number],
  destination: [number, number]
): Promise<RouteResponse | null> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${origin[0]},${origin[1]};${destination[0]},${destination[1]}` +
    `?geometries=geojson&overview=full&steps=false&access_token=${token}`;

  const response = await fetch(url);
  if (!response.ok) return null;

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route?.geometry) return null;

  return {
    collection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: route.geometry,
          properties: {},
        },
      ],
    },
    distanceKm: `${(Number(route.distance ?? 0) / 1000).toFixed(1)} km`,
    durationMin: `${Math.round(Number(route.duration ?? 0) / 60)} min`,
  };
}
