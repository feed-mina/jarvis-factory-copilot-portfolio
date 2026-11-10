import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ReleaseReviewGroup } from "./ReleaseReviewGroup";
import { categoryEntries, matchesReviewFilter } from "./releaseReviewModel";
import type { ReviewRun } from "./releaseReviewModel";

function fixture(): ReviewRun {
  const dataset = Array.from({ length: 5 }, (_, i) => ({
    id: `unknown-0${i + 1}`,
  }));
  return {
    id: "fixture",
    evidence_digest: "a".repeat(64),
    reviews: [],
    payload: {
      state: "completed",
      dataset,
      repetitions: 3,
      artifacts: {},
      slots: dataset.flatMap((c) =>
        Array.from({ length: 3 }, (_, repeat) =>
          ["baseline", "candidate"].map((side) => ({
            side,
            case_id: c.id,
            repeat,
            status: "passed",
            input: { body: c.id },
            result: { draft: "fixture draft" },
          })),
        ).flat(),
      ),
    },
  };
}
describe("category review navigation", () => {
  it("shows all five unknown cases and fifteen separate repetitions", () => {
    const run = fixture(),
      entries = categoryEntries(run, "unknown");
    expect(entries).toHaveLength(15);
    expect(new Set(entries.map((e) => e.key)).size).toBe(15);
    const markup = renderToStaticMarkup(
      createElement(ReleaseReviewGroup, {
        run,
        experimentId: run.id,
        onSaved: () => {},
      }),
    );
    for (let i = 1; i <= 5; i++)
      expect(markup).toContain(`aria-label="unknown-0${i}"`);
    expect(markup).not.toContain("release-group-picker");
  });
  it("uses human acceptance rather than automatic passed for the accepted filter", () => {
    const run = fixture();
    run.reviews = [{ slot: "unknown-01:0", verdict: "accept" }];
    const entries = categoryEntries(run, "unknown");
    expect(
      entries
        .filter((e) => matchesReviewFilter(e, "accepted"))
        .map((e) => e.key),
    ).toEqual(["unknown-01:0"]);
    expect(
      entries.filter((e) => matchesReviewFilter(e, "unreviewed")),
    ).toHaveLength(14);
  });
  it("uses the latest human verdict without counting duplicate events", () => {
    const run = fixture();
    run.reviews = [
      { slot: "unknown-01:0", verdict: "accept" },
      { slot: "unknown-01:0", verdict: "reject", note: "wrong claim" },
    ];
    const entries = categoryEntries(run, "unknown");
    expect(
      entries.filter((e) => matchesReviewFilter(e, "accepted")),
    ).toHaveLength(0);
    expect(
      entries
        .filter((e) => matchesReviewFilter(e, "problem"))
        .map((e) => e.key),
    ).toEqual(["unknown-01:0"]);
  });
  it("filters individual repetitions and does not hide the rest of the case", () => {
    const run = fixture();
    run.payload.slots[0].status = "failed";
    expect(
      categoryEntries(run, "unknown")
        .filter((e) => matchesReviewFilter(e, "problem"))
        .map((e) => e.key),
    ).toEqual(["unknown-01:0"]);
    expect(categoryEntries(run, "notice")).toHaveLength(0);
  });
});

describe("reuse across Release experiments", () => {
  it("supports a custom dataset group and a single repetition", () => {
    const run = fixture();
    run.id = "other-experiment";
    run.payload.dataset = [{ id: "case-a", group: "billing" }];
    run.payload.repetitions = 1;
    run.payload.slots = ["baseline", "candidate"].map((side) => ({
      side,
      case_id: "case-a",
      repeat: 0,
      status: "passed",
      input: { body: "custom" },
      result: { draft: "custom draft" },
    }));
    const entries = categoryEntries(run, "billing");
    expect(entries.map((e) => e.key)).toEqual(["case-a:0"]);
    const markup = renderToStaticMarkup(
      createElement(ReleaseReviewGroup, {
        run,
        experimentId: run.id,
        onSaved: () => {},
      }),
    );
    expect(markup).toContain("billing");
    expect(markup).toContain("case-a:0");
  });
  it("keeps judgments scoped to the supplied experiment with arbitrary repetition counts", () => {
    const first = fixture();
    first.reviews = [{ slot: "unknown-01:0", verdict: "accept" }];
    const second = fixture();
    second.id = "second-experiment";
    second.payload.repetitions = 2;
    expect(
      categoryEntries(first, "unknown").filter((e) =>
        matchesReviewFilter(e, "accepted"),
      ),
    ).toHaveLength(1);
    const entries = categoryEntries(second, "unknown");
    expect(entries).toHaveLength(10);
    expect(
      entries.filter((e) => matchesReviewFilter(e, "accepted")),
    ).toHaveLength(0);
  });
});
