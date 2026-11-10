"""역할(triage·draft·critic) 모델 호출을 LangChain LCEL 체인으로 묶는 층.

체인 모양:  입력 조립 -> ChatPromptTemplate -> 채팅 모델 -> PydanticOutputParser

- 프롬프트 글과 출력 스키마는 복사하지 않고 `pipeline.py`의 것을 그대로 가져다 쓴다.
  (`pipeline.py`는 버전 판정이 글자 그대로 읽는 파일이라 이 모듈은 그 파일을 고치지 않는다.)
- 기본 채팅 모델 `HermesChatModel`은 기존 `role_runner.py`를 같은 방식으로 실행하는 얇은 어댑터다.
  즉 운영 기본 경로의 끝은 예전과 같은 Hermes 역할 실행기다.
- 체인의 결과는 `pipeline.execute(..., role_fn=...)`가 기대하는 모양
  `{"result": {...}, "model": ..., "provider": ...}` 그대로다.
"""

import inspect
import json
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda, RunnableParallel
from langsmith import tracing_context

import pipeline
from config import ENV

# pipeline.call_role 안에 적힌 컨테이너 이름과 같아야 한다(test_chains.py가 확인한다).
HERMES_CONTAINER = "hermes-a03-gateway-personal-dev-1"
SCHEMAS = {
    "triage": pipeline.Triage,
    "draft": pipeline.Draft,
    "critic": pipeline.Critic,
}

# 프롬프트 글에는 {"draft":string} 같은 중괄호가 들어 있으므로 글 자체를 틀로 쓰지 않고 변수로 넣는다.
PROMPT = ChatPromptTemplate.from_messages(
    [("system", "{system}"), ("human", "{untrusted}")]
)


def run_hermes(envelope):
    """pipeline.call_role과 같은 명령으로 role_runner.py를 Hermes 컨테이너에서 실행한다."""
    script = Path(pipeline.__file__).with_name("role_runner.py").read_text()
    r = subprocess.run(
        ["docker", "exec", "-i", HERMES_CONTAINER, "python", "-c", script],
        input=json.dumps(envelope, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=150,
        check=False,
    )
    if r.returncode:
        raise RuntimeError("Role model failed")
    return json.loads(r.stdout)


class HermesChatModel(BaseChatModel):
    """Hermes 역할 실행기를 LangChain 채팅 모델처럼 쓰게 해 주는 어댑터. 도구 호출은 없다."""

    runner: Callable[[dict], dict] = run_hermes

    @property
    def _llm_type(self) -> str:
        return "hermes-role-runner"

    def _generate(
        self, messages, stop=None, run_manager=None, **kwargs: Any
    ) -> ChatResult:
        system = [m for m in messages if isinstance(m, SystemMessage)]
        human = [m for m in messages if isinstance(m, HumanMessage)]
        if len(system) != 1 or len(human) != 1 or len(messages) != 2:
            raise ValueError("Expected one system prompt and one data message")
        # role_runner가 다시 {"untrusted_data": ...}로 감싸므로 여기서는 알맹이만 넘긴다.
        data = json.loads(human[0].content)["untrusted_data"]
        out = self.runner({"prompt": system[0].content, "data": data})
        message = AIMessage(
            content=json.dumps(out["result"], ensure_ascii=False),
            response_metadata={
                "model": out.get("model"),
                "provider": out.get("provider"),
            },
        )
        return ChatResult(generations=[ChatGeneration(message=message)])


def role_chain(role, model=None, prompts=None):
    """역할 하나의 LCEL 체인. model·prompts를 주지 않으면 Hermes와 현재 pipeline.PROMPTS를 쓴다."""
    parser = PydanticOutputParser(pydantic_object=SCHEMAS[role])

    def assemble(data):
        # 호출할 때마다 읽으므로 pipeline.PROMPTS가 바뀌면 바뀐 글이 그대로 쓰인다.
        return {
            "system": (pipeline.PROMPTS if prompts is None else prompts)[role],
            "untrusted": json.dumps({"untrusted_data": data}, ensure_ascii=False),
        }

    return (
        RunnableLambda(assemble)
        | PROMPT
        | (model or HermesChatModel())
        | RunnableParallel(
            result=parser | RunnableLambda(lambda parsed: parsed.model_dump()),
            model=RunnableLambda(lambda m: m.response_metadata.get("model")),
            provider=RunnableLambda(lambda m: m.response_metadata.get("provider")),
        )
    )


def call_role(role, data, model=None, prompts=None):
    """pipeline의 role_fn 자리에 그대로 끼울 수 있는 함수. 형식이 틀린 모델 출력은 예외로 끝난다."""
    # 메일 본문이 LangSmith로 자동 전송되지 않게 이 호출의 자동 추적은 끈다(기존 수동 추적은 그대로).
    with tracing_context(enabled=False):
        return role_chain(role, model, prompts).invoke(data)


def enabled():
    """JARVIS_LANGCHAIN_ROLES=0 이면 예전처럼 pipeline.call_role을 직접 쓴다(되돌리기용 스위치)."""
    return ENV.get("JARVIS_LANGCHAIN_ROLES", "1") != "0"


def execute(payload, emit=lambda action, details: None):
    """분석 파이프라인(triage·security·draft·critic)을 LangChain 역할 체인으로 실행한다."""
    if not enabled():
        return pipeline.execute(payload, emit)
    return pipeline.execute(payload, emit, role_fn=call_role)


def review(payload):
    """Critic 재검수. pipeline.review가 role_fn을 받지 않는 함수로 바뀌어 있으면(테스트 등) 그대로 부른다."""
    if not enabled() or "role_fn" not in inspect.signature(pipeline.review).parameters:
        return pipeline.review(payload)
    return pipeline.review(payload, role_fn=call_role)
