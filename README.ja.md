# IsleMind

[English](README.md) | [简体中文](README.zh-CN.md) | 日本語

IsleMind は、集中した会話、プライベートなプロバイダー設定、再利用できる個人コンテキスト、知識支援チャットのためのローカルファーストなモバイル AI ワークスペースです。

## 特長

- 任意の AI プロバイダーとモデルでチャットできます。
- 会話、設定、ローカルコンテキストを端末上に保存します。
- Agentic RAG で知識をインポートできます。ハイブリッド検索、セマンティック分割、ローカル rerank、引用、フォールバックに対応します。
- 任意のローカル embedding モデルをアプリ内でダウンロードできます。モデルがない場合は hash embedding にフォールバックします。
- モデル出力のソース、検索、処理情報を確認できます。
- Android 版は GitHub Release APK から更新できます。

## ダウンロード

[GitHub Releases](https://github.com/domidoremi/IsleMind/releases/latest) から最新の Android APK をダウンロードし、端末にインストールしてください。GitHub のモバイル表示では長いファイル名が省略されることがあるため、Release notes に直接ダウンロードリンクを載せています。

現在のアプリバージョン: `1.0.3`。

Release APK はローカルモデルの有無で分かれます。

- `no-model`: 既定ビルド。ローカルモデルファイルを同梱しません。
- `with-model-small`: ローカル embedding 用に `all-MiniLM-L6-v2` のみを同梱します。

Release APK は Android アーキテクチャ別にも分かれます。

- `arm64-v8a`: 多くの新しい Android スマートフォン向けです。
- `x86_64`: Android emulator 向けです。
- `armeabi-v7a`: 古い 32-bit Android 端末向けです。
- `universal`: 互換性が最も広く、ファイルサイズは大きめです。

アプリ内のローカルモデル画面から、RAG モデルのダウンロード、検証、有効化もできます。

## Android 16 KB Page Size

Release ビルドでは `npm run apk:validate-16kb` を実行し、`zipalign -P 16` で APK ZIP page alignment を確認し、`llvm-readelf` で native library の ELF `LOAD` segment alignment を確認します。ZIP alignment は Android ビルドで制御できますが、ELF alignment は Expo、React Native、ONNX Runtime などの依存関係が配布するネイティブライブラリに依存します。検証で第三者 `.so` が 4 KB `LOAD` alignment と報告された場合は、その依存関係を更新または再ビルドしてから Android 16 KB page-size 端末への完全対応としてください。

## ローカル RAG モデル

IsleMind の既定 APK にはモデル重みは含まれません。任意のローカルモデルは `assets/models/catalog.json` に記録され、モデルの出典と attribution は `assets/models/NOTICE.md` に記載されています。

現在の catalog には、Xenova が Hugging Face で公開している ONNX 配布版を登録しています。上流モデルファミリーは `sentence-transformers` と BAAI です。モデルファイルは IsleMind コントリビューターが作成したものではありません。再配布や商用利用の前に、上流モデルカードとライセンスを確認してください。

## プライバシー

IsleMind はローカルファーストです。会話、設定、コンテキスト索引データ、Agentic RAG 索引、プロバイダー設定は、JSON をエクスポート/インポートする場合、ローカルモデルをダウンロードする場合、または設定済み AI プロバイダーへ内容を送信する場合を除き、端末上に残ります。SecureStore のプロバイダー Key は JSON エクスポートに含まれません。

## 更新

IsleMind は現在 APK のコールドアップデートのみを使用します。アプリ内アップデーターは最新の GitHub Release APK を確認し、Android 上でダウンロードしてシステムインストーラーを開き、ユーザーがインストールを確認します。
