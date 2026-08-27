// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NothingApp } from "@/components/nothing-app";
import { ModeDialog } from "@/components/mode-dialog";
import { RecordsPanel } from "@/components/records-panel";
import { useNothingTimer } from "@/hooks/use-nothing-timer";
import { useTheme } from "@/hooks/use-theme";
import { trackEvent } from "@/lib/telemetry";
import type { EndReason, Session } from "@/lib/records";

vi.mock("@/hooks/use-nothing-timer", () => ({ useNothingTimer: vi.fn() }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: vi.fn() }));
vi.mock("@/lib/telemetry", () => ({ trackEvent: vi.fn() }));

type TimerState = ReturnType<typeof useNothingTimer>;
const NOW = new Date(2026, 7, 27, 12).getTime();
const SHARE_TEXT = "1分 5秒、何もしませんでした。\nゆるモードで、立派な余白を記録。\n#何もしない記録";
const restoreProperties: (() => void)[] = [];
let timer: TimerState;

function replaceProperty(target: object, key: PropertyKey, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restoreProperties.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ui-session",
    mode: "relaxed",
    startedAt: NOW - 65_000,
    endedAt: NOW,
    durationMs: 65_000,
    reason: "manual",
    ...overrides,
  };
}

function setTimer(overrides: Partial<TimerState> = {}): TimerState {
  timer = {
    phase: "idle",
    mode: "relaxed",
    showMessages: true,
    records: [],
    result: null,
    newAchievements: [],
    elapsedMs: 0,
    countdown: 3,
    ready: true,
    warning: null,
    activeElsewhere: null,
    now: NOW,
    setPreferences: vi.fn(),
    setWarning: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    stop: vi.fn(),
    resumeElsewhere: vi.fn(async () => undefined),
    reset: vi.fn(),
    ...overrides,
  };
  vi.mocked(useNothingTimer).mockReturnValue(timer);
  return timer;
}

function renderResult(session: Session = makeSession()): void {
  setTimer({ phase: "result", mode: session.mode, result: session, records: [session], elapsedMs: session.durationMs });
  render(<NothingApp />);
}

function expectedShareText(): string {
  return `${SHARE_TEXT}\n${window.location.origin}/`;
}

async function clickShare(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "結果を共有" }));
  });
}

function weekRows(): string[][] {
  const table = screen.getByRole("table", { name: "今週の日別記録。日付をまたぐ時間は各日に分けて集計。" });
  return within(table).getAllByRole("row").slice(1).map((row) => [
    within(row).getByRole("rowheader").textContent ?? "",
    within(row).getByRole("cell").textContent ?? "",
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setTimer();
  vi.mocked(useTheme).mockReturnValue({ theme: "system", dark: false, toggle: vi.fn(), useSystem: vi.fn() });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  // jsdom does not implement native dialog lifecycle. Preserve its real markup
  // and accessible name; only emulate the missing browser methods.
  replaceProperty(HTMLDialogElement.prototype, "showModal", function (this: HTMLDialogElement) { this.open = true; });
  replaceProperty(HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) { this.open = false; });
  replaceProperty(navigator, "share", undefined);
  replaceProperty(navigator, "clipboard", undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  while (restoreProperties.length) restoreProperties.pop()?.();
});

describe("result sharing", () => {
  it("shares the actual result with the native API and records only a successful native share", async () => {
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    replaceProperty(navigator, "share", nativeShare);
    replaceProperty(navigator, "clipboard", { writeText });
    renderResult();

    await clickShare();

    expect(nativeShare).toHaveBeenCalledExactlyOnceWith({ title: "何もしない記録", text: SHARE_TEXT, url: `${window.location.origin}/` });
    expect(writeText).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("result_share", { method: "native", mode: "relaxed" });
    expect(screen.getByText("記録を共有しました。")).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not copy, open a fallback, or count a share when the native share is cancelled", async () => {
    const nativeShare = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    replaceProperty(navigator, "share", nativeShare);
    replaceProperty(navigator, "clipboard", { writeText });
    renderResult();

    await clickShare();

    expect(nativeShare).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("記録を共有しました。")).toBeNull();
    expect(screen.queryByText("共有用のテキストをコピーしました。")).toBeNull();
  });

  it("falls back to clipboard after a non-cancellation native share failure", async () => {
    const nativeShare = vi.fn().mockRejectedValue(new DOMException("Not available", "NotAllowedError"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    replaceProperty(navigator, "share", nativeShare);
    replaceProperty(navigator, "clipboard", { writeText });
    renderResult();

    await clickShare();

    expect(nativeShare).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expectedShareText());
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("result_share", { method: "clipboard", mode: "relaxed" });
    expect(screen.getByText("共有用のテキストをコピーしました。")).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("copies the result and canonical origin when native sharing is unsupported", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    replaceProperty(navigator, "clipboard", { writeText });
    renderResult();

    await clickShare();

    expect(writeText).toHaveBeenCalledExactlyOnceWith(expectedShareText());
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("result_share", { method: "clipboard", mode: "relaxed" });
    expect(screen.getByText("共有用のテキストをコピーしました。")).toBeDefined();
  });

  it.each(["unavailable", "permission denied"])("provides selectable manual text when clipboard is %s", async (failure) => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    if (failure === "permission denied") replaceProperty(navigator, "clipboard", { writeText });
    renderResult();

    await clickShare();

    const dialog = screen.getByRole("dialog", { name: "余白を、おすそわけ。" });
    const textarea = within(dialog).getByRole("textbox", { name: "共有するテキスト" }) as HTMLTextAreaElement;
    expect(textarea.value).toBe(expectedShareText());
    expect(textarea.readOnly).toBe(true);
    act(() => textarea.focus());
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
    expect(trackEvent).not.toHaveBeenCalled();
    if (failure === "permission denied") expect(writeText).toHaveBeenCalledExactlyOnceWith(expectedShareText());
    else expect(writeText).not.toHaveBeenCalled();
  });

  it("closes the manual fallback and counts one share after a successful copy retry", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValue(undefined);
    replaceProperty(navigator, "clipboard", { writeText });
    renderResult();
    await clickShare();
    const dialog = screen.getByRole("dialog", { name: "余白を、おすそわけ。" });

    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "コピーする" })));

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenNthCalledWith(1, expectedShareText());
    expect(writeText).toHaveBeenNthCalledWith(2, expectedShareText());
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("result_share", { method: "clipboard", mode: "relaxed" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("共有用のテキストをコピーしました。")).toBeDefined();
  });

  it("keeps manual text available without a success event when a copy retry fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    replaceProperty(navigator, "clipboard", { writeText });
    renderResult();
    await clickShare();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "コピーする" })));

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog", { name: "余白を、おすそわけ。" })).toBeDefined();
    expect(screen.getByText("テキストを選択して、手動でコピーしてください。")).toBeDefined();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe("mode selection", () => {
  it("preserves initial selection and saves changed radio and checkbox values only on confirmation", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ModeDialog mode="relaxed" showMessages onSave={onSave} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "何もしないにも、自分のペースを。" });
    const relaxed = within(dialog).getByRole("radio", { name: /ゆるモード/ }) as HTMLInputElement;
    const strict = within(dialog).getByRole("radio", { name: /厳格モード/ }) as HTMLInputElement;
    const messages = within(dialog).getByRole("checkbox", { name: "記録中、たまにひとことを表示する" }) as HTMLInputElement;
    expect(relaxed.checked).toBe(true);
    expect(strict.checked).toBe(false);
    expect(messages.checked).toBe(true);

    fireEvent.click(strict);
    fireEvent.click(messages);
    expect(strict.checked).toBe(true);
    expect(relaxed.checked).toBe(false);
    expect(messages.checked).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "このモードにする" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("strict", false);
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it("does not persist changed selections when the dialog is dismissed", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ModeDialog mode="strict" showMessages={false} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole("radio", { name: /ゆるモード/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "記録中、たまにひとことを表示する" }));

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("handles native dialog cancellation without saving preferences", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<ModeDialog mode="relaxed" showMessages onSave={onSave} onClose={onClose} />);
    const cancel = new Event("cancel", { cancelable: true });

    fireEvent(screen.getByRole("dialog"), cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("connects the app mode trigger to saved preferences and dismisses the dialog", () => {
    render(<NothingApp />);
    fireEvent.click(screen.getByRole("button", { name: "ゆるモード" }));
    fireEvent.click(screen.getByRole("radio", { name: /厳格モード/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "記録中、たまにひとことを表示する" }));

    fireEvent.click(screen.getByRole("button", { name: "このモードにする" }));

    expect(timer.setPreferences).toHaveBeenCalledExactlyOnceWith("strict", false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("weekly records and achievements", () => {
  it("offers an accessible seven-day empty table, locked badges, and a first-session action", () => {
    const onExport = vi.fn();
    const onStart = vi.fn();
    render(<RecordsPanel records={[]} now={NOW} onExport={onExport} onStart={onStart} />);

    expect(weekRows()).toEqual([
      ["2026-08-24", "0秒"], ["2026-08-25", "0秒"], ["2026-08-26", "0秒"],
      ["2026-08-27", "0秒"], ["2026-08-28", "0秒"], ["2026-08-29", "0秒"], ["2026-08-30", "0秒"],
    ]);
    expect(screen.getByText("まだ、まっさら。最初の余白をつくってみましょう。")).toBeDefined();
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByRole("article", { name: "小休止、10秒、未解除" })).toBeDefined();
    expect(screen.getByRole("article", { name: "虚無マスター、1時間、未解除" })).toBeDefined();
    const exportButton = screen.getByRole("button", { name: "CSV出力" }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    fireEvent.click(exportButton);
    expect(onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "はじめての何もしないへ" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("renders midnight-split daily totals and unlocks badges from the longest individual session", () => {
    const records = [
      makeSession({ id: "ten-minutes", startedAt: new Date(2026, 7, 27, 11).getTime(), endedAt: new Date(2026, 7, 27, 11, 10).getTime(), durationMs: 600_000 }),
      makeSession({ id: "midnight", startedAt: new Date(2026, 7, 26, 23, 59, 30).getTime(), endedAt: new Date(2026, 7, 27, 0, 1).getTime(), durationMs: 90_000, mode: "strict", reason: "keyboard" }),
    ];
    const onExport = vi.fn();
    render(<RecordsPanel records={records} now={NOW} onExport={onExport} onStart={vi.fn()} />);

    expect(weekRows()).toEqual([
      ["2026-08-24", "0秒"], ["2026-08-25", "0秒"], ["2026-08-26", "30秒"],
      ["2026-08-27", "11分"], ["2026-08-28", "0秒"], ["2026-08-29", "0秒"], ["2026-08-30", "0秒"],
    ]);
    expect(screen.getByText("11分 30秒")).toBeDefined();
    expect(screen.getByRole("article", { name: "小休止、10秒、解除済み" })).toBeDefined();
    expect(screen.getByRole("article", { name: "無の入口、1分、解除済み" })).toBeDefined();
    expect(screen.getByRole("article", { name: "何もしないプロ、10分、解除済み" })).toBeDefined();
    expect(screen.getByRole("article", { name: "虚無マスター、1時間、未解除" })).toBeDefined();
    expect(screen.queryByText("まだ、まっさら。最初の余白をつくってみましょう。")).toBeNull();
    const exportButton = screen.getByRole("button", { name: "CSV出力" }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(false);
    fireEvent.click(exportButton);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("downloads a UTF-8 CSV Blob, removes its temporary anchor, and revokes its URL", async () => {
    const blobUrl = "blob:http://localhost/ui-csv";
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue(blobUrl);
    const revokeObjectURL = vi.fn();
    replaceProperty(URL, "createObjectURL", createObjectURL);
    replaceProperty(URL, "revokeObjectURL", revokeObjectURL);
    const downloads: { name: string; href: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, href: this.href, attached: this.isConnected });
    });
    setTimer({ records: [makeSession()] });
    render(<NothingApp />);
    fireEvent.click(screen.getByRole("button", { name: "記録と実績" }));

    fireEvent.click(screen.getByRole("button", { name: "CSV出力" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv;charset=utf-8;");
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain('"記録ID","モード","開始日時（UTC）","終了日時（UTC）","記録時間（秒）","終了理由"\r\n');
    expect(csv).toContain('"ui-session","ゆるモード",');
    expect(csv).toContain(',65,"自分で終了しました"\r\n');
    expect(downloads).toEqual([{ name: "doing-nothing-2026-08-27.csv", href: blobUrl, attached: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(screen.getByText("記録のCSVを書き出しました。")).toBeDefined();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(blobUrl), { timeout: 2_000 });
  });
});

describe("quiet recording and results", () => {
  it("shows a non-announcing timer and a working stop button in relaxed mode", () => {
    setTimer({ phase: "running", elapsedMs: 65_000 });
    render(<NothingApp />);

    const clock = screen.getByRole("timer", { name: "経過時間 1分 5秒" });
    expect(clock.textContent).toBe("01:05");
    expect(clock.getAttribute("aria-live")).toBe("off");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "ダークモードに切り替える" })).toBeNull();
    expect(screen.queryByRole("button", { name: "記録と実績" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "何もしないを終了" }));
    expect(timer.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps strict recording free of stop controls and respects disabled messages", () => {
    setTimer({ phase: "running", mode: "strict", elapsedMs: 12_000, showMessages: false });
    render(<NothingApp />);

    expect(screen.getByRole("timer", { name: "経過時間 12秒" }).textContent).toBe("00:12");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("画面への操作、またはタブ移動で終了します。")).toBeDefined();
    expect(screen.getByText("メッセージの表示はオフです。")).toBeDefined();
    expect(screen.queryByText("その調子。何も進んでいません。")).toBeNull();
  });

  it("provides a cancellable preparation countdown before displaying a recording timer", () => {
    setTimer({ phase: "preparing", mode: "strict", countdown: 2 });
    render(<NothingApp />);

    expect(screen.getByRole("heading", { name: "そっと、手を離しましょう。" })).toBe(document.activeElement);
    expect(screen.getByText("2").getAttribute("role")).toBe("status");
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByText("3秒の準備時間は、記録に含まれません。")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "いったん戻る" }));
    expect(timer.cancel).toHaveBeenCalledTimes(1);
    expect(timer.start).not.toHaveBeenCalled();
  });

  it.each<[EndReason, string]>([
    ["tap", "画面をタップしました"],
    ["mouse", "マウスを操作しました"],
    ["keyboard", "キーボードを操作しました"],
    ["visibility", "タブや画面を切り替えました"],
    ["interrupted", "ページの終了・再読み込みで中断しました"],
  ])("displays the strict %s ending reason and preserves its measured duration", (reason, label) => {
    renderResult(makeSession({ mode: "strict", reason, startedAt: NOW - 12_345, durationMs: 12_345 }));

    const heading = screen.getByRole("heading", { name: "おっと、動きましたね。" });
    expect(heading).toBe(document.activeElement);
    expect(screen.getByLabelText("今回の記録 12秒").textContent).toBe("00:12");
    expect(screen.getByText(label)).toBeDefined();
    expect(screen.getByText("厳格モード")).toBeDefined();
    expect(screen.getByText("終了するまでの時間も、ちゃんと記録しています。")).toBeDefined();
    expect(screen.queryByText("自分で終了しました")).toBeNull();
  });
});
