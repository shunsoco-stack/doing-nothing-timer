# 公開・検証記録

確認日：2026年8月27日（日本時間）

この文書は、確認済みの検証と残るサービス上の制約を分けて記録するものです。GitHubへのソース公開、CI、Vercel本番公開、公開UI・モバイル表示の確認、スクリーンショット5枚の保存・目視確認は完了しました。残件はAnalyticsの有効化・プラン制限と、任意のGit自動デプロイ連携です。

本書の実装検証対象はコミット `67e0753` です。後続のドキュメントだけの更新は、この検証対象を変更しません。[対象実装の成功CI](https://github.com/shunsoco-stack/doing-nothing-timer/actions/runs/33070513976)

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
| GitHubリポジトリ | [shunsoco-stack/doing-nothing-timer](https://github.com/shunsoco-stack/doing-nothing-timer) にソースコードを公開済み |
| GitHub Secret Scanning | 有効化済み。確認時点の未解決アラート0件 |
| GitHub Push Protection | 有効化済み |
| ソースコードのpush | `main` と `origin/main` が実装コミット `67e0753` で一致することを確認済み |
| GitHub Actions | [run 33070513976](https://github.com/shunsoco-stack/doing-nothing-timer/actions/runs/33070513976) が成功。lint・型検査・203件のテスト・Secret Scan・ビルドを確認 |
| Vercelデプロイ | 最終の本番デプロイが成功。状態は `READY` |
| 公開URL | [doing-nothing-timer.vercel.app](https://doing-nothing-timer.vercel.app)。HTTP応答と実ブラウザーでのUIを確認済み |
| 公開環境での主要操作 | 両モード、再読込からの復元、手動終了、厳格モードのキー／マウスによる終了、週間記録・実績を確認済み |
| 公開モバイル表示 | 幅320px／390px、ライト／ダークを確認。横方向のはみ出しなし |
| 公開アプリのスクリーンショット | 指定5画面を公開URLから撮影し、保存・目視確認済み |
| 実ブラウザーのオフライン起動・継続・保存・再読込 | ローカル本番ビルドで確認済み。下記の検証条件を参照 |
| Gitからの自動デプロイ | 未接続であることを設定情報で確認。通常のCLI接続操作では連携できず、現在はCLIで公開する運用 |

<!-- DEPLOYMENT_EVIDENCE_END -->

最終確認した本番デプロイ：`dpl_3ivTnBgz4KnNgBuM3EDfQYCUu7CN`。[デプロイ固有URL](https://doing-nothing-timer-n63mvclm2-shunsoco-stacks-projects.vercel.app)

GitHub Actionsは品質検証のみを行います。Gitへのpushだけで自動公開される設定にはなっていません。更新公開の手順は [README](../README.md) の「公開・更新方法」を参照してください。

### 公開HTTP・アセット検証：確認済み

| 検証対象 | 結果 |
| --- | --- |
| 公開ページ・関連URL | 検査した12 URLすべてHTTP 200 |
| 読み込みアセット | JavaScript 10本、CSS 1本がHTTP 200 |
| メタデータ | title、canonical、manifest、OG、Twitter、robots、sitemapの整合を確認 |
| 画像寸法 | OG 1200×630、標準アイコン192×192・512×512、maskable 512×512、Apple用180×180を確認 |
| 配信アセットの同一性 | 8アセットのSHA-256がローカルファイルと一致 |
| 公開スクリーンショット | 5 URLすべてHTTP 200・`image/jpeg`。SHA-256がローカルの画像と一致 |
| セキュリティヘッダー | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、Referrer Policy、Permissions Policy、CSP、HSTSを確認 |
| 本番CSP | `unsafe-eval` を含まないことを確認 |
| Service Workerの配信 | `no-store`、許可スコープ、Service Worker用のCSPを確認 |

HTTP検証の成功は、Analyticsのイベント収集や全端末での挙動を保証するものではありません。

### 公開UI・モバイル表示の追加検証：確認済み

- ゆるモード開始後、再読み込みで経過29秒の記録が復元され、そのまま計測が続くことを確認。マウス操作でも終了しないことを確認。
- 経過48秒で手動終了し、再読み込み後も本日の最長01:18、累計・今週02:06、記録2件が残ることを確認。この値は当該検証時点のものです。
- 厳格モードはマウス移動で終了し、「マウスを操作しました」と理由を表示することを確認。キー入力による終了はスクリーンショット撮影時にも確認済み。
- 実ブラウザーの幅320px／390pxでライト／ダーク表示を確認し、横方向のはみ出しがないことを確認。
- 最終デプロイ後、ヘッダーの4ボタンすべての高さが44pxであることを確認。
- 確認したブラウザー操作中のエラー・警告は0件。

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
| 基本Web Analyticsの有効化 | 未完了。`enabledAt`・`disabledAt` ともに `null`。所有者本人によるVercelダッシュボードでの確認操作が必要で、操作を依頼済み |
| ページビューの本番収集・表示 | 未確認 |
| カスタムイベントの本番集計 | Hobbyプランでは利用不可。SDK実装をもって集計済みとは扱わない |
| 有料プランへの変更・有料契約 | 行っていない |

カスタムイベントはPro／Enterpriseプラン限定です。基本Web Analyticsの有効化だけでは、Hobbyプランで4種類のイベントを集計できるようにはなりません。所有者による確認や契約上の制約を回避する操作は行いません。[Vercel公式ドキュメント](https://vercel.com/docs/analytics/custom-events)

## 公開アプリのスクリーンショット

<!-- SCREENSHOT_EVIDENCE_BEGIN: 公開アプリで撮影・目視確認した後に更新する -->

5枚とも [公開URL](https://doing-nothing-timer.vercel.app) を実ブラウザーで操作して撮影しました。保存・目視確認が完了し、READMEに埋め込んでいます。記録はUI操作のみで作成しており、localStorageの直接編集や時刻の偽装は行っていません。

撮影時の出典は初回デプロイ `dpl_GEHqgfJFaQgshamtKySVMVzTBCkG` です。[撮影時のデプロイURL](https://doing-nothing-timer-omajbh068-shunsoco-stacks-projects.vercel.app)。画像の実形式に合わせ、5枚とも拡張子を `.jpg` に統一しました。画像本体のバイト列は変更していません。最終公開の5画像はHTTP 200・`image/jpeg` で配信され、ローカル画像とSHA-256が一致することを確認しています。

| 画面 | 保存先 | 確認内容 |
| --- | --- | --- |
| 初期画面 | `public/screenshots/01-home.jpg` | 記録前、0から始まる初期状態 |
| モード選択 | `public/screenshots/02-modes.jpg` | 厳格／ゆるモードの選択画面 |
| 記録中 | `public/screenshots/03-recording.jpg` | 厳格モードの経過00:20 |
| 厳格モード失敗画面 | `public/screenshots/04-strict-ended.jpg` | キー入力で01:18に終了。「小休止」「無の入口」を解除 |
| 週間記録・実績 | `public/screenshots/05-records.jpg` | 今週の1分18秒と実績2/4を確認 |

<!-- SCREENSHOT_EVIDENCE_END -->

## 残る制約・任意の設定

- 基本Web Analytics：所有者本人による有効化待ち。本番のページビュー収集・表示は未確認。
- カスタムイベント集計：Hobbyでは利用不可。Pro／Enterpriseの機能であり、有料プランへ変更していません。
- Git自動デプロイ連携：任意の未設定項目。CLIでの本番公開は正常で、アプリの利用には影響しません。

Tsukuttaへの掲載状況は引き続き「未掲載」です。掲載用コピーは [publish-copy.md](publish-copy.md) に分けています。
