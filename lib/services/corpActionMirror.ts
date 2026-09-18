/**
 * Corporate-action mirror mapper.
 *
 * The SQLite mirror (`lib/sqlite.ts` → `getCorporateActions`) returns raw rows
 * keyed by the `corporate_action` table's snake_case columns, while the Prisma
 * path in `app/api/corporate-actions/combined/route.ts` returns camelCase DTOs.
 * The mirror branch is therefore a *second implementation* of the same contract
 * (Lessons 129) — without this mapper the two paths disagree and camelCase
 * consumers (calendar, admin/analytics tables, dividend calendar) silently drop
 * every row.
 *
 * `mapMirrorCorporateAction` normalises a mirror row to the Prisma DTO shape.
 * It is tolerant of both snake_case and camelCase input (idempotent) and never
 * throws.
 */

export interface MirrorCorporateAction {
  id: number | string;
  symbol: string;
  companyName: string | null;
  series: string | null;
  subject: string | null;
  actionType: string;
  exDate: string | null;
  recordDate: string | null;
  effectiveDate: string | null;
  faceValue: string | null;
  oldFV: string | null;
  newFV: string | null;
  ratio: string | null;
  dividendPerShare: number | null;
  dividendYield: number | null;
  isin: string | null;
  bookClosureStartDate: string | null;
  bookClosureEndDate: string | null;
  announcementDate: string | null;
  source: string;
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStr(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toId(value: unknown): number | string {
  if (typeof value === "number") return value;
  const n = toNum(value);
  return n !== null ? n : String(value ?? "");
}

export function mapMirrorCorporateAction(
  row: Record<string, unknown>,
): MirrorCorporateAction {
  return {
    id: toId(row.id),
    symbol: toStr(pick(row, ["symbol"])) ?? "",
    companyName: toStr(pick(row, ["companyName", "company_name"])),
    series: toStr(pick(row, ["series"])),
    subject: toStr(pick(row, ["subject"])),
    actionType: toStr(pick(row, ["actionType", "action_type"])) ?? "",
    exDate: toStr(pick(row, ["exDate", "ex_date"])),
    recordDate: toStr(pick(row, ["recordDate", "record_date"])),
    effectiveDate: toStr(pick(row, ["effectiveDate", "effective_date"])),
    faceValue: toStr(pick(row, ["faceValue", "face_value"])),
    oldFV: toStr(pick(row, ["oldFV", "old_fv"])),
    newFV: toStr(pick(row, ["newFV", "new_fv"])),
    ratio: toStr(pick(row, ["ratio"])),
    dividendPerShare: toNum(pick(row, ["dividendPerShare", "dividend_per_share"])),
    dividendYield: toNum(pick(row, ["dividendYield", "dividend_yield"])),
    isin: toStr(pick(row, ["isin"])),
    bookClosureStartDate: toStr(
      pick(row, ["bookClosureStartDate", "book_closure_start_date"]),
    ),
    bookClosureEndDate: toStr(
      pick(row, ["bookClosureEndDate", "book_closure_end_date"]),
    ),
    announcementDate: toStr(
      pick(row, ["announcementDate", "announcement_date"]),
    ),
    source: toStr(pick(row, ["source"])) ?? "sqlite_mirror",
  };
}
