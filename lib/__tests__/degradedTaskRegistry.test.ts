/**
 * Coverage + invariant tests for
 * lib/services/worker/degradedTaskRegistry.ts (v3.45.0, spec 21).
 *
 * WHY THIS PARSES SOURCE INSTEAD OF JUST CALLING THE EXPORTERS: the
 * `Record<DegradedTaskType, ...>` annotation already forces the map to cover
 * the union, but TypeScript cannot catch the direction that actually breaks at
 * runtime — someone adds a NEW `case "..."` to `executeTask()` and does not add
 * it to the union. That task then hits `default:` ("Unknown task type") or, once
 * degraded execution is wired, is silently skipped forever. So we assert the
 * switch and the registry are the same set, in the same order, and that the
 * literal has no duplicate keys (a duplicate silently keeps the last entry).
 *
 * Do NOT use `import { jest } from "@jest/globals"` — SWC (next/jest) needs
 * `jest` as the global for `jest.mock()` hoisting. This suite mocks nothing.
 */

import fs from "fs";
import path from "path";

import {
  DEGRADED_TASK_TYPES,
  degradedSafeTaskTypes,
  degradedUnsafeTaskTypes,
  getDegradedCapability,
  isDegradedSafe,
} from "@/lib/services/worker/degradedTaskRegistry";

const WORKER_DIR = path.join(process.cwd(), "lib", "services", "worker");

function readSource(file: string): string {
  return fs.readFileSync(path.join(WORKER_DIR, file), "utf8");
}

/** Capturing group 1 of every match, without relying on `matchAll` (lib-dependent). */
function captureAll(src: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const rx = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null = rx.exec(src);
  while (m !== null) {
    out.push(m[1]);
    m = rx.exec(src);
  }
  return out;
}

/** Top-level keys of the literal REGISTRY map, in source order. */
function registryKeys(): string[] {
  const src = readSource("degradedTaskRegistry.ts");
  const start = src.indexOf("const REGISTRY:");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n};", start);
  expect(end).toBeGreaterThan(start);
  return captureAll(src.slice(start, end), /^ {2}([a-z_]+): \{/m);
}

/** `case "..."` literals in executeTask()'s switch, in source order. */
function dispatchCases(): string[] {
  const src = readSource("worker-service.ts");
  const start = src.indexOf("switch (taskType) {");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("default:", start);
  expect(end).toBeGreaterThan(start);
  return captureAll(src.slice(start, end), /case "([a-z_]+)":/g);
}

describe("degradedTaskRegistry — dispatch coverage", () => {
  it("declares exactly the task types executeTask() dispatches, in the same order", () => {
    expect(DEGRADED_TASK_TYPES).toEqual(dispatchCases());
  });

  it("covers every dispatched type in the registry literal", () => {
    expect(new Set(registryKeys())).toEqual(new Set(DEGRADED_TASK_TYPES));
  });

  it("has no duplicate keys in the REGISTRY literal (a dup keeps only the last entry)", () => {
    const keys = registryKeys();
    expect(keys).toHaveLength(new Set(keys).size);
  });

  it("has no duplicate entries in DEGRADED_TASK_TYPES", () => {
    expect(DEGRADED_TASK_TYPES).toHaveLength(new Set(DEGRADED_TASK_TYPES).size);
  });

  it("reports every dispatched type as known", () => {
    for (const t of dispatchCases()) {
      expect(getDegradedCapability(t).known).toBe(true);
    }
  });
});

describe("degradedTaskRegistry — safe/unsafe partition", () => {
  it("partitions every type into exactly one of safe/unsafe", () => {
    const safe = degradedSafeTaskTypes();
    const unsafe = degradedUnsafeTaskTypes().map((u) => u.taskType);
    expect(safe.length + unsafe.length).toBe(DEGRADED_TASK_TYPES.length);
    expect(safe.filter((t) => unsafe.includes(t))).toEqual([]);
  });

  it("gives every unsafe type a specific reason so a skip is never silent", () => {
    const unsafe = degradedUnsafeTaskTypes();
    expect(unsafe.length).toBeGreaterThan(0);
    for (const { taskType, reason } of unsafe) {
      expect(typeof taskType).toBe("string");
      expect(reason.trim().length).toBeGreaterThan(0);
      // A bare placeholder is worse than no reason at all.
      expect(reason.trim().toLowerCase()).not.toBe("n/a");
    }
  });

  it("only marks a type safe when it names a verification source and mirror tables", () => {
    const safe = degradedSafeTaskTypes();
    expect(safe.length).toBeGreaterThan(0);
    for (const t of safe) {
      const cap = getDegradedCapability(t);
      expect(cap.degradedSafe).toBe(true);
      expect(cap.verifiedBy ?? "").not.toBe("");
      expect(cap.mirrorTables?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("keeps every unsafe type off the degraded path", () => {
    for (const t of DEGRADED_TASK_TYPES) {
      const cap = getDegradedCapability(t);
      expect(cap.degradedSafe).toBe(isDegradedSafe(t));
      if (!cap.degradedSafe) expect(cap.reason.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("degradedTaskRegistry — fails closed", () => {
  it("treats an unknown task type as unknown and unsafe", () => {
    const cap = getDegradedCapability("totally_unknown_task");
    expect(cap.known).toBe(false);
    expect(cap.degradedSafe).toBe(false);
    expect(cap.reason).toContain("totally_unknown_task");
  });

  it("does not throw for any string input", () => {
    for (const bad of ["", "  ", "RECOMMENDATIONS", "../etc/passwd", "a".repeat(500)]) {
      expect(() => getDegradedCapability(bad)).not.toThrow();
      expect(isDegradedSafe(bad)).toBe(false);
    }
  });
});
