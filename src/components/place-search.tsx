'use client';
import {useId,useState} from 'react';
import {usePlaces} from '@/hooks/use-places';
import type {Place} from '@/lib/demo-data';
export default function PlaceSearch({label,value,onSelect}:{label:string;value:Place;onSelect:(place:Place)=>void}){
 const id=useId(),[query,setQuery]=useState(value.name),[open,setOpen]=useState(false),[index,setIndex]=useState(0);
 const search=usePlaces(query,open);
 const highlighted=search.places[Math.min(index,Math.max(0,search.places.length-1))];
 const choose=(place:Place)=>{onSelect(place);setQuery(place.name);setOpen(false);setIndex(0);};
 return <div className="search-field"><label htmlFor={`${id}-input`}>{label}<input id={`${id}-input`} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-results`} aria-activedescendant={open&&highlighted?`${id}-${highlighted.id}`:undefined} aria-label={`${label} 검색`} value={open?query:value.name} maxLength={80} onChange={e=>{setQuery(e.target.value);setIndex(0);setOpen(true);}} onFocus={()=>{setQuery(value.name);setIndex(0);setOpen(true);}} onKeyDown={e=>{
  if(e.key==='Escape'){e.preventDefault();setOpen(false);}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setIndex(n=>Math.max(0,Math.min(search.places.length-1,n+(e.key==='ArrowDown'?1:-1))));}
  if(e.key==='Enter'&&open){e.preventDefault();if(highlighted&&!search.loading&&!search.error)choose(highlighted);}
 }} placeholder="장소명으로 검색" autoComplete="off"/></label>
 {open&&<div className="search-results"><div className="search-hint">{search.isDemo?'예시 검색 모드':'카카오 장소 검색'}</div><div id={`${id}-results`} role="listbox" aria-label={`${label} 검색 결과`} aria-busy={search.loading}>{search.places.map(place=><button type="button" role="option" aria-selected={place.id===highlighted?.id} id={`${id}-${place.id}`} key={place.id} onClick={()=>choose(place)}><strong>{place.name}</strong><small>{place.area}</small></button>)}</div><div role="status">{!query.trim()?<p>장소명을 입력하세요.</p>:search.loading?<p>장소를 검색 중입니다…</p>:search.error?<p>{search.error}</p>:!search.places.length?<p>검색 결과가 없습니다. 다른 장소명을 입력해 보세요.</p>:null}</div>{search.error&&<button type="button" onClick={search.refresh}>다시 검색</button>}<button className="close-search" type="button" onClick={()=>setOpen(false)}>검색 닫기</button></div>}
 </div>;
}
