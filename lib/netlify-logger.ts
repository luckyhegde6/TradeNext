import { getStore } from "@netlify/blobs";

// Netlify Blobs logger — two stores:
//   "worker-logs" — per-task worker run logs (legacy)
//   "server-logs" — general application log mirror (date-keyed), read by the
//                   admin monitoring page so serverless logs survive across
//                   lambda instances (which otherwise have per-instance /tmp).
const SERVER_LOGS_STORE = "server-logs";
const WORKER_LOGS_STORE = "worker-logs";

const getBlobStore = (storeName: string = WORKER_LOGS_STORE) => {
    return getStore(storeName);
};

/**
 * Write a log entry to Netlify Blobs
 */
export async function writeBlobLog(taskId: string, entry: string, storeName: string = WORKER_LOGS_STORE): Promise<void> {
    if (!process.env.NETLIFY) return;

    try {
        const store = getBlobStore(storeName);
        const existing = await store.get(taskId, { type: "text" }) || "";
        await store.set(taskId, existing + entry);
    } catch (error) {
        console.error("Failed to write to Netlify Blobs:", error);
    }
}

/**
 * Append a general application log line to the "server-logs" blob store.
 * Keyed by date (YYYY-MM-DD.log) so the admin monitoring page can list/read
 * server logs across serverless instances. Fire-and-forget append (read-modify-write).
 */
export async function appendServerLogLine(dateKey: string, entry: string): Promise<void> {
    if (!process.env.NETLIFY) return;
    try {
        const store = getBlobStore(SERVER_LOGS_STORE);
        const existing = await store.get(dateKey, { type: "text" }) || "";
        await store.set(dateKey, existing + entry);
    } catch (error) {
        console.error("Failed to append server log to Netlify Blobs:", error);
    }
}

/**
 * Read logs from Netlify Blobs
 */
export async function readBlobLog(taskId: string, storeName: string = WORKER_LOGS_STORE): Promise<string> {
    if (!process.env.NETLIFY) return "";

    try {
        const store = getBlobStore(storeName);
        return await store.get(taskId, { type: "text" }) || "";
    } catch (error) {
        console.error("Failed to read from Netlify Blobs:", error);
        return "";
    }
}

/**
 * Delete logs from Netlify Blobs
 */
export async function deleteBlobLog(taskId: string, storeName: string = WORKER_LOGS_STORE): Promise<void> {
    if (!process.env.NETLIFY) return;

    try {
        const store = getBlobStore(storeName);
        await store.delete(taskId);
    } catch (error) {
        console.error("Failed to delete from Netlify Blobs:", error);
    }
}
/**
 * List log files in a store
 */
export async function listBlobLogs(storeName: string = "worker-logs"): Promise<{ date: string; path: string; size: number }[]> {
    if (!process.env.NETLIFY) return [];

    try {
        const store = getStore(storeName);
        const { blobs } = await store.list();

        return blobs.map((blob: { key: string; size?: number }) => ({
            // Strip the .log extension so blob dates match local file dates
            // (e.g. 2026-08-11.log → 2026-08-11)
            date: blob.key.replace(/\.log$/, ''),
            path: `blob:${blob.key}`,
            size: blob.size || 0
        }));
    } catch (error) {
        console.error(`Failed to list logs from Netlify Blobs store ${storeName}:`, error);
        return [];
    }
}
