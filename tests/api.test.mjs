import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

// Runs the actual TypeScript handlers with isolated environment/fetch mocks.
// Only the unit harness stubs server-only; Next enforces it in the real build.
function backend(env = {}, fetch = async () => { throw Error('Unexpected fetch'); }, Clock = Date) {
  const cache = new Map();
  function load(filename) {
    filename=path.resolve(filename);
    if(cache.has(filename)) return cache.get(filename).exports;
    const module={exports:{}}; cache.set(filename,module);
    const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const require=spec=>spec==='server-only'?{}:load(spec.startsWith('@/')?path.resolve('src',`${spec.slice(2)}.ts`):path.resolve(path.dirname(filename),`${spec}.ts`));
    vm.runInNewContext(js,{module,exports:module.exports,require,process:{env},fetch,URL,URLSearchParams,Request,Response,AbortSignal,Date:Clock,Map,Set,Error},{filename});
    return module.exports;
  }
  return {load,async request(route,q=''){return load(`src/app/api/${route}/route.ts`).GET(new Request(`http://localhost/api/${route}${q}`));}};
}
const credentials={API_DATA_MODE:'live',SEOUL_API_KEY:'seoul-secret-test-123',DATA_GO_KR_SERVICE_KEY:'public+secret/test=',KAKAO_REST_API_KEY:'kakao-secret-test-456',TAAS_API_KEY:'taas+secret/test='};

test('non-station endpoints retain labelled demo data without external fetches',async()=>{
 const api=backend();
 for(const [route,q] of [['places','?query=여의']]){
  const r=await api.request(route,q);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).meta.isDemo,true);
 }
});
test('invalid, duplicate, and arbitrary proxy parameters return 400',async()=>{
 for(const [route,q] of [['places',''],['places','?query=a&page=46'],['places','?query=a&query=b'],['weather','?nx=Infinity'],['weather','?ny=0'],['stations','?limit=1001'],['stations','?start=-1'],['stations','?url=https://evil.test'],['routes','?from=yeouido&to=yeouido']]) assert.equal((await backend().request(route,q)).status,400,route+q);
});
test('live mode requires credentials and invalid server mode fails closed',async()=>{
 for(const route of ['stations','places']){
  const r=await backend({API_DATA_MODE:'live'}).request(route,route==='places'?'?query=여의':'');assert.equal(r.status,503);assert.equal((await r.json()).error.code,'API_NOT_CONFIGURED');
 }
 assert.equal((await backend({API_DATA_MODE:'typo'}).request('stations')).status,503);
});
test('Kakao receives Authorization on fixed upstream; only selected fields returned',async()=>{
 const api=backend(credentials,async(url,opts)=>{
  assert.equal(url.origin,'https://dapi.kakao.com');assert.equal(url.searchParams.get('query'),'여의');assert.equal(opts.headers.Authorization,`KakaoAK ${credentials.KAKAO_REST_API_KEY}`);assert.equal(opts.redirect,'error');
  return Response.json({documents:[{id:'1',place_name:'여의나루',road_address_name:'서울',x:'126.93',y:'37.52',secret:credentials.KAKAO_REST_API_KEY}],meta:{is_end:true}});
 });
 const r=await api.request('places','?query=여의');assert.equal(r.status,200);const body=await r.json();assert.equal(body.meta.isDemo,false);assert.equal(body.data[0].lng,126.93);assert.equal('secret' in body.data[0],false);
});
test('upstream exceptions, non-JSON, and malformed responses never disclose credentials',async()=>{
 for(const fetch of [async()=>{throw Error(`URL /${credentials.SEOUL_API_KEY}/ header ${credentials.KAKAO_REST_API_KEY}`);},async()=>new Response(credentials.DATA_GO_KR_SERVICE_KEY,{status:403}),async()=>Response.json({error:credentials.SEOUL_API_KEY}),async()=>new Response('<xml>private</xml>')]){
  const r=await backend(credentials,fetch).request('stations');assert.equal(r.status,502);const body=await r.text();for(const key of Object.values(credentials))assert(!body.includes(key));assert(!body.includes('openapi.seoul'));
 }
});
test('timeouts return 504; even success fields redact reflected credentials',async()=>{
 const r=await backend(credentials,async()=>{const e=Error(credentials.SEOUL_API_KEY);e.name='TimeoutError';throw e;}).request('weather','?lat=37.5271&lng=126.9328');assert.equal(r.status,504);
 const api=backend(credentials,async()=>Response.json({documents:[{id:'1',place_name:credentials.KAKAO_REST_API_KEY,road_address_name:'서울',x:'126.93',y:'37.52'}],meta:{is_end:true}}));
 const body=await(await api.request('places','?query=여의')).text();assert(!body.includes(credentials.KAKAO_REST_API_KEY));assert(body.includes('[REDACTED]'));
});
test('root/project Git rules ignore secrets while allowing blank templates',()=>{
 for(const ignoreFile of ['.gitignore','../.gitignore']){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'safe-bike-ignore-'));
  try{
   fs.writeFileSync(path.join(temp,'.gitignore'),fs.readFileSync(ignoreFile));execFileSync('git',['init','-q',temp]);
   const ignored=['.env','.env.local','.env.production','nested/.env.local'];
   const out=execFileSync('git',['-C',temp,'check-ignore','--no-index','--stdin'],{input:[...ignored,'.env.example','nested/.env.example'].join('\n')+'\n',encoding:'utf8'});
   assert.deepEqual(out.trim().split('\n'),ignored);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
 }
});
test('credentials stay in server-only modules and are absent from Next public config',()=>{
 for(const file of ['env.ts','http.ts','providers.ts','seoul-stations.ts','kakao-routes.ts','taas-accidents.ts','kma-weather.ts'])assert(fs.readFileSync(`src/lib/server/${file}`,'utf8').startsWith("import 'server-only';"));
 assert(!/\benv\s*:/.test(fs.readFileSync('next.config.ts','utf8')));
 for(const file of ['src/app/page.tsx','src/components/bike-map.tsx'])assert(!/process\.env\.(SEOUL_API_KEY|DATA_GO_KR_SERVICE_KEY|KAKAO_REST_API_KEY)/.test(fs.readFileSync(file,'utf8')));
});

const row = (id, lat = 37.5271, lng = 126.9328, bikes = 3) => ({stationId:id,stationName:`Test station ${id}`,parkingBikeTotCnt:String(bikes),rackTotCnt:'2',stationLatitude:String(lat),stationLongitude:String(lng)});
const page = data => Response.json({rentBikeStatus:{RESULT:{CODE:'INFO-000'},list_total_count:data.length,row:data}});

test('stations never return demo data even when demo mode is enabled',async()=>{
 const r=await backend({API_DATA_MODE:'demo'}).request('stations');assert.equal(r.status,503);
 let calls=0;
 const api=backend({...credentials,API_DATA_MODE:'demo'},async()=>{calls++;return page([row('live')]);});
 const response=await api.request('stations');assert.equal(response.status,200);const body=await response.json();assert.equal(body.meta.isDemo,false);assert.equal(body.meta.source,'seoul');assert.equal(body.data[0].id,'live');assert.equal(calls,1);
});
test('nearest station can be on page two; full city is read before distance ranking',async()=>{
 const calls=[];
 const far=Array.from({length:1000},(_,i)=>row(`far-${i}`,37.6,127.05));
 const api=backend(credentials,async url=>{
  assert.equal(url.host,'openapi.seoul.go.kr:8088');calls.push(url.pathname);
  return calls.length===1?page(far):page([row('near',37.52715,126.9328),row('middle',37.529,126.9328),row('empty',37.5271,126.9328,0)]);
 });
 const r=await api.request('stations','?lat=37.5271&lng=126.9328&limit=1&availableOnly=1');assert.equal(r.status,200);const body=await r.json();
 assert.equal(calls.length,2);assert(calls[0].endsWith('/1/1000/'));assert(calls[1].endsWith('/1001/2000/'));
 assert.equal(body.data[0].id,'near');assert(body.data[0].distanceMeters<10);assert.equal(body.meta.total,1003);assert.equal(body.meta.matched,2);
});
test('radius, availability, and name filters happen before the result limit',async()=>{
 const api=backend(credentials,async()=>page([row('zero',37.5271,126.9328,0),row('wanted-near',37.528,126.9328),row('wanted-far',37.56,126.9328),row('other',37.5271,126.933)]));
 const r=await api.request('stations','?radius=500&availableOnly=1&query=wanted&limit=1');const body=await r.json();assert.equal(body.data.length,1);assert.equal(body.data[0].id,'wanted-near');assert.equal(body.meta.matched,1);
 const empty=await(await api.request('stations','?query=no-match')).json();assert.equal(empty.data.length,0);assert.equal(empty.meta.isDemo,false);
});
test('invalid coordinate rows are excluded; valid zero bikes remain; bikes may exceed slots',async()=>{
 const api=backend(credentials,async()=>page([row('bad',0,0),row('bad2','NaN',126.9),row('good',37.5271,126.9328,12),row('zero',37.528,126.9328,0)]));
 const r=await api.request('stations');assert.equal(r.status,200);const body=await r.json();assert.equal(body.meta.skipped,2);assert.equal(body.meta.total,2);assert.equal(body.data[0].bikes,12);assert.equal(body.data[1].bikes,0);
});
test('station query validation rejects incomplete, invalid, repeated and out-of-range coordinates',async()=>{
 for(const q of ['?lat=37','?lat=NaN&lng=126','?lat=91&lng=126','?lat=37&lng=181','?lat=37&lng=126&lat=38','?radius=99','?radius=10001','?availableOnly=yes','?limit=101'])assert.equal((await backend().request('stations',q)).status,400,q);
});
test('station snapshots share in-flight calls, cache for 60s, and expire',async()=>{
 let now=100000,calls=0;
 class Clock extends Date{static now(){return now;}}
 const api=backend(credentials,async()=>{calls++;return page([row('one')]);},Clock);
 const responses=await Promise.all([api.request('stations'),api.request('stations','?radius=500')]);
 assert(responses.every(r=>r.status===200));assert.equal(calls,1);
 assert.equal((await(await api.request('stations')).json()).meta.cached,true);assert.equal(calls,1);
 now+=61000;assert.equal((await api.request('stations')).status,200);assert.equal(calls,2);
});
test('a later page error never produces an incomplete nearest-station list and retries are possible',async()=>{
 let calls=0,fail=true;
 const data=Array.from({length:1000},(_,i)=>row(`test-${i}`));
 const api=backend(credentials,async url=>{calls++;if(url.pathname.endsWith('/1/1000/'))return page(data);if(fail)return Response.json({RESULT:{CODE:'ERROR-300',MESSAGE:credentials.SEOUL_API_KEY}});return page([row('last')]);});
 const r=await api.request('stations');assert.equal(r.status,502);assert(!(await r.text()).includes(credentials.SEOUL_API_KEY));fail=false;assert.equal((await api.request('stations')).status,200);assert.equal(calls,4);
});
test('exact page multiples terminate on INFO-200; stations are deduplicated by id',async()=>{
 let calls=0;
 const data=Array.from({length:1000},()=>row('duplicate'));
 const api=backend(credentials,async()=>++calls===1?page(data):Response.json({RESULT:{CODE:'INFO-200'}}));
 const r=await api.request('stations');assert.equal(r.status,200);assert.equal(calls,2);assert.equal((await r.json()).meta.total,1);
});
test('haversine distance works in both directions, handles zero, and orders before rounding',()=>{
 const {distanceMeters,nearbyStations}=backend().load('src/lib/stations.ts');
 const a={lat:37.5271,lng:126.9328},b={lat:37.5371,lng:126.9328};
 assert.equal(distanceMeters(a,a),0);assert(Math.abs(distanceMeters(a,b)-1112)<2);assert.equal(distanceMeters(a,b),distanceMeters(b,a));
 const options={radiusMeters:1000,limit:2,availableOnly:false,query:''};
 const stations=[{...a,id:'z',name:'z',bikes:1,slots:1},{...a,id:'a',name:'a',bikes:0,slots:1}];
 const ranked=nearbyStations(stations,a,options);assert.equal(ranked.data[0].id,'a');
});
test('production source has no mock station fixtures or client-side secret imports',()=>{
 assert(!fs.readFileSync('src/lib/demo-data.ts','utf8').includes('export const stations'));
 for(const filename of ['src/app/page.tsx','src/components/bike-map.tsx']){
  const source=fs.readFileSync(filename,'utf8');assert(!/import.*stations.*demo-data/.test(source));
 }
 assert(fs.readFileSync('src/app/page.tsx','utf8').includes('useStations(draftFrom'));
 assert(fs.readFileSync('src/hooks/use-stations.ts','utf8').includes('controller.abort()'));
});

test('Kakao overlays use API coordinates/counts and marker clicks select the real station id',()=>{
 const effects=[],overlays=[],boundsPoints=[];
 const container={replaceChildren(){}};
 const cleanups=[];
 class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng;}}
 class Bounds{extend(point){boundsPoints.push(point);}}
 class Overlay{constructor(options){this.options=options;overlays.push(this);}setMap(map){this.map=map;}}
 let mapCount=0,boundsUpdates=0;
 class MapStub{constructor(){mapCount++;}setBounds(){boundsUpdates++;}relayout(){}}
 const maps={LatLng,LatLngBounds:Bounds,CustomOverlay:Overlay,Polyline:Overlay,Polygon:Overlay,Map:MapStub};
 let stateIndex=0,refIndex=0;const refs=[];
 const react={useState:()=>[[true,false,true][stateIndex++],()=>{}],useRef:initial=>{const i=refIndex++;return refs[i]??(refs[i]={current:i===0?container:initial});},useEffect:effect=>effects.push(effect)};
 const element=(type,props)=>({type,props});
 const require=spec=>{
  if(spec==='react')return react;
  if(spec==='react/jsx-runtime')return {jsx:element,jsxs:element,Fragment:'fragment'};
  if(spec==='next/script')return {default:()=>null};
  if(spec.startsWith('@/lib/'))return backend().load(`src/lib/${spec.slice('@/lib/'.length)}.ts`);
  throw Error(`Unexpected import ${spec}`);
 };
 const module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync('src/components/bike-map.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,require,process:{env:{NEXT_PUBLIC_KAKAO_MAP_APP_KEY:'public-sdk-test'}},window:{kakao:{maps}},document:{createElement:()=>({setAttribute(){},addEventListener(type,callback){this[type]=callback;}})},ResizeObserver:class{observe(){}disconnect(){}}});
 const origin={id:'origin',name:'출발지',area:'서울',lat:37.5271,lng:126.9328};
 let selected='';
 const station={id:'ST-REAL',name:'API station',lat:37.528,lng:126.933,bikes:17,slots:20,distanceMeters:100};
 module.exports.default({destination:{...origin,id:'to',lat:37.54},routeOrigin:origin,routes:[],activeMode:'BIKE_ONLY',showStations:true,showIncidents:false,selected:station.id,onStation:id=>selected=id,stations:[station],stationOrigin:origin});
 for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}
 const marker=overlays.find(o=>o.options.content?.title===`${station.name}, 대여 가능 17대`);
 assert(marker);assert.equal(marker.options.position.lat,station.lat);assert.equal(marker.options.position.lng,station.lng);assert.equal(marker.options.content.textContent,'🚲 17대');assert.equal(marker.options.zIndex,10);
 assert.equal(overlays.filter(o=>o.options.path).length,0,'No mock path may be drawn before an API result');
 marker.options.content.click();assert.equal(selected,station.id);assert(boundsPoints.some(p=>p.lat===station.lat&&p.lng===station.lng));
 for(const cleanup of cleanups)cleanup();assert(overlays.every(o=>o.map===null));
 stateIndex=0;refIndex=0;effects.length=0;overlays.length=0;cleanups.length=0;
 const segments=[[{lat:37.5271,lng:126.9328},{lat:37.528,lng:126.934}],[{lat:37.535,lng:126.98},{lat:37.54,lng:126.99}]];
 const routes=['BIKE_ONLY','SHORTEST'].map(mode=>({mode,segments,distanceMeters:4567,durationSeconds:1345}));
 module.exports.default({destination:{...origin,id:'to',lat:37.54},routeOrigin:origin,routes,activeMode:'SHORTEST',showStations:false,showIncidents:false,selected:'',onStation:()=>{},stations:[],stationOrigin:origin});
 for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}
 const lines=overlays.filter(o=>o.options.path);assert.equal(lines.length,4);assert(lines.every(line=>line.options.path.length===2),'Never connect gaps between API steps');assert.equal(lines.filter(line=>line.options.strokeWeight===6).length,2);assert.equal(lines[0].options.path[0].lat,segments[0][0].lat);assert.equal(lines[1].options.path[0].lng,segments[1][0].lng);
 for(const cleanup of cleanups)cleanup();
 stateIndex=0;refIndex=0;effects.length=0;overlays.length=0;cleanups.length=0;
 const polygon=[[{lat:37.52,lng:126.93},{lat:37.52,lng:126.94},{lat:37.53,lng:126.94},{lat:37.53,lng:126.93},{lat:37.52,lng:126.93}]];
 let pickedAccident='';
 const zone={id:'historical-zone',name:'Historical zone',lat:37.525,lng:126.935,year:2025,accidents:4,nearRoute:true,polygons:[polygon]};
 const accidentProps={destination:{...origin,id:'to',lat:37.54},routeOrigin:null,routes:[],activeMode:'BIKE_ONLY',showStations:false,showIncidents:true,selected:'',onStation:()=>{},stations:[],stationOrigin:origin,accidents:[zone],selectedAccident:zone.id,onAccident:id=>pickedAccident=id};
 module.exports.default(accidentProps);
 for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}
 const shape=overlays.find(o=>o.options.fillColor);assert(shape);assert.equal(shape.options.fillColor,'#b84732');assert.equal(shape.options.path[0][0].lat,polygon[0][0].lat);assert.equal(shape.options.fillOpacity,.3);
 const crashMarker=overlays.find(o=>o.options.content?.title?.includes('2025년 과거 자전거 사고 4건'));assert(crashMarker);crashMarker.options.content.click();assert.equal(pickedAccident,zone.id);
 for(const cleanup of cleanups)cleanup();
 const previousBounds=boundsUpdates;
 stateIndex=0;refIndex=0;effects.length=0;cleanups.length=0;
 module.exports.default({...accidentProps,accidents:[{...zone,accidents:5}]});
 for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}
 assert.equal(mapCount,1,'Refreshing source data must reuse the SDK map');assert.equal(boundsUpdates,previousBounds,'Count-only updates must preserve the user viewport');
 for(const cleanup of cleanups)cleanup();

});

const routeQuery='?stationId=ST-REAL&endLat=37.54&endLng=126.99';
const routeBody=()=>({status:'OK',route:{properties:{totalDistance:4567,totalTime:1345},legs:[{steps:[{path:{points:[[126.9328,37.5271],[126.934,37.528]]}},{path:{points:[[126.98,37.535],[126.99,37.54]]}}]}]}});
function routingBackend(kakaoResponse,env=credentials){
 return backend(env,async(url,options)=>{
  if(url.host==='openapi.seoul.go.kr:8088')return page([row('ST-REAL')]);
  assert.equal(url.origin,'https://dapi.kakao.com');assert.equal(url.pathname,'/v2/routing/bicycle');assert.equal(options.headers.Authorization,`KakaoAK ${env.KAKAO_REST_API_KEY}`);assert.equal(options.redirect,'error');
  assert.equal(url.searchParams.get('start_x'),'126.9328');assert.equal(url.searchParams.get('start_y'),'37.5271');assert.equal(url.searchParams.get('end_x'),'126.99');assert.equal(url.searchParams.get('end_y'),'37.54');assert.equal(url.searchParams.get('output_coord'),'WGS84');
  return kakaoResponse(url,options);
 });
}
test('routing missing key is explicit, never mock, even with demo mode enabled',async()=>{
 const r=await backend({API_DATA_MODE:'demo'}).request('routes',routeQuery);assert.equal(r.status,503);const body=await r.json();assert.equal(body.error.code,'KAKAO_ROUTING_NOT_CONFIGURED');assert.equal('data' in body,false);
});
test('official bicycle endpoint receives both modes and actual Seoul station coordinates',async()=>{
 const modes=[];
 const api=routingBackend(async url=>{modes.push(url.searchParams.get('route_mode'));return Response.json(routeBody());},{...credentials,API_DATA_MODE:'demo'});
 const r=await api.request('routes',routeQuery);assert.equal(r.status,200);const body=await r.json();assert.deepEqual(modes,['BIKE_ONLY','SHORTEST']);assert.equal(body.meta.source,'kakao');assert.equal(body.meta.isDemo,false);assert.equal(body.meta.origin.id,'ST-REAL');
 for(const route of body.data){assert.equal(route.distanceMeters,4567);assert.equal(route.durationSeconds,1345);assert.equal(route.segments.length,2);assert.equal(route.segments[0][0].lng,126.9328);assert.equal(route.segments[0][0].lat,37.5271);assert.equal(route.segments[1][0].lng,126.98);}
});
test('routing validates station ids/destinations and refuses fabricated stations before Kakao calls',async()=>{
 for(const q of ['', '?stationId=ST-REAL&endLat=37', '?stationId=ST-REAL&endLat=100&endLng=126', '?stationId=ST-REAL&endLat=37&endLng=NaN', '?stationId=ST-REAL&endLat=37&endLng=126&startLat=37'])assert.equal((await backend().request('routes',q)).status,400,q);
 const api=backend(credentials,async url=>{assert.equal(url.host,'openapi.seoul.go.kr:8088');return page([]);});
 assert.equal((await api.request('routes',routeQuery)).status,404);
});
test('routing distinguishes auth, permission, quota and unavailable endpoint; returns no substitute geometry',async()=>{
 for(const [status,code,expected] of [[401,'KAKAO_AUTH_FAILED',502],[403,'KAKAO_PERMISSION_DENIED',502],[429,'KAKAO_QUOTA_EXCEEDED',503],[404,'KAKAO_ENDPOINT_UNAVAILABLE',502],[500,'KAKAO_UPSTREAM_ERROR',502]]){
  const api=routingBackend(async()=>Response.json({error:credentials.KAKAO_REST_API_KEY},{status}));
  const r=await api.request('routes',routeQuery);assert.equal(r.status,expected);const body=await r.json();assert.equal(body.error.code,code);assert.equal('data' in body,false);assert(!JSON.stringify(body).includes(credentials.KAKAO_REST_API_KEY));
 }
});
test('a failed comparison option clears the entire comparison instead of substituting another route',async()=>{
 const api=routingBackend(async url=>url.searchParams.get('route_mode')==='BIKE_ONLY'?Response.json(routeBody()):new Response('',{status:403}));
 const r=await api.request('routes',routeQuery);assert.equal(r.status,502);const body=await r.json();assert(body.error.message.startsWith('최단 경로:'));assert.equal('data' in body,false);
});
test('empty/malformed coordinates and route-not-found results produce no fabricated path',async()=>{
 for(const [value,status] of [[{status:'ROUTE_RESULT_NOT_FOUND'},422],[{status:'OK',route:{properties:{totalDistance:1,totalTime:1},legs:[]}},502],[{status:'OK',route:{properties:{totalDistance:1,totalTime:1},legs:[{steps:[{path:{points:[[999,37],[126,37]]}}]}]}},502]]){
  const r=await routingBackend(async()=>Response.json(value)).request('routes',routeQuery);assert.equal(r.status,status);assert.equal('data' in await r.json(),false);
 }
});
test('routing timeout and invalid JSON are sanitized without endpoint connectors',async()=>{
 for(const [fetch,status] of [[async()=>{const e=Error(credentials.KAKAO_REST_API_KEY);e.name='TimeoutError';throw e;},504],[async()=>new Response('invalid-json'),502]]){
  const r=await routingBackend(fetch).request('routes',routeQuery);assert.equal(r.status,status);assert(!(await r.text()).includes(credentials.KAKAO_REST_API_KEY));
 }
});
test('application has no synthetic route builder or hardcoded comparison metrics',()=>{
 for(const filename of ['src/lib/demo-data.ts','src/lib/server/providers.ts','src/components/bike-map.tsx','src/app/page.tsx']){
  const source=fs.readFileSync(filename,'utf8');assert(!source.includes('routePath'));assert(!source.includes('routeOptions'));assert(!source.includes('percent: 92'));
 }
 assert(fs.readFileSync('src/components/bike-map.tsx','utf8').includes('route.segments.forEach'));
});

const accidentRow=(district,id=district)=>({afos_fid:id,afos_id:'2025046',bjd_cd:`11${district}00000`,spot_nm:`Test zone ${id}`,sido_sgg_nm:`Seoul test ${district}`,occrrnc_cnt:'4',caslt_cnt:'5',dth_dnv_cnt:'1',se_dnv_cnt:'2',lo_crd:'126.95',la_crd:'37.53',geom_json:JSON.stringify({type:'Polygon',coordinates:[[[126.949,37.529],[126.951,37.529],[126.951,37.531],[126.949,37.531],[126.949,37.529]]]})});
const accidentPage=(data,total=data.length)=>Response.json({resultCode:'00',totalCount:total,items:{item:data}});
test('accident API uses documented latest year 2025, all 25 districts and a server-only single-encoded key',async()=>{
 const districts=[];
 const api=backend({...credentials,API_DATA_MODE:'demo'},async(url,opts)=>{
  assert.equal(url.origin,'https://apis.data.go.kr');assert.equal(url.pathname,'/B552061/frequentzoneBicycle/getRestFrequentzoneBicycle');assert.equal(url.searchParams.get('serviceKey'),credentials.TAAS_API_KEY);assert.equal(url.searchParams.get('searchYearCd'),'2025');assert.equal(url.searchParams.get('siDo'),'11');assert.equal(opts.redirect,'error');
  const d=url.searchParams.get('guGun');districts.push(d);return accidentPage([accidentRow(d)]);
 });
 const r=await api.request('accidents');assert.equal(r.status,200);const body=await r.json();assert.equal(body.data.length,25);assert.equal(new Set(districts).size,25);assert.equal(body.meta.isDemo,false);assert.equal(body.meta.year,2025);assert.equal(body.meta.latestDocumentedYear,2025);assert.equal(body.data[0].accidents,4);assert.equal(body.data[0].polygons[0][0][0].lng,126.949);assert(body.meta.notice.includes('과거 사고 통계'));
});
test('accidents need authorized credentials and never revert to former mock markers',async()=>{
 const r=await backend({API_DATA_MODE:'demo'}).request('accidents');assert.equal(r.status,503);const body=await r.json();assert.equal(body.error.code,'TAAS_NOT_CONFIGURED');assert.equal('data' in body,false);
 assert(!fs.readFileSync('src/lib/demo-data.ts','utf8').includes('export const incidents'));
});
test('accident years are explicit and reject values newer than official documented coverage',async()=>{
 for(const q of ['?year=2026','?year=2011','?year=NaN','?year=2025&year=2024','?url=https://elsewhere.test'])assert.equal((await backend().request('accidents',q)).status,400);
 const api=backend(credentials,async url=>{assert.equal(url.searchParams.get('searchYearCd'),'2024');return accidentPage([]);});
 const r=await api.request('accidents','?year=2024');assert.equal(r.status,200);const body=await r.json();assert.equal(body.meta.year,2024);assert.equal(body.meta.latestDocumentedYear,2025);
});
test('accident API paginates a district before publishing and accepts single-item envelopes',async()=>{
 const api=backend(credentials,async url=>{
  const d=url.searchParams.get('guGun'),n=url.searchParams.get('pageNo');
  if(d!=='110')return Response.json({resultCode:'03'});
  if(n==='1')return accidentPage(Array.from({length:100},(_,i)=>accidentRow(d,`zone-${i}`)),101);
  return Response.json({resultCode:'00',totalCount:101,items:{item:accidentRow(d,'zone-last')}});
 });
 const r=await api.request('accidents');assert.equal(r.status,200);assert.equal((await r.json()).meta.total,101);
});
test('accident JSON and XML authorization errors are sanitized; partial Seoul results are rejected',async()=>{
 for(const fail of [()=>new Response(`<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode><returnAuthMsg>${credentials.TAAS_API_KEY}</returnAuthMsg></OpenAPI_ServiceResponse>`),()=>Response.json({resultCode:'20',resultMsg:credentials.TAAS_API_KEY})]){
  const api=backend(credentials,async url=>url.searchParams.get('guGun')==='110'?fail():accidentPage([accidentRow(url.searchParams.get('guGun'))]));
  const r=await api.request('accidents');assert.equal(r.status,502);const body=await r.text();assert(body.includes('TAAS_AUTH_FAILED'));assert(!body.includes(credentials.TAAS_API_KEY));assert(!body.includes('polygons'));
 }
});
test('accident responses exclude invalid coordinates and retain centers with unavailable polygons',async()=>{
 const api=backend(credentials,async url=>{
  const d=url.searchParams.get('guGun');if(d!=='110')return accidentPage([]);
  return accidentPage([{...accidentRow(d,'bad'),la_crd:'NaN'},{...accidentRow(d,'center-only'),geom_json:'invalid-geometry'}]);
 });
 const r=await api.request('accidents');assert.equal(r.status,200);const body=await r.json();assert.equal(body.meta.skipped,1);assert.equal(body.meta.missingGeometry,1);assert.equal(body.data.length,1);assert.deepEqual(body.data[0].polygons,[]);
});
test('accident cache combines concurrent requests and missing year data is not replaced by older data',async()=>{
 let calls=0;
 const api=backend(credentials,async url=>{calls++;assert.equal(url.searchParams.get('searchYearCd'),'2025');return accidentPage([]);});
 const responses=await Promise.all([api.request('accidents'),api.request('accidents')]);assert(responses.every(r=>r.status===200));assert.equal(calls,25);const cached=await(await api.request('accidents')).json();assert.equal(cached.meta.cached,true);assert.equal(cached.data.length,0);assert.equal(calls,25);
});
test('accident geometry supports polygon holes and multipolygons, never invents missing rings',()=>{
 const {parsePolygons}=backend().load('src/lib/server/taas-accidents.ts');
 const ring=[[126.9,37.5],[127,37.5],[127,37.6],[126.9,37.6],[126.9,37.5]];
 assert.equal(parsePolygons({type:'MultiPolygon',coordinates:[[ring],[ring]]}).length,2);
 assert.equal(parsePolygons({type:'Polygon',coordinates:[ring,ring]}).length,1);
 assert.equal(parsePolygons({type:'Polygon',coordinates:[ring.slice(0,-1)]}).length,0);
});
test('route proximity uses segment interiors and polygon intersections instead of endpoints',()=>{
 const {routeDistance,assessAccidents}=backend().load('src/lib/accidents.ts');
 const route={mode:'BIKE_ONLY',segments:[[{lat:37.53,lng:126.94},{lat:37.53,lng:126.96}]],distanceMeters:1800,durationSeconds:500};
 const center={id:'center',lat:37.5305,lng:126.95,polygons:[]};
 const d=routeDistance(center,route);assert(d>50&&d<60);
 const polygon={...center,polygons:[[[{lat:37.529,lng:126.949},{lat:37.529,lng:126.951},{lat:37.531,lng:126.951},{lat:37.531,lng:126.949},{lat:37.529,lng:126.949}]]]};
 assert.equal(routeDistance(polygon,route),0);
 assert.equal(assessAccidents([center],undefined,200)[0].nearRoute,null);assert.equal(assessAccidents([center],route,100)[0].nearRoute,true);assert.equal(assessAccidents([center],route,10)[0].nearRoute,false);
});
test('route proximity never bridges disconnected API steps and respects polygon holes',()=>{
 const {routeDistance}=backend().load('src/lib/accidents.ts');
 const center={lat:37.53,lng:126.95,polygons:[]};
 const gapRoute={segments:[[{lat:37.53,lng:126.90},{lat:37.53,lng:126.91}],[{lat:37.53,lng:126.99},{lat:37.53,lng:127.00}]]};
 assert(routeDistance(center,gapRoute)>3000);
 const ring=(minLng,maxLng,minLat,maxLat)=>[{lng:minLng,lat:minLat},{lng:maxLng,lat:minLat},{lng:maxLng,lat:maxLat},{lng:minLng,lat:maxLat},{lng:minLng,lat:minLat}];
 const hole={...center,polygons:[[ring(126.94,126.96,37.52,37.54),ring(126.945,126.955,37.525,37.535)]]};
 const inHole={segments:[[{lat:37.53,lng:126.949},{lat:37.53,lng:126.951}]]};
 assert(routeDistance(hole,inHole)>300);
});

const weatherQuery='?lat=37.5271&lng=126.9328';
function fixedClock(iso){
 let current=Date.parse(iso);
 class Clock extends Date{constructor(...args){super(...(args.length?args:[current]));}static now(){return current;}}
 return {Clock,set:iso=>current=Date.parse(iso)};
}
function weatherItems(url,values={TMP:'18.3',POP:'0'},date='20261119',time='1500'){
 return Object.entries(values).map(([category,fcstValue])=>({baseDate:url.searchParams.get('base_date'),baseTime:url.searchParams.get('base_time'),nx:Number(url.searchParams.get('nx')),ny:Number(url.searchParams.get('ny')),category,fcstValue,fcstDate:date,fcstTime:time}));
}
const forecastPage=(items,total=items.length)=>Response.json({response:{header:{resultCode:'00'},body:{totalCount:total,items:{item:items}}}});
test('KMA DFS projection matches reference point and representative Korean cities',()=>{
 const {toKmaGrid}=backend().load('src/lib/weather.ts');
 for(const [lat,lng,nx,ny] of [[38,126,43,136],[37.5665,126.9780,60,127],[37.5271,126.9328,59,126],[35.1796,129.0756,98,76],[33.4996,126.5312,53,38]])assert.equal(JSON.stringify(toKmaGrid(lat,lng)),JSON.stringify({nx,ny}));
 for(const [lat,lng] of [[NaN,126],[90,126],[37,181],[40,-74]])assert.throws(()=>toKmaGrid(lat,lng));
});
test('forecast issuance policy handles 10-minute boundary, KST midnight and year rollover',()=>{
 const {forecastBase,previousForecastBase,kstTimestamp}=backend().load('src/lib/weather.ts');
 for(const [iso,date,time] of [['2026-11-19T05:09:59+09:00','20261119','0200'],['2026-11-19T05:10:00+09:00','20261119','0500'],['2026-11-19T00:05:00+09:00','20261118','2300'],['2027-01-01T02:09:00+09:00','20261231','2300']]){
  const base=forecastBase(new Date(iso));assert.equal(base.baseDate,date);assert.equal(base.baseTime,time);assert(base.publishedAt.endsWith('+09:00'));
 }
 const previous=previousForecastBase(forecastBase(new Date('2026-11-19T02:10:00+09:00')));assert.equal(previous.baseDate,'20261118');assert.equal(previous.baseTime,'2300');assert.throws(()=>kstTimestamp('20260230','1500'));
});
test('weather requires an actual authorized key even in demo mode and validates origin coordinates',async()=>{
 const r=await backend({API_DATA_MODE:'demo'}).request('weather',weatherQuery);assert.equal(r.status,503);assert.equal((await r.json()).error.code,'KMA_NOT_CONFIGURED');
 for(const q of ['', '?lat=37','?lat=NaN&lng=126','?lat=91&lng=126','?lat=37&lng=181','?lat=37&lng=126&lat=38','?nx=59&ny=126'])assert.equal((await backend().request('weather',q)).status,400,q);
 assert.equal((await backend().request('weather','?lat=40&lng=-74')).status,422);
});
test('getVilageFcst uses projected grid, server key encoded once, and matching TMP/POP forecast time',async()=>{
 const clock=fixedClock('2026-11-19T14:45:00+09:00');
 const api=backend({...credentials,API_DATA_MODE:'demo'},async(url,opts)=>{
  assert.equal(url.origin,'https://apis.data.go.kr');assert.equal(url.pathname,'/1360000/VilageFcstInfoService_2.0/getVilageFcst');assert.equal(url.searchParams.get('serviceKey'),credentials.DATA_GO_KR_SERVICE_KEY);assert.equal(url.searchParams.get('nx'),'59');assert.equal(url.searchParams.get('ny'),'126');assert.equal(url.searchParams.get('base_date'),'20261119');assert.equal(url.searchParams.get('base_time'),'1400');assert.equal(opts.redirect,'error');
  return forecastPage(weatherItems(url));
 },clock.Clock);
 const r=await api.request('weather',weatherQuery);assert.equal(r.status,200);const body=await r.json();assert.equal(body.data.temperatureC,18.3);assert.equal(body.data.precipitationProbability,0);assert.equal(body.data.publishedAt,'2026-11-19T14:00:00+09:00');assert.equal(body.data.forecastAt,'2026-11-19T15:00:00+09:00');assert.equal(body.meta.isDemo,false);assert.equal(body.meta.kind,'short-term-forecast');assert.equal('humidityPercent' in body.data,false);
});
test('weather pairs by forecast date/time without mixing hours and never defaults missing POP to zero',async()=>{
 const clock=fixedClock('2026-11-19T14:45:00+09:00');
 const api=backend(credentials,async url=>forecastPage([...weatherItems(url,{TMP:'19'},'20261119','1500'),...weatherItems(url,{POP:'80',TMP:'17'},'20261119','1600')]),clock.Clock);
 const body=await(await api.request('weather',weatherQuery)).json();assert.equal(body.data.temperatureC,17);assert.equal(body.data.precipitationProbability,80);assert.equal(body.data.fcstTime,'1600');
 const incomplete=backend(credentials,async url=>forecastPage(weatherItems(url,{TMP:'19'})),clock.Clock);
 const r=await incomplete.request('weather',weatherQuery);assert.equal(r.status,404);assert.equal('data' in await r.json(),false);
});
test('weather reads a second page when POP appears later in the response',async()=>{
 let calls=0;const clock=fixedClock('2026-11-19T14:45:00+09:00');
 const api=backend(credentials,async url=>{
  calls++;
  if(url.searchParams.get('pageNo')==='1')return forecastPage([...weatherItems(url,{TMP:'20'}),...Array.from({length:999},()=>weatherItems(url,{SKY:'1'})[0])],1001);
  return forecastPage(weatherItems(url,{POP:'30'}),1001);
 },clock.Clock);
 const r=await api.request('weather',weatherQuery);assert.equal(r.status,200);assert.equal((await r.json()).data.precipitationProbability,30);assert.equal(calls,2);
});
test('weather fallback uses the previous real issuance only for absent latest data and labels its actual base time',async()=>{
 const times=[],clock=fixedClock('2026-11-19T14:45:00+09:00');
 const api=backend(credentials,async url=>{const time=url.searchParams.get('base_time');times.push(time);return time==='1400'?Response.json({response:{header:{resultCode:'03'}}}):forecastPage(weatherItems(url));},clock.Clock);
 const r=await api.request('weather',weatherQuery);assert.equal(r.status,200);const body=await r.json();assert.deepEqual(times,['1400','1100']);assert.equal(body.meta.usedPreviousPublication,true);assert.equal(body.meta.requestedPublication.baseTime,'1400');assert.equal(body.data.baseTime,'1100');assert.equal(body.data.fcstTime,'1500');
});
test('weather rejects mismatched grid/base and invalid probabilities instead of fabricating values',async()=>{
 const clock=fixedClock('2026-11-19T14:45:00+09:00');
 for(const mutate of [items=>{items[0].nx=60;},items=>{items[0].baseTime='1100';},items=>{items[1].fcstValue='101';},items=>{items[0].fcstValue='-999';},items=>{items[0].fcstValue=' ';}]){
  const api=backend(credentials,async url=>{const items=weatherItems(url);mutate(items);return forecastPage(items);},clock.Clock);
  const r=await api.request('weather',weatherQuery);assert.equal(r.status,502);assert.equal('data' in await r.json(),false);
 }
});
test('weather does not replace past-only forecasts or incomplete pages with fake or older values',async()=>{
 const clock=fixedClock('2026-11-19T14:45:00+09:00');
 const old=backend(credentials,async url=>forecastPage(weatherItems(url,undefined,'20261119','1400')),clock.Clock);assert.equal((await old.request('weather',weatherQuery)).status,404);
 let calls=0;
 const partial=backend(credentials,async url=>{calls++;return url.searchParams.get('pageNo')==='1'?forecastPage(Array.from({length:1000},()=>weatherItems(url,{TMP:'18'})[0]),1001):Response.json({response:{header:{resultCode:'03'}}});},clock.Clock);
 const r=await partial.request('weather',weatherQuery);assert.equal(r.status,502);assert.equal((await r.json()).error.code,'KMA_INCOMPLETE_DATA');assert.equal(calls,2);
});
test('weather cache reselects the upcoming forecast after an hour changes instead of replaying an obsolete selection',async()=>{
 let calls=0;const clock=fixedClock('2026-11-19T14:59:00+09:00');
 const api=backend(credentials,async url=>{calls++;return forecastPage([...weatherItems(url,undefined,'20261119','1500'),...weatherItems(url,{TMP:'17',POP:'70'},'20261119','1600')]);},clock.Clock);
 assert.equal((await(await api.request('weather',weatherQuery)).json()).data.fcstTime,'1500');clock.set('2026-11-19T15:01:00+09:00');
 const body=await(await api.request('weather',weatherQuery)).json();assert.equal(body.data.fcstTime,'1600');assert.equal(body.meta.cached,true);assert.equal(calls,1);
});
test('weather preserves midnight forecast date independently of publication date',async()=>{
 const clock=fixedClock('2026-11-19T23:45:00+09:00');
 const api=backend(credentials,async url=>forecastPage(weatherItems(url,{TMP:'0',POP:'0'},'20261120','0000')),clock.Clock);
 const r=await api.request('weather',weatherQuery);assert.equal(r.status,200);const body=await r.json();assert.equal(body.data.baseDate,'20261119');assert.equal(body.data.fcstDate,'20261120');assert.equal(body.data.temperatureC,0);assert.equal(body.data.precipitationProbability,0);assert.equal(body.data.forecastAt,'2026-11-20T00:00:00+09:00');
});
test('weather XML authorization and quota errors are sanitized and not retried as older forecasts',async()=>{
 const clock=fixedClock('2026-11-19T14:45:00+09:00');
 for(const [code,status] of [['30',502],['22',503]]){
  let calls=0;
  const api=backend(credentials,async()=>{calls++;return new Response(`<error><returnReasonCode>${code}</returnReasonCode><message>${credentials.DATA_GO_KR_SERVICE_KEY}</message></error>`);},clock.Clock);
  const r=await api.request('weather',weatherQuery);assert.equal(r.status,status);assert.equal(calls,1);assert(!(await r.text()).includes(credentials.DATA_GO_KR_SERVICE_KEY));
 }
});

test('place search distinguishes authentication, permission, quota and successful empty responses',async()=>{
 for(const [status,code,expected] of [[401,'KAKAO_AUTH_FAILED',502],[403,'KAKAO_PERMISSION_DENIED',502],[429,'KAKAO_QUOTA_EXCEEDED',503]]){
  const api=backend(credentials,async()=>Response.json({message:credentials.KAKAO_REST_API_KEY},{status}));
  const response=await api.request('places','?query=여의도');assert.equal(response.status,expected);const data=await response.json();assert.equal(data.error.code,code);assert(!JSON.stringify(data).includes(credentials.KAKAO_REST_API_KEY));assert.equal('data' in data,false);
 }
 const api=backend(credentials,async()=>Response.json({documents:[],meta:{is_end:true}}));
 const r=await api.request('places','?query=없는장소');assert.equal(r.status,200);assert.equal((await r.json()).data.length,0);
});
