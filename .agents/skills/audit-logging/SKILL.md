# Audit Logging Skill

## Overview
Unified event stream for all system events: Telegram, AI agents, screener runs, and system health metrics.

## Key Files
| File | Purpose |
|------|---------|
| `lib/services/unifiedEventService.ts` | Unified event logging |
| `lib/services/systemHealthService.ts` | System health monitoring |
| `app/api/system/events/route.ts` | Unified events API |
| `lib/audit.ts` | Action types (20+ new) |

## Event Types
| Category | Examples |
|----------|----------|
| **Telegram** | subscribe, unsubscribe, verify, command, broadcast |
| **AI Agent** | trigger (button/cron/API), success, failure, fallback |
| **Screener** | run_start, run_complete, run_failed, dedup |
| **System** | health_check, anomaly_detected, provider_outage |

## Anomaly Detection Rules
| Rule | Threshold | Action |
|------|-----------|--------|
| Accuracy Drop | <40% | Warning alert |
| Delivery Failure | >10% | Critical alert |
| Provider Outage | 3+ failures | Circuit breaker open |
| Response Time | >30s avg | Performance alert |

## Event Schema
```typescript
interface UnifiedEvent {
  id: string;
  eventType: string;        // 'telegram' | 'ai_agent' | 'screener' | 'system_health'
  eventSubtype: string;     // 'subscribe' | 'trigger' | 'run_start' | etc.
  source: string;           // 'telegram_bot' | 'recommendation_agent' | 'chartink'
  userId?: string;
  metadata: Json;
  severity: 'info' | 'warning' | 'critical';
  createdAt: DateTime;
}
```

## Health Metrics Tracked
- AI provider response times
- Screener execution durations
- Telegram delivery success rates
- Database query performance
- System uptime

## API Endpoints
- `GET /api/system/events` — Query events with filters
- `GET /api/admin/recommendations` — Admin overview with stats
