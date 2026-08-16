# Version History v1.14

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v1.x files: [versions-v1.md](./versions-v1.md).

- **v1.14.0** - MCP API for External NSE Data (March 27, 2026). Added unified API endpoint for external NSE data queries:
  - **MCP Endpoint**: `/api/mcp` - Machine Communication Protocol for all NSE data
  - **22 Functions**: getIndexData, getStockQuote, getStockChart, getGainers, getLosers, getMostActive, getAdvanceDecline, getCorporateActions, getCorporateInfo, getMarquee, getDeals, getAnnouncements, getInsiderTrading, getEvents, getHeatmap, getSymbols, getTrends, etc.
  - **Authentication**: Optional API key via `x-api-key` header (configurable via `MCP_API_KEY`)
  - **JSON Format**: Returns standardized response with success, function, data, timestamp
  - **Caching**: All responses cached for performance (60s-3600s depending on data type)
  - **Discovery**: Built-in `listFunctions`, `describe`, `schema`, `help` for API exploration
