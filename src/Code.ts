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
  logInfo('🔍 doPost関数が呼び出されました');
  logInfo('🔍 受信データ: ' + e.postData.contents);

  const data = JSON.parse(e.postData.contents);

  // SlackのURL検証に対応
  if (data.type === 'url_verification') {
    logInfo('🔍 URL検証リクエストを処理します');
    return ContentService.createTextOutput(data.challenge);
  }

  // チャンネルID + タイムスタンプで一意のIDを作成
  if (!data.event || !data.event.channel || !data.event.ts) {
    logInfo('イベントデータが不足しています');
    return ContentService.createTextOutput('Invalid event data');
  }

  const eventId = data.event.channel + '_' + data.event.ts;
  logInfo('🔍 代替イベントID作成: ' + eventId);

  // 重複イベントチェック
  if (isDuplicateFileEvent(data)) {
    logInfo('⚠️ 重複イベントを検出しました: ' + eventId);
    return ContentService.createTextOutput('Duplicate event');
  }

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
 * ボイスメモ処理のメイン関数
 * @param event Slackイベントオブジェクト
 */
function processVoiceMemo(event: any): void {
  // Slack設定を取得
  const SLACK_CONFIG = getSlackConfig();
  logInfo(
    '🔍 Slack設定を取得しました: チャンネル名=' + SLACK_CONFIG.channelName
  );

  // チャンネル情報を取得
  logInfo('🔍 チャンネルID: ' + event.channel);
  const channelInfo = getChannelInfo(event.channel);
  logInfo('🔍 チャンネル名: ' + channelInfo.name);

  // チャンネル名が設定と一致しない場合は処理しない
  if (channelInfo.name !== SLACK_CONFIG.channelName) {
    logInfo(
      '❌ チャンネル名が一致しません: ' +
        channelInfo.name +
        ' != ' +
        SLACK_CONFIG.channelName
    );
    return;
  }

  // ファイルが添付されていない場合は処理しない
  if (!event.files || event.files.length === 0) {
    logInfo('❌ ファイルが添付されていません');
    return;
  }

  const file = event.files[0];

  // ファイル情報が不足している場合は追加で取得
  if (!file.url_private || file.file_access === 'check_file_info') {
    logInfo('🔍 ファイル情報を取得します: ' + file.id);
    const fileInfo = getFileInfo(file.id);
    logInfo('ファイル情報: ' + JSON.stringify(fileInfo));

    // fileInfo.file が存在すればそれを使用
    if (fileInfo && fileInfo.file) {
      file.url_private = fileInfo.file.url_private;
      file.mimetype = fileInfo.file.mimetype;
    }
  }

  logInfo(`🔍 ファイルタイプ: ${file.mimetype}, URL: ${file.url_private}`);

  // 音声ファイル以外は処理しない
  if (!file.mimetype || !file.mimetype.startsWith('audio/')) {
    logInfo('❌ 音声ファイルではありません: ' + file.mimetype);
    return;
  }

  logInfo('✅ 音声ファイルを検出しました');
  logInfo('🔍 音声ファイルを処理します');

  // 音声ファイルをダウンロード
  logInfo('🔍 ファイルURL: ' + file.url_private);
  const audioBlob = downloadFile(file.url_private);

  if (!audioBlob) {
    logInfo('❌ ファイルのダウンロードに失敗しました');
    return;
  }

  logInfo('✅ ファイルのダウンロードに成功しました');

  // 音声を文字起こし
  const transcription = transcribeAudio(audioBlob);
  logInfo('✅ 文字起こし結果: ' + transcription);

  // 文字起こし結果を投稿
  postTranscription(event.channel, transcription);
  logInfo('✅ 文字起こし結果を投稿しました');

  // 元のボイスメモメッセージを削除
  deleteOriginalMessage(event.channel, event.ts);
  logInfo('✅ 元のボイスメモを削除しました');
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
function transcribeAudio(audioBlob: GoogleAppsScript.Base.Blob): string {
  logInfo('🔍 transcribeAudio関数が呼び出されました');

  try {
    // Google Cloud APIキーを取得
    const apiKeyJson = PropertiesService.getScriptProperties().getProperty(
      'GOOGLE_CLOUD_API_KEY'
    );
    if (!apiKeyJson) {
      throw new Error(
        'Speech-to-Text API設定が見つかりません。setupSpeechToTextAPI()関数を実行してください。'
      );
    }

    // 音声をBase64にエンコード
    const base64Audio = Utilities.base64Encode(audioBlob.getBytes());

    // サービスアカウントキーをパース
    const serviceAccount = JSON.parse(apiKeyJson) as GcpMinimalServiceAccount;

    // JWTトークンを生成
    const jwt = generateJWT(serviceAccount);

    // アクセストークンを取得
    const tokenResponse = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/token',
      {
        method: 'post',
        payload: {
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        },
        muteHttpExceptions: true,
      }
    );

    logInfo('Token response code: ' + tokenResponse.getResponseCode());
    logInfo('Token response text: ' + tokenResponse.getContentText());

    const tokenData = JSON.parse(tokenResponse.getContentText());

    if (!tokenData.access_token) {
      throw new Error(
        'アクセストークンを取得できませんでした: ' +
          tokenResponse.getContentText()
      );
    }

    const accessToken = tokenData.access_token;

    // Google Cloud Speech-to-Text APIリクエスト
    const requestData = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 44100,
        languageCode: 'ja-JP',
        model: 'default',
        enableAutomaticPunctuation: true,
      },
      audio: {
        content: base64Audio,
      },
    };

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      payload: JSON.stringify(requestData),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(
      'https://speech.googleapis.com/v1/speech:recognize',
      options
    );

    logInfo('API response code: ' + response.getResponseCode());
    logInfo('API response text: ' + response.getContentText());

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
