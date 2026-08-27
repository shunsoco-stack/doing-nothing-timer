export type Mode = "strict" | "relaxed";

export type EndReason =
  | "tap"
  | "mouse"
  | "keyboard"
  | "visibility"
  | "manual"
  | "interrupted";

export type Session = {
  id: string;
  mode: Mode;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  reason: EndReason;
};

export type ActiveSession = {
  id: string;
  mode: Mode;
  startedAt: number;
  lastSeenAt: number;
  ownerId: string;
};

export type Achievement = {
  id: string;
  name: string;
  thresholdMs: number;
  description: string;
};

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "little-break",
    name: "小休止",
    thresholdMs: 10_000,
    description: "10秒。何もしないにも、はじめの一歩。",
  },
  {
    id: "entrance-to-nothing",
    name: "無の入口",
    thresholdMs: 60_000,
    description: "1分。予定のない時間へ、ようこそ。",
  },
  {
    id: "doing-nothing-pro",
    name: "何もしないプロ",
    thresholdMs: 600_000,
    description: "10分。ここまで何もしないのも、才能です。",
  },
  {
    id: "master-of-nothing",
    name: "虚無マスター",
    thresholdMs: 3_600_000,
    description: "60分。世界は、その間もちゃんと回っていました。",
  },
];

export const REASON_LABELS: Record<EndReason, string> = {
  tap: "画面をタップしました",
  mouse: "マウスを操作しました",
  keyboard: "キーボードを操作しました",
  visibility: "タブや画面を切り替えました",
  manual: "自分で終了しました",
  interrupted: "ページの終了・再読み込みで中断しました",
};

function wholeSeconds(ms: number): number {
  return Number.isFinite(ms) ? Math.floor(Math.max(0, ms) / 1_000) : 0;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A wall-clock display; elapsed time is calculated from timestamps, never ticks. */
export function formatClock(ms: number): string {
  const seconds = wholeSeconds(ms);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(remainder)}`
    : `${pad(minutes)}:${pad(remainder)}`;
}

export function formatDuration(ms: number): string {
  const seconds = wholeSeconds(ms);
  if (seconds === 0) return "0秒";

  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;

  return [
    hours > 0 ? `${hours}時間` : "",
    minutes > 0 ? `${minutes}分` : "",
    remainder > 0 ? `${remainder}秒` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Date keys follow the device timezone, not UTC. */
export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";

  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getUnlockedAchievements(
  records: readonly Session[],
): Achievement[] {
  const longest = records.reduce(
    (best, record) => Math.max(best, record.durationMs),
    0,
  );
  return ACHIEVEMENTS.filter((achievement) => longest >= achievement.thresholdMs);
}

export function getNewAchievements(
  before: readonly Session[],
  after: readonly Session[],
): Achievement[] {
  const previouslyUnlocked = new Set(
    getUnlockedAchievements(before).map((achievement) => achievement.id),
  );
  return getUnlockedAchievements(after).filter(
    (achievement) => !previouslyUnlocked.has(achievement.id),
  );
}

export type WeekDay = {
  key: string;
  date: Date;
  label: string;
  totalMs: number;
  isToday: boolean;
};

/**
 * A local Monday–Sunday calendar. Intersect each session with calendar-day
 * boundaries: adding 24 hours would misallocate time on a daylight-saving day.
 */
export function buildWeek(
  records: readonly Session[],
  now: number = Date.now(),
): WeekDay[] {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const todayKey = localDateKey(now);
  const labels = ["月", "火", "水", "木", "金", "土", "日"];

  return labels.map((label, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const nextDate = new Date(date);
    nextDate.setDate(date.getDate() + 1);

    const dayStart = date.getTime();
    const dayEnd = nextDate.getTime();
    const totalMs = records.reduce(
      (total, record) =>
        total +
        Math.max(
          0,
          Math.min(record.endedAt, dayEnd) - Math.max(record.startedAt, dayStart),
        ),
      0,
    );
    const key = localDateKey(dayStart);

    return { key, date, label, totalMs, isToday: key === todayKey };
  });
}

export function getStats(
  records: readonly Session[],
  now: number = Date.now(),
): {
  todayBestMs: number;
  totalMs: number;
  weekTotalMs: number;
  totalSessions: number;
} {
  const todayKey = localDateKey(now);
  let todayBestMs = 0;
  let totalMs = 0;

  for (const record of records) {
    totalMs += record.durationMs;
    // A session belongs to its completion date for the personal-best metric.
    if (localDateKey(record.endedAt) === todayKey) {
      todayBestMs = Math.max(todayBestMs, record.durationMs);
    }
  }

  return {
    todayBestMs,
    totalMs,
    weekTotalMs: buildWeek(records, now).reduce((sum, day) => sum + day.totalMs, 0),
    totalSessions: records.length,
  };
}

function csvText(value: string): string {
  // Quoting alone does not stop spreadsheet formula execution. Prefix dangerous
  // cells before applying RFC 4180 escaping, including whitespace-led formulas.
  const safeValue = /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value)
    ? `'${value}`
    : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

/** UTF-8 BOM and CRLF make Japanese text import cleanly into desktop Excel. */
export function recordsToCsv(records: readonly Session[]): string {
  const header = [
    "記録ID",
    "モード",
    "開始日時（UTC）",
    "終了日時（UTC）",
    "記録時間（秒）",
    "終了理由",
  ].map(csvText).join(",");

  const rows = records.map((record) => [
    csvText(record.id),
    csvText(record.mode === "strict" ? "厳格モード" : "ゆるモード"),
    csvText(new Date(record.startedAt).toISOString()),
    csvText(new Date(record.endedAt).toISOString()),
    String(record.durationMs / 1_000),
    csvText(REASON_LABELS[record.reason]),
  ].join(","));

  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}
