'use client';
import type { WeatherState } from '@/hooks/use-weather';
import { formatWeatherTime, WEATHER_SOURCE_URL } from '@/lib/weather';

type Props={origin:{name:string;lat:number;lng:number};isStation:boolean;weather:WeatherState};
export default function WeatherCard({origin,isStation,weather}:Props){
  const data=weather.response?.data,meta=weather.response?.meta;
  return <section className="weather-card" aria-busy={weather.loading} aria-label="출발지 기상청 단기예보">
    <div className="section-heading"><h2>출발지 단기예보</h2><span className="tag live-tag">기상청</span></div>
    <p className="weather-location"><strong>{origin.name}</strong><span>{isStation?'선택한 출발 대여소':'검색 출발지'} 기준{weather.grid&&` · 격자 (${weather.grid.nx}, ${weather.grid.ny})`}</span></p>
    <div className="weather-values"><div><span>예보 기온</span><strong>{data?`${data.temperatureC}°C`:'—'}</strong></div><div><span>강수확률</span><strong>{data?`${data.precipitationProbability}%`:'—'}</strong></div></div>
    <div className="weather-status" aria-live="polite">{weather.loading&&<p>출발지 격자의 단기예보를 조회 중입니다…</p>}{weather.error&&<p role="alert">{weather.error}</p>}{meta?.usedPreviousPublication&&<p>최근 발표 자료가 아직 없어 직전 발표 예보를 표시합니다.</p>}</div>
    <dl className="weather-times"><div><dt>발표시각</dt><dd>{data?<time dateTime={data.publishedAt}>{formatWeatherTime(data.publishedAt)}</time>:weather.loading?'조회 중':'미확인'}</dd></div><div><dt>예보시각</dt><dd>{data?<time dateTime={data.forecastAt}>{formatWeatherTime(data.forecastAt)}</time>:weather.loading?'조회 중':'미확인'}</dd></div></dl>
    <p className="weather-explanation">발표시각은 예보를 발표한 때, 예보시각은 이 기온·강수확률이 예상되는 때입니다. 모두 한국시간(KST)이며 현재 관측값이 아닙니다.</p>
    <div className="weather-footer"><a href={WEATHER_SOURCE_URL} target="_blank" rel="noreferrer">출처: 기상청 단기예보</a><button type="button" className="station-refresh" onClick={weather.refresh} disabled={weather.loading}>다시 조회</button></div>
    {meta&&<p className="weather-fetched">서버 조회 {formatWeatherTime(meta.fetchedAt)} KST · 5분마다 갱신</p>}
  </section>;
}
