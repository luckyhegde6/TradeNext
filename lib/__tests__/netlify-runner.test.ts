/**
 * Tests for lib/services/worker/netlify-runner.ts (Spec 42).
 *
 * Covers:
 *   - taskRuntimeBudget(): eligible task types + deferred types
 *   - DEFERRED_TASK_TYPES: recommendations NOT deferred (checkpoint phases)
 *   - Budget headroom logic
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 */

// ─── Mocks (MUST be before any imports) ──────────────────────────────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/prisma", () => {
  const mock = {
    workerTask: {
      updateMany: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    workerStatus: {
      findUnique: jest.fn(),
    },
    taskEvent: {
      findMany: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/services/leader", () => ({
  __esModule: true,
  acquireLeaderLock: jest.fn(),
  renewLeaderLock: jest.fn(),
  releaseLeaderLock: jest.fn(),
  leaderWorkerId: jest.fn((role) => `leader-${role}`),
  LEADER_SELF: "test-host-123",
  LEADER_HEARTBEAT_MS: 300_000,
}));

jest.mock("@/lib/db-utils", () => ({
  __esModule: true,
  isDbUnavailableError: jest.fn(() => false),
}));

jest.mock("@/lib/netlify", () => ({
  __esModule: true,
  isNetlifyRuntime: jest.fn(() => true),
}));

// ─── Imports ─────────────────────────────────────────────────────────────

import {
  taskRuntimeBudget,
  DEFERRED_TASK_TYPES,
  RUNNER_BUDGET_MS,
  CLAIM_HEADROOM_MS,
  TASK_RUNTIME_BUDGET_MS,
} from "@/lib/services/worker/netlify-runner";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as Record<string, any>;

describe("TASK_RUNTIME_BUDGET_MS", () => {
  it("defines budgets for fast/safe task types", () => {
    expect(TASK_RUNTIME_BUDGET_MS.ai_connection_test).toBe(2 * 60_000);
    expect(TASK_RUNTIME_BUDGET_MS.corp_actions).toBe(3 * 60_000);
    expect(TASK_RUNTIME_BUDGET_MS.recommendation_performance).toBe(5 * 60_000);
    expect(TASK_RUNTIME_BUDGET_MS.deploy_prep).toBe(2 * 60_000);
    expect(TASK_RUNTIME_BUDGET_MS.google_sheets_rescan).toBe(5 * 60_000);
  });

  it("defines a budget for recommendations (checkpoint phases)", () => {
    expect(TASK_RUNTIME_BUDGET_MS.recommendations).toBe(5 * 60_000);
  });
});

describe("taskRuntimeBudget()", () => {
  it("returns budget for eligible task types", () => {
    expect(taskRuntimeBudget("corp_actions")).toBe(3 * 60_000);
    expect(taskRuntimeBudget("recommendations")).toBe(5 * 60_000);
    expect(taskRuntimeBudget("recommendation_performance")).toBe(5 * 60_000);
  });

  it("returns undefined for deferred task types", () => {
    expect(taskRuntimeBudget("swing_performance")).toBeUndefined();
    expect(taskRuntimeBudget("csv_processing")).toBeUndefined();
    expect(taskRuntimeBudget("data_sync")).toBeUndefined();
    expect(taskRuntimeBudget("historical_sync")).toBeUndefined();
    expect(taskRuntimeBudget("news_fetch")).toBeUndefined();
    expect(taskRuntimeBudget("screener_sync")).toBeUndefined();
  });

  it("returns undefined for unknown task types", () => {
    expect(taskRuntimeBudget("unknown_type")).toBeUndefined();
    expect(taskRuntimeBudget("")).toBeUndefined();
  });
});

describe("DEFERRED_TASK_TYPES", () => {
  it("does NOT include recommendations (checkpoint phases enabled)", () => {
    expect(DEFERRED_TASK_TYPES.has("recommendations")).toBe(false);
  });

  it("includes swing_performance and other long/unknown tasks", () => {
    expect(DEFERRED_TASK_TYPES.has("swing_performance")).toBe(true);
    expect(DEFERRED_TASK_TYPES.has("csv_processing")).toBe(true);
    expect(DEFERRED_TASK_TYPES.has("data_sync")).toBe(true);
    expect(DEFERRED_TASK_TYPES.has("historical_sync")).toBe(true);
    expect(DEFERRED_TASK_TYPES.has("news_fetch")).toBe(true);
    expect(DEFERRED_TASK_TYPES.has("screener_sync")).toBe(true);
  });
});

describe("RUNNER_BUDGET_MS and CLAIM_HEADROOM_MS", () => {
  it("runner budget is 13 minutes", () => {
    expect(RUNNER_BUDGET_MS).toBe(13 * 60_000);
  });

  it("claim headroom is 2 minutes", () => {
    expect(CLAIM_HEADROOM_MS).toBe(2 * 60_000);
  });
});

describe("prisma mock is available", () => {
  it("workerTask and workerStatus are mockable", () => {
    expect(prisma.workerTask).toBeDefined();
    expect(prisma.workerStatus).toBeDefined();
    expect(typeof prisma.workerTask.updateMany).toBe("function");
    expect(typeof prisma.workerTask.update).toBe("function");
  });
});
