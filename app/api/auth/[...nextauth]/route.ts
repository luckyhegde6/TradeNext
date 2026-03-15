import { handlers } from "@/lib/auth";
import logger from "@/lib/logger";

// Startup log - should appear in Netlify functions console
logger.info({ msg: "Auth route: Server starting", environment: process.env.NODE_ENV, isProduction: process.env.NODE_ENV === 'production' });

// Ensure this route uses Node.js runtime
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
