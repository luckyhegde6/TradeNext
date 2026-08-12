// lib/__tests__/nseEventsService.test.ts
//
// Tests for the NSE events / notifications feed (lib/services/nseEventsService.ts):
//   - maps the NSE /api/eventnotification payload (incl. thumbnail https: prefix)
//   - drops junk rows via the isNseEventRaw guard
//   - routes through the shared getOrFetchSyncedData chain, falls back to DB

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/lib/cache", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => null),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(() => []),
  },
}));

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    marketCache: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@/lib/nse-client", () => ({
  __esModule: true,
  nseFetch: jest.fn(),
}));

import { getNseEvents } from "@/lib/services/nseEventsService";

const { nseFetch } = require("@/lib/nse-client") as { nseFetch: jest.Mock };
const prisma = require("@/lib/prisma").default as {
  marketCache: { findUnique: jest.Mock; upsert: jest.Mock };
};
const { createAuditLog } = require("@/lib/audit") as { createAuditLog: jest.Mock };

const eventRow = {
  ID: 1234,
  EVENT_DATE: "2026-08-06T00:00:00.000Z",
  TITLE: "Listing Ceremony of Juniper Hotels",
  CATEGORY_NAME: "Listing Ceremony",
  SLUG_URL: "/event/listing-ceremony-juniper",
  EVENT_START_TIMESTAMP: "2026-08-06T10:00:00.000Z",
  EVENT_END_TIMESTAMP: "2026-08-06T11:00:00.000Z",
  EVENT_DATE_LABEL: "PAST",
  THUMBNAIL_URL: "//nsearchives.nseindia.com/foo.jpg",
};

describe("getNseEvents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nseFetch.mockResolvedValue({ success: true, data: [eventRow] });
    prisma.marketCache.findUnique.mockResolvedValue(null);
    prisma.marketCache.upsert.mockResolvedValue({});
  });

  it("fetches from NSE, maps fields & https-prefixes the thumbnail, syncs DB", async () => {
    const res = await getNseEvents();

    expect(nseFetch).toHaveBeenCalledWith("https://www.nseindia.com/api/eventnotification");
    expect(res.data).toHaveLength(1);
    const ev = res.data[0];
    expect(ev).toMatchObject({
      id: 1234,
      title: "Listing Ceremony of Juniper Hotels",
      categoryName: "Listing Ceremony",
      slugUrl: "/event/listing-ceremony-juniper",
      dateLabel: "PAST",
      eventDate: "2026-08-06T00:00:00.000Z",
    });
    expect(ev.thumbnailUrl).toBe("https://nsearchives.nseindia.com/foo.jpg");

    expect(prisma.marketCache.upsert).toHaveBeenCalledTimes(1);
    const { create } = prisma.marketCache.upsert.mock.calls[0][0];
    expect(create.cacheKey).toBe("nse_event_notifications");
    expect(create.dataType).toBe("nse_events");
  });

  it("audits the fetch with EVENTS_FETCH", async () => {
    await getNseEvents();
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "EVENTS_FETCH", resource: "nse_events", responseStatus: 200 })
    );
  });

  it("drops junk rows that fail the isNseEventRaw guard", async () => {
    nseFetch.mockResolvedValue({
      success: true,
      data: [eventRow, { foo: "bar" }, null, 99, { ID: 5, TITLE: "OK" }],
    });
    const res = await getNseEvents();
    expect(res.data).toHaveLength(2);
    expect(res.data[1]).toMatchObject({ id: 5, title: "OK" });
  });

  it("non-array data is treated as no events (not a crash)", async () => {
    nseFetch.mockResolvedValue({ success: true, data: null });
    const res = await getNseEvents();
    expect(res.data).toEqual([]);
  });

  it("API failure with a persisted DB row falls back to the DB", async () => {
    nseFetch.mockRejectedValue(new Error("NSE down"));
    prisma.marketCache.findUnique.mockResolvedValue({
      cacheKey: "nse_event_notifications",
      data: [eventRow],
      lastSyncedAt: new Date("2026-08-11T10:00:00.000Z"),
      nextSyncAt: new Date("2026-08-12T08:00:00.000Z"),
    });

    const res = await getNseEvents();
    expect(res).toMatchObject({ data: [eventRow], source: "db" });
  });
});
