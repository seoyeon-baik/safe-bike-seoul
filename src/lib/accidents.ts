import type { BicycleRoute, RoutePoint } from './bicycle-routes';

export const ACCIDENT_SOURCE_URL = 'https://opendata.koroad.or.kr/api/selectBicycleDataSet.do';
export const LATEST_ACCIDENT_YEAR = 2025;
export const ACCIDENT_YEAR_CHECKED_AT = '2026-11-19';
export const ACCIDENT_HISTORY_NOTICE = '과거 사고 통계입니다. 현재 사고 발생·실시간 위험도를 나타내지 않으며, 표시되지 않은 곳이 안전하다는 의미는 아닙니다.';
export type AccidentZone = {
  id: string; name: string; district: string; year: number; lat: number; lng: number;
  accidents: number; casualties: number; deaths: number; seriousInjuries: number;
  // polygons -> rings (outer, then holes) -> WGS84 points, all from geom_json.
  polygons: RoutePoint[][][];
};
export type AccidentResponse = {
  data: AccidentZone[];
  meta: { source: 'koroad'; isDemo: false; year: number; latestDocumentedYear: number; yearCheckedAt: string; fetchedAt: string; total: number; skipped: number; missingGeometry: number; cached: boolean; notice: string; sourceUrl: string };
};
export type AssessedAccident = AccidentZone & { routeDistanceMeters: number | null; nearRoute: boolean | null; distanceBasis: 'area' | 'center' };
type XY = { x: number; y: number };
const dot = (a: XY, b: XY) => a.x*b.x + a.y*b.y;
const sub = (a: XY, b: XY) => ({ x: a.x-b.x, y: a.y-b.y });
const cross = (a: XY, b: XY) => a.x*b.y-a.y*b.x;
function pointDistance(p: XY, a: XY, b: XY) {
  const ab=sub(b,a), length=dot(ab,ab);
  const t=length===0?0:Math.max(0,Math.min(1,dot(sub(p,a),ab)/length));
  return Math.hypot(p.x-a.x-t*ab.x,p.y-a.y-t*ab.y);
}
function segmentDistance(a: XY,b: XY,c: XY,d: XY) {
  const ab=sub(b,a),cd=sub(d,c),den=cross(ab,cd);
  if(Math.abs(den)>1e-9){const ac=sub(c,a),t=cross(ac,cd)/den,u=cross(ac,ab)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return 0;}
  return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
function inRing(point: XY, ring: XY[]) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
// Local planar approximation in meters, suitable for Seoul proximity display.
// Keep every API route step separate; never measure across a gap between steps.
export function routeDistance(zone: AccidentZone, route: BicycleRoute): number | null {
  const rad=Math.PI/180,scale=6371000*rad,cos=Math.cos(zone.lat*rad);
  const project=(p: RoutePoint):XY=>({x:(p.lng-zone.lng)*scale*cos,y:(p.lat-zone.lat)*scale});
  const polygons=zone.polygons.map(p=>p.map(r=>r.map(project)));
  const center={x:0,y:0};let best=Infinity;
  for(const segment of route.segments){
    for(let i=1;i<segment.length;i++){
      const a=project(segment[i-1]),b=project(segment[i]);
      if(!polygons.length){best=Math.min(best,pointDistance(center,a,b));continue;}
      for(const polygon of polygons){
        const contains=(p:XY)=>inRing(p,polygon[0])&&!polygon.slice(1).some(hole=>inRing(p,hole));
        if(contains(a)||contains(b))return 0;
        for(const ring of polygon)for(let j=1;j<ring.length;j++){
          best=Math.min(best,segmentDistance(a,b,ring[j-1],ring[j]));if(best===0)return 0;
        }
      }
    }
  }
  return Number.isFinite(best)?best:null;
}
export function assessAccidents(zones: AccidentZone[], route: BicycleRoute | undefined, threshold: number): AssessedAccident[] {
  return zones.map(zone=>{
    const distance=route?routeDistance(zone,route):null;
    return {...zone,routeDistanceMeters:distance===null?null:Math.round(distance),nearRoute:distance===null?null:distance<=threshold,distanceBasis:zone.polygons.length?'area':'center'};
  });
}
