# Athletics Performance OS site

このディレクトリは、Google Sheetsの正式データを人間向けに表示する読み取り専用サイトです。

重要な分離原則：

- Google Sheetsは競技・練習データの正本です。
- `ui-layout.json` はサイトの表示順・表示有無・見出し・テーマだけを管理します。
- UI構成をGoogle Sheetsへ保存しません。
- サイトからデータ変更は行いません。提案・追加・変更・修正・削除はChatGPT（apostrophe）を唯一の指示入口として行います。
- UI構成の変更も、ChatGPTでPreviewし、山下祐樹の明示承認後にWorkerがGitHubへ反映します。

## 初期設定

1. `config.example.js` を `config.js` として複製します。
2. `gatewayUrl` を公開済みCloudflare WorkerのHTTPS URLへ変更します。
3. Workerの `APOS_ALLOWED_ORIGINS` にGitHub PagesまたはカスタムドメインのOriginを設定します。
4. 利用者を山下祐樹に限定する場合は、WorkerとサイトのカスタムドメインをCloudflare Accessで保護します。

`config.js` にGateway TokenやGitHub Tokenを入れないでください。ブラウザはCloudflare Access Cookieで読み取りAPIへ接続します。

## 表示構成

`ui-layout.json` の `sections` を並べ替えるとサイトの順番が変わります。`visible: false` で非表示にできます。対応する `type` は次のとおりです。

- `hero`
- `today`
- `week`
- `month`
- `exerciseLibrary`
- `history`
- `measurements`
- `customText`

## ローカル確認

単純な静的サーバーで確認できます。ファイルを直接開く方式ではなく、HTTP経由で開いてください。

```bash
python3 -m http.server 8080 --directory site
```

## 公開

同梱の `.github/workflows/deploy-site.yml` は、`main` ブランチ上の `site/` をGitHub Pagesへ公開します。`ui-layout.json` の承認済み変更がコミットされると、自動的に新しい表示へ更新されます。
