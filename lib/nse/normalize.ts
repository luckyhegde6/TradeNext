import { GainerDTO, DealDTO, MostActiveDTO, AdvanceDeclineDTO, CorporateInfoDTO, LoserDTO } from "./dto";

export function normalizeGainers(raw: any): GainerDTO[] {
  // Handle nested structure with categories (NIFTY, BANKNIFTY, etc.)
  // Use the first available category's data, or fallback to direct data array
  let dataArray: any[] = [];

  if (raw?.NIFTY?.data) {
    dataArray = raw.NIFTY.data;
  } else if (raw?.allSec?.data) {
    dataArray = raw.allSec.data;
  } else if (Array.isArray(raw?.data)) {
    dataArray = raw.data;
  } else if (Array.isArray(raw)) {
    dataArray = raw;
  }

  return dataArray.map((r: any) => ({
    symbol: r.symbol,
    ltp: Number(r.ltp || 0),
    pChange: Number(r.perChange || r.pChange || 0),
  }));
}

export function normalizeDeals(raw: any): DealDTO[] {
  // Handle bulk deals structure: BULK_DEALS_DATA array
  let dataArray: any[] = [];

  if (raw?.BULK_DEALS_DATA) {
    dataArray = raw.BULK_DEALS_DATA;
  } else if (Array.isArray(raw?.data)) {
    dataArray = raw.data;
  } else if (Array.isArray(raw)) {
    dataArray = raw;
  }

  return dataArray.map((r: any) => ({
    symbol: r.symbol || "",
    quantity: Number(r.qty || r.quantity || 0),
    price: Number(r.watp || r.price || 0),
    clientName: r.clientName || r.client_name || r.client || "",
    buySell: r.buySell || "",
  }));
}

export function normalizeMostActive(raw: any): MostActiveDTO[] {
  // Handle most active data structure with lastPrice, totalTradedVolume, totalTradedValue
  const dataArray = Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw) ? raw : []);

  return dataArray.map((r: any) => ({
    symbol: r.symbol || "",
    ltp: Number(r.lastPrice || r.ltp || 0),
    volume: Number(r.totalTradedVolume || r.volume || r.quantityTraded || 0),
    turnover: Number(r.totalTradedValue || r.turnover || 0),
    change: Number(r.change || 0),
    pChange: Number(r.pChange || r.perChange || 0),
    previousClose: Number(r.previousClose || 0),
  }));
}

export function normalizeLosers(raw: any): LoserDTO[] {
  // Handle nested structure with categories (NIFTY, BANKNIFTY, etc.)
  // Use the first available category's data, or fallback to direct data array
  let dataArray: any[] = [];

  if (raw?.NIFTY?.data) {
    dataArray = raw.NIFTY.data;
  } else if (raw?.allSec?.data) {
    dataArray = raw.allSec.data;
  } else if (Array.isArray(raw?.data)) {
    dataArray = raw.data;
  } else if (Array.isArray(raw)) {
    dataArray = raw;
  }

  return dataArray.map((r: any) => ({
    symbol: r.symbol,
    ltp: Number(r.ltp || 0),
    pChange: Number(r.perChange || r.pChange || 0),
  }));
}

export function normalizeCorporateInfo(raw: any): CorporateInfoDTO[] {
  return (raw?.data || []).map((r: any) => ({
    symbol: r.symbol,
    ltp: Number(r.ltp),
    pChange: Number(r.pChange),
  }));
}
export function normalizeAdvanceDecline(raw: any): AdvanceDeclineDTO[] {
  return (raw?.data || []).map((r: any) => ({
    symbol: r.symbol,
    ltp: Number(r.ltp),
    pChange: Number(r.pChange),
  }));
}

