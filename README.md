# Slack ボイスメモ文字起こしコンバーター

## 概要

このアプリケーションは、Slack上で共有されたボイスメモを自動的に文字起こしし、テキストメッセージとして再投稿した後、元のボイスメモを削除するための Google Apps Script (GAS) アプリケーションです。

### 主な機能

- Slack上の特定のチャンネル（自分専用のtimesチャンネルなど）でボイスメモが共有された時に自動検知
- ボイスメモの音声を文字起こし
- 文字起こし結果をテキストメッセージとして投稿
- 元のボイスメモメッセージを削除

## 開発環境のセットアップ

### 前提条件

- Node.js と npm がインストールされていること
- Google アカウント（Google Apps Scriptを使用するため）
- Slack ワークスペースの管理者権限または、アプリを作成・インストールできる権限

### 開発環境構築手順

1. **必要なツールのインストール**

```bash
# Google clasp のインストール
npm install -g @google/clasp

# プロジェクトディレクトリの作成
mkdir slack-voice-converter
cd slack-voice-converter

# プロジェクトの初期化
npm init -y
```

2. **プロジェクトの依存関係をインストール**

```bash
# TypeScript と GAS の型定義のインストール
npm install --save-dev typescript @types/google-apps-script
```

3. **clasp へのログイン**

```bash
clasp login
```

4. **プロジェクトの作成**

```bash
# 新しいスクリプトプロジェクトを作成
clasp create --title "Slack Voice Converter" --type standalone
```

5. **必要なファイルの作成**

以下のファイルを作成します：

- **package.json** - npm依存関係とスクリプト管理用
- **tsconfig.json** - TypeScriptコンパイラ設定用
- **src/Code.ts** - スクリプト本体
- **src/appsscript.json** - GASマニフェストファイル
- **.clasp.json** - clasp設定用

## プロジェクト構造

正しいプロジェクト構造は以下のようになります：

```
slack-voice-converter/
├── .clasp.json            // claspの設定ファイル
├── package.json           // npmの設定ファイル
├── tsconfig.json          // TypeScriptの設定ファイル
├── README.md              // このファイル
├── build/                 // コンパイル後のファイルが保存されるディレクトリ
│   ├── appsscript.json    // GASマニフェストファイル (ビルド時にコピーされる)
│   └── Code.js            // コンパイル後のJavaScriptコード
└── src/                   // ソースコードディレクトリ
    ├── appsscript.json    // GASマニフェストファイル (元ファイル)
    └── Code.ts            // TypeScriptのソースコード
```

### 重要なファイル

#### .clasp.json (claspの設定)

```json
{
  "scriptId": "YOUR_SCRIPT_ID_HERE",
  "rootDir": "build",
  "scriptExtensions": [
    ".js",
    ".gs"
  ],
  "htmlExtensions": [
    ".html"
  ],
  "jsonExtensions": [
    ".json"
  ]
}
```

#### src/appsscript.json (GASマニフェスト)

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

#### tsconfig.json (TypeScript設定)

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "None",
    "lib": ["ESNext"],
    "esModuleInterop": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "outDir": "build"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

#### package.json (npmスクリプト)

```json
{
  "name": "slack-voice-converter",
  "version": "1.0.0",
  "description": "Slack voice memo converter using Google Apps Script",
  "main": "build/Code.js",
  "scripts": {
    "build": "tsc && cp src/appsscript.json build/",
    "push": "npm run build && clasp push",
    "deploy": "npm run push && clasp deploy",
    "watch": "tsc --watch",
    "test": "echo \"Error: no test specified\" && exit 1"
  }
}
```

## 開発ワークフロー

1. **コードの編集**

   `src/Code.ts` ファイルを編集し、必要な機能を実装します。

2. **ビルド、プッシュ、デプロイ**

```bash
# コードのビルド（TypeScriptのコンパイル）
npm run build

# コードのビルドとGASへのアップロード
npm run push

# ビルド、アップロード、デプロイを一度に行う
npm run deploy
```

## 設定方法

### 1. Google Apps Script の設定

1. `clasp open` コマンドを実行して、Google Apps Script エディタを開きます。
2. デプロイ設定を行います:
   - 「デプロイ」→「新しいデプロイ」→「種類の選択」→「ウェブアプリ」
   - 「次のユーザーとして実行」→「自分」
   - 「アクセスできるユーザー」→「全員（匿名を含む）」
   - 「デプロイ」をクリック
   - デプロイされたURLをコピー（Slack APIの設定で使用します）

### 2. Slack API の設定

1. [Slack API ウェブサイト](https://api.slack.com/apps)で新しいアプリを作成
2. 「Event Subscriptions」を有効化し、以下を設定:
   - Request URLにGoogle Apps Scriptのデプロイ時に取得したURLを入力
   - 以下のイベントを購読:
     - `message.channels`
     - `file_shared`
3. ボットに以下の権限を付与:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `files:read`
4. アプリをワークスペースにインストール
5. アプリの設定ページからボットトークン（`xoxb-`で始まる）を取得
6. ユーザートークン（`xoxp-`で始まる）を取得するには、[Slack Legacy Token Generator](https://api.slack.com/custom-integrations/legacy-tokens)を使用するか、OAuth2.0の設定を行います

### 3. スクリプトの設定

`src/Code.ts` ファイル内の `SLACK_CONFIG` を実際のトークンとチャンネル名で更新します:

```typescript
const SLACK_CONFIG: SlackConfig = {
  token: 'xoxb-your-bot-token-here',       // ボットトークン
  userToken: 'xoxp-your-user-token-here',  // ユーザートークン（メッセージ削除に必要）
  channelName: 'times-your-channel-name'   // 自分専用のtimesチャンネル名
};
```

### 4. 音声認識の設定

このアプリケーションでは音声認識に Google Cloud Speech-to-Text API を使用することが想定されています。実際の環境に合わせて以下のいずれかの方法で音声認識を設定してください:

1. **Google Cloud Speech-to-Text API (推奨)**
   
   Google Cloud Platformでプロジェクトを作成し、Speech-to-Text APIを有効化して認証情報を取得します。
   
2. **代替手段: DocumentApp と DriveApp を使用**
   
   サンプルコードには、Google ドキュメントと Google ドライブを利用した簡易的な実装が含まれています。

## よくあるエラーと解決策

### マニフェストファイルが見つからない場合

エラーメッセージ: `Project contents must include a manifest file named appsscript.`

解決策: 
- `src/appsscript.json` ファイルを作成していることを確認
- `package.json` の `build` スクリプトでマニフェストファイルを `build` ディレクトリにコピーしていることを確認:
  ```json
  "build": "tsc && cp src/appsscript.json build/"
  ```

### TypeScriptのコンパイルエラー

エラーメッセージ: `構成ファイル 'tsconfig.json' で入力が見つかりませんでした`

解決策:
- `tsconfig.json` の `include` パスが正しいことを確認:
  ```json
  "include": ["src/**/*"]
  ```
- ソースファイルが `src` ディレクトリに存在することを確認

### claspのプッシュエラー

エラーメッセージ: 更新が反映されない

解決策:
- `.clasp.json` の `rootDir` が正しいことを確認（通常は `"rootDir": "build"`）
- `npm run build` が成功していることを確認
- 手動でプッシュを試す: `clasp push`

## 注意点

1. **トークンのセキュリティ**: コードに直接トークンを埋め込むのはセキュリティ上リスクがあります。本番環境では、PropertiesServiceを使用してトークンを管理することを検討してください。

2. **実行制限**: Google Apps Scriptには1日あたりの実行回数制限があります。大量のボイスメモを処理する場合は注意が必要です。

3. **音声認識の精度**: 音声認識の精度は使用するAPIや設定、言語によって異なります。日本語の認識精度向上には適切な設定が必要です。

4. **メッセージ削除の権限**: Slackでメッセージを削除するには、そのメッセージを投稿したユーザーのトークンが必要です。ボットによって共有されたボイスメモを削除するには、適切な権限が必要です。

## ライセンス

MIT