import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);

    const savedScreens = await prisma.savedScreen.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        filters: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    return NextResponse.json({ savedScreens });
  } catch (error) {
    console.error('Saved screens error:', error);
    return NextResponse.json({ error: "Failed to fetch saved screens" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const { name, filters } = await req.json();

    if (!name || !filters) {
      return NextResponse.json({ error: "Name and filters are required" }, { status: 400 });
    }

    const savedScreen = await prisma.savedScreen.create({
      data: {
        userId,
        name,
        filters: filters as any,
      },
      select: {
        id: true,
        name: true,
        filters: true,
        createdAt: true,
      }
    });

    return NextResponse.json({ savedScreen }, { status: 201 });
  } catch (error) {
    console.error('Save screen error:', error);
    return NextResponse.json({ error: "Failed to save screen" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "Screen ID required" }, { status: 400 });
    }

    await prisma.savedScreen.deleteMany({
      where: {
        id: parseInt(id),
        userId,
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete screen error:', error);
    return NextResponse.json({ error: "Failed to delete screen" }, { status: 500 });
  }
}
