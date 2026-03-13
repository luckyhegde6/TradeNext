import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { FinancialStatusDTO, CorporateAnnouncementDTO, CorpActionDTO } from "@/lib/nse/dto";

export async function syncFinancials(symbol: string, data: FinancialStatusDTO | null) {
    if (!data) return;

    try {
        const asOf = new Date(data.to_date);
        if (isNaN(asOf.getTime())) {
            logger.warn({ msg: "Invalid date for financial sync", symbol, date: data.to_date });
            return;
        }

        await prisma.fundamental.upsert({
            where: {
                ticker_asOf_periodType: {
                    ticker: symbol,
                    asOf: asOf,
                    periodType: data.audited === "Audited" ? "AUDITED" : "UNAUDITED"
                }
            },
            update: {
                revenue: parseFloat(data.totalIncome) || 0,
                netIncome: parseFloat(data.netProLossAftTax) || 0,
                eps: parseFloat(data.eps) || 0,
                rawJson: data as any
            },
            create: {
                ticker: symbol,
                asOf: asOf,
                periodType: data.audited === "Audited" ? "AUDITED" : "UNAUDITED",
                revenue: parseFloat(data.totalIncome) || 0,
                netIncome: parseFloat(data.netProLossAftTax) || 0,
                eps: parseFloat(data.eps) || 0,
                rawJson: data as any
            }
        });
        logger.info({ msg: "Synced financials to DB", symbol, asOf });
    } catch (e) {
        logger.error({ msg: "Error syncing financials", symbol, error: e });
    }
}

export async function syncAnnouncements(symbol: string, announcements: CorporateAnnouncementDTO[]) {
    if (!announcements || announcements.length === 0) return;

    try {
        for (const ann of announcements) {
            const broadcastDate = new Date(ann.sort_date);

            // Note: We don't have a unique ID from NSE that is consistent across fetches easily
            // besides timestamp + symbol + subject. Using subject + timestamp as a proxy.
            // In the schema, CorporateAnnouncement uses cuid() as primary key.
            // To avoid duplicates, we check if one exists with same symbol, subject, and date.

            const existing = await prisma.corporateAnnouncement.findFirst({
                where: {
                    symbol: symbol,
                    subject: ann.desc,
                    broadcastDateTime: broadcastDate
                }
            });

            if (!existing) {
                await prisma.corporateAnnouncement.create({
                    data: {
                        symbol: symbol,
                        companyName: ann.sm_name || symbol,
                        subject: ann.desc,
                        details: ann.attchmntText,
                        broadcastDateTime: broadcastDate,
                        attachment: ann.attchmntFile
                    }
                });
            }
        }
        logger.info({ msg: "Synced announcements to DB", symbol, count: announcements.length });
    } catch (e) {
        logger.error({ msg: "Error syncing announcements", symbol, error: e });
    }
}

export async function syncActions(symbol: string, actions: CorpActionDTO[]) {
    if (!actions || actions.length === 0) return;

    try {
        for (const action of actions) {
            // Determine action type from subject
            const subject = action.subject?.toUpperCase() || "";
            let actionType = "CORPORATE_ACTION";
            
            if (subject.includes("DIVIDEND") || subject.includes("CASH")) {
                actionType = "DIVIDEND";
            } else if (subject.includes("SPLIT") || subject.includes("DIV")) {
                actionType = "SPLIT";
            } else if (subject.includes("BONUS")) {
                actionType = "BONUS";
            } else if (subject.includes("RIGHTS")) {
                actionType = "RIGHTS";
            } else if (subject.includes("BUYBACK")) {
                actionType = "BUYBACK";
            }

            const exDate = action.exDate ? new Date(action.exDate) : null;
            const recDate = action.recDate ? new Date(action.recDate) : null;

            if (!exDate || isNaN(exDate.getTime())) continue;

            // Parse dividend amount from subject (e.g., "Rs 2.50 per share" or "Rs 12.50")
            let dividendPerShare: number | undefined = undefined;
            let dividendYield: number | undefined = undefined;
            
            if (actionType === "DIVIDEND") {
                const dividendMatch = subject.match(/Rs\s*([\d.]+)/i);
                if (dividendMatch) {
                    dividendPerShare = parseFloat(dividendMatch[1]);
                    
                    // Calculate dividend yield based on face value
                    // dividendYield = (dividendPerShare / faceValue) * 100
                    if (dividendPerShare && action.faceVal) {
                        const faceValNum = parseFloat(action.faceVal.replace(/,/g, ''));
                        if (faceValNum > 0) {
                            dividendYield = (dividendPerShare / faceValNum) * 100;
                        }
                    }
                }
            }

            // Parse old and new face value for splits
            let oldFV: string | undefined = undefined;
            let newFV: string | undefined = undefined;
            
            if (actionType === "SPLIT" && action.faceVal) {
                // Parse face value split (e.g., "10 to 2")
                const fvMatch = action.faceVal.match(/(\d+)\s*to\s*(\d+)/i);
                if (fvMatch) {
                    oldFV = fvMatch[1];
                    newFV = fvMatch[2];
                } else {
                    // If no "to", assume it's already in new format
                    newFV = action.faceVal;
                }
            }

            // Parse bonus ratio
            let ratio: string | undefined = undefined;
            if (actionType === "BONUS") {
                const ratioMatch = action.faceVal?.match(/(\d+:\d+)/i) || subject.match(/(\d+:\d+)/i);
                if (ratioMatch) {
                    ratio = ratioMatch[1];
                }
            }

            // Check if exists and update or create
            const existing = await prisma.corporateAction.findFirst({
                where: {
                    symbol: symbol.toUpperCase(),
                    exDate: exDate,
                    actionType: actionType
                }
            });

            if (existing) {
                await prisma.corporateAction.update({
                    where: { id: existing.id },
                    data: {
                        companyName: action.comp || action.symbol || symbol,
                        series: action.series || "EQ",
                        subject: action.subject,
                        recordDate: recDate || undefined,
                        faceValue: action.faceVal || undefined,
                        oldFV: oldFV,
                        newFV: newFV,
                        ratio: ratio,
                        dividendPerShare: dividendPerShare,
                        dividendYield: dividendYield,
                        isin: action.isin || undefined,
                        updatedAt: new Date()
                    }
                });
            } else {
                await prisma.corporateAction.create({
                    data: {
                        symbol: symbol.toUpperCase(),
                        companyName: action.comp || action.symbol || symbol,
                        series: action.series || "EQ",
                        subject: action.subject,
                        actionType: actionType,
                        exDate: exDate,
                        recordDate: recDate || undefined,
                        faceValue: action.faceVal || undefined,
                        oldFV: oldFV,
                        newFV: newFV,
                        ratio: ratio,
                        dividendPerShare: dividendPerShare,
                        dividendYield: dividendYield,
                        isin: action.isin || undefined
                    }
                });
            }
        }
        logger.info({ msg: "Synced corporate actions to DB", symbol, count: actions.length });
    } catch (e) {
        logger.error({ msg: "Error syncing corporate actions", symbol, error: e });
    }
}
