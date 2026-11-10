"""Operator-only preparation of a documented draft prompt candidate. No deployment."""

import copy
from release_runtime import snapshot
from release_dataset import digest

ADDENDUM = (
    " Improve usefulness without adding facts: for reply-needed emails, briefly acknowledge the specific request from the source, "
    "then state what needs checking or ask at most one essential clarifying question if the source truly lacks information needed to answer. "
    "Use 2-4 short, natural Korean sentences. Avoid generic filler, repeating the same promise, and invented recipient names or job titles. "
    "Do not invent a follow-up deadline, internal process, availability, payment status, attachment, or completion claim. "
    "Do not ask for passwords, credentials, account numbers or unnecessary personal data. "
    "If no reply is needed, provide only a short no-reply explanation without a salutation or a promise to contact the sender."
)


def candidate_from(baseline):
    value = copy.deepcopy({k: v for k, v in baseline.items() if k != "digest"})
    original = value["pipeline"]
    if (
        "VERSION='mail-v2.0.0'" not in original
        or "def call_role(role,data):" not in original
    ):
        raise RuntimeError("Unexpected baseline source; review candidate patch")
    modified = original.replace("VERSION='mail-v2.0.0'", "VERSION='mail-v2.0.1-rc1'", 1)
    modified = modified.replace(
        "PROMPT_VERSION='roles-2026-09-13.1'",
        "PROMPT_VERSION='roles-2026-09-13.2-rc1'",
        1,
    )
    modified = modified.replace(
        "def call_role(role,data):",
        "PROMPTS['draft'] += " + repr(ADDENDUM) + "\n\ndef call_role(role,data):",
        1,
    )
    compile(modified, "candidate_pipeline", "exec")
    value["pipeline"] = modified
    value["manifest"].update(
        pipeline_version="mail-v2.0.1-rc1",
        prompt_version="roles-2026-09-13.2-rc1",
        source_hash=digest(modified),
        prompt_hash=digest(
            {
                "baseline": baseline["manifest"]["prompt_hash"],
                "draft_addendum": ADDENDUM,
            }
        ),
        candidate_note="Specific, concise reply with at most one necessary question; no invented commitments.",
        parent_digest=baseline["digest"],
    )
    return {**value, "digest": digest(value)}


def prepare(service, account):
    baseline = snapshot()
    candidate = candidate_from(baseline)
    rows = []
    with service.repo.lock("release-artifact"):
        for snap in (baseline, candidate):
            existing = next(
                (
                    r
                    for r in service.listing(account, "artifact")
                    if r["key"] == snap["digest"]
                ),
                None,
            )
            rows.append(
                existing or service.put(account, "artifact", snap["digest"], snap)
            )
    return rows
