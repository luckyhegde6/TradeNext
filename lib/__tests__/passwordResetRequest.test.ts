/**
 * Password reset request service tests.
 * Covers the PasswordResetRequest lifecycle helpers in lib/services/userService.ts.
 * Global `jest` is used (NOT @jest/globals) per the SWC transform setup.
 */

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("@/lib/prisma", () => {
  const mockPasswordResetRequest = {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      passwordResetRequest: mockPasswordResetRequest,
    },
  };
});

import prisma from "@/lib/prisma";
import {
  hasPendingPasswordResetRequest,
  createPasswordResetRequest,
  getPendingPasswordResetRequests,
  getPasswordResetRequestById,
  updatePasswordResetRequestStatus,
} from "@/lib/services/userService";

const mockReset = (prisma as any).passwordResetRequest;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("hasPendingPasswordResetRequest", () => {
  test("returns true when a pending request exists for the email", async () => {
    mockReset.findFirst.mockResolvedValue({ id: "req_1" });

    const result = await hasPendingPasswordResetRequest("user@example.com");

    expect(result).toBe(true);
    expect(mockReset.findFirst).toHaveBeenCalledWith({
      where: { email: "user@example.com", status: "pending" },
      select: { id: true },
    });
  });

  test("returns false when no pending request exists", async () => {
    mockReset.findFirst.mockResolvedValue(null);

    const result = await hasPendingPasswordResetRequest("user@example.com");

    expect(result).toBe(false);
  });
});

describe("createPasswordResetRequest", () => {
  test("creates a request with email and reason", async () => {
    mockReset.create.mockResolvedValue({
      id: "req_1",
      email: "user@example.com",
      reason: "Forgot it",
      status: "pending",
    });

    const result = await createPasswordResetRequest({
      email: "user@example.com",
      reason: "Forgot it",
    });

    expect(result.id).toBe("req_1");
    expect(mockReset.create).toHaveBeenCalledWith({
      data: { email: "user@example.com", reason: "Forgot it" },
    });
  });

  test("creates a request without reason", async () => {
    mockReset.create.mockResolvedValue({
      id: "req_2",
      email: "user@example.com",
      reason: null,
      status: "pending",
    });

    const result = await createPasswordResetRequest({ email: "user@example.com" });

    expect(mockReset.create).toHaveBeenCalledWith({
      data: { email: "user@example.com", reason: undefined },
    });
    expect(result.status).toBe("pending");
  });
});

describe("getPendingPasswordResetRequests", () => {
  test("returns only pending requests ordered newest first", async () => {
    mockReset.findMany.mockResolvedValue([
      { id: "req_2", email: "b@example.com", status: "pending" },
      { id: "req_1", email: "a@example.com", status: "pending" },
    ]);

    const result = await getPendingPasswordResetRequests();

    expect(result).toHaveLength(2);
    expect(mockReset.findMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("getPasswordResetRequestById", () => {
  test("fetches a request by id", async () => {
    mockReset.findUnique.mockResolvedValue({ id: "req_1", email: "a@example.com" });

    const result = await getPasswordResetRequestById("req_1");

    expect(result?.id).toBe("req_1");
    expect(mockReset.findUnique).toHaveBeenCalledWith({ where: { id: "req_1" } });
  });

  test("returns null when the request does not exist", async () => {
    mockReset.findUnique.mockResolvedValue(null);

    const result = await getPasswordResetRequestById("missing");

    expect(result).toBeNull();
  });
});

describe("updatePasswordResetRequestStatus", () => {
  test("marks a request approved", async () => {
    mockReset.update.mockResolvedValue({ id: "req_1", status: "approved" });

    const result = await updatePasswordResetRequestStatus("req_1", "approved");

    expect(result.status).toBe("approved");
    expect(mockReset.update).toHaveBeenCalledWith({
      where: { id: "req_1" },
      data: { status: "approved" },
    });
  });

  test("marks a request rejected", async () => {
    mockReset.update.mockResolvedValue({ id: "req_1", status: "rejected" });

    const result = await updatePasswordResetRequestStatus("req_1", "rejected");

    expect(result.status).toBe("rejected");
  });
});