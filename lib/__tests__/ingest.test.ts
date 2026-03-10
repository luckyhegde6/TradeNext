import { runIngestion } from '../services/ingestService';
import { poolQuery } from '../db/server';
import path from 'path';

// Mock fs and csv-parse with jest.fn() in factories
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('csv-parse/sync', () => ({
  parse: jest.fn(),
}));

// Import mocked modules
import * as mockedFs from 'fs';
import * as mockedCsvParse from 'csv-parse/sync';

const mockExistsSync = mockedFs.existsSync as jest.Mock;
const mockReadFileSync = mockedFs.readFileSync as jest.Mock;
const mockParse = mockedCsvParse.parse as jest.Mock;

const mockPoolQuery = poolQuery as jest.Mocked<typeof poolQuery>;

describe('Ingestion Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParse.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  describe('runIngestion', () => {
    const sampleCSV = `SYMBOL,DATE,OPEN,HIGH,LOW,CLOSE,VOLUME,VWAP
TCS,2025-11-28,3600,3625,3580,3610,1250000,3605
INFY,2025-11-28,1500,1520,1485,1510,980000,1508
RELIANCE,2025-11-28,2400,2450,2390,2440,2200000,2425`;

    const mockRecords = [
      {
        SYMBOL: 'TCS',
        DATE: '2025-11-28',
        OPEN: '3600',
        HIGH: '3625',
        LOW: '3580',
        CLOSE: '3610',
        VOLUME: '1250000',
        VWAP: '3605',
      },
      {
        SYMBOL: 'INFY',
        DATE: '2025-11-28',
        OPEN: '1500',
        HIGH: '1520',
        LOW: '1485',
        CLOSE: '1510',
        VOLUME: '980000',
        VWAP: '1508',
      },
      {
        SYMBOL: 'RELIANCE',
        DATE: '2025-11-28',
        OPEN: '2400',
        HIGH: '2450',
        LOW: '2390',
        CLOSE: '2440',
        VOLUME: '2200000',
        VWAP: '2425',
      },
    ];

    it('should successfully ingest CSV data', async () => {
      // Arrange
      const mockClient = {
        query: jest.fn().mockResolvedValue(undefined),
      };
      mockPoolQuery.connect = jest.fn().mockResolvedValue(mockClient);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(sampleCSV);
      mockParse.mockReturnValue(mockRecords);

      // Act
      const result = await runIngestion('/test/path.csv');

      // Assert
      expect(result.status).toBe('ok');
      expect(result.rows).toBe(3);

      // Verify transaction handling
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.query).toHaveBeenCalledTimes(4); // BEGIN + 3 upserts + COMMIT

      // Verify each upsert query
      const calls = mockClient.query.mock.calls;
      expect(calls[1][0]).toContain('INSERT INTO daily_prices');
      expect(calls[1][1]).toEqual(['TCS', '2025-11-28', 3600, 3625, 3580, 3610, 1250000, 3605]);
      expect(calls[2][1]).toEqual(['INFY', '2025-11-28', 1500, 1520, 1485, 1510, 980000, 1508]);
      expect(calls[3][1]).toEqual(['RELIANCE', '2025-11-28', 2400, 2450, 2390, 2440, 2200000, 2425]);
    });

    it('should use default CSV path when no path provided', async () => {
      // Arrange
      const defaultPath = path.join(process.cwd(), 'api', 'sample_nse.csv');

      const mockClient = {
        query: jest.fn().mockResolvedValue(undefined),
      };
      mockPoolQuery.connect = jest.fn().mockResolvedValue(mockClient);
      mockExistsSync.mockReturnValue(false); // will return error before reading

      // Act
      const result = await runIngestion();

      // Assert
      expect(mockExistsSync).toHaveBeenCalledWith(defaultPath);
      expect(result.status).toBe('error');
      expect(result.error).toBe('CSV not found');
    });

    it('should return error when CSV file does not exist', async () => {
      // Arrange
      mockExistsSync.mockReturnValue(false);

      // Act
      const result = await runIngestion('/nonexistent/path.csv');

      // Assert
      expect(result.status).toBe('error');
      expect(result.error).toBe('CSV not found');
      expect(result.rows).toBe(0);
    });

    it('should rollback transaction on database error', async () => {
      // Arrange
      const mockClient = {
        query: jest.fn().mockRejectedValue(new Error('DB constraint violation')),
      };
      mockPoolQuery.connect = jest.fn().mockResolvedValue(mockClient);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(sampleCSV);
      mockParse.mockReturnValue(mockRecords);

      // Act
      const result = await runIngestion('/test/path.csv');

      // Assert
      expect(result.status).toBe('error');
      expect(result.error).toContain('DB constraint violation');

      // Verify rollback was called
      const calls = mockClient.query.mock.calls;
      expect(calls.some(call => call[0] === 'ROLLBACK')).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle empty CSV file', async () => {
      // Arrange
      const mockClient = {
        query: jest.fn(),
      };
      mockPoolQuery.connect = jest.fn().mockResolvedValue(mockClient);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('SYMBOL,DATE,OPEN,HIGH,LOW,CLOSE,VOLUME,VWAP\n');
      mockParse.mockReturnValue([]);

      // Act
      const result = await runIngestion('/test/empty.csv');

      // Assert
      expect(result.status).toBe('ok');
      expect(result.rows).toBe(0);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should handle CSV parsing with different column names', async () => {
      // Arrange - test case insensitivity
      const flexibleCSV = `symbol,date,open,high,low,close,volume,vwap
TCS,2025-11-28,3600,3625,3580,3610,1250000,3605`;

      const flexibleRecords = [
        {
          symbol: 'TCS',
          date: '2025-11-28',
          open: '3600',
          high: '3625',
          low: '3580',
          close: '3610',
          volume: '1250000',
          vwap: '3605',
        },
      ];

      const mockClient = {
        query: jest.fn(),
      };
      mockPoolQuery.connect = jest.fn().mockResolvedValue(mockClient);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(flexibleCSV);
      mockParse.mockReturnValue(flexibleRecords);

      // Act
      const result = await runIngestion();

      // Assert
      expect(result.status).toBe('ok');
      expect(result.rows).toBe(1);
    });

    it('should handle missing optional fields (vwap)', async () => {
      // Arrange
      const csvWithoutVWAP = `SYMBOL,DATE,OPEN,HIGH,LOW,CLOSE,VOLUME
TCS,2025-11-28,3600,3625,3580,3610,1250000`;

      const recordsWithoutVWAP = [
        {
          SYMBOL: 'TCS',
          DATE: '2025-11-28',
          OPEN: '3600',
          HIGH: '3625',
          LOW: '3580',
          CLOSE: '3610',
          VOLUME: '1250000',
          vwap: undefined,
        },
      ];

      const mockClient = {
        query: jest.fn(),
      };
      mockPoolQuery.connect = jest.fn().mockResolvedValue(mockClient);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(csvWithoutVWAP);
      mockParse.mockReturnValue(recordsWithoutVWAP);

      // Act
      const result = await runIngestion();

      // Assert
      expect(result.status).toBe('ok');
      expect(result.rows).toBe(1);

      // Verify vwap is null (9th parameter, index 8)
      const calls = mockClient.query.mock.calls;
      expect(calls[1][1][8]).toBeNull();
    });

    it('should sanitize whitespace in symbol', async () => {
      // Arrange
      const csvWithSpaces = `SYMBOL,DATE,OPEN,HIGH,LOW,CLOSE,VOLUME,VWAP
 TCS ,2025-11-28,3600,3625,3580,3610,1250000,3605`;

      const mockClient = {
        query: jest.fn(),
      };
      mockPoolQuery.connect = jest.fn().mockResolvedValue(mockClient);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(csvWithSpaces);
      mockParse.mockReturnValue([mockRecords[0]]);

      // Act
      await runIngestion();

      // Assert
      const calls = mockClient.query.mock.calls;
      expect(calls[1][1][0]).toBe('TCS'); // trimmed symbol
    });
  });
});