export type Station = {
  id: string;
  name: string;
  bikes: number;
  slots: number;
  lat: number;
  lng: number;
};
export type NearbyStation = Station & { distanceMeters: number };
export type StationSnapshot = {
  data: NearbyStation[];
  meta: {
    source: 'seoul';
    isDemo: false;
    fetchedAt: string;
    cached: boolean;
    total: number;
    matched: number;
    skipped: number;
    radiusMeters: number;
    limit: number;
  };
};

// Great-circle distance, not a walking or riding route distance.
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}
export function nearbyStations(stations: Station[], origin: { lat: number; lng: number }, options: { radiusMeters: number; limit: number; availableOnly: boolean; query: string }) {
  const ranked = stations
    .filter(s => (!options.availableOnly || s.bikes > 0) && s.name.toLocaleLowerCase('ko').includes(options.query.toLocaleLowerCase('ko')))
    .map(s => ({ ...s, distanceMeters: distanceMeters(origin, s) }))
    .filter(s => s.distanceMeters <= options.radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  return { data: ranked.slice(0, options.limit).map(s => ({ ...s, distanceMeters: Math.round(s.distanceMeters) })), matched: ranked.length };
}
export function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
