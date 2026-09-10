// lib/__tests__/timeCorrection.test.ts
//
// Unit tests for lib/services/timeCorrection.ts (v3.32.0 "Time Synchronisation").
// The SQLite helpers are manually mocked with a closure store so the persistence
// wrappers and their fail-safe degrade can be exercised without sql.js.
// All assertions are TZ-structural — `process.env.TZ` is not honored by V8's
// cached `getTimezoneOffset` (esp. Windows), so exact IST-zone values are avoided
// and only UTC-getter-derived math is asserted.

jest.mock("@/lib/sqlite", () => {
  const store: { correction: unknown; probe: unknown } = { correction: null, probe: null };
  return {
    __esModule: true,
    __setCorrection: (r: unknown) => {
      store.correction = r;
    },
    __setProbe: (p: unknown) => {
      store.probe = p;
    },
    persistTimeCorrection: jest.fn((r: unknown) => {
      store.correction = r;
    }),
    deleteTimeCorrection: jest.fn(() => {
      store.correction = null;
    }),
    restoreTimeCorrection: jest.fn(() => store.correction),
    persistTimeProbe: jest.fn((p: unknown) => {
      store.probe = p;
    }),
    restoreTimeProbe: jest.fn(() => store.probe),
  };
});

import {
  IST_OFFSET_MINUTES,
  TIME_ALIGN_TOLERANCE_MS,
  toIstIso,
  getIstNowIso,
  parseIstDateTimeLocal,
  computeCorrectionOffsetMinutes,
  applyOffset,
  formatOffsetMinutes,
  saveCorrection,
  clearCorrection,
  loadCorrection,
  saveDbProbe,
  loadDbProbe,
  getCorrectedNow,
  getCronFrom,
  getTimeDiagnostics,
} from "@/lib/services/timeCorrection";
import type { TimeCorrectionRecord } from "@/lib/services/timeCorrection";

const sqliteMock = jest.requireMock("@/lib/sqlite") as {
  __setCorrection: (r: unknown) => void;
  __setProbe: (p: unknown) => void;
  persistTimeCorrection: jest.Mock;
  deleteTimeCorrection: jest.Mock;
  restoreTimeCorrection: jest.Mock;
  persistTimeProbe: jest.Mock;
  restoreTimeProbe: jest.Mock;
};

const CORRECTION: TimeCorrectionRecord = {
  offsetMinutes: -330,
  istInput: "2026-09-10T15:30",
  appliedAt: "2026-09-10T10:00:00.000Z",
  serverNowIso: "2026-09-10T10:00:00.000Z",
};

beforeEach(() => {
  sqliteMock.__setCorrection(null);
  sqliteMock.__setProbe(null);
  jest.clearAllMocks();
});

describe("timeCorrection constants", () => {
  it("IST offset is 330 minutes and alignment tolerance is 60s", () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
    expect(TIME_ALIGN_TOLERANCE_MS).toBe(60_000);
  });
});

describe("toIstIso", () => {
  it("formats a UTC instant as IST wall time with the +05:30 suffix", () => {
    expect(toIstIso(new Date("2026-09-10T10:00:00.000Z"))).toBe("2026-09-10T15:30:00+05:30");
  });

  it("rolls over midnight correctly", () => {
    expect(toIstIso(new Date("2026-09-10T18:30:00.000Z"))).toBe("2026-09-11T00:00:00+05:30");
  });
});

describe("getIstNowIso", () => {
  it("ends with the +05:30 IST suffix", () => {
    expect(getIstNowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/);
  });
});

describe("parseIstDateTimeLocal", () => {
  it("parses a valid IST wall time into the correct absolute instant", () => {
    expect(parseIstDateTimeLocal("2026-09-10T15:30")?.toISOString()).toBe("2026-09-10T10:00:00.000Z");
    expect(parseIstDateTimeLocal("2026-09-10T00:00")?.toISOString()).toBe("2026-09-09T18:30:00.000Z");
  });

  it("rejects malformed inputs", () => {
    for (const bad of ["", "2026/09/10T15:30", "2026-09-10 15:30", "15:30", "2026-09-10T15:3", "2026-09-10T15:300"]) {
      expect(parseIstDateTimeLocal(bad)).toBeNull();
    }
  });

  it("rejects unreal dates", () => {
    for (const bad of ["2026-02-30T15:30", "2026-13-01T00:00", "2026-00-10T00:00", "2026-09-10T24:00", "2026-09-10T15:60"]) {
      expect(parseIstDateTimeLocal(bad)).toBeNull();
    }
  });
});

describe("computeCorrectionOffsetMinutes", () => {
  it("returns -330 for a 5.5h-fast clock, 0 for aligned, +330 for a slow clock", () => {
    const ist = new Date("2026-09-10T10:00:00.000Z");
    expect(computeCorrectionOffsetMinutes(ist, new Date("2026-09-10T15:30:00.000Z"))).toBe(-330);
    expect(computeCorrectionOffsetMinutes(ist, ist)).toBe(0);
    expect(computeCorrectionOffsetMinutes(ist, new Date("2026-09-10T04:30:00.000Z"))).toBe(330);
  });
});

describe("applyOffset", () => {
  it("0 is the identity; positive shifts forward, negative shifts back", () => {
    const base = new Date("2026-09-10T10:00:00.000Z");
    expect(applyOffset(base, 0).getTime()).toBe(base.getTime());
    expect(applyOffset(base, 90).toISOString()).toBe("2026-09-10T11:30:00.000Z");
    expect(applyOffset(base, -330).toISOString()).toBe("2026-09-10T04:30:00.000Z");
  });
});

describe("formatOffsetMinutes", () => {
  it("renders signed minutes", () => {
    expect(formatOffsetMinutes(-330)).toBe("-330");
    expect(formatOffsetMinutes(90)).toBe("+90");
    expect(formatOffsetMinutes(0)).toBe("0");
  });
});

describe("correction persistence", () => {
  it("saveCorrection -> loadCorrection roundtrips and clearCorrection removes it", () => {
    expect(loadCorrection()).toBeNull();
    saveCorrection(CORRECTION);
    expect(loadCorrection()).toEqual(CORRECTION);
    saveCorrection({ ...CORRECTION, offsetMinutes: 90 });
    expect(loadCorrection()?.offsetMinutes).toBe(90);
    clearCorrection();
    expect(loadCorrection()).toBeNull();
    expect(sqliteMock.persistTimeCorrection).toHaveBeenCalledTimes(2);
    expect(sqliteMock.deleteTimeCorrection).toHaveBeenCalledTimes(1);
  });
});

describe("db probe persistence", () => {
  it("saveDbProbe -> loadDbProbe roundtrips", () => {
    expect(loadDbProbe()).toBeNull();
    const probe = { dbIso: "2026-09-10T10:00:02.000Z", probedAt: "2026-09-10T10:00:01.000Z" };
    saveDbProbe(probe);
    expect(loadDbProbe()).toEqual(probe);
  });
});

describe("getCorrectedNow", () => {
  it("applies the persisted offset", () => {
    sqliteMock.__setCorrection({ ...CORRECTION, offsetMinutes: 90 });
    const before = Date.now();
    const corrected = getCorrectedNow().getTime();
    const after = Date.now();
    const expected = before + 90 * 60_000;
    expect(corrected).toBeGreaterThan(expected - 2_000);
    expect(corrected).toBeLessThan(after + 90 * 60_000 + 2_000);
  });

  it("is the identity when no correction is set", () => {
    const before = Date.now();
    const now = getCorrectedNow().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("getCronFrom", () => {
  it("aliases getCorrectedNow", () => {
    const a = getCronFrom().getTime();
    const b = getCorrectedNow().getTime();
    expect(Math.abs(a - b)).toBeLessThan(100);
  });
});

describe("getTimeDiagnostics", () => {
  it("returns structural fields and null alignment when never probed", () => {
    const d = getTimeDiagnostics();
    expect(typeof d.serverUtcOffsetMinutes).toBe("number");
    expect(typeof d.serverTz).toBe("string");
    expect(d.istIso).toMatch(/\+05:30$/);
    expect(d.correctedNowIso).toBe(d.serverIso);
    expect(d.dbIso).toBeNull();
    expect(d.dbProbeAt).toBeNull();
    expect(d.misaligned).toBeNull();
    expect(d.correction).toBeNull();
  });

  it("flags aligned when the probe is recent and misaligned when it drifts", () => {
    sqliteMock.__setProbe({ dbIso: new Date().toISOString(), probedAt: new Date().toISOString() });
    expect(getTimeDiagnostics().misaligned).toBe(false);

    const far = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    sqliteMock.__setProbe({ dbIso: far, probedAt: new Date().toISOString() });
    expect(getTimeDiagnostics().misaligned).toBe(true);
  });

  it("echoes the persisted correction and reflects it in correctedNowIso", () => {
    sqliteMock.__setCorrection({ ...CORRECTION, offsetMinutes: 90 });
    const d = getTimeDiagnostics();
    expect(d.correction?.offsetMinutes).toBe(90);
    expect(new Date(d.correctedNowIso).getTime()).toBeGreaterThan(new Date(d.serverIso).getTime());
  });
});

describe("sqlite failure degrade", () => {
  it("loaders return null and savers never throw when sqlite is unavailable", () => {
    sqliteMock.restoreTimeCorrection.mockImplementationOnce(() => {
      throw new Error("no sqlite");
    });
    expect(loadCorrection()).toBeNull();

    sqliteMock.restoreTimeProbe.mockImplementationOnce(() => {
      throw new Error("no sqlite");
    });
    expect(loadDbProbe()).toBeNull();

    sqliteMock.persistTimeCorrection.mockImplementationOnce(() => {
      throw new Error("no sqlite");
    });
    expect(() => saveCorrection(CORRECTION)).not.toThrow();
    expect(() => clearCorrection()).not.toThrow();
    expect(() => saveDbProbe({ dbIso: "x", probedAt: "y" })).not.toThrow();
  });

  it("getCorrectedNow still returns a Date when sqlite is unavailable", () => {
    sqliteMock.restoreTimeCorrection.mockImplementation(() => {
      throw new Error("no sqlite");
    });
    expect(getCorrectedNow()).toBeInstanceOf(Date);
  });
});