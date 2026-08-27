import { describe, expect, it, vi } from "vitest";
import type { ActiveSession, Session } from "../src/lib/records";
import {
  ACTIVE_KEY,
  STORAGE_KEY,
  loadActive,
  loadRecords,
  mergeRecords,
  saveActive,
  saveRecords,
} from "../src/lib/storage";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: vi.fn((key: string): string | null => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    mode: "strict",
    startedAt: 1_000,
    endedAt: 11_000,
    durationMs: 10_000,
    reason: "mouse",
    ...overrides,
  };
}

function active(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: "session-1",
    mode: "relaxed",
    startedAt: 1_000,
    lastSeenAt: 2_000,
    ownerId: "owner-1",
    ...overrides,
  };
}

describe("mergeRecords", () => {
  it("deduplicates IDs and sorts by descending start without mutating inputs", () => {
    const older = session();
    const newer = session({ id: "newer", startedAt: 20_000, endedAt: 30_000 });
    const first = [older];
    const second = [newer, older];
    expect(mergeRecords(first, second)).toEqual([newer, older]);
    expect(first).toEqual([older]);
    expect(second).toEqual([newer, older]);
  });

  it("keeps the earliest end when competing tabs finalize the same session", () => {
    const earlier = session();
    const later = session({ endedAt: 21_000, durationMs: 20_000, reason: "interrupted" });
    expect(mergeRecords([earlier], [later])).toEqual([earlier]);
    expect(mergeRecords([later], [earlier])).toEqual([earlier]);
  });

  it("uses stable tie-breakers regardless of source order", () => {
    const a = session({ id: "a" });
    const b = session({ id: "b" });
    const bConflict = session({ id: "b", reason: "keyboard" });
    const first = mergeRecords([b, a], [bConflict]);
    expect(first.map((record) => record.id)).toEqual(["a", "b"]);
    expect(first).toEqual(mergeRecords([bConflict], [a, b]));
    expect(mergeRecords(first, first)).toEqual(first);
  });
});

describe("record persistence", () => {
  it("starts with no history or warning when storage is empty", () => {
    expect(loadRecords(memoryStorage())).toEqual({ records: [], warning: null });
  });

  it("round-trips a versioned snapshot and deduplicates repeated IDs", () => {
    const storage = memoryStorage();
    const record = session();
    expect(saveRecords(storage, [record, record])).toEqual({ ok: true, warning: null });
    expect(JSON.parse(storage.values.get(STORAGE_KEY)!)).toEqual({ version: 1, sessions: [record] });
    expect(loadRecords(storage)).toEqual({ records: [record], warning: null });
  });

  it("accepts a zero-length session at the Unix epoch", () => {
    const storage = memoryStorage();
    const record = session({ startedAt: 0, endedAt: 0, durationMs: 0 });
    expect(saveRecords(storage, [record]).ok).toBe(true);
    expect(loadRecords(storage).records).toEqual([record]);
  });

  it("keeps legitimate long histories without an arbitrary record cap", () => {
    const storage = memoryStorage();
    const records = Array.from({ length: 12_000 }, (_, index) => session({
      id: `record-${index}`,
      startedAt: index * 20_000,
      endedAt: index * 20_000 + 10_000,
    }));
    expect(saveRecords(storage, records).ok).toBe(true);
    const loaded = loadRecords(storage);
    expect(loaded.warning).toBeNull();
    expect(loaded.records).toHaveLength(12_000);
    expect(loaded.records[0].id).toBe("record-11999");
    expect(loaded.records.at(-1)?.id).toBe("record-0");
  });

  it.each([
    "{broken json",
    "",
    "null",
    "[]",
    JSON.stringify({ version: 2, sessions: [] }),
    JSON.stringify({ version: 1, sessions: null }),
    JSON.stringify({ version: 1 }),
  ])("warns on malformed or unsupported data and preserves the original: %s", (raw) => {
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    expect(loadRecords(storage).warning).toBeTruthy();
    expect(saveRecords(storage, [session()]).ok).toBe(false);
    expect(storage.values.get(STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("salvages valid records while leaving corrupted original bytes untouched", () => {
    const valid = session();
    const raw = JSON.stringify({
      version: 1,
      sessions: [valid, { ...valid, id: "broken", durationMs: 999 }],
    });
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const loaded = loadRecords(storage);
    expect(loaded.records).toEqual([valid]);
    expect(loaded.warning).toBeTruthy();
    expect(storage.values.get(STORAGE_KEY)).toBe(raw);
    expect(saveRecords(storage, loaded.records).ok).toBe(false);
  });

  it.each([
    { id: "" },
    { id: "a".repeat(129) },
    { id: "=SUM(A1)" },
    { id: "id\nwith-newline" },
    { mode: "unknown" },
    { mode: "__proto__" },
    { reason: "unknown" },
    { reason: "toString" },
    { startedAt: -1 },
    { startedAt: "1000" },
    { startedAt: Number.POSITIVE_INFINITY },
    { endedAt: 8_640_000_000_000_001 },
    { endedAt: 0 },
    { durationMs: -1 },
    { durationMs: 9_999 },
    { durationMs: "10000" },
    { durationMs: Number.NaN },
  ])("rejects invalid session fields %j on read and write", (invalidFields) => {
    const invalid = { ...session(), ...invalidFields };
    const raw = JSON.stringify({ version: 1, sessions: [invalid] });
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const loaded = loadRecords(storage);
    expect(loaded.records).toEqual([]);
    expect(loaded.warning).toBeTruthy();
    const freshStorage = memoryStorage();
    expect(saveRecords(freshStorage, [invalid as Session]).ok).toBe(false);
    expect(freshStorage.setItem).not.toHaveBeenCalled();
  });

  it("handles blocked reads without throwing or overwriting history", () => {
    const storage = memoryStorage();
    storage.getItem.mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    expect(loadRecords(storage).warning).toBeTruthy();
    expect(saveRecords(storage, [session()]).ok).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("reports quota failures and preserves the previously saved history", () => {
    const original = JSON.stringify({ version: 1, sessions: [session()] });
    const storage = memoryStorage({ [STORAGE_KEY]: original });
    storage.setItem.mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    const result = saveRecords(storage, [session(), session({ id: "new" })]);
    expect(result.ok).toBe(false);
    expect(result.warning).toContain("CSV");
    expect(storage.values.get(STORAGE_KEY)).toBe(original);
  });

  it("handles unavailable storage explicitly", () => {
    expect(loadRecords(null).warning).toBeTruthy();
    expect(loadRecords(undefined).warning).toBeTruthy();
    expect(saveRecords(null, []).ok).toBe(false);
    expect(saveRecords(undefined, []).ok).toBe(false);
  });
});

describe("active session persistence", () => {
  it("round-trips the original start timestamp and owner without accumulating ticks", () => {
    const storage = memoryStorage();
    const record = active();
    expect(saveActive(storage, record)).toBe(true);
    expect(JSON.parse(storage.values.get(ACTIVE_KEY)!)).toEqual({ version: 1, session: record });
    expect(loadActive(storage)).toEqual(record);
    expect(saveActive(storage, { ...record, lastSeenAt: 9_000 })).toBe(true);
    expect(loadActive(storage)?.startedAt).toBe(record.startedAt);
    expect(loadActive(storage)?.lastSeenAt).toBe(9_000);
  });

  it("removes only the active-session key on completion", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: "history-stays" });
    saveActive(storage, active());
    expect(saveActive(storage, null)).toBe(true);
    expect(storage.values.has(ACTIVE_KEY)).toBe(false);
    expect(storage.values.get(STORAGE_KEY)).toBe("history-stays");
    expect(loadActive(storage)).toBeNull();
  });

  it.each([
    { id: "" },
    { ownerId: "" },
    { ownerId: "owner\n" },
    { mode: "unknown" },
    { startedAt: -1 },
    { startedAt: Number.NaN },
    { lastSeenAt: 999 },
    { lastSeenAt: Number.POSITIVE_INFINITY },
  ])("rejects invalid active session fields %j", (invalidFields) => {
    const invalid = { ...active(), ...invalidFields };
    const storage = memoryStorage({
      [ACTIVE_KEY]: JSON.stringify({ version: 1, session: invalid }),
    });
    expect(loadActive(storage)).toBeNull();
    expect(saveActive(memoryStorage(), invalid as ActiveSession)).toBe(false);
  });

  it.each(["{bad", "null", "[]", JSON.stringify({ version: 2, session: active() })])(
    "ignores and does not overwrite malformed active data: %s",
    (raw) => {
      const storage = memoryStorage({ [ACTIVE_KEY]: raw });
      expect(loadActive(storage)).toBeNull();
      expect(saveActive(storage, active())).toBe(false);
      expect(storage.values.get(ACTIVE_KEY)).toBe(raw);
    },
  );

  it("handles unavailable storage and read/write/removal errors", () => {
    expect(loadActive(null)).toBeNull();
    expect(loadActive(undefined)).toBeNull();
    expect(saveActive(null, active())).toBe(false);
    expect(saveActive(undefined, null)).toBe(false);
    const storage = memoryStorage();
    storage.getItem.mockImplementation(() => { throw new Error("Blocked"); });
    expect(loadActive(storage)).toBeNull();
    expect(saveActive(storage, active())).toBe(false);
    storage.getItem.mockReturnValue(null);
    storage.setItem.mockImplementation(() => { throw new Error("Full"); });
    expect(saveActive(storage, active())).toBe(false);
    storage.removeItem.mockImplementation(() => { throw new Error("Blocked"); });
    expect(saveActive(storage, null)).toBe(false);
  });
});
