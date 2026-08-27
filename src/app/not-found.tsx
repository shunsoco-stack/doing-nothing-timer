import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found">
      <span className="eyebrow">404 · NOTHING HERE.</span>
      <h1>
        ここには、本当に
        <br />
        何もありません。
      </h1>
      <p>何もしない記録は、こちらにあります。</p>
      <Link className="primary-button" href="/">
        タイマーに戻る
      </Link>
    </main>
  );
}
