// app/api/nse/corporate-info/route.ts
import { NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";

export async function GET() {
  const data = await nseFetch(
    "/api/NextApi/apiClient",
    "?functionName=getCorporateInfo&&type=null&&noOfRecords=10&&flag=PI"
  );

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
