"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="not-found">
      <span className="eyebrow">A LITTLE PAUSE.</span>
      <h1>ちょっと、ひと休み。</h1>
      <p>
        画面を表示できませんでした。保存済みの記録はこの端末に残っています。
      </p>
      <button className="primary-button" onClick={reset}>
        もう一度ひらく
      </button>
    </main>
  );
}
