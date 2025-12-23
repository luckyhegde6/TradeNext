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