import { mapMirrorCorporateAction } from "@/lib/services/corpActionMirror";

/**
 * Contract parity tests for the corporate-action mirror mapper (BUGS 16).
 *
 * The SQLite mirror returns raw snake_case rows while the Prisma path returns
 * camelCase DTOs. A fallback branch is a second implementation of the same
 * contract (Lessons 129) — if the two disagree, camelCase consumers silently
 * drop every row.
 */
describe("mapMirrorCorporateAction", () => {
  const snakeRow: Record<string, unknown> = {
    id: 7,
    symbol: "RELIANCE",
    company_name: "Reliance Industries Ltd",
    series: "EQ",
    subject: "Dividend",
    action_type: "DIVIDEND",
    ex_date: "2026-09-22T00:00:00.000Z",
    record_date: "2026-09-23T00:00:00.000Z",
    effective_date: null,
    face_value: "10",
    old_fv: "2",
    new_fv: null,
    ratio: null,
    dividend_per_share: "12.5",
    dividend_yield: 1.01,
    isin: "INE002A01018",
    book_closure_start_date: null,
    book_closure_end_date: null,
    announcement_date: "2026-09-01T00:00:00.000Z",
    source: "nse",
  };

  it("maps snake_case mirror columns to the Prisma camelCase DTO", () => {
    const dto = mapMirrorCorporateAction(snakeRow);

    expect(dto).toEqual({
      id: 7,
      symbol: "RELIANCE",
      companyName: "Reliance Industries Ltd",
      series: "EQ",
      subject: "Dividend",
      actionType: "DIVIDEND",
      exDate: "2026-09-22T00:00:00.000Z",
      recordDate: "2026-09-23T00:00:00.000Z",
      effectiveDate: null,
      faceValue: "10",
      oldFV: "2",
      newFV: null,
      ratio: null,
      dividendPerShare: 12.5,
      dividendYield: 1.01,
      isin: "INE002A01018",
      bookClosureStartDate: null,
      bookClosureEndDate: null,
      announcementDate: "2026-09-01T00:00:00.000Z",
      source: "nse",
    });
  });

  it("does not leak snake_case keys (the exact bug that blanked the calendar)", () => {
    const dto = mapMirrorCorporateAction(snakeRow) as unknown as Record<string, unknown>;
    expect(dto).not.toHaveProperty("company_name");
    expect(dto).not.toHaveProperty("action_type");
    expect(dto).not.toHaveProperty("ex_date");
    expect(dto).not.toHaveProperty("dividend_per_share");
    expect(dto).not.toHaveProperty("old_fv");
  });

  it("is idempotent for already-camelCase rows", () => {
    const camel = {
      id: 3,
      symbol: "TCS",
      companyName: "Tata Consultancy Services",
      actionType: "BONUS",
      exDate: "2026-10-01T00:00:00.000Z",
      oldFV: "1",
      newFV: "2",
    };
    expect(mapMirrorCorporateAction(camel)).toMatchObject({
      id: 3,
      symbol: "TCS",
      companyName: "Tata Consultancy Services",
      actionType: "BONUS",
      exDate: "2026-10-01T00:00:00.000Z",
      oldFV: "1",
      newFV: "2",
    });
  });

  it("coerces numeric strings and nulls blank/absent values", () => {
    const dto = mapMirrorCorporateAction({
      id: "9",
      symbol: "X",
      dividend_per_share: "0",
      dividend_yield: "",
    });
    expect(dto.id).toBe(9);
    expect(dto.dividendPerShare).toBe(0);
    expect(dto.dividendYield).toBeNull();
  });

  it("never throws and degrades safely on a sparse row", () => {
    expect(() => mapMirrorCorporateAction({})).not.toThrow();
    const dto = mapMirrorCorporateAction({});
    expect(dto.symbol).toBe("");
    expect(dto.actionType).toBe("");
    expect(dto.dividendPerShare).toBeNull();
  });
});
