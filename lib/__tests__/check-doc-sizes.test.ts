/**
 * Tests for scripts/dev-checks/check-doc-sizes.mjs
 *
 * Two layers:
 *  1. The REAL repo config is asserted read-only (within budget, JSON shape, byte sizes) — this is
 *     the actual gate that protects the per-request context cost.
 *  2. Failure modes run against throwaway harnesses: the script is copied into a temp dir that
 *     mirrors `<root>/scripts/dev-checks/<script>` + `<root>/.opencode/opencode.json`, so ROOT
 *     resolution lands in the temp dir and the real config is never modified.
 *
 * Spawned as a CLI because the script is ESM and Jest here is CJS + jsdom.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../scripts/dev-checks/check-doc-sizes.mjs");
const REPO_ROOT = path.resolve(__dirname, "../..");
const CONFIG_PATH = path.join(REPO_ROOT, ".opencode", "opencode.json");
const HOOK_PATH = path.join(REPO_ROOT, ".githooks", "pre-commit");
const CI_PATH = path.join(REPO_ROOT, ".github", "workflows", "quality-gate.yml");

const KB = 1024;

/** The real config is read-only for this suite; assert it byte-identical at the end. */
const REAL_CONFIG_BEFORE = readFileSync(CONFIG_PATH, "utf8");

type RunResult = { status: number; stdout: string; stderr: string };

/** Spawn a CLI; `script` is explicit so harness tests run the copy, not the repo script. */
function run(script: string, args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** Run the repo script against the real repo. */
function runReal(args: string[]): RunResult {
  return run(SCRIPT, args, REPO_ROOT);
}

type Harness = { dir: string; script: string; cleanup: () => void };

function makeHarness(options: {
  injected?: Array<{ path: string; bytes: number; create?: boolean }>;
  rawConfig?: string;
  scratchBytes?: number;
}): Harness {
  const dir = mkdtempSync(path.join(tmpdir(), "doc-sizes-"));
  const scriptDir = path.join(dir, "scripts", "dev-checks");
  mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, "check-doc-sizes.mjs");
  copyFileSync(SCRIPT, script);
  mkdirSync(path.join(dir, ".opencode"), { recursive: true });

  const injected = options.injected ?? [];
  for (const entry of injected) {
    if (entry.create === false) continue;
    const abs = path.join(dir, entry.path);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.alloc(entry.bytes, 97));
  }

  const config = options.rawConfig ?? JSON.stringify({ instructions: injected.map((e) => e.path) });
  writeFileSync(path.join(dir, ".opencode", "opencode.json"), config, "utf8");

  if (options.scratchBytes) {
    const scratchDir = path.join(dir, ".context", "out");
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(path.join(scratchDir, "capture.bin"), Buffer.alloc(options.scratchBytes, 0));
  }

  return { dir, script, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Shared harness lifetime for a describe block. */
function useHarnesses() {
  const cleanups: Array<() => void> = [];
  return {
    ws(options: Parameters<typeof makeHarness>[0]): Harness {
      const harness = makeHarness(options);
      cleanups.push(harness.cleanup);
      return harness;
    },
    cleanupAll() {
      while (cleanups.length > 0) cleanups.pop()?.();
    },
  };
}

describe("check-doc-sizes.mjs — real repo config", () => {
  afterAll(() => {
    expect(readFileSync(CONFIG_PATH, "utf8")).toBe(REAL_CONFIG_BEFORE);
  });

  it("passes the gate for the real injected set", () => {
    const result = runReal([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("TOTAL");
    expect(result.stdout).toContain("budget 100.0 KB");
    expect(result.stdout).toContain("OK: injected context is within budget");
  });

  it("emits machine-readable JSON for CI", () => {
    const result = runReal(["--json"]);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBeGreaterThan(0);
    expect(payload.totalBudget).toBe(100 * KB);
    expect(payload.fileBudget).toBe(32 * KB);
    expect(Array.isArray(payload.files)).toBe(true);
    expect(payload.scratch.path).toBe(".context/out");
    expect(typeof payload.scratch.bytes).toBe("number");
    expect(typeof payload.scratch.withinThreshold).toBe("boolean");
  });

  it("reports every configured instruction file in order, with its real byte size", () => {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    const payload = JSON.parse(runReal(["--json"]).stdout);

    expect(payload.files.map((f: { path: string }) => f.path)).toEqual(config.instructions);

    for (const file of payload.files as Array<{ path: string; bytes: number }>) {
      expect(file.bytes).toBe(statSync(path.join(REPO_ROOT, file.path)).size);
    }
  });

  it("keeps the injected set within budget", () => {
    const payload = JSON.parse(runReal(["--json"]).stdout);

    expect(payload.total).toBeLessThanOrEqual(payload.totalBudget);
    expect((payload.files as Array<{ ok: boolean }>).every((f) => f.ok)).toBe(true);
  });
});

describe("check-doc-sizes.mjs — budget failure modes", () => {
  const h = useHarnesses();

  afterEach(() => h.cleanupAll());

  it("fails when a single file exceeds the per-file budget", () => {
    const harness = h.ws({ injected: [{ path: "a.md", bytes: 33 * KB }] });

    const result = run(harness.script, [], harness.dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("OVER");
  });

  it("fails when the total exceeds the budget even if each file is fine", () => {
    // 4 × 30 KB = 120 KB total; every individual file is under the 32 KB per-file budget.
    const harness = h.ws({
      injected: [1, 2, 3, 4].map((n) => ({ path: `f${n}.md`, bytes: 30 * KB })),
    });

    const result = run(harness.script, ["--json"], harness.dir);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(payload.ok).toBe(false);
    expect((payload.files as Array<{ ok: boolean }>).every((f) => f.ok)).toBe(true);
    expect(payload.total).toBe(120 * KB);
  });

  it("fails when a configured file is missing", () => {
    const harness = h.ws({
      injected: [
        { path: "present.md", bytes: 1 * KB },
        { path: "absent.md", bytes: 0, create: false },
      ],
    });

    // Human mode spells the per-file status out; JSON mode exposes it as a flag.
    const human = run(harness.script, [], harness.dir);
    const payload = JSON.parse(run(harness.script, ["--json"], harness.dir).stdout);

    expect(human.status).toBe(1);
    expect(human.stdout).toContain("NOT FOUND");
    expect(payload.ok).toBe(false);
    expect(payload.files[1]).toMatchObject({ path: "absent.md", ok: false, missing: true });
  });

  it("fails when the config is not valid JSON", () => {
    const harness = h.ws({ rawConfig: "{ not json" });

    const result = run(harness.script, ["--json"], harness.dir);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).ok).toBe(false);
    expect(result.stderr).toContain("cannot read/parse .opencode/opencode.json");
  });

  it("fails when there is no instructions array", () => {
    const harness = h.ws({ rawConfig: JSON.stringify({ agent: {} }) });

    const result = run(harness.script, [], harness.dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no `instructions` array");
  });

  it("points budget failures at the modularisation playbook", () => {
    const harness = h.ws({ injected: [{ path: "big.md", bytes: 33 * KB }] });

    const result = run(harness.script, [], harness.dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("over budget");
    expect(result.stderr).toContain(".agents/INDEX.md");
  });
});

describe("check-doc-sizes.mjs — .context/out retention (advisory)", () => {
  const h = useHarnesses();

  afterEach(() => h.cleanupAll());

  it("warns above the retention threshold but still exits 0", () => {
    const harness = h.ws({
      injected: [{ path: "a.md", bytes: 1 * KB }],
      scratchBytes: 5 * KB * KB + KB,
    });

    const result = run(harness.script, [], harness.dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WARN");
    expect(result.stdout).toContain("disposable");
    expect(JSON.parse(run(harness.script, ["--json"], harness.dir).stdout).scratch.withinThreshold).toBe(
      false
    );
  });

  it("stays quiet below the threshold", () => {
    const harness = h.ws({ injected: [{ path: "a.md", bytes: 1 * KB }], scratchBytes: 10 * KB });

    const result = run(harness.script, [], harness.dir);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("WARN");
    expect(JSON.parse(run(harness.script, ["--json"], harness.dir).stdout).scratch.withinThreshold).toBe(
      true
    );
  });
});

describe("harness wiring stays in place", () => {
  it("the pre-commit hook runs the context-budget guard", () => {
    expect(readFileSync(HOOK_PATH, "utf8")).toContain("scripts/dev-checks/check-doc-sizes.mjs");
  });

  it("CI gates the context budget and the tsc baseline", () => {
    const workflow = readFileSync(CI_PATH, "utf8");
    expect(workflow).toContain("scripts/dev-checks/check-doc-sizes.mjs");
    expect(workflow).toContain("scripts/dev-checks/check-tsc-baseline.mjs");
  });
});
