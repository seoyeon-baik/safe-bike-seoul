import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const nativeRequire=createRequire(import.meta.url);
const cache=new Map();
function load(filename){
 filename=path.resolve(filename);
 if(cache.has(filename))return cache.get(filename).exports;
 const module={exports:{}};cache.set(filename,module);
 const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const require=spec=>{
  if(spec.startsWith('react'))return nativeRequire(spec);
  const base=spec.startsWith('@/')?path.resolve('src',spec.slice(2)):path.resolve(path.dirname(filename),spec);
  return load(fs.existsSync(base+'.tsx')?base+'.tsx':base+'.ts');
 };
 vm.runInNewContext(js,{module,exports:module.exports,require,Date,Intl,Map,Set,Error},{filename});
 return module.exports;
}
const {compareRoutes}=load('src/lib/route-comparison.ts');
const route=(mode,segments)=>({mode,segments,distanceMeters:mode==='BIKE_ONLY'?2800:2300,durationSeconds:mode==='BIKE_ONLY'?600:540});
const routes=[route('BIKE_ONLY',[[{lat:37.53,lng:126.94},{lat:37.53,lng:126.96}]]),route('SHORTEST',[[{lat:37.52,lng:126.94},{lat:37.54,lng:126.94}]])];
const zone=(id,lat,lng)=>({id,name:id,year:2025,district:'서울',lat,lng,accidents:1000,casualties:10,deaths:0,seriousInjuries:1,polygons:[]});
const shared=zone('shared',37.53,126.9401),east=zone('east',37.53,126.96),far=zone('far',37.56,127.1);
const baseProps={activeMode:'BIKE_ONLY',onSelect(){},threshold:200,onThreshold(){},year:2025,routesAt:'2026-11-20T10:00:00+09:00',accidentsAt:'2026-11-20T09:00:00+09:00',accidentLoading:false,routeLoading:false,skipped:0};
const Comparison=load('src/components/route-comparison.tsx').default;
const render=props=>renderToStaticMarkup(React.createElement(Comparison,{...baseProps,...props}));

test('each route gets its own unique hotspot count, independent of the number of accidents',()=>{
 const rows=compareRoutes(routes,[shared,east,east,far],200);
 assert.equal(rows[0].nearbyCount,2);assert.equal(rows[1].nearbyCount,1);
 assert.equal(rows[0].centerBasedNearbyCount,2);assert.equal(rows[1].centerBasedNearbyCount,1);
 assert.equal(rows[0].route.distanceMeters,2800);assert.equal(rows[1].route.distanceMeters,2300);
 assert.equal(rows[0].mode,'BIKE_ONLY');assert.equal(rows[1].mode,'SHORTEST');
});
test('missing accident data and missing routes are unknown, while a successful empty result is zero',()=>{
 assert(compareRoutes(routes,null,200).every(row=>row.nearbyCount===null));
 assert(compareRoutes([],[],200).every(row=>row.nearbyCount===null));
 assert(compareRoutes(routes,[],200).every(row=>row.nearbyCount===0));
 const invalid=[{...routes[0],segments:[]}];assert.equal(compareRoutes(invalid,[],200)[0].nearbyCount,null);
});
test('both routes share the proximity threshold and no route is ranked by the computed count',()=>{
 const tight=compareRoutes(routes,[shared,east],5),wide=compareRoutes(routes,[shared,east],200);
 assert.equal(tight[1].nearbyCount,0);assert.equal(wide[1].nearbyCount,1);
 assert.equal(wide[0].mode,'BIKE_ONLY');assert.equal(wide[1].mode,'SHORTEST');
});
test('comparison renders distances, hotspot counts, source links and distinct collection times',()=>{
 const html=render({rows:compareRoutes(routes,[shared,east,far],200),skipped:2});
 for(const label of ['2.8 km','2.3 km','10분','9분','2025년','같은 출발 대여소','카카오맵','한국도로교통공단','좌표 오류로 제외된 지역 2곳','안전성 점수나 추천 순위가 아닙니다'])assert(html.includes(label),label);
 assert(html.includes('href="https://developers.kakao.com/'));
 assert(html.includes('href="https://opendata.koroad.or.kr/'));
 assert(html.includes('10:00'));assert(html.includes('09:00'));
 assert(html.includes('중심점 기준 2곳 포함'));
});
test('comparison never displays failed or unloaded accident data as zero hotspots',()=>{
 const html=render({rows:compareRoutes(routes,null,200),accidentError:'사고자료 연결 실패'});
 assert(html.includes('사고자료 조회 실패'));assert(!html.includes('<strong>0'));
 const empty=render({rows:compareRoutes(routes,[],200)});assert(empty.includes('<strong>0<small> 곳'));
 const noRoute=render({rows:compareRoutes([],[],200)});assert(noRoute.includes('경로 미조회'));assert(!noRoute.includes('<strong>0'));
});
test('overview preserves source-specific forecast, publication and collection times without claiming a measurement',()=>{
 const Overview=load('src/components/ride-overview.tsx').default;
 const sources=[
  {label:'따릉이',source:'서울 열린데이터광장',href:'https://data.seoul.go.kr/',loading:false,available:true,detail:'주변 0곳',times:[{label:'수집',value:'2026-11-20T10:00:00+09:00'}]},
  {label:'자전거 경로',source:'카카오맵',href:'https://developers.kakao.com/',loading:false,available:false,error:'권한 오류',detail:'',times:[]},
  {label:'사고다발지역',source:'한국도로교통공단·TAAS',href:'https://opendata.koroad.or.kr/',loading:false,available:true,detail:'2025년 과거 통계',times:[{label:'수집',value:'2026-11-20T09:00:00+09:00'}]},
  {label:'출발지 날씨',source:'기상청',href:'https://www.data.go.kr/',loading:false,available:true,detail:'0°C · 강수확률 0%',times:[{label:'발표',value:'2026-11-20T08:00:00+09:00'},{label:'예보',value:'2026-11-20T11:00:00+09:00'},{label:'수집',value:'2026-11-20T10:01:00+09:00'}]},
 ];
 const html=renderToStaticMarkup(React.createElement(Overview,{origin:'실제 대여소',destination:'목적지',sources}));
 for(const label of ['따릉이','자전거 경로','사고다발지역','출발지 날씨','0°C','강수확률 0%','조회 실패','실제 측정·사고 발생시각이 아닙니다'])assert(html.includes(label),label);
 for(const iso of ['2026-11-20T08:00:00+09:00','2026-11-20T11:00:00+09:00','2026-11-20T10:01:00+09:00'])assert(html.includes(`dateTime="${iso}"`));
});
