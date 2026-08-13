/**
 * Tests for the pure helpers in scripts/chartink-capture/capture-core.ts:
 * clipboard TSV parsing, clause merging into JSON configs, CLI arg parsing.
 */

import {
  parseClipboardTable,
  mergeCapturedClause,
  parseArgs,
  listValue,
  type CapturedTemplate,
} from "../../chartink-capture/capture-core";

describe("parseClipboardTable (Copy → Copy table TSV)", () => {
  test("parses a standard screener TSV with alias mapping", () => {
    const tsv = [
      "sr\tnsecode\tname\tbsecode\tDaily Close\tDaily % change\tDaily Volume",
      "1\tTIJARIA\tTijaria Polypipes Ltd.\t538629\t14.5\t15.9\t2,482,221",
      "2\tRELCAPITAL\tReliance Capital Ltd.\t541493\t11.19\t-4.85\t55",
    ].join("\n");

    const rows = parseClipboardTable(tsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      nsecode: "TIJARIA",
      name: "Tijaria Polypipes Ltd.",
      bsecode: "538629",
      "scan-column-default-close": 14.5,
      "scan-column-default-percent-change": 15.9,
      "scan-column-default-volume": 2482221,
    });
  });

  test("keeps numbers signed and handles ₹ symbols/commas", () => {
    const tsv = [
      "nsecode\tDaily Close\tDaily % change",
      "ABOVE\t₹1,234.56\t-2.5%",
    ].join("\n");
    const rows = parseClipboardTable(tsv);
    expect(rows[0]["scan-column-default-close"]).toBe(1234.56);
    expect(rows[0]["scan-column-default-percent-change"]).toBe(-2.5);
  });

  test("drops rows without an nsecode column", () => {
    expect(parseClipboardTable("a\tb\n1\t2\n")).toEqual([]);
  });

  test("drops rows with empty nsecode cell", () => {
    const tsv = ["nsecode\tname", "\tSomething"].join("\n");
    expect(parseClipboardTable(tsv)).toEqual([]);
  });

  test("returns [] for blank/single-line input", () => {
    expect(parseClipboardTable("")).toEqual([]);
    expect(parseClipboardTable("only a header")).toEqual([]);
  });
});

describe("mergeCapturedClause (JSON config write-back)", () => {
  const base = {
    id: "fundamental.sales-jump-by-200",
    name: "Sales jump by 200%",
    url: "https://chartink.com/scanner/sales-jump-by-200",
    categoryId: "fundamental",
  };

  test("fills missing clauses from a capture", () => {
    const captured: Pick<
      CapturedTemplate,
      "scanClause" | "debugClause" | "columnClause" | "backtestMaxRows"
    > = {
      scanClause: "( {cash} ( yearly net profit > ... ) )",
      debugClause: "groupcount( 1 where ... )",
      columnClause: "Daily Close as 'x'",
      backtestMaxRows: 160,
    };
    const out = mergeCapturedClause(base, captured);
    expect(out.scanClause).toBe(captured.scanClause);
    expect(out.debugClause).toBe(captured.debugClause);
    expect(out.columnClause).toBe(captured.columnClause);
    expect(out.backtestMaxRows).toBe(160);
  });

  test("keeps an existing curated clause (first value wins)", () => {
    const withClause = { ...base, scanClause: "( curated )" };
    const out = mergeCapturedClause(withClause, {
      scanClause: "( captured )",
    });
    expect(out.scanClause).toBe("( curated )");
  });

  test("ignores empty captures entirely", () => {
    const out = mergeCapturedClause(base, {});
    expect(out).toEqual(base);
  });
});

describe("parseArgs", () => {
  test("parses --flag value, --flag=value, and bare --flag", () => {
    const args = parseArgs([
      "node",
      "capture.ts",
      "--category",
      "fundamental",
      "--id=fundamental.profit-jump-by-200",
      "--dry-run",
    ]);
    expect(args["category"]).toBe("fundamental");
    expect(args["id"]).toBe("fundamental.profit-jump-by-200");
    expect(args["dry-run"]).toBe(true);
  });

  test("treats the next --flag as a bare flag", () => {
    const args = parseArgs(["--no-db", "--headful"]);
    expect(args["no-db"]).toBe(true);
    expect(args["headful"]).toBe(true);
  });

  test("ignores non-flag tokens", () => {
    const args = parseArgs(["some", "positional", "--ttl", "48"]);
    expect(args["ttl"]).toBe("48");
  });
});

describe("listValue", () => {
  test("splits comma-separated ids and filters empties", () => {
    expect(listValue("a,b , c")).toEqual(["a", "b", "c"]);
    expect(listValue("")).toEqual([]);
    expect(listValue(true)).toEqual([]);
  });
});