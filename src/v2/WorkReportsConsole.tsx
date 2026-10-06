import {useEffect,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {workReportApi,type WorkReportState} from '../api/live';
import {Button} from '../components/ui/button';

const date=(value:string)=>new Date(value).toLocaleString('ko-KR');
const labels:Record<WorkReportState,string>={collected:'검토 대기',needs_revision:'A01 보완 필요',needs_user:'사용자 판단 필요',passed:'검토 통과',review_failed:'검토 실패'};
function ReportStatus({state}:{state:WorkReportState}){return <span className={'live-status work-'+state}>{labels[state]}</span>}

export function WorkReportsConsole(){
  const {id}=useParams(),navigate=useNavigate(),qc=useQueryClient(),[notice,setNotice]=useState('');
  const list=useQuery({queryKey:['work-reports'],queryFn:workReportApi.list,refetchInterval:5000});
  const report=useQuery({queryKey:['work-report',id],queryFn:()=>workReportApi.report(id!),enabled:!!id,refetchInterval:5000});
  const events=useQuery({queryKey:['work-report-events',id],queryFn:()=>workReportApi.events(id!),enabled:!!id,refetchInterval:5000});
  useEffect(()=>{if(!id&&list.data?.length)navigate('/widget-work/'+list.data[0].id,{replace:true});},[id,list.data,navigate]);
  const refresh=()=>{qc.invalidateQueries({queryKey:['work-reports']});if(id){qc.invalidateQueries({queryKey:['work-report',id]});qc.invalidateQueries({queryKey:['work-report-events',id]});}};
  const collect=useMutation({mutationFn:workReportApi.collect,onSuccess:r=>{setNotice(r.added.length?`${r.added.length}개 메일을 연결했습니다. 같은 보고서 재발송 ${r.duplicates.length}건은 중복 실행하지 않습니다.`:`새 보고서는 없습니다. 재발송 ${r.duplicates.length}건을 기존 작업에 연결했습니다.`);refresh();if(r.added[0])navigate('/widget-work/'+r.added[0]);}});
  const review=useMutation({mutationFn:()=>workReportApi.review(id!,report.data!.version),onSuccess:r=>{qc.setQueryData(['work-report',id],r);setNotice(r.state==='passed'?'검토를 통과했습니다. A01 전달 단계는 아직 연결 전이며, 병합·배포는 계속 중단됩니다.':r.state==='needs_user'?'사용자 판단이 필요한 범위를 확인해 주세요.':'A01이 보고서를 보완해 새 버전으로 다시 보내야 합니다.');refresh();},onError:refresh});
  return <><div className="workspace-heading"><div><div className="section-eyebrow">WIDGET WORK REVIEW</div><h1>위젯 작업</h1><p className="muted">작업 전 보고서를 별도로 수집·중복 제거·검토합니다. 메일 답장 작업과 섞지 않습니다.</p></div><div className="live-actions"><Button variant="outline" onClick={refresh}>상태 새로고침</Button><Button disabled={collect.isPending} onClick={()=>collect.mutate()}>{collect.isPending?'가져오는 중':'보고서 메일 가져오기'}</Button></div></div>
    <div className="live-notice"><strong>실행 경계</strong><p>검토 통과는 코드 수정·테스트·PR 작성으로 넘어갈 수 있다는 판정입니다. main 병합과 운영 배포 권한은 만들지 않습니다.</p></div>
    {notice&&<p role="status" className="inline-success">{notice}</p>}{collect.error&&<p role="alert" className="inline-error">{collect.error.message}</p>}
    <div className="work-report-layout"><aside className="mail-list work-report-list"><header><h2>작업 전 보고서</h2><span>{list.data?.length??0}건</span></header>
      {list.isPending&&<p className="live-padding">보고서 목록을 읽고 있습니다…</p>}{list.error&&<p className="inline-error">{list.error.message}</p>}
      {list.isSuccess&&!list.data.length&&<p className="live-padding">아직 가져온 보고서가 없습니다.</p>}
      {list.data?.map(item=><Link className={'mail-item '+(item.id===id?'selected':'')} key={item.id} to={'/widget-work/'+item.id}><strong>{item.task_id} · {item.report_version}</strong><span>{item.repository||'저장소 미확인'}</span><ReportStatus state={item.state}/><small>연결 메일 {item.source_count}건 · {date(item.updated_at)}</small></Link>)}
    </aside>
    {!id?<section className="live-padding">보고서를 선택하면 범위와 판정이 표시됩니다.</section>:report.isPending?<section className="live-padding">보고서를 읽고 있습니다…</section>:report.error?<section className="inline-error">{report.error.message}</section>:report.data&&<section className="work-report-detail">
      <header className="task-title"><div><div className="section-eyebrow">{report.data.task_id}</div><h2>{report.data.payload.subject}</h2><p>{report.data.report_version} · 동일 내용 메일 {report.data.source_count}건</p></div><ReportStatus state={report.data.state}/></header>
      <dl className="report-facts"><div><dt>저장소</dt><dd>{report.data.payload.repository||'미확인'}</dd></div><div><dt>기준</dt><dd>{report.data.payload.base_branch||'미확인'} · {report.data.payload.base_sha||'SHA 미확인'}</dd></div><div><dt>첨부</dt><dd>{report.data.payload.attachments.map(a=>a.name).join(', ')}</dd></div></dl>
      {report.data.payload.html_attachment&&<p><a className="text-action" href={'/api/v1/work-reports/'+report.data.id+'/html'}>HTML 보고서 받기</a> · 안전을 위해 화면 안에서 실행하지 않고 파일로 받습니다.</p>}
      <h3>필수 계약 검사</h3><ul className="contract-checks">{Object.entries(report.data.payload.contract.checks).map(([name,ok])=><li key={name} className={ok?'check-pass':'check-fail'}>{ok?'통과':'보완'} · {name}</li>)}</ul>
      {report.data.decision&&<section className="review-decision"><h3>Javis 판정 · {labels[report.data.state]}</h3><p>{report.data.decision.reason}</p><p><strong>허용 범위:</strong> {report.data.decision.scope_summary}</p><p><strong>완료 기준:</strong> {report.data.decision.acceptance_summary}</p>{report.data.decision.feedback.length>0&&<ul>{report.data.decision.feedback.map((x,i)=><li key={i}>{x}</li>)}</ul>}</section>}
      {report.data.state!=='passed'&&<Button disabled={review.isPending} onClick={()=>review.mutate()}>{review.isPending?'검토 중':'Javis 검토 실행'}</Button>}
      {review.error&&<p className="inline-error">{review.error.message}</p>}
      <details><summary>보고서 원문 보기</summary><pre className="report-source">{report.data.payload.report_text}</pre></details>
      <h3>처리 이력</h3><ol className="live-events">{events.data?.map(e=><li key={e.seq}><strong>{e.action==='duplicate_received'?'재발송을 기존 보고서에 연결':e.action==='collected'?'보고서 수집':e.action==='passed'?'검토 통과':e.action==='needs_revision'?'보완 요청':'사용자 판단 요청'}</strong><span>{date(e.at)}</span></li>)}</ol>
    </section>}
    </div></>;
}
