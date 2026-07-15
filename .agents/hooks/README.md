# Hooks Configuration

> Trigger-based automations for TradeNext development. Hooks automatically invoke actions based on events.

## Supported Events

- `file.edited` - After file edits
- `tool.execute.after` - After tool execution
- `tool.execute.before` - Before tool execution
- `session.created` - Session start
- `session.idle` - Idle detection

## Available Hooks

### 1. Warn on console.log
Warn when adding console.log statements (should use logger):
```json
{
  "matcher": "tool == \"Edit\" && tool_input.oldString matches \"console\\\\.log\"",
  "hooks": [{
    "type": "command",
    "command": "echo \"[Hook] WARNING: Use logger instead of console.log. See AGENTS.md for logging patterns.\""
  }]
}
```

### 2. TypeScript Check After Edit
Run type check after modifying TypeScript files:
```json
{
  "matcher": "tool == \"Edit\" && file_path matches \"\\\\.(ts|tsx)$\"",
  "hooks": [{
    "type": "command",
    "command": "npx tsc --noEmit --skipLibCheck 2>&1 | head -20"
  }]
}
```

### 3. Test After Edit
Run relevant tests after code changes:
```json
{
  "matcher": "tool == \"Edit\" && file_path matches \"lib/\"",
  "hooks": [{
    "type": "command",
    "command": "npm run test -- --passWithNoTests --silent 2>&1 | tail -10"
  }]
}
```

### 4. Handoff State Update
Auto-update handoff state after commits:
```json
{
  "matcher": "tool.execute.after matches \"Bash\\(\" && tool_input.command matches \"git commit\"",
  "hooks": [{
    "type": "command",
    "command": "echo \"[Hook] Commit detected - remember to update handoff state in HANDOFF.md if needed\""
  }]
}
```

### 5. Documentation Reminder
Remind to update docs after significant edits:
```json
{
  "matcher": "tool == \"Edit\" && (file_path matches \"app/api/\" || file_path matches \"lib/services/\")",
  "hooks": [{
    "type": "command",
    "command": "echo \"[Hook] API/Service change detected - remember to update AGENTS.md documentation\""
  }]
}
```

### 6. Secrets Detection
Warn about potential secrets in edits:
```json
{
  "matcher": "tool == \"Edit\" && (tool_input.newString matches \"(password|secret|key|token)\\s*[:=]\\s*['\\\"][A-Za-z0-9_!@#$%^&*()-=+]{20,}['\\\"]\")",
  "hooks": [{
    "type": "command",
    "command": "echo \"[Hook] ⚠️ CRITICAL: Potential secret/hardcoded credential detected! Remove before commit.\""
  }]
}
```

### 7. Handoff File Change Tracker
Track when handoff files are modified:
```json
{
  "matcher": "tool == \"Edit\" && file_path matches \"\\.agents/handoffs/\"",
  "hooks": [{
    "type": "command",
    "command": "echo \"[Hook] Handoff file changed - ensure HANDOFF.md is in sync\""
  }]
}
```

### 8. Session Start Hook
Run on session start to check for pending handoffs:
```json
{
  "matcher": "event == \"session.created\"",
  "hooks": [{
    "type": "command",
    "command": "echo \"[Hook] Session started - checking HANDOFF.md for pending handoffs...\""
  }]
}
```

## Hook Configuration Format

```json
{
  "matcher": "event/condition expression",
  "hooks": [
    {
      "type": "command",
      "command": "shell command to run"
    }
  ]
}
```

## Best Practices

1. **Keep hooks lightweight** - Heavy hooks slow down development
2. **Use clear messages** - Each hook output should be self-explanatory
3. **No destructive hooks** - Hooks should never modify files or run destructive commands
4. **Fail gracefully** - Hooks should not block the development flow
5. **Log hook triggers** - Consider logging which hooks fired for debugging
