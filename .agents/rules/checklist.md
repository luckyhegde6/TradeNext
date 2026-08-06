# TradeNext Engineering Checklist

Engineering guardrails for AI agents and contributors. All changes must be validated against this checklist.

## Version
1.2

## Meta Rules

- [ ] no_prisma_in_client_components
- [ ] no_business_logic_in_ui
- [ ] no_undocumented_api_routes
- [ ] no_unvalidated_inputs
- [ ] no_silent_failures

---

## Architecture

### Separation of Concerns
- [ ] ui_only_renders_data
- [ ] api_routes_orchestrate_only
- [ ] business_logic_in_lib_services
- [ ] integrations_in_lib_integrations
- [ ] prisma_used_only_in_server

### Next.js Rules
- [ ] server_components_do_not_import_prisma
- [ ] runtime_nodejs_explicit_where_needed
- [ ] data_fetch_via_api_or_services

---

## API Design

### Validation
- [ ] zod_or_equivalent_used
- [ ] request_schema_defined
- [ ] response_schema_defined

### Swagger/Documentation
- [ ] route_documented
- [ ] summary_present
- [ ] request_body_schema_present
- [ ] response_schema_present
- [ ] admin_routes_marked_secure

---

## Security

### Admin Access
- [ ] admin_routes_protected
- [ ] nextauth_or_admin_key_used
- [ ] middleware_updated_if_needed

### Secrets
- [ ] no_secrets_in_client
- [ ] no_secrets_in_next_public_env

---

## Ingestion

- [ ] ingestion_not_blocking_http
- [ ] background_job_or_queue_used
- [ ] ingestion_idempotent
- [ ] large_files_streamed

---

## Market Data (NSE API)

- [ ] server_side_proxy_only
- [ ] redis_cache_with_ttl
- [ ] retry_and_backoff
- [ ] rate_limit_respected

---

## Performance

- [ ] pagination_applied
- [ ] no_n_plus_one_queries
- [ ] cache_used_where_applicable
- [ ] timeseries_use_timescale
- [ ] batch_db_operations (use createMany/findMany instead of N individual queries)
- [ ] parallelize_independent_queries (use Promise.all for independent DB calls)
- [ ] avoid_queries_in_loops (pre-fetch data, then look up in-memory)

---

## Logging

- [ ] pino_logger_used
- [ ] start_logged
- [ ] success_logged
- [ ] error_logged_with_context

---

## UI/UX

- [ ] loading_state_present
- [ ] error_state_present
- [ ] empty_state_handled
- [ ] responsive_layout

---

## Maintainability

- [ ] readable_in_isolation
- [ ] domain_driven_naming
- [ ] no_dead_code
- [ ] readme_updated_if_needed

---

## Interview Readiness

- [ ] explainable_in_system_design
- [ ] tradeoffs_documented
- [ ] senior_level_patterns_used

---

## Final Gate

- [ ] checklist_passed
- [ ] swagger_updated
- [ ] security_reviewed
- [ ] logs_added

---

## Cleanup & Code Hygiene (Pre-Commit)

- [ ] git_status_reviewed
- [ ] junk_artifacts_deleted
- [ ] no_secrets_in_diff
- [ ] no_dead_code_or_console_log
- [ ] gitignore_covers_artifacts

### Netlify Secrets Scanning
- [ ] no_hardcoded_passwords_in_repo
- [ ] secrets_scan_omit_paths_updated_if_needed
- [ ] netlify_build_passes_without_secrets_scan_failure

**⚠️ Netlify scans ALL repo files for secrets (passwords, API keys).** If you add scripts or test files with hardcoded demo/admin passwords, the build will fail with "Secrets scanning found secrets in build."

**Fix:** Add the offending file to `SECRETS_SCAN_OMIT_PATHS` in `netlify.toml`:
```toml
[build.environment]
  SECRETS_SCAN_OMIT_PATHS = "AGENTS.md,README.md,...,scripts/your-file.ts"
```

**Files that commonly trip the scanner:**
| File | Reason | Action |
|------|--------|--------|
| `scripts/check-remote-db.ts` | Hardcoded DEMO_PASSWORD, ADMIN_PASSWORD | Add to omit paths |
| `prisma/seed.ts` | Hardcoded demo credentials | Already in omit paths |
| Test fixtures with passwords | Embedded test data | Add to omit paths or use env vars |

**Prevention checklist before adding any file with credentials:**
1. Use `process.env.VARIABLE` instead of hardcoded values where possible
2. If hardcoded is necessary (e.g., scripts, seeds), add the file to `SECRETS_SCAN_OMIT_PATHS`
3. Never commit real production credentials — only demo/sandbox values

---

## UI/UX Testing (Mandatory for UI Changes)

### Playwright CLI Testing
- [ ] start_dev_server_if_needed
- [ ] test_login_page_loads
- [ ] test_login_with_demo_credentials
- [ ] test_ui_changes_render_correctly
- [ ] check_responsive_behavior
- [ ] verify_dark_light_mode_if_applicable
- [ ] test_form_submissions_and_interactions
- [ ] check_console_errors
- [ ] cleanup_dev_server_processes

### Test Credentials
- **Demo User**: demo@tradenext6.app / demo123
- **Admin User**: admin@tradenext6.app / admin123

### Common Test Scenarios
1. Login flow: Navigate → Fill credentials → Submit → Verify redirect
2. Navigation: Click menu items → Verify page loads
3. Forms: Fill fields → Submit → Verify success/error state
4. Tables: Sort → Filter → Verify correct data
5. Modals: Open → Interact → Close → Verify state

### Testing Commands
```bash
# Using MCP in OpenCode
Playwright MCP: open → navigate → click → fill → snapshot → close

# Using playwright-cli locally
npx playwright-cli open http://localhost:3000
npx playwright-cli click e5
npx playwright-cli snapshot --filename=.playwright-cli/snapshots/test.yaml  # ALWAYS use --filename to avoid root junk
npx playwright-cli close
```

### ⚠️ Cleanup After Testing
- Snapshots without `--filename` land in the project root as `*.yaml` — DELETE them
- Always run `git status` after testing to catch stray files
- Kill any dev servers you started (check port 3000/3001)

---

## Usage

This checklist is a **hard contract** for all AI agents. Before proposing or finalizing any code:

1. Load this checklist
2. Validate all changes against relevant sections
3. Refuse to finalize if any required rule is violated

Reference: `ai/checklist.yml` for machine-readable version

---

## Daily Recommendations Engine (v3.3.0)

### Data Pipeline
- [ ] chartink_api_try_first
- [ ] tradingview_fallback_on_failure
- [ ] deduplication_by_symbol
- [ ] screener_attribution_tracked
- [ ] ai_batch_processing (5 stocks per batch)

### Database
- [ ] recommendation_tracker_model (long-lived)
- [ ] daily_recommendation_stock_model (per-run)
- [ ] recommendation_status_history_model (audit trail)
- [ ] upsert_with_correct_unique_constraint

### Cron Jobs
- [ ] generation_at_10_am_ist (04:30 utc)
- [ ] performance_tracking_at_3_30_pm_ist (10:00 utc)
- [ ] timezone_documented_in_comments

### API Routes
- [ ] public_api_no_auth_for_viewing
- [ ] protected_api_auth_for_subscription
- [ ] error_handling_returns_safe_defaults

### UI
- [ ] tabbed_layout (today's picks, history, dividends, subscribe)
- [ ] skeleton_loading_state
- [ ] empty_state_message
- [ ] responsive_design (375px+)

---

## Self-Heal AI Agents (v3.3.0)

### Circuit Breaker
- [ ] three_states (closed, open, half_open)
- [ ] failure_threshold (3 failures → open)
- [ ] cooldown_period (30s → half_open)
- [ ] success_resets_to_closed

### Performance Monitoring
- [ ] success_rate_tracking
- [ ] degradation_detection (<80% warning, <60% critical)
- [ ] response_time_monitoring
- [ ] token_usage_tracking

### Prediction Tracking
- [ ] entry_price_recorded
- [ ] current_price_checked (1w, 1m, 3m)
- [ ] win_loss_breakeven_classification
- [ ] accuracy_threshold_trigger (40%)

### Prompt Versioning
- [ ] version_number_per_prompt
- [ ] accuracy_tracked_per_version
- [ ] auto_adjustment_triggers
- [ ] fallback_to_previous_version

### Model Fallback Chain
- [ ] primary_model_configured
- [ ] secondary_model_fallback
- [ ] tertiary_model_fallback
- [ ] rule_based_skip_ai_last_resort

---

## Comprehensive Audit Logging (v3.3.0)

### Unified Event Model
- [ ] event_type_discriminator
- [ ] event_subtype_for_granularity
- [ ] source_tracking
- [ ] severity_levels (info, warning, critical)
- [ ] metadata_json_field

### Event Categories
- [ ] telegram_events (subscribe, unsubscribe, verify, command, broadcast)
- [ ] ai_agent_events (trigger, success, failure, fallback)
- [ ] screener_events (run_start, run_complete, run_failed, dedup)
- [ ] system_health_events (health_check, anomaly_detected, provider_outage)

### Anomaly Detection
- [ ] accuracy_drop_detection (<40%)
- [ ] delivery_failure_detection (>10%)
- [ ] provider_outage_detection (3+ failures)
- [ ] response_time_alerting (>30s avg)
