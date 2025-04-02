/**
 * @OnlyCurrentDoc
 * @Logging(true)
 */

// Slack Voice Converter
// スラックのボイスメモを文字起こしして再投稿し、元のボイスメモを削除するスクリプト

// Slack APIの認証情報
interface SlackConfig {
  token: string;
  userToken: string;  // ユーザートークン（メッセージの削除に必要）
  channelName: string;
}

interface GcpMinimalServiceAccount {
  private_key: string;
  client_email: string;
  client_id?: string;
  project_id?: string;
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

/**
 * イベントが既に処理済みかどうかをチェック
 * @param eventId イベントID
 * @return 処理済みならtrue、未処理ならfalse
 */
function isEventProcessed(eventId: string): boolean {
  const cache = CacheService.getScriptCache();
  const cacheKey = `processed_event_${eventId}`;
  
  // キャッシュに保存されているかチェック
  const cachedValue = cache.get(cacheKey);
  return cachedValue !== null;
}

/**
 * イベントを処理済みとしてマーク
 * @param eventId イベントID
 * @param expirationSeconds キャッシュの有効期間（秒）
 */
function markEventAsProcessed(eventId: string, expirationSeconds: number = 3600): void {
  const cache = CacheService.getScriptCache();
  const cacheKey = `processed_event_${eventId}`;
  
  // キャッシュに保存（デフォルトでは1時間）
  cache.put(cacheKey, 'processed', expirationSeconds);
}

// Slackからのイベントを処理するためのWebアプリケーション
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  // デバッグログ
  console.log('🔍 doPost関数が呼び出されました');
  console.log('🔍 受信データ: ' + e.postData.contents);
  
  const data = JSON.parse(e.postData.contents);
  
  // SlackのURL検証に対応
  if (data.type === 'url_verification') {
    console.log('🔍 URL検証リクエストを処理します');
    return ContentService.createTextOutput(data.challenge);
  }
  
  // イベントIDを取得
  let eventId = data.event_id;
  console.log('🔍 イベントID: ' + eventId);

  // イベントIDがない場合は代替IDを作成
  if (!eventId && data.event) {
    // チャンネルID + タイムスタンプで一意のIDを作成
    eventId = data.event.channel + '_' + data.event.ts;
    console.log('🔍 代替イベントID作成:', eventId);
  }
  
  // 重複イベントチェック
  if (eventId && isEventProcessed(eventId)) {
    console.log('⚠️ 重複イベントを検出しました: ' + eventId);
    return ContentService.createTextOutput('Duplicate event');
  }
  
  // デバッグログ: データ構造の確認
  console.log('🔍 イベントタイプ: ' + (data.event ? data.event.type : 'イベントなし'));
  console.log('🔍 イベントサブタイプ: ' + (data.event ? data.event.subtype : 'サブタイプなし'));
  
  // イベントがメッセージ追加で、ボイスメモの場合のみ処理
  if (data.event && data.event.type === 'message') {
    console.log('🔍 メッセージイベントを受信しました');
    
    const event = data.event;
    
    // ファイル共有イベントの確認
    if (event.subtype === 'file_share') {
      console.log('🔍 ファイル共有イベントです');
      
      try {
        // Slack設定を取得
        const SLACK_CONFIG = getSlackConfig();
        console.log('🔍 Slack設定を取得しました: チャンネル名=' + SLACK_CONFIG.channelName);
        
        // チャンネルIDからチャンネル情報を取得
        console.log('🔍 チャンネルID: ' + event.channel);
        const channelInfo = getChannelInfo(event.channel);
        console.log('🔍 チャンネル名: ' + channelInfo.name);
        
        // チャンネル名が設定したものと一致するか確認
        if (channelInfo.name !== SLACK_CONFIG.channelName) {
          console.log('❌ チャンネル名が一致しません: ' + channelInfo.name + ' != ' + SLACK_CONFIG.channelName);
          return ContentService.createTextOutput('Channel not matched');
        }
        
        // ファイルの確認
        if (event.files && event.files.length > 0) {
          const file = event.files[0];
          console.log('🔍 ファイルタイプ: ' + file.mimetype);
          
          // 音声ファイルの確認
          if (file.mimetype && file.mimetype.startsWith('audio/')) {
            console.log('✅ 音声ファイルを検出しました');
            
            // すぐに処理を実行
            console.log('🔍 音声ファイルを処理します');
            
            // 音声ファイルをダウンロード
            console.log('🔍 ファイルURL: ' + file.url_private);
            const audioBlob = downloadFile(file.url_private);
            
            if (audioBlob) {
              console.log('✅ ファイルのダウンロードに成功しました');
              
              // 音声を文字起こし (簡易版)
              const transcription = transcribeAudio(audioBlob);
              console.log('✅ 文字起こし結果: ' + transcription);
              
              // 文字起こし結果を投稿
              postTranscription(event.channel, transcription);
              console.log('✅ 文字起こし結果を投稿しました');
              
              // 元のボイスメモメッセージを削除
              deleteOriginalMessage(event.channel, event.ts);
              console.log('✅ 元のボイスメモを削除しました');
              
              // イベントを処理済みとしてマーク
              if (eventId) {
                markEventAsProcessed(eventId);
                console.log('✅ イベントを処理済みとしてマークしました: ' + eventId);
              }
            } else {
              console.log('❌ ファイルのダウンロードに失敗しました');
            }
          } else {
            console.log('❌ 音声ファイルではありません: ' + file.mimetype);
          }
        } else {
          console.log('❌ ファイルが添付されていません');
        }
      } catch (error) {
        console.error('❌ エラー発生:', error);
      }
    } else {
      console.log('❌ ファイル共有イベントではありません: ' + event.subtype);
    }
  }
  
  console.log('🔍 doPost処理を完了しました');
  return ContentService.createTextOutput('Event received');
}

// Slackのチャンネル情報を取得
function getChannelInfo(channelId: string): any {
  console.log('🔍 getChannelInfo関数が呼び出されました: ' + channelId);
  
  const SLACK_CONFIG = getSlackConfig();
  
  const url = `https://slack.com/api/conversations.info?channel=${channelId}`;
  console.log('🔍 リクエストURL: ' + url);
  
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());
    
    console.log('🔍 APIレスポンス: ' + response.getContentText());
    
    if (!responseData.ok) {
      console.error('❌ チャンネル情報の取得に失敗: ' + responseData.error);
      throw new Error(`Failed to get channel info: ${responseData.error}`);
    }
    
    return responseData.channel;
  } catch (error) {
    console.error('❌ チャンネル情報取得エラー: ', error);
    throw error;
  }
}

// Slackからファイルをダウンロード
function downloadFile(fileUrl: string): GoogleAppsScript.Base.Blob | null {
  console.log('🔍 downloadFile関数が呼び出されました: ' + fileUrl);
  
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
    const responseCode = response.getResponseCode();
    console.log('🔍 ダウンロードレスポンスコード: ' + responseCode);
    
    if (responseCode === 200) {
      return response.getBlob();
    } else {
      console.error('❌ ファイルダウンロードエラー: ステータスコード ' + responseCode);
      return null;
    }
  } catch (error) {
    console.error('❌ ファイルダウンロードエラー:', error);
    return null;
  }
}

function transcribeAudio(audioBlob: GoogleAppsScript.Base.Blob): string {
  console.log('🔍 transcribeAudio関数が呼び出されました');
  
  try {
    // Google Cloud APIキーを取得
    const apiKeyJson = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLOUD_API_KEY');
    if (!apiKeyJson) {
      throw new Error('Speech-to-Text API設定が見つかりません。setupSpeechToTextAPI()関数を実行してください。');
    }
    
    // 音声をBase64にエンコード
    const base64Audio = Utilities.base64Encode(audioBlob.getBytes());
    
    // サービスアカウントキーをパース
    const serviceAccount = JSON.parse(apiKeyJson) as GcpMinimalServiceAccount;
    
    // JWTを生成するための関数
    function generateJWT(serviceAccount: GcpMinimalServiceAccount) {
      const header = {
        alg: 'RS256',
        typ: 'JWT'
      };
      
      const now = Math.floor(Date.now() / 1000);
      const claim = {
        iss: serviceAccount.client_email,
        sub: serviceAccount.client_email,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
        scope: 'https://www.googleapis.com/auth/cloud-platform' // 重要: 適切なスコープを追加
      };
      
      const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header));
      const encodedClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claim));
      
      const signature = Utilities.computeRsaSha256Signature(
        `${encodedHeader}.${encodedClaim}`, 
        serviceAccount.private_key
      );
      
      return `${encodedHeader}.${encodedClaim}.${Utilities.base64EncodeWebSafe(signature)}`;
    }
    
    // JWTトークンを生成
    const jwt = generateJWT(serviceAccount);
    
    // アクセストークンを取得するためのリクエスト
    const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      muteHttpExceptions: true // エラーメッセージ全体を取得するために追加
    });
    
    // トークン応答をログに記録
    console.log('Token response code:', tokenResponse.getResponseCode());
    console.log('Token response text:', tokenResponse.getContentText());
    
    const tokenData = JSON.parse(tokenResponse.getContentText());
    
    if (!tokenData.access_token) {
      throw new Error('アクセストークンを取得できませんでした: ' + tokenResponse.getContentText());
    }
    
    const accessToken = tokenData.access_token;
    
    // Google Cloud Speech-to-Text APIリクエスト
    const requestData = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 44100, // 一般的な録音レートに変更
        languageCode: 'ja-JP',
        model: 'default',
        enableAutomaticPunctuation: true
      },
      audio: {
        content: base64Audio
      }
    };
    
    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      payload: JSON.stringify(requestData),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch('https://speech.googleapis.com/v1/speech:recognize', options);
    
    // APIレスポンスをログに記録
    console.log('API response code:', response.getResponseCode());
    console.log('API response text:', response.getContentText());
    
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
    return `音声の文字起こし中にエラーが発生しました: ${error}`;
  }
}

// 文字起こし結果をSlackに投稿
function postTranscription(channelId: string, text: string): void {
  console.log('🔍 postTranscription関数が呼び出されました: チャンネル=' + channelId);
  
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
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());
    
    console.log('🔍 メッセージ投稿レスポンス: ' + response.getContentText());
    
    if (!responseData.ok) {
      console.error('❌ メッセージ投稿エラー: ' + responseData.error);
      throw new Error(`Failed to post message: ${responseData.error}`);
    }
  } catch (error) {
    console.error('❌ メッセージ投稿エラー:', error);
    throw error;
  }
}

// 通常のメッセージを投稿
function postMessage(channelId: string, text: string): void {
  console.log('🔍 postMessage関数が呼び出されました: チャンネル=' + channelId);
  
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
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    console.log('🔍 メッセージ投稿レスポンス: ' + response.getContentText());
  } catch (error) {
    console.error('❌ 通常メッセージ投稿エラー:', error);
  }
}

// 元のボイスメモメッセージを削除
function deleteOriginalMessage(channelId: string, timestamp: string): void {
  console.log('🔍 deleteOriginalMessage関数が呼び出されました: チャンネル=' + channelId + ', タイムスタンプ=' + timestamp);
  
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
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());
    
    console.log('🔍 メッセージ削除レスポンス: ' + response.getContentText());
    
    if (!responseData.ok) {
      console.error('❌ メッセージ削除エラー: ' + responseData.error);
      throw new Error(`Failed to delete message: ${responseData.error}`);
    }
  } catch (error) {
    console.error('❌ メッセージ削除エラー:', error);
    throw error;
  }
}

// 特定の名前のトリガーを削除
function deleteTrigger(handlerName: string): void {
  console.log('🔍 deleteTrigger関数が呼び出されました: ' + handlerName);
  
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
      console.log('✅ トリガーを削除しました: ' + handlerName);
    }
  }
}

// Slackイベント購読のためのURL検証エンドポイント
function doGet(): GoogleAppsScript.Content.TextOutput {
  console.log('🔍 doGet関数が呼び出されました');
  return ContentService.createTextOutput('Slack Voice Converter is running!');
}

// GASをウェブアプリケーションとしてデプロイするための設定
function setup(): void {
  console.log('🔍 setup関数が呼び出されました');
  console.log('Setup completed. Deploy as web app to use with Slack Events API.');
  console.log('Remember to run the setupCredentials() function to save your Slack tokens securely.');
}

/**
 * テスト用：特定のチャンネルにメッセージを送信するテスト
 */
function testPostMessage(): string {
  // Slack設定を取得
  const SLACK_CONFIG = getSlackConfig();
  console.log('Slack設定: ', SLACK_CONFIG);
      
  // テストメッセージを送信
  console.log("テストメッセージを送信します");
  return "これはテストメッセージです。Slack Voice Converterからの送信テストです。";    
}

/**
 * キャッシュをクリアする関数（デバッグ用）
 */
function clearEventCache(): void {
  CacheService.getScriptCache().remove("processed_event_keys");
  console.log("イベントキャッシュをクリアしました");
}

/**
 * console の挙動確認デバッグ関数
 */
function exampleLogging() {
  // 通常のログ
  console.log('通常のメッセージ');
  
  // 警告ログ
  console.warn('警告メッセージ');
  
  // エラーログ
  console.error('エラーメッセージ');
}

/**
 * SlackUserToken を PropertyService に上書きするための関数
 */
function exchangeOAuthCode() {
  const clientId = 'CLIEND_ID';
  const clientSecret = 'CLIEND_SECRET';
  const code = '2186695524.8679197372295.ae740a3fbda636ba991e455658f02cfe846acb18143591247603a6f9e17e2cdb';
  const redirectUri = 'https://example.com';

  const url = 'https://slack.com/api/oauth.v2.access';
  const payload = {
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    redirect_uri: redirectUri
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    
    console.log('🔍 OAuth交換結果:', JSON.stringify(result, null, 2));
    
    // 必要に応じてトークンをスクリプトプロパティに保存
    if (result.ok) {
      const scriptProperties = PropertiesService.getScriptProperties();
      scriptProperties.setProperty('SLACK_USER_TOKEN', result.authed_user.access_token);
    }
  } catch (error) {
    console.error('❌ OAuth交換中にエラー:', error);
  }
}

function checkSlackAppDetails() {
  const SLACK_CONFIG = getSlackConfig();
  
  const teamInfoUrl = 'https://slack.com/api/team.info';
  const authTestUrl = 'https://slack.com/api/auth.test';
  
  const teamInfoOptions :GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.token}`
    }
  };
  
  const authTestOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.token}`
    }
  };
  
  try {
    // チーム情報の取得
    const teamInfoResponse = UrlFetchApp.fetch(teamInfoUrl, teamInfoOptions);
    const teamInfoResult = JSON.parse(teamInfoResponse.getContentText());
    console.log('🔍 チーム情報:', JSON.stringify(teamInfoResult, null, 2));
    
    // 認証テスト
    const authTestResponse = UrlFetchApp.fetch(authTestUrl, authTestOptions);
    const authTestResult = JSON.parse(authTestResponse.getContentText());
    console.log('🔍 認証テスト結果:', JSON.stringify(authTestResult, null, 2));
    
  } catch (error) {
    console.error('❌ Slack API確認中にエラー:', error);
  }
}

/**
 * SlackUserToken を PropertyService に上書きするための関数
 */
function debugSlackEvent() {
  // テスト用のモックイベントを作成
  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        type: 'event_callback',
        event: {
          type: 'message',
          subtype: 'file_share',
          channel: 'C0G498M27', // 実際のチャンネルID
          files: [{
            mimetype: 'audio/wav',
            url_private: 'https://spookies.slack.com/files/U049SJHCF/F08KZ841GUX/audio_message.m4a'
          }],
          ts: '1234567890.123456'
        }
      })
    }
  }  as GoogleAppsScript.Events.DoPost;

  // doPost関数を手動でテスト
  console.log('🔍 デバッグ: モックイベントでテスト開始');
  try {
    doPost(mockEvent);
  } catch (error) {
    console.error('❌ デバッグ中にエラー:', error);
  }
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

/**
 * Google Cloud Speech-to-Text API のキーを設定する関数
 */
function setupSpeechToTextAPI(): void {
  const apiKey = JSON.stringify({
    // ここにGoogle Cloud サービスアカウントのJSONキーを貼り付ける
    // 例: {"type": "service_account", "project_id": "your-project", ...}
  });
  
  PropertiesService.getScriptProperties().setProperty('GOOGLE_CLOUD_API_KEY', apiKey);
  console.log('Speech-to-Text API設定を保存しました。');
}