'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ROUTE_MODES, type BicycleRoute, type RouteOrigin, type RoutePoint, type RouteResponse } from '@/lib/bicycle-routes';

type State = { key: string; loading?: boolean; response?: RouteResponse; error?: string };
const EMPTY_ROUTES: BicycleRoute[] = [];
function validRoute(route: BicycleRoute) {
  return route && ROUTE_MODES.includes(route.mode) && Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0 && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0 &&
    Array.isArray(route.segments) && route.segments.length > 0 && route.segments.every(segment => Array.isArray(segment) && segment.length >= 2 && segment.every(p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180));
}
export function useBicycleRoutes(origin: RouteOrigin | null, destination: RoutePoint) {
  const [state, setState] = useState<State>({ key: '' });
  const controller = useRef<AbortController | null>(null);
  const search = new URLSearchParams({ stationId: origin?.id ?? '', endLat: String(destination.lat), endLng: String(destination.lng) }).toString();
  const key = `${search}:${origin?.lat ?? ''}:${origin?.lng ?? ''}`;
  useEffect(() => () => controller.current?.abort(), [key]);
  const requestRoutes = useCallback(async () => {
    if (!origin) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const timeout = window.setTimeout(() => current.abort(), 55000);
    setState({ key, loading: true });
    try {
      const response = await fetch(`/api/routes?${search}`, { cache: 'no-store', signal: current.signal });
      const payload = await response.json();
      if (controller.current !== current) return;
      if (current.signal.aborted) throw new Error('REQUEST_TIMEOUT');
      if (!response.ok) {
        setState({ key, error: typeof payload?.error?.message === 'string' ? payload.error.message : '카카오 자전거 경로 조회에 실패했습니다. 경로를 표시하지 않습니다.' });
        return;
      }
      if (payload?.meta?.source !== 'kakao' || payload.meta.isDemo !== false || payload.meta.origin?.id !== origin.id || payload.meta.destination?.lat !== destination.lat || payload.meta.destination?.lng !== destination.lng || !Array.isArray(payload.data) || payload.data.length !== 2 || !payload.data.every(validRoute) || !ROUTE_MODES.every(mode => payload.data.some((r: BicycleRoute) => r.mode === mode))) {
        throw new Error('INVALID_RESPONSE');
      }
      setState({ key, response: payload });
    } catch {
      if (controller.current === current) setState({ key, error: current.signal.aborted ? '경로 조회 시간이 초과되었거나 취소되었습니다. 경로를 표시하지 않습니다.' : '카카오 경로 응답을 확인하지 못했습니다. 경로를 표시하지 않습니다.' });
    } finally { window.clearTimeout(timeout); }
  }, [key, search, origin, destination.lat, destination.lng]);
  const current = state.key === key ? state : undefined;
  return { response: current?.response, routes: current?.response?.data ?? EMPTY_ROUTES, loading: current?.loading ?? false, error: current?.error, requestRoutes };
}
