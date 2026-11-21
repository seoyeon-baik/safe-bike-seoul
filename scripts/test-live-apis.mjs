import fs from 'node:fs';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const results=[],base=(process.env.TEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/,'');
const target=new URL(base);
if(target.protocol!=='https:' && !(target.protocol==='http:' && ['localhost','127.0.0.1'].includes(target.hostname))) throw Error('TEST_BASE_URL은 HTTPS 또는 로컬 주소여야 합니다.');
const blocked=['API_NOT_CONFIGURED','KMA_NOT_CONFIGURED','TAAS_NOT_CONFIGURED','KAKAO_ROUTING_NOT_CONFIGURED','KAKAO_PERMISSION_DENIED','KAKAO_AUTH_FAILED','KMA_AUTH_FAILED','TAAS_AUTH_FAILED'];
async function check(name,path,validate,expected=200){
 try{
  const r=await fetch(base+path,{signal:AbortSignal.timeout(80000),redirect:'error'});
  let data;try{data=await r.json();}catch{}
  if(r.status!==expected){const code=/^[A-Z_]+$/.test(data?.error?.code??'')?data.error.code:'HTTP_ERROR';results.push({name,status:blocked.includes(code)?'blocked':'failed',httpStatus:r.status,errorCode:code});return null;}
  validate(data);results.push({name,status:'passed',httpStatus:r.status,...(Array.isArray(data?.data)?{count:data.data.length}:{}),...(data?.meta?.source?{source:data.meta.source}:{})});return data;
 }catch{results.push({name,status:'failed',errorCode:'NETWORK_TIMEOUT_OR_CONTRACT_ERROR'});return null;}
}
function real(d,source){assert.equal(d.meta.source,source);assert.equal(d.meta.isDemo,false);}
const [stations]=await Promise.all([
 check('stations-nearest','/api/stations?lat=37.5271&lng=126.9328&limit=5',d=>{real(d,'seoul');assert(d.data.every((s,i)=>Number.isFinite(s.lat)&&Number.isFinite(s.lng)&&s.bikes>=0&&(i===0||d.data[i-1].distanceMeters<=s.distanceMeters)));}),
 check('places','/api/places?query='+encodeURIComponent('여의나루'),d=>{real(d,'kakao');assert(Array.isArray(d.data));}),
 check('accidents-2025','/api/accidents?year=2025',d=>{real(d,'koroad');assert.equal(d.meta.year,2025);assert(d.data.every(z=>z.year===2025&&Number.isFinite(z.lat)&&Array.isArray(z.polygons)));}),
 check('weather','/api/weather?lat=37.5271&lng=126.9328',d=>{real(d,'kma');assert(Number.isFinite(d.data.temperatureC));assert(d.data.precipitationProbability>=0&&d.data.precipitationProbability<=100);assert(Date.parse(d.data.forecastAt)>=Date.parse(d.data.publishedAt));assert.equal(d.meta.grid.nx,59);assert.equal(d.meta.grid.ny,126);})
]);
await Promise.all([
 check('station-empty','/api/stations?query=__QA_NO_SUCH_STATION__',d=>{real(d,'seoul');assert.equal(d.data.length,0);}),
 check('station-available','/api/stations?availableOnly=1&limit=10',d=>{real(d,'seoul');assert(d.data.every(s=>s.bikes>0));}),
 check('station-invalid-radius','/api/stations?radius=0',d=>assert(d.error),400),
 check('weather-invalid-coordinate','/api/weather?lat=NaN&lng=126',d=>assert(d.error),400),
 check('accident-invalid-year','/api/accidents?year=2026',d=>assert(d.error),400)
]);
if(stations?.data?.length){
 await check('bicycle-routes','/api/routes?'+new URLSearchParams({stationId:stations.data[0].id,endLat:'37.5103',endLng:'126.9959'}),d=>{real(d,'kakao');assert.deepEqual([...new Set(d.data.map(r=>r.mode))].sort(),['BIKE_ONLY','SHORTEST']);assert(d.data.every(r=>r.segments.length&&r.segments.every(s=>s.length>=2)));});
}else results.push({name:'bicycle-routes',status:'blocked',errorCode:'NO_ACTUAL_STATION'});
for(const origin of (process.env.TEST_BASE_URL ? [target.origin] : ['http://localhost:3000','http://127.0.0.1:3000'])){
 const key=process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY?.trim();
 if(!key){results.push({name:'map-sdk '+origin,status:'blocked',errorCode:'SDK_KEY_MISSING'});continue;}
 try{
  const url=new URL('https://dapi.kakao.com/v2/maps/sdk.js');url.search=new URLSearchParams({appkey:key,autoload:'false'}).toString();
  const r=await fetch(url,{headers:{Origin:origin,Referer:origin+'/'},redirect:'error',signal:AbortSignal.timeout(10000)});const text=await r.text();
  const ok=r.ok&&text.includes('kakao');results.push({name:'map-sdk '+origin,status:ok?'passed':[401,403].includes(r.status)?'blocked':'failed',httpStatus:r.status,browserRenderVerified:false,...(!ok?{errorCode:'SDK_AUTH_DOMAIN_OR_SERVICE_ERROR'}:{})});
 }catch{results.push({name:'map-sdk '+origin,status:'failed',errorCode:'NETWORK_OR_TIMEOUT'});}
}
const report={checkedAt:new Date().toISOString(),results,summary:Object.fromEntries(['passed','blocked','failed'].map(status=>[status,results.filter(r=>r.status===status).length])),browserVerification:'Not performed: this script checks API contracts, not browser/mobile rendering.'};
fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/live-api-results.json',JSON.stringify(report,null,2)+'\n');
for(const result of results)console.log(JSON.stringify(result));
console.log(JSON.stringify({summary:report.summary,report:'test-results/live-api-results.json'}));
if(report.summary.failed||report.summary.blocked)process.exitCode=1;
