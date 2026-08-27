import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACHIEVEMENTS,
  REASON_LABELS,
  buildWeek,
  formatClock,
  formatDuration,
  getNewAchievements,
  getStats,
  getUnlockedAchievements,
  localDateKey,
  recordsToCsv,
  type Session,
} from "../src/lib/records";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function session(
  startedAt: number,
  durationMs: number,
  overrides: Partial<Session> = {},
): Session {
  return {
    id: "session-1",
    mode: "relaxed",
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    reason: "manual",
    ...overrides,
  };
}

function localTime(month: number, day: number, hour = 0, minute = 0): number {
  return new Date(2026, month - 1, day, hour, minute).getTime();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatClock", () => {
  it.each([
    [0, "00:00"],
    [999, "00:00"],
    [10_001, "00:10"],
    [59_999, "00:59"],
    [60_000, "01:00"],
    [3_599_999, "59:59"],
    [3_600_000, "01:00:00"],
    [3_661_000, "01:01:01"],
    [100 * HOUR, "100:00:00"],
    [-100, "00:00"],
    [Number.NaN, "00:00"],
    [Number.POSITIVE_INFINITY, "00:00"],
  ])("formats %s milliseconds as %s", (input, expected) => {
    expect(formatClock(input)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0秒"],
    [999, "0秒"],
    [10_999, "10秒"],
    [MINUTE, "1分"],
    [MINUTE + SECOND, "1分 1秒"],
    [HOUR, "1時間"],
    [HOUR + MINUTE + SECOND, "1時間 1分 1秒"],
    [25 * HOUR, "25時間"],
    [-1, "0秒"],
    [Number.NaN, "0秒"],
  ])("formats %s milliseconds as %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("localDateKey", () => {
  it("uses local date fields at both ends of the day", () => {
    expect(localDateKey(localTime(1, 2, 0, 1))).toBe("2026-01-02");
    expect(localDateKey(localTime(1, 2, 23, 59))).toBe("2026-01-02");
    expect(localDateKey(localTime(12, 31))).toBe("2026-12-31");
  });

  it("does not produce a misleading date for an invalid timestamp", () => {
    expect(localDateKey(Number.NaN)).toBe("");
  });

  it("is not an ISO/UTC date slice", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    const time = Date.parse("2026-08-26T15:01:00Z");
    expect(localDateKey(time)).toBe("2026-08-27");
  });
});

describe("achievements", () => {
  it("provides the four required milestones in increasing order", () => {
    expect(ACHIEVEMENTS.map(({ name, thresholdMs }) => [name, thresholdMs])).toEqual([
      ["小休止", 10_000],
      ["無の入口", 60_000],
      ["何もしないプロ", 600_000],
      ["虚無マスター", 3_600_000],
    ]);
  });

  it.each([9_999, 59_999, 599_999, 3_599_999])(
    "does not unlock a milestone early at %s ms",
    (duration) => {
      expect(getUnlockedAchievements([session(0, duration)]).every(
        (achievement) => achievement.thresholdMs <= duration,
      )).toBe(true);
    },
  );

  it.each([10_000, 60_000, 600_000, 3_600_000])(
    "unlocks at exactly %s ms",
    (duration) => {
      const unlocked = getUnlockedAchievements([session(0, duration)]);
      expect(unlocked.at(-1)?.thresholdMs).toBe(duration);
    },
  );

  it("requires an individual session, not accumulated shorter sessions", () => {
    const records = Array.from({ length: 10 }, (_, index) =>
      session(index * 10_000, 9_999, { id: `short-${index}` }),
    );
    expect(getUnlockedAchievements(records)).toEqual([]);
  });

  it("announces only newly unlocked milestones, including multiple at once", () => {
    const before = [session(0, 10_000)];
    const after = [...before, session(HOUR, HOUR, { id: "long" })];
    expect(getNewAchievements(before, after).map((achievement) => achievement.name))
      .toEqual(["無の入口", "何もしないプロ", "虚無マスター"]);
    expect(getNewAchievements(after, after)).toEqual([]);
    expect(getNewAchievements(after, before)).toEqual([]);
    expect(getUnlockedAchievements([])).toEqual([]);
  });
});

describe("buildWeek", () => {
  it("returns the current Monday–Sunday week with one local today marker", () => {
    const week = buildWeek([], localTime(8, 27, 15));
    expect(week.map((day) => day.key)).toEqual([
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27",
      "2026-08-28", "2026-08-29", "2026-08-30",
    ]);
    expect(week.map((day) => day.label)).toEqual(["月", "火", "水", "木", "金", "土", "日"]);
    expect(week.filter((day) => day.isToday).map((day) => day.label)).toEqual(["木"]);
    expect(week.every((day) => day.totalMs === 0 && day.date.getHours() === 0)).toBe(true);
  });

  it("keeps Sunday in the week that began the preceding Monday", () => {
    const week = buildWeek([], localTime(8, 30, 23, 59));
    expect(week[0].key).toBe("2026-08-24");
    expect(week[6].isToday).toBe(true);
  });

  it("crosses month and year boundaries using calendar dates", () => {
    const week = buildWeek([], new Date(2027, 0, 1).getTime());
    expect(week[0].key).toBe("2026-12-28");
    expect(week[6].key).toBe("2027-01-03");
  });

  it("splits a session over local midnight without double counting", () => {
    const records = [session(localTime(8, 25, 23, 59), 2 * MINUTE)];
    const week = buildWeek(records, localTime(8, 27));
    expect(week[1].totalMs).toBe(MINUTE);
    expect(week[2].totalMs).toBe(MINUTE);
    expect(week.reduce((total, day) => total + day.totalMs, 0)).toBe(2 * MINUTE);
  });

  it("assigns an interval ending exactly at midnight only to the preceding day", () => {
    const week = buildWeek(
      [session(localTime(8, 25, 23, 59), MINUTE)],
      localTime(8, 27),
    );
    expect(week[1].totalMs).toBe(MINUTE);
    expect(week[2].totalMs).toBe(0);
  });

  it("clips only the out-of-week portions of long sessions", () => {
    const records = [
      session(localTime(8, 23, 23, 59), 2 * MINUTE, { id: "previous-week" }),
      session(localTime(8, 30, 23, 59), 2 * MINUTE, { id: "next-week" }),
      session(localTime(8, 25), 48 * HOUR, { id: "two-days" }),
    ];
    const week = buildWeek(records, localTime(8, 27));
    expect(week.map((day) => day.totalMs)).toEqual([
      MINUTE, 24 * HOUR, 24 * HOUR, 0, 0, 0, MINUTE,
    ]);
  });

  it("honors a 23-hour spring daylight-saving day", () => {
    vi.stubEnv("TZ", "America/New_York");
    const start = localTime(3, 8);
    const end = localTime(3, 9);
    expect(end - start).toBe(23 * HOUR);
    const week = buildWeek([session(start, end - start)], localTime(3, 8, 12));
    expect(week[6].totalMs).toBe(23 * HOUR);
    expect(week.reduce((total, day) => total + day.totalMs, 0)).toBe(23 * HOUR);
  });

  it("honors a 25-hour autumn daylight-saving day", () => {
    vi.stubEnv("TZ", "America/New_York");
    const start = localTime(11, 1);
    const end = localTime(11, 2);
    expect(end - start).toBe(25 * HOUR);
    const week = buildWeek([session(start, end - start)], localTime(11, 1, 12));
    expect(week[6].totalMs).toBe(25 * HOUR);
    expect(week[0].key).toBe("2026-10-26");
  });
});

describe("getStats", () => {
  it("returns zeroes for a new user", () => {
    expect(getStats([], localTime(8, 27))).toEqual({
      todayBestMs: 0, totalMs: 0, weekTotalMs: 0, totalSessions: 0,
    });
  });

  it("uses local completion date for today's longest and overlap for week totals", () => {
    const records = [
      session(localTime(8, 26, 23, 59), 2 * MINUTE, { id: "overnight" }),
      session(localTime(8, 27, 8), MINUTE, { id: "today" }),
      session(localTime(8, 26, 12), HOUR, { id: "yesterday" }),
      session(localTime(8, 23, 12), 2 * HOUR, { id: "last-week" }),
    ];
    expect(getStats(records, localTime(8, 27, 12))).toEqual({
      todayBestMs: 2 * MINUTE,
      totalMs: 3 * HOUR + 3 * MINUTE,
      weekTotalMs: HOUR + 3 * MINUTE,
      totalSessions: 4,
    });
  });

  it("counts zero-duration sessions without granting an achievement", () => {
    const records = [session(localTime(8, 27), 0)];
    expect(getStats(records, localTime(8, 27)).totalSessions).toBe(1);
    expect(getUnlockedAchievements(records)).toEqual([]);
  });
});

describe("recordsToCsv", () => {
  it("provides Japanese headers, localized values, UTC times and numeric seconds", () => {
    const records = [session(Date.UTC(2026, 7, 27), 12_345, {
      mode: "strict", reason: "mouse",
    })];
    const csv = recordsToCsv(records);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"記録時間（秒）"');
    expect(csv).toContain('"開始日時（UTC）"');
    expect(csv).toContain('"厳格モード"');
    expect(csv).toContain('"2026-08-27T00:00:00.000Z"');
    expect(csv).toContain(',12.345,');
    expect(csv).toContain(`"${REASON_LABELS.mouse}"`);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("returns a usable header even if there are no sessions", () => {
    expect(recordsToCsv([]).split("\r\n")).toHaveLength(2);
  });

  it("quotes commas, embedded double quotes, and line breaks", () => {
    const csv = recordsToCsv([session(0, SECOND, { id: 'test,"quoted"\nline' })]);
    expect(csv).toContain('"test,""quoted""\nline"');
  });

  it.each(["=1+1", "+1+1", "-1+1", "@SUM(A1)", "  =1+1", "\t=1+1", "\rtest", "\ntest"])(
    "neutralizes spreadsheet formula injection in %j",
    (id) => {
      const csv = recordsToCsv([session(0, SECOND, { id })]);
      expect(csv).toContain(`"'${id}"`);
    },
  );
});
