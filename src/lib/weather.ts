export const WEATHER_SOURCE_URL = 'https://www.data.go.kr/data/15084084/openapi.do';
export type GridPoint = { nx: number; ny: number };
export type ForecastBase = { baseDate: string; baseTime: string; publishedAt: string };
export type WeatherResponse = {
  data: {
    temperatureC: number;
    precipitationProbability: number;
    baseDate: string; baseTime: string; publishedAt: string;
    fcstDate: string; fcstTime: string; forecastAt: string;
  };
  meta: {
    source: 'kma'; isDemo: false; kind: 'short-term-forecast'; grid: GridPoint;
    origin: { lat: number; lng: number }; timeZone: 'Asia/Seoul'; fetchedAt: string;
    requestedPublication: ForecastBase; usedPreviousPublication: boolean; cached: boolean;
  };
};

// KMA DFS Lambert conformal conic projection (5 km), WGS84 input.
// Official constants: R=6371.00877 km, standard parallels 30/60N,
// reference 126E/38N at (43,136). See KMA's grid-area reference document.
export function toKmaGrid(lat: number, lng: number): GridPoint {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat <= -90 || lat >= 90 || lng < -180 || lng > 180) throw new RangeError('INVALID_COORDINATES');
  const rad = Math.PI / 180, re = 6371.00877 / 5;
  const slat1 = 30 * rad, slat2 = 60 * rad, olat = 38 * rad;
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(Math.tan(Math.PI / 4 + slat2 / 2) / Math.tan(Math.PI / 4 + slat1 / 2));
  const sf = Math.pow(Math.tan(Math.PI / 4 + slat1 / 2), sn) * Math.cos(slat1) / sn;
  const ro = re * sf / Math.pow(Math.tan(Math.PI / 4 + olat / 2), sn);
  const ra = re * sf / Math.pow(Math.tan(Math.PI / 4 + lat * rad / 2), sn);
  let theta = (lng - 126) * rad;
  if (theta > Math.PI) theta -= Math.PI * 2;
  if (theta < -Math.PI) theta += Math.PI * 2;
  theta *= sn;
  const nx = Math.floor(ra * Math.sin(theta) + 43 + .5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + 136 + .5);
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || nx > 149 || ny < 1 || ny > 253) throw new RangeError('OUTSIDE_KMA_GRID');
  return { nx, ny };
}

export function kstTimestamp(date: string, time: string): string {
  if (!/^\d{8}$/.test(date) || !/^([01]\d|2[0-3])[0-5]\d$/.test(time)) throw new RangeError('INVALID_FORECAST_TIME');
  const iso = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2)}:00+09:00`;
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) throw new RangeError('INVALID_FORECAST_TIME');
  const roundTrip = new Date(stamp + 9*3600000).toISOString();
  if (roundTrip.slice(0,10).replaceAll('-','') !== date) throw new RangeError('INVALID_FORECAST_TIME');
  return iso;
}
function baseFromKstDate(date: Date): ForecastBase {
  const baseDate = date.toISOString().slice(0,10).replaceAll('-','');
  const baseTime = `${String(date.getUTCHours()).padStart(2,'0')}00`;
  return { baseDate, baseTime, publishedAt: kstTimestamp(baseDate,baseTime) };
}
// App policy: allow 10 minutes after an issuance before requesting it.
// KMA issues at 02/05/08/11/14/17/20/23 KST, not every hour.
export function forecastBase(now = new Date()): ForecastBase {
  const cutoff = new Date(now.getTime() + 9*3600000 - 10*60000);
  const hour = cutoff.getUTCHours();
  const candidate = [23,20,17,14,11,8,5,2].find(h => h <= hour);
  if (candidate === undefined) { cutoff.setUTCDate(cutoff.getUTCDate()-1); cutoff.setUTCHours(23,0,0,0); }
  else cutoff.setUTCHours(candidate,0,0,0);
  return baseFromKstDate(cutoff);
}
export function previousForecastBase(base: ForecastBase): ForecastBase {
  return baseFromKstDate(new Date(Date.parse(base.publishedAt) + 9*3600000 - 3*3600000));
}
export function formatWeatherTime(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
}
