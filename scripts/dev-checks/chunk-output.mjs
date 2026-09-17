#!/usr/bin/env node
/**
 * chunk-output.mjs — split a large captured tool output into grep-able chunks + an index.
 *
 * Why: large tool outputs stay resident in the conversation transcript and are re-sent on
 * every request, which refills context immediately after each compaction (the "compaction
 * loop"). Redirecting output to a file and reading only a slice/grep keeps the transcript flat.
 *
 * Usage:
 *   node scripts/dev-checks/chunk-output.mjs <input-file> [--lines N] [--out DIR]
 *
 * Behaviour:
 *   - Splits by line count (default 400).
 *   - Each chunk records its ORIGINAL line range in a `# chunk i/K — name — original lines A-B`
 *     header, so a reader can map a hit back to the source file.
 *   - Writes `<out>/<name>.index.md` listing chunk files + the first line of each.
 *   - Deterministic + idempotent: re-running over unchanged input yields byte-identical output
 *     (stale `<name>.part-*.txt` from a previous run are removed first).
 *   - Node built-ins only. No network, no DB.
 *
 * Exit codes: 0 = ok (incl. empty input), 1 = usage/missing-input error.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_LINES = 400;
const DEFAULT_OUT = ".context/out";
const FIRST_LINE_MAX = 100;

/** Normalize EOLs and split into lines, dropping the artifact of a trailing newline. */
export function splitLines(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized === "") return [];
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Group lines into chunks that carry their original 1-based source line range. */
export function planChunks(lines, size) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) {
    chunks.push({
      index: chunks.length + 1,
      start: i + 1,
      end: Math.min(i + size, lines.length),
      lines: lines.slice(i, i + size),
    });
  }
  return chunks;
}

export function renderChunk(name, chunk, total) {
  const header = `# chunk ${chunk.index}/${total} — ${name} — original lines ${chunk.start}-${chunk.end}`;
  return `${header}\n${chunk.lines.join("\n")}\n`;
}

function escapeCell(value) {
  const oneLine = value.replace(/\|/g, "\\|").trim();
  return oneLine.length > FIRST_LINE_MAX ? `${oneLine.slice(0, FIRST_LINE_MAX)}…` : oneLine;
}

export function renderIndex(name, sourcePath, chunks, linesPerChunk, totalLines) {
  const rows = chunks
    .map((chunk) => {
      const file = `${name}.part-${String(chunk.index).padStart(2, "0")}.txt`;
      const first = chunk.lines[0] ?? "";
      return `| ${chunk.index} | \`${file}\` | ${chunk.start}-${chunk.end} | ${escapeCell(first)} |`;
    })
    .join("\n");

  return [
    `# Chunk Index — ${name}`,
    "",
    `- source: \`${sourcePath}\``,
    `- total_lines: ${totalLines}`,
    `- lines_per_chunk: ${linesPerChunk}`,
    `- chunks: ${chunks.length}`,
    "",
    "> Each `part-NN.txt` starts with a `# chunk i/K — name — original lines A-B` header, then the",
    "> raw source lines. Map a chunk position `p` (1-based, after the header) to a source line with:",
    "> `original = A + (p - 1)`.",
    "",
    "| # | file | original lines | first line |",
    "|---|------|----------------|------------|",
    rows,
    "",
  ].join("\n");
}

/**
 * Split `inputPath` into chunks under `outDir`.
 * Returns a summary object; writes nothing when the input has no lines.
 */
export async function chunkOutput(inputPath, options = {}) {
  const linesPerChunk = options.lines ?? DEFAULT_LINES;
  const outDir = options.out ?? DEFAULT_OUT;
  if (!Number.isInteger(linesPerChunk) || linesPerChunk < 1) {
    throw new Error(`--lines must be a positive integer, got: ${options.lines}`);
  }

  const name = path.basename(inputPath, path.extname(inputPath));
  const raw = await readFile(inputPath, "utf8");
  const lines = splitLines(raw);

  await mkdir(outDir, { recursive: true });

  // Idempotency: drop this name's artifacts from any previous run before rewriting.
  const existing = await readdir(outDir);
  await Promise.all(
    existing
      .filter((f) => f.startsWith(`${name}.part-`) || f === `${name}.index.md`)
      .map((f) => rm(path.join(outDir, f), { force: true }))
  );

  if (lines.length === 0) {
    return { name, sourcePath: inputPath, totalLines: 0, linesPerChunk, chunks: [], written: [] };
  }

  const chunks = planChunks(lines, linesPerChunk);
  const written = [];
  for (const chunk of chunks) {
    const file = `${name}.part-${String(chunk.index).padStart(2, "0")}.txt`;
    await writeFile(path.join(outDir, file), renderChunk(name, chunk, chunks.length), "utf8");
    written.push(file);
  }

  const indexFile = `${name}.index.md`;
  await writeFile(
    path.join(outDir, indexFile),
    renderIndex(name, inputPath, chunks, linesPerChunk, lines.length),
    "utf8"
  );
  written.push(indexFile);

  return { name, sourcePath: inputPath, totalLines: lines.length, linesPerChunk, chunks, written };
}

function parseArgs(argv) {
  const args = { input: undefined, lines: DEFAULT_LINES, out: DEFAULT_OUT };
  const rest = [...argv];
  while (rest.length > 0) {
    const token = rest.shift();
    if (token === "--lines") {
      const raw = rest.shift();
      args.lines = Number.parseInt(raw ?? "", 10);
      if (!raw || Number.isNaN(args.lines)) {
        return { error: `--lines requires an integer value (got: ${raw ?? "<missing>"})` };
      }
    } else if (token === "--out") {
      const raw = rest.shift();
      if (!raw) return { error: "--out requires a directory path" };
      args.out = raw;
    } else if (token === "--help" || token === "-h") {
      return { help: true };
    } else if (args.input === undefined) {
      args.input = token;
    } else {
      return { error: `unexpected argument: ${token}` };
    }
  }
  return args;
}

const USAGE = [
  "Usage: node scripts/dev-checks/chunk-output.mjs <input-file> [--lines N] [--out DIR]",
  "",
  "  <input-file>   File to split (e.g. .context/out/build.log)",
  "  --lines N      Lines per chunk (default 400)",
  "  --out DIR      Output directory (default .context/out)",
].join("\n");

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.error) {
    process.stderr.write(`chunk-output: ${parsed.error}\n${USAGE}\n`);
    return 1;
  }
  if (!parsed.input) {
    process.stderr.write(`chunk-output: missing <input-file>\n${USAGE}\n`);
    return 1;
  }

  let summary;
  try {
    summary = await chunkOutput(parsed.input, { lines: parsed.lines, out: parsed.out });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`chunk-output: failed to chunk "${parsed.input}": ${message}\n`);
    return 1;
  }

  if (summary.totalLines === 0) {
    process.stdout.write(`chunk-output: "${parsed.input}" is empty — nothing written.\n`);
    return 0;
  }

  process.stdout.write(
    [
      `chunk-output: ${parsed.input}`,
      `  total_lines   ${summary.totalLines}`,
      `  lines/chunk   ${summary.linesPerChunk}`,
      `  chunks        ${summary.chunks.length}`,
      `  out           ${parsed.out}`,
      `  index         ${summary.name}.index.md`,
      "",
    ].join("\n")
  );
  return 0;
}

// Only run when invoked directly (not when imported by a test).
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`chunk-output: unexpected error: ${error}\n`);
      process.exit(1);
    }
  );
}
