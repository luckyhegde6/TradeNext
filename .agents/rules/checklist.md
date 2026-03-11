# TradeNext Engineering Checklist

Engineering guardrails for AI agents and contributors. All changes must be validated against this checklist.

## Version
1.0

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

## Usage

This checklist is a **hard contract** for all AI agents. Before proposing or finalizing any code:

1. Load this checklist
2. Validate all changes against relevant sections
3. Refuse to finalize if any required rule is violated

Reference: `ai/checklist.yml` for machine-readable version
