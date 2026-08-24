<p align="center">
  <img src="../../assets/icon.png" width="120" height="120" alt="IsleMind アプリアイコン">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  ローカルファーストで、プロバイダーを自分で管理できる Android AI ワークスペース
</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.en.md">English</a> · 日本語
</p>

## IsleMind とは

IsleMind は、モデルプロバイダー、会話、ナレッジとメモリ、エージェントタスク、ツール連携を一つにまとめたモバイルワークスペースです。Android を主要プラットフォームとし、ローカルデータの所有権、明確なネットワーク境界、復旧可能な AI 実行を重視しています。

## 主な機能

- **モデルプロバイダー管理**：API Key、Base URL、プロトコル、モデル、機能スイッチを設定できます。モデル検出、一括インポート、利用可否の確認、使用量照会、ランタイム診断にも対応します。
- **幅広いプロトコル互換性**：OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM、および OpenAI 互換・Anthropic 互換の中継エンドポイントを利用できます。
- **会話ワークスペース**：複数の会話、ストリーミング返信、推論状態、出典、添付ファイル、下書き、メッセージ操作、生成状態をまとめて管理します。
- **ナレッジと個人コンテキスト**：ナレッジ文書を取り込み、個人メモリと会話コンテキストを管理し、ローカルインデックスと embedding モデルで検索拡張を行います。
- **エージェントとタスク実行**：ステップ状態、キャンセルと復旧、ツール認可、実行証跡を扱います。構造化された作業成果物には、品質ゲート、コピー可能な引き継ぎ、継続プロンプトが含まれます。
- **ツールと連携**：MCP、Skills、内蔵ワークスペースツール、Web 検索、音声、Android 端末機能に対応します。ネットワーク機能はユーザーが設定または明示的に有効化します。
- **テーマと言語**：ミニマル、モネ、Material 3、リキッドグラスの各テーマで、ライト、ダーク、システム連動、カスタムアクセントを選べます。画面表示は簡体中文、English、日本語に対応します。
- **Android 体験**：セーフエリアとキーボードへの対応、バックグラウンド状態通知、アプリ内更新確認、ランタイム診断、復旧用の導線を備えています。

## データとネットワークの境界

会話、設定、ナレッジインデックス、個人コンテキスト、プロバイダー設定は、既定で端末内に保存されます。プロバイダーの認証情報にはシステムのセキュアストレージを使用し、ポータブル JSON エクスポートに API Key は含まれません。

次の操作ではネットワークに接続します。

- AI 推論、モデル検出、embedding、文字起こし、音声サービス
- ローカルモデル用リソースのダウンロード
- ユーザーが有効にしたネットワークツール、MCP サーバー、外部サービス連携

## 開発環境

- [Bun 1.3.14](https://bun.sh/)（依存関係の導入とスクリプト実行）
- Node.js（一部のプロジェクトスクリプト用）
- JDK 17
- Android SDK
- Android Platform Tools / ADB
- Android エミュレーター、または USB デバッグを有効にした端末

`bun.lock` が正式な依存関係ロックファイルです。別のパッケージマネージャーで依存関係を更新しないでください。

## ソースコードの取得

```powershell
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

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
docs/             アーキテクチャ、移行状況、多言語ドキュメント
```

アーキテクチャ境界は、[IsleMind アーキテクチャ](../architecture/architecture.md)と[モジュール公開 API](../architecture/module-public-api.md)で定義されています。

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
- ローカルモデルカタログ：[assets/models/catalog.json](../../assets/models/catalog.json)
- モデルの出典とクレジット：[assets/models/NOTICE.md](../../assets/models/NOTICE.md)
- ブランドソース：`assets/brand/source/`
- ランタイム用ブランドアセット：`assets/brand/generated/`
