import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useSearchParams} from 'react-router-dom';
import {workspaceApi,type TaskSnapshot} from '../api/workspace';
export function acceptsSnapshot(current:TaskSnapshot|undefined,next:TaskSnapshot){return !!next&&next.id==='mail-014'&&Number.isInteger(next.seq)&&next.seq>=0&&next.seq<=next.lastSeq&&(!current||next.seq>current.seq)}
export function useTask(id='mail-014'){
 const [params,setParams]=useSearchParams(),client=useQueryClient(),source=useRef<EventSource|null>(null),[connection,setConnection]=useState('정지'),[playing,setPlaying]=useState(false);const raw=params.get('at'),at=raw===null?undefined:Number(raw);const queryKey=['task',id,at];const query=useQuery({queryKey,queryFn:()=>workspaceApi.snapshot(id,at)});
 function stop(){source.current?.close();source.current=null;setPlaying(false);setConnection('정지')}
 useEffect(()=>()=>{source.current?.close()},[id,at]);
 function connect(after:number){source.current?.close();setConnection('연결 중');setPlaying(true);const s=new EventSource(workspaceApi.streamUrl(id,after),{withCredentials:true});source.current=s;s.onopen=()=>setConnection('이벤트 수신');s.addEventListener('snapshot',(e)=>{try{const next=JSON.parse((e as MessageEvent).data) as TaskSnapshot;client.setQueryData<TaskSnapshot>(queryKey,current=>acceptsSnapshot(current,next)?next:current)}catch{setConnection('잘못된 이벤트 · 재조회 필요');s.close();setPlaying(false)}});s.addEventListener('replay_end',()=>{s.close();setPlaying(false);setConnection('재생 완료')});s.addEventListener('stream_error',()=>{s.close();setPlaying(false);setConnection('재개 오류 · 다시 조회')});s.onerror=()=>{s.close();setPlaying(false);setConnection('연결 끊김 · 이어받기 가능')};}
 async function play(){if(playing){stop();return}if(!query.data)return;try{let from=query.data.seq;if(from>=query.data.lastSeq){const initial=await workspaceApi.snapshot(id,0);client.setQueryData(queryKey,initial);from=0}connect(from)}catch{setPlaying(false);setConnection("이벤트를 읽지 못했습니다 · 다시 재생")}}
 function seek(n:number){stop();const next=new URLSearchParams(params);next.set('at',String(n));setParams(next,{replace:true})}
 return {query,playing,connection,play,stop,seek,params,setParams};
}
