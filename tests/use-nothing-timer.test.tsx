// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNothingTimer } from "../src/hooks/use-nothing-timer";
import { getStats, localDateKey, type ActiveSession, type EndReason, type Session } from "../src/lib/records";
import { ACTIVE_KEY, STORAGE_KEY, loadActive, loadRecords, saveActive, saveRecords } from "../src/lib/storage";
import { trackEvent } from "../src/lib/telemetry";

vi.mock("../src/lib/telemetry", () => ({ trackEvent: vi.fn() }));

const TAB_KEY = "doing-nothing:tab:v1";
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  vi.setSystemTime(new Date("2026-08-27T03:00:00Z"));
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(TAB_KEY, "this-tab");
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  vi.mocked(trackEvent).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
  else Reflect.deleteProperty(navigator, "locks");
});

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function readyHook(strictReact = false) {
  const hook = renderHook(() => useNothingTimer(), strictReact ? { wrapper: StrictMode } : undefined);
  await advance(20);
  expect(hook.result.current.ready).toBe(true);
  return hook;
}

type TimerHook = Awaited<ReturnType<typeof readyHook>>;

async function startRelaxed(hook: TimerHook) {
  await act(async () => { hook.result.current.start(); });
  expect(hook.result.current.phase).toBe("running");
}

async function startStrict(hook: TimerHook) {
  act(() => { hook.result.current.setPreferences("strict", true); });
  act(() => { hook.result.current.start(); });
  expect(hook.result.current.phase).toBe("preparing");
  await advance(3_000);
  expect(hook.result.current.phase).toBe("running");
}

function pointer(type = "pointerdown", pointerType = "mouse", movementX = 0, movementY = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType, pointerId: 1, movementX, movementY });
  return event;
}

function visibility(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

function storageChange(key: string | null = ACTIVE_KEY) {
  window.dispatchEvent(new StorageEvent("storage", { key, storageArea: window.localStorage }));
}

function storedActive(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: "saved-session", mode: "relaxed", startedAt: Date.now() - 60_000,
    lastSeenAt: Date.now() - 50_000, ownerId: "this-tab", ...overrides,
  };
}

function queuedLocks() {
  const releases: Array<() => void> = [];
  const request = vi.fn((_name: string, callback: () => void) => new Promise<void>((resolve) => {
    releases.push(() => { callback(); resolve(); });
  }));
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  return { request, releases };
}

describe("relaxed timer", () => {
  it("does not start before browser state has loaded", () => {
    const hook = renderHook(() => useNothingTimer());
    act(() => { hook.result.current.start(); });
    expect(hook.result.current.phase).toBe("idle");
    expect(loadActive(window.localStorage)).toBeNull();
  });

  it("ignores input and visibility, then finalizes once with actual wall time", async () => {
    const hook = await readyHook();
    await startRelaxed(hook);
    const start = Date.now();
    act(() => {
      window.dispatchEvent(pointer("pointerdown", "touch"));
      window.dispatchEvent(pointer("pointermove", "mouse", 1));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: 20 }));
      visibility(true);
      window.dispatchEvent(new Event("blur"));
    });
    await advance(12_345);
    expect(hook.result.current.phase).toBe("running");
    act(() => { hook.result.current.stop(); hook.result.current.stop(); });
    expect(hook.result.current.result).toMatchObject({
      mode: "relaxed", reason: "manual", startedAt: start, durationMs: 12_345,
    });
    expect(hook.result.current.records).toHaveLength(1);
    expect(loadRecords(window.localStorage).records).toHaveLength(1);
    expect(loadActive(window.localStorage)).toBeNull();
    expect(vi.mocked(trackEvent).mock.calls.filter(([name]) => name === "session_end")).toHaveLength(1);
    expect(vi.mocked(trackEvent).mock.calls.filter(([name]) => name === "achievement_unlock")).toHaveLength(1);
  });

  it("uses the saved start time after a delayed or suspended timer callback", async () => {
    const hook = await readyHook();
    await startRelaxed(hook);
    const startedAt = Date.now();
    vi.setSystemTime(startedAt + 60_000);
    await advance(200);
    expect(hook.result.current.elapsedMs).toBe(60_200);
    expect(loadActive(window.localStorage)?.startedAt).toBe(startedAt);
  });

  it("cannot be accidentally orphaned by reset, cancel or changing preferences", async () => {
    const hook = await readyHook();
    await startRelaxed(hook);
    act(() => {
      hook.result.current.reset();
      hook.result.current.cancel();
      hook.result.current.setPreferences("strict", false);
    });
    expect(hook.result.current.phase).toBe("running");
    expect(hook.result.current.mode).toBe("relaxed");
    act(() => { hook.result.current.stop(); });
    expect(hook.result.current.records).toHaveLength(1);
  });
});

describe("strict timer", () => {
  it("gives three seconds of preparation without counting them", async () => {
    const hook = await readyHook();
    act(() => { hook.result.current.setPreferences("strict", true); });
    const preparedAt = Date.now();
    act(() => { hook.result.current.start(); });
    act(() => { window.dispatchEvent(pointer("pointermove", "mouse", 5)); });
    await advance(2_999);
    expect(hook.result.current.phase).toBe("preparing");
    expect(hook.result.current.countdown).toBe(1);
    expect(loadActive(window.localStorage)).toBeNull();
    await advance(1);
    expect(hook.result.current.phase).toBe("running");
    expect(loadActive(window.localStorage)?.startedAt).toBe(preparedAt + 3_000);
    expect(hook.result.current.elapsedMs).toBe(0);
  });

  it("already observes input in the same task that completes preparation", async () => {
    const hook = await readyHook();
    act(() => { hook.result.current.setPreferences("strict", true); });
    act(() => { hook.result.current.start(); });
    act(() => {
      vi.advanceTimersByTime(3_000);
      document.body.dispatchEvent(pointer("pointerdown", "touch"));
    });
    expect(hook.result.current.phase).toBe("result");
    expect(hook.result.current.result?.reason).toBe("tap");
  });

  const sources: Array<[string, EndReason, () => void]> = [
    ["touch", "tap", () => { window.dispatchEvent(pointer("pointerdown", "touch")); }],
    ["mouse button", "mouse", () => { window.dispatchEvent(pointer()); }],
    ["mouse movement", "mouse", () => { window.dispatchEvent(pointer("pointermove", "mouse", 2)); }],
    ["mouse wheel", "mouse", () => { window.dispatchEvent(new WheelEvent("wheel", { deltaY: 5, cancelable: true })); }],
    ["keyboard", "keyboard", () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", cancelable: true })); }],
    ["assistive click", "keyboard", () => { window.dispatchEvent(new MouseEvent("click", { detail: 0, cancelable: true })); }],
    ["tab visibility", "visibility", () => { visibility(true); }],
    ["window focus loss", "visibility", () => { window.dispatchEvent(new Event("blur")); }],
    ["page exit", "interrupted", () => { window.dispatchEvent(new Event("pagehide")); }],
  ];

  it.each(sources)("ends for %s and records the correct reason", async (_name, reason, trigger) => {
    const hook = await readyHook();
    await startStrict(hook);
    await advance(1_234);
    act(trigger);
    expect(hook.result.current.phase).toBe("result");
    expect(hook.result.current.result).toMatchObject({ mode: "strict", reason, durationMs: 1_234 });
  });

  it("ignores zero-distance mouse movement and deduplicates simultaneous ends", async () => {
    const hook = await readyHook();
    await startStrict(hook);
    act(() => { window.dispatchEvent(pointer("pointermove", "mouse", 0, 0)); });
    expect(hook.result.current.phase).toBe("running");
    act(() => {
      window.dispatchEvent(pointer());
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      visibility(true);
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(hook.result.current.records).toHaveLength(1);
    expect(hook.result.current.result?.reason).toBe("mouse");
    expect(vi.mocked(trackEvent).mock.calls.filter(([name]) => name === "session_end")).toHaveLength(1);
  });

  it("consumes the failed key rather than passing it to a control underneath", async () => {
    const hook = await readyHook();
    await startStrict(hook);
    const pressed = vi.fn();
    document.body.addEventListener("keydown", pressed, { once: true });
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(event); });
    document.body.removeEventListener("keydown", pressed);
    expect(event.defaultPrevented).toBe(true);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("blocks a held failure key and its release click even after 350 ms", async () => {
    const hook = await readyHook();
    await startStrict(hook);
    act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })); });
    await advance(800);
    const clicked = vi.fn();
    document.body.addEventListener("click", clicked);
    const repeated = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", repeat: true, bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(repeated);
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
      document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    });
    expect(repeated.defaultPrevented).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
    await advance(400);
    act(() => { document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(clicked).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("click", clicked);
  });

  it("blocks a long pointer press from clicking through to the result screen", async () => {
    const hook = await readyHook();
    await startStrict(hook);
    act(() => { document.body.dispatchEvent(pointer()); });
    await advance(800);
    const clicked = vi.fn();
    document.body.addEventListener("click", clicked);
    act(() => {
      document.body.dispatchEvent(pointer("pointerup"));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    document.body.removeEventListener("click", clicked);
    expect(clicked).not.toHaveBeenCalled();
  });

  it.each(["visibility", "blur"])("cancels preparation on %s", async (source) => {
    const hook = await readyHook();
    act(() => { hook.result.current.setPreferences("strict", true); });
    act(() => { hook.result.current.start(); });
    await advance(1_000);
    act(() => { if (source === "visibility") visibility(true); else window.dispatchEvent(new Event("blur")); });
    await advance(3_000);
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.records).toEqual([]);
    expect(loadActive(window.localStorage)).toBeNull();
  });
});

describe("queued starts and Web Locks", () => {
  it("queues only one start and does not restart after a double click", async () => {
    const locks = queuedLocks();
    const hook = await readyHook();
    act(() => { hook.result.current.start(); hook.result.current.start(); });
    expect(locks.request).toHaveBeenCalledTimes(1);
    await act(async () => { locks.releases[0](); });
    expect(hook.result.current.phase).toBe("running");
    expect(vi.mocked(trackEvent).mock.calls.filter(([name]) => name === "session_start")).toHaveLength(1);
  });

  it("reports a rejected Web Lock without an unhandled rejection", async () => {
    const request = vi.fn().mockRejectedValue(new DOMException("Denied", "SecurityError"));
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
    const hook = await readyHook();
    await act(async () => { hook.result.current.start(); });
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.warning).toBeTruthy();
    expect(loadActive(window.localStorage)).toBeNull();
  });

  it("does not start after unmount while waiting for a lock", async () => {
    const locks = queuedLocks();
    const hook = await readyHook();
    act(() => { hook.result.current.start(); });
    hook.unmount();
    await act(async () => { locks.releases[0](); });
    expect(loadActive(window.localStorage)).toBeNull();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("rechecks focus when a delayed strict-start lock is actually granted", async () => {
    const locks = queuedLocks();
    const hook = await readyHook();
    act(() => { hook.result.current.setPreferences("strict", true); });
    act(() => { hook.result.current.start(); });
    await advance(3_000);
    vi.mocked(document.hasFocus).mockReturnValue(false);
    await act(async () => { locks.releases[0](); });
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.warning).toBeTruthy();
    expect(loadActive(window.localStorage)).toBeNull();
  });

  it.each(["cancel", "hidden"])("invalidates a pending strict start on %s", async (source) => {
    const locks = queuedLocks();
    const hook = await readyHook();
    act(() => { hook.result.current.setPreferences("strict", true); });
    act(() => { hook.result.current.start(); });
    await advance(3_000);
    expect(locks.request).toHaveBeenCalledTimes(1);
    act(() => { if (source === "cancel") hook.result.current.cancel(); else visibility(true); });
    await act(async () => { locks.releases[0](); });
    expect(hook.result.current.phase).toBe("idle");
    expect(loadActive(window.localStorage)).toBeNull();
  });
});

describe("reload and multi-tab ownership", () => {
  it("does not misidentify its own session if focus arrives before initialization", async () => {
    saveActive(window.localStorage, storedActive());
    const hook = renderHook(() => useNothingTimer());
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
    });
    await advance(20);
    expect(hook.result.current.phase).toBe("running");
    expect(hook.result.current.activeElsewhere).toBeNull();
  });

  it("resumes a same-tab relaxed session from its original timestamp", async () => {
    const active = storedActive();
    saveActive(window.localStorage, active);
    const hook = await readyHook(true);
    expect(hook.result.current.phase).toBe("running");
    expect(hook.result.current.elapsedMs).toBeGreaterThanOrEqual(60_000);
    expect(loadActive(window.localStorage)?.startedAt).toBe(active.startedAt);
    expect(trackEvent).not.toHaveBeenCalled();
    hook.unmount();
    const reloaded = await readyHook();
    expect(reloaded.result.current.phase).toBe("running");
    expect(loadActive(window.localStorage)?.id).toBe(active.id);
  });

  it("restores an interrupted strict session only through its last checkpoint", async () => {
    const active = storedActive({ mode: "strict" });
    saveActive(window.localStorage, active);
    const hook = await readyHook(true);
    expect(hook.result.current.phase).toBe("result");
    expect(hook.result.current.result).toMatchObject({
      reason: "interrupted", startedAt: active.startedAt, endedAt: active.lastSeenAt, durationMs: 10_000,
    });
    expect(loadRecords(window.localStorage).records).toHaveLength(1);
    hook.unmount();
    const reloaded = await readyHook();
    expect(reloaded.result.current.records).toHaveLength(1);
    expect(reloaded.result.current.phase).toBe("idle");
    expect(vi.mocked(trackEvent).mock.calls.filter(([name]) => name === "session_end")).toHaveLength(1);
  });

  it.each(["strict", "relaxed"] as const)("explicitly takes over a foreign %s session", async (mode) => {
    const previous = storedActive({ mode, ownerId: "other-tab" });
    saveActive(window.localStorage, previous);
    const hook = await readyHook();
    expect(hook.result.current.activeElsewhere?.ownerId).toBe("other-tab");
    await act(async () => { await hook.result.current.resumeElsewhere(); });
    expect(hook.result.current.phase).toBe(mode === "strict" ? "result" : "running");
    if (mode === "strict") expect(hook.result.current.result?.durationMs).toBe(10_000);
    else expect(loadActive(window.localStorage)).toMatchObject({ ownerId: "this-tab", startedAt: previous.startedAt });
  });

  it("does not take over if the ownership write fails", async () => {
    saveActive(window.localStorage, storedActive({ ownerId: "other-tab" }));
    const hook = await readyHook();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await act(async () => { await hook.result.current.resumeElsewhere(); });
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.warning).toBeTruthy();
    expect(loadActive(window.localStorage)?.ownerId).toBe("other-tab");
  });

  it("handles a failed takeover lock without discarding the foreign session", async () => {
    saveActive(window.localStorage, storedActive({ ownerId: "other-tab" }));
    const hook = await readyHook();
    Object.defineProperty(navigator, "locks", {
      configurable: true, value: { request: vi.fn().mockRejectedValue(new Error("Lock unavailable")) },
    });
    await act(async () => { await hook.result.current.resumeElsewhere(); });
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.warning).toBeTruthy();
    expect(hook.result.current.activeElsewhere?.ownerId).toBe("other-tab");
  });

  it("stops the old tab when another tab takes ownership", async () => {
    const hook = await readyHook();
    await startRelaxed(hook);
    const active = loadActive(window.localStorage)!;
    saveActive(window.localStorage, { ...active, ownerId: "other-tab" });
    act(() => { storageChange(); });
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.activeElsewhere?.ownerId).toBe("other-tab");
    act(() => { hook.result.current.stop(); });
    expect(hook.result.current.records).toEqual([]);
  });

  it("checks ownership before finishing even if the storage event has not arrived", async () => {
    const hook = await readyHook();
    await startRelaxed(hook);
    const active = loadActive(window.localStorage)!;
    saveActive(window.localStorage, { ...active, ownerId: "other-tab" });
    act(() => { hook.result.current.stop(); });
    expect(hook.result.current.records).toEqual([]);
    expect(hook.result.current.phase).toBe("idle");
    expect(loadActive(window.localStorage)?.ownerId).toBe("other-tab");
  });

  it("receives the completed result from another tab without duplicating analytics", async () => {
    const hook = await readyHook();
    await startRelaxed(hook);
    const active = loadActive(window.localStorage)!;
    const completed: Session = { ...active, endedAt: active.startedAt + 1_000, durationMs: 1_000, reason: "manual" };
    saveRecords(window.localStorage, [completed]);
    saveActive(window.localStorage, null);
    act(() => { storageChange(STORAGE_KEY); });
    expect(hook.result.current.result).toMatchObject({ id: active.id, durationMs: 1_000 });
    expect(hook.result.current.phase).toBe("result");
    expect(vi.mocked(trackEvent).mock.calls.filter(([name]) => name === "session_end")).toHaveLength(0);
  });

  it("does not block a new start on a stale active marker for an already saved result", async () => {
    const active = storedActive({ ownerId: "other-tab" });
    saveActive(window.localStorage, active);
    saveRecords(window.localStorage, [{ ...active, endedAt: active.lastSeenAt, durationMs: 10_000, reason: "manual" }]);
    const hook = await readyHook();
    await startRelaxed(hook);
    expect(loadActive(window.localStorage)?.id).not.toBe(active.id);
  });
});

describe("storage and clock edge cases", () => {
  it("keeps usable in-memory records if localStorage is unavailable", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    const hook = await readyHook();
    expect(hook.result.current.warning).toBeTruthy();
    await startRelaxed(hook);
    await advance(1_000);
    act(() => { hook.result.current.stop(); });
    expect(hook.result.current.records).toHaveLength(1);
  });

  it("preserves corrupt history while allowing the new in-memory record to be exported", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    const hook = await readyHook();
    await startRelaxed(hook);
    await advance(1_000);
    act(() => { hook.result.current.stop(); });
    expect(hook.result.current.records).toHaveLength(1);
    expect(hook.result.current.warning).toContain("上書き");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("{not json");
  });

  it("does not discard an unsaved local session on an unrelated storage event", async () => {
    const hook = await readyHook();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await startRelaxed(hook);
    act(() => { storageChange(STORAGE_KEY); });
    expect(hook.result.current.phase).toBe("running");
    act(() => { hook.result.current.stop(); });
    expect(hook.result.current.records).toHaveLength(1);
    expect(hook.result.current.warning).toBeTruthy();
  });

  it("rolls today's records over at local midnight while idle", async () => {
    vi.setSystemTime(new Date(2026, 7, 27, 23, 59, 59, 900));
    const endedAt = Date.now() - 1_000;
    saveRecords(window.localStorage, [{ id: "today", mode: "relaxed", startedAt: endedAt - 10_000, endedAt, durationMs: 10_000, reason: "manual" }]);
    const hook = await readyHook();
    expect(getStats(hook.result.current.records, hook.result.current.now!).todayBestMs).toBe(10_000);
    await advance(100);
    expect(localDateKey(hook.result.current.now!)).toBe("2026-08-28");
    expect(getStats(hook.result.current.records, hook.result.current.now!).todayBestMs).toBe(0);
  });

  it("refreshes the local date when an idle page regains focus", async () => {
    const hook = await readyHook();
    vi.setSystemTime(new Date(2026, 8, 1, 12));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(localDateKey(hook.result.current.now!)).toBe("2026-09-01");
  });
});
