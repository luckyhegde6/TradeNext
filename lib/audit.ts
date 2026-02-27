import prisma from "@/lib/prisma";

export type AuditAction = 
  | 'API_CALL' 
  | 'USER_ACTION' 
  | 'PORTFOLIO_ACTION' 
  | 'NSE_CALL' 
  | 'LOGIN' 
  | 'LOGOUT' 
  | 'RATE_LIMIT';

interface AuditLogData {
  userId?: number;
  userEmail?: string;
  action: AuditAction;
  resource?: string;
  resourceId?: string;
  method?: string;
  path?: string;
  requestBody?: unknown;
  responseStatus?: number;
  responseTime?: number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  nseEndpoint?: string;
  errorMessage?: string;
}

export async function createAuditLog(data: AuditLogData): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        userEmail: data.userEmail,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        method: data.method,
        path: data.path,
        requestBody: data.requestBody as any,
        responseStatus: data.responseStatus,
        responseTime: data.responseTime,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        metadata: data.metadata as any,
        nseEndpoint: data.nseEndpoint,
        errorMessage: data.errorMessage,
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}

export async function logApiCall(
  path: string,
  method: string,
  userId?: number,
  userEmail?: string,
  status?: number,
  responseTime?: number,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    userId,
    userEmail,
    action: 'API_CALL',
    method,
    path,
    responseStatus: status,
    responseTime,
    ipAddress,
    userAgent,
  });
}

export async function logNseCall(
  endpoint: string,
  userId?: number,
  userEmail?: string,
  status?: number,
  responseTime?: number,
  error?: string
): Promise<void> {
  await createAuditLog({
    userId,
    userEmail,
    action: 'NSE_CALL',
    nseEndpoint: endpoint,
    responseStatus: status,
    responseTime,
    errorMessage: error,
  });
}

export async function logUserAction(
  action: string,
  resource: string,
  resourceId?: string,
  userId?: number,
  userEmail?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    userId,
    userEmail,
    action: 'USER_ACTION',
    resource,
    resourceId,
    metadata,
  });
}

export async function logPortfolioAction(
  action: string,
  portfolioId: string,
  userId?: number,
  userEmail?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await createAuditLog({
    userId,
    userEmail,
    action: 'PORTFOLIO_ACTION',
    resource: 'portfolio',
    resourceId: portfolioId,
    metadata,
  });
}

export async function logRateLimit(
  userId: number,
  userEmail: string,
  endpoint: string
): Promise<void> {
  await createAuditLog({
    userId,
    userEmail,
    action: 'RATE_LIMIT',
    resource: 'rate_limit',
    metadata: { endpoint },
  });
}
