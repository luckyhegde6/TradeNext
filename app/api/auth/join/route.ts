import { NextResponse } from "next/server";
import { createJoinRequest } from "@/lib/services/userService";
import logger from "@/lib/logger";
import { z } from "zod";

const joinRequestSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    mobile: z.string().optional(),
    message: z.string().optional(),
});

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const validatedData = joinRequestSchema.parse(body);

        logger.info({ msg: "Join request received", email: validatedData.email });

        await createJoinRequest(validatedData);

        return NextResponse.json({
            success: true,
            message: "Your request has been submitted successfully. An administrator will review it shortly."
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
        }

        // Handle unique constraint on email
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("Unique constraint")) {
            return NextResponse.json({
                error: "A request with this email already exists."
            }, { status: 400 });
        }

        logger.error({ msg: "Join request failed", error: errorMessage });
        return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
    }
}
