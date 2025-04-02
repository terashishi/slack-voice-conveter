/**
 * @OnlyCurrentDoc
 * @Logging(true)
 */

// Slack Voice Converter
// スラックのボイスメモを文字起こしして再投稿し、元のボイスメモを削除するスクリプト

// Slack APIの認証情報
interface SlackConfig {
  token: string;
  userToken: string; // ユーザートークン（メッセージの削除に必要）
  channelName: string;
}

interface GcpMinimalServiceAccount {
  private_key: string;
  client_email: string;
  client_id?: string;
  project_id?: string;
}

/**
 * スクリプトプロパティからSlackの認証情報を取得する
 * @returns Slack設定オブジェクト
 * @throws 設定が見つからない場合はエラー
 */
function getSlackConfig(): SlackConfig {
  const scriptProperties = PropertiesService.getScriptProperties();

  const token = scriptProperties.getProperty('SLACK_BOT_TOKEN');
  const userToken = scriptProperties.getProperty('SLACK_USER_TOKEN');
  const channelName = scriptProperties.getProperty('SLACK_CHANNEL_NAME');

  if (!token || !userToken || !channelName) {
    throw new Error(
      'Slack設定が見つかりません。setupCredentials()関数を実行して設定を保存してください。'
    );
  }

  return { token, userToken, channelName };
}

/**
 * 同一ファイルイベントの重複処理を防ぐためのチェック
 * @param data Slackから受信したイベントデータ
 * @returns 重複している場合はtrue、新規の場合はfalse
 */
function isDuplicateFileEvent(data: any): boolean {
  try {
    if (!data.event) return false;

    // ファイル共有イベントを特定
    const isFileEvent =
      data.event.type === 'file_shared' ||
      (data.event.type === 'message' && data.event.subtype === 'file_share');

    if (!isFileEvent) return false;

    // イベント情報を取得
    const channelId = data.event.channel || data.event.channel_id;
    const userId = data.event.user || data.event.user_id;

    // ファイルIDを取得（イベントタイプによって場所が異なる）
    let fileId;
    if (data.event.file_id) {
      fileId = data.event.file_id;
    } else if (data.event.files && data.event.files.length > 0) {
      fileId = data.event.files[0].id;
    }

    if (!channelId || !fileId) return false;

    // 重複確認のための一意キーを作成
    const eventKey = `${fileId}_${channelId}_${userId}`;
    logInfo(`イベントキー: ${eventKey}`);

    // キャッシュをチェック
    const cache = CacheService.getScriptCache();
    const cacheKey = `processed_file_${eventKey}`;
    const cachedValue = cache.get(cacheKey);

    if (cachedValue) {
      logInfo(`重複ファイルイベントを検出: ${eventKey}`);
      return true;
    }

    // 処理済みとしてマーク（5分間有効）
    cache.put(cacheKey, 'processed', 300);
    logInfo(`新規ファイルイベントとして記録: ${eventKey}`);
    return false;
  } catch (error) {
    logError(`エラー: ${error}`);
    return false; // エラー時は重複と判定せず処理を続行
  }
}

/**
 * Slackからのイベントを処理するWebアプリケーションのエントリーポイント
 * @param e HTTPリクエストイベント
 * @returns テキスト応答
 */
function doPost(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  const data = JSON.parse(e.postData.contents);

  // SlackのURL検証に対応
  if (data.type === 'url_verification') {
    logInfo('🔍 URL検証リクエストを処理します');
    return ContentService.createTextOutput(data.challenge);
  }

  logInfo('🔍 doPost関数が呼び出されました');
  logInfo('🔍 受信データ: ' + e.postData.contents);

  logInfo(
    '🔍 イベントタイプ: ' + (data.event ? data.event.type : 'イベントなし')
  );
  logInfo(
    '🔍 イベントサブタイプ: ' +
      (data.event ? data.event.subtype : 'サブタイプなし')
  );

  // メッセージイベント以外は処理しない
  if (!data.event || data.event.type !== 'message') {
    logInfo('メッセージイベントではありません');
    return ContentService.createTextOutput('Not a message event');
  }

  logInfo('🔍 メッセージイベントを受信しました');
  const event = data.event;

  // ファイル共有イベント以外は処理しない
  if (event.subtype !== 'file_share') {
    logInfo('❌ ファイル共有イベントではありません: ' + event.subtype);
    return ContentService.createTextOutput('Not a file share event');
  }

  // リクエスト重複チェック
  if (isDuplicateFileEvent(data)) {
    logInfo('⚠️ 重複イベントを検出しました: ' + data.event);
    return ContentService.createTextOutput('Duplicate event');
  }

  logInfo('🔍 ファイル共有イベントです');

  try {
    processVoiceMemo(event);
  } catch (error) {
    logError('❌ エラー発生: ' + JSON.stringify(error));
  }

  logInfo('🔍 doPost処理を完了しました');
  return ContentService.createTextOutput('Event received');
}

/**
 * ボイスメモを処理して最適な文字起こし結果を得る
 * @param event Slackイベントオブジェクト
 */
function processVoiceMemo(event: any): void {
  try {
    // ファイル情報を取得
    const file = event.files[0];
    const fileInfo = getFileInfo(file.id);
    
    // 文字起こし戦略
    let finalTranscription = '';
    let transcriptionSource = '';
    let slackTranscription = '';
    let googleTranscription = '';
    
    // 1. Slackの文字起こし結果を取得
    if (fileInfo?.file?.transcription?.status === 'complete' && 
        fileInfo.file.transcription.preview?.content) {
      
      slackTranscription = fileInfo.file.transcription.preview.content;
      const locale = fileInfo.file.transcription.locale || 'unknown';
      
      logInfo(`Slack文字起こし (${locale}): ${slackTranscription}`);
      
      // 続きがある場合は注記
      if (fileInfo.file.transcription.preview.has_more) {
        slackTranscription += " (続きがあります)";
      }
    }
    
    // 2. Google Speech-to-Textによる文字起こし
    // Slackの結果が短すぎるか英語の場合は特に実行
    const needsGoogleAPI = !slackTranscription || 
                          slackTranscription.length < 10 || 
                          (fileInfo?.file?.transcription?.locale === 'en-US');
    
    if (needsGoogleAPI) {
      const audioBlob = downloadFile(file.url_private);
      
      if (audioBlob) {
        googleTranscription = transcribeAudio(audioBlob);
        logInfo(`Google文字起こし: ${googleTranscription}`);
      }
    }
    
    // 3. 最適な文字起こし結果の選択
    if (googleTranscription && 
        googleTranscription !== '文字起こしできる内容がありませんでした。' &&
        googleTranscription.length > (slackTranscription.length * 1.2)) {
      // Google APIの結果の方が十分に長い場合はそれを使用
      finalTranscription = googleTranscription;
      transcriptionSource = 'Google Speech-to-Text';
    } else if (slackTranscription) {
      // Slackの結果が十分であれば使用
      finalTranscription = slackTranscription;
      transcriptionSource = 'Slack';
    } else if (googleTranscription) {
      // Googleの結果のみがある場合
      finalTranscription = googleTranscription;
      transcriptionSource = 'Google Speech-to-Text';
    } else {
      // どちらも結果がない場合
      finalTranscription = '文字起こしできる内容がありませんでした。';
      transcriptionSource = 'なし';
    }
    
    logInfo(`✅ 文字起こし結果 (${transcriptionSource}): ${finalTranscription}`);
    
    // 文字起こし結果を投稿
    postTranscription(event.channel, finalTranscription);
    logInfo('✅ 文字起こし結果を投稿しました');
    
    // 元のメッセージを削除（試行）
    try {
      deleteOriginalMessage(event.channel, event.ts);
      logInfo('✅ 元のボイスメモを削除しました');
    } catch (error) {
      logWarning('⚠️ 元のボイスメモを削除できませんでした: ' + error);
    }
    
  } catch (error) {
    logError('❌ 音声処理エラー: ' + JSON.stringify(error));
  }
}

/**
 * Slackのチャンネル情報を取得
 * @param channelId チャンネルID
 * @returns チャンネル情報オブジェクト
 */
function getChannelInfo(channelId: string): any {
  logInfo('🔍 getChannelInfo関数が呼び出されました: ' + channelId);

  const SLACK_CONFIG = getSlackConfig();

  const url = `https://slack.com/api/conversations.info?channel=${channelId}`;
  logInfo('🔍 リクエストURL: ' + url);

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());

    logInfo('🔍 APIレスポンス: ' + response.getContentText());

    if (!responseData.ok) {
      logError('❌ チャンネル情報の取得に失敗: ' + responseData.error);
      throw new Error(`Failed to get channel info: ${responseData.error}`);
    }

    return responseData.channel;
  } catch (error) {
    logError('❌ チャンネル情報取得エラー: ' + JSON.stringify(error));
    throw error;
  }
}

/**
 * Slackからファイル情報を取得
 * @param fileId ファイルID
 * @returns ファイル情報オブジェクト、取得失敗時はnull
 */
function getFileInfo(fileId: string): any {
  logInfo(`ファイル情報を取得します: ${fileId}`);

  const SLACK_CONFIG = getSlackConfig();

  const url = `https://slack.com/api/files.info?file=${fileId}`;
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());

    logInfo(`APIレスポンス: ${response.getResponseCode()}`);

    if (!responseData.ok) {
      logError(`ファイル情報取得エラー: ${responseData.error}`);
      return null;
    }

    return responseData;
  } catch (error) {
    logError(`APIエラー: ${error}`);
    return null;
  }
}

/**
 * Slackからファイルをダウンロード
 * @param fileUrl ファイルURL
 * @returns ダウンロードしたBlobオブジェクト、失敗時はnull
 */
function downloadFile(fileUrl: string): GoogleAppsScript.Base.Blob | null {
  logInfo('🔍 downloadFile関数が呼び出されました: ' + fileUrl);

  const SLACK_CONFIG = getSlackConfig();

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.token}`,
    },
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(fileUrl, options);
    const responseCode = response.getResponseCode();
    logInfo('🔍 ダウンロードレスポンスコード: ' + responseCode);

    if (responseCode === 200) {
      return response.getBlob();
    } else {
      logError(
        '❌ ファイルダウンロードエラー: ステータスコード ' + responseCode
      );
      return null;
    }
  } catch (error) {
    logError('❌ ファイルダウンロードエラー: ' + JSON.stringify(error));
    return null;
  }
}

/**
 * 音声ファイルを文字起こし
 * @param audioBlob 音声データのBlobオブジェクト
 * @returns 文字起こしテキスト
 */
/**
 * 音声ファイルを文字起こし - 高度な認識設定
 * @param audioBlob 音声データのBlobオブジェクト
 * @returns 文字起こしテキスト
 */
function transcribeAudio(audioBlob: GoogleAppsScript.Base.Blob): string {
  logInfo('🔍 transcribeAudio関数が呼び出されました');
  
  try {
    // Google Cloud APIキーを取得
    const apiKeyJson = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLOUD_API_KEY');
    if (!apiKeyJson) {
      throw new Error('Speech-to-Text API設定が見つかりません。setupSpeechToTextAPI()関数を実行してください。');
    }
    
    // 音声をBase64にエンコード
    const base64Audio = Utilities.base64Encode(audioBlob.getBytes());
    
    // サービスアカウントキーをパース
    const serviceAccount = JSON.parse(apiKeyJson);
    
    // JWTトークンを生成
    const jwt = generateJWT(serviceAccount);
    
    // アクセストークンを取得
    const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      muteHttpExceptions: true
    });
    
    logInfo('Token response code: ' + tokenResponse.getResponseCode());
    
    const tokenData = JSON.parse(tokenResponse.getContentText());
    if (!tokenData.access_token) {
      throw new Error('アクセストークンを取得できませんでした: ' + tokenResponse.getContentText());
    }
    
    const accessToken = tokenData.access_token;
    
    // Slackボイスメモに最適化したGoogle Cloud Speech-to-Text APIリクエスト
    const requestData = {
      config: {
        // encodingとsampleRateHertz省略 - 自動検出が最適
        languageCode: 'ja-JP',
        alternativeLanguageCodes: ['en-US'], // バイリンガル対応（日本語・英語）
        
        // モデル選択 - ボイスメモは通常短めなので適切なモデルを選択
        model: 'latest_short',
        useEnhanced: true, // 拡張モデルを使用
        
        // 認識精度向上のための設定
        enableAutomaticPunctuation: true, // 自動的に句読点を入れる
        enableWordConfidence: true,       // 単語ごとの信頼度を取得
        profanityFilter: false,           // フィルタリングなし
        maxAlternatives: 3,               // 最大3つの代替候補を取得
        
        // より自然な音声認識のための設定
        enableSpokenPunctuation: false,   // 句読点の読み上げは変換しない
        enableSpokenEmojis: true,         // 「ハート」などの絵文字は変換する
        
        // メタデータ設定
        metadata: {
          interactionType: 'DICTATION',          // 口述/メモ
          recordingDeviceType: 'SMARTPHONE',     // スマートフォンでの録音
          microphoneDistance: 'NEARFIELD',       // 近距離マイク
          originalMediaType: 'AUDIO',            // 音声録音
          audioTopic: 'voice memo',              // ボイスメモ
          industryNaicsCodeOfAudio: 519190       // その他の情報サービス
        },
        
        // 音声に特化したコンテキスト（オプション）
        speechContexts: [
          {
            phrases: [
              // よく使われる可能性のあるビジネス用語やIT用語
              "スラック", "ボイスメモ", "文字起こし", "プロジェクト", "タスク",
              "ミーティング", "アジェンダ", "クラウド", "サーバー", "API",
              "スプレッドシート", "ドキュメント", "プレゼンテーション"
            ],
            boost: 10 // これらの単語を優先的に認識
          }
        ]
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
    
    // 最新のAPIエンドポイントを使用
    const response = UrlFetchApp.fetch('https://speech.googleapis.com/v1/speech:recognize', options);
    
    logInfo('API response code: ' + response.getResponseCode());
    const responseText = response.getContentText();
    logInfo('API response summary: ' + responseText.substring(0, 200) + '...');
    
    const responseData = JSON.parse(responseText);
    
    // 課金情報の記録
    if (responseData.totalBilledTime) {
      logInfo('課金時間: ' + responseData.totalBilledTime);
    }
    
    // 結果の処理と信頼度による選別
    if (responseData.results && responseData.results.length > 0) {
      // 認識された結果をすべて格納
      const allTranscripts = [];
      let bestConfidence = 0;
      let bestTranscript = '';
      
      for (const result of responseData.results) {
        if (result.alternatives && result.alternatives.length > 0) {
          // 各セグメントで最も信頼度の高い結果を選択
          const alternative = result.alternatives[0];
          const transcript = alternative.transcript || '';
          const confidence = alternative.confidence || 0;
          
          // 信頼度情報を記録
          logInfo(`部分文字起こし - 信頼度: ${confidence.toFixed(2)}, テキスト: ${transcript}`);
          
          // 全体で最も信頼度の高い部分を記録
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestTranscript = transcript;
          }
          
          allTranscripts.push(transcript);
        }
      }
      
      // 結果をつなげて返す
      if (allTranscripts.length > 0) {
        const fullTranscription = allTranscripts.join(' ').trim();
        logInfo(`最終文字起こし結果 (信頼度: ${bestConfidence.toFixed(2)}): ${fullTranscription}`);
        return fullTranscription;
      } else if (bestTranscript) {
        // 最も信頼度の高い部分だけでも返す
        return bestTranscript;
      }
    }
    
    // 認識結果がない場合
    return '文字起こしできる内容がありませんでした。';
  } catch (error) {
    logError('Transcription error: ' + JSON.stringify(error));
    return `音声の文字起こし中にエラーが発生しました: ${error}`;
  }
}

/**
 * JWTトークンを生成
 * @param serviceAccount サービスアカウント情報
 * @returns 生成されたJWTトークン
 */
function generateJWT(serviceAccount: GcpMinimalServiceAccount): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };

  const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const encodedClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claim));

  const signature = Utilities.computeRsaSha256Signature(
    `${encodedHeader}.${encodedClaim}`,
    serviceAccount.private_key
  );

  return `${encodedHeader}.${encodedClaim}.${Utilities.base64EncodeWebSafe(
    signature
  )}`;
}

/**
 * 文字起こし結果をSlackに投稿
 * @param channelId 投稿先チャンネルID
 * @param text 投稿するテキスト
 */
function postTranscription(channelId: string, text: string): void {
  logInfo(
    '🔍 postTranscription関数が呼び出されました: チャンネル=' + channelId
  );

  const SLACK_CONFIG = getSlackConfig();

  const url = 'https://slack.com/api/chat.postMessage';
  const payload = {
    channel: channelId,
    text: `📝 *ボイスメモの文字起こし*:\n${text}`,
    mrkdwn: true,
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());

    logInfo('🔍 メッセージ投稿レスポンス: ' + response.getContentText());

    if (!responseData.ok) {
      logError('❌ メッセージ投稿エラー: ' + responseData.error);
      throw new Error(`Failed to post message: ${responseData.error}`);
    }
  } catch (error) {
    logError('❌ メッセージ投稿エラー: ' + JSON.stringify(error));
    throw error;
  }
}

/**
 * 元のボイスメモメッセージを削除
 * @param channelId チャンネルID
 * @param timestamp 削除するメッセージのタイムスタンプ
 */
function deleteOriginalMessage(channelId: string, timestamp: string): void {
  logInfo(
    '🔍 deleteOriginalMessage関数が呼び出されました: チャンネル=' +
      channelId +
      ', タイムスタンプ=' +
      timestamp
  );

  const SLACK_CONFIG = getSlackConfig();

  const url = 'https://slack.com/api/chat.delete';
  const payload = {
    channel: channelId,
    ts: timestamp,
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.userToken}`, // メッセージ削除にはユーザートークンが必要
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());

    logInfo('🔍 メッセージ削除レスポンス: ' + response.getContentText());

    if (!responseData.ok) {
      logError('❌ メッセージ削除エラー: ' + responseData.error);
      throw new Error(`Failed to delete message: ${responseData.error}`);
    }
  } catch (error) {
    logError('❌ メッセージ削除エラー: ' + JSON.stringify(error));
    throw error;
  }
}

/**
 * 通常のメッセージを投稿
 * @param channelId 投稿先チャンネルID
 * @param text 投稿するテキスト
 */
function postMessage(channelId: string, text: string): void {
  logInfo('🔍 postMessage関数が呼び出されました: チャンネル=' + channelId);

  const SLACK_CONFIG = getSlackConfig();

  const url = 'https://slack.com/api/chat.postMessage';
  const payload = {
    channel: channelId,
    text: text,
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    logInfo('🔍 メッセージ投稿レスポンス: ' + response.getContentText());
  } catch (error) {
    logError('❌ 通常メッセージ投稿エラー: ' + JSON.stringify(error));
  }
}

/**
 * Slackイベント購読のためのURL検証エンドポイント
 * @returns アプリ動作確認メッセージ
 */
function doGet(): GoogleAppsScript.Content.TextOutput {
  logInfo('🔍 doGet関数が呼び出されました');
  return ContentService.createTextOutput('Slack Voice Converter is running!');
}

/**
 * GASをウェブアプリケーションとしてデプロイするための設定
 */
function setup(): void {
  logInfo('🔍 setup関数が呼び出されました');
  logInfo('Setup completed. Deploy as web app to use with Slack Events API.');
  logInfo(
    'Remember to run the setupCredentials() function to save your Slack tokens securely.'
  );
}

// ログ出力関連の関数
// -------------------------------------------

/**
 * スプレッドシートにログを出力するためのモジュール
 */

// スプレッドシートIDを保存するためのキー
const SPREADSHEET_ID_KEY = 'SPREADSHEET_ID_KEY';

/**
 * スプレッドシートにログを出力する関数
 * @param level ログレベル（INFO, DEBUG, WARN, ERROR など）
 * @param message メッセージ
 */
function logToSheet(level: string, message: string): void {
  try {
    const spreadsheetId =
      PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_KEY);
    if (!spreadsheetId) {
      console.log(`[${level}]: ${message}`);
      return;
    }

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('Logs');
    if (!sheet) {
      console.log('ログシートが見つかりません');
      return;
    }

    // ログを追加
    const timestamp = new Date().toISOString();
    sheet.appendRow([timestamp, level, message]);

    // 行数が1000を超えた場合は古いログを削除
    const maxRows = 1000;
    const currentRows = sheet.getLastRow();
    if (currentRows > maxRows) {
      sheet.deleteRows(2, currentRows - maxRows);
    }
  } catch (error) {
    console.log(`ログ出力エラー: ${error}`);
    console.log(`元のメッセージ [${level}]: ${message}`);
  }
}

/**
 * INFO レベルのログを出力
 * @param message メッセージ
 */
function logInfo(message: string): void {
  logToSheet('INFO', message);
}

/**
 * WARNING レベルのログを出力
 * @param message メッセージ
 */
function logWarning(message: string): void {
  logToSheet('WARN', message);
}

/**
 * ERROR レベルのログを出力
 * @param message メッセージ
 */
function logError(message: string): void {
  logToSheet('ERROR', message);
}

/**
 * スプレッドシートIDを設定する関数
 */
function setupLogSpreadsheet(): void {
  const spreadsheetId = '1ri9NwlIg5oKrdN17Y0lpbOCBOAtlg2WVAvCiWYYAfqs';
  PropertiesService.getScriptProperties().setProperty(
    SPREADSHEET_ID_KEY,
    spreadsheetId
  );

  // シートが存在するか確認し、なければ作成
  const ss = SpreadsheetApp.openById(spreadsheetId);
  if (!ss.getSheetByName('Logs')) {
    const sheet = ss.insertSheet('Logs');
    // ヘッダー行を設定
    sheet.appendRow(['Timestamp', 'Level', 'Message']);
    // 列の幅を調整
    sheet.setColumnWidth(1, 180); // Timestamp
    sheet.setColumnWidth(2, 70); // Level
    sheet.setColumnWidth(3, 600); // Message
    // ヘッダー行を固定
    sheet.setFrozenRows(1);
  }

  // テストログを書き込み
  logToSheet(
    'INFO',
    'setupLogSpreadsheet: ログスプレッドシートの設定が完了しました: ' +
      spreadsheetId
  );
}

// デバッグおよび設定用の関数
// -------------------------------------------

/**
 * 特定の名前のトリガーを削除
 * @param handlerName 削除するトリガーのハンドラー関数名
 */
function deleteTrigger(handlerName: string): void {
  logInfo('🔍 deleteTrigger関数が呼び出されました: ' + handlerName);

  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
      logInfo('✅ トリガーを削除しました: ' + handlerName);
    }
  }
}

/**
 * キャッシュをクリアする関数（デバッグ用）
 */
function clearEventCache(): void {
  CacheService.getScriptCache().remove('processed_event_keys');
  logInfo('イベントキャッシュをクリアしました');
}

/**
 * Slackトークンを初期設定する関数
 */
function setupCredentials(): void {
  // 実際のトークンと設定を入力
  const botToken = 'xoxb-your-bot-token-here'; // ボットトークン
  const userToken = 'xoxp-your-user-token-here'; // ユーザートークン
  const channelName = 'times-your-channel-name'; // 自分専用のtimesチャンネル名

  // スクリプトプロパティに保存
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('SLACK_BOT_TOKEN', botToken);
  scriptProperties.setProperty('SLACK_USER_TOKEN', userToken);
  scriptProperties.setProperty('SLACK_CHANNEL_NAME', channelName);

  logInfo('認証情報を安全に保存しました。');
}

/**
 * Google Cloud Speech-to-Text API のキーを設定する関数
 */
function setupSpeechToTextAPI(): void {
  const apiKey = JSON.stringify({
    // ここにGoogle Cloud サービスアカウントのJSONキーを貼り付ける
    // 例: {"type": "service_account", "project_id": "your-project", ...}
  });

  PropertiesService.getScriptProperties().setProperty(
    'GOOGLE_CLOUD_API_KEY',
    apiKey
  );
  logInfo('Speech-to-Text API設定を保存しました。');
}

/**
 * console の挙動確認デバッグ関数
 */
function exampleLogging() {
  // 通常のログ
  logInfo('通常のメッセージ');

  // 警告ログ
  logWarning('警告メッセージ');

  // エラーログ
  logError('エラーメッセージ');
}

/**
 * OAuth認証コードを交換してユーザートークンを取得
 */
function exchangeOAuthCode() {
  const clientId = 'CLIEND_ID';
  const clientSecret = 'CLIEND_SECRET';
  const code =
    '2186695524.8679197372295.ae740a3fbda636ba991e455658f02cfe846acb18143591247603a6f9e17e2cdb';
  const redirectUri = 'https://example.com';

  const url = 'https://slack.com/api/oauth.v2.access';
  const payload = {
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    redirect_uri: redirectUri,
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    logInfo('🔍 OAuth交換結果: ' + JSON.stringify(result, null, 2));

    // 必要に応じてトークンをスクリプトプロパティに保存
    if (result.ok) {
      const scriptProperties = PropertiesService.getScriptProperties();
      scriptProperties.setProperty(
        'SLACK_USER_TOKEN',
        result.authed_user.access_token
      );
    }
  } catch (error) {
    logError('❌ OAuth交換中にエラー: ' + JSON.stringify(error));
  }
}

/**
 * Slackアプリの詳細情報を確認する関数
 */
function checkSlackAppDetails() {
  const SLACK_CONFIG = getSlackConfig();

  const teamInfoUrl = 'https://slack.com/api/team.info';
  const authTestUrl = 'https://slack.com/api/auth.test';

  const teamInfoOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.token}`,
    },
  };

  const authTestOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.token}`,
    },
  };

  try {
    // チーム情報の取得
    const teamInfoResponse = UrlFetchApp.fetch(teamInfoUrl, teamInfoOptions);
    const teamInfoResult = JSON.parse(teamInfoResponse.getContentText());
    logInfo('🔍 チーム情報: ' + JSON.stringify(teamInfoResult, null, 2));

    // 認証テスト
    const authTestResponse = UrlFetchApp.fetch(authTestUrl, authTestOptions);
    const authTestResult = JSON.parse(authTestResponse.getContentText());
    logInfo('🔍 認証テスト結果: ' + JSON.stringify(authTestResult, null, 2));
  } catch (error) {
    logError('❌ Slack API確認中にエラー: ' + JSON.stringify(error));
  }
}

/**
 * デバッグ用：モックイベントでdoPost関数をテスト
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
          files: [
            {
              mimetype: 'audio/wav',
              url_private:
                'https://spookies.slack.com/files/U049SJHCF/F08KZ841GUX/audio_message.m4a',
            },
          ],
          ts: '1234567890.123456',
        },
      }),
    },
  } as GoogleAppsScript.Events.DoPost;

  // doPost関数を手動でテスト
  logInfo('🔍 デバッグ: モックイベントでテスト開始');
  try {
    doPost(mockEvent);
  } catch (error) {
    logError('❌ デバッグ中にエラー: ' + JSON.stringify(error));
  }
}

/**
 * テスト用：特定のチャンネルにメッセージを送信するテスト
 */
function testPostMessage(): string {
  // Slack設定を取得
  const SLACK_CONFIG = getSlackConfig();
  logInfo('Slack設定: ' + JSON.stringify(SLACK_CONFIG));

  // テストメッセージを送信
  logInfo('テストメッセージを送信します');
  return 'これはテストメッセージです。Slack Voice Converterからの送信テストです。';
}
