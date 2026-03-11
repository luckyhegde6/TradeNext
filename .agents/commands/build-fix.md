# Build Fix Command

Fix build and TypeScript errors.

## Usage

```bash
/build-fix
```

## Common Issues

### Next.js Build Errors
```bash
# Run lint first
npm run lint

# Type check
npx tsc --noEmit
```

### Prisma Issues
```bash
# Regenerate client
npm run prisma:gen

# Check migrations
npm run prisma:migrate
```

### TypeScript Errors
- Check `tsconfig.json` strict mode settings
- Ensure all imports use path aliases (`@/`)
- Verify type narrowing for external API responses
