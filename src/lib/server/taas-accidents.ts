import 'server-only';
import { ACCIDENT_HISTORY_NOTICE, ACCIDENT_SOURCE_URL, ACCIDENT_YEAR_CHECKED_AT, LATEST_ACCIDENT_YEAR, type AccidentZone } from '../accidents';
import type { RoutePoint } from '../bicycle-routes';
import { ApiError, secret } from './env';
import { integer, params, record, number, text, upstreamError } from './http';

const DISTRICTS = ['110','140','170','200','215','230','260','290','305','320','350','380','410','440','470','500','530','545','560','590','620','650','680','710','740'];
const PAGE_SIZE=100;
const CACHE_MS=3600000;
type Snapshot={data:AccidentZone[];skipped:number;missingGeometry:number;fetchedAt:string;expires:number};
const caches=new Map<string,{key:string;snapshot:Snapshot}>();
const pending=new Map<string,{key:string;promise:Promise<Snapshot>}>();
function count(value: unknown){const n=number(value);if(!Number.isInteger(n)||n<0)throw upstreamError();return n;}
function identifier(value: unknown){if(typeof value!=='string'&&typeof value!=='number')throw upstreamError();const s=String(value).trim();if(!s)throw upstreamError();return s;}
export function parsePolygons(raw:unknown):RoutePoint[][][]{
  if(!raw)return [];
  try{
    let geometry=typeof raw==='string'?JSON.parse(raw):raw;
    if(geometry?.type==='Feature')geometry=geometry.geometry;
    const list=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:null;
    if(!Array.isArray(list)||!list.length)return [];
    return list.map(polygon=>{
      if(!Array.isArray(polygon)||!polygon.length)throw Error();
      return polygon.map(ring=>{
        if(!Array.isArray(ring)||ring.length<4)throw Error();
        const points=ring.map(pair=>{if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='number'||typeof pair[1]!=='number'||!Number.isFinite(pair[0])||!Number.isFinite(pair[1])||Math.abs(pair[0])>180||Math.abs(pair[1])>90)throw Error();return {lng:pair[0],lat:pair[1]};});
        const first=points[0],last=points[points.length-1];
        if(first.lat!==last.lat||first.lng!==last.lng)throw Error();
        return points;
      });
    });
  }catch{return [];}
}
function normalize(row:Record<string,unknown>,year:number,district:string):AccidentZone|null{
  const bjd=identifier(row.bjd_cd);
  if(!bjd.startsWith(`11${district}`))throw new ApiError(502,'TAAS_REGION_MISMATCH','사고 API의 지역 응답을 확인하지 못했습니다.');
  if((typeof row.la_crd!=='string'&&typeof row.la_crd!=='number')||(typeof row.lo_crd!=='string'&&typeof row.lo_crd!=='number')||String(row.la_crd).trim()===''||String(row.lo_crd).trim()==='')return null;
  const lat=Number(row.la_crd),lng=Number(row.lo_crd);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat===0||lng===0||Math.abs(lat)>90||Math.abs(lng)>180)return null;
  return {id:identifier(row.afos_fid),name:text(row.spot_nm),district:text(row.sido_sgg_nm),year,lat,lng,accidents:count(row.occrrnc_cnt),casualties:count(row.caslt_cnt),deaths:count(row.dth_dnv_cnt),seriousInjuries:count(row.se_dnv_cnt),polygons:parsePolygons(row.geom_json)};
}
async function page(key:string,year:number,district:string,pageNo:number){
  const url=new URL('https://apis.data.go.kr/B552061/frequentzoneBicycle/getRestFrequentzoneBicycle');
  url.search=new URLSearchParams({serviceKey:key,searchYearCd:String(year),siDo:'11',guGun:district,type:'json',numOfRows:String(PAGE_SIZE),pageNo:String(pageNo)}).toString();
  let response:Response;
  try{response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});}catch(error){
    if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))throw new ApiError(504,'TAAS_TIMEOUT','과거 사고정보 API 응답 시간이 초과되었습니다.');
    throw new ApiError(502,'TAAS_NETWORK_ERROR','과거 사고정보 API에 연결하지 못했습니다.');
  }
  if(response.status===401||response.status===403)throw new ApiError(502,'TAAS_AUTH_FAILED','사고정보 API 인증 또는 접근 권한을 확인해 주세요.');
  if(response.status===429)throw new ApiError(503,'TAAS_QUOTA_EXCEEDED','사고정보 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.');
  if(!response.ok)throw upstreamError();
  // Gateway errors can be XML even when JSON was requested. Read only known codes.
  const raw=await response.text();
  let value:unknown;
  try{value=JSON.parse(raw);}catch{
    const code=raw.match(/<(?:returnReasonCode|resultCode)>\s*(\d+)\s*<\//)?.[1];
    if(code&&['20','30','31','32'].includes(code))throw new ApiError(502,'TAAS_AUTH_FAILED','사고정보 API 활용신청·승인 상태와 인증키를 확인해 주세요.');
    if(code&&['22','23'].includes(code))throw new ApiError(503,'TAAS_QUOTA_EXCEEDED','사고정보 API 호출 한도를 초과했습니다.');
    throw upstreamError();
  }
  const body=record(value),code=String(body.resultCode).padStart(2,'0');
  if(code==='03')return {data:[] as Record<string,unknown>[],total:0};
  if(['20','30','31','32'].includes(code))throw new ApiError(502,'TAAS_AUTH_FAILED','사고정보 API 활용신청·승인 상태와 인증키를 확인해 주세요.');
  if(['22','23'].includes(code))throw new ApiError(503,'TAAS_QUOTA_EXCEEDED','사고정보 API 호출 한도를 초과했습니다.');
  if(code!=='00')throw upstreamError();
  const total=count(body.totalCount);
  if(total===0)return {data:[] as Record<string,unknown>[],total};
  const items=record(body.items).item;
  const data=Array.isArray(items)?items.map(record):items&&typeof items==='object'?[record(items)]:[];
  if(!data.length||data.length>PAGE_SIZE)throw upstreamError();
  return {data,total};
}
async function load(key:string,year:number):Promise<Snapshot>{
  let cursor=0,skipped=0,missingGeometry=0;
  const zones=new Map<string,AccidentZone>(),deadline=Date.now()+60000;
  async function worker(){
    while(cursor<DISTRICTS.length){
      const district=DISTRICTS[cursor++];let received=0,expected:number|undefined;
      for(let n=1;n<=50;n++){
        if(Date.now()>deadline)throw new ApiError(504,'TAAS_TIMEOUT','서울 전체 사고다발지역 조회 시간이 초과되었습니다.');
        const response=await page(key,year,district,n);
        if(expected!==undefined&&expected!==response.total)throw upstreamError();
        expected=response.total;received+=response.data.length;
        for(const raw of response.data){const zone=normalize(raw,year,district);if(!zone){skipped++;continue;}if(!zone.polygons.length)missingGeometry++;zones.set(zone.id,zone);}
        if(received===response.total)break;
        if(received>response.total||n===50)throw new ApiError(502,'TAAS_INCOMPLETE_DATA','사고다발지역의 전체 목록을 확인하지 못했습니다.');
      }
    }
  }
  // Wait for all workers before publishing a snapshot. No partial Seoul results.
  const outcomes=await Promise.allSettled(Array.from({length:3},()=>worker()));
  const failure=outcomes.find(o=>o.status==='rejected');
  if(failure?.status==='rejected')throw failure.reason;
  if(!zones.size&&skipped)throw upstreamError();
  return {data:[...zones.values()],skipped,missingGeometry,fetchedAt:new Date().toISOString(),expires:Date.now()+CACHE_MS};
}
async function snapshot(year:number){
  let key:string;
  try{key=process.env.TAAS_API_KEY?.trim()||secret('DATA_GO_KR_SERVICE_KEY');}catch{throw new ApiError(503,'TAAS_NOT_CONFIGURED','과거 사고정보 API 인증키가 설정되지 않았습니다.');}
  const id=String(year),cached=caches.get(id);
  if(cached?.key===key&&cached.snapshot.expires>Date.now())return {...cached.snapshot,cached:true};
  const running=pending.get(id);
  if(running?.key===key)return {...await running.promise,cached:true};
  const task={key,promise:load(key,year)};pending.set(id,task);
  try{const data=await task.promise;caches.set(id,{key,snapshot:data});return {...data,cached:false};}finally{if(pending.get(id)===task)pending.delete(id);}
}
export async function getAccidents(request:Request){
  const p=params(request,['year']);
  const year=integer(p.get('year'),LATEST_ACCIDENT_YEAR,2012,LATEST_ACCIDENT_YEAR);
  const all=await snapshot(year);
  return {data:all.data,meta:{source:'koroad',isDemo:false,year,latestDocumentedYear:LATEST_ACCIDENT_YEAR,yearCheckedAt:ACCIDENT_YEAR_CHECKED_AT,fetchedAt:all.fetchedAt,total:all.data.length,skipped:all.skipped,missingGeometry:all.missingGeometry,cached:all.cached,notice:ACCIDENT_HISTORY_NOTICE,sourceUrl:ACCIDENT_SOURCE_URL,region:'서울특별시',districtCount:DISTRICTS.length}};
}
