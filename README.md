# Slack ボイスメモ文字起こしコンバーター

## 概要

このアプリケーションは、Slack上で共有されたボイスメモを自動的に文字起こしして再投稿し、文字起こし完了後に元のボイスメモファイルを削除するための Google Apps Script (GAS) アプリケーションです。このバージョンでは、Slackの内部文字起こし機能（トランスクリプション）を利用しています。

## 機能

- Slack上でボイスメモが共有された時に自動検知
- Slackのネイティブ文字起こし機能を利用してテキスト化
- 文字起こし結果をテキストメッセージとして投稿
- 文字起こし完了後、元のボイスメモファイルを削除（トランスクリプション完了時のみ）
- 詳細なログ記録

## 処理フロー

1. ユーザーがSlackチャンネルにボイスメモを投稿
2. アプリがイベントを検知し、ファイル情報を取得
3. Slackのトランスクリプト状態を確認
4. トランスクリプトが完了していれば:
   - 文字起こし結果をテキストとして投稿
   - 元のボイスメモファイルを削除
5. トランスクリプトが処理中であれば:
   - 「処理中」メッセージを投稿
   - 元のファイルはそのままにしておく（後でSlack内でトランスクリプトが利用可能になる）

## セットアップ手順

### 1. Google Apps Script プロジェクトの作成

1. [Google Apps Script](https://script.google.com/) にアクセス
2. 「新しいプロジェクト」をクリック
3. プロジェクト名を「Slack Voice Converter」などに設定
4. コードエディタに各ファイルのコードをコピー

### 2. GASアプリのデプロイ

1. メニューから「デプロイ」→「新しいデプロイ」をクリック
2. デプロイタイプで「ウェブアプリ」を選択
3. 説明に「Slack Voice Converter v1」などを入力
4. 「アクセスできるユーザー」で「全員（匿名を含む）」を選択
5. 「デプロイ」ボタンをクリック
6. デプロイされたウェブアプリのURLをコピー（後でSlack APIの設定で使用）

### 3. Slack APIの設定

1. [Slack API ウェブサイト](https://api.slack.com/apps) で新しいアプリを作成
2. 「App Name」に「Voice Transcriber」などを入力
3. ワークスペースを選択して「Create App」をクリック
4. 左メニューから「Event Subscriptions」を選択
5. 「Enable Events」をオンに切り替え
6. 「Request URL」に上記でコピーしたGASウェブアプリのURLを入力
7. 「Subscribe to bot events」セクションで以下を追加:
   - `message.channels`
   - `file_shared`
8. 左メニューから「OAuth & Permissions」を選択
9. 「Bot Token Scopes」に以下を追加:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `files:read`
10. 「User Token Scopes」に以下を追加:
    - `files:write` (ファイル削除に必要)
    - `chat:write` (メッセージ投稿に必要)
11. ページ上部の「Install to Workspace」をクリックして、アプリをインストール
12. ボットトークン（`xoxb-`で始まる）とユーザートークン（`xoxp-`で始まる）をコピー

### 4. GASアプリの設定

GASエディターで以下の関数を順に実行します：

1. `setupLogSpreadsheet()` - ログ記録用のスプレッドシートを設定
2. `setupCredentials()` - Slack APIのトークンを設定
   ```javascript
   function setupCredentials() {
     const botToken = 'xoxb-your-bot-token-here';  // ボットトークン
     const userToken = 'xoxp-your-user-token-here'; // ユーザートークン
     const channelName = 'times-your-channel-name'; // 監視するチャンネル名（オプション）
     
     setupCredentials(botToken, userToken, channelName);
   }
   ```

3. `validateTokenPermissions()` - トークンの権限を検証
   ```javascript
   function testTokens() {
     const scriptProperties = PropertiesService.getScriptProperties();
     const botToken = scriptProperties.getProperty('SLACK_BOT_TOKEN');
     const userToken = scriptProperties.getProperty('SLACK_USER_TOKEN');
     
     if (botToken) validateTokenPermissions(botToken, 'ボット');
     if (userToken) validateTokenPermissions(userToken, 'ユーザー');
   }
   ```

### 5. テスト

1. GASエディターで `doGet()` 関数を実行し、Webアプリが正常に動作しているか確認します
2. 設定したSlackチャンネルでボイスメモを送信してテストします
3. ログスプレッドシートで処理状況と結果を確認します

## カスタマイズオプション

### 1. メッセージフォーマット

`postTranscription()` 関数内のブロックを編集することで、投稿するメッセージの見た目を変更できます：

```javascript
const blocks = [
  {
    "type": "section",
    "text": {
      "type": "mrkdwn",
      "text": `*📝 ボイスメモの文字起こし:*\n${formattedText}`
    }
  },
  // その他のブロック...
];
```

### 2. ファイル削除の無効化

ファイルを削除したくない場合は、`useSlackTranscription()` 関数内の次の部分をコメントアウトできます：

```javascript
// ファイルを削除
// deleteFile(fileId);
```

### 3. 手動でのトランスクリプト確認

特定のファイルのトランスクリプト状態を確認する場合は、`checkFileTranscription()` 関数を使用できます：

```javascript
// ファイルIDを指定して実行
checkFileTranscription('F01234567890');
```

## トラブルシューティング

### 一般的な問題

1. **イベントが検出されない** 
   - Slack APIの「Event Subscriptions」でURLが正しく検証されているか確認
   - ボットがチャンネルに招待されているか確認
   - Botに適切な権限が付与されているか確認

2. **文字起こしが行われない**
   - Slackのボイスメモ文字起こし機能が有効になっているか確認
   - アプリが`files:read`権限を持っているか確認

3. **ファイルが削除されない**
   - ユーザートークンが正しく設定されているか確認
   - ユーザートークンに `files:write` 権限があるか確認
   - トランスクリプションが完了しているかどうか確認（処理中の場合は削除されません）

### ログの確認

問題が発生した場合は、ログスプレッドシートを確認して具体的なエラーメッセージを確認してください。ログスプレッドシートは `setupLogSpreadsheet()` を実行すると自動的に作成されます。

## 制限事項

- Slackの内部文字起こし機能は、言語やオーディオ品質によって精度が異なる場合があります
- 文字起こしが完了するまでに時間がかかる場合があります
- ユーザートークンは定期的に更新が必要な場合があります

## アップデート履歴

- **v1.0.0** - 初回リリース（Google Cloud Speech-to-Text API使用）
- **v2.0.0** - Slackのネイティブ文字起こし機能を使用するようにアップデート
- **v2.1.0** - メッセージ削除からファイル削除に変更、処理中ファイルの取り扱い改善

## ライセンス

MIT License