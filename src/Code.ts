// Slack Voice Converter
// スラックのボイスメモを文字起こしして再投稿し、元のボイスメモを削除するスクリプト

// Slack APIの認証情報
interface SlackConfig {
  token: string;
  userToken: string;  // ユーザートークン（メッセージの削除に必要）
  channelName: string;
}

/**
 * 初期設定用の関数 - 初回のみ実行する
 * この関数は手動で一度だけ実行し、トークンを安全に保存します
 */
function setupCredentials(): void {
  // 実際のトークンと設定を入力
  const botToken = 'xoxb-your-bot-token-here';  // ボットトークン
  const userToken = 'xoxp-your-user-token-here'; // ユーザートークン
  const channelName = 'times-your-channel-name'; // 自分専用のtimesチャンネル名
  
  // スクリプトプロパティに保存
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('SLACK_BOT_TOKEN', botToken);
  scriptProperties.setProperty('SLACK_USER_TOKEN', userToken);
  scriptProperties.setProperty('SLACK_CHANNEL_NAME', channelName);
  
  console.log('認証情報を安全に保存しました。');
}

function setupSpeechToTextAPI() {
  const apiKey = JSON.stringify({
    // ダウンロードしたJSONキーファイルの内容をここに貼り付け
  });
  
  PropertiesService.getScriptProperties().setProperty('GOOGLE_CLOUD_API_KEY', apiKey);
  console.log('Speech-to-Text API設定を保存しました。');
}

/**
 * 設定を取得する関数
 */
function getSlackConfig(): SlackConfig {
  const scriptProperties = PropertiesService.getScriptProperties();
  
  const token = scriptProperties.getProperty('SLACK_BOT_TOKEN');
  const userToken = scriptProperties.getProperty('SLACK_USER_TOKEN');
  const channelName = scriptProperties.getProperty('SLACK_CHANNEL_NAME');
  
  if (!token || !userToken || !channelName) {
    throw new Error('Slack設定が見つかりません。setupCredentials()関数を実行して設定を保存してください。');
  }
  
  return {
    token,
    userToken,
    channelName
  };
}

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
    
    try {
      // Slack設定を取得
      const SLACK_CONFIG = getSlackConfig();
      
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
          PropertiesService.getScriptProperties().setProperty('lastChannelId', event.channel);
          
          // 1秒後に実行するトリガーを設定
          ScriptApp.newTrigger('processVoiceMemo')
            .timeBased()
            .after(1000)
            .create();
        }
      }
    } catch (error) {
      console.error('Error processing event:', error);
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
    
    // Slack設定を取得
    const SLACK_CONFIG = getSlackConfig();
    
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
    PropertiesService.getScriptProperties().deleteProperty('lastChannelId');
    
    // トリガーを削除
    deleteTrigger('processVoiceMemo');
  }
}

// Slackのチャンネル情報を取得
function getChannelInfo(channelId: string): any {
  const SLACK_CONFIG = getSlackConfig();
  
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
  const SLACK_CONFIG = getSlackConfig();
  
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
    // Google Cloud APIキーを取得
    const apiKeyJson = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLOUD_API_KEY');
    if (!apiKeyJson) {
      throw new Error('Speech-to-Text API設定が見つかりません。setupSpeechToTextAPI()関数を実行してください。');
    }
    
    // 音声をBase64にエンコード
    const base64Audio = Utilities.base64Encode(audioBlob.getBytes());
    
    // Google Cloud Speech-to-Text APIリクエストの設定
    const endpoint = 'https://speech.googleapis.com/v1/speech:recognize';
    const apiKey = JSON.parse(apiKeyJson);
    
    // リクエストデータ
    const requestData = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'ja-JP',  // 日本語を指定
        model: 'default',
        enableAutomaticPunctuation: true
      },
      audio: {
        content: base64Audio
      }
    };
    
    // OAuthトークンを取得
    const token = getOAuthToken(apiKey);
    
    // APIリクエスト
    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      payload: JSON.stringify(requestData),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(endpoint, options);
    const responseData = JSON.parse(response.getContentText());
    
    // レスポンスから文字起こし結果を抽出
    if (responseData.results && responseData.results.length > 0) {
      let transcription = '';
      for (const result of responseData.results) {
        transcription += result.alternatives[0].transcript + ' ';
      }
      return transcription.trim();
    } else {
      return '文字起こしできる内容がありませんでした。';
    }
  } catch (error) {
    console.error('Transcription error:', error);
    return `音声の文字起こし中にエラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`;
  }
}

// Google Cloud APIの認証トークンを取得
function getOAuthToken(apiKey: any): string {
  try {
    // サービスアカウント認証情報
    const email = apiKey.client_email;
    const key = apiKey.private_key;
    
    // JWT（JSON Web Token）のヘッダー
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };
    
    // 現在時刻（秒）
    const now = Math.floor(Date.now() / 1000);
    
    // JWTのクレーム（ペイロード）
    const claimSet = {
      iss: email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    
    // JWTのエンコード
    const jwtHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header));
    const jwtClaimSet = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
    const jwtSignature = Utilities.computeRsaSha256Signature(
      jwtHeader + '.' + jwtClaimSet,
      key
    );
    const jwtSignatureEncoded = Utilities.base64EncodeWebSafe(jwtSignature);
    const jwt = jwtHeader + '.' + jwtClaimSet + '.' + jwtSignatureEncoded;
    
    // OAuthトークンを取得
    const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      }
    });
    
    const responseData = JSON.parse(response.getContentText());
    return responseData.access_token;
  } catch (error) {
    console.error('OAuth token error:', error);
    throw new Error('認証トークンの取得に失敗しました');
  }
}

// 文字起こし結果をSlackに投稿
function postTranscription(channelId: string, text: string): void {
  const SLACK_CONFIG = getSlackConfig();
  
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
  const SLACK_CONFIG = getSlackConfig();
  
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
  const SLACK_CONFIG = getSlackConfig();
  
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
  return ContentService.createTextOutput('Slack Voice Converter is running!');
}

// GASをウェブアプリケーションとしてデプロイするための設定
function setup(): void {
  console.log('Setup completed. Deploy as web app to use with Slack Events API.');
  console.log('Remember to run the setupCredentials() function to save your Slack tokens securely.');
}