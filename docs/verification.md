# 公開・検証記録

確認日：2026年8月27日（日本時間）

この文書は、確認済みのローカル検証・サービス設定と、未確認の公開作業を分けて記録するものです。Vercelの本番デプロイ、公開UIの実ブラウザー確認、スクリーンショット5枚の撮影・保存・目視確認は完了しました。GitHubの初回pushとAnalyticsの有効化・集計は後述の状態です。未確認の項目は完了として扱っていません。

## ローカル自動検証：確認済み

| コマンド | 結果 | 確認範囲 |
| --- | --- | --- |
| `npm run lint` | 成功 | ESLint、警告上限0件 |
| `npm run typecheck` | 成功 | Next.jsの型生成とTypeScript検査 |
| `npm test` | 成功 | Vitest 5ファイル、203件すべて成功 |
| `npm run secret-scan` | 成功 | 45テキストファイルを検査。6バイナリ／大容量ファイルは除外。検知ルールの自己テストも成功 |
| `npm audit` | 検出脆弱性0件 | 検査時点の依存関係に対するnpmの既知脆弱性情報 |
| `npm run build` | 成功 | Next.jsの本番ビルド |

上記のlint・型検査・203件のテスト・Secret Scan・ビルドは、最終の再実行でも成功しました。ファイル数は本書を含む確認時点の値です。追加修正後は必要な検証を再実行し、結果を更新してください。

テストには集計・実績の境界、保存、タイマーの状態遷移、Service Worker、共有・CSV・モード選択・週間記録のUI検証を含みます。UI検証ではjsdomやブラウザーAPIのモックを使用しており、実機の共有先への投稿や公開環境でのAnalytics収集まで確認したものではありません。

Secret Scanは既知の秘密情報パターンの補助検査です。バイナリ、スクリーンショット、Gitの過去履歴などは対象外です。また、`npm audit` の0件は未知の脆弱性が存在しないことを保証しません。詳細は [security.md](security.md) を参照してください。

## GitHub・公開環境

<!-- DEPLOYMENT_EVIDENCE_BEGIN: push・公開確認後に事実だけを更新する -->

| 項目 | 状況 |
| --- | --- |
| GitHubリポジトリ | [shunsoco-stack/doing-nothing-timer](https://github.com/shunsoco-stack/doing-nothing-timer) をpublicで作成済み |
| GitHub Secret Scanning | 有効化済み |
| GitHub Push Protection | 有効化済み |
| ソースコードの初回push | 未実施 |
| GitHub Actions | 初回push前のため実行結果は未確認 |
| Vercelデプロイ | 初回の本番ビルド・デプロイが成功。状態は `READY` |
| 公開URL | [doing-nothing-timer.vercel.app](https://doing-nothing-timer.vercel.app)。HTTP応答と実ブラウザーでのUIを確認済み |
| 公開環境での主要操作 | 初期画面、モード選択、厳格モードの計測、キー入力による終了、週間記録・実績の表示を確認済み |
| 公開アプリのスクリーンショット | 指定5画面を公開URLから撮影し、保存・目視確認済み |
| 実ブラウザーのオフライン起動・継続・保存・再読込 | ローカル本番ビルドで確認済み。下記の検証条件を参照 |

<!-- DEPLOYMENT_EVIDENCE_END -->

初回デプロイの識別情報：`dpl_GEHqgfJFaQgshamtKySVMVzTBCkG`。[デプロイ固有URL](https://doing-nothing-timer-omajbh068-shunsoco-stacks-projects.vercel.app)

### 公開HTTP・アセット検証：確認済み

| 検証対象 | 結果 |
| --- | --- |
| 公開ページ・関連URL | 検査した12 URLすべてHTTP 200 |
| 読み込みアセット | JavaScript 10本、CSS 1本がHTTP 200 |
| メタデータ | title、canonical、manifest、OG、Twitter、robots、sitemapの整合を確認 |
| 画像寸法 | OG 1200×630、標準アイコン192×192・512×512、maskable 512×512、Apple用180×180を確認 |
| 配信アセットの同一性 | 8アセットのSHA-256がローカルファイルと一致 |
| セキュリティヘッダー | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、Referrer Policy、Permissions Policy、CSP、HSTSを確認 |
| 本番CSP | `unsafe-eval` を含まないことを確認 |
| Service Workerの配信 | `no-store`、許可スコープ、Service Worker用のCSPを確認 |

HTTP検証の成功は、Analyticsのイベント収集や全端末での挙動を保証するものではありません。

### 実ブラウザーのオフライン検証：確認済み

Next.jsの本番ビルドを `http://127.0.0.1:3048` で起動して確認しました。

1. ゆるモードを開始し、オンラインでの再読み込み後に継続中の記録を復元できることを確認。
2. 検証用サーバーだけを停止し、同じURLへのHTTP接続が失敗することを確認。
3. ブラウザーを再読み込みし、Service Workerのキャッシュから画面と継続中のタイマー（03:44）が復元されることを確認。
4. 03:49で手動終了し、「小休止」「無の入口」の実績解除を確認。
5. サーバー停止のまま再読み込みし、本日の最長・累計・今週の記録が03:49として残ることを確認。

これはアプリの配信元へ接続できない状態での実ブラウザー検証です。端末全体のネットワークを切断した試験ではなく、公開Vercel環境での検証でもありません。

## Analytics：実装と有効化の区別

| 項目 | 状況 |
| --- | --- |
| `session_start` / `session_end` / `achievement_unlock` / `result_share` | SDK実装を確認済み。送信項目は [README](../README.md#analytics) に明記 |
| 送信データの制限 | 終了理由・打鍵内容・記録ID・利用者ID・正確な日時・記録一覧は送信しない実装 |
| 追跡拒否設定 | DNT／GPCを尊重し、イベント送信を抑止する実装 |
| 基本Web Analyticsの有効化 | 未完了。所有者本人によるVercelダッシュボードでの確認操作が必要。操作を依頼済み |
| ページビューの本番収集・表示 | 未確認 |
| カスタムイベントの本番集計 | Hobbyプランでは利用不可。SDK実装をもって集計済みとは扱わない |
| 有料プランへの変更・有料契約 | 行っていない |

カスタムイベントはPro／Enterpriseプラン限定です。基本Web Analyticsの有効化だけでは、Hobbyプランで4種類のイベントを集計できるようにはなりません。所有者による確認や契約上の制約を回避する操作は行いません。[Vercel公式ドキュメント](https://vercel.com/docs/analytics/custom-events)

## 公開アプリのスクリーンショット

<!-- SCREENSHOT_EVIDENCE_BEGIN: 公開アプリで撮影・目視確認した後に更新する -->

5枚とも [公開URL](https://doing-nothing-timer.vercel.app) を実ブラウザーで操作して撮影しました。保存・目視確認が完了し、READMEに埋め込んでいます。記録はUI操作のみで作成しており、localStorageの直接編集や時刻の偽装は行っていません。

| 画面 | 保存先 | 確認内容 |
| --- | --- | --- |
| 初期画面 | `public/screenshots/01-home.jpg` | 記録前、0から始まる初期状態 |
| モード選択 | `public/screenshots/02-modes.jpg` | 厳格／ゆるモードの選択画面 |
| 記録中 | `public/screenshots/03-recording.jpg` | 厳格モードの経過00:20 |
| 厳格モード失敗画面 | `public/screenshots/04-strict-ended.jpg` | キー入力で01:18に終了。「小休止」「無の入口」を解除 |
| 週間記録・実績 | `public/screenshots/05-records.jpg` | 今週の1分18秒と実績2/4を確認 |

<!-- SCREENSHOT_EVIDENCE_END -->

## 残る確認項目

- GitHubへの初回pushと公開したコミットの識別情報。
- GitHub Actionsの実行結果。未確認の場合はそのまま未確認と記載。
- 追加の公開モバイル確認。現時点で実施結果は未確定。
- 基本Web Analyticsが本人の操作で有効化されたかどうか。有効化待ちの場合は制約を残す。

Tsukuttaへの掲載状況は引き続き「未掲載」です。掲載用コピーは [publish-copy.md](publish-copy.md) に分けています。
