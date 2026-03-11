# Hooks Configuration

Trigger-based automations for TradeNext development.

## Supported Events

- `file.edited` - After file edits
- `tool.execute.after` - After tool execution
- `tool.execute.before` - Before tool execution
- `session.created` - Session start
- `session.idle` - Idle detection

## Common Hooks

### Warn on console.log
Warn when adding console.log statements:

```json
{
  "matcher": "tool == \"Edit\" && tool_input.oldString matches \"console\\\\.log\"",
  "hooks": [{
    "type": "command",
    "command": "echo \"[Hook] Remove console.log, use logger instead\""
  }]
}
```

### TypeScript Check After Edit
Run type check after modifying TypeScript files:

```json
{
  "matcher": "tool == \"Edit\" && file_path matches \"\\\\.(ts|tsx)$\"",
  "hooks": [{
    "type": "command",
    "command": "npx tsc --noEmit --skipLibCheck"
  }]
}
```

### Test After Edit
Run relevant tests after code changes:

```json
{
  "matcher": "tool == \"Edit\" && file_path matches \"lib/\"",
  "hooks": [{
    "type": "command",
    "command": "npm run test -- --passWithNoTests"
  }]
}
```
