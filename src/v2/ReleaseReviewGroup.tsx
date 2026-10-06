import {useEffect,useRef,useState} from 'react';
import {liveRequest} from '../api/live';
import {categoryEntries,latestReviews,matchesReviewFilter,reviewCategory} from './releaseReviewModel';
import type {ReviewFilter,ReviewRun} from './releaseReviewModel';

type Decision={checked:boolean;note:string;reasonOpen:boolean;rejecting:boolean};
const emptyDecision:Decision={checked:false,note:'',reasonOpen:false,rejecting:false};
const labels:Record<string,string>={reply:'일반 문의 · reply',notice:'알림 · notice',unknown:'확인 필요 · unknown',attack:'보안 입력 · attack'};
const filters:{value:ReviewFilter;label:string}[]=[{value:'all',label:'전체'},{value:'problem',label:'문제 사례'},{value:'unreviewed',label:'미검토'},{value:'accepted',label:'통과 저장'}];

export function ReleaseReviewGroup({run,experimentId,onSaved}:{run:ReviewRun;experimentId:string;onSaved:()=>void}){
 const reviewed=latestReviews(run.reviews);
 const cases=run.payload.dataset.map(c=>c.id);
 const firstOpen=cases.find(c=>Array.from({length:run.payload.repetitions},(_,i)=>`${c}:${i}`).some(k=>!reviewed.has(k)))||cases[0]||'';
 const categories=Array.from(new Set(run.payload.dataset.map(reviewCategory)));
 const firstCategory=reviewCategory(run.payload.dataset.find(c=>c.id===firstOpen)||{id:''});
 const [category,setCategory]=useState(firstCategory);
 const [filter,setFilter]=useState<ReviewFilter>('all');
 const [drafts,setDrafts]=useState<Record<string,Decision>>({});
 const [saving,setSaving]=useState('');
 const [message,setMessage]=useState('');
 const savingRef=useRef(false);
 useEffect(()=>{setCategory(firstCategory);setFilter('all');setDrafts({});setMessage('');},[experimentId]);
 const update=(key:string,patch:Partial<Decision>)=>setDrafts(v=>({...v,[key]:{...(v[key]||emptyDecision),...patch}}));
 const activeCategory=categories.includes(category)?category:categories[0]||'';
 const entries=categoryEntries(run,activeCategory);
 const visible=entries.filter(e=>matchesReviewFilter(e,filter));
 const visibleCases=cases.filter(c=>visible.some(e=>e.caseId===c));
 function openReason(key:string,rejecting:boolean){
  update(key,{reasonOpen:true,rejecting});
  requestAnimationFrame(()=>document.getElementById(`review-note-${key}`)?.focus());
 }
 async function saveOne(key:string,verdict:'accept'|'reject'){
  const decision=drafts[key];
  if(!decision?.checked||savingRef.current||run.payload.state!=='completed')return;
  if(verdict==='reject'&&!decision.note.trim()){openReason(key,true);return;}
  savingRef.current=true;setSaving(key);setMessage('');
  try{
   const current=await liveRequest<ReviewRun>('/releases/experiments/'+experimentId);
   if(current.reviews.some(r=>r.slot===key))throw new Error(`${key}은 이미 검토됐습니다. 최신 기록을 확인해 주세요.`);
   if(current.payload.state!=='completed')throw new Error('완료된 실험만 검토할 수 있습니다.');
   await liveRequest('/releases/experiments/'+experimentId+'/reviews','POST',{slot:key,verdict,note:decision.note.trim(),evidence_digest:current.evidence_digest});
   update(key,{checked:false,rejecting:false});
   setMessage(`${key} ${verdict==='accept'?'통과':'반려'}를 저장했습니다.`);
   onSaved();
  }catch(e){setMessage(`${key} 저장 실패: ${e instanceof Error?e.message:'다시 확인해 주세요.'}`);onSaved();}
  finally{savingRef.current=false;setSaving('');}
 }
 return <section className="release-group-review" aria-label="유형별 전체 사례 검토">
  <p>유형 안의 모든 사례와 반복을 아래에서 확인하세요. 각 반복의 두 결과를 읽고 검토를 저장합니다.</p>
  <div className="release-group-categories" role="group" aria-label="사례 유형">{categories.map(c=>{
   const items=categoryEntries(run,c),done=items.filter(e=>e.review).length;
   return <button key={c} disabled={!!saving} aria-pressed={activeCategory===c} onClick={()=>{setCategory(c);setMessage('');}}>{labels[c]||c}<small>{done}/{items.length} 검토</small></button>;
  })}</div>
  <div className="release-filters" role="group" aria-label="사례 필터">{filters.map(f=><button key={f.value} disabled={!!saving} aria-pressed={filter===f.value} onClick={()=>setFilter(f.value)}>{f.label} <small>{entries.filter(e=>matchesReviewFilter(e,f.value)).length}</small></button>)}</div>
  <p className="release-list-summary"><strong>{labels[activeCategory]||activeCategory}</strong> · {visibleCases.length}사례 / {visible.length}반복 표시 · 전체 {entries.length}반복</p>
  <p role="status" className="release-review-feedback">{message||'통과는 바로 저장됩니다. 반려는 사유를 입력한 뒤 저장하세요.'}</p>
  {visible.length===0&&<p className="release-review-empty">이 유형에 해당 조건의 사례가 없습니다. 다른 필터를 선택하세요.</p>}
  {visibleCases.map(caseId=><section key={caseId} className="release-category-case" aria-label={caseId}>
   <h3>{caseId} · {entries.find(e=>e.caseId===caseId)?.slots[0]?.input.body}</h3>
   <div className="release-group-repeats">{visible.filter(e=>e.caseId===caseId).map(({key,repeat,slots,review})=>{
    const decision=drafts[key]||emptyDecision;
    return <article key={key} className="release-group-repeat"><h4>반복 {repeat+1} · {key} · {review?`저장됨 (${review.verdict==='accept'?'통과':'반려'})`:'미검토'}</h4>
     <div className="release-group-pair">{(['baseline','candidate'] as const).map(side=>{
      const slot=slots.find(s=>s.side===side);
      return <div key={side}><strong>{side==='baseline'?'기준선':'후보'} · {run.payload.artifacts[side]?.manifest?.pipeline_version||''}</strong><p>{slot?.result?.draft||'초안 없음'}</p><small>{slot?.status||'대기'}</small><details><summary>평가 근거</summary><ul>{Object.entries(slot?.checks||{}).map(([k,v])=><li key={k}>{k}: {v?'통과':'미충족'}</li>)}</ul>{slot?.result?.critic?.feedback?.map((f,i)=><p key={i}>{f}</p>)}</details></div>;
     })}</div>
     {review?.note&&<p className="release-saved-note"><strong>저장된 사유</strong> · {review.note}</p>}
     {!review&&<div className="release-group-decision">
      <label><input type="checkbox" disabled={!!saving} checked={decision.checked} onChange={e=>update(key,{checked:e.target.checked})}/> 두 결과를 직접 확인했습니다</label>
      {decision.checked&&<><div className="release-group-actions" role="group" aria-label={`${key} 검토 판단`}>
       <button disabled={!!saving||run.payload.state!=='completed'} onClick={()=>saveOne(key,'accept')}>검토 통과 · 저장</button>
       <button disabled={!!saving||run.payload.state!=='completed'} onClick={()=>openReason(key,true)}>치명 오류로 반려</button>
      </div>
      {!decision.reasonOpen&&<button className="release-reason-toggle" onClick={()=>openReason(key,false)}>사유쓰기</button>}
      {decision.reasonOpen&&<div className="release-reason-panel">
       <label htmlFor={`review-note-${key}`}>사유쓰기</label>
       {decision.rejecting&&<p id={`review-note-help-${key}`}>반려하려면 사유를 입력한 뒤 반려 저장을 누르세요.</p>}
       <textarea id={`review-note-${key}`} aria-required={decision.rejecting} aria-describedby={decision.rejecting?`review-note-help-${key}`:undefined} disabled={!!saving} value={decision.note} maxLength={2000} onChange={e=>update(key,{note:e.target.value})}/>
       {decision.rejecting&&<button disabled={!!saving||!decision.checked||!decision.note.trim()||run.payload.state!=='completed'} onClick={()=>saveOne(key,'reject')}>반려 저장</button>}
      </div>}</>}
     </div>}
     {saving===key&&<p role="status">검토를 저장하고 있습니다.</p>}
    </article>;
   })}</div>
  </section>)}
 </section>;
}
