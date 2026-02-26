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
            const actionDate = new Date(action.exDate);
            if (isNaN(actionDate.getTime())) continue;

            const existing = await prisma.corporateAction.findFirst({
                where: {
                    symbol: symbol,
                    exDate: actionDate,
                    actionType: action.subject
                }
            });

            if (!existing) {
                await prisma.corporateAction.create({
                    data: {
                        symbol: symbol,
                        companyName: action.symbol || action.comp || symbol,
                        subject: action.subject,
                        exDate: actionDate,
                        recDate: action.recDate ? new Date(action.recDate) : null,
                        faceValue: action.faceVal,
                        actionType: 'CORPORATE_ACTION'
                    }
                });
            }
        }
        logger.info({ msg: "Synced corporate actions to DB", symbol, count: actions.length });
    } catch (e) {
        logger.error({ msg: "Error syncing corporate actions", symbol, error: e });
    }
}
