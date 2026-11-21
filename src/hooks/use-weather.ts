'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toKmaGrid, type WeatherResponse } from '@/lib/weather';

type State={key:string;response?:WeatherResponse;error?:string};
export function useWeather(origin:{lat:number;lng:number}){
  const [revision,setRevision]=useState(0);
  const [state,setState]=useState<State>({key:''});
  const refresh=useCallback(()=>setRevision(n=>n+1),[]);
  const grid=useMemo(()=>{try{return toKmaGrid(origin.lat,origin.lng);}catch{return null;}},[origin.lat,origin.lng]);
  const search=new URLSearchParams({lat:String(origin.lat),lng:String(origin.lng)}).toString();
  const key=`${search}:${revision}`;
  useEffect(()=>{const interval=window.setInterval(refresh,5*60000);return()=>window.clearInterval(interval);},[refresh]);
  useEffect(()=>{
    if(!grid)return;
    const controller=new AbortController();let active=true;
    const timeout=window.setTimeout(()=>controller.abort(),65000);
    const debounce=window.setTimeout(async()=>{
      try{
        const response=await fetch(`/api/weather?${search}`,{cache:'no-store',signal:controller.signal});
        const payload=await response.json();
        if(!active)return;
        if(!response.ok){setState({key,error:typeof payload?.error?.message==='string'?payload.error.message:'기상청 예보를 불러오지 못했습니다.'});return;}
        const data=payload?.data,meta=payload?.meta;
        if(meta?.source!=='kma'||meta.isDemo!==false||meta.kind!=='short-term-forecast'||meta.grid?.nx!==grid.nx||meta.grid?.ny!==grid.ny||!Number.isFinite(data?.temperatureC)||!Number.isInteger(data?.precipitationProbability)||data.precipitationProbability<0||data.precipitationProbability>100||typeof data.publishedAt!=='string'||typeof data.forecastAt!=='string'||!Number.isFinite(Date.parse(data.publishedAt))||!Number.isFinite(Date.parse(data.forecastAt)))throw Error('INVALID_FORECAST');
        setState({key,response:payload});
      }catch{if(active)setState({key,error:controller.signal.aborted?'기상청 예보 조회 시간이 초과되었습니다.':'기상청 예보에 연결하지 못했습니다. 다시 시도해 주세요.'});}
      finally{window.clearTimeout(timeout);}
    },250);
    return()=>{active=false;controller.abort();window.clearTimeout(debounce);window.clearTimeout(timeout);};
  },[grid,key,search]);
  const current=state.key===key?state:undefined;
  return{response:current?.response,error:grid?current?.error:'출발지가 기상청 단기예보 격자 범위를 벗어났습니다.',grid,loading:Boolean(grid&&!current),refresh};
}

export type WeatherState = ReturnType<typeof useWeather>;
