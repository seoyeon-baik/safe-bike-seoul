import 'server-only';
import { ROUTE_MODES, modeLabel, type BicycleRoute, type RouteMode, type RoutePoint } from '../bicycle-routes';
import { ApiError, secret } from './env';
import { number, params, record, rows, upstreamError } from './http';
import { findStation } from './seoul-stations';

function coordinate(value: string | null, max: number) {
  if (value === null || !/^-?\d+(\.\d+)?$/.test(value)) throw new ApiError(400, 'INVALID_ROUTE', '목적지 위도와 경도를 입력해 주세요.');
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new ApiError(400, 'INVALID_ROUTE', '목적지 좌표의 범위를 확인해 주세요.');
  return n;
}
function routeError(responseStatus: number) {
  if (responseStatus === 401) return new ApiError(502, 'KAKAO_AUTH_FAILED', '카카오 자전거 경로 API 인증에 실패했습니다(HTTP 401). 서버 REST API 키를 확인해 주세요.');
  if (responseStatus === 403) return new ApiError(502, 'KAKAO_PERMISSION_DENIED', '카카오 자전거 경로 API 호출이 거부되었습니다(HTTP 403). 앱의 카카오맵 사용 설정과 호출 권한을 확인해 주세요.');
  if (responseStatus === 429) return new ApiError(503, 'KAKAO_QUOTA_EXCEEDED', '카카오 경로 API 호출 한도를 초과했습니다(HTTP 429). 잠시 후 다시 시도해 주세요.');
  if (responseStatus === 404) return new ApiError(502, 'KAKAO_ENDPOINT_UNAVAILABLE', '카카오 공식 자전거 경로 API 주소에 접근할 수 없습니다(HTTP 404).');
  return new ApiError(502, 'KAKAO_UPSTREAM_ERROR', '카카오 자전거 경로 API 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
}
export function parseRoute(value: unknown, mode: RouteMode): BicycleRoute {
  const body = record(value);
  const statuses: Record<string, string> = {
    SAME_POINT: '출발 대여소와 목적지가 같습니다.',
    START_LINK_NOT_FOUND: '출발 대여소 주변의 자전거 이동 가능한 도로를 찾지 못했습니다.',
    END_LINK_NOT_FOUND: '목적지 주변의 자전거 이동 가능한 도로를 찾지 못했습니다.',
    TOO_MANY_SEARCH_LINK: '카카오가 경로를 탐색할 수 있는 범위를 초과했습니다.',
    TOO_FAR_AWAY: '출발 대여소와 목적지가 너무 멀리 떨어져 있습니다.',
    ROUTE_RESULT_NOT_FOUND: '카카오에서 해당 자전거 경로를 찾지 못했습니다.',
  };
  if (typeof body.status === 'string' && statuses[body.status]) throw new ApiError(422, 'ROUTE_NOT_FOUND', statuses[body.status]);
  if (body.status !== 'OK') throw upstreamError();
  const route = record(body.route);
  const properties = record(route.properties);
  const distanceMeters = number(properties.totalDistance), durationSeconds = number(properties.totalTime);
  if (!Number.isInteger(distanceMeters) || distanceMeters < 0 || !Number.isInteger(durationSeconds) || durationSeconds < 0) throw upstreamError();
  const segments: RoutePoint[][] = [];
  for (const leg of rows(route.legs)) {
    for (const step of rows(leg.steps)) {
      const points = record(step.path).points;
      if (!Array.isArray(points)) throw upstreamError();
      const segment = points.map(point => {
        if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number' || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw upstreamError();
        return { lng: point[0], lat: point[1] };
      });
      if (segment.length >= 2) segments.push(segment);
    }
  }
  if (!segments.length) throw new ApiError(502, 'INVALID_ROUTE_GEOMETRY', '카카오 응답에 표시할 수 있는 경로 좌표가 없습니다. 경로를 생성하지 않았습니다.');
  return { mode, distanceMeters, durationSeconds, segments };
}
async function requestRoute(key: string, origin: RoutePoint, destination: RoutePoint, mode: RouteMode) {
  const url = new URL('https://dapi.kakao.com/v2/routing/bicycle');
  url.search = new URLSearchParams({ start_x: String(origin.lng), start_y: String(origin.lat), end_x: String(destination.lng), end_y: String(destination.lat), route_mode: mode, input_coord: 'WGS84', output_coord: 'WGS84' }).toString();
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new ApiError(504, 'KAKAO_TIMEOUT', '카카오 자전거 경로 API 응답 시간이 초과되었습니다.');
    throw new ApiError(502, 'KAKAO_NETWORK_ERROR', '카카오 자전거 경로 API에 연결하지 못했습니다.');
  }
  if (!response.ok) throw routeError(response.status);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw upstreamError(); }
  return parseRoute(payload, mode);
}
export async function getRoutes(request: Request) {
  const p = params(request, ['stationId', 'endLat', 'endLng']);
  const stationId = p.get('stationId')?.trim();
  if (!stationId || stationId.length > 80 || !/^[A-Za-z0-9_-]+$/.test(stationId)) throw new ApiError(400, 'INVALID_ROUTE', '출발 따릉이 대여소를 선택해 주세요.');
  const destination = { lat: coordinate(p.get('endLat'), 90), lng: coordinate(p.get('endLng'), 180) };
  let key: string;
  try { key = secret('KAKAO_REST_API_KEY'); } catch { throw new ApiError(503, 'KAKAO_ROUTING_NOT_CONFIGURED', '카카오 자전거 경로용 REST API 키가 설정되지 않아 호출 권한을 확인할 수 없습니다.'); }
  // Resolve station coordinates on the server from Seoul; never invent a start point.
  const station = await findStation(stationId);
  const origin = { id: station.id, name: station.name, lat: station.lat, lng: station.lng };
  if (origin.lat === destination.lat && origin.lng === destination.lng) throw new ApiError(400, 'INVALID_ROUTE', '출발 대여소와 목적지가 같습니다.');
  const attempts = await Promise.allSettled(ROUTE_MODES.map(mode => requestRoute(key, origin, destination, mode)));
  const failedIndex = attempts.findIndex(a => a.status === 'rejected');
  if (failedIndex >= 0) {
    const failed = attempts[failedIndex] as PromiseRejectedResult;
    const error = failed.reason instanceof ApiError ? failed.reason : upstreamError();
    throw new ApiError(error.status, error.code, `${modeLabel(ROUTE_MODES[failedIndex])}: ${error.message} 비교 경로를 표시하지 않았습니다.`);
  }
  const data = attempts.map(attempt => (attempt as PromiseFulfilledResult<BicycleRoute>).value);
  return { data, meta: { source: 'kakao', isDemo: false, fetchedAt: new Date().toISOString(), origin, destination } };
}
