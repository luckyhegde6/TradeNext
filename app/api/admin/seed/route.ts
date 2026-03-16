import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

// POST - Seed demo user (admin only)
export async function POST() {
    try {
        const session = await auth();

        if (!session || !session.user || session.user.role !== 'admin') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const DEMO_EMAIL = "demo@tradenext6.app";
        const DEMO_PASSWORD = "demo123";
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@tradenext6.app";
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

        // Hash passwords
        const demoPasswordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
        const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

        // Create or update demo user
        const demoUser = await prisma.user.upsert({
            where: { email: DEMO_EMAIL },
            update: {},
            create: {
                email: DEMO_EMAIL,
                name: 'Demo User',
                password: demoPasswordHash,
                role: 'user',
                isVerified: true,
                isBlocked: false,
                mobile: '+919999999999',
            },
        });

        // Create or update admin user
        const adminUser = await prisma.user.upsert({
            where: { email: ADMIN_EMAIL },
            update: {},
            create: {
                email: ADMIN_EMAIL,
                name: 'Admin User',
                password: adminPasswordHash,
                role: 'admin',
                isVerified: true,
                isBlocked: false,
                mobile: '+919999999998',
            },
        });

        // Create demo portfolio
        const portfolio = await prisma.portfolio.upsert({
            where: { id: `demo-portfolio-${demoUser.id}` },
            update: {},
            create: {
                id: `demo-portfolio-${demoUser.id}`,
                userId: demoUser.id,
                name: 'Demo Portfolio',
                currency: 'INR',
            },
        });

        // Add fund transaction
        await prisma.fundTransaction.upsert({
            where: { id: `demo-fund-${portfolio.id}` },
            update: {},
            create: {
                id: `demo-fund-${portfolio.id}`,
                portfolioId: portfolio.id,
                type: 'DEPOSIT',
                amount: 500000,
                date: new Date('2024-01-01'),
                notes: 'Initial investment',
            },
        });

        // Add stock transactions
        const transactions = [
            { ticker: 'RELIANCE', side: 'BUY', quantity: 100, price: 2400, tradeDate: new Date('2024-01-15') },
            { ticker: 'TCS', side: 'BUY', quantity: 50, price: 3800, tradeDate: new Date('2024-02-10') },
            { ticker: 'INFY', side: 'BUY', quantity: 75, price: 1450, tradeDate: new Date('2024-03-05') },
            { ticker: 'HDFCBANK', side: 'BUY', quantity: 80, price: 1520, tradeDate: new Date('2024-04-20') },
            { ticker: 'ICICIBANK', side: 'BUY', quantity: 150, price: 980, tradeDate: new Date('2024-05-15') },
        ];

        for (let i = 0; i < transactions.length; i++) {
            const t = transactions[i];
            await prisma.transaction.upsert({
                where: { id: `demo-txn-${portfolio.id}-${i}` },
                update: {},
                create: {
                    id: `demo-txn-${portfolio.id}-${i}`,
                    portfolioId: portfolio.id,
                    ticker: t.ticker,
                    side: t.side,
                    quantity: t.quantity,
                    price: t.price,
                    tradeDate: t.tradeDate,
                    fees: 50,
                },
            });
        }

        // Create admin portfolio
        const adminPortfolio = await prisma.portfolio.upsert({
            where: { id: `admin-portfolio-${adminUser.id}` },
            update: {},
            create: {
                id: `admin-portfolio-${adminUser.id}`,
                userId: adminUser.id,
                name: 'Admin Portfolio',
                currency: 'INR',
            },
        });

        // Add admin fund transaction
        await prisma.fundTransaction.upsert({
            where: { id: `admin-fund-${adminPortfolio.id}` },
            update: {},
            create: {
                id: `admin-fund-${adminPortfolio.id}`,
                portfolioId: adminPortfolio.id,
                type: 'DEPOSIT',
                amount: 1000000,
                date: new Date('2024-01-01'),
                notes: 'Initial admin investment',
            },
        });

        // Add admin stock transactions
        const adminTransactions = [
            { ticker: 'RELIANCE', side: 'BUY', quantity: 200, price: 2500, tradeDate: new Date('2024-01-10') },
            { ticker: 'TCS', side: 'BUY', quantity: 100, price: 4000, tradeDate: new Date('2024-02-15') },
        ];

        for (let i = 0; i < adminTransactions.length; i++) {
            const t = adminTransactions[i];
            await prisma.transaction.upsert({
                where: { id: `admin-txn-${adminPortfolio.id}-${i}` },
                update: {},
                create: {
                    id: `admin-txn-${adminPortfolio.id}-${i}`,
                    portfolioId: adminPortfolio.id,
                    ticker: t.ticker,
                    side: t.side,
                    quantity: t.quantity,
                    price: t.price,
                    tradeDate: t.tradeDate,
                    fees: 50,
                },
            });
        }

        return NextResponse.json({
            success: true,
            message: "Demo users seeded successfully",
            users: {
                demo: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
                admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
            }
        });
    } catch (error) {
        console.error('Seed error:', error);
        return NextResponse.json({ error: "Failed to seed users" }, { status: 500 });
    }
}
