import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import type { AgentNode, AgentEdge, TaskSnapshot } from "../api/workspace";
import { QueryState, time } from "../App";
import { useTask } from "./useTask";
import { PhaseTag, Playback } from "./MailRoom";
type FlowAgent = Node<{ agent: AgentNode }, "agent">;
function AgentCard({ data, selected }: NodeProps<FlowAgent>) {
  const a = data.agent;
  return (
    <div className={"agent-node " + a.state + (selected ? " is-selected" : "")}>
      <Handle type="target" id="in" position={Position.Top} />
      <div className="agent-node-head">
        <strong>{a.label}</strong>
        <PhaseTag value={a.state} />
      </div>
      <p>{a.role}</p>
      <div className="agent-node-meta">
        <span>{a.taskId ? "mail-014" : "할당 대기"}</span>
        <span>{a.contextTokens} tok</span>
      </div>
      <Handle type="source" id="out" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { agent: AgentCard };
export function toFlowNodes(s: TaskSnapshot, selected: string): FlowAgent[] {
  return s.nodes.map((a) => ({
    id: a.id,
    type: "agent",
    position: { x: a.x, y: a.y },
    data: { agent: a },
    width: 226,
    height: 124,
    selected: a.id === selected,
    handles: [
      { id: "in", type: "target", position: Position.Top, x: 113, y: 0 },
      { id: "out", type: "source", position: Position.Bottom, x: 113, y: 124 },
    ],
    draggable: false,
    connectable: false,
    ariaLabel: a.label + " " + a.state,
  }));
}
export function toFlowEdges(s: TaskSnapshot, layer: string): Edge[] {
  return s.edges
    .filter(
      (e) =>
        layer === "all" ||
        (layer === "task" && e.kind !== "memory") ||
        (layer === "memory" && e.kind === "memory"),
    )
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: "out",
      targetHandle: "in",
      label: e.label,
      type: "smoothstep",
      animated: e.active,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: e.active
          ? "#bb6f12"
          : e.kind === "memory"
            ? "#8b66b7"
            : "#69819b",
      },
      style: {
        stroke: e.active
          ? "#bb6f12"
          : e.kind === "memory"
            ? "#8b66b7"
            : "#69819b",
        strokeWidth: e.active ? 2.6 : 1.4,
        strokeDasharray: e.kind === "memory" ? "5 4" : undefined,
      },
      labelStyle: { fontSize: 12, fill: "#263c50" },
      labelBgStyle: { fill: "#f5f8fc", fillOpacity: 0.96 },
      labelBgPadding: [5, 4],
      interactionWidth: 24,
    }));
}
function NodeInspector({ node: a, s }: { node: AgentNode; s: TaskSnapshot }) {
  return (
    <>
      <header>
        <span className="inspector-caption">선택한 노드</span>
        <h2>{a.label}</h2>
        <p>{a.role}</p>
        <PhaseTag value={a.state} />
      </header>
      <div className="inspector-stats">
        <div>
          <span>현재 태스크</span>
          <strong>{a.taskId || "없음"}</strong>
        </div>
        <div>
          <span>컨텍스트</span>
          <strong>{a.contextTokens} tokens</strong>
        </div>
        <div>
          <span>프로세스 메모리</span>
          <strong>{a.processMemoryMb} MB</strong>
        </div>
        <div>
          <span>상태 시점</span>
          <strong>event-{s.seq}</strong>
        </div>
      </div>
      <h3>에이전트 메모리</h3>
      <p className="inspector-help">
        선택 시점에 존재하는 문맥과 상태만 표시합니다. 비공개 추론은 표시하지
        않습니다.
      </p>
      {a.memory.length ? (
        a.memory.map((m) => (
          <details open key={m.key} className="memory-entry">
            <summary>
              <strong>{m.key}</strong>
              <span>{m.scope}</span>
            </summary>
            <p>{m.value}</p>
            <footer>
              {m.source} · {m.tokens} tokens
            </footer>
          </details>
        ))
      ) : (
        <div className="memory-empty">이 시점에 기록된 메모리가 없습니다.</div>
      )}
      <Link className="text-action" to={"/work/mail-014?at=" + s.seq}>
        동일 시점의 메일 보기
      </Link>
    </>
  );
}
function EdgeInspector({ edge: e, s }: { edge: AgentEdge; s: TaskSnapshot }) {
  return (
    <>
      <header>
        <span className="inspector-caption">선택한 엣지</span>
        <h2>{e.label}</h2>
        <p>
          {s.nodes.find((n) => n.id === e.source)?.label} →{" "}
          {s.nodes.find((n) => n.id === e.target)?.label}
        </p>
      </header>
      <div className="inspector-stats">
        <div>
          <span>전달 종류</span>
          <strong>{e.kind}</strong>
        </div>
        <div>
          <span>관련 이벤트</span>
          <strong>{e.eventId}</strong>
        </div>
        <div>
          <span>현재 전달</span>
          <strong>{e.active ? "활성" : "비활성"}</strong>
        </div>
        <div>
          <span>작업</span>
          <strong>{s.id}</strong>
        </div>
      </div>
      <h3>전달 데이터 요약</h3>
      <p className="edge-payload">
        {Number(e.eventId.replace("event-", "")) <= s.seq
          ? e.payload
          : "아직 전달되지 않았습니다. 예정된 관계만 표시합니다."}
      </p>
      <p className="inspector-help">
        엣지는 연결 관계이며, 실제 전달 여부는 이벤트 시점과 함께 해석합니다.
      </p>
    </>
  );
}
export function Topology() {
  const c = useTask(),
    [layer, setLayer] = useState("all"),
    [edge, setEdge] = useState<string | null>(c.params.get("edge")),
    selected = c.params.get("node") || "writer";
  const nodes = useMemo(
      () => (c.query.data ? toFlowNodes(c.query.data, selected) : []),
      [c.query.data, selected],
    ),
    edges = useMemo(
      () => (c.query.data ? toFlowEdges(c.query.data, layer) : []),
      [c.query.data, layer],
    );
  return (
    <>
      <div className="workspace-heading">
        <div>
          <h1>에이전트 감독</h1>
          <p>누가 일을 맡았고, 무엇을 기억하며, 어디로 전달했는가</p>
        </div>
        <Link
          className="text-action"
          to={"/work/mail-014?at=" + (c.query.data?.seq || 0)}
        >
          메일 작업실로 돌아가기
        </Link>
      </div>
      <Playback controller={c} />
      <QueryState query={c.query}>
        {(s) => (
          <>
            <div className="topology-toolbar">
              <div className="graph-legend">
                <span className="legend-task">실선: 위임·작업 전달</span>
                <span className="legend-memory">점선: 메모리 읽기·쓰기</span>
                <span className="legend-active">강조: 현재 이벤트</span>
              </div>
              <label>
                관계
                <select
                  value={layer}
                  onChange={(e) => setLayer(e.target.value)}
                >
                  <option value="all">전체</option>
                  <option value="task">태스크 전달</option>
                  <option value="memory">메모리 접근</option>
                </select>
              </label>
            </div>
            <div className="topology-room">
              <div className="graph-canvas">
                <ReactFlow
                  id="agent-topology"
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  fitView
                  minZoom={0.2}
                  maxZoom={1.6}
                  width={typeof window === "undefined" ? 940 : undefined}
                  height={typeof window === "undefined" ? 620 : undefined}
                  fitViewOptions={{ padding: 0.09 }}
                  nodesConnectable={false}
                  nodesDraggable={false}
                  edgesReconnectable={false}
                  deleteKeyCode={null}
                  onNodeClick={(_, n) => {
                    setEdge(null);
                    const p = new URLSearchParams(c.params);
                    p.set("node", n.id);
                    c.setParams(p, { replace: true });
                  }}
                  onEdgeClick={(_, e) => setEdge(e.id)}
                >
                  <Background gap={24} size={1} color="#c8d3e0" />
                  <Controls showInteractive={false} />
                </ReactFlow>
                <div className="graph-task-label">
                  task {s.id} / {s.releaseId}
                </div>
              </div>
              <aside className="node-inspector">
                {edge && s.edges.find((e) => e.id === edge) ? (
                  <EdgeInspector
                    edge={s.edges.find((e) => e.id === edge)!}
                    s={s}
                  />
                ) : (
                  <NodeInspector
                    node={s.nodes.find((n) => n.id === selected) || s.nodes[0]}
                    s={s}
                  />
                )}
              </aside>
            </div>
            <div className="graph-event-bar">
              <div>
                <strong>
                  #{s.seq} {s.events[s.seq].actor}
                </strong>
                <p>{s.events[s.seq].message}</p>
              </div>
              <span>{time(s.observedAt)} KST</span>
            </div>
            <details className="graph-accessible">
              <summary>노드·엣지 목록으로 접근</summary>
              <div className="graph-lists">
                <section>
                  <h3>노드 선택</h3>
                  {s.nodes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setEdge(null);
                        const p = new URLSearchParams(c.params);
                        p.set("node", n.id);
                        c.setParams(p, { replace: true });
                      }}
                    >
                      {n.label} · {n.state} · {n.contextTokens} tokens
                    </button>
                  ))}
                </section>
                <section>
                  <h3>엣지 선택</h3>
                  {s.edges.map((e) => (
                    <button key={e.id} onClick={() => setEdge(e.id)}>
                      {e.source} → {e.target} · {e.label}
                    </button>
                  ))}
                </section>
              </div>
            </details>
          </>
        )}
      </QueryState>
    </>
  );
}
