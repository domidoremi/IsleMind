<p align="center">
  <img src="../../assets/icon.png" width="120" height="120" alt="IsleMind アプリアイコン">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  ローカルファーストで、プロバイダーを自分で管理できる Android AI ワークスペース。
</p>

<p align="center">
  <a href="../../README.md">简体中文</a> · <a href="README.en.md">English</a> · 日本語
</p>

<p align="center">
  <strong>現在のバージョン：1.0.15（Android versionCode 115）</strong><br>
  <a href="https://github.com/domidoremi/IsleMind/releases">バージョンと更新履歴</a>
</p>

> [!IMPORTANT]
> 現在の GitHub Release では APK、チェックサムファイル、その他のビルド成果物を公開していません。Release はソースコードのバージョンを示し、そのバージョンに対応する変更を記録するためのものです。アプリを実行する場合は、ソースからローカルでビルドしてください。

## IsleMind とは

IsleMind は、モデルプロバイダー、会話データ、作業コンテキストを自分で管理したいユーザー向けのアプリです。ホスト型 AI アカウントを提供するのではなく、プロバイダー設定、チャット、知識検索、タスク実行、成果物の受け渡しを一つのモバイルワークスペースにまとめます。

現在の主要な開発・検証対象は **Android** です。リポジトリには Expo の iOS 設定も残していますが、iOS 版を公開済み、または実機回帰テスト済みとは表明していません。

## 主な機能

- **プロバイダーとモデル**：API Key、Base URL、プロトコル、モデル、機能スイッチを設定できます。OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM、および OpenAI/Anthropic 互換エンドポイントのプリセットを用意しています。
- **会話ワークスペース**：複数会話、ストリーミング応答、推論状態、引用、添付、コピー可能な内容を管理し、処理中・成功・失敗を明示します。
- **知識とコンテキスト**：知識文書、個人メモリ、会話コンテキスト、検索インデックスを端末側で管理し、ローカルモデルが利用できない場合も診断可能なフォールバックを維持します。
- **タスクとワークフロー**：長い作業を追跡可能なステップに分け、キャンセル、復旧、ツール認可、実行証拠の境界を保持します。
- **構造化された作業成果物**：モデル応答を納品可能な内容へ整理し、品質ゲート、実行可能なアクション、コピー可能な引き継ぎ、継続プロンプトを提供します。
- **システムフィードバック**：アプリ内 Toast/Banner、状態レイヤー、Android 通知を使い、重要な操作が無通知で成功・失敗しないようにします。

## プライバシーとネットワーク境界

会話、設定、知識インデックス、個人コンテキスト、プロバイダー設定は既定で端末内に保存されます。次のユーザー操作では外部リクエストが発生する場合があります。

- ユーザーが選択した AI プロバイダーへの推論、モデル検出、embedding、文字起こし、音声リクエスト。
- ユーザーが明示的に選択したローカルモデルリソースのダウンロード。
- GitHub 上のリモートバージョン確認。
- ユーザーが明示的に有効化したネットワークツールまたは連携機能の実行。

プロバイダー認証情報はセキュアストレージに保存され、ポータブル JSON エクスポートには書き込まれません。Issue、ログ、スクリーンショットを公開する前に、API Key、トークン、非公開 Base URL、個人情報を必ず除去してください。

## Android をソースから実行する

### 必要な環境

- [Bun 1.3.14](https://bun.sh/)（`bun.lock` が唯一の依存関係ロックファイル）
- Node.js（プロジェクトスクリプトと Expo CLI エントリーポイントで使用）
- JDK 17
- Android SDK、Platform Tools、ADB
- Android エミュレーター、または USB デバッグを有効にした実機

### インストールと起動

```powershell
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

Android 実機を接続した後：

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <device-name> --no-bundler
```

別のターミナルで Metro を起動します：

```powershell
bun run start --localhost
```

USB のリバースポート転送を使用しない場合は、現在のネットワークから端末がアクセスできる開発サーバーアドレスを設定してください。

## 検証

変更範囲に対応するチェックを少なくとも実行してください：

```powershell
bun run type-check
bun run test:provider-intelligence
bun run test:architecture-boundary
bun run test:vnext-architecture-contract
```

Android UI、ネイティブプラグイン、通知、ファイルシステム、パッケージングを変更した場合は、エミュレーターまたは実機での対象別検証も必要です。ソースチェックだけでは実機証拠の代わりになりません。

## アーキテクチャ

IsleMind は vNext 境界へ段階的に移行しています：

```text
app/               Expo Router のルートとページ入口
src/modules/       ビジネス所有者ごとのドメイン／アプリケーションモジュール
src/core/          モジュール間で共有する純粋な契約
src/platform/      再利用可能なプラットフォーム基盤
src/bootstrap/     Composition Root と具体アダプターのバインド
src/presentation/  プレゼンテーションコントローラーと ViewModel
src/components/    React Native コンポーネント
plugins/           Expo／Android ネイティブ設定プラグイン
assets/            ランタイム資産、ブランドソース、モデルカタログ
scripts/           検証、監査、ビルド、証拠収集スクリプト
```

アーキテクチャを変更する前に、次の文書を確認してください：

- [vNext アーキテクチャ・リファクタリング計画](../architecture/islemind-vnext-architecture-refactor-plan.md)
- [vNext モジュール公開 API](../architecture/vnext-module-public-api.md)
- [現在の vNext 移行状況](../architecture/vnext-migration-status.md)

新しいビジネス動作は所有元の `src/modules/<owner>/` に実装します。モジュール間 import は所有モジュールの公開エントリーポイントだけを使用してください。具体アダプターは `src/bootstrap/` でバインドし、`src/services/` は削除条件が明確な旧互換境界としてのみ扱います。

## バージョンと Release

- プロジェクトでは単一の [Semantic Versioning](https://semver.org/) バージョンを使用します。
- `package.json`、`app.json`、Git Tag は一致させ、Tag は `vX.Y.Z` 形式にします。
- `0.x.x` は初期の段階的プレリリース、`1.x.x` 以降は正式版を表します。
- 各 GitHub Release には、そのバージョンの実際の変更に対応する更新履歴を記載します。
- 現在の GitHub Release はソース版のマーカーのみを公開し、APK、チェックサム、その他のビルド成果物は添付しません。
- バージョン更新によって、インストール済みアプリのローカル会話、知識、メモリ、プロバイダー設定を意図的に消去しません。永続化移行がある場合は別途明記します。

## リポジトリの整理方針

- 製品コード、文書、ランタイム資産は `src/`、`docs/`、`assets/` に置き、リポジトリ直下へ一時スクリーンショットやエクスポートを置かないでください。
- ローカルログ、テストレポート、Playwright 出力、スクリーンショット、APK、AAB、一時証拠は ignore 対象の場所に保存します。
- API Key、署名鍵、トークン、非公開設定、機密情報を含む端末ログ、ダウンロードキャッシュをコミットしないでください。
- 資産を削除する前に、ランタイム、ビルドスクリプト、文書から参照されていないことを確認します。保存すべきデザインソースは、明確に命名した `assets/brand/source/` に置きます。
- 依存関係のインストールには Bun を使い、他のパッケージマネージャーのロックファイルを生成・コミットしないでください。

## 資産とクレジット

- Isle UI は [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) の React Native 向け適応実装です。上流は `guokaigdg` により CC BY-NC 4.0 で公開されています。IsleMind は上流の React DOM パッケージ、CSS、フォント、画像資産を直接同梱しません。
- 任意のローカルモデルは [assets/models/catalog.json](../../assets/models/catalog.json) に記録し、出典とクレジットは [assets/models/NOTICE.md](../../assets/models/NOTICE.md) に記載しています。
- 現在のブランドソースは `assets/brand/source/`、ランタイム用の生成資産は `assets/brand/generated/` と Expo アイコン用パスに配置しています。

## コントリビューション

報告を作成する前に既存の [Issues](https://github.com/domidoremi/IsleMind/issues) を検索してください。再現手順、プラットフォーム／端末、アプリバージョン、機密情報を除去したログを含めてください。アーキテクチャや永続化を変更する場合は、互換性、移行、ロールバック境界も説明してください。
