'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import BikeMap from '@/components/bike-map';
import PlaceSearch from '@/components/place-search';
import WeatherCard from '@/components/weather-card';
import RideOverview, { type InformationSource } from '@/components/ride-overview';
import RouteComparison from '@/components/route-comparison';
import { compareRoutes } from '@/lib/route-comparison';
import { useWeather } from '@/hooks/use-weather';
import { formatWeatherTime, WEATHER_SOURCE_URL } from '@/lib/weather';
import { useAccidents } from '@/hooks/use-accidents';
import { ACCIDENT_HISTORY_NOTICE, ACCIDENT_SOURCE_URL, ACCIDENT_YEAR_CHECKED_AT, LATEST_ACCIDENT_YEAR } from '@/lib/accidents';
import { useStations } from '@/hooks/use-stations';
import { formatDistance, type NearbyStation } from '@/lib/stations';
import { useBicycleRoutes } from '@/hooks/use-bicycle-routes';
import { modeLabel, type RouteMode } from '@/lib/bicycle-routes';
import { places, type Place } from '@/lib/demo-data';

export default function Home() {
  const [draftFrom, setDraftFrom] = useState(places[0]);
  const [draftTo, setDraftTo] = useState(places[1]);
  const [accidentYear, setAccidentYear] = useState(LATEST_ACCIDENT_YEAR);
  const [proximity, setProximity] = useState(200);
  const [onlyNearRoute, setOnlyNearRoute] = useState(false);
  const [selectedAccident, setSelectedAccident] = useState('');
  const accidentData = useAccidents(accidentYear);
  const [activeMode, setActiveMode] = useState<RouteMode>('BIKE_ONLY');
  const [showStations, setShowStations] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [chosenStation, setSelectedStation] = useState<NearbyStation | null>(null);
  const [radius, setRadius] = useState(2000);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [stationQuery, setStationQuery] = useState('');
  const stationData = useStations(draftFrom, radius, availableOnly, stationQuery);
  const stations = stationData.stations;
  const selectedStation = chosenStation ?? stations.find(s => s.bikes > 0) ?? null;
  const selected = selectedStation?.id ?? '';
  const weatherOrigin = selectedStation ?? draftFrom;
  const weather = useWeather(weatherOrigin);
  const routing = useBicycleRoutes(selectedStation, draftTo);
  const selectStation = useCallback((id: string) => { setSelectedStation(stations.find(s => s.id === id) ?? null); }, [stations]);
  const selectOrigin = (place: Place) => { setDraftFrom(place); setSelectedStation(null); };
  const station = stations.find(s => s.id === selected);
  const stationTime = stationData.snapshot ? formatWeatherTime(stationData.snapshot.meta.fetchedAt) : null;
  const activeRoute = routing.routes.find(r => r.mode === activeMode);
  const comparisons = useMemo(() => compareRoutes(routing.routes, accidentData.meta ? accidentData.zones : null, proximity), [routing.routes, accidentData.meta, accidentData.zones, proximity]);
  const assessedAccidents = comparisons.find(row => row.mode === activeMode)?.assessments ?? [];
  const mapAccidents = activeRoute && accidentData.meta ? assessedAccidents : accidentData.zones.map(zone => ({...zone, routeDistanceMeters:null, nearRoute:null, distanceBasis:zone.polygons.length?'area' as const:'center' as const}));
  const nearbyAccidents = assessedAccidents.filter(z => z.nearRoute === true).sort((a,b) => (a.routeDistanceMeters ?? 0) - (b.routeDistanceMeters ?? 0));
  const visibleAccidents = onlyNearRoute && activeRoute ? nearbyAccidents : mapAccidents;
  const accident = visibleAccidents.find(z => z.id === selectedAccident);
  const sources: InformationSource[] = [
    {label:'따릉이',source:'서울 열린데이터광장',href:'https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do',loading:stationData.loading,error:stationData.error,available:Boolean(stationData.snapshot),detail:stationData.snapshot?`주변 ${stationData.snapshot.meta.matched}곳${station ? ` · 선택 대여소 ${station.bikes}대` : ''}`:'출발지 주변 대여소 조회 대기',times:stationData.snapshot?[{label:'수집',value:stationData.snapshot.meta.fetchedAt}]:[]},
    {label:'자전거 경로',source:'카카오맵',href:'https://developers.kakao.com/docs/ko/kakaomap/rest-api#routing-bicycle',loading:routing.loading,error:routing.error,available:Boolean(routing.response),detail:routing.response?'두 가지 공식 경로 · 같은 출발/목적지':'대여소 선택 후 경로 조회',times:routing.response?[{label:'수집',value:routing.response.meta.fetchedAt}]:[]},
    {label:'사고다발지역',source:'한국도로교통공단·TAAS',href:ACCIDENT_SOURCE_URL,loading:accidentData.loading,error:accidentData.error,available:Boolean(accidentData.meta),detail:`${accidentYear}년 과거 통계${accidentData.meta ? ` · 서울 ${accidentData.meta.total}곳` : ''}`,times:accidentData.meta?[{label:'수집',value:accidentData.meta.fetchedAt}]:[]},
    {label:'출발지 날씨',source:'기상청',href:WEATHER_SOURCE_URL,loading:weather.loading,error:weather.error,available:Boolean(weather.response),detail:weather.response?`${weather.response.data.temperatureC}°C · 강수확률 ${weather.response.data.precipitationProbability}%`:weatherOrigin.name,times:weather.response?[{label:'발표',value:weather.response.data.publishedAt},{label:'예보',value:weather.response.data.forecastAt},{label:'수집',value:weather.response.meta.fetchedAt}]:[]},
  ];


  return <>
    <header className="header"><Link className="brand" href="/" aria-label="Safe Bike Seoul 홈"><span className="brand-icon">🚲</span><span>safe bike<span className="brand-city">SEOUL</span></span></Link><nav aria-label="주 메뉴"><a href="#overview" className="active">통합 현황</a><a href="#comparison">경로 비교</a><a href="#stations">따릉이 대여소</a><a href="#safety">안전 정보</a></nav><span className="demo-badge">라이딩 정보 통합</span></header>
    <main className="workspace">
      <aside className="planner" id="planner">
        <div className="eyebrow">YOUR NEXT RIDE</div><h1>오늘은 어디까지<br/>달려볼까요?</h1><p className="intro">서울의 풍경을 따라, 나만의 두 바퀴 여행.</p>
        <form onSubmit={e => { e.preventDefault(); void routing.requestRoutes(); }}>
          <div className="search-box"><PlaceSearch label="출발" value={draftFrom} onSelect={selectOrigin}/><button type="button" className="swap" aria-label="출발지와 목적지 바꾸기" onClick={() => {selectOrigin(draftTo);setDraftTo(draftFrom);}}>⇅</button><PlaceSearch label="도착" value={draftTo} onSelect={setDraftTo}/></div>
          <button className="primary search-submit" type="submit" disabled={!selectedStation || routing.loading}>{routing.loading ? '공식 경로 조회 중…' : '선택한 대여소에서 경로 조회'} <span>⌕</span></button>
        </form>
        <div className="route-selection"><strong>라이딩 출발 대여소</strong><p>{selectedStation?.name ?? (stationData.loading ? '주변 대여소를 불러오는 중입니다…' : '대여 가능한 주변 대여소가 없습니다. 아래 조회 상태와 검색 조건을 확인하세요.')}</p>{stations.length > 0 && <label>출발 따릉이 대여소<select aria-label="출발 따릉이 대여소" value={selected} onChange={e => selectStation(e.target.value)}>{!selected && <option value="" disabled>대여소를 선택하세요</option>}{stations.map(s => <option key={s.id} value={s.id}>{s.name} · {formatDistance(s.distanceMeters)} · {s.bikes}대</option>)}</select></label>}{!chosenStation && selectedStation && <p>가장 가까운 대여 가능 대여소를 기본 선택했습니다. 다른 대여소로 변경할 수 있습니다.</p>}<span>목적지: {draftTo.name}</span></div>
        <p className="form-notice" role="status">{routing.loading ? '자전거도로 우선·최단 경로를 카카오에서 조회 중입니다.' : routing.error || (routing.routes.length ? '카카오 API가 반환한 실제 경로입니다.' : '아직 조회된 경로가 없습니다. 조회 실패 시 임의의 경로를 만들지 않습니다.')}</p>
        <div className="planner-scope"><strong>비교 기준</strong><p>선택한 대여소에서 같은 목적지까지 두 경로를 비교합니다. 과거 사고지역 수만으로 실제 안전성을 판단하지 않습니다.</p><a href="#comparison">거리와 주변 지역 수 확인</a></div>
        <WeatherCard origin={weatherOrigin} isStation={Boolean(selectedStation)} weather={weather}/>
      </aside>
      <section className="map-column" aria-label="라이딩 지도와 주변 정보">
        <RideOverview origin={selectedStation?.name ?? '출발 대여소 미선택'} destination={draftTo.name} sources={sources}/>
        <RouteComparison rows={comparisons} activeMode={activeMode} onSelect={setActiveMode} threshold={proximity} onThreshold={setProximity} year={accidentYear} routesAt={routing.response?.meta.fetchedAt} accidentsAt={accidentData.meta?.fetchedAt} accidentLoading={accidentData.loading} accidentError={accidentData.error} routeLoading={routing.loading} routeError={routing.error} skipped={accidentData.meta?.skipped ?? 0}/>
        <div className="map-panel"><div className="map-toolbar"><div className="map-switches"><button onClick={() => setShowStations(v => !v)} aria-pressed={showStations} className={showStations?'on':''}><span className="green-dot"/>따릉이 대여소</button><button onClick={() => setShowIncidents(v => !v)} aria-pressed={showIncidents} className={showIncidents?'on':''}><span className="amber-dot"/>과거 사고다발지역</button></div><span className="tag">따릉이·공식 경로·과거 사고정보</span></div><BikeMap destination={draftTo} routeOrigin={routing.response?.meta.origin ?? selectedStation} routes={routing.routes} activeMode={activeMode} showStations={showStations} showIncidents={showIncidents} selected={selected} onStation={selectStation} stations={stations} stationOrigin={draftFrom} accidents={visibleAccidents} selectedAccident={selectedAccident} onAccident={setSelectedAccident} stationLoading={stationData.loading} stationSearchKey={JSON.stringify([radius,availableOnly,stationQuery])}/><div className="map-bottom"><div><span className="route-icon">⌁</span><strong>{selectedStation?.name ?? '출발 대여소 미선택'} <span>—</span> {draftTo.name}</strong></div><span>{activeRoute ? `${formatDistance(activeRoute.distanceMeters)} · 약 ${Math.ceil(activeRoute.durationSeconds / 60)}분` : '조회된 경로 없음'}</span></div></div>
        <div className="info-grid">
          <section className="info-card stations-card" id="stations" aria-busy={stationData.loading}>
            <div className="section-heading"><h2>출발지 주변 따릉이</h2><span className="tag live-tag">서울시 실제 데이터</span></div>
            <p className="card-description"><strong>{draftFrom.name}</strong> 기준 · 직선거리순 (도보 거리와 다름)</p>
            <div className="station-filters">
              <label>검색 반경<select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value={500}>500 m</option><option value={1000}>1 km</option><option value={2000}>2 km</option><option value={5000}>5 km</option></select></label>
              <label className="available-filter"><input type="checkbox" checked={availableOnly} onChange={e => setAvailableOnly(e.target.checked)}/>대여 가능만</label>
            </div>
            <label className="station-name-search">대여소 이름<input value={stationQuery} onChange={e => setStationQuery(e.target.value)} maxLength={80} placeholder="주변 대여소 이름으로 검색"/></label>
            <div className="station-status" aria-live="polite">
              {stationData.loading && <p>서울시 대여소 정보를 불러오는 중입니다…</p>}
              {stationData.error && <p role="alert">{stationData.error}</p>}
              {!stationData.loading && !stationData.error && stations.length === 0 && <p>검색 조건에 맞는 대여소가 없습니다. 반경을 넓히거나 필터를 변경해 보세요.</p>}
              {stationData.snapshot && <p>반경 내 {stationData.snapshot.meta.matched}개 중 가까운 {stations.length}개 · {stationTime} 서버 수집 (KST)</p>}
              <button className="station-refresh" type="button" onClick={stationData.refresh} disabled={stationData.loading}>다시 조회</button>
            </div>
            <div className="station-list">{stations.map(s => <button className={`station-row ${selected===s.id?'current':''}`} key={s.id} onClick={() => selectStation(s.id)} aria-pressed={selected===s.id}><span className="station-symbol">🚲</span><span><strong>{s.name}</strong><small>{formatDistance(s.distanceMeters)} · {s.id}</small></span><b className={s.bikes===0?'zero':''}>{s.bikes}<small> 대</small></b></button>)}</div>
            {station && <div className="station-detail" aria-live="polite"><strong>{station.name}</strong><span>출발지에서 직선 {formatDistance(station.distanceMeters)}</span><span>대여 가능 {station.bikes}대 / 거치대 {station.slots}개</span><span>위도 {station.lat.toFixed(6)} · 경도 {station.lng.toFixed(6)}</span><button type="button" onClick={() => setSelectedStation(station)}>이 대여소에서 라이딩 시작</button></div>}
            <p className="station-source">출처: <a href="https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do" target="_blank" rel="noreferrer">서울 열린데이터광장 · bikeList</a><br/>개별 측정시각은 제공되지 않습니다. 60초마다 조회하며 수량은 달라질 수 있습니다.</p>
          </section>
          <div className="right-cards"><section className="info-card accident-card" id="safety" aria-busy={accidentData.loading}>
            <div className="section-heading"><h2>과거 자전거 사고다발지역</h2><span className="tag amber">{accidentYear}년 기준</span></div>
            <p className="history-notice">{ACCIDENT_HISTORY_NOTICE}</p>
            <div className="accident-controls"><label>사고 기준연도<select value={accidentYear} onChange={e => {setAccidentYear(Number(e.target.value));setSelectedAccident('');}}>{Array.from({length:LATEST_ACCIDENT_YEAR-2012+1},(_,i)=>LATEST_ACCIDENT_YEAR-i).map(year=><option key={year} value={year}>{year}년</option>)}</select></label><button className="station-refresh" type="button" onClick={accidentData.refresh} disabled={accidentData.loading}>다시 조회</button></div>
            <div className="accident-controls"><label>경로 근접 기준<select value={proximity} onChange={e=>setProximity(Number(e.target.value))}><option value={100}>100 m 이내</option><option value={200}>200 m 이내</option><option value={500}>500 m 이내</option></select></label><label className="near-filter"><input type="checkbox" checked={onlyNearRoute} disabled={!activeRoute} onChange={e=>setOnlyNearRoute(e.target.checked)}/>근접 지역만</label></div>
            <div className="accident-status" aria-live="polite">
              {accidentData.loading && <p>서울 25개 구의 과거 사고정보를 조회 중입니다…</p>}
              {accidentData.error && <p role="alert">{accidentData.error}</p>}
              {accidentData.meta && <p>{accidentData.meta.year}년 서울 {accidentData.meta.total}곳 · {activeRoute ? `${modeLabel(activeMode)}에서 ${proximity}m 이내 ${nearbyAccidents.length}곳` : '공식 경로가 없어 근접 여부를 아직 판단하지 않았습니다.'}</p>}
              {accidentData.meta && !visibleAccidents.length && <p>{onlyNearRoute&&activeRoute ? '현재 근접 기준에 해당하는 과거 사고다발지역이 없습니다.' : '선택 연도의 조회 결과가 없습니다.'}</p>}
            </div>
            <div className="accident-list">{visibleAccidents.map(z=><button key={z.id} type="button" className={`accident-row ${z.nearRoute?'near-route':''} ${z.id===selectedAccident?'current':''}`} onClick={()=>setSelectedAccident(z.id)} aria-pressed={z.id===selectedAccident}><span className="accident-symbol">!</span><span><strong>{z.name}</strong><small>{z.year}년 사고 {z.accidents}건 · 사망 {z.deaths}명</small><small>{z.routeDistanceMeters===null?'경로 근접 판정 대기':`경로에서 약 ${formatDistance(z.routeDistanceMeters)} · ${z.distanceBasis==='area'?'영역 기준':'중심점 기준'}`}</small></span>{z.nearRoute&&<em>경로 근접</em>}</button>)}</div>
            {accident&&<div className="accident-detail" aria-live="polite"><strong>{accident.name}</strong><p>{accident.year}년 · 사고 {accident.accidents}건 · 사상자 {accident.casualties}명 · 사망 {accident.deaths}명 · 중상 {accident.seriousInjuries}명</p>{!accident.polygons.length&&<p>제공된 영역 좌표가 없어 중심점만 표시합니다.</p>}</div>}
            <p className="small-note">근접 거리는 선택한 공식 경로와 사고영역 사이의 지도상 직선거리 근사값입니다. 영역 좌표가 없으면 중심점을 사용합니다. 도로 연결·방향·실제 통과 여부를 판정하지 않습니다.</p>
            <p className="accident-source">출처: <a href={ACCIDENT_SOURCE_URL} target="_blank" rel="noreferrer">한국도로교통공단 · TAAS 자전거 사고다발지역</a><br/>공식 최신 제공연도 {LATEST_ACCIDENT_YEAR}년 ({ACCIDENT_YEAR_CHECKED_AT} 문서 확인). 인증된 API 수신 여부는 조회 상태를 확인하세요.{accidentData.meta&&<> 서버 조회 {new Date(accidentData.meta.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (사고 발생시각 아님).</>}</p>
          </section><div className="safety-tip"><div className="tip-icon">✓</div><div><strong>좋은 라이딩은 안전에서 시작해요</strong><p>헬멧을 착용하고, 출발 전 브레이크를 확인하세요.</p></div></div></div>
        </div>
        <footer>따릉이: 서울시 bikeList · 자전거 경로: 카카오 공식 API 성공 응답만 표시 · 사고정보: 과거 통계 · 날씨: 기상청 단기예보 · 장소 검색: 카카오 API</footer>
      </section>
    </main>
  </>;
}
