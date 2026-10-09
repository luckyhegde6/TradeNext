/**
 * Spec 26 — Google Sheets header-badge contract test.
 *
 * The admin console's `HEADER_BADGE` map must be defined for every `HeaderState`
 * the server can emit (lib/services/googleSheets/tabs.ts:116 —
 * "matched" | "drifted" | "absent" | "unknown"). Before this spec the client
 * declared a disjoint union ("match"/"mismatch"/…), so every healthy tab fell
 * back to "unknown".
 */
import { HEADER_BADGE } from "@/app/admin/google-sheets/page";
import type { HeaderState } from "@/lib/services/googleSheets/tabs";

describe("Google Sheets header badge (Spec 26)", () => {
  it("maps every server HeaderState to a defined badge", () => {
    const serverStates: HeaderState[] = ["matched", "drifted", "absent", "unknown"];
    for (const state of serverStates) {
      expect(HEADER_BADGE[state]).toBeDefined();
      expect(HEADER_BADGE[state].label).toBeTruthy();
      expect(HEADER_BADGE[state].cls).toBeTruthy();
    }
  });

  it("labels matched as 'header ok'", () => {
    expect(HEADER_BADGE.matched.label).toBe("header ok");
  });

  it("labels drifted as 'header drifted'", () => {
    expect(HEADER_BADGE.drifted.label).toBe("header drifted");
  });

  it("labels absent as 'no header yet' (not 'tab missing')", () => {
    expect(HEADER_BADGE.absent.label).toBe("no header yet");
    expect(HEADER_BADGE.absent.label).not.toBe("tab missing");
  });

  it("labels unknown as 'unknown' (defensive fallback)", () => {
    expect(HEADER_BADGE.unknown.label).toBe("unknown");
  });
});