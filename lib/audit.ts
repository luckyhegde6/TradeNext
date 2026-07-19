import prisma from "./prisma";

export type AuditAction =
  | 'API_CALL'
  | 'USER_ACTION'
  | 'PORTFOLIO_ACTION'
  | 'PORTFOLIO_CREATE'
  | 'TRANSACTION_CREATE'
  | 'FUND_TRANSACTION'
  | 'NSE_CALL'
  | 'LOGIN'
  | 'LOGOUT'
  | 'RATE_LIMIT'
  | 'WATCHLIST_CREATE'
  | 'WATCHLIST_DELETE'
  | 'WATCHLIST_UPDATE'
  | 'ALERT_CREATE'
  | 'ALERT_DELETE'
  | 'ALERT_UPDATE'
  | 'ALERT_RULE_CREATE'
  | 'ALERT_RULE_UPDATE'
  | 'ALERT_RULE_DELETE'
  | 'ALERT_CHANNEL_CREATE'
  | 'ALERT_CHANNEL_UPDATE'
  | 'ALERT_CHANNEL_DELETE'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'ADMIN_UPLOAD'
  | 'ADMIN_INGEST'
  | 'ADMIN_NSE_LIVE_SYNC'
  | 'ADMIN_ANNOUNCEMENT_CREATE'
  | 'ADMIN_ANNOUNCEMENT_UPDATE'
  | 'ADMIN_ANNOUNCEMENT_DELETE'
  | 'ADMIN_ANNOUNCEMENT_TOGGLE'
  | 'SETTINGS_UPDATE'
  | 'CONTACT_MESSAGE_RECEIVED'
  | 'NOTIFICATION_MARK_READ'
  | 'NOTIFICATION_ADDRESSED'
  | 'NOTIFICATIONS_MARK_ALL_READ'
  | 'NOTIFICATION_DELETE'
  // Telegram Bot Events
  | 'TELEGRAM_SUBSCRIBE'
  | 'TELEGRAM_UNSUBSCRIBE'
  | 'TELEGRAM_VERIFY'
  | 'TELEGRAM_COMMAND'
  | 'TELEGRAM_BROADCAST'
  // AI Agent Events
  | 'AI_AGENT_TRIGGER'
  | 'AI_AGENT_SUCCESS'
  | 'AI_AGENT_FAILURE'
  | 'AI_AGENT_FALLBACK'
  // Screener Events
  | 'SCREENER_RUN_START'
  | 'SCREENER_RUN_COMPLETE'
  | 'SCREENER_RUN_FAILED'
  | 'SCREENER_DEDUP'
  // System Health Events
  | 'SYSTEM_HEALTH_CHECK'
  | 'SYSTEM_ANOMALY_DETECTED'
  | 'SYSTEM_PROVIDER_OUTAGE'
  // Recommendation Events
  | 'RECOMMENDATION_GENERATED'
  | 'RECOMMENDATION_TARGET_ACHIEVED'
  | 'RECOMMENDATION_STOP_LOSS_HIT'
  | 'RECOMMENDATION_EXPIRED'
  | 'RECOMMENDATION_SUBSCRIBE'
  | 'RECOMMENDATION_BROADCAST';

interface AuditLogParams {
  userId?: number;
  userEmail?: string;
  action: AuditAction;
  resource?: string;
  resourceId?: string;
  method?: string;
  path?: string;
  responseStatus?: number;
  responseTime?: number;
  nseEndpoint?: string;
  metadata?: any;
  errorMessage?: string;
  session?: any; // New optional session parameter
}

export async function createAuditLog(params: AuditLogParams) {
  try {
    let { userId, userEmail, session } = params;

    // Use provided session if available
    if (session?.user) {
      userId = userId || (session.user.id ? parseInt(session.user.id) : undefined);
      userEmail = userEmail || session.user.email || undefined;
    }
    // Otherwise try to get session ONLY if not already provided
    // and if auth is available (to avoid circular dependency during init)
    else {
      try {
        // Fallback for other routes where session isn't passed explicitly
        // We import it dynamically to avoid top-level circular dependency
        const { auth } = await import("./auth");
        const currentSession = await auth();
        if (currentSession?.user) {
          userId = userId || (currentSession.user.id ? parseInt(currentSession.user.id) : undefined);
          userEmail = userEmail || currentSession.user.email || undefined;
        }
      } catch (authErr) {
        // Auth might fail or be unavailable in some contexts (like during signOut event)
      }
    }

    return await prisma.auditLog.create({
      data: {
        userId,
        userEmail,
        action: params.action as any,
        resource: params.resource,
        resourceId: params.resourceId,
        method: params.method,
        path: params.path,
        responseStatus: params.responseStatus,
        responseTime: params.responseTime,
        nseEndpoint: params.nseEndpoint,
        metadata: params.metadata,
        errorMessage: params.errorMessage,
      },
    });
  } catch (error) {
    console.error("Failed to create audit log:", error);
    return null;
  }
}
