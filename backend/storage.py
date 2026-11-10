import json
import uuid
from datetime import datetime, timezone
import psycopg
from psycopg.types.json import Jsonb


def init_db(url):
    with psycopg.connect(url, connect_timeout=5) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS jarvis_setup_checks (id uuid PRIMARY KEY, service text NOT NULL, checked_at timestamptz NOT NULL, result jsonb NOT NULL)"
        )


def record(url, service, result):
    with psycopg.connect(url, connect_timeout=5) as conn:
        conn.execute(
            "INSERT INTO jarvis_setup_checks VALUES (%s,%s,%s,%s)",
            (uuid.uuid4(), service, datetime.now(timezone.utc), Jsonb(result)),
        )


def recent(url):
    with psycopg.connect(url, connect_timeout=5) as conn:
        rows = conn.execute(
            "SELECT service,checked_at,result FROM jarvis_setup_checks ORDER BY checked_at DESC LIMIT 10"
        ).fetchall()
    return [{"service": r[0], "at": r[1].isoformat(), "result": r[2]} for r in rows]


def check_graph(url):
    from typing import TypedDict
    from langgraph.graph import StateGraph, START, END
    from langgraph.checkpoint.postgres import PostgresSaver

    class State(TypedDict):
        message: str

    thread_id = "setup-" + str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}
    with PostgresSaver.from_conn_string(url) as saver:
        saver.setup()
        graph = StateGraph(State)
        graph.add_node("connection_check", lambda state: {"message": "persisted"})
        graph.add_edge(START, "connection_check")
        graph.add_edge("connection_check", END)
        app = graph.compile(checkpointer=saver)
        app.invoke({"message": "start"}, config)
    # Reconnect independently to prove this is not an in-memory checkpoint.
    with PostgresSaver.from_conn_string(url) as saver:
        checkpoint = saver.get(config)
        if not checkpoint or checkpoint["channel_values"]["message"] != "persisted":
            raise RuntimeError("Checkpoint verification failed")
    return {"status": "connected", "checkpointPersisted": True, "thread": thread_id}
