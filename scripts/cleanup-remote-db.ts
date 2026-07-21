/**
 * Cleanup script for Prisma Postgres when planLimitReached.
 * 
 * Usage:
 *   DIRECT_URL="postgres://USER:PASSWORD@db.prisma.io:5432/?sslmode=require" npx tsx scripts/cleanup-remote-db.ts
 * 
 * Steps:
 *   1. Get your DIRECT_URL from Prisma Console > Database > Connection string (switch to "Direct")
 *   2. Set it as DIRECT_URL env var
 *   3. Run this script
 */

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const DIRECT_URL = process.env.DIRECT_URL;

if (!DIRECT_URL) {
  console.error(`
╔══════════════════════════════════════════════════════════╗
║  DIRECT_URL not set!                                     ║
║                                                          ║
║  Get your direct connection URL from:                    ║
║  Prisma Console > Database > Connection string > Direct   ║
║                                                          ║
║  Format: postgres://USER:PASSWORD@db.prisma.io:5432/... ║
║                                                          ║
║  Then run:                                               ║
║  DIRECT_URL="postgres://..." npx tsx scripts/cleanup-remote-db.ts ║
╚══════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

console.log("Connecting via DIRECT connection:", DIRECT_URL.substring(0, 40) + "...");

const pool = new Pool({ connectionString: DIRECT_URL, max: 2 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("\n=== Step 1: Checking table sizes ===\n");

  // Get table row counts
  const tables = [
    'audit_logs', 'api_request_logs', 'server_logs', 'rate_limits',
    'rate_limit_configs', 'worker_tasks', 'task_events',
    'notifications', 'market_cache', 'anomaly_alerts',
    'daily_prices', 'stock_snapshots', 'index_close', 'index_points',
    'corporate_announcements', 'corporate_actions',
    'block_deals', 'bulk_deals', 'short_sellings',
    'screener_configs', 'screener_results', 'scan_configs', 'scan_results',
    'backtest_runs', 'backtest_trades',
    'ai_analyses', 'ai_conversations', 'ai_rate_limits',
    'daily_recommendation_runs', 'daily_recommendation_stocks',
    'recommendation_trackers', 'recommendation_status_histories',
    'agent_performance_logs', 'screener_run_logs', 'system_health_logs',
    'unified_events', 'delivery_logs',
    'fund_transactions', 'transactions',
    'watchlists', 'watchlist_items',
    'portfolios', 'users', 'posts',
    'cron_jobs', 'worker_statuses',
    'insider_tradings', 'financial_scores',
    'alerts', 'user_alerts',
    'saved_screens', 'symbols', 'indexes',
    'market_snapshots', 'index_heatmap_items', 'index_quotes', 'index_weights',
    'join_requests', 'admin_announcements',
    'recommendation_subscriptions',
    'rebalancer_configs', 'fo_positions',
    'alert_channels', 'alert_rules', 'alert_events',
    'secrets', 'screener_configs', 'daily_screener_syncs',
    'recommendation_alert_subscriptions',
  ];

  const counts: { table: string; count: number }[] = [];

  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM "${table}"`);
      const count = parseInt(result.rows[0].count);
      if (count > 0) {
        counts.push({ table, count });
      }
    } catch {
      // Table might not exist, skip
    }
  }

  // Sort by count descending
  counts.sort((a, b) => b.count - a.count);

  console.log("Tables with data (sorted by size):");
  console.log("─".repeat(50));
  for (const { table, count } of counts) {
    console.log(`  ${table.padEnd(35)} ${count.toLocaleString()} rows`);
  }

  console.log("\n=== Step 2: Identifying cleanup targets ===\n");

  // Identify tables that are safe to truncate (logs, caches, ephemeral data)
  const safeToTruncate = [
    'api_request_logs', 'server_logs', 'market_cache',
    'audit_logs', 'rate_limits', 'rate_limit_configs',
    'worker_tasks', 'task_events', 'worker_statuses',
    'notifications', 'anomaly_alerts',
    'daily_prices', 'stock_snapshots', 'index_close', 'index_points',
    'corporate_announcements', 'insider_tradings',
    'index_heatmap_items', 'index_quotes',
    'ai_rate_limits',
    'daily_recommendation_runs', 'daily_recommendation_stocks',
    'recommendation_status_histories',
    'agent_performance_logs', 'screener_run_logs', 'system_health_logs',
    'unified_events', 'delivery_logs',
    'scan_results', 'scan_result_items', 'backtest_runs', 'backtest_trades',
    'financial_scores',
    'daily_screener_syncs',
    'recommendation_alert_subscriptions',
  ];

  let totalDeleted = 0;

  for (const table of safeToTruncate) {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM "${table}"`);
      const count = parseInt(result.rows[0].count);
      if (count > 0) {
        await pool.query(`DELETE FROM "${table}"`);
        console.log(`  ✅ Truncated ${table}: ${count.toLocaleString()} rows removed`);
        totalDeleted += count;
      }
    } catch (e: any) {
      if (e.message?.includes('does not exist')) {
        // Skip non-existent tables
      } else {
        console.log(`  ⚠️  Could not truncate ${table}: ${e.message?.substring(0, 80)}`);
      }
    }
  }

  // Also try to clean old data from non-truncated tables
  console.log("\n=== Step 3: Cleaning old data from operational tables ===\n");

  // Delete old daily_prices (keep last 30 days)
  try {
    const result = await pool.query(`
      DELETE FROM "daily_prices" 
      WHERE "date" < NOW() - INTERVAL '30 days'
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`  ✅ daily_prices: deleted ${result.rowCount.toLocaleString()} rows older than 30 days`);
      totalDeleted += result.rowCount;
    }
  } catch (e: any) {
    console.log(`  ⚠️  daily_prices cleanup: ${e.message?.substring(0, 80)}`);
  }

  // Delete old stock_snapshots (keep last 7 days)
  try {
    const result = await pool.query(`
      DELETE FROM "stock_snapshots" 
      WHERE "timestamp" < NOW() - INTERVAL '7 days'
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`  ✅ stock_snapshots: deleted ${result.rowCount.toLocaleString()} rows older than 7 days`);
      totalDeleted += result.rowCount;
    }
  } catch (e: any) {
    console.log(`  ⚠️  stock_snapshots cleanup: ${e.message?.substring(0, 80)}`);
  }

  // Delete old corporate_actions (keep last 6 months)
  try {
    const result = await pool.query(`
      DELETE FROM "corporate_actions" 
      WHERE "exDate" < NOW() - INTERVAL '6 months'
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`  ✅ corporate_actions: deleted ${result.rowCount.toLocaleString()} rows older than 6 months`);
      totalDeleted += result.rowCount;
    }
  } catch (e: any) {
    console.log(`  ⚠️  corporate_actions cleanup: ${e.message?.substring(0, 80)}`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total rows deleted: ${totalDeleted.toLocaleString()}`);

  // Now check if we can run migrations
  console.log("\n=== Step 4: Checking if v3.3.0 tables exist ===\n");
  try {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    const existingTables = result.rows.map((r: any) => r.table_name);
    console.log(`Total tables in DB: ${existingTables.length}`);

    const v330Tables = [
      'recommendation_trackers', 'daily_recommendation_runs', 
      'daily_recommendation_stocks', 'recommendation_status_histories',
      'recommendation_alert_subscriptions', 'agent_performance_logs',
      'screener_run_logs', 'system_health_logs', 'unified_events',
    ];
    
    const missing = v330Tables.filter(t => !existingTables.includes(t));
    const existing = v330Tables.filter(t => existingTables.includes(t));
    
    console.log(`\n  v3.3.0 tables present: ${existing.length}/${v330Tables.length}`);
    if (missing.length > 0) {
      console.log(`  Missing tables: ${missing.join(', ')}`);
      console.log(`  → Run 'npx prisma migrate deploy' after cleanup to create them`);
    }
  } catch (e: any) {
    console.log(`  Error: ${e.message?.substring(0, 100)}`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await pool.end();
  process.exit(1);
});
