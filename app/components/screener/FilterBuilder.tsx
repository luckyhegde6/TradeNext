"use client";

import { useState, useCallback } from "react";
import type { FilterGroup, FilterCondition, FilterField, ConditionValue } from "@/lib/screener/condition-tree";

// ============================================================
// Field definitions
// ============================================================

interface FieldOption {
  value: string;
  label: string;
  category: string;
  type: "number" | "string";
  hint?: string;       // shown below the input
  placeholder?: string; // input placeholder
  min?: number;
  max?: number;
}

const FIELD_OPTIONS: FieldOption[] = [
  // Price
  { value: "close", label: "Price", category: "Price", type: "number", hint: "Latest closing price (₹)", placeholder: "e.g. 500" },
  { value: "open", label: "Open", category: "Price", type: "number", hint: "Today's opening price (₹)", placeholder: "e.g. 510" },
  { value: "high", label: "High", category: "Price", type: "number", hint: "Today's high price (₹)", placeholder: "e.g. 520" },
  { value: "low", label: "Low", category: "Price", type: "number", hint: "Today's low price (₹)", placeholder: "e.g. 490" },
  { value: "change", label: "Change (₹)", category: "Price", type: "number", hint: "Absolute price change (₹)", placeholder: "e.g. 10.5" },
  { value: "change_percent", label: "% Change", category: "Price", type: "number", hint: "Daily % change", placeholder: "e.g. 2.5" },
  { value: "52_week_high", label: "52W High", category: "Price", type: "number", hint: "52-week high price (₹)", placeholder: "e.g. 1500" },
  { value: "52_week_low", label: "52W Low", category: "Price", type: "number", hint: "52-week low price (₹)", placeholder: "e.g. 800" },
  // Volume
  { value: "volume", label: "Volume", category: "Volume", type: "number", hint: "Traded volume (shares)", placeholder: "e.g. 500000" },
  { value: "relative_volume_10d_calc", label: "Relative Volume (10d)", category: "Volume", type: "number", hint: "1x = average volume", placeholder: "e.g. 1.5" },
  // Fundamentals
  { value: "market_cap_basic", label: "Market Cap", category: "Fundamental", type: "number", hint: "Total market cap (₹ Cr)", placeholder: "e.g. 50000" },
  { value: "price_earnings_ttm", label: "P/E (TTM)", category: "Fundamental", type: "number", hint: "Price-to-earnings ratio", placeholder: "e.g. 25" },
  { value: "price_book_ratio", label: "P/B", category: "Fundamental", type: "number", hint: "Price-to-book ratio", placeholder: "e.g. 3" },
  { value: "dividend_yield_recent", label: "Dividend Yield", category: "Fundamental", type: "number", hint: "Dividend yield %", placeholder: "e.g. 2.5" },
  { value: "return_on_equity_fq", label: "ROE", category: "Fundamental", type: "number", hint: "Return on equity %", placeholder: "e.g. 15" },
  { value: "debt_to_equity_fq", label: "Debt/Equity", category: "Fundamental", type: "number", hint: "Debt-to-equity ratio", placeholder: "e.g. 0.5" },
  { value: "eps_ttm", label: "EPS (TTM)", category: "Fundamental", type: "number", hint: "Earnings per share (₹)", placeholder: "e.g. 40" },
  { value: "sector", label: "Sector", category: "Fundamental", type: "string", hint: "NSE sector name", placeholder: "e.g. IT" },
  { value: "industry", label: "Industry", category: "Fundamental", type: "string", hint: "Industry classification", placeholder: "e.g. Banking" },
  // Technical
  { value: "RSI", label: "RSI (14)", category: "Technical", type: "number", hint: "Range: 0-100", placeholder: "e.g. 30", min: 0, max: 100 },
  { value: "MACD.macd", label: "MACD Line", category: "Technical", type: "number", hint: "MACD line value", placeholder: "e.g. 50" },
  { value: "MACD.signal", label: "MACD Signal", category: "Technical", type: "number", hint: "Signal line value", placeholder: "e.g. 48" },
  { value: "SMA20", label: "SMA (20)", category: "Technical", type: "number", hint: "20-period simple moving average (₹)", placeholder: "e.g. 500" },
  { value: "SMA50", label: "SMA (50)", category: "Technical", type: "number", hint: "50-period simple moving average (₹)", placeholder: "e.g. 480" },
  { value: "SMA200", label: "SMA (200)", category: "Technical", type: "number", hint: "200-period simple moving average (₹)", placeholder: "e.g. 450" },
  { value: "EMA20", label: "EMA (20)", category: "Technical", type: "number", hint: "20-period exponential moving average (₹)", placeholder: "e.g. 495" },
  { value: "BB.upper", label: "Bollinger Upper", category: "Technical", type: "number", hint: "Upper Bollinger Band", placeholder: "e.g. 550" },
  { value: "BB.middle", label: "Bollinger Middle", category: "Technical", type: "number", hint: "Middle Bollinger Band (SMA 20)", placeholder: "e.g. 500" },
  { value: "BB.lower", label: "Bollinger Lower", category: "Technical", type: "number", hint: "Lower Bollinger Band", placeholder: "e.g. 450" },
  { value: "ADX", label: "ADX", category: "Technical", type: "number", hint: "Trend strength (0-100). 25+ = strong", placeholder: "e.g. 30" },
  { value: "ATR", label: "ATR", category: "Technical", type: "number", hint: "Average true range (₹)", placeholder: "e.g. 15" },
  // Performance
  { value: "Perf.W", label: "1W Performance", category: "Performance", type: "number", hint: "1-week return %", placeholder: "e.g. 5" },
  { value: "Perf.M", label: "1M Performance", category: "Performance", type: "number", hint: "1-month return %", placeholder: "e.g. 10" },
  { value: "Perf.3M", label: "3M Performance", category: "Performance", type: "number", hint: "3-month return %", placeholder: "e.g. 20" },
  { value: "Perf.6M", label: "6M Performance", category: "Performance", type: "number", hint: "6-month return %", placeholder: "e.g. 30" },
  { value: "Perf.YTD", label: "YTD Performance", category: "Performance", type: "number", hint: "Year-to-date return %", placeholder: "e.g. 15" },
  { value: "Perf.12M", label: "1Y Performance", category: "Performance", type: "number", hint: "1-year return %", placeholder: "e.g. 40" },
  // Ratings
  { value: "technical_rating", label: "Technical Rating", category: "Rating", type: "string", hint: "Buy / Sell / Neutral", placeholder: "e.g. Buy" },
  { value: "recommendation", label: "Recommendation", category: "Rating", type: "string", hint: "Strong Buy / Buy / Hold / Sell / Strong Sell", placeholder: "e.g. Strong Buy" },
];

const NUMERIC_OPS = [
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "between", label: "Between" },
];

const STRING_OPS = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "in", label: "In list" },
  { value: "not_in", label: "Not in list" },
];

const CATEGORIES = ["Price", "Volume", "Fundamental", "Technical", "Performance", "Rating"];

// ============================================================
// Validation helpers
// ============================================================

/**
 * Returns a validation error message for a condition, or null if valid.
 */
function getConditionError(condition: FilterCondition, fieldType: "number" | "string"): string | null {
  const cond = condition.condition;
  const operator = "operator" in cond ? cond.operator : undefined;
  const value = "value" in cond ? (cond as any).value : undefined;
  const value2 = "value2" in cond ? (cond as any).value2 : undefined;

  if (fieldType === "number") {
    if (value === "" || value === undefined || value === null) {
      return "Enter a number";
    }
    const num = Number(value);
    if (isNaN(num)) {
      return "Invalid number";
    }
    // Check field-specific range
    const field = FIELD_OPTIONS.find((f) => f.value === condition.field);
    if (field) {
      if (field.min !== undefined && num < field.min) {
        return `Minimum value is ${field.min}`;
      }
      if (field.max !== undefined && num > field.max) {
        return `Maximum value is ${field.max}`;
      }
    }
    // Between validation
    if (operator === "between") {
      if (value2 === "" || value2 === undefined || value2 === null) {
        return "Enter max value";
      }
      if (Number(value2) <= num) {
        return "Max must be greater than Min";
      }
    }
  } else {
    // String type
    if (operator === "in" || operator === "not_in") {
      if (!Array.isArray(value) || value.length === 0) {
        return "Enter at least one value (comma-separated)";
      }
      if (value.some((v: string) => !v.trim())) {
        return "Remove empty entries";
      }
    } else {
      if (value === "" || value === undefined || value === null) {
        return "Enter a value";
      }
    }
  }
  return null;
}

/**
 * Returns all conditions that have errors from a filter group tree.
 */
export function getFilterGroupErrors(group: FilterGroup): Array<{ id: string; message: string }> {
  const errors: Array<{ id: string; message: string }> = [];

  function walk(g: FilterGroup) {
    for (const cond of g.conditions) {
      const fieldType = getFieldType(cond.field);
      const err = getConditionError(cond, fieldType);
      if (err) {
        errors.push({ id: cond.id, message: err });
      }
    }
    for (const sub of g.groups) {
      walk(sub);
    }
  }

  walk(group);
  return errors;
}

// ============================================================
// Props
// ============================================================

interface FilterBuilderProps {
  value: FilterGroup;
  onChange: (group: FilterGroup) => void;
  maxConditions?: number;
}

// ============================================================
// Helpers
// ============================================================

let idCounter = 0;
function genId(): string {
  idCounter++;
  return `fc_${Date.now()}_${idCounter}`;
}

function getFieldType(field: string): "number" | "string" {
  return FIELD_OPTIONS.find((f) => f.value === field)?.type ?? "number";
}

function createDefaultCondition(field: string = "close"): FilterCondition {
  const type = getFieldType(field);
  return {
    id: genId(),
    field: field as FilterField,
    condition: type === "number"
      ? { operator: "gt", value: 0 }
      : { operator: "eq", value: "" },
  };
}

function createEmptyGroup(): FilterGroup {
  return {
    id: genId(),
    logic: "AND",
    conditions: [createDefaultCondition()],
    groups: [],
  };
}

// ============================================================
// Condition Row
// ============================================================

function FilterConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}) {
  const fieldType = getFieldType(condition.field);
  const cond = condition.condition;
  const operator = "operator" in cond ? cond.operator : "gt";
  const isNumeric = fieldType === "number";
  const ops = isNumeric ? NUMERIC_OPS : STRING_OPS;
  const isBetween = operator === "between";
  const isListOp = operator === "in" || operator === "not_in";

  const fieldDef = FIELD_OPTIONS.find((f) => f.value === condition.field);

  // Expandable multi-value input for "in"/"not_in"
  const [listText, setListText] = useState(
    isListOp && Array.isArray((cond as any).value)
      ? ((cond as any).value as string[]).join(", ")
      : ""
  );
  const [listFocused, setListFocused] = useState(false);

  const error = getConditionError(condition, fieldType);

  const updateField = (field: string) => {
    const newType = getFieldType(field);
    onChange({
      ...condition,
      field: field as FilterField,
      condition: newType === "number"
        ? { operator: "gt", value: 0 }
        : { operator: "eq", value: "" },
    });
  };

  const updateOperator = (op: string) => {
    if (isNumeric) {
      onChange({
        ...condition,
        condition: { operator: op as any, value: 0, value2: op === "between" ? 0 : undefined },
      });
    } else {
      onChange({
        ...condition,
        condition: {
          operator: op as any,
          value: op === "in" || op === "not_in" ? [] : "",
        },
      });
    }
  };

  const updateValue = (val: string) => {
    if (isNumeric) {
      onChange({
        ...condition,
        condition: {
          operator: operator as any,
          value: Number(val),
          value2: isBetween ? (cond as any).value2 ?? 0 : undefined,
        },
      });
    } else if (isListOp) {
      // Don't update via single value; use listText instead
    } else {
      onChange({
        ...condition,
        condition: { operator: operator as any, value: val },
      });
    }
  };

  const updateValue2 = (val: number) => {
    onChange({
      ...condition,
      condition: { operator: "between", value: (cond as any).value ?? 0, value2: val },
    });
  };

  const commitListText = useCallback(
    (text: string) => {
      setListText(text);
      const items = text
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      onChange({
        ...condition,
        condition: { operator: operator as any, value: items },
      });
    },
    [condition, operator, onChange]
  );

  const value = "value" in cond ? (cond as any).value : undefined;
  const displayValue = isNumeric
    ? String(value ?? "")
    : isListOp
      ? listText
      : String(value ?? "");

  const displayValue2 = String((cond as any).value2 ?? "");

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 py-1.5 px-2 bg-muted/30 rounded-lg group hover:bg-muted/50 transition-colors">
        {/* Field selector */}
        <select
          className="flex-1 min-w-[140px] p-1.5 text-sm border border-border rounded bg-background"
          value={condition.field}
          onChange={(e) => updateField(e.target.value)}
        >
          {CATEGORIES.map((cat) => (
            <optgroup key={cat} label={cat}>
              {FIELD_OPTIONS.filter((f) => f.category === cat).map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* Operator selector */}
        <select
          className="w-[100px] p-1.5 text-sm border border-border rounded bg-background"
          value={operator}
          onChange={(e) => updateOperator(e.target.value)}
        >
          {ops.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>

        {/* Value input */}
        {isBetween ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              className={`w-24 p-1.5 text-sm border rounded bg-background ${
                error ? "border-red-400" : "border-border"
              }`}
              value={displayValue}
              onChange={(e) => updateValue(e.target.value)}
              placeholder={fieldDef?.placeholder || "Min"}
            />
            <span className="text-xs text-muted-foreground">and</span>
            <input
              type="number"
              className={`w-24 p-1.5 text-sm border rounded bg-background ${
                error ? "border-red-400" : "border-border"
              }`}
              value={displayValue2}
              onChange={(e) => updateValue2(Number(e.target.value))}
              placeholder={fieldDef?.placeholder || "Max"}
            />
          </div>
        ) : isNumeric ? (
          <input
            type="number"
            className={`w-28 p-1.5 text-sm border rounded bg-background ${
              error ? "border-red-400" : "border-border"
            }`}
            value={displayValue}
            onChange={(e) => updateValue(e.target.value)}
            placeholder={fieldDef?.placeholder || "Value"}
          />
        ) : isListOp ? (
          <div className="relative flex-1">
            <input
              type="text"
              className={`w-full p-1.5 text-sm border rounded bg-background ${
                error ? "border-red-400" : "border-border"
              }`}
              value={listText}
              onChange={(e) => {
                setListText(e.target.value);
                if (!listFocused) commitListText(e.target.value);
              }}
              onBlur={() => {
                setListFocused(false);
                commitListText(listText);
              }}
              onFocus={() => setListFocused(true)}
              placeholder="e.g. IT, Banking, Pharma"
            />
          </div>
        ) : (
          <input
            type="text"
            className={`w-36 p-1.5 text-sm border rounded bg-background ${
              error ? "border-red-400" : "border-border"
            }`}
            value={displayValue}
            onChange={(e) => updateValue(e.target.value)}
            placeholder={fieldDef?.placeholder || "Value"}
          />
        )}

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="p-1.5 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
          title="Remove condition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Validation error */}
      {error && (
        <p className="text-[11px] text-red-500 pl-2 flex items-center gap-1">
          <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}

      {/* Field hint (shown when no error) */}
      {!error && fieldDef?.hint && (
        <p className="text-[10px] text-muted-foreground pl-2">{fieldDef.hint}</p>
      )}
    </div>
  );
}

// ============================================================
// Group Editor (recursive)
// ============================================================

function FilterGroupEditor({
  group,
  onChange,
  onRemove,
  isRoot = false,
  depth = 0,
  maxConditions = 50,
}: {
  group: FilterGroup;
  onChange: (g: FilterGroup) => void;
  onRemove?: () => void;
  isRoot?: boolean;
  depth?: number;
  maxConditions?: number;
}) {
  const totalConditions = countAll(group);
  const addCondition = useCallback(() => {
    if (totalConditions >= maxConditions) return;
    onChange({
      ...group,
      conditions: [...group.conditions, createDefaultCondition()],
    });
  }, [group, onChange, totalConditions, maxConditions]);

  const addGroup = useCallback(() => {
    if (totalConditions >= maxConditions) return;
    onChange({
      ...group,
      groups: [...group.groups, createEmptyGroup()],
    });
  }, [group, onChange, totalConditions, maxConditions]);

  const updateCondition = useCallback(
    (idx: number, condition: FilterCondition) => {
      const updated = [...group.conditions];
      updated[idx] = condition;
      onChange({ ...group, conditions: updated });
    },
    [group, onChange]
  );

  const removeCondition = useCallback(
    (idx: number) => {
      if (totalConditions <= 1) return;
      onChange({
        ...group,
        conditions: group.conditions.filter((_, i) => i !== idx),
      });
    },
    [group, onChange, totalConditions]
  );

  const updateSubGroup = useCallback(
    (idx: number, sub: FilterGroup) => {
      const updated = [...group.groups];
      updated[idx] = sub;
      onChange({ ...group, groups: updated });
    },
    [group, onChange]
  );

  const removeSubGroup = useCallback(
    (idx: number) => {
      onChange({
        ...group,
        groups: group.groups.filter((_, i) => i !== idx),
      });
    },
    [group, onChange]
  );

  const toggleLogic = useCallback(() => {
    onChange({
      ...group,
      logic: group.logic === "AND" ? "OR" : "AND",
    });
  }, [group, onChange]);

  const conditionCount = group.conditions.length + group.groups.flatMap((g) => g.conditions).length;
  const atMax = totalConditions >= maxConditions;

  return (
    <div className={`border rounded-lg ${isRoot ? "border-blue-200 dark:border-blue-800" : "border-border/60"} ${depth > 0 ? "ml-4 mt-2" : ""}`}>
      {/* Group header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Group</span>
          <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
            {conditionCount} condition{conditionCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isRoot && onRemove && (
            <button
              onClick={onRemove}
              className="text-[10px] text-red-500 hover:text-red-700 font-medium px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              Remove Group
            </button>
          )}
        </div>
      </div>

      <div className="p-3 space-y-2">
        {/* Conditions */}
        {group.conditions.map((cond, idx) => (
          <FilterConditionRow
            key={cond.id}
            condition={cond}
            onChange={(c) => updateCondition(idx, c)}
            onRemove={() => removeCondition(idx)}
          />
        ))}

        {/* Nested groups */}
        {group.groups.map((sub, idx) => (
          <FilterGroupEditor
            key={sub.id}
            group={sub}
            onChange={(g) => updateSubGroup(idx, g)}
            onRemove={() => removeSubGroup(idx)}
            depth={depth + 1}
            maxConditions={maxConditions}
          />
        ))}

        {/* Add buttons */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={addCondition}
            disabled={atMax}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 dark:bg-blue-950 dark:text-blue-400 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={atMax ? `Maximum ${maxConditions} conditions` : "Add condition"}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Condition
          </button>
          <button
            onClick={addGroup}
            disabled={atMax}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-purple-600 hover:text-purple-800 bg-purple-50 dark:bg-purple-950 dark:text-purple-400 rounded-md hover:bg-purple-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={atMax ? `Maximum ${maxConditions} conditions` : "Add nested group"}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2zM4 21a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2z" />
            </svg>
            Group
          </button>
          <div className="flex-1" />
          {/* Logic toggle */}
          <button
            onClick={toggleLogic}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
              group.logic === "AND"
                ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400"
            }`}
          >
            {group.logic}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main FilterBuilder
// ============================================================

export default function FilterBuilder({
  value,
  onChange,
  maxConditions = 50,
}: FilterBuilderProps) {
  const conditionCount = countAll(value);
  const errors = getFilterGroupErrors(value);

  return (
    <div className="space-y-3">
      {/* Error count banner */}
      {errors.length > 0 && (
        <div className="px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {errors.length} condition{errors.length !== 1 ? "s" : ""} need{errors.length === 1 ? "s" : ""} attention
        </div>
      )}

      {/* Condition count warning */}
      {conditionCount > maxConditions * 0.8 && conditionCount < maxConditions && (
        <div className="px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
          {conditionCount} conditions — approaching limit of {maxConditions}
        </div>
      )}

      {/* At max */}
      {conditionCount >= maxConditions && (
        <div className="px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-800">
          Maximum of {maxConditions} conditions reached
        </div>
      )}

      <FilterGroupEditor
        group={value}
        onChange={onChange}
        isRoot
        depth={0}
        maxConditions={maxConditions}
      />
    </div>
  );
}

function countAll(group: FilterGroup): number {
  let count = group.conditions.length;
  for (const g of group.groups) count += countAll(g);
  return count;
}
