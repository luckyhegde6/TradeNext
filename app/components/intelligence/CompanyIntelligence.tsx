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

export default function CompanyIntelligence({ ticker, isAuthenticated }: CompanyIntelligenceProps) {
  const [buttonState, setButtonState] = useState<ButtonState>(isAuthenticated ? "idle" : "unauthenticated");
  const [report, setReport] = useState<IntelligenceReport | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (buttonState === "loading") return;
    setButtonState("loading");
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/company/${encodeURIComponent(ticker)}/intelligence`, {
        method: "POST",
        credentials: "include",
      });

      if (res.status === 401) {
        setButtonState("unauthenticated");
        return;
      }

      if (res.status === 503) {
        const body = await res.json().catch(() => null);
        setErrorMessage(body?.error || "Service temporarily unavailable");
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
  }, [ticker, buttonState]);

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
