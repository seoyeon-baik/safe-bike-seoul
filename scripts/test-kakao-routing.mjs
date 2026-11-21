import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const key = process.env.KAKAO_REST_API_KEY?.trim();
console.log(key ? 'REST key configured; testing authenticated bicycle route requests.' : 'REST key missing; authenticated permission cannot be verified. Testing endpoint without credentials.');
let success = Boolean(key);
for (const mode of ['BIKE_ONLY', 'SHORTEST']) {
  const url = new URL('https://dapi.kakao.com/v2/routing/bicycle');
  // Public coordinates from Kakao's official example, not a user location.
  url.search = new URLSearchParams({ start_x: '127.11119669891646', start_y: '37.394776627382875', end_x: '127.12629039752096', end_y: '37.4199323570413', route_mode: mode, input_coord: 'WGS84', output_coord: 'WGS84' }).toString();
  try {
    const response = await fetch(url, { headers: key ? { Authorization: `KakaoAK ${key}` } : {}, redirect: 'error', signal: AbortSignal.timeout(10000) });
    let data;
    try { data = await response.json(); } catch {}
    const code = typeof data?.code === 'number' ? data.code : null;
    const status = typeof data?.status === 'string' && ['OK', 'SAME_POINT', 'START_LINK_NOT_FOUND', 'END_LINK_NOT_FOUND', 'TOO_MANY_SEARCH_LINK', 'TOO_FAR_AWAY', 'ROUTE_RESULT_NOT_FOUND'].includes(data.status) ? data.status : null;
    const ok = Boolean(key && response.ok && status === 'OK' && data?.route);
    console.log(JSON.stringify({ mode, authenticated: Boolean(key), httpStatus: response.status, kakaoCode: code, routeStatus: status, success: ok }));
    if (!ok) success = false;
  } catch {
    success = false;
    console.log(JSON.stringify({ mode, authenticated: Boolean(key), success: false, reason: 'NETWORK_OR_TIMEOUT' }));
  }
}
if (!success) process.exitCode = 1;
