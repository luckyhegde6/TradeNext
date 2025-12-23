export type GainerDTO = {
  symbol: string;
  ltp: number;
  pChange: number;
};

export type LoserDTO = {
  symbol: string;
  ltp: number;
  pChange: number;
};

export type DealDTO = {
  symbol: string;
  quantity: number;
  price: number;
  clientName?: string;
  buySell?: string;
};

export type MostActiveDTO = {
  symbol: string;
  ltp: number;
  volume: number;
  turnover: number;
  change?: number;
  pChange?: number;
  previousClose?: number;
};
export type CorporateInfoDTO = {
  symbol: string;
  ltp: number;
  pChange: number;
};

export type AdvanceDeclineDTO = {
  symbol: string;
  ltp: number;
  pChange: number;
};

export interface FinancialStatusDTO {
  from_date: string;
  to_date: string;
  to_date_MonYr: string;
  series: string;
  expenditure: string;
  totalIncome: string;
  audited: string;
  cumulative: string;
  consolidated: string;
  eps: string;
  reProLossBefTax: string;
  netProLossAftTax: string;
  re_broadcast_timestamp: string;
}

export interface CorpEventDTO {
  bm_symbol: string;
  bm_date: string;
  bm_purpose: string;
  bm_desc: string;
  sm_indusrty: string;
  bm_timestamp: string;
  sm_name: string;
  sm_isin: string;
  bm_dt: string;
  bm_timestamp_full: string;
  bm_an_seq_id: string;
  bm_attachment: string;
}

export interface CorporateAnnouncementDTO {
  symbol: string;
  desc: string;
  dt: string;
  attchmntFile: string;
  sm_name: string;
  sm_isin: string;
  an_dt: string;
  sort_date: string;
  seq_id: string | null;
  smIndustry: string;
  attchmntText: string;
  exchdisstime: string;
  fileSize: string;
  hasXbrl: boolean;
}

export interface CorpActionDTO {
  subject: string;
  symbol: string;
  series: string;
  faceVal: string;
  exDate: string;
  recDate: string;
  comp: string;
  isin: string;
}