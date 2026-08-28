"use client";

import { useState, useCallback } from "react";
import type { IntelligenceReport } from "@/lib/services/intelligenceTypes";
import IntelligenceButton from "./IntelligenceButton";
import IntelligencePanel from "./IntelligencePanel";

interface CompanyIntelligenceProps {
  ticker: string;
  isAuthenticated: boolean;
}

type ButtonState = "unauthenticated" | "idle" | "loading" | "ready" | "failed";

const DOC_MAX = 50_000;

export default function CompanyIntelligence({ ticker, isAuthenticated }: CompanyIntelligenceProps) {
  const [buttonState, setButtonState] = useState<ButtonState>(isAuthenticated ? "idle" : "unauthenticated");
  const [report, setReport] = useState<IntelligenceReport | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [annualReport, setAnnualReport] = useState("");
  const [concall, setConcall] = useState("");

  const hasDocs = annualReport.trim().length > 0 || concall.trim().length > 0;

  const handleGenerate = useCallback(async () => {
    if (buttonState === "loading") return;
    if (annualReport.length > DOC_MAX || concall.length > DOC_MAX) {
      setErrorMessage(`Docs too large (max ${DOC_MAX.toLocaleString()} chars each)`);
      setButtonState("failed");
      return;
    }
    setButtonState("loading");
    setErrorMessage(null);

    const body: { force?: boolean; documents?: { annualReport?: string; concall?: string } } = {};
    if (hasDocs) {
      body.documents = {};
      if (annualReport.trim()) body.documents.annualReport = annualReport.trim();
      if (concall.trim()) body.documents.concall = concall.trim();
    }

    try {
      const res = await fetch(`/api/company/${encodeURIComponent(ticker)}/intelligence`, {
        method: "POST",
        credentials: "include",
        headers: body.documents ? { "Content-Type": "application/json" } : undefined,
        body: body.documents ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401) {
        setButtonState("unauthenticated");
        return;
      }

      if (res.status === 503) {
        const bodyRes = await res.json().catch(() => null);
        setErrorMessage(bodyRes?.error || "Service temporarily unavailable");
        setButtonState("failed");
        return;
      }

      if (!res.ok) {
        setErrorMessage(`Request failed (${res.status})`);
        setButtonState("failed");
        return;
      }

      const data = await res.json();
      if (data.success && data.report) {
        setReport(data.report);
        setButtonState("ready");
        setIsOpen(true);
      } else {
        setErrorMessage(data.error || "No analysis available");
        setButtonState("failed");
      }
    } catch {
      setErrorMessage("Network error");
      setButtonState("failed");
    }
  }, [ticker, buttonState, annualReport, concall, hasDocs]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return (
    <div className="space-y-3" data-testid="company-intelligence">
      <IntelligenceButton
        state={buttonState}
        onGenerate={handleGenerate}
        onToggle={handleToggle}
        isOpen={isOpen}
      />

      {/* Optional document ingestion */}
      {isAuthenticated && buttonState !== "unauthenticated" && (
        <div className="text-xs text-gray-400 dark:text-gray-500">
          <button
            type="button"
            onClick={() => setShowDocs((s) => !s)}
            className="text-sky-600 dark:text-sky-400 hover:underline"
            data-testid="toggle-document-inputs"
          >
            {showDocs ? "▼ Hide" : "＋ Add documents"} (annual report / earnings call — optional)
          </button>
          {showDocs && (
            <div className="mt-2 space-y-2" data-testid="document-inputs">
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                  Annual report / annual-letter text ({annualReport.length.toLocaleString()}/{DOC_MAX.toLocaleString()})
                </label>
                <textarea
                  value={annualReport}
                  onChange={(e) => setAnnualReport(e.target.value)}
                  rows={5}
                  placeholder="Paste .md / .txt of the annual report or chairman's letter…"
                  className="w-full text-xs bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
                  data-testid="annual-report-input"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                  Earnings-call transcript text ({concall.length.toLocaleString()}/{DOC_MAX.toLocaleString()})
                </label>
                <textarea
                  value={concall}
                  onChange={(e) => setConcall(e.target.value)}
                  rows={5}
                  placeholder="Paste .md / .txt of the earnings call transcript…"
                  className="w-full text-xs bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
                  data-testid="concall-input"
                />
              </div>
              {hasDocs && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setAnnualReport(""); setConcall(""); }}
                    className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                    data-testid="clear-documents"
                  >
                    Clear
                  </button>
                  <span className="text-gray-400 dark:text-gray-500">Documents will be included in the next analysis.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {errorMessage && buttonState === "failed" && (
        <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="intelligence-error">
          {errorMessage}
        </div>
      )}
      {buttonState === "loading" && (
        <div className="space-y-3" data-testid="intelligence-loading">
          <div className="h-24 bg-gray-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-16 bg-gray-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          <div className="h-32 bg-gray-100 dark:bg-slate-800 rounded-lg animate-pulse" />
        </div>
      )}
      {isOpen && report && (
        <IntelligencePanel report={report} />
      )}
    </div>
  );
}
