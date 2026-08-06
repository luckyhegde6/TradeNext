/**
 * Filter Engine — evaluates FilterGroup condition trees against stock data.
 *
 * Handles:
 *   - Recursive AND/OR group evaluation
 *   - All numeric operators (gt, gte, lt, lte, eq, neq, between, crosses)
 *   - String operators (eq, neq, in, not_in)
 *   - Field value resolution (including nested keys like "MACD.macd")
 *   - TypeScript type guards for safe field access
 */

import type {
  FilterGroup,
  FilterCondition,
  NumericConditionValue,
  StringConditionValue,
} from "./condition-tree";
import { getFieldMeta, isNumericField } from "./condition-tree";

// ============================================================
// Value resolution helpers
// ============================================================

/**
 * Safely resolve a dot-notation field path from a data object.
 * e.g., "MACD.macd" → data["MACD.macd"] || data.MACD?.macd
 */
export function resolveFieldValue(data: Record<string, unknown>, field: string): unknown {
  // Try direct key first (most TV columns use dot in name)
  if (field in data) return data[field];

  // Try nested path: "MACD.macd" → data.MACD?.macd
  if (field.includes(".")) {
    const parts = field.split(".");
    let current: unknown = data;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  return undefined;
}

/**
 * Parse a numeric value from an unknown source, returning null if not possible.
 */
function asNumber(val: unknown): number | null {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// ============================================================
// Numeric condition evaluation
// ============================================================

function evaluateNumeric(
  fieldValue: unknown,
  condition: NumericConditionValue
): boolean {
  const val = asNumber(fieldValue);
  if (val === null) return false;

  const { operator, value, value2, field2 } = condition;

  switch (operator) {
    case "gt":
      return val > value;
    case "gte":
      return val >= value;
    case "lt":
      return val < value;
    case "lte":
      return val <= value;
    case "eq":
      return val === value;
    case "neq":
      return val !== value;
    case "between":
      if (value2 === undefined) return val >= value;
      return val >= value && val <= value2;

    // Crossover conditions — require comparison between two values
    // Note: True crossover detection requires sequential data.
    // Here we compare current value vs field2 value (single snapshot check).
    case "crosses_above":
      if (!field2) return false;
      return val > value; // Simplified: current > threshold
    case "crosses_below":
      if (!field2) return false;
      return val < value; // Simplified: current < threshold

    default:
      return false;
  }
}

// ============================================================
// String condition evaluation
// ============================================================

function evaluateString(
  fieldValue: unknown,
  condition: StringConditionValue
): boolean {
  if (typeof fieldValue !== "string") return false;

  const val = fieldValue.toLowerCase();
  const { operator, value } = condition;

  switch (operator) {
    case "eq":
      return val === String(value).toLowerCase();
    case "neq":
      return val !== String(value).toLowerCase();
    case "in": {
      const list = Array.isArray(value) ? value : [value];
      return list.some((v) => val === String(v).toLowerCase());
    }
    case "not_in": {
      const list = Array.isArray(value) ? value : [value];
      return !list.some((v) => val === String(v).toLowerCase());
    }
    default:
      return false;
  }
}

// ============================================================
// Single condition evaluator
// ============================================================

/**
 * Evaluate a single filter condition against a stock data record.
 */
export function evaluateCondition(
  condition: FilterCondition,
  stock: Record<string, unknown>
): boolean {
  const fieldValue = resolveFieldValue(stock, condition.field);

  // Determine operator type and dispatch
  const cond = condition.condition;

  if ("operator" in cond) {
    const operator = cond.operator;

    // Numeric-only operators (gt, gte, lt, lte, between, crosses)
    if (
      operator === "gt" || operator === "gte" || operator === "lt" ||
      operator === "lte" || operator === "between" ||
      operator === "crosses_above" || operator === "crosses_below"
    ) {
      return evaluateNumeric(fieldValue, cond as NumericConditionValue);
    }

    // eq / neq — dispatch based on field type (numeric or string)
    if (operator === "eq" || operator === "neq") {
      const isNum = isNumericField(condition.field);
      if (isNum) {
        return evaluateNumeric(fieldValue, cond as NumericConditionValue);
      }
      return evaluateString(fieldValue, cond as StringConditionValue);
    }

    // String operators (in, not_in)
    if (operator === "in" || operator === "not_in") {
      return evaluateString(fieldValue, cond as StringConditionValue);
    }
  }

  return false;
}

// ============================================================
// Filter Group evaluation (recursive)
// ============================================================

/**
 * Evaluate an entire FilterGroup tree against a stock data record.
 * Recursively processes nested groups with AND/OR logic.
 */
export function evaluateFilterGroup(
  group: FilterGroup,
  stock: Record<string, unknown>
): boolean {
  if (group.conditions.length === 0 && group.groups.length === 0) {
    // Empty group is trivially true (matches everything)
    return true;
  }

  const results: boolean[] = [];

  // Evaluate direct conditions
  for (const condition of group.conditions) {
    results.push(evaluateCondition(condition, stock));
  }

  // Recursively evaluate sub-groups
  for (const subGroup of group.groups) {
    results.push(evaluateFilterGroup(subGroup, stock));
  }

  if (results.length === 0) return true;

  if (group.logic === "AND") {
    return results.every(Boolean);
  } else {
    return results.some(Boolean);
  }
}

// ============================================================
// Batch evaluation
// ============================================================

export interface EvaluationResult {
  passed: boolean;
  matchedConditions: string[]; // IDs of matched conditions
  failedConditions: string[];  // IDs of failed conditions
}

/**
 * Evaluate a filter group tree and return detailed match info.
 * Useful for showing why a stock passed/failed in the UI.
 */
export function evaluateWithDetails(
  group: FilterGroup,
  stock: Record<string, unknown>
): EvaluationResult {
  const matchedConditions: string[] = [];
  const failedConditions: string[] = [];

  function walk(g: FilterGroup): boolean {
    const results: boolean[] = [];

    for (const condition of g.conditions) {
      const passed = evaluateCondition(condition, stock);
      results.push(passed);
      if (passed) {
        matchedConditions.push(condition.id);
      } else {
        failedConditions.push(condition.id);
      }
    }

    for (const sg of g.groups) {
      results.push(walk(sg));
    }

    if (results.length === 0) return true;
    return g.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
  }

  const passed = walk(group);
  return { passed, matchedConditions, failedConditions };
}

/**
 * Apply a filter group to a batch of stocks and return filtered + sorted results.
 */
export function applyFilterGroup(
  filterGroup: FilterGroup,
  stocks: Record<string, unknown>[],
  options?: {
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }
): { stocks: Record<string, unknown>[]; total: number } {
  // Filter
  const filtered = stocks.filter((stock) =>
    evaluateFilterGroup(filterGroup, stock)
  );

  // Sort
  if (options?.sortBy) {
    const { sortBy, sortOrder = "desc" } = options;
    filtered.sort((a, b) => {
      const valA = asNumber(resolveFieldValue(a, sortBy)) ?? 0;
      const valB = asNumber(resolveFieldValue(b, sortBy)) ?? 0;
      return sortOrder === "asc" ? valA - valB : valB - valA;
    });
  }

  const total = filtered.length;

  // Paginate
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 50;
  const paginated = filtered.slice(offset, offset + limit);

  return { stocks: paginated, total };
}

/**
 * Validate a filter group — check field names exist and values are reasonable.
 * Returns list of validation errors (empty = valid).
 */
export function validateFilterGroup(
  group: FilterGroup,
  maxConditions: number = 50
): string[] {
  const errors: string[] = [];
  let conditionCount = 0;

  function walk(g: FilterGroup) {
    for (const condition of g.conditions) {
      conditionCount++;
      const meta = getFieldMeta(condition.field);
      if (!meta) {
        errors.push(`Unknown field: "${condition.field}"`);
        continue;
      }

      const cond = condition.condition;
      if ("operator" in cond) {
        // Validate numeric conditions
        if (
          cond.operator === "gt" || cond.operator === "gte" ||
          cond.operator === "lt" || cond.operator === "lte" ||
          cond.operator === "eq" || cond.operator === "neq"
        ) {
          if (typeof cond.value !== "number" || isNaN(cond.value)) {
            errors.push(`"${condition.field}": invalid numeric value`);
          }
        }
        if (cond.operator === "between" && cond.value2 !== undefined) {
          if (typeof cond.value2 !== "number" || cond.value2 < cond.value) {
            errors.push(`"${condition.field}": invalid range (value2 < value)`);
          }
        }
      }
    }

    for (const sg of g.groups) walk(sg);
  }

  walk(group);

  if (conditionCount > maxConditions) {
    errors.push(`Too many conditions: ${conditionCount} (max ${maxConditions})`);
  }

  return errors;
}
