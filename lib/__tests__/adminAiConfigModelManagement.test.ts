/* @jest-environment node */

import { NextRequest } from "next/server";
import { GET as configGET, POST as configPOST, DELETE as configDELETE } from "@/app/api/admin/ai/config/route";
import { GET as customModelsGET, POST as customModelsPOST } from "@/app/api/admin/ai/custom-models/route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { resetLLM } from "@/lib/services/ai/llm-provider";

// Route-level harness — stateful in-memory `secret` store so the
// persistence contract (ai_custom_models metadata { models, hidden },
// ai_config metadata { model, ... }) is exercised end-to-end WITHOUT a DB.
interface MockSecretRow {
  id: string;
  name: string;
  type: string;
  value: string;
  hint: string;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
}

// `mock` prefix lets the jest.mock factory reference this store
// (jest out-of-scope-variable rule).
const mockSecretStore: MockSecretRow[] = [];

const mockResetSecretStore = () => {
  mockSecretStore.length = 0;
};

const seedSecret = (name: string, metadata: any) => {
  mockSecretStore.push({
    id: `id-${name}`,
    name,
    type: "api_key",
    value: name === "ai_custom_models" ? "custom_models_storage" : "stored_in_env",
    hint: "",
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

const findRec = (name: string) => mockSecretStore.find((r) => r.name === name);

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    secret: {
      findFirst: jest.fn(async ({ where }: { where: { name: string } }) => {
        const rec = mockSecretStore.find((r) => r.name === where.name);
        if (!rec) return null;
        return { ...rec, metadata: rec.metadata === undefined ? null : JSON.parse(JSON.stringify(rec.metadata)) };
      }),
      create: jest.fn(async ({ data }: { data: any }) => {
        const rec: MockSecretRow = {
          id: `id-${data.name}`,
          name: data.name,
          type: data.type,
          value: data.value,
          hint: data.hint,
          metadata: data.metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockSecretStore.push(rec);
        return rec;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const rec = mockSecretStore.find((r) => r.id === where.id);
        if (!rec) throw new Error(`Row ${where.id} not found`);
        Object.assign(rec, data);
        rec.updatedAt = new Date();
        return rec;
      }),
    },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("@/lib/services/ai/llm-provider", () => ({ resetLLM: jest.fn() }));

const mockAuth = jest.mocked(auth);
const mockResetLLM = jest.mocked(resetLLM);

const CATALOG_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

const jsonRequest = (path: string, method: string, payload: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;

const configDelete = (modelId: string) =>
  configDELETE(jsonRequest("/api/admin/ai/config", "DELETE", { modelId }));

const configPost = (payload: unknown) =>
  configPOST(jsonRequest("/api/admin/ai/config", "POST", payload));

const customAdd = (model: { id: string; name: string }) =>
  customModelsPOST(jsonRequest("/api/admin/ai/custom-models", "POST", { action: "add", model }));

describe("Admin AI model management (config + custom-models routes)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetSecretStore();
    mockAuth.mockResolvedValue({ user: { role: "admin" } } as never);
  });

  it("GET as admin returns builtins first + the full catalog + builtinModelIds", async () => {
    const res = await configGET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.builtinModelIds).toEqual(["openrouter/free", "openrouter/auto"]);
    expect(body.availableModels[0].id).toBe("openrouter/free");
    expect(body.availableModels[1].id).toBe("openrouter/auto");
    expect(body.availableModels).toHaveLength(10); // 2 builtins + 8 catalog
    expect(body.customModels).toEqual([]);
  });

  it("GET returns 403 for non-admin", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await configGET();

    expect(res.status).toBe(403);
  });

  it("cannot remove a true built-in (openrouter/free) — 400, nothing persisted", async () => {
    const res = await configDelete("openrouter/free");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(String(body.error)).toContain("Cannot remove built-in models");
    expect(findRec("ai_custom_models")).toBeUndefined();
  });

  it("removes a catalog model by hiding it — GET stops listing it", async () => {
    const res = await configDelete(CATALOG_MODEL);

    expect(res.status).toBe(200);
    const rec = findRec("ai_custom_models");
    expect(rec?.metadata.hidden).toContain(CATALOG_MODEL);
    expect(rec?.metadata.models).toEqual([]);

    const getRes = await configGET();
    const body = await getRes.json();
    const ids = body.availableModels.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(CATALOG_MODEL);
    expect(ids).toContain("openrouter/free");
    expect(ids).toContain("openrouter/auto");
  });

  it("returns 404 for an unknown model id", async () => {
    const res = await configDelete("org/never-added");

    expect(res.status).toBe(404);
  });

  it("removing the ACTIVE model resets ai_config to openrouter/free and resets the LLM cache", async () => {
    seedSecret("ai_config", { model: CATALOG_MODEL, temperature: 0.3, enabled: true });

    const res = await configDelete(CATALOG_MODEL);

    expect(res.status).toBe(200);
    expect(findRec("ai_config")?.metadata.model).toBe("openrouter/free");
    expect(mockResetLLM).toHaveBeenCalled();
  });

  it("admin-added custom model is listed, then removed outright by the config DELETE", async () => {
    const addRes = await customAdd({ id: "org/added-model:free", name: "Added Model" });
    expect(addRes.status).toBe(200);

    const listRes = await configGET();
    const listBody = await listRes.json();
    const customIds = listBody.customModels.map((m: { id: string }) => m.id);
    expect(customIds).toContain("org/added-model:free");
    // present exactly once in the merged list (dedupe via `seen`)
    const availableIds: string[] = listBody.availableModels.map((m: { id: string }) => m.id);
    expect(availableIds.filter((id: string) => id === "org/added-model:free")).toHaveLength(1);

    const delRes = await configDelete("org/added-model:free");
    expect(delRes.status).toBe(200);
    expect(findRec("ai_custom_models")?.metadata.models).toEqual([]);
    expect(findRec("ai_custom_models")?.metadata.hidden).toEqual([]);

    const afterRes = await configGET();
    const afterBody = await afterRes.json();
    expect(afterBody.customModels).toEqual([]);
    expect(afterBody.availableModels.map((m: { id: string }) => m.id)).not.toContain("org/added-model:free");
  });

  it("re-adding a hidden catalog model un-hides it (restore)", async () => {
    await configDelete(CATALOG_MODEL);
    expect(findRec("ai_custom_models")?.metadata.hidden).toContain(CATALOG_MODEL);

    const addRes = await customAdd({ id: CATALOG_MODEL, name: CATALOG_MODEL.toUpperCase() });
    expect(addRes.status).toBe(200);

    expect(findRec("ai_custom_models")?.metadata.hidden).not.toContain(CATALOG_MODEL);

    const afterRes = await configGET();
    const afterBody = await afterRes.json();
    expect(afterBody.availableModels.map((m: { id: string }) => m.id)).toContain(CATALOG_MODEL);
  });

  it("POST config accepts a built-in model and persists it", async () => {
    const res = await configPost({ model: "openrouter/auto" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(findRec("ai_config")?.metadata.model).toBe("openrouter/auto");
    expect(mockResetLLM).toHaveBeenCalled();
  });

  it("POST config rejects an invalid model format", async () => {
    const res = await configPost({ model: "not a valid id" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(String(body.error)).toContain("Invalid model format");
  });
});