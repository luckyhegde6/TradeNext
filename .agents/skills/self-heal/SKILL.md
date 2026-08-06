# Self-Heal AI Agent Skill

## Overview
Circuit breaker, performance monitoring, and self-learning for AI agents. Prevents cascading failures and auto-adjusts prompts based on accuracy.

## Key Files
| File | Purpose |
|------|---------|
| `lib/services/ai/circuit-breaker.ts` | Circuit breaker for AI provider |
| `lib/services/ai/performance-monitor.ts` | Degradation detection |
| `lib/services/ai/prediction-tracker.ts` | Accuracy tracking |
| `lib/services/ai/prompt-manager.ts` | Prompt versioning |
| `lib/services/ai/self-learning.ts` | Feed-back loop |

## Circuit Breaker States
```
CLOSED (normal) → [3 failures] → OPEN (blocked) → [30s cooldown] → HALF_OPEN (probe) → [success] → CLOSED
                                                                              ↓ [failure]
                                                                           OPEN (re-blocked)
```

## Performance Thresholds
| Metric | Warning | Critical |
|--------|---------|----------|
| Success Rate | <80% | <60% |
| Avg Response Time | >10s | >30s |
| Token Usage | >80% limit | >95% limit |

## Prediction Accuracy
- **Win**: >5% gain from entry price
- **Breakeven**: ±5% from entry price
- **Loss**: >5% negative from entry price
- **Check intervals**: 1 week, 1 month, 3 months
- **Auto-adjust trigger**: Accuracy <40% or 5+ consecutive losses

## Prompt Versioning
- Every prompt has a version number
- Track accuracy per version
- Auto-adjust when accuracy drops
- Fall back to previous version if new version performs worse

## Model Fallback Chain
1. Primary model (e.g., gpt-4)
2. Secondary model (e.g., gpt-3.5-turbo)
3. Tertiary model (e.g., claude-3-haiku)
4. Skip AI (use rule-based analysis)

## Testing
- Circuit breaker: State transitions, cooldown, half-open probe
- Performance monitor: Degradation detection, alerting
- Prediction tracker: Accuracy calculation, status updates
