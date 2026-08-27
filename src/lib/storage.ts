import type { ActiveSession, EndReason, Mode, Session } from "./records";

export const STORAGE_KEY = "doing-nothing:records:v1";
export const ACTIVE_KEY = "doing-nothing:active:v1";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "getItem" | "setItem">;
type ActiveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type LoadResult = { records: Session[]; warning: string | null };
type SaveResult = { ok: boolean; warning: string | null };

const MAX_DATE_MS = 8_640_000_000_000_000;
const MODES: readonly Mode[] = ["strict", "relaxed"];
const REASONS: readonly EndReason[] = [
  "tap", "mouse", "keyboard", "visibility", "manual", "interrupted",
];

const UNAVAILABLE_WARNING =
  "ブラウザの保存領域を利用できません。この画面を閉じる前にCSVで記録を保存してください。";
const CORRUPT_WARNING =
  "保存データの一部を読み込めませんでした。元のデータを保護するため上書きしていません。読み込めた記録はCSVで保存できます。";
const VERSION_WARNING =
  "保存データの形式に対応していません。元のデータを保護するため上書きしていません。";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_DATE_MS;
}

function isMode(value: unknown): value is Mode {
  return MODES.some((mode) => mode === value);
}

function isReason(value: unknown): value is EndReason {
  return REASONS.some((reason) => reason === value);
}

function isSession(value: unknown): value is Session {
  if (!isObject(value)) return false;

  return isId(value.id) &&
    isMode(value.mode) &&
    isTimestamp(value.startedAt) &&
    isTimestamp(value.endedAt) &&
    value.endedAt >= value.startedAt &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs === value.endedAt - value.startedAt &&
    isReason(value.reason);
}

function isActive(value: unknown): value is ActiveSession {
  if (!isObject(value)) return false;

  return isId(value.id) &&
    isMode(value.mode) &&
    isTimestamp(value.startedAt) &&
    isTimestamp(value.lastSeenAt) &&
    value.lastSeenAt >= value.startedAt &&
    isId(value.ownerId);
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function compareSameId(first: Session, second: Session): number {
  // The first observed end is authoritative. A later tab/recovery event must
  // not extend a session that was already stopped by a strict-mode interaction.
  return first.endedAt - second.endedAt ||
    first.startedAt - second.startedAt ||
    first.durationMs - second.durationMs ||
    compareText(first.mode, second.mode) ||
    compareText(first.reason, second.reason);
}

/** Commutative merge with deterministic conflict resolution and display order. */
export function mergeRecords(
  first: readonly Session[],
  second: readonly Session[],
): Session[] {
  const byId = new Map<string, Session>();

  for (const record of [...first, ...second]) {
    const existing = byId.get(record.id);
    if (!existing || compareSameId(record, existing) < 0) byId.set(record.id, record);
  }

  return [...byId.values()].sort(
    (a, b) => b.startedAt - a.startedAt || compareText(a.id, b.id),
  );
}

function parseRecords(raw: string): LoadResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { records: [], warning: CORRUPT_WARNING };
  }

  if (!isObject(data) || data.version !== 1) {
    return { records: [], warning: VERSION_WARNING };
  }
  if (!Array.isArray(data.sessions)) {
    return { records: [], warning: CORRUPT_WARNING };
  }

  const validRecords = data.sessions.filter(isSession);
  return {
    records: mergeRecords([], validRecords),
    warning: validRecords.length === data.sessions.length ? null : CORRUPT_WARNING,
  };
}

export function loadRecords(storage: StorageReader | null | undefined): LoadResult {
  try {
    if (!storage) return { records: [], warning: UNAVAILABLE_WARNING };
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? { records: [], warning: null } : parseRecords(raw);
  } catch {
    return { records: [], warning: UNAVAILABLE_WARNING };
  }
}

/** Save a validated snapshot; never silently replace an unreadable old history. */
export function saveRecords(
  storage: StorageWriter | null | undefined,
  records: readonly Session[],
): SaveResult {
  if (!records.every(isSession)) {
    return { ok: false, warning: "記録の形式を確認できなかったため保存していません。" };
  }

  try {
    if (!storage) return { ok: false, warning: UNAVAILABLE_WARNING };
    const previousRaw = storage.getItem(STORAGE_KEY);
    if (previousRaw !== null) {
      const previous = parseRecords(previousRaw);
      if (previous.warning) return { ok: false, warning: previous.warning };
    }

    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      sessions: mergeRecords([], records),
    }));
    return { ok: true, warning: null };
  } catch {
    return {
      ok: false,
      warning: "記録を保存できませんでした。空き容量やブラウザの設定を確認し、CSVで記録を保存してください。",
    };
  }
}

function parseActive(raw: string): ActiveSession | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isObject(value) && value.version === 1 && isActive(value.session)
      ? value.session
      : null;
  } catch {
    return null;
  }
}

export function loadActive(
  storage: StorageReader | null | undefined,
): ActiveSession | null {
  try {
    const raw = storage?.getItem(ACTIVE_KEY);
    return raw ? parseActive(raw) : null;
  } catch {
    return null;
  }
}

export function saveActive(
  storage: ActiveStorage | null | undefined,
  active: ActiveSession | null,
): boolean {
  try {
    if (!storage) return false;
    if (active === null) {
      storage.removeItem(ACTIVE_KEY);
      return true;
    }
    if (!isActive(active)) return false;

    const previousRaw = storage.getItem(ACTIVE_KEY);
    if (previousRaw !== null && parseActive(previousRaw) === null) return false;

    storage.setItem(ACTIVE_KEY, JSON.stringify({ version: 1, session: active }));
    return true;
  } catch {
    return false;
  }
}
