'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { type Place } from '@/lib/demo-data';
import type { NearbyStation } from '@/lib/stations';
import type { AssessedAccident } from '@/lib/accidents';
import { modeLabel, type BicycleRoute, type RouteMode, type RouteOrigin } from '@/lib/bicycle-routes';

type LatLng = object;
type MapInstance = { setBounds: (bounds: object) => void; relayout: () => void; panTo?: (point: LatLng) => void };
type Overlay = { setMap: (map: MapInstance | null) => void };
type Maps = {
  load: (callback: () => void) => void;
  LatLng: new (lat: number, lng: number) => LatLng;
  Map: new (element: HTMLElement, options: { center: LatLng; level: number }) => MapInstance;
  LatLngBounds: new () => { extend: (point: LatLng) => void };
  CustomOverlay: new (options: { position: LatLng; content: HTMLElement; yAnchor?: number; zIndex?: number }) => Overlay;
  Polygon: new (options: { path: LatLng[][]; strokeWeight: number; strokeColor: string; strokeOpacity: number; strokeStyle: string; fillColor: string; fillOpacity: number }) => Overlay;
  Polyline: new (options: { path: LatLng[]; strokeWeight: number; strokeColor: string; strokeOpacity: number; strokeStyle: string }) => Overlay;
};
declare global { interface Window { kakao?: { maps: Maps } } }
type Props = { destination: Place; routeOrigin: RouteOrigin | null; routes: BicycleRoute[]; activeMode: RouteMode; showStations: boolean; showIncidents: boolean; selected: string; onStation: (id: string) => void; stations: NearbyStation[]; stationOrigin: Place; accidents: AssessedAccident[]; selectedAccident: string; onAccident: (id: string) => void; stationLoading?: boolean; stationSearchKey?: string };
const key = process.env.NEXT_PUBLIC_KAKAO_MAP_APP_KEY;

export default function BikeMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const lastBoundsRef = useRef('');
  const lastSelectionRef = useRef('');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const { destination, routeOrigin, routes, activeMode, showStations, showIncidents, selected, onStation, stations, stationOrigin, accidents, selectedAccident, onAccident, stationLoading = false, stationSearchKey = '' } = props;

  useEffect(() => {
    if (!key || ready || failed) return;
    const timeout = window.setTimeout(() => setFailed(true), 12000);
    return () => window.clearTimeout(timeout);
  }, [ready, failed]);

  useEffect(() => {
    if (!sdkLoaded || failed || !host.current || !window.kakao) return;
    const maps = window.kakao.maps;
    const container = host.current;
    let map = mapRef.current;
    if (!map) {
      try { map = new maps.Map(container, { center: new maps.LatLng(stationOrigin.lat, stationOrigin.lng), level: 6 }); mapRef.current = map; }
      catch { const timer=window.setTimeout(()=>setFailed(true),0); return()=>window.clearTimeout(timer); }
    }
    const overlays: Overlay[] = [];
    function badge(lat: number, lng: number, text: string, className: string, onClick?: () => void, label = text) {
      const content = document.createElement(onClick ? 'button' : 'span');
      content.className = `map-pin ${className}`;
      content.textContent = text;
      content.title = label;
      content.setAttribute('aria-label', label);
      if (onClick) { content.setAttribute('type', 'button'); content.addEventListener('click', onClick); }
      const overlay = new maps.CustomOverlay({ position: new maps.LatLng(lat, lng), content, yAnchor: 1, zIndex: className.includes('chosen') || className.includes('accident-selected') ? 10 : 3 });
      overlay.setMap(map); overlays.push(overlay);
    }
    const bounds = new maps.LatLngBounds();
    bounds.extend(new maps.LatLng(destination.lat, destination.lng));
    bounds.extend(new maps.LatLng(stationOrigin.lat, stationOrigin.lng));
    if (routeOrigin) bounds.extend(new maps.LatLng(routeOrigin.lat, routeOrigin.lng));
    // Draw each returned step separately, preserving gaps. No endpoint connectors.
    const ordered = [...routes].sort((a, b) => Number(a.mode === activeMode) - Number(b.mode === activeMode));
    ordered.forEach(route => route.segments.forEach(segment => {
      const path = segment.map(p => new maps.LatLng(p.lat, p.lng));
      path.forEach(point => bounds.extend(point));
      const line = new maps.Polyline({ path, strokeWeight: route.mode === activeMode ? 6 : 3, strokeColor: route.mode === 'BIKE_ONLY' ? '#087e65' : '#576bc6', strokeOpacity: route.mode === activeMode ? .95 : .4, strokeStyle: 'solid' });
      line.setMap(map); overlays.push(line);
    }));
    if (showStations) stations.forEach(s => bounds.extend(new maps.LatLng(s.lat, s.lng)));
    const boundsKey = JSON.stringify([stationOrigin.lat,stationOrigin.lng,destination.lat,destination.lng,routeOrigin?.lat,routeOrigin?.lng,routes.map(r=>r.segments),stationSearchKey]);
    if(!stationLoading&&lastBoundsRef.current!==boundsKey){map.setBounds(bounds);lastBoundsRef.current=boundsKey;}
    const selectionKey=`${selected}:${selectedAccident}`;
    if(lastSelectionRef.current!==selectionKey){
      const focus=selectedAccident&&selectedAccident!==lastSelectionRef.current.split(':')[1]?accidents.find(z=>z.id===selectedAccident):stations.find(s=>s.id===selected);
      if(focus)map.panTo?.(new maps.LatLng(focus.lat,focus.lng));
      lastSelectionRef.current=selectionKey;
    }
    if (routeOrigin) badge(routeOrigin.lat, routeOrigin.lng, '선택한 출발 대여소', 'endpoint');
    badge(destination.lat, destination.lng, '목적지', 'endpoint destination');
    badge(stationOrigin.lat, stationOrigin.lng, '대여소 검색 기준', 'endpoint');
    if (showStations) stations.forEach(s => badge(s.lat, s.lng, `🚲 ${s.bikes}대`, `${s.id === selected ? 'chosen' : ''} ${s.bikes === 0 ? 'empty' : ''}`, () => onStation(s.id), `${s.name}, 대여 가능 ${s.bikes}대`));
    if (showIncidents) accidents.forEach(zone => {
      const color = zone.nearRoute ? '#b84732' : '#bb852e';
      zone.polygons.forEach(polygon => {
        const shape = new maps.Polygon({ path: polygon.map(ring => ring.map(p => new maps.LatLng(p.lat, p.lng))), strokeWeight: zone.nearRoute ? 3 : 1, strokeColor: color, strokeOpacity: .8, strokeStyle: 'solid', fillColor: color, fillOpacity: zone.id === selectedAccident ? .3 : .12 });
        shape.setMap(map); overlays.push(shape);
      });
      badge(zone.lat, zone.lng, `! ${zone.year}년 · ${zone.accidents}건`, `warning ${zone.nearRoute ? 'near-route' : ''} ${zone.id === selectedAccident ? 'accident-selected' : ''}`, () => onAccident(zone.id), `${zone.name}, ${zone.year}년 과거 자전거 사고 ${zone.accidents}건${zone.nearRoute ? ', 선택 경로 근접' : ''}`);
    });
    const observer = new ResizeObserver(() => { map.relayout(); });
    observer.observe(host.current);
    return () => { observer.disconnect(); overlays.forEach(o => o.setMap(null));  };
  }, [sdkLoaded, failed, destination, routeOrigin, routes, activeMode, showStations, showIncidents, selected, onStation, stations, stationOrigin, accidents, selectedAccident, onAccident, stationLoading, stationSearchKey]);

  // This schematic deliberately does not represent a navigable street map.

  return <div className="map-canvas">
    {key && <Script id="kakao-sdk" src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`} onReady={() => { try { window.kakao?.maps.load(() => { setFailed(false); setSdkLoaded(true); setReady(true); }); } catch { setFailed(true); } }} onError={() => setFailed(true)} />}
    <div ref={host} className="kakao-host" aria-label="카카오맵: 서울시 실제 따릉이 대여소와 카카오 공식 자전거 경로" style={{ visibility: ready && !failed ? 'visible' : 'hidden' }} />
    {(!ready || failed) && <div className="schematic">
      <svg viewBox="0 0 1000 650" preserveAspectRatio="none" role="img" aria-label="지도 연결 전 한강 개념도입니다. 실제 경로는 그리지 않습니다.">
        <defs><pattern id="blocks" width="85" height="65" patternTransform="rotate(-18)" patternUnits="userSpaceOnUse"><rect width="85" height="65" fill="#edf0e9"/><rect x="5" y="5" width="71" height="51" rx="6" fill="#e4e9e0"/><path d="M0 0H85V65" fill="none" stroke="#fff" strokeWidth="6"/></pattern></defs>
        <rect width="1000" height="650" fill="url(#blocks)"/>
        <path d="M-100 90C180 65 260 305 540 270S820 420 1120 350" stroke="#c7dfb8" strokeWidth="138" fill="none"/>
        <path d="M-100 90C180 65 260 305 540 270S820 420 1120 350" stroke="#b8dce3" strokeWidth="103" fill="none"/>
        <g stroke="#fcfdf9" strokeWidth="12"><path d="M215 115L270 290"/><path d="M485 210L475 345"/><path d="M690 275L640 419"/><path d="M852 328L806 470"/></g>
        <g fill="#81938a" fontSize="17" fontWeight="600"><text x="120" y="96">마포구</text><text x="252" y="425">영등포구</text><text x="760" y="536">서초구</text><text x="770" y="204">용산구</text><text x="480" y="281" fill="#568d9a" letterSpacing="10">한강</text></g>

      </svg>
      <div className="map-notice"><strong>예시 지도 · 실제 도로와 다름</strong><span>{!key ? '지도 연결 설정 전 미리보기 · 대여소·경로·과거 사고지역은 지도 연결 후 표시됩니다.' : failed ? '카카오맵 로드 실패: 사용 설정, JavaScript 키와 현재 주소의 등록 도메인을 확인하세요.' : '카카오맵을 불러오는 중입니다…'}</span>{failed&&<button type="button" className="station-refresh" onClick={()=>window.location.reload()}>지도 다시 불러오기</button>}</div>
    </div>}
    {ready && !failed && <div className="map-origin-label">대여소 검색 기준: {stationOrigin.name}</div>}
    {showStations && stations.length === 0 && <div className="map-no-stations">표시할 실제 대여소 데이터가 없습니다. 아래 조회 상태를 확인하세요.</div>}
    <div className="map-legend"><span><i className="line-key" style={{background:activeMode==='BIKE_ONLY'?'#087e65':'#576bc6'}}/>{routes.length ? modeLabel(activeMode) : '경로 없음'}</span><span><i className="station-key"/>따릉이</span><span><i className="incident-key"/>과거 사고다발지역</span></div>
    <div className="map-caption">{ready && !failed ? '카카오맵 · 따릉이: 서울시 · 경로: 카카오 · 사고지역: 과거 통계' : 'DEMO MAP · 개념도'}</div>
  </div>;
}
