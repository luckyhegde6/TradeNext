/**
 * Tests for scripts/dev-checks/check-tsc-baseline.mjs
 *
 * The script is an ESM `.mjs` CLI and Jest here is CJS + jsdom, so behaviour is verified by
 * spawning the real CLI (same approach as `chunk-output.test.ts`).
 *
 * The tsc command is overridden through the script's documented test seam `TSC_BASELINE_CMD`, so
 * counting / prod-vs-test classification / regression detection / --update are deterministic and
 * instant — no real tsc run and no dependence on the repo's current error count.
 *
 * Baseline *freshness* (that the committed number still matches real tsc) is enforced by the
 * pre-commit hook and the CI `tsc-baseline` job, not here.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../scripts/dev-checks/check-tsc-baseline.mjs");
const REAL_BASELINE_PATH = path.resolve(__dirname, "../../scripts/dev-checks/tsc-baseline.json");

/**
 * Snapshot of the committed baseline. Every test in this file must leave it byte-identical —
 * `--update` is exercised against a throwaway copy, never the real file.
 */
const REAL_BASELINE_BEFORE = readFileSync(REAL_BASELINE_PATH, "utf8");

type RunResult = { status: number; stdout: string; stderr: string };

/**
 * Spawn a CLI; never throw so exit codes can be asserted.
 * `script` is explicit because harness tests must run the *copy*, not the repo script.
 */
function run(script: string, args: string[], cwd: string, tscCmd?: string): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      env: tscCmd ? { ...process.env, TSC_BASELINE_CMD: tscCmd } : process.env,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** A production tsc error line (counted toward `prod`). */
const prodErr = (n: number) =>
  `app/components/Widget${n}.ts(${n},1): error TS2339: Property 'x' does not exist.`;

/** A test-file tsc error line (excluded from `prod`) — the shape of this repo's 46 real errors. */
const testErr = (n: number) =>
  `app/components/__tests__/Widget${n}.test.tsx(${n},1): error TS2339: Property 'toBeInTheDocument' does not exist.`;

type Harness = {
  dir: string;
  script: string;
  baselinePath: string;
  tscCmd: string;
  cleanup: () => void;
};

/**
 * Mirror the real layout (`<root>/scripts/dev-checks/<script>` + baseline beside it) so the
 * script's ROOT/BASELINE_PATH resolution lands inside the throwaway dir.
 */
function makeHarness(options: {
  baseline?: { total: number; prod: number } | null;
  output?: string[];
  tscExit?: number;
}): Harness {
  const dir = mkdtempSync(path.join(tmpdir(), "tsc-baseline-"));
  const scriptDir = path.join(dir, "scripts", "dev-checks");
  mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, "check-tsc-baseline.mjs");
  copyFileSync(SCRIPT, script);

  // v3.40.7's `buildGateTsconfig()` reads `<ROOT>/tsconfig.json` — mirror the repo layout by
  // providing a stub at the throwaway ROOT so the copied script does not crash with ENOENT.
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ include: ["**/*.ts"], exclude: [] }),
    "utf8"
  );

  const baselinePath = path.join(scriptDir, "tsc-baseline.json");
  if (options.baseline !== null) {
    const baseline = options.baseline ?? { total: 2, prod: 1 };
    writeFileSync(baselinePath, JSON.stringify({ ...baseline, recorded: "2026-01-01" }), "utf8");
  }

  const fakeTsc = path.join(dir, "fake-tsc.cjs");
  const output = (options.output ?? []).join("\n");
  writeFileSync(
    fakeTsc,
    `process.stdout.write(${JSON.stringify(output)});\nprocess.exit(${options.tscExit ?? 0});\n`,
    "utf8"
  );

  return {
    dir,
    script,
    baselinePath,
    tscCmd: `"${process.execPath}" "${fakeTsc}"`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("check-tsc-baseline.mjs", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  afterAll(() => {
    expect(readFileSync(REAL_BASELINE_PATH, "utf8")).toBe(REAL_BASELINE_BEFORE);
  });

  function ws(options: Parameters<typeof makeHarness>[0] = {}): Harness {
    const h = makeHarness(options);
    cleanups.push(h.cleanup);
    return h;
  }

  it("passes when the error count equals the baseline", () => {
    const h = ws({ baseline: { total: 2, prod: 1 }, output: [prodErr(1), testErr(2)] });

    const result = run(h.script, [], h.dir, h.tscCmd);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no TypeScript regression");
    expect(result.stdout).toMatch(/total\s+2\b/);
    expect(result.stdout).toMatch(/prod\s+1\b/);
  });

  it("classifies errors outside __tests__ as prod (regression guard for the inverted count)", () => {
    // 3 errors: 1 prod + 2 test. `prod` must be 1 — not 2 (total minus prod), which is the
    // transposed calculation this test exists to prevent.
    const h = ws({
      baseline: { total: 3, prod: 1 },
      output: [prodErr(1), testErr(2), testErr(3)],
    });

    const result = run(h.script, ["--json"], h.dir, h.tscCmd);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.total).toBe(3);
    expect(payload.prod).toBe(1);
    expect(payload.delta).toEqual({ total: 0, prod: 0 });
  });

  it("fails with exit 1 and reports deltas when prod errors regress", () => {
    const h = ws({ baseline: { total: 2, prod: 0 }, output: [prodErr(1), testErr(2), testErr(3)] });

    const result = run(h.script, ["--json"], h.dir, h.tscCmd);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.total).toBe(3);
    expect(payload.delta).toEqual({ total: 1, prod: 1 });
    expect(payload.newErrors.length).toBeGreaterThan(0);
    expect(result.stderr).toContain("TypeScript regression");
  });

  it("fails when only the total regresses (new test-file errors still count)", () => {
    const h = ws({ baseline: { total: 2, prod: 0 }, output: [testErr(1), testErr(2), testErr(3)] });

    const result = run(h.script, ["--json"], h.dir, h.tscCmd);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(payload.prod).toBe(0);
    expect(payload.delta).toEqual({ total: 1, prod: 0 });
  });

  it("passes when the error count improves", () => {
    const h = ws({ baseline: { total: 10, prod: 5 }, output: [testErr(1)] });

    const result = run(h.script, ["--json"], h.dir, h.tscCmd);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.delta).toEqual({ total: -9, prod: -5 });
  });

  it("--update rewrites the baseline with the current counts", () => {
    const h = ws({ baseline: { total: 0, prod: 0 }, output: [prodErr(1), testErr(2)] });

    const result = run(h.script, ["--update"], h.dir, h.tscCmd);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Baseline re-recorded");
    expect(JSON.parse(readFileSync(h.baselinePath, "utf8"))).toMatchObject({ total: 2, prod: 1 });
  });

  it("falls back to the documented default baseline (46 / 0) when the file is absent", () => {
    const over = ws({ baseline: null, output: Array.from({ length: 47 }, (_, i) => testErr(i + 1)) });
    const at = ws({ baseline: null, output: Array.from({ length: 46 }, (_, i) => testErr(i + 1)) });

    expect(run(over.script, ["--json"], over.dir, over.tscCmd).status).toBe(1);
    expect(run(at.script, ["--json"], at.dir, at.tscCmd).status).toBe(0);
  });

  it("exits 2 when tsc produces no output (could not run)", () => {
    const h = ws({ baseline: { total: 0, prod: 0 }, output: [] });

    const result = run(h.script, [], h.dir, h.tscCmd);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("produced no output");
  });
});

describe("committed tsc baseline", () => {
  it("is well-formed and pinned to the recorded Phase 0 numbers", () => {
    const baseline = JSON.parse(readFileSync(REAL_BASELINE_PATH, "utf8"));

    expect(typeof baseline.total).toBe("number");
    expect(typeof baseline.prod).toBe("number");
    expect(baseline.recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Update these together via `--update` if the baseline is ever intentionally re-recorded.
    expect(baseline.total).toBe(46);
    expect(baseline.prod).toBe(0);
  });

  it("resolves the real tsc shim used by the default (non-seam) invocation", () => {
    // The default path runs `node node_modules/typescript/bin/tsc --noEmit -p <gate>` directly
    // (no `npx`, no shell string) — this pins the shim the gate depends on.
    expect(
      existsSync(path.resolve(__dirname, "../../node_modules/typescript/bin/tsc"))
    ).toBe(true);
  });
});
