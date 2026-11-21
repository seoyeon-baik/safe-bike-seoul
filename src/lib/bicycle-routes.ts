export const ROUTE_MODES = ['BIKE_ONLY', 'SHORTEST'] as const;
export type RouteMode = typeof ROUTE_MODES[number];
export type RoutePoint = { lat: number; lng: number };
export type RouteOrigin = RoutePoint & { id: string; name: string };
export type BicycleRoute = {
  mode: RouteMode;
  distanceMeters: number;
  durationSeconds: number;
  // Preserve separate API steps: never draw invented connectors between them.
  segments: RoutePoint[][];
};
export type RouteResponse = {
  data: BicycleRoute[];
  meta: { source: 'kakao'; isDemo: false; origin: RouteOrigin; destination: RoutePoint; fetchedAt: string };
};
export function modeLabel(mode: RouteMode) { return mode === 'BIKE_ONLY' ? '자전거도로 우선' : '최단 경로'; }
