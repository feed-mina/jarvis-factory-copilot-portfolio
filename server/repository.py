import uuid
from datetime import datetime, timezone
from contextlib import contextmanager
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from config import DB


class Conflict(Exception):
    pass


class Missing(Exception):
    pass


class Repository:
    def __init__(self, url=DB):
        self.url = url

    def connect(self):
        return psycopg.connect(self.url, row_factory=dict_row, connect_timeout=5)

    def setup(self):
        with self.connect() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS mail_jobs (
              id uuid PRIMARY KEY, account text NOT NULL, gmail_id text NOT NULL,
              state text NOT NULL DEFAULT 'collected', version integer NOT NULL DEFAULT 1,
              payload jsonb NOT NULL, approval jsonb, operation uuid, draft_id text,
              created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE(account,gmail_id))""")
            c.execute("""CREATE TABLE IF NOT EXISTS mail_events (
              seq bigserial PRIMARY KEY, job_id uuid REFERENCES mail_jobs(id),
              action text NOT NULL, actor text NOT NULL, details jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT now())""")
            c.execute("""CREATE TABLE IF NOT EXISTS mail_review_batches (
              id uuid PRIMARY KEY, account text NOT NULL, status text NOT NULL,
              total integer NOT NULL DEFAULT 0, completed integer NOT NULL DEFAULT 0,
              failed integer NOT NULL DEFAULT 0, skipped integer NOT NULL DEFAULT 0,
              created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,
              finished_at timestamptz)""")
            c.execute("""CREATE TABLE IF NOT EXISTS mail_review_batch_items (
              batch_id uuid NOT NULL REFERENCES mail_review_batches(id) ON DELETE CASCADE,
              job_id uuid NOT NULL REFERENCES mail_jobs(id), position integer NOT NULL,
              captured_version integer NOT NULL, status text NOT NULL DEFAULT 'queued',
              error_type text, started_at timestamptz, finished_at timestamptz,
              PRIMARY KEY(batch_id,job_id), UNIQUE(batch_id,position))""")
            c.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS one_active_mail_review_batch ON mail_review_batches(account) WHERE status IN ('queued','running')"
            )

    def event(self, c, id, action, details=None, actor="system"):
        c.execute(
            "INSERT INTO mail_events(job_id,action,actor,details) VALUES (%s,%s,%s,%s)",
            (id, action, actor, Jsonb(details or {})),
        )

    def add(self, account, gmail_id, payload):
        with self.connect() as c:
            row = c.execute(
                "INSERT INTO mail_jobs(id,account,gmail_id,payload) VALUES (%s,%s,%s,%s) ON CONFLICT(account,gmail_id) DO NOTHING RETURNING id",
                (uuid.uuid4(), account, gmail_id, Jsonb(payload)),
            ).fetchone()
            if row:
                self.event(c, row["id"], "collected")
            return str(row["id"]) if row else None

    def get(self, id):
        with self.connect() as c:
            r = c.execute("SELECT * FROM mail_jobs WHERE id=%s", (id,)).fetchone()
            if not r:
                raise Missing()
            return r

    def listing(self, account=None):
        with self.connect() as c:
            return c.execute(
                "SELECT id,state,version,created_at,updated_at,draft_id,payload->>'subject' AS subject,payload->>'sender' AS sender,payload->>'category' AS category FROM mail_jobs WHERE (%s::text IS NULL OR account=%s) ORDER BY created_at DESC LIMIT 100",
                (account, account),
            ).fetchall()

    def review_batch(self, id, account):
        with self.connect() as c:
            batch = c.execute(
                "SELECT * FROM mail_review_batches WHERE id=%s AND account=%s",
                (id, account),
            ).fetchone()
            if not batch:
                raise Missing()
            batch["items"] = c.execute(
                """SELECT i.job_id,i.position,i.captured_version,i.status,i.error_type,i.started_at,i.finished_at,
              j.state AS job_state,j.version AS job_version,j.payload->>'subject' AS subject
              FROM mail_review_batch_items i JOIN mail_jobs j ON j.id=i.job_id
              WHERE i.batch_id=%s ORDER BY i.position""",
                (id,),
            ).fetchall()
            return batch

    def active_review_batch(self, account):
        with self.connect() as c:
            row = c.execute(
                "SELECT id FROM mail_review_batches WHERE account=%s AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
                (account,),
            ).fetchone()
        return self.review_batch(row["id"], account) if row else None

    def create_review_batch(self, account):
        with self.connect() as c:
            c.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                ("mail-review-batch:" + account,),
            )
            active = c.execute(
                "SELECT id FROM mail_review_batches WHERE account=%s AND status IN ('queued','running')",
                (account,),
            ).fetchone()
            if active:
                return self.review_batch(active["id"], account), False
            jobs = c.execute(
                "SELECT id,version FROM mail_jobs WHERE account=%s AND state='pending_review' ORDER BY created_at ASC,id ASC FOR UPDATE",
                (account,),
            ).fetchall()
            batch_id = uuid.uuid4()
            status = "queued" if jobs else "completed"
            c.execute(
                "INSERT INTO mail_review_batches(id,account,status,total,finished_at) VALUES (%s,%s,%s,%s,%s)",
                (
                    batch_id,
                    account,
                    status,
                    len(jobs),
                    datetime.now(timezone.utc) if not jobs else None,
                ),
            )
            for position, job in enumerate(jobs, 1):
                c.execute(
                    "INSERT INTO mail_review_batch_items(batch_id,job_id,position,captured_version) VALUES (%s,%s,%s,%s)",
                    (batch_id, job["id"], position, job["version"]),
                )
        return self.review_batch(batch_id, account), True

    def claim_review_item(self, batch_id, account):
        while True:
            with self.connect() as c:
                batch = c.execute(
                    "SELECT * FROM mail_review_batches WHERE id=%s AND account=%s FOR UPDATE",
                    (batch_id, account),
                ).fetchone()
                if not batch:
                    raise Missing()
                if batch["status"] not in ("queued", "running"):
                    return None
                if c.execute(
                    "SELECT 1 FROM mail_review_batch_items WHERE batch_id=%s AND status='running' LIMIT 1",
                    (batch_id,),
                ).fetchone():
                    return None
                item = c.execute(
                    "SELECT * FROM mail_review_batch_items WHERE batch_id=%s AND status='queued' ORDER BY position LIMIT 1 FOR UPDATE SKIP LOCKED",
                    (batch_id,),
                ).fetchone()
                if not item:
                    status = (
                        "completed_with_errors"
                        if batch["failed"] or batch["skipped"]
                        else "completed"
                    )
                    c.execute(
                        "UPDATE mail_review_batches SET status=%s,finished_at=now() WHERE id=%s",
                        (status, batch_id),
                    )
                    return None
                job = c.execute(
                    "SELECT * FROM mail_jobs WHERE id=%s FOR UPDATE", (item["job_id"],)
                ).fetchone()
                if (
                    not job
                    or job["state"] != "pending_review"
                    or job["version"] != item["captured_version"]
                ):
                    c.execute(
                        "UPDATE mail_review_batch_items SET status='skipped_stale',finished_at=now() WHERE batch_id=%s AND job_id=%s",
                        (batch_id, item["job_id"]),
                    )
                    c.execute(
                        "UPDATE mail_review_batches SET skipped=skipped+1 WHERE id=%s",
                        (batch_id,),
                    )
                    continue
                result = c.execute(
                    "UPDATE mail_jobs SET state='reviewing',version=version+1,updated_at=now() WHERE id=%s RETURNING *",
                    (job["id"],),
                ).fetchone()
                details = {
                    "batch_id": str(batch_id),
                    "position": item["position"],
                    "total": batch["total"],
                    "version": result["version"],
                }
                self.event(c, job["id"], "reviewing", details, actor="hermes-batch")
                c.execute(
                    "UPDATE mail_review_batch_items SET status='running',started_at=now(),captured_version=%s WHERE batch_id=%s AND job_id=%s",
                    (result["version"], batch_id, job["id"]),
                )
                c.execute(
                    "UPDATE mail_review_batches SET status='running',started_at=COALESCE(started_at,now()) WHERE id=%s",
                    (batch_id,),
                )
                return {
                    "job": result,
                    "position": item["position"],
                    "total": batch["total"],
                }

    def finish_review_item(
        self, batch_id, account, job_id, version, patch, error_type=None
    ):
        with self.connect() as c:
            batch = c.execute(
                "SELECT * FROM mail_review_batches WHERE id=%s AND account=%s FOR UPDATE",
                (batch_id, account),
            ).fetchone()
            if not batch:
                raise Missing()
            item = c.execute(
                "SELECT * FROM mail_review_batch_items WHERE batch_id=%s AND job_id=%s FOR UPDATE",
                (batch_id, job_id),
            ).fetchone()
            job = c.execute(
                "SELECT * FROM mail_jobs WHERE id=%s FOR UPDATE", (job_id,)
            ).fetchone()
            if (
                not item
                or item["status"] != "running"
                or not job
                or job["state"] != "reviewing"
                or job["version"] != version
            ):
                raise Conflict("Refresh the job before this action")
            failed = error_type is not None
            state = "review_failed" if failed else "reviewed"
            item_state = "failed" if failed else "completed"
            payload = {**job["payload"], **(patch or {})}
            result = c.execute(
                "UPDATE mail_jobs SET state=%s,version=version+1,payload=%s,updated_at=now() WHERE id=%s RETURNING *",
                (state, Jsonb(payload), job_id),
            ).fetchone()
            details = {
                "batch_id": str(batch_id),
                "position": item["position"],
                "total": batch["total"],
                "version": result["version"],
            }
            if not failed:
                details.update(
                    {
                        "quality_gate": payload.get("quality_gate"),
                        "pipeline_run_id": payload.get("pipeline_run_id"),
                    }
                )
            else:
                details["error_type"] = error_type
            self.event(c, job_id, state, details, actor="hermes-batch")
            c.execute(
                "UPDATE mail_review_batch_items SET status=%s,error_type=%s,finished_at=now() WHERE batch_id=%s AND job_id=%s",
                (item_state, error_type, batch_id, job_id),
            )
            column = "failed" if failed else "completed"
            c.execute(
                f"UPDATE mail_review_batches SET {column}={column}+1 WHERE id=%s",
                (batch_id,),
            )
            return result

    def events(self, id):
        self.get(id)
        with self.connect() as c:
            return c.execute(
                "SELECT seq,action,actor,details,at FROM mail_events WHERE job_id=%s ORDER BY seq DESC LIMIT 100",
                (id,),
            ).fetchall()[::-1]

    @contextmanager
    def lock(self, id):
        with self.connect() as c:
            got = c.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s,0)) AS ok", (str(id),)
            ).fetchone()["ok"]
            if not got:
                raise Conflict("Operation already running")
            try:
                yield
            finally:
                c.execute(
                    "SELECT pg_advisory_unlock(hashtextextended(%s,0))", (str(id),)
                )

    def change(
        self,
        id,
        version,
        allowed,
        state,
        patch=None,
        approval=None,
        operation=None,
        draft_id=None,
        actor="system",
    ):
        with self.connect() as c:
            r = c.execute(
                "SELECT * FROM mail_jobs WHERE id=%s FOR UPDATE", (id,)
            ).fetchone()
            if not r:
                raise Missing()
            if r["version"] != version or r["state"] not in allowed:
                raise Conflict("Refresh the job before this action")
            payload = {**r["payload"], **(patch or {})}
            result = c.execute(
                """UPDATE mail_jobs SET state=%s,version=version+1,payload=%s,approval=%s,
              operation=%s,draft_id=%s,updated_at=now() WHERE id=%s RETURNING *""",
                (
                    state,
                    Jsonb(payload),
                    Jsonb(approval) if approval else None,
                    operation,
                    draft_id,
                    id,
                ),
            ).fetchone()
            self.event(c, id, state, {"version": result["version"]}, actor)
            return result

    def record(self, id, action, details=None):
        with self.connect() as c:
            self.event(c, id, action, details)

    def recover(self):
        # Called before accepting requests in a single service process.
        with self.connect() as c:
            rows = c.execute(
                "UPDATE mail_jobs SET state=CASE WHEN state='saving' THEN 'save_uncertain' ELSE 'analysis_failed' END,version=version+1,updated_at=now() WHERE state IN ('saving','analyzing') RETURNING id,state"
            ).fetchall()
            for r in rows:
                self.event(c, r["id"], "restart_recovery", {"state": r["state"]})
            reviewing = c.execute(
                "UPDATE mail_jobs SET state='pending_review',version=version+1,updated_at=now() WHERE state='reviewing' RETURNING id,version"
            ).fetchall()
            for r in reviewing:
                c.execute(
                    "UPDATE mail_review_batch_items SET status='queued',captured_version=%s,started_at=NULL WHERE job_id=%s AND status='running'",
                    (r["version"], r["id"]),
                )
                self.event(
                    c,
                    r["id"],
                    "restart_recovery",
                    {"state": "pending_review", "version": r["version"]},
                )
            c.execute(
                "UPDATE mail_review_batches SET status='queued' WHERE status='running'"
            )

    def resumable_review_batches(self):
        with self.connect() as c:
            return c.execute(
                "SELECT id,account FROM mail_review_batches WHERE status='queued' ORDER BY created_at"
            ).fetchall()
