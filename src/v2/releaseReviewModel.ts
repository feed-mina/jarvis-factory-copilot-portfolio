export type ReviewSlot={side:string;case_id:string;repeat:number;status:string;input:{body:string};result?:{draft:string;critic?:{feedback:string[]}};checks?:Record<string,boolean>};
export type ReviewRecord={slot:string;verdict:string;note?:string};
export type ReviewRun={id:string;payload:{state:string;dataset:{id:string;group?:string}[];repetitions:number;slots:ReviewSlot[];artifacts:Record<string,{manifest?:{pipeline_version?:string}}>};reviews:ReviewRecord[];evidence_digest:string};
export type ReviewFilter='all'|'problem'|'unreviewed'|'accepted';
export type ReviewEntry={key:string;caseId:string;repeat:number;slots:ReviewSlot[];review?:ReviewRecord};

export function reviewCategory(item:{id:string;group?:string}){return item.group?.trim()||item.id.split('-')[0];}

// The API returns review events in chronological order; the last judgment is current.
export function latestReviews(reviews:ReviewRecord[]){return new Map(reviews.map(review=>[review.slot,review]));}
export function categoryEntries(run:ReviewRun,category:string):ReviewEntry[]{
 const reviews=latestReviews(run.reviews);
 return run.payload.dataset.filter(c=>reviewCategory(c)===category).flatMap(c=>
  Array.from({length:run.payload.repetitions},(_,repeat)=>{
   const key=`${c.id}:${repeat}`;
   return {key,caseId:c.id,repeat,slots:run.payload.slots.filter(s=>s.case_id===c.id&&s.repeat===repeat),review:reviews.get(key)};
  }));
}
export function matchesReviewFilter(entry:ReviewEntry,filter:ReviewFilter){
 switch(filter){
  case 'unreviewed':return !entry.review;
  case 'accepted':return entry.review?.verdict==='accept';
  case 'problem':return entry.review?.verdict==='reject'||entry.slots.some(s=>s.status==='failed'||s.status==='error');
  default:return true;
 }
}
