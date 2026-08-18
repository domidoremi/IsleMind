<p align="center">
  <img src="../../assets/icon.png" width="120" height="120" alt="IsleMind アプリアイコン">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  ローカルファーストでプロバイダーを管理できる Android AI ワークスペース
</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.en.md">English</a> · 日本語
</p>

<p align="center">
  <strong>1.0.16 · Android 116</strong><br>
  <a href="https://github.com/domidoremi/IsleMind/releases">バージョン履歴</a>
</p>

## 製品

IsleMind はモデルプロバイダー、会話、知識、個人コンテキスト、タスクワークフローを管理します。

主要プラットフォーム：Android。

## 機能

- **プロバイダー管理**：API Key、Base URL、プロトコル、モデル、機能スイッチ、モデル検出。
- **モデル互換性**：OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM、OpenAI/Anthropic 互換エンドポイント。
- **会話ワークスペース**：複数会話、ストリーミング応答、推論状態、引用、添付、コピー可能な内容。
- **知識とコンテキスト**：知識文書、個人メモリ、会話コンテキスト、検索インデックス、ローカルモデル。
- **タスクとワークフロー**：ステップ状態、キャンセル、復旧、ツール認可、実行証拠。
- **構造化された作業成果物**：品質ゲート、実行可能なアクション、コピー可能な引き継ぎ、継続プロンプト。
- **操作フィードバック**：Toast、Banner、状態レイヤー、Android 通知、処理中/成功/失敗状態。
- **外観**：ライト、ダーク、カスタムカラー、简体中文、English、日本語。

## データとネットワーク

会話、設定、知識インデックス、個人コンテキスト、プロバイダー設定は既定で端末に保存されます。

ネットワーク機能：

- AI 推論、モデル検出、embedding、文字起こし、音声。
- ローカルモデルリソースの取得。
- GitHub バージョン確認。
- ユーザーが有効にしたネットワークツールと連携。

プロバイダー認証情報はセキュアストレージを使用します。ポータブル JSON エクスポートに API Key は含まれません。

## 開発環境

- [Bun 1.3.14](https://bun.sh/)
- Node.js
- JDK 17
- Android SDK
- Android Platform Tools / ADB
- Android エミュレーターまたは USB デバッグ対応端末

`bun.lock` が依存関係ロックファイルです。

## インストール

```powershell
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

## Android の実行

Metro を起動します：

```powershell
bun run start --localhost
```

端末を接続します：

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <device-name> --no-bundler
```

## よく使うチェック

```powershell
bun run type-check
bun run test:provider-intelligence
bun run test:product-mobile-layout
bun run test:theme-system
```

## 資産とクレジット

- Isle UI は [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) の React Native 適応実装です。上流ライセンス：CC BY-NC 4.0。
- ローカルモデルカタログ：[assets/models/catalog.json](../../assets/models/catalog.json)
- モデル出典とクレジット：[assets/models/NOTICE.md](../../assets/models/NOTICE.md)
- ブランドソース：`assets/brand/source/`
- ランタイムブランド資産：`assets/brand/generated/`
