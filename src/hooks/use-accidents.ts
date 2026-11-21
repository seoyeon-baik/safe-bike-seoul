'use client';
import { useCallback, useEffect, useState } from 'react';
import type { AccidentResponse, AccidentZone } from '@/lib/accidents';

const EMPTY:AccidentZone[]=[];
type State={key:string;response?:AccidentResponse;error?:string};
export function useAccidents(year:number){
  const [revision,setRevision]=useState(0);
  const [state,setState]=useState<State>({key:''});
  const refresh=useCallback(()=>setRevision(n=>n+1),[]);
  const key=`${year}:${revision}`;
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    const timeout=window.setTimeout(()=>controller.abort(),75000);
    async function load(){
      try{
        const response=await fetch(`/api/accidents?year=${year}`,{cache:'no-store',signal:controller.signal});
        const payload=await response.json();
        if(!active)return;
        if(!response.ok){setState({key,error:typeof payload?.error?.message==='string'?payload.error.message:'과거 사고정보를 불러오지 못했습니다.'});return;}
        if(payload?.meta?.source!=='koroad'||payload.meta.isDemo!==false||payload.meta.year!==year||!Array.isArray(payload.data)||!payload.data.every((z:AccidentZone)=>z&&typeof z.id==='string'&&typeof z.name==='string'&&z.year===year&&Number.isFinite(z.lat)&&Number.isFinite(z.lng)&&Array.isArray(z.polygons))){throw Error('INVALID_ACCIDENT_DATA');}
        setState({key,response:payload});
      }catch{if(active)setState({key,error:controller.signal.aborted?'과거 사고정보 조회 시간이 초과되었습니다.':'과거 사고정보에 연결하지 못했습니다. 다시 시도해 주세요.'});}
      finally{window.clearTimeout(timeout);}
    }
    void load();
    return()=>{active=false;controller.abort();window.clearTimeout(timeout);};
  },[key,year]);
  const current=state.key===key?state:undefined;
  return{zones:current?.response?.data??EMPTY,meta:current?.response?.meta,error:current?.error,loading:!current,refresh};
}
