// app/api/admin/nse/results-comparison/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFinancialResultsComparison } from "@/lib/index-service";
import logger from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Get financial results comparison for a specific stock
 * API: https://www.nseindia.com/api/results-comparision?index=equities&symbol=ITC&issuer=ITC%20Limited
 */
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session || !session.user) {
            // Allow public access for viewing financial results
        }

        const { searchParams } = new URL(req.url);
        const symbol = searchParams.get('symbol') as string;

        if (!symbol) {
            return NextResponse.json({ error: "Missing required parameter: symbol" }, { status: 400 });
        }

        const issuerName = searchParams.get('issuer') as string | undefined;

        logger.info({ msg: "Fetching financial results comparison", symbol, issuerName });

        const data = await getFinancialResultsComparison(symbol, issuerName);

        if (!data) {
            return NextResponse.json({ 
                error: "No financial results found for this symbol",
                symbol 
            }, { status: 404 });
        }

        // Transform the data to a more readable format
        // NSE returns data in resCmpData array with fields prefixed with re_
        const rawData = data.resCmpData || data.data || [];
        
        const transformedData = rawData.map((item: any) => {
            const revenue = item.re_net_sale ? Number(item.re_net_sale) : null;
            const otherIncome = item.re_oth_inc_new ? Number(item.re_oth_inc_new) : null;
            const totalIncome = revenue !== null && otherIncome !== null 
                ? revenue + otherIncome 
                : (revenue !== null ? revenue : otherIncome);
            
            return {
                period: item.re_from_dt && item.re_to_dt 
                    ? `${item.re_from_dt} to ${item.re_to_dt}` 
                    : item.re_to_dt || "-",
                periodType: item.re_res_type === 'A' ? 'Annual' : 'Quarterly',
                resultType: item.re_res_type === 'A' ? 'Audited' : 'Unaudited',
                revenue,
                otherIncome,
                totalIncome,
                totalExpenses: item.re_oth_tot_exp ? Number(item.re_oth_tot_exp) : null,
                profit: item.re_net_profit ? Number(item.re_net_profit) : null,
                profitBeforeTax: item.re_pro_loss_bef_tax ? Number(item.re_pro_loss_bef_tax) : null,
                basicEps: item.re_basic_eps_for_cont_dic_opr ? Number(item.re_basic_eps_for_cont_dic_opr) : null,
                dilutedEps: item.re_dilut_eps_for_cont_dic_opr ? Number(item.re_dilut_eps_for_cont_dic_opr) : null,
                tax: item.re_tax ? Number(item.re_tax) : null,
                depreciation: item.re_depr_und_exp ? Number(item.re_depr_und_exp) : null,
                interest: item.re_int_new ? Number(item.re_int_new) : null,
                faceValue: item.re_face_val ? Number(item.re_face_val) : null,
            };
        });

        return NextResponse.json({
            symbol,
            companyName: data.issuerName || data.companyName || symbol,
            data: transformedData
        });

    } catch (error) {
        logger.error({ msg: "Financial results comparison error", error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ 
            error: "Failed to fetch financial results",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
