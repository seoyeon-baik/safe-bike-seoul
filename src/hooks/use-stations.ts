'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NearbyStation, StationSnapshot } from '@/lib/stations';

const EMPTY_STATIONS: NearbyStation[] = [];
type State = { key: string; snapshot?: StationSnapshot; error?: string };
function validStation(value: unknown): value is NearbyStation {
  if (!value || typeof value !== 'object') return false;
  const s = value as NearbyStation;
  return typeof s.id === 'string' && typeof s.name === 'string' &&
    ['lat', 'lng', 'bikes', 'slots', 'distanceMeters'].every(k => Number.isFinite(s[k as keyof NearbyStation])) &&
    s.bikes >= 0 && s.distanceMeters >= 0;
}
const messages: Record<string, string> = {
  API_NOT_CONFIGURED: '서울시 대여소 서비스 연결 설정이 필요합니다.',
  UPSTREAM_TIMEOUT: '서울시 대여소 응답이 지연되고 있습니다. 다시 시도해 주세요.',
  UPSTREAM_ERROR: '서울시 대여소 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  INCOMPLETE_STATION_DATA: '전체 대여소를 확인하지 못했습니다. 다시 시도해 주세요.',
};
export function useStations(origin: { lat: number; lng: number }, radius: number, availableOnly: boolean, query: string) {
  const [state, setState] = useState<State>({ key: '' });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  const search = new URLSearchParams({ lat: String(origin.lat), lng: String(origin.lng), radius: String(radius), limit: '30', availableOnly: availableOnly ? '1' : '0', query }).toString();
  const key = `${search}:${revision}`;
  useEffect(() => {
    const timer = window.setInterval(refresh, 60000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    // Debounce name/radius/origin changes and cancel out-of-order requests.
    const debounce = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/stations?${search}`, { signal: controller.signal, cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(messages[payload?.error?.code] ?? '대여소를 불러오지 못했습니다. 다시 시도해 주세요.');
        if (payload?.meta?.source !== 'seoul' || payload.meta.isDemo !== false || typeof payload.meta.fetchedAt !== 'string' || !Array.isArray(payload.data) || !payload.data.every(validStation)) {
          throw new Error('대여소 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
        }
        if (active) setState({ key, snapshot: payload });
      } catch (error) {
        if (active) setState({ key, error: controller.signal.aborted ? '대여소 응답 시간이 초과되었습니다. 다시 시도해 주세요.' : error instanceof Error && Object.values(messages).includes(error.message) ? error.message : '대여소 정보를 불러오지 못했습니다. 다시 시도해 주세요.' });
      } finally { window.clearTimeout(timeout); }
    }, 250);
    return () => { active = false; window.clearTimeout(debounce); window.clearTimeout(timeout); controller.abort(); };
  }, [search, key]);
  const current = state.key === key ? state : undefined;
  return { snapshot: current?.snapshot, stations: current?.snapshot?.data ?? EMPTY_STATIONS, error: current?.error, loading: !current, refresh };
}
