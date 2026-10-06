import { useState, type ReactNode } from "react";
import {
  Navigate,
  NavLink,
  Link,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api, type Report } from "./api/client";
import { Button } from "./components/ui/button";
import {
  EvidencePage,
  ReleasePage,
  DraftPage,
  TracePage,
} from "./pages/Details";
export const navigation = [
  ["agents", "전체 관제"],
  ["traces", "실행 이력"],
  ["evaluations", "품질 평가"],
  ["observations", "운영 관찰"],
  ["diagnoses", "건강 진단"],
  ["releases", "운영 전환"],
  ["drafts", "이메일 검수"],
];
export function Status({ value }: { value: string }) {
  const statuses: Record<string, [string, string]> = {
    eligible: ["배포 후보", "good"],
    blocked: ["차단", "bad"],
    unknown: ["판단 불가", ""],
    normal: ["정상", "good"],
    warning: ["주의", "warn"],
    incident: ["장애", "bad"],
    pass: ["통과", "good"],
    fail: ["미달", "bad"],
    success: ["완료", "good"],
    failed: ["오류", "bad"],
    waiting: ["대기", "warn"],
    pending: ["검수 대기", "warn"],
    saved: ["저장 완료", "good"],
  };
  const s = statuses[value] || [value, ""];
  return (
    <span className="j-status" data-tone={s[1]}>
      {s[0]}
    </span>
  );
}
export function Head({
  eyebrow,
  title,
  description,
  extra,
}: {
  eyebrow: string;
  title: string;
  description: string;
  extra?: ReactNode;
}) {
  return (
    <header className="j-heading">
      <div>
        <div className="j-kicker">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="j-subtitle">{description}</p>
      </div>
      {extra}
    </header>
  );
}
export function Panel({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="j-panel">
      {title && (
        <header className="j-panel-head">
          <h2>{title}</h2>
        </header>
      )}
      {children}
    </section>
  );
}
export function Crumb({ section, label }: { section: string; label: string }) {
  return (
    <nav aria-label="현재 위치" className="j-breadcrumb">
      <Link to={"/" + section}>
        {navigation.find((x) => x[0] === section)?.[1]}
      </Link>
      <span>/</span>
      <span>{label}</span>
    </nav>
  );
}
export function State({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry?: () => void;
}) {
  return (
    <section className="j-panel j-empty" role="status">
      <h2>{title}</h2>
      <p>{message}</p>
      {retry && (
        <Button variant="outline" onClick={retry}>
          다시 시도
        </Button>
      )}
    </section>
  );
}
export function QueryState<T>({
  query,
  children,
}: {
  query: UseQueryResult<T, Error>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending)
    return (
      <State
        title="불러오는 중"
        message="실행과 평가 근거를 조회하고 있습니다."
      />
    );
  if (query.isError)
    return (
      <State
        title="조회하지 못했습니다"
        message={query.error.message}
        retry={() => query.refetch()}
      />
    );
  return <>{children(query.data)}</>;
}
export function useReport(id: string) {
  return useQuery({ queryKey: ["report", id], queryFn: () => api.report(id) });
}
export function format(value: number | null, unit = "") {
  return value === null
    ? "미집계"
    : `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value)}${unit}`;
}
export function time(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
function AgentList() {
  const q = useReport("r0.8.2");
  const releases = useQuery({ queryKey: ["releases"], queryFn: api.releases });
  return (
    <>
      <Head
        eyebrow="Control / Overview"
        title="에이전트 운영 관제"
        description="후보의 판정 근거를 확인하고 운영 전환 또는 개선을 결정합니다."
      />
      <QueryState query={releases}>
        {(items) =>
          items.length === 0 ? (
            <State
              title="등록된 후보가 없습니다"
              message="검증할 에이전트 버전이 등록되면 여기에 표시됩니다."
            />
          ) : (
            <Panel title="검토할 후보 버전">
              <div className="j-table">
                <table>
                  <thead>
                    <tr>
                      <th>후보</th>
                      <th>상태</th>
                      <th>판정 근거</th>
                      <th>다음 행동</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.id}</strong>
                          <div className="j-muted text-xs">{r.name}</div>
                        </td>
                        <td>
                          <Status value={r.eligibility} />
                        </td>
                        <td>{r.summary}</td>
                        <td>
                          <Link className="j-link" to={"/releases/" + r.id}>
                            검토하기
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )
        }
      </QueryState>
      <div className="j-spacer" />
      <QueryState query={q}>
        {(r) => (
          <div className="j-grid">
            <Panel title="감독과 전문 에이전트">
              <div className="j-pad">
                {r.agents.map((a) => (
                  <div key={a.id} className={a.parentId ? "j-branch" : ""}>
                    <div className="j-line j-row j-between">
                      <div>
                        <Link className="j-link" to={"/agents/" + a.id}>
                          {a.name}
                        </Link>
                        <div className="j-subtitle">{a.role}</div>
                      </div>
                      <span className="j-status">{a.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="운영과 후보의 경계">
              <div className="j-pad">
                <div className="j-line">
                  <div className="j-subtitle">현재 운영</div>
                  <div className="j-value">{r.operatingRelease}</div>
                </div>
                <div className="j-line">
                  <strong>승인은 특정 버전에만 적용</strong>
                  <p className="j-subtitle">
                    프롬프트·모델·정책이 변경되면 새로운 후보로 평가합니다.
                  </p>
                </div>
                <div className="j-line">
                  <strong>분야 확장</strong>
                  <p className="j-subtitle">
                    업무·학습 팀은 아직 등록되지 않았습니다. 역할·권한·평가기
                    등록 규격을 공유합니다.
                  </p>
                </div>
                <div className="j-line">
                  <Link className="j-link" to="/diagnoses">
                    진단에서 근거 확인
                  </Link>
                </div>
              </div>
            </Panel>
          </div>
        )}
      </QueryState>
    </>
  );
}
function AgentDetail() {
  const { id = "" } = useParams();
  const q = useReport("r0.8.2");
  return (
    <QueryState query={q}>
      {(r) => {
        const a = r.agents.find((x) => x.id === id);
        if (!a)
          return (
            <State
              title="에이전트가 없습니다"
              message="목록에서 등록된 에이전트를 선택해 주세요."
            />
          );
        return (
          <>
            <Crumb section="agents" label={a.name} />
            <Head
              eyebrow="Agent / Detail"
              title={a.name}
              description={a.role}
            />
            <div className="j-grid">
              <Panel title="역할과 감독 관계">
                <div className="j-pad">
                  <div className="j-line">
                    상위 감독:{" "}
                    {r.agents.find((x) => x.id === a.parentId)?.name ||
                      "직접 등록된 감독"}
                  </div>
                  <div className="j-line">현재 운영: {r.operatingRelease}</div>
                  <div className="j-line">
                    검증 중인 팀 버전: {r.release.id}
                  </div>
                  <div className="j-line">
                    하위 담당:{" "}
                    {r.agents
                      .filter((x) => x.parentId === id)
                      .map((x) => x.name)
                      .join(", ") || "없음"}
                  </div>
                </div>
              </Panel>
              <Panel title="권한과 평가 근거">
                <div className="j-pad">
                  <p className="j-subtitle">
                    작업 위임과 결과 생성은 허용됩니다. Gmail 저장과 배포는
                    사용자 승인 및 실행 시스템 검사를 거칩니다.
                  </p>
                  <div className="j-line">
                    <Link to="/evaluations/r0.8.2" className="j-link">
                      팀 평가 결과
                    </Link>
                  </div>
                  <div className="j-line">
                    <Link to="/traces/trace-042" className="j-link">
                      연결된 실행 이력
                    </Link>
                  </div>
                  <div className="j-line">
                    <Link to="/diagnoses/r0.8.2" className="j-link">
                      팀 건강 진단
                    </Link>
                  </div>
                </div>
              </Panel>
            </div>
          </>
        );
      }}
    </QueryState>
  );
}
function ReleaseList({ section }: { section: string }) {
  const q = useQuery({ queryKey: ["releases"], queryFn: api.releases });
  const title = navigation.find((x) => x[0] === section)?.[1] || "";
  const descriptions: Record<string, string> = {
    evaluations: "버전별 고정 평가셋, 점수와 실패 사례를 비교합니다.",
    observations: "토큰·비용·응답 지연과 기록 상태를 확인합니다.",
    diagnoses: "확인된 사실과 원인 가설을 구분해 조치를 결정합니다.",
    releases: "운영 중인 버전과 후보를 구분하고 승인 조건을 검토합니다.",
  };
  return (
    <>
      <Head
        eyebrow={section + " / Versions"}
        title={title}
        description={descriptions[section]}
      />
      <QueryState query={q}>
        {(items) =>
          items.length ? (
            <Panel>
              <div className="j-table">
                <table>
                  <thead>
                    <tr>
                      <th>대상 버전</th>
                      <th>서비스 건강</th>
                      <th>배포 적격성</th>
                      <th>요약</th>
                      <th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.id}</strong>
                          <div className="j-subtitle">{r.name}</div>
                        </td>
                        <td>
                          <Status value={r.health} />
                        </td>
                        <td>
                          <Status value={r.eligibility} />
                        </td>
                        <td>{r.summary}</td>
                        <td>
                          <Link
                            className="j-link"
                            to={"/" + section + "/" + r.id}
                          >
                            근거 보기
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <State
              title="조회할 버전이 없습니다"
              message="등록된 후보의 평가·관찰 결과가 여기에 표시됩니다."
            />
          )
        }
      </QueryState>
    </>
  );
}
function TraceList() {
  const q = useQuery({ queryKey: ["traces"], queryFn: api.traces });
  return (
    <>
      <Head
        eyebrow="Execution / Traces"
        title="실행 이력"
        description="하나의 요청을 감독·도구·모델 호출과 최종 결과까지 따라갑니다."
      />
      <QueryState query={q}>
        {(items) =>
          items.length ? (
            <Panel>
              <div className="j-table">
                <table>
                  <thead>
                    <tr>
                      <th>작업</th>
                      <th>버전</th>
                      <th>결과</th>
                      <th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <strong>일정 확인 회신 초안</strong>
                          <div className="j-code">{t.taskId}</div>
                        </td>
                        <td>{t.releaseId}</td>
                        <td>
                          <Status value="blocked" /> 근거 없는 일정 확정
                        </td>
                        <td>
                          <Link to={"/traces/" + t.id} className="j-link">
                            전체 이력
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <State
              title="실행 기록이 없습니다"
              message="에이전트 작업이 실행되면 요청별 이력이 나타납니다."
            />
          )
        }
      </QueryState>
    </>
  );
}
function DraftList() {
  const q = useQuery({ queryKey: ["drafts"], queryFn: api.drafts });
  return (
    <>
      <Head
        eyebrow="Human Review / Drafts"
        title="이메일 검수"
        description="회신 필요 여부와 초안을 확인한 뒤 저장할 대상을 승인합니다."
      />
      <QueryState query={q}>
        {(items) =>
          items.length ? (
            <Panel>
              <div className="j-table">
                <table>
                  <thead>
                    <tr>
                      <th>제목 / 상대방</th>
                      <th>상태</th>
                      <th>검수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <strong>{d.subject}</strong>
                          <div className="j-subtitle">{d.sender}</div>
                        </td>
                        <td>
                          <Status value={d.status} />
                        </td>
                        <td>
                          <Link className="j-link" to={"/drafts/" + d.id}>
                            원문·초안 확인
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <State
              title="검수할 초안이 없습니다"
              message="회신이 필요한 메일의 초안이 생성되면 여기에서 검수합니다."
            />
          )
        }
      </QueryState>
    </>
  );
}
export function App() {
  const [scenario, setScenario] = useState("normal");
  const mocks = import.meta.env.VITE_ENABLE_MOCKS === "true";
  return (
    <div className="j-layout">
      <aside className="j-sidebar">
        <div>
          <div className="j-logo">JARVIS</div>
          <div className="text-xs text-slate-300 tracking-wider mt-1">
            AGENT CONTROL
          </div>
        </div>
        <nav aria-label="주요 메뉴">
          {navigation.map(([path, label]) => (
            <NavLink key={path} to={"/" + path}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="j-sidefoot mt-auto text-xs text-slate-300">
          <div className="border-t border-slate-600 pt-5">LOCAL WORKSPACE</div>
          <div className="mt-2">총괄 감독 · 이메일 팀</div>
          <div className="mt-5 text-slate-400">
            설계 v0.3 승인 완료
            <br />
            프론트엔드 목업 검수
          </div>
        </div>
      </aside>
      <div className="j-main">
        <header className="j-topbar">
          <div className="j-row">
            <span className="text-sm font-semibold">자비스 관제 시스템</span>
            <span className="j-status">
              {mocks ? "목업 · 예시 데이터" : "실제 API 연결 모드"}
            </span>
          </div>
          {mocks && (
            <label className="j-row text-xs">
              검수 시나리오
              <select
                aria-label="검수 시나리오"
                value={scenario}
                onChange={(e) => {
                  setScenario(e.target.value);
                  window.dispatchEvent(
                    new CustomEvent("jarvis-mock-scenario", {
                      detail: e.target.value,
                    }),
                  );
                }}
              >
                <option value="normal">정상 응답</option>
                <option value="loading">느린 응답 · 3.5초</option>
                <option value="empty">빈 목록</option>
                <option value="error">조회 실패 후 재시도</option>
                <option value="readonly">조회 전용 · 승인 거절</option>
                <option value="conflict">승인 중 버전 변경</option>
              </select>
            </label>
          )}
        </header>
        <main className="j-content" key={scenario}>
          <Routes>
            <Route path="/" element={<Navigate to="/agents" replace />} />
            <Route path="/agents" element={<AgentList />} />
            <Route path="/agents/:id" element={<AgentDetail />} />
            <Route path="/traces" element={<TraceList />} />
            <Route path="/traces/:id" element={<TracePage />} />
            {["evaluations", "observations", "diagnoses", "releases"].map(
              (section) => (
                <Route
                  key={section}
                  path={"/" + section}
                  element={<ReleaseList section={section} />}
                />
              ),
            )}
            {["evaluations", "observations", "diagnoses"].map((section) => (
              <Route
                key={section}
                path={"/" + section + "/:id"}
                element={<EvidencePage section={section} />}
              />
            ))}
            <Route path="/releases/:id" element={<ReleasePage />} />
            <Route path="/drafts" element={<DraftList />} />
            <Route path="/drafts/:id" element={<DraftPage />} />
            <Route
              path="*"
              element={
                <State
                  title="화면을 찾을 수 없습니다"
                  message="왼쪽 메뉴에서 확인할 항목을 선택해 주세요."
                />
              }
            />
          </Routes>
          <footer className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
            {mocks
              ? "화면 검수용 데이터 · 실제 Gmail 저장·발송·운영 배포 없음 · 새로고침 시 예시 상태 초기화"
              : "자체 API 연결 · 외부 서비스 자격증명은 서버에서 관리"}
            <br />
            시간 표시: 한국 표준시 · 미측정값은 0으로 표시하지 않습니다.
          </footer>
        </main>
      </div>
    </div>
  );
}
