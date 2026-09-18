/**
 * Unit tests for Netlify runtime detection (v3.40.1).
 *
 * The Netlify Next.js server-handler runtime does NOT set `NETLIFY` (observed
 * absent on prod via /api/health), yet Netlify Blobs IS available there — the
 * adapter injects the per-request context later. Detection must therefore
 * engage on multi-signal combos (NETLIFY_BLOBS_*, AWS_REGION + ENVIRONMENT)
 * while staying false on local/dev. Pure functions — no mocking needed.
 */

import { isNetlifyRuntime, netlifyBlobsContextAvailable } from "../netlify";

const ORIGINAL_ENV = process.env;

function setEnv(partial: Record<string, string | undefined>): void {
  process.env = { ...process.env, ...partial };
}

function clearEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_BLOBS_REGION;
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  delete process.env.NETLIFY_SITE_ID;
  delete process.env.NETLIFY_DEPLOY_ID;
  delete process.env.NETLIFY_AUTH_TOKEN;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
  delete process.env.ENVIRONMENT;
}

describe("isNetlifyRuntime()", () => {
  beforeEach(() => {
    clearEnv();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).netlifyBlobsContext = undefined;
  });

  afterEach(() => {
    clearEnv();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).netlifyBlobsContext = undefined;
  });

  it("false on a bare local/dev environment", () => {
    setEnv({ NODE_ENV: "development" });
    expect(isNetlifyRuntime()).toBe(false);
  });

  it("false on local production mode without any Netlify signal", () => {
    setEnv({ NODE_ENV: "production", ENVIRONMENT: "production" });
    expect(isNetlifyRuntime()).toBe(false);
  });

  it("true when NETLIFY is set (classic Functions runtime)", () => {
    setEnv({ NETLIFY: "true" });
    expect(isNetlifyRuntime()).toBe(true);
  });

  it("true when NETLIFY_BLOBS_REGION is set (server-handler with Blobs)", () => {
    setEnv({ NETLIFY_BLOBS_REGION: "us-east-2" });
    expect(isNetlifyRuntime()).toBe(true);
  });

  it("true when NETLIFY_SITE_ID / DEPLOY_ID are set (deploy context)", () => {
    setEnv({ NETLIFY_SITE_ID: "78401e5d-b137-4b6d-94bb-ad1ec8de6b05", NETLIFY_DEPLOY_ID: "abc" });
    expect(isNetlifyRuntime()).toBe(true);
  });

  it("true on the prod combo AWS_REGION + ENVIRONMENT=production (observed prod shape)", () => {
    setEnv({ AWS_REGION: "us-east-2", ENVIRONMENT: "production" });
    expect(isNetlifyRuntime()).toBe(true);
  });

  it("false on AWS_REGION alone (e.g. plain Lambda/EC2)", () => {
    setEnv({ AWS_REGION: "us-east-2" });
    expect(isNetlifyRuntime()).toBe(false);
  });

  it("true when the per-request Blobs context is injected on globalThis", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).netlifyBlobsContext = { url: "https://blobs.example" };
    expect(isNetlifyRuntime()).toBe(true);
  });
});

describe("netlifyBlobsContextAvailable()", () => {
  beforeEach(() => {
    clearEnv();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).netlifyBlobsContext = undefined;
  });

  afterEach(() => {
    clearEnv();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).netlifyBlobsContext = undefined;
  });

  it("false at boot on prod shape (context not injected until a request)", () => {
    setEnv({ AWS_REGION: "us-east-2", ENVIRONMENT: "production" });
    expect(netlifyBlobsContextAvailable()).toBe(false);
  });

  it("true when the adapter injected the per-request context on globalThis", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).netlifyBlobsContext = { url: "https://blobs.example" };
    expect(netlifyBlobsContextAvailable()).toBe(true);
  });

  it("true when NETLIFY_BLOBS_CONTEXT env is present", () => {
    setEnv({ NETLIFY_BLOBS_CONTEXT: "{\"url\":\"https://blobs.example\"}" });
    expect(netlifyBlobsContextAvailable()).toBe(true);
  });
});