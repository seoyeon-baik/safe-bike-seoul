import 'server-only';
import { forecastBase, previousForecastBase, kstTimestamp, toKmaGrid, type ForecastBase, type GridPoint, type WeatherResponse } from '../weather';
import { ApiError, secret } from './env';
import { number, params, record, rows, text, upstreamError } from './http';

const ROWS_PER_PAGE = 1000;
type Snapshot = { items: Record<string,unknown>[]; fetchedAt: string; expires: number };
const snapshots = new Map<string,{ key: string; value: Snapshot }>();
const pending = new Map<string,{ key: string; promise: Promise<Snapshot> }>();
const noData = () => new ApiError(404,'KMA_NO_DATA','해당 발표시각의 단기예보 자료가 아직 없습니다.');
function count(value: unknown) { const n=number(value); if (!Number.isInteger(n)||n<0||n>10000) throw upstreamError(); return n; }
async function readPage(key: string, grid: GridPoint, base: ForecastBase, pageNo: number) {
  const url=new URL('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst');
  url.search=new URLSearchParams({serviceKey:key,dataType:'JSON',pageNo:String(pageNo),numOfRows:String(ROWS_PER_PAGE),nx:String(grid.nx),ny:String(grid.ny),base_date:base.baseDate,base_time:base.baseTime}).toString();
  let response: Response;
  try { response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)}); }
  catch(error) {
    if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)) throw new ApiError(504,'KMA_TIMEOUT','기상청 단기예보 응답 시간이 초과되었습니다.');
    throw new ApiError(502,'KMA_NETWORK_ERROR','기상청 단기예보 서비스에 연결하지 못했습니다.');
  }
  if(response.status===401||response.status===403) throw new ApiError(502,'KMA_AUTH_FAILED','기상청 단기예보 API 인증키와 활용신청 승인 상태를 확인해 주세요.');
  if(response.status===429) throw new ApiError(503,'KMA_QUOTA_EXCEEDED','기상청 API 호출 한도를 초과했습니다.');
  if(!response.ok) throw upstreamError();
  const raw=await response.text();
  let value: unknown;
  try { value=JSON.parse(raw); } catch {
    const code=raw.match(/<(?:returnReasonCode|resultCode)>\s*(\d+)\s*<\//)?.[1];
    if(code&&['20','30','31','32'].includes(code)) throw new ApiError(502,'KMA_AUTH_FAILED','기상청 단기예보 API 인증키와 활용신청 승인 상태를 확인해 주세요.');
    if(code&&['22','23'].includes(code)) throw new ApiError(503,'KMA_QUOTA_EXCEEDED','기상청 API 호출 한도를 초과했습니다.');
    throw upstreamError();
  }
  const body=record(record(value).response);
  const code=String(record(body.header).resultCode).padStart(2,'0');
  if(code==='03') throw noData();
  if(['20','30','31','32'].includes(code)) throw new ApiError(502,'KMA_AUTH_FAILED','기상청 단기예보 API 인증키와 활용신청 승인 상태를 확인해 주세요.');
  if(['22','23'].includes(code)) throw new ApiError(503,'KMA_QUOTA_EXCEEDED','기상청 API 호출 한도를 초과했습니다.');
  if(code!=='00') throw upstreamError();
  const contents=record(body.body),total=count(contents.totalCount);
  if(total===0) throw noData();
  const items=rows(record(contents.items).item);
  if(!items.length||items.length>ROWS_PER_PAGE) throw upstreamError();
  return {items,total};
}
async function collect(key:string,grid:GridPoint,base:ForecastBase):Promise<Snapshot>{
  const items:Record<string,unknown>[]=[];
  let total:number|undefined;
  const deadline=Date.now()+20000;
  for(let pageNo=1;pageNo<=10;pageNo++){
    if(Date.now()>deadline)throw new ApiError(504,'KMA_TIMEOUT','기상청 단기예보 전체 조회 시간이 초과되었습니다.');
    let page:Awaited<ReturnType<typeof readPage>>;
    try{page=await readPage(key,grid,base,pageNo);}catch(error){
      if(pageNo>1&&error instanceof ApiError&&error.code==='KMA_NO_DATA')throw new ApiError(502,'KMA_INCOMPLETE_DATA','기상청 예보의 일부 페이지가 비어 있습니다.');
      throw error;
    }
    if(total!==undefined&&page.total!==total) throw upstreamError();
    total=page.total;items.push(...page.items);
    if(items.length===total) return {items,fetchedAt:new Date().toISOString(),expires:Date.now()+5*60000};
    if(items.length>total) throw upstreamError();
  }
  throw new ApiError(502,'KMA_INCOMPLETE_DATA','기상청 단기예보의 전체 페이지를 확인하지 못했습니다.');
}
async function snapshot(key:string,grid:GridPoint,base:ForecastBase){
  const id=`${grid.nx},${grid.ny}:${base.baseDate}:${base.baseTime}`;
  const cached=snapshots.get(id);
  if(cached?.key===key&&cached.value.expires>Date.now()) return {...cached.value,cached:true};
  const active=pending.get(id);
  if(active?.key===key) return {...await active.promise,cached:true};
  const task={key,promise:collect(key,grid,base)};pending.set(id,task);
  try {
    const value=await task.promise;
    for(const [k,v] of snapshots) if(v.value.expires<=Date.now()) snapshots.delete(k);
    if(snapshots.size>=32) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(id,{key,value});return {...value,cached:false};
  } finally { if(pending.get(id)===task) pending.delete(id); }
}
export function selectForecast(items:Record<string,unknown>[],grid:GridPoint,base:ForecastBase,now:Date):WeatherResponse['data']{
  const slots=new Map<number,{date:string;time:string;temperature?:number;pop?:number}>();
  for(const item of items){
    if(item.baseDate!==base.baseDate||item.baseTime!==base.baseTime||number(item.nx)!==grid.nx||number(item.ny)!==grid.ny) throw new ApiError(502,'KMA_FORECAST_MISMATCH','기상청 응답의 발표시각 또는 격자가 요청과 일치하지 않습니다.');
    if(item.category!=='TMP'&&item.category!=='POP') continue;
    const date=text(item.fcstDate),time=text(item.fcstTime);
    let iso:string;
    try {iso=kstTimestamp(date,time);} catch {throw upstreamError();}
    const timestamp=Date.parse(iso);
    if(timestamp<now.getTime()||timestamp>now.getTime()+6*3600000) continue;
    const slot=slots.get(timestamp)??{date,time};
    if(typeof item.fcstValue==='string'&&!item.fcstValue.trim())throw upstreamError();
    const value=number(item.fcstValue);
    if(item.category==='TMP'){
      if(value< -100||value>70||(slot.temperature!==undefined&&slot.temperature!==value)) throw upstreamError();
      slot.temperature=value;
    }else{
      if(!Number.isInteger(value)||value<0||value>100||(slot.pop!==undefined&&slot.pop!==value)) throw upstreamError();
      slot.pop=value;
    }
    slots.set(timestamp,slot);
  }
  const complete=[...slots.entries()].filter(([,s])=>s.temperature!==undefined&&s.pop!==undefined).sort(([a],[b])=>a-b)[0];
  if(!complete) throw new ApiError(404,'KMA_NO_FUTURE_FORECAST','앞으로 6시간 이내의 같은 시각 기온·강수확률 예보를 찾지 못했습니다.');
  const slot=complete[1];
  return {temperatureC:slot.temperature!,precipitationProbability:slot.pop!,baseDate:base.baseDate,baseTime:base.baseTime,publishedAt:base.publishedAt,fcstDate:slot.date,fcstTime:slot.time,forecastAt:kstTimestamp(slot.date,slot.time)};
}
function coordinate(value:string|null,min:number,max:number){
  if(value===null||!/^-?\d+(\.\d+)?$/.test(value)) throw new ApiError(400,'INVALID_COORDINATES','출발지 위도·경도를 함께 입력해 주세요.');
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max) throw new ApiError(400,'INVALID_COORDINATES','출발지 위도·경도의 범위를 확인해 주세요.');
  return n;
}
export async function getWeather(request:Request):Promise<WeatherResponse>{
  const p=params(request,['lat','lng']);
  const origin={lat:coordinate(p.get('lat'),-90,90),lng:coordinate(p.get('lng'),-180,180)};
  let grid:GridPoint;
  try { grid=toKmaGrid(origin.lat,origin.lng); } catch {throw new ApiError(422,'KMA_OUTSIDE_GRID','출발지가 기상청 단기예보 격자 범위를 벗어났습니다.');}
  let key:string;
  try {key=secret('DATA_GO_KR_SERVICE_KEY');} catch {throw new ApiError(503,'KMA_NOT_CONFIGURED','기상청 단기예보 API 인증키가 설정되지 않았습니다.');}
  const now=new Date(),requestedPublication=forecastBase(now);
  let used=requestedPublication,all:Awaited<ReturnType<typeof snapshot>>;
  try {all=await snapshot(key,grid,used);} catch(error){
    if(!(error instanceof ApiError)||error.code!=='KMA_NO_DATA') throw error;
    used=previousForecastBase(requestedPublication);
    all=await snapshot(key,grid,used);
  }
  let data:WeatherResponse['data'];
  try{data=selectForecast(all.items,grid,used,now);}catch(error){snapshots.delete(`${grid.nx},${grid.ny}:${used.baseDate}:${used.baseTime}`);throw error;}
  return {data,meta:{source:'kma',isDemo:false,kind:'short-term-forecast',grid,origin,timeZone:'Asia/Seoul',fetchedAt:all.fetchedAt,requestedPublication,usedPreviousPublication:used.publishedAt!==requestedPublication.publishedAt,cached:all.cached}};
}
