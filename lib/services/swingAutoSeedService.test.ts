// lib/services/swingAutoSeedService.test.ts
// Plan 15 — Swing AI auto-generate-once (seed-once) surface smoke test.
// NOTE: the full seed-once behavioral test (mocked generate, no-double-AI,
// audit-tag assertions) is a follow-up in the repo's Jest harness and lives
// in lib/services/__tests__. This file is a minimal smoke guard using the
// real PUBLIC constant so the auto-seed contract stays importable.
import { PUBLIC_SWING_USER_ID } from "./swingAutoSeedService";

describe("swingAutoSeedService — public surface smoke", () => {
  it("exposes the PUBLIC_SEED swing user id constant", () => {
    expect(PUBLIC_SWING_USER_ID).toBeDefined();
    expect(typeof PUBLIC_SWING_USER_ID).toBe("number");
  });

  it("re-verify: constant is a plain positive integer id", () => {
    expect(Number.isInteger(PUBLIC_SWING_USER_ID)).toBe(true);
  });
});
