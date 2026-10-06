import {describe,it,expect} from 'vitest';
import {actions,reviewBatchProgress,type Job,type ReviewBatch} from './live';
const job={state:'reviewed',payload:{needs_reply:true}} as Job;
describe('live approval controls',()=>{
  it('blocks unreviewed edits and failed critic decisions',()=>{
    expect(actions({...job,state:'pending_review'},false).approve).toBe(false);
    for(const quality_gate of ['blocked','needs_review'])expect(actions({...job,payload:{...job.payload,quality_gate}},false).approve).toBe(false);
    expect(actions({...job,payload:{...job.payload,quality_gate:'passed'}},false).approve).toBe(true);
  });
  it('requires completed Hermes review then a separate save',()=>{
    expect(actions(job,false)).toMatchObject({approve:true,save:false});
    expect(actions({...job,state:'approved'},false)).toMatchObject({approve:false,save:true});
  });
  it('blocks approval and save with unsaved edits',()=>{
    expect(actions(job,true).approve).toBe(false);
    expect(actions({...job,state:'approved'},true).save).toBe(false);
  });
  it('does not approve automatic notifications',()=>{
    expect(actions({...job,payload:{...job.payload,needs_reply:false}},false).approve).toBe(false);
  });
  it('only offers reconciliation after an uncertain save',()=>{
    expect(actions({...job,state:'save_uncertain'},false)).toEqual({analyze:false,edit:false,approve:false,save:false,reconcile:true});
  });
  it('locks completed and active jobs',()=>{
    for(const state of ['saved','saving','analyzing','reviewing'] as const){expect(actions({...job,state},false)).toEqual({analyze:false,edit:false,approve:false,save:false,reconcile:false});}
  });
  it('counts successful, failed, and stale terminal batch items',()=>{
    const batch={completed:4,failed:1,skipped:2,total:8} as ReviewBatch;
    expect(reviewBatchProgress(batch)).toBe(7);
  });
});
