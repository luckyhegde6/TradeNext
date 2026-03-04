import prisma from "./prisma";
import { auth } from "./auth";

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
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'ADMIN_UPLOAD'
  | 'ADMIN_INGEST'
  | 'SETTINGS_UPDATE';

interface AuditLogParams {
  userId?: number;
  userEmail?: string;
  action: AuditAction;
  resource?: string;
  resourceId?: string;
  metadata?: any;
  errorMessage?: string;
}

export async function createAuditLog(params: AuditLogParams) {
  try {
    const session = await auth();

    // Default to session user if not provided
    const userId = params.userId || (session?.user?.id ? parseInt(session.user.id) : undefined);
    const userEmail = params.userEmail || session?.user?.email || undefined;

    return await prisma.auditLog.create({
      data: {
        userId,
        userEmail,
        action: params.action as any, // Cast to any to match Prisma enum if necessary, or ensure schema matches
        resource: params.resource,
        resourceId: params.resourceId,
        metadata: params.metadata,
        errorMessage: params.errorMessage,
      },
    });
  } catch (error) {
    // We don't want audit log failures to break the main application flow, 
    // but we should log the error
    console.error("Failed to create audit log:", error);
    return null;
  }
}
