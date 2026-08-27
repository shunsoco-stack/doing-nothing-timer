"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ActiveSession, type Achievement, type EndReason, type Mode, type Session, getNewAchievements } from "@/lib/records";
import { ACTIVE_KEY, STORAGE_KEY, loadActive, loadRecords, mergeRecords, saveActive, saveRecords } from "@/lib/storage";
import { trackEvent } from "@/lib/telemetry";

type Phase = "idle" | "preparing" | "running" | "result";
type PendingOperation = { mode: Mode; kind: "start" | "resume" };
const PREFERENCES_KEY = "doing-nothing:preferences:v1";
const PREPARATION_MS = 3_000;
const CLICK_GUARD_MS = 350;

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function tabId(): string {
  try {
    let value = sessionStorage.getItem("doing-nothing:tab:v1");
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem("doing-nothing:tab:v1", value);
    }
    return value;
  } catch { return crypto.randomUUID(); }
}

async function withStartLock(action: () => void) {
  if (navigator.locks) await navigator.locks.request("doing-nothing:session", action);
  else action();
}

export function useNothingTimer() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setModeState] = useState<Mode>("relaxed");
  const [showMessages, setShowMessagesState] = useState(true);
  const [records, setRecords] = useState<Session[]>([]);
  const [result, setResult] = useState<Session | null>(null);
  const [newAchievements, setNewAchievements] = useState<Achievement[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [activeElsewhere, setActiveElsewhere] = useState<ActiveSession | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const activeRef = useRef<ActiveSession | null>(null);
  const recordsRef = useRef<Session[]>([]);
  const ownerRef = useRef("");
  const preparationRef = useRef<number | null>(null);
  const preparationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(false);
  const pendingRef = useRef<PendingOperation | null>(null);
  const activeSavedRef = useRef(false);
  const lastCheckpointRef = useRef(0);
  const clickBlockedUntilRef = useRef(0);
  const blockedKeysRef = useRef(new Set<string>());
  const blockedPointersRef = useRef(new Set<number>());

  const publishRecords = useCallback((sessions: Session[]) => {
    recordsRef.current = sessions;
    setRecords(sessions);
  }, []);

  const clearPreparation = useCallback(() => {
    preparationRef.current = null;
    if (preparationTimer.current !== null) clearInterval(preparationTimer.current);
    preparationTimer.current = null;
  }, []);

  const cancel = useCallback(() => {
    // These controls must never orphan a running timer.
    if (activeRef.current) return;
    pendingRef.current = null;
    clearPreparation();
    setPhase("idle");
  }, [clearPreparation]);

  const reconcileStorage = useCallback(() => {
    // Initial pageshow/focus can precede the first animation frame. Do not
    // mistake our own persisted session for a foreign tab before tabId loads.
    if (!ownerRef.current) return;
    const storage = browserStorage();
    if (!storage) return;
    const loaded = loadRecords(storage);
    publishRecords(mergeRecords(recordsRef.current, loaded.records));
    if (loaded.warning) setWarning(loaded.warning);
    const current = loadActive(storage);
    const local = activeRef.current;
    const currentCompleted = current && loaded.records.some((session) => session.id === current.id);
    if (local) {
      const completed = loaded.records.find((session) => session.id === local.id);
      const changedOwner = current && (current.id !== local.id || current.ownerId !== ownerRef.current);
      // A failed start write is not evidence of a remote takeover. Keep the
      // in-memory timer usable if quota/privacy settings prevented persistence.
      const removed = !current && activeSavedRef.current && !loaded.warning;
      if (completed || changedOwner || removed) {
        activeRef.current = null;
        activeSavedRef.current = false;
        if (completed) {
          setResult(completed);
          setNewAchievements([]);
          setElapsedMs(completed.durationMs);
          setPhase("result");
        } else {
          setPhase("idle");
          setWarning("計測は別のタブに引き継がれました。");
        }
      }
    }
    setActiveElsewhere(current && !currentCompleted && current.ownerId !== ownerRef.current ? current : null);
    setNow(Date.now());
  }, [publishRecords]);

  const finish = useCallback((reason: EndReason, endTime = Date.now()) => {
    const active = activeRef.current;
    if (!active) return;
    const storage = browserStorage();
    const persisted = storage ? loadRecords(storage) : { records: [], warning: null };
    const owner = storage ? loadActive(storage) : null;
    // Storage events are asynchronous. Recheck ownership before finalizing so
    // an old tab cannot finish a session just taken over by another tab.
    if ((owner && (owner.id !== active.id || owner.ownerId !== ownerRef.current)) ||
      (storage && !owner && activeSavedRef.current && !persisted.warning)) {
      reconcileStorage();
      return;
    }
    // Clear synchronously: pointer, visibility and pagehide can arrive in one tick.
    activeRef.current = null;
    activeSavedRef.current = false;
    clickBlockedUntilRef.current = performance.now() + CLICK_GUARD_MS;
    const before = mergeRecords(recordsRef.current, persisted.records);
    const existing = before.find((session) => session.id === active.id);
    const endedAt = Math.max(active.startedAt, endTime);
    const completed: Session = existing ?? {
      id: active.id, mode: active.mode, startedAt: active.startedAt,
      endedAt, durationMs: endedAt - active.startedAt, reason,
    };
    const merged = mergeRecords(before, [completed]);
    const unlocked = getNewAchievements(before, merged);
    publishRecords(merged);
    if (storage) {
      const saved = saveRecords(storage, merged);
      if (!saved.ok) setWarning(saved.warning ?? "記録を保存できませんでした。CSVで控えを保存してください。");
      const current = loadActive(storage);
      if (current?.id === active.id && current.ownerId === ownerRef.current) saveActive(storage, null);
    }
    setResult(completed);
    setNewAchievements(unlocked);
    setElapsedMs(completed.durationMs);
    setNow(Date.now());
    setPhase("result");
    if (!existing) {
      trackEvent("session_end", { mode: completed.mode, duration_seconds: Math.floor(completed.durationMs / 1000) });
      for (const achievement of unlocked) trackEvent("achievement_unlock", { achievement: achievement.id, mode: completed.mode });
    }
  }, [publishRecords, reconcileStorage]);

  useEffect(() => {
    mountedRef.current = true;
    const frame = requestAnimationFrame(() => {
      ownerRef.current = tabId();
      const storage = browserStorage();
      setNow(Date.now());
      if (!storage) {
        setWarning("このブラウザでは保存を利用できません。記録はこの画面を閉じるまで有効です。CSVで保存できます。");
        setReady(true);
        return;
      }
      const loaded = loadRecords(storage);
      publishRecords(loaded.records);
      setWarning(loaded.warning);
      try {
        const preference = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? "{}");
        if (preference.mode === "strict" || preference.mode === "relaxed") setModeState(preference.mode);
        if (typeof preference.showMessages === "boolean") setShowMessagesState(preference.showMessages);
      } catch { /* Preferences are optional; session data is handled separately. */ }
      const active = loadActive(storage);
      if (active && loaded.records.some((session) => session.id === active.id)) {
        // A completed record is authoritative over a leftover active marker.
        saveActive(storage, null);
      } else if (active) {
        if (active.ownerId === ownerRef.current) {
          activeRef.current = active;
          activeSavedRef.current = true;
          lastCheckpointRef.current = 0;
          setModeState(active.mode);
          if (active.mode === "relaxed") {
            setElapsedMs(Math.max(0, Date.now() - active.startedAt));
            setPhase("running");
          } else finish("interrupted", active.lastSeenAt);
        } else setActiveElsewhere(active);
      }
      setReady(true);
    });
    return () => {
      mountedRef.current = false;
      pendingRef.current = null;
      clearPreparation();
      cancelAnimationFrame(frame);
    };
  }, [clearPreparation, finish, publishRecords]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== ACTIVE_KEY && event.key !== null) return;
      reconcileStorage();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [reconcileStorage]);

  const begin = useCallback(async (selectedMode: Mode) => {
    if (activeRef.current || pendingRef.current || !mountedRef.current) return;
    const operation: PendingOperation = { mode: selectedMode, kind: "start" };
    // Reserve synchronously, before the browser grants an asynchronous lock.
    pendingRef.current = operation;
    try {
      await withStartLock(() => {
        if (!mountedRef.current || pendingRef.current !== operation || activeRef.current) return;
        if (selectedMode === "strict" && (document.hidden || !document.hasFocus())) {
          setPhase("idle");
          setWarning("画面を開いてから、もう一度始めてください。");
          return;
        }
        const storage = browserStorage();
        const loaded = storage ? loadRecords(storage) : { records: [], warning: null };
        const current = storage ? loadActive(storage) : null;
        if (current && !loaded.records.some((session) => session.id === current.id)) {
          setActiveElsewhere(current);
          setPhase("idle");
          return;
        }
        if (current && storage) saveActive(storage, null);
        const timestamp = Date.now();
        const active: ActiveSession = { id: crypto.randomUUID(), mode: selectedMode, startedAt: timestamp, lastSeenAt: timestamp, ownerId: ownerRef.current };
        activeRef.current = active;
        activeSavedRef.current = storage ? saveActive(storage, active) : false;
        lastCheckpointRef.current = 0;
        if (storage && !activeSavedRef.current) setWarning("開始時刻を保存できませんでした。この画面を開いたまま記録してください。");
        setActiveElsewhere(null);
        setElapsedMs(0);
        setNow(timestamp);
        setPhase("running");
        trackEvent("session_start", { mode: selectedMode });
      });
    } catch {
      if (mountedRef.current && pendingRef.current === operation) {
        setPhase("idle");
        setWarning("計測を開始できませんでした。別のタブを確認して、もう一度お試しください。");
      }
    } finally {
      if (pendingRef.current === operation) pendingRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!ready || !mountedRef.current || activeRef.current || pendingRef.current || preparationRef.current !== null) return;
    setResult(null);
    setNewAchievements([]);
    if (mode === "relaxed") { void begin(mode); return; }
    preparationRef.current = Date.now() + PREPARATION_MS;
    setCountdown(3);
    setPhase("preparing");
    preparationTimer.current = setInterval(() => {
      const deadline = preparationRef.current;
      if (deadline === null) return;
      const remaining = Math.max(0, deadline - Date.now());
      setCountdown(Math.ceil(remaining / 1000));
      if (remaining === 0) {
        clearPreparation();
        if (document.hidden || !document.hasFocus()) { setPhase("idle"); setWarning("画面を開いてから、もう一度始めてください。"); return; }
        void begin(mode);
      }
    }, 100);
  }, [begin, clearPreparation, mode, ready]);

  const resumeElsewhere = useCallback(async () => {
    if (!ready || !mountedRef.current || activeRef.current || pendingRef.current || preparationRef.current !== null) return;
    const operation: PendingOperation = { mode: activeElsewhere?.mode ?? "relaxed", kind: "resume" };
    pendingRef.current = operation;
    try {
      await withStartLock(() => {
        if (!mountedRef.current || pendingRef.current !== operation || activeRef.current) return;
        const storage = browserStorage();
        if (!storage) {
          setWarning("保存領域を利用できないため、計測を引き継げませんでした。");
          return;
        }
        const previous = loadActive(storage);
        if (!previous) { setActiveElsewhere(null); return; }
        const loaded = loadRecords(storage);
        const completed = loaded.records.find((session) => session.id === previous.id);
        if (completed) {
          publishRecords(mergeRecords(recordsRef.current, loaded.records));
          saveActive(storage, null);
          setActiveElsewhere(null);
          setResult(completed);
          setNewAchievements([]);
          setElapsedMs(completed.durationMs);
          setPhase("result");
          return;
        }
        const active = { ...previous, ownerId: ownerRef.current, lastSeenAt: Math.max(previous.lastSeenAt, Date.now()) };
        if (!saveActive(storage, active)) {
          setWarning("引き継ぎを保存できませんでした。元のタブの記録はそのままです。");
          return;
        }
        activeRef.current = active;
        activeSavedRef.current = true;
        lastCheckpointRef.current = 0;
        setModeState(active.mode);
        setActiveElsewhere(null);
        if (active.mode === "strict") finish("interrupted", previous.lastSeenAt);
        else { setElapsedMs(Math.max(0, Date.now() - active.startedAt)); setNow(Date.now()); setPhase("running"); }
      });
    } catch {
      if (mountedRef.current && pendingRef.current === operation) {
        setWarning("計測を引き継げませんでした。もう一度お試しください。");
      }
    } finally {
      if (pendingRef.current === operation) pendingRef.current = null;
    }
  }, [activeElsewhere, finish, publishRecords, ready]);

  const update = useCallback((forceCheckpoint = false) => {
    const timestamp = Date.now();
    setNow(timestamp);
    const active = activeRef.current;
    if (!active) return;
    setElapsedMs(Math.max(0, timestamp - active.startedAt));
    if (forceCheckpoint || timestamp - lastCheckpointRef.current >= 1000) {
      lastCheckpointRef.current = timestamp;
      active.lastSeenAt = Math.max(active.startedAt, active.lastSeenAt, timestamp);
      const storage = browserStorage();
      if (storage) {
        const stored = loadActive(storage);
        if ((stored && (stored.id !== active.id || stored.ownerId !== ownerRef.current)) ||
          (!stored && activeSavedRef.current)) {
          reconcileStorage();
        } else if (stored?.id === active.id && stored.ownerId === ownerRef.current) {
          if (!saveActive(storage, active)) {
            setWarning("最新の開始情報を保存できませんでした。この画面を開いたまま記録し、終了後にCSVで保存してください。");
          }
        }
      }
    }
  }, [reconcileStorage]);

  useEffect(() => {
    if (phase !== "running") return;
    const tick = setInterval(() => update(), 200);
    return () => clearInterval(tick);
  }, [phase, update]);

  useEffect(() => {
    // Register once, before activation. Reading refs here closes the gap between
    // a countdown/lock callback starting a session and React painting it.
    const consume = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };
    const strict = (reason: EndReason, event?: Event) => {
      if (activeRef.current?.mode !== "strict") return;
      if (event) consume(event);
      finish(reason);
    };
    const pointer = (event: PointerEvent) => {
      if (activeRef.current?.mode !== "strict") return;
      blockedPointersRef.current.add(event.pointerId);
      strict(event.pointerType === "mouse" ? "mouse" : "tap", event);
    };
    const releasePointer = (event: PointerEvent) => {
      if (!blockedPointersRef.current.delete(event.pointerId)) return;
      consume(event);
      clickBlockedUntilRef.current = performance.now() + CLICK_GUARD_MS;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && (event.movementX !== 0 || event.movementY !== 0)) strict("mouse", event);
    };
    const keyboard = (event: KeyboardEvent) => {
      const key = event.code || event.key;
      if (blockedKeysRef.current.has(key)) { consume(event); return; }
      if (activeRef.current?.mode !== "strict") return;
      blockedKeysRef.current.add(key);
      strict("keyboard", event);
    };
    const releaseKey = (event: KeyboardEvent) => {
      if (!blockedKeysRef.current.delete(event.code || event.key)) return;
      consume(event);
      clickBlockedUntilRef.current = performance.now() + CLICK_GUARD_MS;
    };
    const wheel = (event: WheelEvent) => strict("mouse", event);
    const click = (event: MouseEvent) => {
      if (activeRef.current?.mode === "strict") {
        strict(event.detail === 0 ? "keyboard" : "mouse", event);
      } else if (performance.now() < clickBlockedUntilRef.current ||
        blockedKeysRef.current.size > 0 || blockedPointersRef.current.size > 0) {
        consume(event);
      }
    };
    const cancelStrictPreparation = () => {
      if (preparationRef.current !== null ||
        (pendingRef.current?.kind === "start" && pendingRef.current.mode === "strict")) cancel();
    };
    const releaseLostInputs = () => {
      blockedKeysRef.current.clear();
      blockedPointersRef.current.clear();
    };
    const foreground = () => { reconcileStorage(); update(); };
    const visibility = () => {
      if (document.hidden) {
        cancelStrictPreparation();
        strict("visibility");
        releaseLostInputs();
        update(true);
      } else foreground();
    };
    const blur = () => {
      cancelStrictPreparation();
      strict("visibility");
      releaseLostInputs();
    };
    const pagehide = () => {
      if (!activeRef.current) cancel();
      if (activeRef.current?.mode === "strict") finish("interrupted");
      else update(true);
    };
    window.addEventListener("pointerdown", pointer, { capture: true });
    window.addEventListener("pointerup", releasePointer, { capture: true });
    window.addEventListener("pointercancel", releasePointer, { capture: true });
    window.addEventListener("pointermove", move, { capture: true });
    window.addEventListener("keydown", keyboard, { capture: true });
    window.addEventListener("keyup", releaseKey, { capture: true });
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    window.addEventListener("click", click, { capture: true });
    window.addEventListener("blur", blur);
    window.addEventListener("focus", foreground);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", foreground);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("pointerup", releasePointer, true);
      window.removeEventListener("pointercancel", releasePointer, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("keyup", releaseKey, true);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", foreground);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [cancel, finish, reconcileStorage, update]);

  useEffect(() => {
    if (phase !== "running" && phase !== "preparing") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [phase]);

  useEffect(() => {
    if (!ready || phase === "running") return;
    let midnightTimer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const timestamp = Date.now();
      const nextMidnight = new Date(timestamp);
      nextMidnight.setHours(24, 0, 0, 0);
      midnightTimer = setTimeout(() => {
        setNow(Date.now());
        scheduleMidnight();
      }, Math.max(1, nextMidnight.getTime() - timestamp));
    };
    scheduleMidnight();
    // Also refresh after a system-clock/timezone adjustment while the page is idle.
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(midnightTimer);
      clearInterval(tick);
    };
  }, [phase, ready]);

  const setPreferences = (selectedMode: Mode, messages: boolean) => {
    if (activeRef.current || pendingRef.current || preparationRef.current !== null) return;
    setModeState(selectedMode);
    setShowMessagesState(messages);
    try { browserStorage()?.setItem(PREFERENCES_KEY, JSON.stringify({ mode: selectedMode, showMessages: messages })); } catch { /* The timer still works without saved preferences. */ }
  };

  return {
    phase, mode, showMessages, setPreferences, records, result, newAchievements,
    elapsedMs, countdown, ready, warning, setWarning, activeElsewhere, now,
    start, cancel, stop: () => finish("manual"), resumeElsewhere,
    reset: () => {
      if (activeRef.current) return;
      cancel();
      setResult(null);
      setElapsedMs(0);
      setNow(Date.now());
    },
  };
}
