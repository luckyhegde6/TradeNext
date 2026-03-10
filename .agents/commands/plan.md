# Plan Command

Create implementation plan for TradeNext features.

## Usage

```
/plan [feature description]
```

## Workflow

1. **Analyze** - Break down the feature requirement
2. **Identify** - Find affected files and dependencies
3. **Check** - Review against `.ai/rules/checklist.md`
4. **Plan** - Create task breakdown
5. **Estimate** - Assess complexity and risks

## Output Format

Provide:
1. Feature summary
2. Affected components
3. Task breakdown
4. Risk assessment
5. Dependencies

## Example

```
/plan Add user portfolio holdings page
```

Would produce:
- Components needed: HoldingsTable, PortfolioSummary
- API endpoints: GET /api/portfolio/:id
- Database: Holdings table query via Prisma
- Checklist items to validate
