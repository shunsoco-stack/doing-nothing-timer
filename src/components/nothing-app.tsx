"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronDown,
  Copy,
  Hand,
  Info,
  Keyboard,
  Leaf,
  LockKeyhole,
  Moon,
  MousePointer2,
  PanelsTopLeft,
  RotateCcw,
  Share2,
  Shield,
  Square,
  Sun,
  Timer,
  X,
} from "lucide-react";
import { useNothingTimer } from "@/hooks/use-nothing-timer";
import { useTheme } from "@/hooks/use-theme";
import {
  REASON_LABELS,
  type EndReason,
  formatClock,
  formatDuration,
  getStats,
  localDateKey,
  recordsToCsv,
} from "@/lib/records";
import { trackEvent } from "@/lib/telemetry";
import { Dialog } from "./dialog";
import { ModeDialog } from "./mode-dialog";
import { RecordsPanel } from "./records-panel";

const MESSAGES = [
  "いま、世界でいちばん静かな大仕事。",
  "その調子。何も進んでいません。",
  "冷蔵庫の中身は、あとで確認しましょう。",
  "あなたが休んでいても、地球は回っています。",
  "この時間、履歴書には書かなくて大丈夫。",
  "何もしない才能が、静かに開花しています。",
  "ここまでの成果：とくになし。すばらしい。",
  "雲も、だいたいこんな感じで過ごしています。",
];

const reasonIcons: Record<EndReason, typeof Hand> = {
  tap: Hand,
  mouse: MousePointer2,
  keyboard: Keyboard,
  visibility: PanelsTopLeft,
  interrupted: RotateCcw,
  manual: Check,
};

export function NothingApp() {
  const timer = useNothingTimer();
  const theme = useTheme();
  const [view, setView] = useState<"timer" | "records">("timer");
  const [modeOpen, setModeOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const focusRef = useRef<HTMLHeadingElement>(null);
  const quiet = timer.phase === "running" || timer.phase === "preparing";
  const isStrict = timer.mode === "strict";
  const ModeIcon = isStrict ? Shield : Leaf;
  const stats = getStats(timer.records, timer.now ?? 0);
  const message =
    MESSAGES[Math.floor(timer.elapsedMs / 8_000) % MESSAGES.length];

  useEffect(() => {
    if (
      timer.phase === "result" ||
      timer.phase === "running" ||
      timer.phase === "preparing"
    )
      focusRef.current?.focus({ preventScroll: true });
  }, [timer.phase]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 4_000);
    return () => clearTimeout(timeout);
  }, [toast]);

  const selectView = (nextView: "timer" | "records") => {
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "instant" });
    if (nextView === "records")
      requestAnimationFrame(() =>
        document
          .getElementById("records-title")
          ?.focus({ preventScroll: true }),
      );
  };

  const start = () => {
    window.scrollTo({ top: 0, behavior: "instant" });
    timer.start();
  };

  const exportCsv = () => {
    if (!timer.records.length) return;
    const blob = new Blob([recordsToCsv(timer.records)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `doing-nothing-${localDateKey(Date.now())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("記録のCSVを書き出しました。");
  };

  const share = async () => {
    if (!timer.result) return;
    const result = timer.result;
    const text = `${formatDuration(result.durationMs)}、何もしませんでした。\n${result.mode === "strict" ? "厳格モード" : "ゆるモード"}で、立派な余白を記録。\n#何もしない記録`;
    const url = `${window.location.origin}/`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "何もしない記録", text, url });
        trackEvent("result_share", { method: "native", mode: result.mode });
        setToast("記録を共有しました。");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      trackEvent("result_share", { method: "clipboard", mode: result.mode });
      setToast("共有用のテキストをコピーしました。");
    } catch {
      setShareFallback(`${text}\n${url}`);
    }
  };

  return (
    <div className={`app-shell ${quiet ? "is-quiet" : ""}`}>
      {!quiet && (
        <a className="skip-link" href="#main-content">
          メインコンテンツへ
        </a>
      )}
      <header className="site-header">
        {quiet ? (
          <span className="brand quiet-brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>何もしない記録</span>
          </span>
        ) : (
          <button
            className="brand"
            onClick={() => {
              timer.reset();
              selectView("timer");
            }}
            aria-label="何もしない記録、タイマーに戻る"
          >
            <span className="brand-mark" aria-hidden="true" />
            <span>何もしない記録</span>
          </button>
        )}
        {!quiet && (
          <div className="header-actions">
            <nav className="main-nav" aria-label="メインナビゲーション">
              <button
                className={view === "timer" ? "active" : ""}
                aria-current={view === "timer" ? "page" : undefined}
                onClick={() => selectView("timer")}
              >
                <Timer size={15} />
                <span>タイマー</span>
              </button>
              <button
                className={view === "records" ? "active" : ""}
                aria-current={view === "records" ? "page" : undefined}
                onClick={() => selectView("records")}
              >
                <ChartNoAxesColumnIncreasing size={15} />
                <span>記録と実績</span>
              </button>
            </nav>
            <span className="header-divider" />
            <button
              className="icon-button theme-toggle"
              onClick={theme.toggle}
              aria-label={
                theme.dark
                  ? "ライトモードに切り替える"
                  : "ダークモードに切り替える"
              }
              title={theme.dark ? "ライトモード" : "ダークモード"}
            >
              {theme.dark ? (
                <Sun size={19} strokeWidth={1.5} />
              ) : (
                <Moon size={19} strokeWidth={1.5} />
              )}
            </button>
          </div>
        )}
        {quiet && (
          <span className="recording-indicator">
            <span />
            {timer.phase === "preparing"
              ? "準備中"
              : "ただいま、何もしていません"}
          </span>
        )}
      </header>

      <main id="main-content" className={quiet ? "quiet-main" : "main-content"}>
        {timer.warning && !quiet && (
          <div role="status" className="warning-banner">
            <Info size={17} />
            <p>{timer.warning}</p>
            <button
              className="icon-button"
              aria-label="お知らせを閉じる"
              onClick={() => timer.setWarning(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {timer.activeElsewhere && !quiet && (
          <div className="elsewhere-banner" role="status">
            <div>
              <strong>別のタブの余白が、続いています。</strong>
              <p>同時に記録せず、続きから引き継げます。</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                selectView("timer");
                void timer.resumeElsewhere();
              }}
            >
              {timer.activeElsewhere.mode === "strict"
                ? "中断した記録を保存"
                : "このタブで続ける"}
              <ArrowRight size={15} />
            </button>
          </div>
        )}

        {quiet ? (
          <section
            className="recording-view view-enter"
            aria-label={
              timer.phase === "preparing" ? "計測の準備" : "何もしないを記録中"
            }
          >
            <h1 ref={focusRef} tabIndex={-1} className="recording-heading">
              {timer.phase === "preparing"
                ? "そっと、手を離しましょう。"
                : "いま、何もしない時間。"}
            </h1>
            <div
              className={`clock-face recording-clock ${timer.phase === "preparing" ? "preparing-clock" : ""} ${timer.elapsedMs >= 3_600_000 ? "long-clock" : ""}`}
            >
              <span className="orbit-point" aria-hidden="true" />
              {timer.phase === "preparing" ? (
                <span
                  className="countdown-number"
                  role="status"
                  aria-live="polite"
                >
                  {timer.countdown}
                </span>
              ) : (
                <span
                  className="clock-digits"
                  role="timer"
                  aria-live="off"
                  aria-label={`経過時間 ${formatDuration(timer.elapsedMs)}`}
                >
                  {formatClock(timer.elapsedMs)}
                </span>
              )}
            </div>
            <div className="recording-message-area">
              {timer.phase === "preparing" ? (
                <p>3秒の準備時間は、記録に含まれません。</p>
              ) : timer.showMessages ? (
                <p className="quiet-message" key={message}>
                  {message}
                </p>
              ) : (
                <p className="sr-only">メッセージの表示はオフです。</p>
              )}
            </div>
            <div className="recording-controls">
              {timer.phase === "preparing" ? (
                <button className="secondary-button" onClick={timer.cancel}>
                  いったん戻る
                </button>
              ) : !isStrict ? (
                <button className="stop-button" onClick={timer.stop}>
                  <Square size={11} fill="currentColor" />
                  何もしないを終了
                </button>
              ) : (
                <p className="strict-live-note">
                  画面への操作、またはタブ移動で終了します。
                </p>
              )}
            </div>
            <span className="quiet-mode">
              <ModeIcon size={13} />
              {isStrict ? "厳格モード" : "ゆるモード"}
            </span>
            <span className="sr-only" role="status">
              {timer.phase === "running"
                ? "計測を開始しました。"
                : "3秒後に計測を開始します。"}
            </span>
          </section>
        ) : view === "records" ? (
          <RecordsPanel
            records={timer.records}
            now={timer.now}
            onExport={exportCsv}
            onStart={() => {
              timer.reset();
              selectView("timer");
            }}
          />
        ) : timer.phase === "result" && timer.result ? (
          <section
            className="result-view view-enter"
            aria-labelledby="result-title"
          >
            <span className="eyebrow">A LITTLE NOTHING. WELL DONE.</span>
            <span
              className={`result-symbol ${timer.result.reason !== "manual" ? "interrupted-symbol" : ""}`}
            >
              {timer.result.reason === "manual" ? (
                <Leaf size={27} strokeWidth={1.3} />
              ) : (
                (() => {
                  const Icon = reasonIcons[timer.result.reason];
                  return <Icon size={26} strokeWidth={1.3} />;
                })()
              )}
            </span>
            <h1 id="result-title" ref={focusRef} tabIndex={-1}>
              {timer.result.reason === "manual" ? (
                <>
                  おかえりなさい。
                  <br />
                  いい余白でした。
                </>
              ) : (
                <>おっと、動きましたね。</>
              )}
            </h1>
            <p className="result-lead">
              {timer.result.reason === "manual"
                ? "何もしなかった時間も、ちゃんと残りました。"
                : "何もしないのって、意外とむずかしい。"}
            </p>
            <div
              className="result-time"
              aria-label={`今回の記録 ${formatDuration(timer.result.durationMs)}`}
            >
              {formatClock(timer.result.durationMs)}
            </div>
            <p className="result-time-label">今回、何もしなかった時間</p>
            <div className="result-reason">
              <span className="small-dot" />
              <span>
                {timer.result.mode === "strict" ? "厳格モード" : "ゆるモード"}
              </span>
              <span className="dot-divider">·</span>
              <span>{REASON_LABELS[timer.result.reason]}</span>
            </div>
            {timer.newAchievements.length > 0 && (
              <div className="unlock-notice" role="status">
                <span className="unlock-icon">
                  <Check size={17} />
                </span>
                <div>
                  <span>新しい実績を解除</span>
                  <strong>
                    {timer.newAchievements
                      .map((item) => `「${item.name}」`)
                      .join(" ")}
                  </strong>
                </div>
              </div>
            )}
            <div className="result-actions">
              <button className="primary-button" onClick={start}>
                もう一度、何もしない
                <RotateCcw size={16} />
              </button>
              <button className="secondary-button" onClick={() => void share()}>
                <Share2 size={16} />
                結果を共有
              </button>
            </div>
            <button
              className="text-button result-records"
              onClick={() => selectView("records")}
            >
              記録と実績を見る
              <ArrowRight size={15} />
            </button>
            <p className="result-kind-note">
              {timer.result.reason === "manual"
                ? "今日も、おつかれさまでした。"
                : "終了するまでの時間も、ちゃんと記録しています。"}
            </p>
          </section>
        ) : (
          <section
            className="home-view view-enter"
            aria-labelledby="home-title"
          >
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="small-dot" />
                THE ART OF DOING NOTHING
              </span>
              <h1 id="home-title">
                何もしないを、
                <br />
                ちゃんとしよう。
              </h1>
              <p>
                生産性を、少しだけお休み。
                <br />
                何もしていない時間も、あなたの立派な記録です。
              </p>
            </div>
            <div className="clock-face idle-clock" aria-hidden="true">
              <span className="orbit-point" />
              <span className="clock-digits">00:00</span>
              <span className="clock-caption">ここから、余白の時間。</span>
            </div>
            <div className="start-actions">
              <button
                className="primary-button start-button"
                onClick={start}
                disabled={!timer.ready || Boolean(timer.activeElsewhere)}
              >
                何もしないを開始
                <ArrowRight size={18} />
              </button>
              <button
                className="mode-trigger"
                aria-haspopup="dialog"
                onClick={() => setModeOpen(true)}
              >
                <ModeIcon size={15} strokeWidth={1.6} />
                <span>{isStrict ? "厳格モード" : "ゆるモード"}</span>
                <ChevronDown size={14} />
              </button>
              <p className="start-hint">
                {isStrict
                  ? "3秒後に開始。操作をすると、そこで終了。"
                  : "終了ボタンを押すまで、のんびりと。"}
              </p>
            </div>
            <div className="home-stats">
              <div>
                <span>本日の最長記録</span>
                <strong>{formatClock(stats.todayBestMs)}</strong>
              </div>
              <div>
                <span>累計の何もしない</span>
                <strong>{formatClock(stats.totalMs)}</strong>
              </div>
              <div>
                <span>今週の何もしない</span>
                <strong>{formatClock(stats.weekTotalMs)}</strong>
              </div>
            </div>
            <p className="home-afterword">
              何もしない。それも、ひとつの過ごし方。
            </p>
          </section>
        )}
      </main>

      {!quiet && (
        <footer className="site-footer">
          <span>
            <LockKeyhole size={12} strokeWidth={1.6} />
            記録は、この端末にだけ。
          </span>
          <span className="footer-center">LESS, BUT A LITTLE BETTER.</span>
          <button onClick={() => setAboutOpen(true)}>
            このアプリについて
            <ArrowRight size={12} />
          </button>
        </footer>
      )}
      <div
        className={`toast ${toast ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <>
            <Check size={15} />
            {toast}
          </>
        )}
      </div>
      {modeOpen && (
        <ModeDialog
          mode={timer.mode}
          showMessages={timer.showMessages}
          onSave={timer.setPreferences}
          onClose={() => setModeOpen(false)}
        />
      )}
      {aboutOpen && (
        <Dialog
          labelId="about-title"
          onClose={() => setAboutOpen(false)}
          className="about-dialog"
        >
          <span className="eyebrow">A SPACE TO DO NOTHING.</span>
          <h2 id="about-title">
            何もしない時間に、
            <br />
            まるをつけよう。
          </h2>
          <p className="dialog-description">
            これは、がんばるためのアプリではありません。
            <br />
            何もしていない時間を、そっと記録する場所です。
          </p>
          <div className="about-section">
            <h3>自分に合ったモードで</h3>
            <p>
              ゆるモードは、終了ボタンまで計測。タブを離れても続きます。厳格モードは、3秒の準備後、タップ・マウス移動やスクロール・キー入力・タブやウィンドウの移動で終了します。
            </p>
            <p>
              読み上げやキーボード操作を使う方には、ゆるモードがおすすめです。
            </p>
          </div>
          <div className="about-section">
            <h3>記録は、あなたの端末に</h3>
            <p>
              アカウントは不要。記録はブラウザ内に保存され、別の端末とは同期されません。ブラウザのデータ削除で失われるため、CSVで控えを残せます。保存済み記録の一覧や入力内容は送信しません。
            </p>
            <p>
              利用状況の計測にはVercel
              Analyticsを使用します。有効な環境では、モードや計測時間などを送信します。ブラウザの追跡拒否設定を尊重します。
            </p>
          </div>
          <div className="about-section">
            <h3>いつもの場所に、余白を</h3>
            <p>
              ブラウザのメニューからホーム画面に追加できます。一度読み込み、オフラインの準備が整えば、ネットワークがなくても利用できます。通知は送りません。
            </p>
          </div>
          <div className="about-theme">
            <span>
              画面の明るさ：
              {theme.theme === "system"
                ? "端末に合わせる"
                : theme.dark
                  ? "ダーク"
                  : "ライト"}
            </span>
            <button className="text-button" onClick={theme.useSystem}>
              端末に合わせる
            </button>
          </div>
          <button
            className="secondary-button wide"
            onClick={() => setAboutOpen(false)}
          >
            <ArrowLeft size={15} />
            タイマーに戻る
          </button>
        </Dialog>
      )}
      {shareFallback && (
        <Dialog labelId="share-title" onClose={() => setShareFallback(null)}>
          <span className="eyebrow">SHARE YOUR NOTHING.</span>
          <h2 id="share-title">余白を、おすそわけ。</h2>
          <p className="dialog-description">
            自動コピーを利用できませんでした。以下を選択してコピーしてください。
          </p>
          <textarea
            className="share-text"
            aria-label="共有するテキスト"
            readOnly
            value={shareFallback}
            onFocus={(event) => event.target.select()}
            rows={6}
          />
          <button
            className="secondary-button wide"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareFallback);
                trackEvent("result_share", {
                  method: "clipboard",
                  mode: timer.mode,
                });
                setShareFallback(null);
                setToast("共有用のテキストをコピーしました。");
              } catch {
                setToast("テキストを選択して、手動でコピーしてください。");
              }
            }}
          >
            <Copy size={16} />
            コピーする
          </button>
        </Dialog>
      )}
      <noscript>
        <div className="noscript-note">
          タイマーと端末内への保存にはJavaScriptが必要です。ブラウザの設定で有効にしてください。
        </div>
      </noscript>
    </div>
  );
}
