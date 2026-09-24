"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface PingResponse {
  success: boolean;
  ping: {
    mode: string;
    providers: string[];
    detail: string;
  };
  flags: {
    DECISION_PROVIDER: string;
    DECISION_POC_ENABLED: boolean;
  };
}

interface TestResponse {
  success: boolean;
  response?: {
    answers: Record<string, unknown>;
    provider: string;
    model: string;
    latencyMs: number;
  };
  error?: string;
}

export default function AdminDecisionPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [ping, setPing] = useState<PingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/admin/access-denied");
    }
  }, [session, status, router]);

  const fetchPing = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/decision/ping");
      if (res.ok) setPing(await res.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchPing();
      const interval = setInterval(fetchPing, 10_000);
      return () => clearInterval(interval);
    }
  }, [status, fetchPing]);

  const handleTestEvaluate = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/decision/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: { symbol: "RELIANCE", changePercent: 2.4 },
          questions: [{ type: "choice", name: "regime", options: ["trending", "ranging"] }],
        }),
      });
      if (res.status === 401) {
        setTestResult({ success: false, error: "401 — admin only" });
      } else if (res.status === 503) {
        setTestResult({ success: false, error: "503 — engine inert or failed" });
      } else {
        setTestResult(await res.json());
      }
    } catch {
      setTestResult({ success: false, error: "Network error" });
    } finally {
      setTesting(false);
    }
  };

  if (status === "loading" || !session || (session.user as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Checking permissions...</div>
      </div>
    );
  }

  const inert = ping?.ping.mode === "none";
  const pocEnabled = ping?.flags.DECISION_POC_ENABLED;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Decision Engine</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          System One primitives (choice / score / noul) — Laya decode contract, atomic-answer API
        </p>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700 animate-pulse"
            >
              <div className="h-4 w-20 bg-gray-200 dark:bg-slate-600 rounded mb-3" />
              <div className="h-8 w-12 bg-gray-200 dark:bg-slate-600 rounded" />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Provider Mode"
              value={ping?.ping.mode ?? "—"}
              color={inert ? "text-gray-500" : "text-green-600"}
            />
            <StatCard
              label="Engine State"
              value={inert ? "Inert" : (ping?.ping.providers.length ?? 0) > 0 ? "Armed" : "—"}
              color={inert ? "text-red-600" : "text-green-600"}
            />
            <StatCard
              label="POC A/B"
              value={pocEnabled ? "Enabled" : "Off"}
              color={pocEnabled ? "text-purple-600" : "text-gray-500"}
            />
            <StatCard label="Providers" value={ping?.ping.providers.length ?? 0} color="text-blue-600" />
          </>
        )}
      </div>

      {/* Provider detail */}
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Provider Detail</h3>
        {!ping ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading ping...</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">{ping.ping.detail}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ping.ping.providers.length === 0 ? (
                <span className="px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 text-xs font-mono rounded-full">
                  none — engine is inert (DECISION_PROVIDER=none)
                </span>
              ) : (
                ping.ping.providers.map((p) => (
                  <span
                    key={p}
                    className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-mono rounded-full"
                  >
                    {p}
                  </span>
                ))
              )}
            </div>
            <div className="mt-4 text-xs text-gray-400 dark:text-gray-500 space-y-1">
              <p>
                • <code className="font-mono">DECISION_PROVIDER</code> ={" "}
                <code className="font-mono">{ping.flags.DECISION_PROVIDER}</code>
              </p>
              <p>
                • <code className="font-mono">DECISION_POC_ENABLED</code> ={" "}
                <code className="font-mono">{String(ping.flags.DECISION_POC_ENABLED)}</code>
              </p>
            </div>
          </>
        )}
      </div>

      {/* Live test */}
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">One-Shot Evaluate Test</h3>
          <button
            onClick={handleTestEvaluate}
            disabled={testing}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {testing ? "Evaluating..." : "Run Test"}
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          POST /api/decision/evaluate with a single choice question over a demo state.
        </p>
        <code className="block bg-gray-100 dark:bg-slate-700 rounded p-3 text-sm text-gray-800 dark:text-gray-200 font-mono overflow-x-auto">
          {`POST /api/decision/evaluate
{ "state": { "symbol": "RELIANCE", "changePercent": 2.4 },
  "questions": [ { "type": "choice", "name": "regime", "options": ["trending", "ranging"] } ] }`}
        </code>
        {testResult && (
          <div className="mt-4 rounded-lg border border-gray-200 dark:border-slate-600 p-3">
            {testResult.success && testResult.response ? (
              <div className="space-y-1 text-sm">
                <p className="text-gray-700 dark:text-gray-200">
                  Answer:{" "}
                  <code className="font-mono">
                    {JSON.stringify(testResult.response.answers["regime"])}
                  </code>
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  provider {testResult.response.provider} · model {testResult.response.model} ·{" "}
                  {testResult.response.latencyMs}ms
                </p>
              </div>
            ) : (
              <p className="text-sm text-red-600 dark:text-red-400">{testResult.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}