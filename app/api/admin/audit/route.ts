import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const createAuditSchema = z.object({
  userId: z.number().optional(),
  userEmail: z.string().optional(),
  action: z.enum(['API_CALL', 'USER_ACTION', 'PORTFOLIO_ACTION', 'NSE_CALL', 'LOGIN', 'LOGOUT', 'RATE_LIMIT']),
  resource: z.string().optional(),
  resourceId: z.string().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  requestBody: z.any().optional(),
  responseStatus: z.number().optional(),
  responseTime: z.number().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  metadata: z.any().optional(),
  nseEndpoint: z.string().optional(),
  errorMessage: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const userId = searchParams.get('userId');
    const resource = searchParams.get('resource');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: any = {};
    
    if (action) where.action = action;
    if (userId) where.userId = parseInt(userId);
    if (resource) where.resource = resource;
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    console.error('Admin audit GET error:', error);
    return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validatedData = createAuditSchema.parse(body);

    const auditLog = await prisma.auditLog.create({
      data: validatedData,
    });

    return NextResponse.json(auditLog, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error('Admin audit POST error:', error);
    return NextResponse.json({ error: "Failed to create audit log" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const olderThan = searchParams.get('olderThan');

    if (!olderThan) {
      return NextResponse.json({ error: "olderThan parameter is required (ISO date)" }, { status: 400 });
    }

    const result = await prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          lt: new Date(olderThan),
        },
      },
    });

    return NextResponse.json({ deleted: result.count });
  } catch (error) {
    console.error('Admin audit DELETE error:', error);
    return NextResponse.json({ error: "Failed to delete audit logs" }, { status: 500 });
  }
}
