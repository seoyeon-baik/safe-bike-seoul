import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const nativeRequire=createRequire(import.meta.url);
const place={id:'actual-result',name:'검색한 장소',area:'서울특별시',lat:37.53,lng:126.94};
function field(search){
 const states=['검색어',true,0],updates=[];let index=0,chosen=null;
 const react={useId:()=>':search:',useState:()=>{const i=index++;return[states[i],value=>updates.push({index:i,value})];}};
 const require=spec=>spec==='react'?react:spec==='react/jsx-runtime'?nativeRequire(spec):spec==='@/hooks/use-places'?{usePlaces:()=>search}:null;
 const module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync('src/components/place-search.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,require});
 const tree=module.exports.default({label:'출발',value:place,onSelect:value=>chosen=value});
 const nodes=[];function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return;}nodes.push(n);walk(n.props?.children);}walk(tree);
 return{tree,nodes,updates,chosen:()=>chosen};
}
const search={places:[place],loading:false,isDemo:false,refresh(){}};
test('search selection uses actual API results and prevents Enter from submitting an old route',()=>{
 const result=field(search),input=result.nodes.find(n=>n.type==='input');let prevented=false;
 input.props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(result.chosen().id,place.id);assert(result.updates.some(u=>u.index===1&&u.value===false));
 assert.equal(input.props.role,'combobox');assert.equal(input.props['aria-expanded'],true);assert(input.props['aria-activedescendant'].includes(place.id));
});
test('authentication errors and loading states do not select a stale result',()=>{
 for(const state of [{...search,error:'카카오 장소 검색 권한이 거부되었습니다.'},{...search,loading:true}]){
  const result=field(state),input=result.nodes.find(n=>n.type==='input');let prevented=false;
  input.props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});assert(prevented);assert.equal(result.chosen(),null);
 }
});
test('empty search and API errors are visible with a close/retry action',()=>{
 const empty=field({...search,places:[]});const html=renderToStaticMarkup(empty.tree);assert(html.includes('검색 결과가 없습니다'));assert(html.includes('검색 닫기'));
 const failed=field({...search,places:[],error:'카카오 장소 검색 권한이 거부되었습니다.'});const text=renderToStaticMarkup(failed.tree);assert(text.includes('권한이 거부'));assert(text.includes('다시 검색'));assert(!text.includes('예시 장소 5곳'));
});
test('search keyboard escape closes the dropdown and arrows stay within results',()=>{
 const result=field(search),input=result.nodes.find(n=>n.type==='input');
 input.props.onKeyDown({key:'Escape',preventDefault(){}});assert(result.updates.some(u=>u.index===1&&u.value===false));
 input.props.onKeyDown({key:'ArrowDown',preventDefault(){}});const change=result.updates.find(u=>u.index===2&&typeof u.value==='function');assert.equal(change.value(0),0);
});
