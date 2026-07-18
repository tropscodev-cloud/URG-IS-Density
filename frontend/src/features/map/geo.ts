const EARTH_RADIUS_M = 6_371_000;

/** Destination point given a start lng/lat, bearing (deg, 0=N clockwise), and distance (m). */
export function destinationPoint(lng: number, lat: number, bearingDeg: number, distanceM: number): [number, number] {
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const angularDistance = distanceM / EARTH_RADIUS_M;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

/** Builds a FOV cone polygon (apex at camera, arcing across fovAngle out to range) as [lng,lat][]. */
export function fovConePolygon(
  lng: number,
  lat: number,
  bearingDeg: number,
  fovAngleDeg: number,
  rangeM: number,
  segments = 16,
): [number, number][] {
  const half = fovAngleDeg / 2;
  const points: [number, number][] = [[lng, lat]];
  for (let i = 0; i <= segments; i++) {
    const angle = bearingDeg - half + (fovAngleDeg * i) / segments;
    points.push(destinationPoint(lng, lat, angle, rangeM));
  }
  points.push([lng, lat]);
  return points;
}
