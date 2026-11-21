import 'server-only';
import { nearbyStations, type Station } from '../stations';
import { ApiError, secret } from './env';
import { fetchJson, integer, number, params, record, rows, text, upstreamError } from './http';

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const CACHE_MS = 60000;
type Snapshot = { stations: Station[]; fetchedAt: string; skipped: number; expires: number };
let cached: { key: string; snapshot: Snapshot } | undefined;
let pending: { key: string; promise: Promise<Snapshot> } | undefined;

function normalize(row: Record<string, unknown>): Station | null {
  // Missing/invalid coordinates cannot be placed on a map. Never substitute them.
  const latitude = row.stationLatitude;
  const longitude = row.stationLongitude;
  if ((typeof latitude !== 'string' && typeof latitude !== 'number') ||
      (typeof longitude !== 'string' && typeof longitude !== 'number') ||
      String(latitude).trim() === '' || String(longitude).trim() === '') return null;
  const lat = Number(latitude), lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0 || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const bikes = number(row.parkingBikeTotCnt), slots = number(row.rackTotCnt);
  if (!Number.isInteger(bikes) || bikes < 0 || !Number.isInteger(slots) || slots < 0) throw upstreamError();
  const id = text(row.stationId).trim(), name = text(row.stationName).trim();
  if (!id || !name) throw upstreamError();
  // bikes can exceed racks with Seoul's virtual racks; do not cap it at slots.
  return { id, name, bikes, slots, lat, lng };
}
async function loadAll(key: string): Promise<Snapshot> {
  const stations = new Map<string, Station>();
  let skipped = 0;
  const deadline = Date.now() + 30000;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() > deadline) throw new ApiError(504, 'UPSTREAM_TIMEOUT', '전체 대여소 조회 시간이 초과되었습니다. 다시 시도해 주세요.');
    const start = page * PAGE_SIZE + 1;
    // Seoul's documented endpoint uses HTTP and a key in the path. Never return this URL.
    const url = new URL(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/bikeList/${start}/${start + PAGE_SIZE - 1}/`);
    const root = record(await fetchJson(url));
    const body = record(root.rentBikeStatus ?? root.bikeList ?? root);
    const code = record(body.RESULT).CODE;
    if (code !== 'INFO-000' && code !== 'INFO-200') throw upstreamError();
    const pageRows = code === 'INFO-200' ? [] : rows(body.row);
    if (pageRows.length > PAGE_SIZE) throw upstreamError();
    for (const row of pageRows) {
      const station = normalize(row);
      if (station) stations.set(station.id, station); else skipped++;
    }
    // list_total_count may describe the returned page rather than the city total.
    // Walk every page until a short page or INFO-200; never sort just page one.
    if (pageRows.length < PAGE_SIZE) {
      if (skipped > 0 && stations.size === 0) throw upstreamError();
      return { stations: [...stations.values()], skipped, fetchedAt: new Date().toISOString(), expires: Date.now() + CACHE_MS };
    }
  }
  // Do not present incomplete rankings as the nearest stations in Seoul.
  throw new ApiError(502, 'INCOMPLETE_STATION_DATA', '전체 대여소 목록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}
async function snapshot() {
  const key = secret('SEOUL_API_KEY');
  if (cached?.key === key && cached.snapshot.expires > Date.now()) return { ...cached.snapshot, cached: true };
  if (pending?.key === key) return { ...await pending.promise, cached: true };
  const task = { key, promise: loadAll(key) };
  pending = task;
  try {
    const data = await task.promise;
    cached = { key, snapshot: data };
    return { ...data, cached: false };
  } finally { if (pending === task) pending = undefined; }
}
function coordinate(value: string | null, fallback: number, min: number, max: number) {
  if (value === null) return fallback;
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new ApiError(400, 'INVALID_PARAMETER', '출발지 위도·경도를 확인해 주세요.');
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, 'INVALID_PARAMETER', '출발지 위도·경도가 허용 범위를 벗어났습니다.');
  return n;
}
export async function getStations(request: Request) {
  const p = params(request, ['lat', 'lng', 'radius', 'limit', 'availableOnly', 'query']);
  if (p.has('lat') !== p.has('lng')) throw new ApiError(400, 'INVALID_PARAMETER', '위도와 경도를 함께 입력해 주세요.');
  const origin = { lat: coordinate(p.get('lat'), 37.5271, -90, 90), lng: coordinate(p.get('lng'), 126.9328, -180, 180) };
  const radiusMeters = integer(p.get('radius'), 2000, 100, 10000);
  const limit = integer(p.get('limit'), 20, 1, 100);
  const available = p.get('availableOnly') ?? '0';
  if (!['0', '1'].includes(available)) throw new ApiError(400, 'INVALID_PARAMETER', '대여 가능 필터는 0 또는 1이어야 합니다.');
  const query = p.get('query')?.trim() ?? '';
  if (query.length > 80 || /[\u0000-\u001f\u007f]/.test(query)) throw new ApiError(400, 'INVALID_QUERY', '대여소 검색어를 80자 이하로 입력해 주세요.');
  // Stations are ALWAYS live, regardless of API_DATA_MODE used by other services.
  const all = await snapshot();
  const ranked = nearbyStations(all.stations, origin, { radiusMeters, limit, availableOnly: available === '1', query });
  return { data: ranked.data, meta: { source: 'seoul', isDemo: false, fetchedAt: all.fetchedAt, cached: all.cached, total: all.stations.length, matched: ranked.matched, skipped: all.skipped, radiusMeters, limit, origin, distanceType: 'straight-line', cacheSeconds: 60 } };
}

export async function findStation(id: string): Promise<Station> {
  const all = await snapshot();
  const station = all.stations.find(s => s.id === id);
  if (!station) throw new ApiError(404, 'STATION_NOT_FOUND', '선택한 따릉이 대여소를 서울시 목록에서 찾을 수 없습니다. 대여소를 다시 선택해 주세요.');
  return station;
}
