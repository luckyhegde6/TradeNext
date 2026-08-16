# Version History v1.13

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v1.x files: [versions-v1.md](./versions-v1.md).

- **v1.13.0** - Corporate Action Alerts (March 27, 2026). Added new alert types for corporate actions:
  - **New Alert Types**: dividend_alert, bonus_alert, split_alert, rights_alert, buyback_alert, meeting_alert
  - **Alert Service**: Added `checkCorporateActionAlerts()` function that scans upcoming corporate actions
  - **Check API**: Enhanced `/api/alerts/check` to handle both price alerts and corporate action alerts
  - **UI Updates**: Added corporate action alert options in `/alerts` page including minimum dividend filter
  - **Notifications**: Enhanced alert messages to include action details (ex-date, purpose, ratio)
  - **Real-time Fallback**: Alerts page triggers check on load for serverless environments
