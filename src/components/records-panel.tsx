"use client";

import {
  Check,
  CircleDot,
  Coffee,
  Download,
  Leaf,
  LockKeyhole,
  Orbit,
  ArrowRight,
} from "lucide-react";
import {
  ACHIEVEMENTS,
  REASON_LABELS,
  type Session,
  buildWeek,
  formatClock,
  formatDuration,
  getStats,
  getUnlockedAchievements,
} from "@/lib/records";

const achievementIcons = [Coffee, CircleDot, Leaf, Orbit];

export function RecordsPanel({
  records,
  now,
  onExport,
  onStart,
}: {
  records: Session[];
  now: number | null;
  onExport: () => void;
  onStart: () => void;
}) {
  const stats = getStats(records, now ?? 0);
  const days = now === null ? [] : buildWeek(records, now);
  const unlocked = getUnlockedAchievements(records);
  const longest = records.reduce(
    (best, session) => Math.max(best, session.durationMs),
    0,
  );
  const next = ACHIEVEMENTS.find((item) => item.thresholdMs > longest);
  const max = Math.max(60_000, ...days.map((day) => day.totalMs));
  const weekLabel = days.length
    ? `${days[0].date.getMonth() + 1}.${days[0].date.getDate()} — ${days[6].date.getMonth() + 1}.${days[6].date.getDate()}`
    : "今週";

  return (
    <section
      className="records-view view-enter"
      aria-labelledby="records-title"
    >
      <div className="records-heading">
        <div>
          <span className="eyebrow">YOUR NOTHING, ADDED UP.</span>
          <h1 id="records-title" tabIndex={-1}>
            積み重ねた、余白。
          </h1>
          <p>何もしていないのに、こんなに。</p>
        </div>
        <button
          className="secondary-button export-button"
          onClick={onExport}
          disabled={!records.length}
        >
          <Download size={16} />
          CSV出力
        </button>
      </div>
      <div className="record-stat-grid">
        <div>
          <span>本日の最長記録</span>
          <strong>{formatClock(stats.todayBestMs)}</strong>
          <small>今日の、いちばん長い余白</small>
        </div>
        <div>
          <span>累計何もしなかった時間</span>
          <strong>{formatClock(stats.totalMs)}</strong>
          <small>すべてのモードの合計</small>
        </div>
        <div>
          <span>何もしなかった回数</span>
          <strong>
            {stats.totalSessions}
            <i>回</i>
          </strong>
          <small>ひと休みの積み重ね</small>
        </div>
      </div>
      <div className="week-card">
        <div className="section-heading">
          <div>
            <h2>今週の何もしない</h2>
            <p>
              {weekLabel}
              <span className="dot-divider">·</span>月曜日から日曜日
            </p>
          </div>
          <div className="week-total">
            <strong>{formatDuration(stats.weekTotalMs)}</strong>
            <span>今週の合計</span>
          </div>
        </div>
        <div className="week-chart" aria-hidden="true">
          <span className="chart-max">{formatDuration(max)}</span>
          <div className="chart-guide" />
          <div className="chart-bars">
            {days.map((day) => (
              <div
                className={`chart-column ${day.isToday ? "today" : ""}`}
                key={day.key}
              >
                <div className="bar-track">
                  <span
                    className="chart-bar"
                    style={{
                      height: `${Math.max(day.totalMs > 0 ? 4 : 1.5, (day.totalMs / max) * 100)}%`,
                    }}
                  >
                    <span className="bar-value">
                      {day.totalMs > 0 ? formatDuration(day.totalMs) : ""}
                    </span>
                  </span>
                </div>
                <span className="day-label">
                  {day.label}
                  {day.isToday && <span className="today-dot" />}
                </span>
              </div>
            ))}
          </div>
          <span className="chart-zero">0</span>
        </div>
        <table className="sr-only">
          <caption>
            今週の日別記録。日付をまたぐ時間は各日に分けて集計。
          </caption>
          <thead>
            <tr>
              <th scope="col">日付</th>
              <th scope="col">何もしなかった時間</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.key}>
                <th scope="row">{day.key}</th>
                <td>{formatDuration(day.totalMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!records.length && (
          <p className="chart-empty">
            まだ、まっさら。最初の余白をつくってみましょう。
          </p>
        )}
      </div>
      <section
        className="achievements-section"
        aria-labelledby="achievements-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="achievements-title">何もしない実績</h2>
            <p>何もしていないあなたに、ささやかな称号を。</p>
          </div>
          <span className="achievement-count">
            {unlocked.length} / 4<span>解除</span>
          </span>
        </div>
        <div className="achievement-grid">
          {ACHIEVEMENTS.map((achievement, index) => {
            const earned = unlocked.some((item) => item.id === achievement.id);
            const Icon = achievementIcons[index];
            return (
              <article
                key={achievement.id}
                className={`achievement-card ${earned ? "earned" : ""}`}
                aria-label={`${achievement.name}、${formatDuration(achievement.thresholdMs)}、${earned ? "解除済み" : "未解除"}`}
              >
                <span className="achievement-symbol">
                  <Icon size={23} strokeWidth={1.4} />
                </span>
                <strong>{achievement.name}</strong>
                <span className="achievement-threshold">
                  {formatDuration(achievement.thresholdMs)}
                </span>
                <span className="achievement-state">
                  {earned ? (
                    <>
                      <Check size={12} />
                      解除済み
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={11} />
                      これから
                    </>
                  )}
                </span>
              </article>
            );
          })}
        </div>
        <p className="achievement-footnote">
          {next
            ? `次の称号は、1回の記録で${formatDuration(next.thresholdMs)}。急がず、気が向いたときに。`
            : "すべての称号を手にしました。何もしないの、上手ですね。"}
        </p>
      </section>
      {records.length > 0 && (
        <details className="history">
          <summary>
            最近の記録<span>{records.length}件</span>
          </summary>
          <ul>
            {records.slice(0, 20).map((record) => (
              <li key={record.id}>
                <div>
                  <time dateTime={new Date(record.endedAt).toISOString()}>
                    {new Date(record.endedAt).toLocaleString("ja-JP", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <span>
                    {record.mode === "strict" ? "厳格モード" : "ゆるモード"} ·{" "}
                    {REASON_LABELS[record.reason]}
                  </span>
                </div>
                <strong>{formatClock(record.durationMs)}</strong>
              </li>
            ))}
          </ul>
          {records.length > 20 && (
            <p>最新20件を表示しています。すべての記録はCSVで保存できます。</p>
          )}
        </details>
      )}
      {!records.length && (
        <button className="text-button empty-start" onClick={onStart}>
          はじめての何もしないへ
          <ArrowRight size={16} />
        </button>
      )}
    </section>
  );
}
