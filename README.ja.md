<p align="center">
  <img src="assets/icon.png" width="120" height="120" alt="IsleMind アプリアイコン">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  ローカルファーストで、プロバイダーを自分で管理できる Android AI ワークスペース
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">简体中文</a> · 日本語
</p>

## IsleMind とは

IsleMind は、モデルプロバイダー、会話、ナレッジとメモリ、エージェントタスク、ツール連携を一つにまとめたモバイルワークスペースです。Android を主要プラットフォームとし、ローカルデータの所有権、明確なネットワーク境界、復旧可能な AI 実行を重視しています。

## 主な機能

- **モデルプロバイダー管理**－API Key、Base URL、プロトコル、モデル、機能スイッチを設定できます。モデル検出、一括インポート、利用可否の確認、使用量照会、ランタイム診断にも対応します。
- **幅広いプロトコル互換性**－OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM、および OpenAI 互換・Anthropic 互換の中継エンドポイントを利用できます。
- **会話ワークスペース**－複数の会話、ストリーミング返信、推論状態、出典、添付ファイル、下書き、メッセージ操作、生成状態をまとめて管理します。
- **ナレッジと個人コンテキスト**－ナレッジ文書を取り込み、個人メモリと会話コンテキストを管理し、ローカルインデックスと embedding モデルで検索拡張を行います。
- **エージェントとタスク実行**－ステップ状態、キャンセルと復旧、ツール認可、実行証跡を扱います。構造化された作業成果物には、品質ゲート、コピー可能な引き継ぎ、継続プロンプトが含まれます。
- **ツールと連携**－MCP、Skills、内蔵ワークスペースツール、Web 検索、音声、Android 端末機能に対応します。ネットワーク機能はユーザーが設定または明示的に有効化します。
- **テーマと言語**－ミニマル、モネ、Material 3、リキッドグラス、Animal Island UI の各テーマで、ライト、ダーク、システム連動、カスタムアクセントを選べます。画面表示は簡体中文、English、日本語に対応します。
- **Android 体験**－セーフエリアとキーボードへの対応、バックグラウンド状態通知、アプリ内更新確認、ランタイム診断、復旧用の導線を備えています。

## データとネットワークの境界

会話、設定、ナレッジインデックス、個人コンテキスト、プロバイダー設定は、既定で端末内に保存されます。プロバイダーの認証情報にはシステムのセキュアストレージを使用し、ポータブル JSON エクスポートに API Key は含まれません。

次の操作ではネットワークに接続します。

- AI 推論、モデル検出、embedding、文字起こし、音声サービス
- ローカルモデル用リソースのダウンロード
- GitHub バージョンチェック
- ユーザーが有効にしたネットワークツール、MCP サーバー、外部サービス連携

## ダウンロード

| 項目 | 値 |
|---|---|
| バージョン | `1.1.2` |
| Android ビルド番号 | `127` |
| チャンネル | プレビュー |

[更新内容とダウンロードを確認](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.2)。APK と `.sha256` チェックサムは、利用可能になり次第 Release ページに添付されます。プレビュー版はテスト向けです。インストール前にデータをバックアップしてください。

### 主な変更

- 応答の処理ステップと完了状態を見やすく改善。
- モデル可用性画面の読み込みを改善。
- Android 起動画面の配色とリキッドガラス入力欄の表示を調整。

### APK バリアント

- `no-model`－既定のビルドです。ローカル embedding モデルを含まず、全文検索は利用できます。
- `with-model-small`－標準の小型 RAG embedding モデルを含み、対象端末でのネイティブ検証が必要です。
- 多言語 embedding は **EXPERIMENTAL / OPT-IN（実験的・明示的な有効化が必要）** で、既定候補の適格性検証を妨げません。
- アーキテクチャ別 APK と `universal-64` は、Release に対応する APK と `.sha256` が実際に添付されている場合のみダウンロードできます。

## 開発環境

- [Bun 1.4.2](https://bun.sh/)（依存関係の導入とスクリプト実行）
- Node.js（一部のプロジェクトスクリプト用）
- JDK 25
- Android SDK
- Android Platform Tools / ADB
- Android エミュレーター、または USB デバッグを有効にした端末

`bun.lock` が正式な依存関係ロックファイルです。別のパッケージマネージャーで依存関係を更新しないでください。

## ソースコードの取得

```powershell
git clone --branch rn https://github.com/domidoremi/animal-island-ui.git
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

RN テーマ fork は IsleMind と同じ親ディレクトリに配置します。`bun install` がリンクと型宣言のビルドを行います。汎用テーマ修正は fork 側で行い、IsleMind に再移植しません。[UI 連携](src/components/ui/isle/README.md)に責務と CI/EAS の設定を記載しています。

## Android で実行

Metro を起動します。

```powershell
bun run start --localhost
```

Android 端末を接続してアプリを起動します。

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <device-name> --no-bundler
```

## リポジトリ構成

```text
app/              Expo Router の画面とルート入口
src/core/         共有される純粋な型、プロトコル、基礎契約
src/modules/      ビジネスモジュールと公開 API
src/platform/     ストレージ、ネットワーク、ネイティブ環境のアダプター
src/bootstrap/    依存関係の配線とランタイムの合成ルート
src/presentation/ 表示層コントローラーとユースケースの橋渡し
src/components/   React Native の UI コンポーネント
scripts/          テスト、監査、診断、ローカル配布用スクリプト
plugins/          リポジトリ内の Expo・Android ネイティブプラグイン
docs/             アーキテクチャ、公開 API、技術判断
```

[ドキュメント索引](docs/README.md)から、アーキテクチャ、モジュール公開 API、検証要件、技術判断を参照できます。

## よく使う検証コマンド

```powershell
bun run type-check
bun run test:architecture-boundary
bun run test:architecture-contract
bun run test:walking-skeleton
bun run test:task-runtime
bun run test:provider-intelligence
bun run test:product-mobile-layout
```

## アセットとクレジット

- Isle UI は [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) を React Native 向けに適応した実装です。上流ライセンスは CC BY-NC 4.0 です。
- ローカルモデルカタログ：[assets/models/catalog.json](assets/models/catalog.json)
- モデルの出典とクレジット：[assets/models/NOTICE.md](assets/models/NOTICE.md)
- ブランドソース：`assets/brand/source/`
- ランタイム用ブランドアセット：`assets/brand/generated/`
