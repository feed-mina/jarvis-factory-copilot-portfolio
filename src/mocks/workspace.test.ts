import {describe,it,expect} from 'vitest';
import {taskSnapshot} from './workspace';
import {acceptsSnapshot} from '../v2/useTask';
describe('시간별 감독 상태',()=>{
 it('과거 메모리에 미래 수정과 체크포인트를 노출하지 않는다',()=>{const before=taskSnapshot(3),after=taskSnapshot(7);expect(before.nodes.flatMap(n=>n.memory).every(m=>m.updatedEvent<=3)).toBe(true);expect(before.draftText).toContain('참석하겠습니다');expect(after.draftText).toContain('확인 후');expect(before.nodes.flatMap(n=>n.memory).some(m=>m.key==='checkpoint')).toBe(false)});
 it('모든 엣지는 존재하는 노드를 연결하고 현재 시점에만 활성화한다',()=>{for(let i=0;i<=7;i++){const s=taskSnapshot(i),ids=new Set(s.nodes.map(n=>n.id));expect(s.edges.every(e=>ids.has(e.source)&&ids.has(e.target))).toBe(true);expect(s.edges.filter(e=>e.active).every(e=>e.eventId==='event-'+i)).toBe(true)}});
 it('중복과 역순 이벤트가 최신 상태를 덮어쓰지 않는다',()=>{expect(acceptsSnapshot(taskSnapshot(4),taskSnapshot(3))).toBe(false);expect(acceptsSnapshot(taskSnapshot(4),taskSnapshot(4))).toBe(false);expect(acceptsSnapshot(taskSnapshot(4),taskSnapshot(5))).toBe(true)});
 it('사실성 실패와 사용자 검수 단계를 분리한다',()=>{expect(taskSnapshot(4).draftReady).toBe(false);expect(taskSnapshot(4).status).toBe('blocked');expect(taskSnapshot(7).draftReady).toBe(true);expect(taskSnapshot(7).status).toBe('waiting')});
});

import {setupServer} from 'msw/node';
import {workspaceHandlers} from './workspace';
it('SSE 재접속이 마지막 시점 다음부터 전송된다',async()=>{const server=setupServer(...workspaceHandlers);server.listen();try{const response=await fetch('http://localhost/api/v1/tasks/mail-014/events?after=6');expect(response.headers.get('content-type')).toContain('text/event-stream');const body=await response.text();expect(body).toContain('id: event-7');expect(body).not.toContain('id: event-6');expect(body).toContain('event: replay_end')}finally{server.close()}});
