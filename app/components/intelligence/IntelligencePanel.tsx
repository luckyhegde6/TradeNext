"use client";

import { useState, useEffect, useRef } from "react";
import type { IntelligenceReport } from "@/lib/services/intelligenceTypes";
import VerdictCard from "./sections/VerdictCard";
import FairValueGauge from "./sections/FairValueGauge";
import TechnicalSummary from "./sections/TechnicalSummary";
import FundamentalInsights from "./sections/FundamentalInsights";
import ValuationView from "./sections/ValuationView";
import NewsCatalystList from "./sections/NewsCatalystList";
import ShareholdingTrend from "./sections/ShareholdingTrend";
import CorporateActionsSummary from "./sections/CorporateActionsSummary";
import RiskCatalystMatrix from "./sections/RiskCatalystMatrix";
import ScenarioAnalysis from "./sections/ScenarioAnalysis";
import ExecutiveSummary from "./sections/ExecutiveSummary";
import ExecutiveThesisSection from "./sections/ExecutiveThesisSection";
import TechnicalStructureSection from "./sections/TechnicalStructureSection";
import FundamentalScoreSection from "./sections/FundamentalScoreSection";
import ValuationZonesSection from "./sections/ValuationZonesSection";
import ManagementDnaSection from "./sections/ManagementDnaSection";
import ShareholdingAnalysisSection from "./sections/ShareholdingAnalysisSection";
import ContrarianSection from "./sections/ContrarianSection";
import PortfolioActionSection from "./sections/PortfolioActionSection";
import DataGapsBanner from "./sections/DataGapsBanner";

interface IntelligencePanelProps {
  report: IntelligenceReport;
}

export default function IntelligencePanel({ report }: IntelligencePanelProps) {
  const { analysis, dataUsed } = report;
  const [open, setOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  // Smooth height animation on mount
  useEffect(() => {
    if (contentRef.current) {
      const el = contentRef.current;
      setHeight(el.scrollHeight);
      const timer = setTimeout(() => setHeight("auto"), 300);
      return () => clearTimeout(timer);
    }
  }, []);

  const toggle = () => {
    if (open) {
      // Collapse: set fixed height then to 0
      if (contentRef.current) {
        setHeight(contentRef.current.scrollHeight);
        requestAnimationFrame(() => setHeight(0));
      }
    } else {
      // Expand: set fixed height then to auto
      if (contentRef.current) {
        setHeight(contentRef.current.scrollHeight);
        requestAnimationFrame(() => setHeight("auto"));
      }
    }
    setOpen(!open);
  };

  const currentPrice = dataUsed.quote?.price ?? null;
  const hasNew = Boolean(
    analysis.fundamentalScore ||
    analysis.technicalStructure ||
    analysis.managementDna ||
    analysis.valuationZones ||
    analysis.shareholdingAnalysis ||
    analysis.contrarian ||
    analysis.portfolioAction ||
    analysis.executiveSummary,
  );

  return (
    <div className="bg-gray-50 dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden" data-testid="intelligence-panel">
      {/* Header */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-100 dark:hover:bg-slate-800/50 transition-colors"
        data-testid="intelligence-panel-header"
      >
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          AI Investment Intelligence{hasNew ? " · Decision Engine" : ""}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {open ? "▲ Hide" : "▼ Show"}
        </span>
      </button>

      {/* Animated content */}
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: height === "auto" ? "none" : `${height}px` }}
      >
        <div className="px-5 pb-5 space-y-4">
          {/* Data gaps honesty banner */}
          <DataGapsBanner gaps={analysis.dataGaps} />

          {/* Top row: Verdict + Fair Value */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <VerdictCard
              verdict={analysis.verdict}
              confidence={analysis.confidence}
              conviction={analysis.conviction}
            />
            <FairValueGauge
              low={analysis.fairValue.low}
              mid={analysis.fairValue.mid}
              high={analysis.fairValue.high}
              currentPrice={currentPrice ?? undefined}
            />
          </div>

          {/* Thesis (new) */}
          <ExecutiveThesisSection thesis={analysis.executiveSummary} />

          {/* Technical: new structured pillar, else legacy */}
          {analysis.technicalStructure ? (
            <TechnicalStructureSection structure={analysis.technicalStructure} />
          ) : (
            <TechnicalSummary
              trend={analysis.technicalAnalysis.trend}
              support={analysis.technicalAnalysis.support}
              resistance={analysis.technicalAnalysis.resistance}
              indicators={analysis.technicalAnalysis.indicators}
            />
          )}

          {/* Fundamentals: new structured pillar, else legacy */}
          {analysis.fundamentalScore ? (
            <FundamentalScoreSection score={analysis.fundamentalScore} />
          ) : (
            <FundamentalInsights
              strengths={analysis.fundamentalAnalysis.strengths}
              weaknesses={analysis.fundamentalAnalysis.weaknesses}
            />
          )}

          {/* Valuation zones (new) + legacy assessment */}
          {analysis.valuationZones && (
            <ValuationZonesSection zones={analysis.valuationZones} currentPrice={currentPrice ?? undefined} />
          )}
          <ValuationView
            assessment={analysis.valuationAssessment.assessment}
            relativeValue={analysis.valuationAssessment.relativeValue}
          />

          {/* Management DNA (new) */}
          {analysis.managementDna && <ManagementDnaSection dna={analysis.managementDna} />}

          {/* Shareholding: new structured pillar, else legacy */}
          {analysis.shareholdingAnalysis ? (
            <ShareholdingAnalysisSection analysis={analysis.shareholdingAnalysis} />
          ) : (
            <ShareholdingTrend summary={analysis.shareholdingTrend.summary} />
          )}

          {/* News */}
          <NewsCatalystList
            positive={analysis.newsCatalysts.positive}
            negative={analysis.newsCatalysts.negative}
            neutral={analysis.newsCatalysts.neutral}
          />

          {/* Corporate Actions */}
          <CorporateActionsSummary items={dataUsed.corporate?.recentActions ?? []} />

          {/* Risks & Catalysts */}
          <RiskCatalystMatrix riskFactors={analysis.riskFactors} catalysts={analysis.catalysts} />

          {/* Scenario Analysis */}
          <ScenarioAnalysis
            bull={analysis.scenarioAnalysis.bull}
            base={analysis.scenarioAnalysis.base}
            bear={analysis.scenarioAnalysis.bear}
          />

          {/* Contrarian test (new) */}
          {analysis.contrarian && (
            <ContrarianSection
              contrarian={analysis.contrarian}
              whatWouldChangeMyMind={analysis.whatWouldChangeMyMind}
            />
          )}

          {/* Portfolio action + invalidation (new) */}
          {analysis.portfolioAction && (
            <PortfolioActionSection action={analysis.portfolioAction} invalidation={analysis.invalidation} />
          )}

          {/* Executive Summary */}
          <ExecutiveSummary
            summary={analysis.summary}
            modelUsed={report.modelUsed}
            generatedAt={report.generatedAt}
            isCacheHit={report.isCacheHit}
            version={report.version}
          />
        </div>
      </div>
    </div>
  );
}
