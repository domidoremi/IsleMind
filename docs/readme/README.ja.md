<p align="center">
  <img src="../../assets/icon.png" width="120" height="120" alt="IsleMind app icon">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  プライベートなプロバイダー設定、知識支援チャット、個人コンテキスト、構造化された作業成果物のためのローカルファーストなモバイル AI ワークスペースです。
</p>

<p align="center">
  <a href="../../README.md">简体中文</a> | <a href="README.en.md">English</a> | 日本語
</p>

<p align="center">
  <a href="https://github.com/domidoremi/IsleMind/releases/latest">最新 APK</a>
  ·
  <a href="../production-qa-matrix.md">リリース検収</a>
</p>

## 能力境界

IsleMind は、会話、設定、コンテキスト索引、Agentic RAG 索引、プロバイダー設定を既定で端末上に保存します。データの端末外送信は、次のユーザー操作をトリガー条件とします。

- ユーザーが設定済み AI プロバイダーを選択し、推論、embedding、文字起こし、音声、またはモデル検出を実行する。
- ユーザーが JSON データをエクスポートまたはインポートする。
- ユーザーがローカル RAG モデルをダウンロード、検証、または有効化する。
- ユーザーが Android システムインストーラー経由で GitHub Release APK をインストールする。

SecureStore に保存されたプロバイダー Key は JSON エクスポートへ書き込まれません。既定 APK はモデル重みを同梱しません。ローカルモデルは、内蔵 catalog またはユーザーが明示的に選択したダウンロードフローから取得する必要があります。

## ユーザー経路

| シナリオ | 既定動作 | 出力 |
| --- | --- | --- |
| プロバイダー設定 | ユーザーが API Key、Base URL、モデル、能力スイッチを入力する | チャット、モデル検出、ランタイム診断で使用できるプロバイダー設定 |
| チャット開始 | アプリが現在のセッション、個人コンテキスト、知識検索結果、モデル設定を読み取る | AI 応答、引用、token 使用記録、コピー可能な内容 |
| 知識インポート | Agentic RAG が分割、索引化、ハイブリッド検索、ローカル rerank を実行する | 参照可能な知識索引と検索証拠 |
| 作業成果物生成 | アプリがモデル応答を構造化された納品内容へ変換する | 品質ゲート、実行可能なアクション、コピー可能な引き継ぎ、継続プロンプト |
| Android 更新 | アプリが GitHub Release APK を確認し、システムインストーラーを開く | ユーザー確認後のコールドアップデート |

## ダウンロードと APK 変体

[GitHub Releases](https://github.com/domidoremi/IsleMind/releases/latest) から Android APK をダウンロードしてください。

ローカルモデル変体：

- `no-model`: 既定ビルド。ローカルモデルファイルを同梱しません。
- `with-model-small`: ローカル embedding 用に `all-MiniLM-L6-v2` を同梱します。

Android アーキテクチャ変体：

- `arm64-v8a`: 64-bit ARM 端末。
- `x86_64`: 64-bit x86 端末。
- `universal-64`: 64-bit ARM と 64-bit x86 のネイティブライブラリを含みます。
- `armeabi-v7a-legacy`: 旧 32-bit ARM 端末専用です。

`no-model` APK をインストールしている場合でも、アプリ内のローカルモデル画面から RAG モデルをダウンロード、検証、有効化できます。

## リスク制御

- プロバイダーリクエストはユーザー設定から発火する必要があります。利用可能なプロバイダーがない場合、アプリはローカル設定状態を維持します。
- ローカルモデルが欠落または利用不可の場合、検索は hash embedding へフォールバックします。
- Android 更新には Android システムインストーラーの確認が必要です。アプリは APK をサイレントに置き換えません。
- `universal-64` は `arm64-v8a` と `x86_64` を含みます。`armeabi-v7a-legacy` は旧 32-bit 端末を対象とし、Android 16 の 64-bit page-size 検証対象ではありません。

## 失敗時の動作

- AI プロバイダーが到達不能、Key が無効、または要求された能力に未対応の場合、チャットランタイムはユーザー入力を破棄せず、診断可能な状態を返す必要があります。
- RAG モデルファイルが欠落している場合、ローカルモデル画面はダウンロードと検証の入口を保持し、検索フローはフォールバック経路を保持する必要があります。
- APK ダウンロードが失敗した場合、インストール済みバージョンは変更されません。インストールの有効化にはシステムインストーラーの確認が必要です。

## 資産と帰属表示

- Isle UI は `animal-island-ui` の React Native 適配実装です。上流プロジェクトは `guokaigdg` により公開され、MIT ライセンスです：<https://github.com/guokaigdg/animal-island-ui>。
- 既定 APK はモデル重みを含みません。任意モデルは `assets/models/catalog.json` に記録され、出典と attribution は `assets/models/NOTICE.md` に記録されています。
- アプリアイコン源画像は `assets/brand/source/isle-pet-preview-base.png` に保存されています。生成資産は黄色背景を削除し、`assets/` と Android launcher リソースディレクトリへ出力します。

## 技術スタック

- アプリ実行環境：[Expo SDK](https://docs.expo.dev/)、[React Native](https://reactnative.dev/)、[React](https://react.dev/)、[Expo Router](https://docs.expo.dev/router/introduction/)、[TypeScript](https://www.typescriptlang.org/)。
- モバイル対象：[Android APK](https://developer.android.com/build/building-cmdline)、[EAS](https://docs.expo.dev/eas/) 設定、[Expo iOS metadata](https://docs.expo.dev/versions/latest/config/app/)。
- UI とモーション：[NativeWind](https://www.nativewind.dev/)、[Tailwind CSS](https://tailwindcss.com/)、[Isle UI](../../src/components/ui/isle/README.md)、[lucide-react-native](https://lucide.dev/)、[moti](https://moti.fyi/)、[React Native Reanimated](https://docs.swmansion.com/react-native-reanimated/)、[Gesture Handler](https://docs.swmansion.com/react-native-gesture-handler/)、[Safe Area Context](https://github.com/AppAndFlow/react-native-safe-area-context)、[Screens](https://github.com/software-mansion/react-native-screens)、[SVG](https://github.com/software-mansion/react-native-svg)、[Expo Blur](https://docs.expo.dev/versions/latest/sdk/blur-view/)。
- ローカル保存と端末 API：[AsyncStorage](https://react-native-async-storage.github.io/async-storage/)、[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)、[Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)、[Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)、[Expo Document Picker](https://docs.expo.dev/versions/latest/sdk/document-picker/)、[Expo Image Picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/)、[Expo Clipboard](https://docs.expo.dev/versions/latest/sdk/clipboard/)、[Expo Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/)、[Expo Application](https://docs.expo.dev/versions/latest/sdk/application/)、[Expo Constants](https://docs.expo.dev/versions/latest/sdk/constants/)、[Expo Haptics](https://docs.expo.dev/versions/latest/sdk/haptics/)、[Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/)、[Expo Speech](https://docs.expo.dev/versions/latest/sdk/speech/)。
- AI プロバイダー実行環境：[OpenAI](https://platform.openai.com/docs/)、[Anthropic](https://docs.anthropic.com/)、[Google Gemini](https://ai.google.dev/gemini-api/docs)、[Xiaomi MiMo](https://mimo.mi.com/)、[OpenAI-compatible providers](https://platform.openai.com/docs/api-reference)、[カスタム互換エンドポイント](https://platform.openai.com/docs/api-reference)、[DeepSeek](https://api-docs.deepseek.com/)、[DashScope/Qwen](https://www.alibabacloud.com/help/en/model-studio/use-qwen-by-calling-api)、[Zhipu/GLM](https://docs.bigmodel.cn/)、[xAI](https://docs.x.ai/)、[OpenRouter](https://openrouter.ai/docs/api/reference)、[NewAPI](https://docs.newapi.pro/)、[OneAPI](https://github.com/songquanpeng/one-api)、[Sub2API](https://sub2api.info/) プリセット。
- 検索とローカルモデル：Agentic RAG、[ONNX Runtime React Native](https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html)、[local embedding model catalog](../../assets/models/catalog.json)、モデルダウンロード検証、[Xenova](https://huggingface.co/Xenova) と [BAAI](https://huggingface.co/BAAI) のモデルソース、hash embedding fallback。
- 多言語：[i18next](https://www.i18next.com/)、[React i18next](https://react.i18next.com/)、[Expo Localization](https://docs.expo.dev/versions/latest/sdk/localization/)、`zh-CN`、`en`、`ja` リソースファイル。
