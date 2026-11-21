'use client';
import { formatWeatherTime } from '@/lib/weather';
export type InformationSource = {
  label: string; source: string; href: string; loading: boolean; error?: string;
  available: boolean; detail: string; times: {label: string; value: string}[];
};
type Props = { origin: string; destination: string; sources: InformationSource[] };
export default function RideOverview({origin,destination,sources}: Props) {
  return <section className="ride-overview" id="overview" aria-label="라이딩 통합 정보 현황">
    <div className="overview-heading"><div><span className="eyebrow">ONE RIDE, FOUR SOURCES</span><h2>라이딩 정보 한눈에</h2><p><strong>{origin}</strong><span> / </span>{destination}</p></div><a href="#comparison" className="overview-anchor">경로 비교 보기</a></div>
    <div className="source-grid">{sources.map(source=><article className="source-card" key={source.label}><div className="source-top"><h3>{source.label}</h3><span className={`source-state ${source.error?'failed':source.available?'received':''}`}>{source.loading?'조회 중':source.error?'조회 실패':source.available?'수신 완료':'미조회'}</span></div><p className="source-detail">{source.error?'해당 정보의 상세 안내를 확인하세요.':source.detail}</p><dl>{source.times.map(time=><div key={time.label}><dt>{time.label}</dt><dd><time dateTime={time.value}>{formatWeatherTime(time.value)}</time> KST</dd></div>)}{!source.times.length&&<div><dt>수집시각</dt><dd>미확인</dd></div>}</dl><a href={source.href} target="_blank" rel="noreferrer">출처: {source.source}</a></article>)}</div>
    <p className="overview-clock-note">서로 다른 시점의 자료를 함께 표시합니다. 서버 수집시각은 실제 측정·사고 발생시각이 아닙니다. 개별 측정시각이 제공되지 않는 따릉이는 수집시각을 표시합니다.</p>
  </section>;
}
