import {useState} from 'react';
import {Link} from 'react-router-dom';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {ReactFlow,Background,Controls,MarkerType,Position} from '@xyflow/react';
import {liveApi,liveRequest,type Job,type JobEvent,type NodeRun} from '../api/live';
import {Button} from '../components/ui/button';
import './operations.css';

const names:Record<string,string>={intake:'수집·정규화',triage:'Triage · 회신 분류',security:'Security · 패턴 검사',draft:'Draft · 초안 작성',critic:'Critic · 근거 검수',approval:'사용자 승인'};
const positions:Record<string,{x:number;y:number}>={intake:{x:0,y:115},triage:{x:240,y:20},security:{x:240,y:210},draft:{x:480,y:115},critic:{x:720,y:115},approval:{x:960,y:115}};
const pairs=[['intake','triage'],['intake','security'],['triage','draft'],['security','draft'],['draft','critic'],['critic','approval']];
const ms=(n?:number|null)=>n==null?'미측정':n<1?'<1 ms':`${Math.round(n).toLocaleString()} ms`;
const date=(v:string)=>new Date(v).toLocaleString('ko-KR');
const traceBase='https://smith.langchain.com/o/ad269b8a-ffa5-401c-afcf-f23ad3f63ef8/projects/p/4ed5f395-386b-4df6-8c0b-8140b733312a';

export function RunGraph({events,job}:{events:JobEvent[];job?:Job}){
  const [selected,setSelected]=useState('critic');
  const run=events.filter(e=>e.details.run_id).at(-1)?.details.run_id;
  const current=events.filter(e=>e.details.run_id===run&&e.details.node);
  const last:Record<string,JobEvent>={};for(const e of current)last[e.details.node!]=e;
  const nodes=Object.entries(positions).map(([id,position])=>{
    const e=last[id];let status=e?.action==='node_started'?'실행 중':e?.action==='node_failed'?'실패':e?'완료':'기록 없음';
    if(id==='approval')status=job?['approved','saving','saved'].includes(job.state)?'사용자 승인 완료':job.state==='pending_review'?job.payload.needs_reply===false?'회신 불필요':job.payload.quality_gate==='passed'?'사용자 검토 대기':'검수 확인 필요':'대기':'평가에서는 실행 안 함';
    const color=status==='실패'?'#b42318':status==='실행 중'?'#d38b13':status.includes('완료')?'#177b5b':'#758396';
    return {id,position,data:{label:<><strong>{names[id]}</strong><div>{status}</div>{e&&<small>{ms(e.details.duration_ms)} · {e.details.attempt}회차</small>}</>},style:{width:195,padding:15,border:`2px solid ${color}`,borderRadius:12,background:selected===id?'#eef9f4':'white',color:'#1d3449'},sourcePosition:Position.Right,targetPosition:Position.Left};
  });
  const edges=pairs.map(([source,target])=>({id:source+'-'+target,source,target,animated:last[source]?.action==='node_started',markerEnd:{type:MarkerType.ArrowClosed}}));
  if((last.draft?.details.attempt||0)>1)edges.push({id:'retry',source:'critic',target:'draft',animated:false,markerEnd:{type:MarkerType.ArrowClosed}});
  const chosen=last[selected];
  return <><div className="ops-graph"><ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} onNodeClick={(_,n)=>setSelected(n.id)} minZoom={.3}><Background/><Controls showInteractive={false}/></ReactFlow></div>
    <div className="ops-node-buttons">{Object.entries(names).map(([id,n])=><button key={id} aria-pressed={selected===id} onClick={()=>setSelected(id)}>{n}</button>)}</div>
    <section className="ops-inspector"><h3>{names[selected]}</h3>{chosen?<><p>{chosen.action==='node_started'?'실행 중':chosen.action==='node_failed'?'실패':'완료'} · {chosen.at?date(chosen.at):'시각 미수집'} · {ms(chosen.details.duration_ms)}</p><p>시도 {chosen.details.attempt} · {chosen.details.pipeline_version} · {chosen.details.prompt_version}</p><p>토큰: 미측정 · 비용: 미측정{chosen.details.error_type&&` · 오류: ${chosen.details.error_type}`}</p></>:<p>선택한 실행의 노드 기록이 없습니다. 이전 버전의 실행을 새 그래프로 추정하지 않습니다.</p>}
      {selected==='critic'&&job?.payload.critic&&<><p>모델 검수 점수 · 근거 {job.payload.critic.groundedness} / 표현 {job.payload.critic.quality}</p><ul>{job.payload.critic.feedback.map((f,i)=><li key={i}>{f}</li>)}</ul></>}
      {selected==='security'&&job?.payload.security_check&&<p>{job.payload.security_check.passed?'패턴 미검출':'검토 필요'} · {job.payload.security_check.note}</p>}
      {run&&<small>실행 ID {run}</small>}
    </section></>;
}

export function RuntimeConsole(){
  const [selected,setSelected]=useState('');
  const list=useQuery({queryKey:['live-jobs'],queryFn:liveApi.list,refetchInterval:5000});
  const id=selected||list.data?.[0]?.id;
  const job=useQuery({queryKey:['live-job',id],queryFn:()=>liveApi.job(id!),enabled:!!id,refetchInterval:3000});
  const events=useQuery({queryKey:['live-events',id],queryFn:()=>liveApi.events(id!),enabled:!!id,refetchInterval:3000});
  return <div className="ops-page"><h1>에이전트 실행</h1><p>실제 노드 실행 기록 · 분류와 보안 병렬 실행 · Critic 재작성 최대 1회</p>
    <label>메일 선택 <select value={id||''} onChange={e=>setSelected(e.target.value)}><option value="">메일을 선택하세요</option>{list.data?.map(j=><option key={j.id} value={j.id}>{j.subject} · {j.state}</option>)}</select></label>
    {(list.error||job.error||events.error)&&<p role="alert">실행 기록 조회에 실패했습니다.</p>}
    {!id&&<p>수집된 메일이 없습니다.</p>}{job.data&&<><p><Link to={'/work/'+id}>이 메일 검토하기</Link> · {job.data.payload.pipeline_version||'이전 버전 · 노드 기록 없음'}</p>
      {job.data.payload.trace_id&&<p><a target="_blank" rel="noreferrer" href={traceBase+'/r/'+job.data.payload.trace_id}>LangSmith 실행 열기</a> · 메일 내용 비전송</p>}
      <RunGraph job={job.data} events={events.data||[]}/><h3>노드 이벤트</h3><div className="ops-table"><table><thead><tr><th>시각</th><th>노드</th><th>상태</th><th>지연</th></tr></thead><tbody>{events.data?.filter(e=>e.details.node).map(e=><tr key={e.seq}><td>{date(e.at)}</td><td>{names[e.details.node!]}</td><td>{e.action}</td><td>{ms(e.details.duration_ms)}</td></tr>)}</tbody></table></div></>}
  </div>;
}

interface EvalCase {id:string;input:{subject:string;body:string};status:string;checks?:Record<string,boolean>;result?:Job['payload'];events:(NodeRun&{action:string})[];duration_ms:number;error_type?:string}
interface EvalRun {id:string;state:string;created_at:string;payload:{dataset_version:string;dataset_hash:string;pipeline_version:string;prompt_version:string;evaluator_version:string;total:number;cases:EvalCase[];summary?:{passed:number;failed:number;errors:number;mean_case_ms:number};source:string}}
export function EvalConsole(){
  const qc=useQueryClient(),[selected,setSelected]=useState(''),[caseId,setCase]=useState('');
  const runs=useQuery({queryKey:['eval-runs'],queryFn:()=>liveRequest<EvalRun[]>('/evaluations'),refetchInterval:5000});
  const start=useMutation({mutationFn:()=>liveRequest<EvalRun>('/evaluations','POST'),onSuccess:r=>{setSelected(r.id);setCase('');qc.invalidateQueries({queryKey:['eval-runs']});}});
  const run=runs.data?.find(r=>r.id===selected)||runs.data?.[0];const cases=run?.payload.cases||[],c=cases.find(c=>c.id===caseId)||cases[0];
  const running=runs.data?.some(r=>r.state==='running');
  return <div className="ops-page"><div className="workspace-heading"><div><h1>Eval Studio</h1><p>고정 합성 메일 5건 · 실제 Hermes 파이프라인 · Gmail 읽기·쓰기 없음</p></div><Button disabled={start.isPending||running} onClick={()=>start.mutate()}>{running?'평가 실행 중':start.isPending?'시작 중':'합성 벤치마크 실행'}</Button></div>
    <p className="live-notice">Critic 점수는 동일 모델 계열의 별도 검수 호출입니다. 규칙 기반 평가와 구분하며, 5개 사례의 통과가 전체 품질·보안을 보장하지 않습니다. 기존 실행 기록은 변경하지 않습니다.</p>
    {(start.error||runs.error)&&<p role="alert" className="inline-error">{start.error?.message||runs.error?.message}</p>}
    <label>평가 실행 <select value={run?.id||''} onChange={e=>{setSelected(e.target.value);setCase('');}}><option value="">실행 기록 없음</option>{runs.data?.map(r=><option value={r.id} key={r.id}>{date(r.created_at)} · {r.state}</option>)}</select></label>
    {!run?<p>벤치마크를 실행하면 케이스별 점수와 실패 근거가 표시됩니다.</p>:<>
      <div className="ops-metrics"><article><strong>{run.state}</strong><span>완료 사례 {cases.length}/{run.payload.total}</span></article><article><strong>{run.payload.summary?.passed??'집계 중'}</strong><span>규칙 평가 통과</span></article><article><strong>{run.payload.summary?run.payload.summary.failed+run.payload.summary.errors:'집계 중'}</strong><span>실패·오류</span></article><article><strong>{ms(run.payload.summary?.mean_case_ms)}</strong><span>평균 사례 지연 / 토큰·비용 미측정</span></article></div>
      <p>{run.payload.pipeline_version} · {run.payload.dataset_version} · {run.payload.evaluator_version}</p><details><summary>재현 기준과 데이터셋 해시</summary><p>{run.payload.prompt_version}</p><code>{run.payload.dataset_hash}</code></details>
      <div className="ops-table"><table><thead><tr><th>케이스</th><th>규칙 판정</th><th>근거 점수*</th><th>표현 점수*</th><th>지연</th></tr></thead><tbody>{cases.map(x=><tr key={x.id}><td><button onClick={()=>setCase(x.id)}>{x.input.subject}</button></td><td>{x.status}</td><td>{x.result?.critic?.groundedness??'미평가'}</td><td>{x.result?.critic?.quality??'미평가'}</td><td>{ms(x.duration_ms)}</td></tr>)}</tbody></table></div><small>* 모델 검수 점수. 보안 패턴 차단 시 0은 모델 평가를 수행하지 않은 차단값입니다.</small>
      {c&&<section className="ops-inspector"><h2>{c.input.subject} · 케이스 인스펙터</h2><div className="ops-compare"><article><h3>합성 입력</h3><p>{c.input.body}</p></article><article><h3>최종 초안</h3><p>{c.result?.draft||'초안 없음'}</p></article></div>
        <h3>규칙 평가 근거</h3><ul>{Object.entries(c.checks||{}).map(([key,value])=><li key={key}>{({schema:'필수 출력 필드',trajectory:'필수 노드 완료',security:'예상 보안 판정',classification:'회신 필요 분류',unsupported_claims:'사례별 금지 확정 표현'} as Record<string,string>)[key]}: {value?'통과':'실패'}</li>)}</ul>
        <h3>Critic 피드백</h3><ul>{c.result?.critic?.feedback.map((f,i)=><li key={i}>{f}</li>)}</ul>{c.error_type&&<p className="inline-error">실행 오류: {c.error_type}</p>}
        <RunGraph events={c.events.map((e,i)=>({seq:i,action:e.action,actor:'system',at:e.at||e.started_at||'',details:e}))}/>
      </section>}
    </>}
  </div>;
}
