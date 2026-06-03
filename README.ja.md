# IsleMind

[English](README.md) | [简体中文](README.zh-CN.md) | 日本語

IsleMind は、集中した会話、プライベートなプロバイダー設定、再利用できる個人コンテキスト、知識支援チャットのためのローカルファーストなモバイル AI ワークスペースです。

## 特長

- 任意の AI プロバイダーとモデルでチャットできます。
- AI の回答を、品質ゲート、実行可能なアクション、コピー可能な引き継ぎ、継続プロンプトを備えた構造化作業成果に変換できます。
- 会話、設定、ローカルコンテキストを端末上に保存します。
- Agentic RAG で知識をインポートできます。ハイブリッド検索、セマンティック分割、ローカル rerank、引用、フォールバックに対応します。
- 任意のローカル embedding モデルをアプリ内でダウンロードできます。モデルがない場合は hash embedding にフォールバックします。
- モデル出力のソース、検索、処理情報を確認できます。
- Android 版は GitHub Release APK から更新できます。

## ダウンロード

[GitHub Releases](https://github.com/domidoremi/IsleMind/releases/latest) から最新の Android APK をダウンロードし、端末にインストールしてください。Release notes には各 APK バージョンへの直接リンクを載せています。

現在のアプリバージョン: `1.0.6`。

Release APK はローカルモデルの有無で分かれます。

- `no-model`: 既定ビルド。ローカルモデルファイルを同梱しません。
- `with-model-small`: ローカル embedding 用に `all-MiniLM-L6-v2` のみを同梱します。

Release APK は Android アーキテクチャ別にも分かれます。

- `arm64-v8a`: 64-bit ARM 端末向けです。
- `x86_64`: 64-bit x86 端末向けです。
- `universal-64`: 64-bit ARM と 64-bit x86 のネイティブライブラリを含みます。
- `armeabi-v7a-legacy`: 旧 32-bit ARM 端末専用です。

アプリ内のローカルモデル画面から、RAG モデルのダウンロード、検証、有効化もできます。

## Android 16 KB Page Size

Release ビルドでは `bun run apk:validate-16kb` を実行し、`zipalign -P 16` で APK ZIP page alignment を確認し、`llvm-readelf` で native library の ELF `LOAD` segment alignment を確認します。ZIP alignment は Android ビルドで制御できますが、ELF alignment は Expo、React Native、ONNX Runtime などの依存関係が配布するネイティブライブラリに依存します。検証で第三者 `.so` が 4 KB `LOAD` alignment と報告された場合は、その依存関係を更新または再ビルドしてから Android 16 KB page-size 端末への完全対応としてください。

現在の Release packaging では、`arm64-v8a` と `x86_64` のみから `universal-64` を生成するため、メインの universal APK には 32-bit ネイティブライブラリが含まれません。個別の `armeabi-v7a-legacy` APK は旧 32-bit 端末向けにのみ残し、Android 16 の 64-bit page-size 検証対象には含めません。

## ローカル RAG モデル

IsleMind の既定 APK にはモデル重みは含まれません。任意のローカルモデルは `assets/models/catalog.json` に記録され、モデルの出典と attribution は `assets/models/NOTICE.md` に記載されています。

現在の catalog には、Xenova が Hugging Face で公開している ONNX 配布版を登録しています。上流モデルファミリーは `sentence-transformers` と BAAI です。モデルファイルは IsleMind コントリビューターが作成したものではありません。再配布や商用利用の前に、上流モデルカードとライセンスを確認してください。

## プライバシー

IsleMind はローカルファーストです。会話、設定、コンテキスト索引データ、Agentic RAG 索引、プロバイダー設定は、JSON をエクスポート/インポートする場合、ローカルモデルをダウンロードする場合、または設定済み AI プロバイダーへ内容を送信する場合を除き、端末上に残ります。SecureStore のプロバイダー Key は JSON エクスポートに含まれません。

## 更新

IsleMind は現在 APK のコールドアップデートのみを使用します。アプリ内アップデーターは最新の GitHub Release APK を確認し、Android 上でダウンロードしてシステムインストーラーを開き、ユーザーがインストールを確認します。
