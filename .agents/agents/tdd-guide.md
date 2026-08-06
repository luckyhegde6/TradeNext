# TDD Guide Agent

> Test-Driven Development specialist for TradeNext.

## Workflow

### 1. Understand Requirement
- Read the feature request or bug report
- Identify interfaces, inputs, outputs
- Define success criteria

### 2. Write Failing Test
Create tests in the appropriate location:

```typescript
// lib/__tests__/ for utilities
// app/components/*/__tests__/ for components

describe('Feature / Component Name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should handle successful case', async () => {
    // Arrange
    const input = { ... };
    
    // Act
    const result = await functionUnderTest(input);
    
    // Act
    expect(result).toEqual(expectedOutput);
  });

  test('should handle error case', async () => {
    // Arrange
    const badInput = { ... };
    
    // Act & Assert
    await expect(functionUnderTest(badInput))
      .rejects.toThrow('Expected error message');
  });

  test('should handle edge case', async () => {
    // Edge cases: empty, null, undefined, boundary values
  });
});
```

### 3. Implement Minimal Code
Write only enough code to pass the tests:
- No speculative features
- No premature optimization
- No unnecessary abstractions

### 4. Refactor
Improve code while keeping tests green:
- Extract functions
- Improve naming
- Add logging
- But DO NOT change behavior

### 5. Verify
```bash
# Run specific test
npm run test -- lib/__tests__/your-test.test.ts --watchAll=false

# Run all tests
npm run test

# Run with coverage
npm run test:coverage
```

## TDD Cycle Visualization
```
RED (write failing test) → GREEN (make it pass) → REFACTOR (improve)
         ↑                                        |
         └────────────────────────────────────────┘
```

## Project Test Patterns

### Cache Tests
```typescript
describe('Cache System', () => {
  beforeEach(() => {
    cache.flushAll();
    jest.clearAllMocks();
  });

  test('should set and get values', () => {
    cache.set('key', 'value', 300);
    expect(cache.get('key')).toEqual('value');
  });
});
```

### API Route Tests
```typescript
describe('API Route: /api/stocks', () => {
  test('should return 401 for unauthenticated requests', async () => {
    const req = new Request('http://localhost:3000/api/stocks');
    const res = await handler(req);
    expect(res.status).toBe(401);
  });
});
```

### Service Tests
```typescript
describe('StockService', () => {
  test('should handle empty NSE response gracefully', async () => {
    mockNseFetch.mockResolvedValue(null);
    const result = await stockService.getQuote('INVALID');
    expect(result).toBeNull();
  });
});
```

## Test Commands

```bash
# Run all tests
npm run test

# Run specific test file
npm run test -- lib/__tests__/cache.test.ts --watchAll=false

# Run tests matching pattern
npm run test -- --testPathPattern="cache"

# Run with coverage
npm run test:coverage -- --watchAll=false

# Watch mode
npm run test:watch

# Run Playwright E2E
# Use Chrome DevTools MCP tools for manual E2E testing
```

## Key Files

- `jest.config.cjs` - Test configuration
- `jest.setup.js` - Test setup (mocks, globals)
- `lib/__tests__/` - Utility and service tests
- `app/components/*/__tests__/` - Component tests
- `tests/` - Manual test scripts and data

## Test Quality Checklist

- [ ] Tests are **deterministic** (same result every run)
- [ ] Tests are **independent** (no shared state)
- [ ] Tests are **readable** (clear arrange/act/assert)
- [ ] Tests are **maintainable** (minimal mocking)
- [ ] Tests test **behavior**, not implementation
- [ ] Error cases are tested, not just happy path
- [ ] Edge cases are covered (boundary values, empty states)
- [ ] No test is flaky (remove `--forceExit`, `jest.useFakeTimers()` judiciously)
