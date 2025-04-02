# Slack ボイスメモ文字起こしコンバーター

## 概要

このアプリケーションは、Slack上で共有されたボイスメモを自動的に文字起こしして再投稿し、元のボイスメモを削除するための Google Apps Script (GAS) アプリケーションです。このバージョンでは、Slackの内部文字起こし機能（トランスクリプション）を利用しています。

## 機能

- Slack上でボイスメモが共有された時に自動検知
- Slackのネイティブ文字起こし機能を利用してテキスト化
- 文字起こし結果をテキストメッセージとして投稿
- 元のボイスメモメッセージを削除（オプション）
- 詳細なログ記録

## システムアーキテクチャ

システムは以下のコンポーネントから構成されています：

1. **Slackワークスペース**: ユーザーがボイスメモを投稿
2. **Google Apps Script (GAS) Webアプリ**:
   - イベント処理: Slackからのイベントを受信・処理
   - ファイル処理: 音声ファイルのメタデータと文字起こし情報を取得
   - メッセージ管理: 結果の投稿と元メッセージの削除

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
    - `chat:write`
    - `channels:write`（またはプライベートチャンネル用に`groups:write`）
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

3. `checkAllSettings()` - すべての設定が正しく行われていることを確認

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

### 2. 元メッセージの削除オプション

元のボイスメモメッセージを削除したくない場合は、`useSlackTranscription()` 関数内の該当部分をコメントアウトまたは削除できます：

```javascript
// 元のメッセージを削除（オプション）- 削除したくない場合はコメントアウト
// try {
//   deleteOriginalMessage(channelId, timestamp);
//   logInfo('元のメッセージを削除しました');
// } catch (error) {
//   logWarning(`元メッセージの削除に失敗: ${error}`);
// }
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

3. **元のメッセージが削除されない**
   - ユーザートークンが正しく設定されているか確認
   - ユーザートークンに `chat:write` と `channels:write` 権限があるか確認

### ログの確認

問題が発生した場合は、ログスプレッドシートを確認して具体的なエラーメッセージを確認してください。ログスプレッドシートは `setupLogSpreadsheet()` を実行すると自動的に作成されます。

## 制限事項

- Slackの内部文字起こし機能は、言語やオーディオ品質によって精度が異なる場合があります
- 文字起こしが完了するまでに時間がかかる場合があります
- ユーザートークンは定期的に更新が必要な場合があります

## アップデート履歴

- **v1.0.0** - 初回リリース（Google Cloud Speech-to-Text API使用）
- **v2.0.0** - Slackのネイティブ文字起こし機能を使用するようにアップデート

## ライセンス

MIT License

## 開発者向け情報

### ファイル構成

- **Code.ts**: メインスクリプト（GASのEntryPoint）
- **slack.ts**: Slack API操作関連の関数
- **logger.ts**: ログ記録関連の関数
- **setup.ts**: 設定関連の関数

### ローカル開発（オプション）

clasp を使用したローカル開発も可能です：

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

# プロジェクトのクローンまたは作成
clasp clone <SCRIPT_ID>  # または clasp create --title "Slack Voice Converter"

# ビルドとアップロード
npm run build
clasp push
```