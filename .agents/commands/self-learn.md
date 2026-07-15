# Self-Learn Command

> Trigger the self-learning loop: reflect on work and extract patterns.

## Usage

```
/self-learn [scope]
```

### Parameters

| Parameter | Required | Description | Values |
|-----------|----------|-------------|--------|
| `scope` | - | What to analyze | `session` (default), `feature`, `all` |

### Examples

```
/self-learn session     # Analyze current session only
/self-learn feature     # Analyze whole feature implementation
/self-learn all         # Analyze all sessions
```

## Workflow

### 1. Collect Data
```markdown
## Session Data
- **Duration**: How long the session took
- **Build Attempts**: How many builds, how many succeeded
- **Test Runs**: How many test runs, pass rate
- **Files Changed**: How many files modified
- **Commits**: How many commits, messages clear?
- **Errors Encountered**: Types and frequency
- **Re-work**: How much was re-done
```

### 2. Identify Patterns

#### Good Patterns (Promote to Practices)
Look for:
- Approaches that saved time
- Patterns that prevented bugs
- Techniques that made debugging easier

#### Anti-Patterns (Add to Lessons.md)
Look for:
- Repeated mistakes
- Time-wasting approaches
- Common error sources

### 3. Update Knowledge Base

#### Update Lessons.md
```markdown
### [Number]. [Rule Name]
**Issue**: What happened
**Root Cause**: Why it happened
**Solution**: How to fix/prevent
```

#### Update agent-memory.md
```markdown
### [Date] | [Session Summary]
- **Action**: What was done
- **Files**: Files changed
- **Patterns**: New patterns discovered
- **Status**: Result
```

### 4. Generate Metrics

```markdown
## Session Metrics
- **Time to First Commit**: X min
- **Build Success Rate**: X%
- **Test Pass Rate**: X%
- **New Patterns**: X discovered
- **Anti-Patterns**: X caught
- **Handoff Quality**: Good/Fair/Poor
```

### 5. Commit Learnings

For each significant discovery:
1. Add to `Lessons.md` with clear problem/solution
2. Update `checklist.md` YAML if it's a hard rule
3. Add to `session-log.md` in learning directory
4. Reference in next handoff

## Learning Categories

### Code Quality Patterns
- TypeScript patterns
- Error handling patterns
- Testing patterns

### Process Patterns
- Development workflow
- Debugging approach
- Build optimization

### Domain Patterns
- NSE API quirks
- Prisma behavior
- Netlify deployment

## Self-Learning Checklist

- [ ] Session data collected (duration, files, builds, tests)
- [ ] Good patterns identified
- [ ] Anti-patterns identified
- [ ] Lessons.md updated with new rules
- [ ] Session logged in .agents/learning/session-log.md
- [ ] Metrics recorded
- [ ] If pattern significant: checklist.yml updated
