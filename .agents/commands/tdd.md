# TDD Command

Run test-driven development workflow for TradeNext.

## Usage

```bash
/tdd [description]
```

## Workflow

1. **Analyze** - Understand the requirement and identify interfaces needed
2. **Write failing test** - Create test in `__tests__/` that fails
3. **Implement minimal code** - Write just enough code to pass
4. **Refactor** - Improve code while keeping tests passing
5. **Verify** - Run tests to confirm

## Test Commands

```bash
# Run all tests
npm run test

# Run specific test file
npm run test -- lib/__tests__/cache.test.ts

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Project Test Locations

- `lib/__tests__/` - Utility tests
- `app/components/*/__tests__/` - Component tests
