/**
 * Tests for scripts/dev-checks/chunk-output.mjs
 *
 * The script is an ESM `.mjs` CLI. To avoid Jest ESM/CJS transform interop issues
 * (jest.config.cjs uses next/jest with a jsdom environment), behaviour is verified
 * end-to-end by spawning the real CLI and asserting exit codes + emitted artifacts.
 * This is stronger than unit-testing internals: it exercises arg parsing, file IO,
 * exit codes and idempotency exactly as an agent would.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../scripts/dev-checks/chunk-output.mjs");
const REPO_ROOT = path.resolve(__dirname, "../..");

type RunResult = { status: number; stdout: string; stderr: string };

/** Spawn the CLI in `cwd`; never throw, so exit codes can be asserted. */
function run(args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** Make a throwaway workspace with an `in` dir for inputs and an `out` dir for chunks. */
function makeWorkspace(): { dir: string; outDir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "chunk-output-"));
  const outDir = path.join(dir, "out");
  return {
    dir,
    outDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeLines(count: number, prefix = "line"): string {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`).join("\n") + "\n";
}

function partsIn(outDir: string): string[] {
  return readdirSync(outDir)
    .filter((f) => f.includes(".part-"))
    .sort();
}

describe("chunk-output.mjs", () => {
  const workspaces: Array<() => void> = [];

  afterEach(() => {
    while (workspaces.length > 0) workspaces.pop()?.();
  });

  function ws() {
    const w = makeWorkspace();
    workspaces.push(w.cleanup);
    return w;
  }

  it("splits by line count and records original line ranges in the index", () => {
    const { dir, outDir } = ws();
    const input = path.join(dir, "sample.txt");
    writeFileSync(input, makeLines(250), "utf8");

    const result = run([input, "--lines", "100", "--out", outDir], dir);

    expect(result.status).toBe(0);
    expect(partsIn(outDir)).toEqual([
      "sample.part-01.txt",
      "sample.part-02.txt",
      "sample.part-03.txt",
    ]);

    const index = readFileSync(path.join(outDir, "sample.index.md"), "utf8");
    expect(index).toContain("total_lines: 250");
    expect(index).toContain("lines_per_chunk: 100");
    expect(index).toContain("chunks: 3");
    expect(index).toContain("1-100");
    expect(index).toContain("101-200");
    // final chunk is short — must not claim 300
    expect(index).toContain("201-250");
    expect(index).not.toContain("201-300");
  });

  it("preserves original line numbers in each chunk header", () => {
    const { dir, outDir } = ws();
    const input = path.join(dir, "ranges.txt");
    writeFileSync(input, makeLines(45), "utf8");

    run([input, "--lines", "20", "--out", outDir], dir);

    const firstLines = readFileSync(path.join(outDir, "ranges.part-01.txt"), "utf8").split("\n");
    const secondLines = readFileSync(path.join(outDir, "ranges.part-02.txt"), "utf8").split("\n");
    const thirdLines = readFileSync(path.join(outDir, "ranges.part-03.txt"), "utf8").split("\n");

    expect(firstLines[0]).toBe("# chunk 1/3 — ranges — original lines 1-20");
    expect(firstLines[1]).toBe("line-1");
    expect(secondLines[0]).toBe("# chunk 2/3 — ranges — original lines 21-40");
    expect(secondLines[1]).toBe("line-21");
    expect(thirdLines[0]).toBe("# chunk 3/3 — ranges — original lines 41-45");
    expect(thirdLines[1]).toBe("line-41");
  });

  it("is idempotent — re-running over unchanged input is byte-identical", () => {
    const { dir, outDir } = ws();
    const input = path.join(dir, "stable.txt");
    writeFileSync(input, makeLines(120), "utf8");

    run([input, "--lines", "50", "--out", outDir], dir);
    const before = {
      part: readFileSync(path.join(outDir, "stable.part-01.txt"), "utf8"),
      index: readFileSync(path.join(outDir, "stable.index.md"), "utf8"),
      listing: partsIn(outDir),
    };

    run([input, "--lines", "50", "--out", outDir], dir);
    const after = {
      part: readFileSync(path.join(outDir, "stable.part-01.txt"), "utf8"),
      index: readFileSync(path.join(outDir, "stable.index.md"), "utf8"),
      listing: partsIn(outDir),
    };

    expect(after.part).toBe(before.part);
    expect(after.index).toBe(before.index);
    expect(after.listing).toEqual(before.listing);
  });

  it("removes stale parts when re-run with a larger chunk size", () => {
    const { dir, outDir } = ws();
    const input = path.join(dir, "shrink.txt");
    writeFileSync(input, makeLines(200), "utf8");

    run([input, "--lines", "50", "--out", outDir], dir);
    expect(partsIn(outDir)).toHaveLength(4);

    run([input, "--lines", "200", "--out", outDir], dir);
    expect(partsIn(outDir)).toEqual(["shrink.part-01.txt"]);
  });

  it("treats an empty input as success and writes nothing", () => {
    const { dir, outDir } = ws();
    const input = path.join(dir, "empty.txt");
    writeFileSync(input, "", "utf8");

    const result = run([input, "--out", outDir], dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("is empty");
    expect(existsSync(outDir) ? partsIn(outDir) : []).toEqual([]);
  });

  it("handles input smaller than one chunk (single part)", () => {
    const { dir, outDir } = ws();
    const input = path.join(dir, "tiny.txt");
    writeFileSync(input, "only-one-line\n", "utf8");

    const result = run([input, "--lines", "400", "--out", outDir], dir);

    expect(result.status).toBe(0);
    expect(partsIn(outDir)).toEqual(["tiny.part-01.txt"]);
    expect(readFileSync(path.join(outDir, "tiny.part-01.txt"), "utf8")).toContain(
      "original lines 1-1"
    );
  });

  it("normalises CRLF so line counts match on Windows", () => {
    const { dir, outDir } = ws();
    const input = path.join(dir, "crlf.txt");
    writeFileSync(input, "a\r\nb\r\nc\r\n", "utf8");

    run([input, "--lines", "2", "--out", outDir], dir);

    const index = readFileSync(path.join(outDir, "crlf.index.md"), "utf8");
    expect(index).toContain("total_lines: 3");
    expect(index).toContain("chunks: 2");
  });

  it("exits non-zero with usage when no input file is given", () => {
    const { dir } = ws();
    const result = run([], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing <input-file>");
    expect(result.stderr).toContain("Usage:");
  });

  it("exits non-zero when the input file does not exist", () => {
    const { dir, outDir } = ws();
    const result = run([path.join(dir, "nope.txt"), "--out", outDir], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("failed to chunk");
  });

  it("exits non-zero when --lines is not a valid integer", () => {
    const { dir, outDir } = ws();
    const input = path.join(dir, "x.txt");
    writeFileSync(input, makeLines(10), "utf8");

    const result = run([input, "--lines", "abc", "--out", outDir], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--lines requires an integer");
  });
});

describe("context scratch dirs stay untracked", () => {
  /** git check-ignore exits 0 when the path IS ignored. */
  function isGitIgnored(relPath: string): boolean {
    try {
      execFileSync("git", ["check-ignore", "-q", relPath], { cwd: REPO_ROOT, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  it("ignores .context/ (tool-output scratch)", () => {
    expect(isGitIgnored(".context/out/anything.txt")).toBe(true);
  });

  it("ignores .remember/ (local rolling memory)", () => {
    expect(isGitIgnored(".remember/now.md")).toBe(true);
  });
});
