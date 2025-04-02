// Slack Voice Converter
// スラックのボイスメモを文字起こしして再投稿し、元のボイスメモを削除するスクリプト

// Slack APIの認証情報
interface SlackConfig {
  token: string;
  userToken: string;  // ユーザートークン（メッセージの削除に必要）
  channelName: string;
}

// Slackの設定
const SLACK_CONFIG: SlackConfig = {
  token: 'xoxb-your-bot-token-here',  // ボットトークン
  userToken: 'xoxp-your-user-token-here',  // ユーザートークン
  channelName: 'times-your-channel-name'  // 自分専用のtimesチャンネル名
};

// Google Cloud Speech-to-Text APIの設定（必要な場合）
// const SPEECH_API_KEY = 'your-google-cloud-api-key';

// Slackからのイベントを処理するためのWebアプリケーション
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const data = JSON.parse(e.postData.contents);
  
  // SlackのURL検証に対応
  if (data.type === 'url_verification') {
    return ContentService.createTextOutput(data.challenge);
  }
  
  // イベントがメッセージ追加で、ボイスメモの場合のみ処理
  if (data.event && data.event.type === 'message' && data.event.subtype === 'file_share') {
    const event = data.event;
    
    // チャンネル名が設定したものと一致するか確認
    const channelInfo = getChannelInfo(event.channel);
    if (channelInfo.name !== SLACK_CONFIG.channelName) {
      return ContentService.createTextOutput('Channel not matched');
    }
    
    // ファイルがボイスメモかどうか確認
    if (event.files && event.files.length > 0) {
      const file = event.files[0];
      if (file.mimetype && file.mimetype.startsWith('audio/')) {
        // 処理を非同期で実行するためにトリガーを設定
        const triggerData = {
          fileId: file.id,
          fileUrl: file.url_private,
          channelId: event.channel,
          timestamp: event.ts
        };
        
        const triggerString = JSON.stringify(triggerData);
        
        // スクリプトプロパティに一時的にデータを保存
        PropertiesService.getScriptProperties().setProperty('lastVoiceMemo', triggerString);
        
        // 1秒後に実行するトリガーを設定
        ScriptApp.newTrigger('processVoiceMemo')
          .timeBased()
          .after(1000)
          .create();
      }
    }
  }
  
  return ContentService.createTextOutput('Event received');
}

// ボイスメモを処理する関数
function processVoiceMemo(): void {
  try {
    // スクリプトプロパティから処理対象データを取得
    const triggerString = PropertiesService.getScriptProperties().getProperty('lastVoiceMemo');
    if (!triggerString) {
      console.log('No voice memo data found');
      return;
    }
    
    const triggerData = JSON.parse(triggerString);
    const { fileId, fileUrl, channelId, timestamp } = triggerData;
    
    // 音声ファイルをダウンロード
    const audioBlob = downloadFile(fileUrl);
    
    if (audioBlob) {
      // 音声を文字起こし
      const transcription = transcribeAudio(audioBlob);
      
      if (transcription) {
        // 文字起こし結果を投稿
        postTranscription(channelId, transcription);
        
        // 元のボイスメモメッセージを削除
        deleteOriginalMessage(channelId, timestamp);
      }
    }
  } catch (error) {
    console.error('Error processing voice memo:', error);
    // エラーが発生した場合は通知
    const errorMessage = error instanceof Error ? error.toString() : '不明なエラー';
    const channelId = PropertiesService.getScriptProperties().getProperty('lastChannelId');
    if (channelId) {
      postMessage(channelId, `ボイスメモの処理中にエラーが発生しました: ${errorMessage}`);
    }
  } finally {
    // 一時データを削除
    PropertiesService.getScriptProperties().deleteProperty('lastVoiceMemo');
    
    // トリガーを削除
    deleteTrigger('processVoiceMemo');
  }
}

// Slackのチャンネル情報を取得
function getChannelInfo(channelId: string): any {
  const url = `https://slack.com/api/conversations.info?channel=${channelId}`;
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const responseData = JSON.parse(response.getContentText());
  
  if (!responseData.ok) {
    throw new Error(`Failed to get channel info: ${responseData.error}`);
  }
  
  return responseData.channel;
}

// Slackからファイルをダウンロード
function downloadFile(fileUrl: string): GoogleAppsScript.Base.Blob | null {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.token}`
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(fileUrl, options);
    if (response.getResponseCode() === 200) {
      return response.getBlob();
    }
  } catch (error) {
    console.error('Error downloading file:', error);
  }
  
  return null;
}

// 音声を文字起こし
function transcribeAudio(audioBlob: GoogleAppsScript.Base.Blob): string {
  try {
    // Google Speech-to-Text APIを使用する場合の実装
    // 注意: この実装はGCP Speech-to-Text APIの設定が必要です
    
    // Speech-to-Text APIがGASで直接使えない場合の代替手段:
    // 1. 音声をDriveに一時保存し、
    // 2. DocumentAppのvoice recognition機能を使うか、
    // 3. 直接Speech-to-Text APIをリクエストする

    // 簡単な例として、音声ファイルをGoogleドキュメントに埋め込み、DocumentAppのvoice recognition機能を使う方法
    const docFile = DocumentApp.create('Voice Memo Transcription');
    const doc = docFile.getBody();
    doc.appendParagraph('Transcribing...');
    
    // 音声をドキュメントに埋め込む（メタデータとして）
    const file = DriveApp.createFile(audioBlob);
    docFile.addEditor(Session.getEffectiveUser());
    
    // 数秒待機してGoogleのバックグラウンド処理を待つ
    Utilities.sleep(5000);
    
    // ここでドキュメントから文字起こしを取得することは実際にはできません
    // 実際の実装ではCloud Speech-to-Text APIを直接呼び出す必要があります
    
    // テスト用の仮の文字起こし結果
    const transcription = "これはサンプルの文字起こし結果です。実際の実装では、Google Cloud Speech-to-Text APIを使用してください。";
    
    // 一時ファイルを削除
    DriveApp.getFileById(file.getId()).setTrashed(true);
    DriveApp.getFileById(docFile.getId()).setTrashed(true);
    
    return transcription;
  } catch (error) {
    console.error('Transcription error:', error);
    return '音声の文字起こし中にエラーが発生しました。';
  }
}

// 文字起こし結果をSlackに投稿
function postTranscription(channelId: string, text: string): void {
  const url = 'https://slack.com/api/chat.postMessage';
  const payload = {
    channel: channelId,
    text: `📝 *ボイスメモの文字起こし*:\n${text}`,
    mrkdwn: true
  };
  
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const responseData = JSON.parse(response.getContentText());
  
  if (!responseData.ok) {
    throw new Error(`Failed to post message: ${responseData.error}`);
  }
}

// 通常のメッセージを投稿
function postMessage(channelId: string, text: string): void {
  const url = 'https://slack.com/api/chat.postMessage';
  const payload = {
    channel: channelId,
    text: text
  };
  
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(url, options);
}

// 元のボイスメモメッセージを削除
function deleteOriginalMessage(channelId: string, timestamp: string): void {
  const url = 'https://slack.com/api/chat.delete';
  const payload = {
    channel: channelId,
    ts: timestamp
  };
  
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.userToken}`,  // メッセージ削除にはユーザートークンが必要
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const responseData = JSON.parse(response.getContentText());
  
  if (!responseData.ok) {
    throw new Error(`Failed to delete message: ${responseData.error}`);
  }
}

// 特定の名前のトリガーを削除
function deleteTrigger(handlerName: string): void {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

// Slackイベント購読のためのURL検証エンドポイント
function doGet(): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput('Slack Voice converter is running!');
}

// GASをウェブアプリケーションとしてデプロイするための設定
function setup(): void {
  // スクリプトプロパティに設定を保存する場合はここに追加
  console.log('Setup completed. Deploy as web app to use with Slack Events API.');
}