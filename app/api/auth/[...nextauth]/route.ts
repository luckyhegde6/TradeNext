import { handlers } from "@/lib/auth";

// Ensure this route uses Node.js runtime
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
