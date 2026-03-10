# Code Review Command

Review code for quality, security, and maintainability.

## Usage

```bash
/code-review [file or pattern]
```

## Checklist

### Code Quality
- [ ] TypeScript strict mode compliance
- [ ] Proper error handling with logging
- [ ] No `any` types - use `unknown` instead
- [ ] Explicit return types on exported functions

### Security
- [ ] No secrets exposed in logs
- [ ] Input validation for external data
- [ ] SQL injection prevention (use Prisma)
- [ ] XSS prevention in React

### Performance
- [ ] Proper caching strategy
- [ ] No unnecessary re-renders
- [ ] Database queries optimized

### Testing
- [ ] Critical paths have tests
- [ ] No broken tests
