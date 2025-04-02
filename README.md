# Slack ボイスメモ文字起こしコンバーター

## 概要

このアプリケーションは、Slack上で共有されたボイスメモを自動的に文字起こしし、テキストメッセージとして再投稿した後、元のボイスメモを削除するための Google Apps Script (GAS) アプリケーションです。

## 機能

- Slack上の特定のチャンネル（自分専用のtimesチャンネルなど）でボイスメモが共有された時に自動検知
- ボイスメモの音声を文字起こし
- 文字起こし結果をテキストメッセージとして投稿
- 元のボイスメモメッセージを削除

## セットアップ手順

### 1. 開発環境の構築

```bash
# Google clasp のインストール
npm install -g @google/clasp

# プロジェクトの初期化
mkdir slack-voice-converter
cd slack-voice-converter
npm init -y
npm install --save-dev typescript @types/google-apps-script

# claspへのログイン
clasp login

# プロジェクトの作成
clasp create --title "Slack Voice Converter" --type standalone
```

### 2. 必須ファイルの作成

以下のファイルを必ず作成してください：

- `src/appsscript.json` (GASマニフェストファイル)
- `src/Code.ts` (メインのソースコード)
- `.clasp.json` (clasp設定)
- `tsconfig.json` (TypeScript設定)
- `package.json` (npm設定)

### 3. GASアプリの設定とデプロイ

```bash
# ビルドとデプロイ
npm run build
npm run push
```

その後、GASエディターで：
1. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」
2. アクセス権限を「全員（匿名を含む）」に設定
3. デプロイしてURLを取得

### 4. Slack APIの設定

1. [Slack API ウェブサイト](https://api.slack.com/apps)で新しいアプリを作成
2. Event Subscriptionsを有効化：
   - Request URLに、GASのデプロイURLを入力（URL検証が成功することを確認）
   - 以下のイベントを購読: `message.channels`, `file_shared`
3. ボットに権限を付与: `channels:history`, `channels:read`, `chat:write`, `files:read`
4. アプリをワークスペースにインストール
5. ボットトークン（`xoxb-`で始まる）とユーザートークン（`xoxp-`で始まる）を取得

### 5. 認証情報の設定

```javascript
// GASエディターで以下の関数を実行
function setupCredentials() {
  const botToken = 'xoxb-your-bot-token-here';  // ボットトークン
  const userToken = 'xoxp-your-user-token-here'; // ユーザートークン
  const channelName = 'times-your-channel-name'; // 自分専用のtimesチャンネル名
  
  PropertiesService.getScriptProperties().setProperty('SLACK_BOT_TOKEN', botToken);
  PropertiesService.getScriptProperties().setProperty('SLACK_USER_TOKEN', userToken);
  PropertiesService.getScriptProperties().setProperty('SLACK_CHANNEL_NAME', channelName);
}
```

## よくあるつまずきポイントと解決策

### 1. マニフェストファイルの不足

**エラー**: `Project contents must include a manifest file named appsscript.`

**解決策**: 
- `src/appsscript.json` ファイルを作成
- `package.json` の build スクリプトでコピーするよう設定

```json
// src/appsscript.json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

### 2. TypeScriptコンパイル設定の問題

**エラー**: `構成ファイル 'tsconfig.json' で入力が見つかりませんでした`

**解決策**:
```json
// tsconfig.json
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
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "build"]
}
```

### 3. ビルドディレクトリの設定

**問題**: JSファイルが `src` ディレクトリに生成される

**解決策**:
```json
// .clasp.json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "build"
}
```

```json
// package.json
{
  "scripts": {
    "clean": "rm -rf src/*.js && rm -rf build/*",
    "build": "npm run clean && tsc && cp src/appsscript.json build/",
    "push": "npm run build && clasp push"
  }
}
```

### 4. Slack URL検証の問題

**エラー**: `Your URL didn't respond with the value of the challenge parameter.`

**解決策**: `doPost` 関数でchallenge値を返すように実装

```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  
  if (data.type === 'url_verification') {
    return ContentService.createTextOutput(data.challenge);
  }
  // ...
}
```

### 5. イベントの重複受信

**問題**: Slackは同じイベントを複数回送信することがある

**解決策**: CacheServiceでイベントIDを管理

```javascript
function isEventProcessed(eventId) {
  const cache = CacheService.getScriptCache();
  return cache.get(`processed_event_${eventId}`) !== null;
}

function markEventAsProcessed(eventId) {
  const cache = CacheService.getScriptCache();
  cache.put(`processed_event_${eventId}`, 'processed', 3600);
}

function doPost(e) {
  // ...
  const eventId = data.event_id;
  if (eventId && isEventProcessed(eventId)) {
    return ContentService.createTextOutput('Duplicate event');
  }
  // 処理後
  if (eventId) {
    markEventAsProcessed(eventId);
  }
  // ...
}
```

## 音声認識の設定

### テスト用（固定テキスト返却）

開発中は、音声認識APIを使わず固定テキストを返すシンプルな実装にすると便利です。

```javascript
function transcribeAudio(audioBlob) {
  return "これはテスト用の文字起こしです。";
}
```

### Google Cloud Speech-to-Text API（本番用）

1. GCP コンソールで新しいプロジェクトを作成
2. Speech-to-Text API を有効化
3. サービスアカウントと認証用JSONキーを作成
4. GAS に認証情報を保存

```javascript
function setupSpeechToTextAPI() {
  const apiKey = JSON.stringify({
    // ダウンロードしたJSONキーの内容
  });
  
  PropertiesService.getScriptProperties().setProperty('GOOGLE_CLOUD_API_KEY', apiKey);
}
```

## デバッグのヒント

- GAS の実行ログを活用して問題を特定
- `console.log` を多用してデータの流れを確認
- テスト用関数で部分的な機能をテスト

```javascript
function testPostMessage() {
  // テスト用コード
}
```

## 注意点

1. Slackトークンのセキュリティを確保するためPropertiesServiceを使用
2. Slackアプリがターゲットチャンネルに追加されていることを確認
3. ユーザートークンはメッセージ削除に必要
4. GASの実行制限に注意（日次クォータあり）