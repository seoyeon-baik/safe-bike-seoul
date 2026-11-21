'use client';
import {useCallback,useEffect,useState} from 'react';
import type {Place} from '@/lib/demo-data';
const EMPTY:Place[]=[];
type State={key:string;places?:Place[];error?:string;isDemo?:boolean};
export function usePlaces(query:string,enabled:boolean){
 const [state,setState]=useState<State>({key:''});
 const [revision,setRevision]=useState(0);
 const refresh=useCallback(()=>setRevision(n=>n+1),[]);
 const normalized=query.trim(),key=`${normalized}:${revision}`;
 useEffect(()=>{
  if(!enabled||!normalized||normalized.length>80)return;
  const controller=new AbortController();let active=true;
  const timeout=window.setTimeout(()=>controller.abort(),12000);
  const debounce=window.setTimeout(async()=>{
   try{
    const response=await fetch(`/api/places?${new URLSearchParams({query:normalized})}`,{cache:'no-store',signal:controller.signal});
    const body=await response.json();
    if(!active)return;
    if(!response.ok){setState({key,error:typeof body?.error?.message==='string'?body.error.message:'장소 검색에 실패했습니다.'});return;}
    if(!Array.isArray(body.data)||!body.data.every((p:Place)=>p&&typeof p.id==='string'&&typeof p.name==='string'&&typeof p.area==='string'&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)))throw Error();
    if(controller.signal.aborted)throw Error();
    setState({key,places:body.data,isDemo:body.meta?.isDemo===true});
   }catch{if(active)setState({key,error:controller.signal.aborted?'장소 검색 시간이 초과되었습니다. 다시 시도해 주세요.':'장소 검색에 연결하지 못했습니다.'});}
   finally{window.clearTimeout(timeout);}
  },300);
  return()=>{active=false;controller.abort();window.clearTimeout(debounce);window.clearTimeout(timeout);};
 },[enabled,key,normalized]);
 const current=state.key===key?state:undefined;
 return{places:enabled?current?.places??EMPTY:EMPTY,error:normalized.length>80?'검색어는 80자 이하여야 합니다.':current?.error,loading:Boolean(enabled&&normalized&&normalized.length<=80&&!current),isDemo:current?.isDemo??false,refresh};
}
