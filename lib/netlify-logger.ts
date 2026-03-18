import { getStore } from "@netlify/blobs";

const getBlobStore = () => {
    return getStore("worker-logs");
};

/**
 * Write a log entry to Netlify Blobs
 */
export async function writeBlobLog(taskId: string, entry: string): Promise<void> {
    if (!process.env.NETLIFY) return;

    try {
        const store = getBlobStore();
        const existing = await store.get(taskId) || "";
        await store.set(taskId, existing + entry);
    } catch (error) {
        console.error("Failed to write to Netlify Blobs:", error);
    }
}

/**
 * Read logs from Netlify Blobs
 */
export async function readBlobLog(taskId: string): Promise<string> {
    if (!process.env.NETLIFY) return "";

    try {
        const store = getBlobStore();
        return await store.get(taskId) || "";
    } catch (error) {
        console.error("Failed to read from Netlify Blobs:", error);
        return "";
    }
}

/**
 * Delete logs from Netlify Blobs
 */
export async function deleteBlobLog(taskId: string): Promise<void> {
    if (!process.env.NETLIFY) return;

    try {
        const store = getBlobStore();
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
            date: blob.key,
            path: `blob:${blob.key}`,
            size: blob.size || 0
        }));
    } catch (error) {
        console.error(`Failed to list logs from Netlify Blobs store ${storeName}:`, error);
        return [];
    }
}
