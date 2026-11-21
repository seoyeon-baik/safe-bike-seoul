'use client';
import type { RouteComparisonRow } from '@/lib/route-comparison';
import { modeLabel, type RouteMode } from '@/lib/bicycle-routes';
import { formatDistance } from '@/lib/stations';
import { formatWeatherTime } from '@/lib/weather';
import { ACCIDENT_SOURCE_URL } from '@/lib/accidents';

type Props = {
  rows: RouteComparisonRow[]; activeMode: RouteMode; onSelect: (mode: RouteMode) => void;
  threshold: number; onThreshold: (meters: number) => void; year: number;
  routesAt?: string; accidentsAt?: string; accidentLoading: boolean; accidentError?: string;
  routeLoading: boolean; routeError?: string; skipped: number;
};
export default function RouteComparison(props: Props) {
  return <section className="comparison-panel" id="comparison" aria-label="자전거 경로별 거리와 과거 사고다발지역 비교">
    <div className="comparison-heading"><div><span className="eyebrow">COMPARE YOUR RIDE</span><h2>두 경로를 같은 기준으로 비교</h2></div><label>주변 범위<select aria-label="경로 비교 근접 기준" value={props.threshold} onChange={e => props.onThreshold(Number(e.target.value))}><option value={100}>100 m 이내</option><option value={200}>200 m 이내</option><option value={500}>500 m 이내</option></select></label></div>
    <div className="comparison-scroll" tabIndex={0} aria-label="경로 비교 표, 좁은 화면에서는 가로로 스크롤"><table><caption>같은 출발 대여소·목적지, {props.year}년 사고자료, 동일한 {props.threshold}m 기준입니다.</caption><thead><tr><th scope="col">경로</th><th scope="col">거리</th><th scope="col">예상 시간</th><th scope="col">주변 사고다발지역</th></tr></thead><tbody>{props.rows.map(row => <tr key={row.mode} className={row.mode === props.activeMode && row.route ? 'active-route' : ''}><th scope="row"><button type="button" className={`comparison-select ${row.mode === 'SHORTEST' ? 'shortest' : ''}`} onClick={() => props.onSelect(row.mode)} disabled={!row.route} aria-pressed={row.mode === props.activeMode && Boolean(row.route)}><i/>{modeLabel(row.mode)}{row.mode === props.activeMode && row.route && <small>지도 선택</small>}</button></th><td>{row.route ? formatDistance(row.route.distanceMeters) : '—'}</td><td>{row.route ? `${Math.ceil(row.route.durationSeconds / 60)}분` : '—'}</td><td>{row.nearbyCount === null ? <span className="comparison-missing">{!row.route ? '경로 미조회' : props.accidentLoading ? '사고자료 조회 중' : props.accidentError ? '사고자료 조회 실패' : '비교 불가'}</span> : <><strong>{row.nearbyCount}<small> 곳</small></strong>{Boolean(row.centerBasedNearbyCount) && <small className="center-count">중심점 기준 {row.centerBasedNearbyCount}곳 포함</small>}</>}</td></tr>)}</tbody></table></div>
    <p className="comparison-status" role="status">{props.routeLoading ? '두 경로를 공식 API에서 조회 중입니다.' : props.routeError || (!props.rows.some(row => row.route) ? '대여소를 선택하고 경로를 조회하면 비교값을 표시합니다.' : props.accidentError || '')}</p>
    <div className="comparison-provenance"><span>경로: <a href="https://developers.kakao.com/docs/ko/kakaomap/rest-api#routing-bicycle" target="_blank" rel="noreferrer">카카오맵</a> · {props.routesAt ? `${formatWeatherTime(props.routesAt)} KST 수집` : '수집시각 미확인'}</span><span>사고지역: <a href={ACCIDENT_SOURCE_URL} target="_blank" rel="noreferrer">한국도로교통공단·TAAS</a> · {props.year}년 기준 · {props.accidentsAt ? `${formatWeatherTime(props.accidentsAt)} KST 수집` : '수집시각 미확인'}</span></div>
    <p className="comparison-caution"><strong>사고지역 수는 안전성 점수나 추천 순위가 아닙니다.</strong> 과거 사고영역과 경로의 지도상 근접 지역 수이며, 실제 통과·현재 위험도·안전을 보장하지 않습니다. 같은 지역이 두 경로에 각각 포함될 수 있고, 지역별 사고건수를 합한 값이 아닙니다.{props.skipped > 0 && ` 좌표 오류로 제외된 지역 ${props.skipped}곳은 비교에 포함되지 않았습니다.`}</p>
  </section>;
}
