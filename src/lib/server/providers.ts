import 'server-only';
import { places } from '../demo-data';
import { ApiError, isDemo, secret } from './env';
import { integer, number, params, record, result, rows, text, upstreamError } from './http';

export async function getPlaces(request: Request) {
  const p = params(request, ['query', 'page']);
  const query = p.get('query')?.trim() || '';
  if (!query || query.length > 80 || /[\u0000-\u001f\u007f]/.test(query)) throw new ApiError(400, 'INVALID_QUERY', '검색어를 1~80자로 입력해 주세요.');
  const page = integer(p.get('page'), 1, 1, 45);
  if (isDemo()) {
    const matches = places.filter(p => `${p.name} ${p.area}`.includes(query));
    return result(page === 1 ? matches : [], 'demo', true, { page, isEnd: true });
  }
  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
  url.search = new URLSearchParams({ query, page: String(page), size: '15', rect: '126.76,37.41,127.19,37.70' }).toString();
  const key=secret('KAKAO_REST_API_KEY');
  let response:Response;
  try{response=await fetch(url,{headers:{Authorization:`KakaoAK ${key}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});}catch(error){
    if(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name))throw new ApiError(504,'KAKAO_SEARCH_TIMEOUT','카카오 장소 검색 응답 시간이 초과되었습니다.');
    throw new ApiError(502,'KAKAO_SEARCH_UNAVAILABLE','카카오 장소 검색에 연결하지 못했습니다.');
  }
  if(response.status===401)throw new ApiError(502,'KAKAO_AUTH_FAILED','카카오 장소 검색 인증에 실패했습니다. 서버 REST 키를 확인해 주세요.');
  if(response.status===403)throw new ApiError(502,'KAKAO_PERMISSION_DENIED','카카오 장소 검색 권한이 거부되었습니다. 앱의 카카오맵 사용 설정과 REST API 권한을 확인해 주세요.');
  if(response.status===429)throw new ApiError(503,'KAKAO_QUOTA_EXCEEDED','카카오 장소 검색 호출 한도를 초과했습니다.');
  if(!response.ok)throw upstreamError();
  let payload:unknown;
  try{payload=await response.json();}catch{throw upstreamError();}
  const body=record(payload);
  const data = rows(body.documents).map(p => ({ id: text(p.id), name: text(p.place_name), area: text(p.road_address_name || p.address_name), lat: number(p.y), lng: number(p.x) }));
  const meta = record(body.meta);
  if (typeof meta.is_end !== 'boolean') throw upstreamError();
  return result(data, 'kakao', false, { page, isEnd: meta.is_end });
}
