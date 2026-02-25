export interface ParsedTransaction {
  date: Date;
  ticker: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  fees?: number;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

const DATE_FORMATS = [
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{2})\/(\d{2})\/(\d{4})$/,
  /^(\d{2})-(\d{2})-(\d{4})$/,
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
];

function parseDate(dateStr: string): Date | null {
  const cleaned = dateStr.trim();
  
  const isoMatch = cleaned.match(DATE_FORMATS[0]);
  if (isoMatch) {
    return new Date(cleaned);
  }

  const ddmmyyyy = cleaned.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
  }

  try {
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[^A-Z]/g, '');
}

function normalizeSide(side: string): 'BUY' | 'SELL' {
  const normalized = side.trim().toUpperCase();
  if (normalized.includes('BUY') || normalized === 'B' || normalized === 'C' || normalized === 'CALL') {
    return 'BUY';
  }
  if (normalized.includes('SELL') || normalized === 'S' || normalized === 'SELL' || normalized === 'PUT') {
    return 'SELL';
  }
  throw new Error(`Invalid side: ${side}`);
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return num;
}

export interface CSVColumnMapping {
  date: number;
  ticker: number;
  side: number;
  quantity: number;
  price: number;
  fees?: number;
}

export function parseCSV(
  content: string,
  mapping: CSVColumnMapping
): ParsedTransaction[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  const results: ParsedTransaction[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const columns = parseCSVLine(line);
    
    try {
      const date = parseDate(columns[mapping.date]);
      if (!date) {
        errors.push(`Row ${i + 1}: Invalid date "${columns[mapping.date]}"`);
        continue;
      }

      const ticker = normalizeTicker(columns[mapping.ticker]);
      if (!ticker) {
        errors.push(`Row ${i + 1}: Invalid ticker "${columns[mapping.ticker]}"`);
        continue;
      }

      const side = normalizeSide(columns[mapping.side]);
      const quantity = parseNumber(columns[mapping.quantity]);
      const price = parseNumber(columns[mapping.price]);
      const fees = mapping.fees !== undefined ? parseNumber(columns[mapping.fees]) : 0;

      if (quantity <= 0) {
        errors.push(`Row ${i + 1}: Quantity must be positive`);
        continue;
      }

      if (price <= 0) {
        errors.push(`Row ${i + 1}: Price must be positive`);
        continue;
      }

      results.push({
        date,
        ticker,
        side,
        quantity,
        price,
        fees,
      });
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'Parse error'}`);
    }
  }

  if (errors.length > 0 && results.length === 0) {
    throw new Error(errors.join('\n'));
  }

  return results;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

export const BROKER_TEMPLATES = {
  zerodha: {
    name: 'Zerodha',
    columns: ['Date', 'Trading Symbol', 'Transaction Type', 'Quantity', 'Price', ' brokerage'],
    mapping: { date: 0, ticker: 1, side: 2, quantity: 3, price: 4, fees: 5 },
  },
  upstox: {
    name: 'Upstox',
    columns: ['Date', 'Symbol', 'Type', 'Qty', 'Avg Price', ' brokerage'],
    mapping: { date: 0, ticker: 1, side: 2, quantity: 3, price: 4, fees: 5 },
  },
  angelone: {
    name: 'Angel One',
    columns: ['Date', 'Symbol', 'Order Type', 'Buy Quantity', 'Sell Quantity', 'Avg Price'],
    mapping: { date: 0, ticker: 1, side: 2, quantity: 3, price: 5, fees: 0 },
  },
  generic: {
    name: 'Generic CSV',
    columns: ['Date', 'Ticker', 'Type', 'Quantity', 'Price', 'Fees'],
    mapping: { date: 0, ticker: 1, side: 2, quantity: 3, price: 4, fees: 5 },
  },
};

export function detectBrokerTemplate(headers: string[]): string {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
  
  if (normalizedHeaders.some(h => h.includes('trading symbol') || h.includes('symbol'))) {
    if (normalizedHeaders.includes('brokerage')) {
      return 'zerodha';
    }
  }
  
  if (normalizedHeaders.some(h => h.includes('avg price'))) {
    if (normalizedHeaders.includes('buy quantity') || normalizedHeaders.includes('sell quantity')) {
      return 'angelone';
    }
  }
  
  return 'generic';
}

export function validateImportData(
  transactions: ParsedTransaction[],
  portfolioId: string
): { valid: ParsedTransaction[]; invalid: { transaction: ParsedTransaction; reason: string }[] } {
  const valid: ParsedTransaction[] = [];
  const invalid: { transaction: ParsedTransaction; reason: string }[] = [];

  for (const txn of transactions) {
    if (txn.date > new Date()) {
      invalid.push({ transaction: txn, reason: 'Future date not allowed' });
      continue;
    }

    if (txn.quantity <= 0 || txn.price <= 0) {
      invalid.push({ transaction: txn, reason: 'Invalid quantity or price' });
      continue;
    }

    valid.push(txn);
  }

  return { valid, invalid };
}
