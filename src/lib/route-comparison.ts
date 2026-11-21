import { assessAccidents, type AccidentZone, type AssessedAccident } from './accidents';
import { ROUTE_MODES, type BicycleRoute, type RouteMode } from './bicycle-routes';

export type RouteComparisonRow = {
  mode: RouteMode;
  route: BicycleRoute | undefined;
  assessments: AssessedAccident[];
  nearbyCount: number | null;
  centerBasedNearbyCount: number | null;
  unavailableDistances: number;
};

// null means unavailable/not loaded; [] means a successfully loaded empty dataset.
// Count unique hotspot regions, never sum the number of accidents or casualties.
export function compareRoutes(routes: BicycleRoute[], zones: AccidentZone[] | null, threshold: number): RouteComparisonRow[] {
  const uniqueZones = zones === null ? null : [...new Map(zones.map(zone => [zone.id, zone])).values()];
  return ROUTE_MODES.map(mode => {
    const route = routes.find(route => route.mode === mode);
    const assessments = route && uniqueZones !== null ? assessAccidents(uniqueZones, route, threshold) : [];
    const unavailableDistances = assessments.filter(zone => zone.nearRoute === null).length;
    const canCount = Boolean(route && route.segments.some(segment => segment.length >= 2) && uniqueZones !== null && unavailableDistances === 0);
    return {
      mode, route, assessments, unavailableDistances,
      nearbyCount: canCount ? assessments.filter(zone => zone.nearRoute === true).length : null,
      centerBasedNearbyCount: canCount ? assessments.filter(zone => zone.nearRoute === true && zone.distanceBasis === 'center').length : null,
    };
  });
}
