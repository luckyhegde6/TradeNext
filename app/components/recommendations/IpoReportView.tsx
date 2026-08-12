"use client";

// app/components/recommendations/IpoReportView.tsx
//
// Premium brokerage-style report renderer for the v2 structured JSON report.
// A single client template maps `IpoReport` sections → styled Tailwind blocks,
// so the LLM never controls layout (JSON in, template out). Used by the
// analysis modal + IPO landing page; portable to PDF/dashboard/mobile later.
//
// Accent legend: emerald = positive, red = negative, amber = caution,
// blue = neutral/info.

import type { IpoReport, IpoRisk } from "@/lib/services/ipoReport";

const VERDICT_STYLE: Record<string, { label: string; badge: string; bar: string }> = {
  "STRONG BUY": { label: "STRONG BUY", badge: "bg-emerald-600 text-white border-emerald-500", bar: "from-emerald-600 to-emerald-400" },
  BUY: { label: "BUY", badge: "bg-emerald-500 text-white border-emerald-400", bar: "from-emerald-500 to-emerald-300" },
  HOLD: { label: "HOLD", badge: "bg-amber-500 text-slate-900 border-amber-400", bar: "from-amber-500 to-amber-300" },
  "PARTIAL PROFIT BOOKING": { label: "PARTIAL BOOK PROFITS", badge: "bg-amber-500 text-slate-900 border-amber-400", bar: "from-amber-500 to-amber-300" },
  "EXIT ON LISTING": { label: "EXIT ON LISTING", badge: "bg-red-600 text-white border-red-500", bar: "from-red-600 to-red-400" },
};

const RISK_STYLE: Record<IpoRisk["level"], { dot: string; text: string }> = {
  High: { dot: "bg-red-500", text: "text-red-300" },
  Medium: { dot: "bg-amber-500", text: "text-amber-300" },
  Low: { dot: "bg-emerald-500", text: "text-emerald-300" },
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-200 border-b border-gray-800 pb-2 mb-3">
      {children}
    </h3>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-800 bg-gray-950/40 p-4 ${className}`}>
      {children}
    </div>
  );
}

function Pill({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

export default function IpoReportView({ report }: { report: IpoReport }) {
  const vs = VERDICT_STYLE[report.verdict.label] ?? VERDICT_STYLE.HOLD;
  const total = report.finalScore?.total ?? 0;

  return (
    <div className="space-y-5 text-gray-300 font-sans">
      {/* 1. Header + 3. Verdict banner */}
      <div className="rounded-2xl overflow-hidden border border-gray-800">
        <div className={`h-1.5 bg-gradient-to-r ${vs.bar}`} />
        <div className="bg-gray-950/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold text-white">
                {report.company.name || report.company.symbol}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {[report.company.symbol, report.company.sector].filter(Boolean).join(" · ") ||
                  "Equity Research"}
              </p>
            </div>
            <div className="text-right">
              <Pill cls={vs.badge}>{vs.label}</Pill>
              <div className="text-xs text-gray-500 mt-1.5">Confidence {report.verdict.confidencePct}%</div>
            </div>
          </div>
          {report.verdict.headline && (
            <p className="mt-3 text-sm text-gray-200">{report.verdict.headline}</p>
          )}
          {report.verdict.reasons.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {report.verdict.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-blue-400">▸</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 2. Top Summary score cards */}
      {report.summaryScores.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {report.summaryScores.map((s, i) => {
            const bar = s.tone === "red" ? "bg-red-500" : s.tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
            return (
              <Card key={i} className="text-center">
                <div className="text-[11px] uppercase tracking-wider text-gray-500">{s.label}</div>
                <div className="text-2xl font-extrabold text-white mt-1">{s.value}</div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full ${bar} rounded-full`}
                    style={{ width: `${Math.min(100, Math.max(0, s.value))}%` }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 4. Quick snapshot KPIs + 7. IPO Details */}
      {(report.quickSnapshots.length > 0 || report.ipoDetails.length > 0) && (
        <Card>
          <SectionTitle>Quick Snapshot</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
            {report.quickSnapshots.map((q, i) => (
              <div key={`q-${i}`}>
                <div className="text-[11px] uppercase tracking-wider text-gray-500">{q.label}</div>
                <div className="text-sm text-gray-100 mt-0.5">{q.value}</div>
              </div>
            ))}
            {report.ipoDetails.map((d, i) => (
              <div key={`d-${i}`}>
                <div className="text-[11px] uppercase tracking-wider text-gray-500">{d.label}</div>
                <div className="text-sm text-gray-100 mt-0.5">{d.value}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 5. Business Overview */}
      {report.businessOverview && (
        <Card>
          <SectionTitle>Business Overview</SectionTitle>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.businessOverview}</p>
        </Card>
      )}

      {/* 6. Financial Analysis table */}
      {report.financials.rows.length > 0 && (
        <Card>
          <SectionTitle>
            Financial Analysis{" "}
            <Pill cls="bg-blue-500/15 text-blue-300 border border-blue-500/40">
              {report.financials.rating}
            </Pill>
          </SectionTitle>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="py-2">Metric</th>
                  <th className="py-2 text-right">FY (latest)</th>
                  <th className="py-2 text-right">FY-1</th>
                  <th className="py-2 text-right">FY-2</th>
                </tr>
              </thead>
              <tbody>
                {report.financials.rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-900">
                    <td className="py-2 text-gray-200">{r.metric}</td>
                    <td className="py-2 text-right">{r.fy1}</td>
                    <td className="py-2 text-right text-gray-400">{r.fy2}</td>
                    <td className="py-2 text-right text-gray-400">{r.fy3}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.financials.summary && (
            <p className="text-sm text-gray-400 mt-3 leading-relaxed">{report.financials.summary}</p>
          )}
        </Card>
      )}

      {/* 8. GMP gauge */}
      {report.gmp && (
        <Card>
          <SectionTitle>Grey Market Premium (GMP)</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">GMP</div>
              <div className="text-lg font-bold text-white">{report.gmp.value}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Est. Listing</div>
              <div className="text-lg font-bold text-white">{report.gmp.estimatedListingPrice}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Expected Gain</div>
              <div className="text-lg font-bold text-emerald-400">+{report.gmp.expectedGainPct}%</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Trend</div>
              <Pill
                cls={
                  report.gmp.trend === "Increasing"
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                    : report.gmp.trend === "Declining"
                      ? "bg-red-500/15 text-red-300 border border-red-500/40"
                      : "bg-blue-500/15 text-blue-300 border border-blue-500/40"
                }
              >
                {report.gmp.trend}
              </Pill>
            </div>
          </div>
          {report.gmp.healthNote && (
            <p className="text-xs text-gray-500 mt-3">{report.gmp.healthNote}</p>
          )}
        </Card>
      )}

      {/* 9. News timeline */}
      {report.news.length > 0 && (
        <Card>
          <SectionTitle>News Timeline</SectionTitle>
          <div className="space-y-2.5">
            {report.news.map((n, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="shrink-0 w-16 text-[11px] text-gray-500 pt-0.5">{n.date}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-gray-200 leading-snug">{n.headline}</p>
                </div>
                <Pill
                  cls={
                    n.tag === "Positive"
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                      : n.tag === "Negative"
                        ? "bg-red-500/15 text-red-300 border border-red-500/40"
                        : "bg-slate-500/15 text-slate-300 border border-slate-600/40"
                  }
                >
                  {n.tag}
                </Pill>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 10. Market Sentiment */}
      {(report.sentiment.summary || report.sentiment.bullish.length > 0) && (
        <Card>
          <SectionTitle>
            Market Sentiment
            {report.sentiment.hypeDriven && (
              <span className="ml-2 font-normal normal-case text-[11px] text-amber-300">
                ⚠ Hype-driven
              </span>
            )}
          </SectionTitle>
          <p className="text-sm leading-relaxed mb-3">{report.sentiment.summary}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {report.sentiment.bullish.length > 0 && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
                <div className="text-[11px] font-semibold text-emerald-400 mb-1.5">Bullish</div>
                <ul className="space-y-1 text-sm">
                  {report.sentiment.bullish.map((b, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-emerald-400">+</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.sentiment.bearish.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3">
                <div className="text-[11px] font-semibold text-red-400 mb-1.5">Bearish</div>
                <ul className="space-y-1 text-sm">
                  {report.sentiment.bearish.map((b, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-red-400">−</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 11. Peer Comparison */}
      {report.peers.rows.length > 0 && (
        <Card>
          <SectionTitle>
            Peer Comparison{" "}
            <Pill
              cls={
                report.peers.valuation === "Undervalued"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                  : report.peers.valuation === "Overvalued"
                    ? "bg-red-500/15 text-red-300 border border-red-500/40"
                    : "bg-blue-500/15 text-blue-300 border border-blue-500/40"
              }
            >
              {report.peers.valuation}
            </Pill>
          </SectionTitle>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                  <th className="py-2">Peer</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">PAT %</th>
                  <th className="py-2 text-right">ROE</th>
                  <th className="py-2 text-right">P/E</th>
                  <th className="py-2 text-right">Mkt Cap</th>
                </tr>
              </thead>
              <tbody>
                {report.peers.rows.map((p, i) => (
                  <tr key={i} className="border-b border-gray-900">
                    <td className="py-2 text-gray-200">{p.name}</td>
                    <td className="py-2 text-right">{p.revenue}</td>
                    <td className="py-2 text-right">{p.patMargin}</td>
                    <td className="py-2 text-right">{p.roe}</td>
                    <td className="py-2 text-right">{p.pe}</td>
                    <td className="py-2 text-right">{p.marketCap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.peers.summary && (
            <p className="text-sm text-gray-400 mt-3">{report.peers.summary}</p>
          )}
        </Card>
      )}

      {/* 12. Future Growth roadmap */}
      {(report.futureGrowth.summary || report.futureGrowth.roadmap.length > 0) && (
        <Card>
          <SectionTitle>Future Growth Roadmap</SectionTitle>
          <p className="text-sm leading-relaxed mb-3">{report.futureGrowth.summary}</p>
          {report.futureGrowth.roadmap.length > 0 && (
            <ul className="space-y-1.5 text-sm mb-4">
              {report.futureGrowth.roadmap.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-blue-400">◆</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              ["1 Year", report.futureGrowth.oneYear],
              ["3 Years", report.futureGrowth.threeYear],
              ["5 Years", report.futureGrowth.fiveYear],
            ].map(([h, v]) => (
              <div key={h} className="rounded-lg border border-gray-800 p-3">
                <div className="text-[11px] uppercase tracking-wider text-gray-500">{h}</div>
                <div className="text-sm text-gray-100 mt-1">{v || "—"}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 13. Risk matrix */}
      {report.risks.length > 0 && (
        <Card>
          <SectionTitle>Risk Matrix</SectionTitle>
          <div className="space-y-2">
            {report.risks.map((r, i) => {
              const st = RISK_STYLE[r.level] ?? RISK_STYLE.Medium;
              return (
                <div key={i} className="flex items-start gap-3 rounded-lg border border-gray-800 p-3">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium ${st.text}`}>{r.risk}</div>
                    {r.note && <div className="text-xs text-gray-500 mt-0.5">{r.note}</div>}
                  </div>
                  <Pill
                    cls={
                      r.level === "High"
                        ? "bg-red-500/15 text-red-300 border border-red-500/40"
                        : r.level === "Medium"
                          ? "bg-amber-500/15 text-amber-300 border border-amber-500/40"
                          : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                    }
                  >
                    {r.level}
                  </Pill>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 14. Listing-Day Strategy bars */}
      {report.listingStrategy.scenarios.length > 0 && (
        <Card>
          <SectionTitle>Listing-Day Strategy</SectionTitle>
          <p className="text-sm text-gray-400 mb-3">{report.listingStrategy.summary}</p>
          <div className="space-y-2.5">
            {report.listingStrategy.scenarios.map((s, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-200">{s.scenario}</span>
                  <span className="font-semibold text-white">{s.probability}%</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-400"
                    style={{ width: `${Math.min(100, Math.max(0, s.probability))}%` }}
                  />
                </div>
                {s.play && <div className="text-xs text-gray-500 mt-1">{s.play}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 15. Target Prices */}
      {report.targets.length > 0 && (
        <Card>
          <SectionTitle>Target Prices</SectionTitle>
          <div className="grid sm:grid-cols-3 gap-3">
            {report.targets.map((t, i) => (
              <div key={i} className="rounded-lg border border-gray-800 p-3 text-center">
                <div className="text-[11px] uppercase tracking-wider text-gray-500">{t.horizon}</div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                  <div>
                    <div className="text-emerald-400 font-semibold">{t.bull}</div>
                    <div className="text-[10px] text-gray-600">Bull</div>
                  </div>
                  <div>
                    <div className="text-white font-semibold">{t.base}</div>
                    <div className="text-[10px] text-gray-600">Base</div>
                  </div>
                  <div>
                    <div className="text-red-400 font-semibold">{t.bear}</div>
                    <div className="text-[10px] text-gray-600">Bear</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 16. Final Score */}
      {Object.keys(report.finalScore.outOf10).length > 0 && (
        <Card>
          <SectionTitle>Final Score</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {Object.entries(report.finalScore.outOf10).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{k}</span>
                <span className="font-semibold text-white">{v}<span className="text-gray-600 text-xs">/10</span></span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/60 p-3">
            <span className="text-sm font-medium text-gray-200">Overall Score</span>
            <span className={`text-2xl font-extrabold ${total >= 70 ? "text-emerald-400" : total >= 50 ? "text-amber-400" : "text-red-400"}`}>
              {total}
              <span className="text-sm text-gray-500">/100</span>
            </span>
          </div>
        </Card>
      )}

      {/* 17. Final Recommendation */}
      {report.finalRecommendation && (
        <Card className="border-emerald-500/30 bg-emerald-500/[0.04]">
          <SectionTitle>
            <span className="text-emerald-400">Final Recommendation</span>
          </SectionTitle>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.finalRecommendation}</p>
        </Card>
      )}

      {/* 18. Disclaimer */}
      {report.disclaimer && (
        <p className="text-[11px] leading-relaxed text-gray-600 px-1">{report.disclaimer}</p>
      )}
    </div>
  );
}
