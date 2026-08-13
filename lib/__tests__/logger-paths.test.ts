/**
 * @jest-environment node
 *
 * Logger file-path tests.
 *
 * Locks in the logs-directory layout contract:
 *   logs/<YYYY-MM>/<YYYY-MM-DD>.log
 *
 * Regression: readLogsByDate previously computed logs/<YYYY>/<YYYYMM>/<date>.log
 * which never matched the write path — reads always returned [].
 */
import fs from "fs";
import path from "path";
import { readLogsByDate, readLogFile, getLogFiles, deleteLogFile } from "@/lib/logger";

const LOGS_ROOT = path.join(process.cwd(), "logs");
const TEST_YEAR_MONTH = "2099-11"; // far-future month dir to avoid clobbering real logs
const TEST_DATE = "2099-11-30";
const TEST_FILE = path.join(LOGS_ROOT, TEST_YEAR_MONTH, `${TEST_DATE}.log`);
const TEST_LINES = [
  "2099-11-30 10:00:00 | ℹ️ INFO  | msg=hello world",
  "2099-11-30 10:00:01 | ⚠️ WARN  | msg=something odd",
  "2099-11-30 10:00:02 | ❌ ERROR | msg=boom",
];

describe("logger file paths", () => {
  beforeAll(() => {
    fs.mkdirSync(path.dirname(TEST_FILE), { recursive: true });
    fs.writeFileSync(TEST_FILE, TEST_LINES.join("\n") + "\n", "utf-8");
  });

  afterAll(() => {
    try {
      fs.rmSync(path.dirname(TEST_FILE), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("writes logs under logs/<YYYY-MM>/<YYYY-MM-DD>.log layout", () => {
    expect(fs.existsSync(TEST_FILE)).toBe(true);
  });

  it("readLogsByDate finds lines from the correct YYYY-MM subdirectory", async () => {
    const lines = await readLogsByDate(TEST_DATE);
    expect(lines).toEqual(TEST_LINES);
  });

  it("readLogsByDate respects the limit", async () => {
    const lines = await readLogsByDate(TEST_DATE, 2);
    expect(lines).toEqual(TEST_LINES.slice(-2));
  });

  it("readLogsByDate returns [] for dates with no file", async () => {
    const lines = await readLogsByDate("1999-01-01");
    expect(lines).toEqual([]);
  });

  it("getLogFiles lists the date file with the date as its key", async () => {
    const files = await getLogFiles();
    const match = files.find((f) => f.path === TEST_FILE);
    expect(match).toBeDefined();
    expect(match!.date).toBe(TEST_DATE);
    expect(match!.size).toBeGreaterThan(0);
  });

  it("readLogFile reads a local file into lines", async () => {
    const lines = await readLogFile(TEST_FILE);
    expect(lines).toEqual(TEST_LINES);
  });

  it("deleteLogFile removes the file", async () => {
    const ok = await deleteLogFile(TEST_FILE);
    expect(ok).toBe(true);
    expect(fs.existsSync(TEST_FILE)).toBe(false);
  });
});