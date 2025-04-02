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

/**
 * テスト用の模擬的なイベントを生成する関数
 */
function testWithMockEvent(): void {
  // ファイル共有イベントのモック
  const mockEventFileShare = {
    postData: {
      contents: JSON.stringify({
        token: "test_token",
        team_id: "test_team",
        api_app_id: "test_app",
        event: {
          type: "message",
          subtype: "file_share",
          files: [
            {
              id: "test_file_id",
              filetype: "m4a",
              mimetype: "audio/mp4"
            }
          ],
          channel: "test_channel",
          ts: "1234567890.123456",
          user: "test_user"
        },
        type: "event_callback",
        event_id: "test_event_id"
      })
    }
  } as GoogleAppsScript.Events.DoPost;
  
  logInfo('テスト用のモックイベントでdoPost関数を実行します');
  
  try {
    // doPost関数を呼び出す
    doPost(mockEventFileShare);
    logInfo('モックイベントの処理が完了しました');
  } catch (error) {
    logError(`モックイベント処理エラー: ${error}`);
  }
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
 * 改善されたイベントハンドリング
 * - 重複処理を防止するためのキー作成を改善
 * - file_sharedとmessage/file_shareイベントを正しく統合処理
 */
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  logInfo('🔍 doPost関数が呼び出されました');
  
  try {
    // 受信データ
    const data = JSON.parse(e.postData.contents);
    // 短縮版のログ（大きすぎる場合があるため）
    logInfo(`🔍 受信データタイプ: ${data.type}, イベントタイプ: ${data.event?.type}, サブタイプ: ${data.event?.subtype}`);
    
    // URL検証
    if (data.type === 'url_verification') {
      logInfo('🔍 URL検証リクエストを処理します');
      return ContentService.createTextOutput(data.challenge);
    }
    
    // イベントなしは無視
    if (!data.event) {
      logInfo('イベントデータがありません');
      return ContentService.createTextOutput('No event data');
    }
    
    // イベントの重複確認用キーを作成
    const eventKey = createEventKey(data);
    
    // 重複イベントのチェック
    if (isDuplicateEvent(eventKey)) {
      logInfo(`重複イベントを検出しました: ${eventKey}`);
      return ContentService.createTextOutput('Duplicate event');
    }
    
    // ボイスメモファイル共有処理（file_sharedイベント または message/file_shareイベント）
    if (data.event.type === 'file_shared') {
      logInfo('ファイル共有イベント（file_shared）を検出しました');
      // このイベントはファイルIDのみを含む通知、実際の処理はあとでmessage/file_shareで行う
      return ContentService.createTextOutput('File shared event received');
    } 
    else if (data.event.type === 'message' && data.event.subtype === 'file_share') {
      logInfo('ファイル共有メッセージイベント（message/file_share）を検出しました');
      
      // ファイル情報と音声ファイルの確認
      if (!data.event.files || data.event.files.length === 0) {
        logInfo('ファイル情報が含まれていません');
        return ContentService.createTextOutput('No file information');
      }
      
      const fileInfo = data.event.files[0];
      logInfo(`ファイル情報: id=${fileInfo.id}, type=${fileInfo.filetype || 'unknown'}`);
      
      // m4aまたはmp3、mp4などの音声ファイルのみ処理
      if (!/^(m4a|mp3|mp4|wav|mpeg)$/i.test(fileInfo.filetype)) {
        logInfo(`音声ファイルではありません: ${fileInfo.filetype}`);
        return ContentService.createTextOutput('Not an audio file');
      }
      
      // ボイスメモ処理の実行
      processVoiceMemo(data.event);
    }
    else {
      logInfo(`サポート外のイベント: type=${data.event.type}, subtype=${data.event.subtype}`);
    }
  } catch (error) {
    logError(`❌ doPost処理エラー: ${JSON.stringify(error)}`);
  }
  
  logInfo('🔍 doPost処理を完了しました');
  return ContentService.createTextOutput('Event received');
}

// イベントキー作成（重複検出用）の改善
function createEventKey(data: any): string {
  const event = data.event;
  let fileId = '';
  
  // ファイルIDの取得（イベントタイプによって位置が異なる）
  if (event.type === 'file_shared') {
    fileId = event.file_id || (event.file && event.file.id) || '';
  } else if (event.type === 'message' && event.subtype === 'file_share') {
    fileId = event.files && event.files.length > 0 ? event.files[0].id : '';
  }
  
  const channelId = event.channel || event.channel_id || '';
  const userId = event.user || event.user_id || '';
  const timestamp = event.ts || event.event_ts || '';
  
  return `${fileId}_${channelId}_${userId}_${timestamp}`;
}

// 重複イベント検出（有効期限を30秒に短縮）
function isDuplicateEvent(eventKey: string): boolean {
  if (!eventKey) return false;
  
  const cache = CacheService.getScriptCache();
  const cacheKey = `processed_event_${eventKey}`;
  
  if (cache.get(cacheKey)) {
    return true;
  }
  
  // 処理済みとしてマーク（30秒間有効 - 同一イベントの重複処理を防ぐ）
  cache.put(cacheKey, 'processed', 30); 
  return false;
}
/**
 * Slackのトランスクリプト機能を利用した音声メモ処理
 * Google Cloud Speech-to-Text APIを使用せず、Slackのネイティブトランスクリプトを活用
 */
function processVoiceMemo(event: any): void {
  try {
    // ファイル情報取得準備
    const fileId = event.files && event.files[0] && event.files[0].id;
    
    if (!fileId) {
      logError("ファイルIDが見つかりません");
      return;
    }
    
    logInfo(`ファイルID: ${fileId} の処理を開始します`);
    
    // Slack APIでファイル情報を取得（改善版）
    const fileInfo = getFileInfo(fileId);
    
    if (!fileInfo || !fileInfo.file) {
      logError("ファイル情報の取得に失敗しました");
      return;
    }
    
    const file = fileInfo.file;
    
    // ファイル情報のログ出力を詳細に
    logInfo(`ファイル詳細: id=${file.id}, type=${file.mimetype}, name=${file.name}`);
    
    // MIMEタイプでの音声ファイル確認（より広範なサポート）
    if (!file.mimetype || !(/^audio\/|^video\/|.*mp4$/.test(file.mimetype))) {
      logInfo(`音声ファイルではありません: ${file.mimetype}`);
      return;
    }
    
    logInfo('✅ 音声ファイルを検出しました');
    
    // Slackのトランスクリプションを取得して処理
    useSlackTranscription(file, event.channel, event.ts);
    
  } catch (error) {
    logError(`ボイスメモ処理エラー: ${JSON.stringify(error)}`);
  }
}

/**
 * Slackのトランスクリプション機能を使用
 * @param file ファイル情報オブジェクト
 * @param channelId チャンネルID
 * @param timestamp タイムスタンプ
 */
function useSlackTranscription(file: any, channelId: string, timestamp: string): void {
  logInfo('Slackのトランスクリプト機能を使用します');
  let transcription = '文字起こしできる内容がありませんでした。';
  
  try {
    // Slackのトランスクリプションチェック
    if (file.transcription) {
      logInfo(`Slackトランスクリプション状態: ${file.transcription.status}`);
      
      if (file.transcription.status === 'complete') {
        // トランスクリプションが完了している場合
        if (file.transcription.preview && file.transcription.preview.content) {
          transcription = file.transcription.preview.content;
          logInfo(`Slackトランスクリプト内容: ${transcription}`);
          
          // プレビューのみで一部の場合は完全版を取得
          if (file.transcription.preview.has_more) {
            logInfo('トランスクリプションの続きがあります。完全版を取得します。');
            const fullTranscription = getFullTranscription(file.id);
            
            if (fullTranscription) {
              transcription = fullTranscription;
              logInfo(`完全版トランスクリプト取得成功: ${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}`);
            } else {
              transcription += " (続きがあります)";
              logInfo('完全版トランスクリプトの取得に失敗しました。プレビュー版を使用します。');
            }
          }
        } else {
          logInfo('トランスクリプションが完了していますが、内容が見つかりません');
        }
      } else if (file.transcription.status === 'processing') {
        // まだ処理中の場合、待機してから再試行するオプション
        logInfo('トランスクリプションは処理中です。しばらく待ってから再試行することをお勧めします。');
        transcription = '音声の文字起こしは処理中です。しばらくしてから再度確認してください。';
      } else if (file.transcription.status === 'failed') {
        // 失敗した場合
        logInfo('Slackのトランスクリプションが失敗しました。');
        transcription = '音声の文字起こしに失敗しました。';
      } else {
        logInfo(`不明なトランスクリプション状態: ${file.transcription.status}`);
      }
    } else {
      logInfo('このファイルにはトランスクリプション情報がありません。');
    }
    
    // 文字起こし結果をSlackに投稿
    postTranscription(channelId, transcription);
    
    // 元のメッセージを削除（オプション）
    try {
      deleteOriginalMessage(channelId, timestamp);
      logInfo('元のメッセージを削除しました');
    } catch (error) {
      logWarning(`元メッセージの削除に失敗: ${error}`);
    }
    
  } catch (error) {
    logError(`Slackトランスクリプション処理エラー: ${error}`);
    // エラーがあっても最低限の結果を投稿
    postTranscription(channelId, transcription);
  }
}

/**
 * 完全版のトランスクリプションを取得（必要な場合）
 * @param fileId ファイルID
 * @returns 完全なトランスクリプションテキスト、または失敗時はnull
 */
function getFullTranscription(fileId: string): string | null {
  logInfo(`ファイル ${fileId} の完全版トランスクリプションを取得します`);
  
  const SLACK_CONFIG = getSlackConfig();
  
  // Slack API files.info エンドポイントにトランスクリプションの全文を取得するパラメータを追加
  const url = `https://slack.com/api/files.info?file=${fileId}&get_transcript=true`;
  
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
    const responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      logError(`完全版トランスクリプション取得エラー: ステータスコード ${responseCode}`);
      return null;
    }
    
    const responseData = JSON.parse(response.getContentText());
    
    if (!responseData.ok) {
      logError(`API応答エラー: ${responseData.error}`);
      return null;
    }
    
    // 完全なトランスクリプションが含まれているか確認
    if (responseData.file && 
        responseData.file.transcription && 
        responseData.file.transcription.full && 
        responseData.file.transcription.full.content) {
      return responseData.file.transcription.full.content;
    } else if (responseData.file && 
              responseData.file.transcription && 
              responseData.file.transcription.preview && 
              responseData.file.transcription.preview.content) {
      // 完全版がなければプレビュー版を返す
      return responseData.file.transcription.preview.content;
    }
    
    logWarning('完全版トランスクリプションが応答に含まれていません');
    return null;
    
  } catch (error) {
    logError(`完全版トランスクリプション取得中のエラー: ${error}`);
    return null;
  }
}

/**
 * 改善されたファイル情報取得
 */
function getFileInfo(fileId: string): any {
  logInfo(`ファイル情報を取得します: ${fileId}`);
  
  const SLACK_CONFIG = getSlackConfig();
  
  const url = `https://slack.com/api/files.info?file=${fileId}`;
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${SLACK_CONFIG.token}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  try {
    logInfo(`APIリクエスト: ${url}`);
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    logInfo(`APIレスポンス: ${responseCode}`);
    
    if (responseCode !== 200) {
      logError(`API応答エラー: ${responseCode}`);
      return null;
    }
    
    const responseText = response.getContentText();
    const responseData = JSON.parse(responseText);
    
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
 * 改善された文字起こし結果投稿
 * @param channelId 投稿先チャンネルID
 * @param text 投稿するテキスト
 * @returns 投稿成功のブール値
 */
function postTranscription(channelId: string, text: string): boolean {
  logInfo(`🔍 文字起こし結果を投稿します: チャンネル=${channelId}`);

  const SLACK_CONFIG = getSlackConfig();

  const url = 'https://slack.com/api/chat.postMessage';
  
  // 投稿するテキストを整形（リッチテキスト形式）
  const formattedText = text.trim() || "文字起こしできる内容がありませんでした。";
  
  // リッチな表示のためのブロックを作成
  const blocks = [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*📝 ボイスメモの文字起こし:*\n${formattedText}`
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "Slack Voice Converterにより自動文字起こし"
        }
      ]
    }
  ];

  const payload = {
    channel: channelId,
    text: `📝 ボイスメモの文字起こし: ${formattedText}`, // ブロックがない場合のフォールバック
    blocks: blocks,
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
    logInfo('メッセージ投稿リクエスト送信中...');
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    logInfo(`メッセージ投稿レスポンスコード: ${responseCode}`);
    
    if (responseCode !== 200) {
      logError(`メッセージ投稿HTTP エラー: ${responseCode}`);
      return false;
    }
    
    const responseData = JSON.parse(response.getContentText());

    if (!responseData.ok) {
      logError(`メッセージ投稿API エラー: ${responseData.error}`);
      return false;
    }
    
    logInfo('✅ 文字起こし結果を投稿しました');
    return true;
  } catch (error) {
    logError(`❌ メッセージ投稿エラー: ${JSON.stringify(error)}`);
    return false;
  }
}

/**
 * 改善された元のボイスメモメッセージ削除
 * @param channelId チャンネルID
 * @param timestamp 削除するメッセージのタイムスタンプ
 * @returns 削除成功のブール値
 */
function deleteOriginalMessage(channelId: string, timestamp: string): boolean {
  logInfo(
    `🔍 元のメッセージ削除開始: チャンネル=${channelId}, タイムスタンプ=${timestamp}`
  );

  const SLACK_CONFIG = getSlackConfig();

  // ユーザートークンが設定されているか確認
  if (!SLACK_CONFIG.userToken) {
    logError('❌ ユーザートークンが設定されていません。メッセージを削除できません。');
    return false;
  }

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
    logInfo('メッセージ削除リクエスト送信中...');
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    logInfo(`メッセージ削除レスポンスコード: ${responseCode}`);
    
    if (responseCode !== 200) {
      logError(`メッセージ削除HTTP エラー: ${responseCode}`);
      return false;
    }
    
    const responseData = JSON.parse(response.getContentText());

    if (!responseData.ok) {
      // エラーの種類を確認
      if (responseData.error === 'cant_delete_message') {
        logError('❌ メッセージ削除権限エラー: 他ユーザーのメッセージを削除する権限がありません');
        logInfo('ユーザートークンの権限設定を確認してください。削除には User Token Scopes の chat:write と groups:write または channels:write が必要です。');
        return false;
      } else if (responseData.error === 'message_not_found') {
        logError('❌ メッセージが見つかりません');
        return false;
      } else if (responseData.error === 'channel_not_found') {
        logError('❌ チャンネルが見つかりません');
        return false;
      } else {
        logError(`❌ メッセージ削除エラー: ${responseData.error}`);
        return false;
      }
    }
    
    logInfo('✅ 元のメッセージを削除しました');
    return true;
  } catch (error) {
    logError(`❌ メッセージ削除エラー: ${JSON.stringify(error)}`);
    return false;
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
 * 改善されたログ記録と設定管理
 */

// スプレッドシートIDを保存するためのキー
const SPREADSHEET_ID_KEY = 'SPREADSHEET_ID_KEY';

/**
 * 詳細なログをスプレッドシートに出力する関数
 * @param level ログレベル（INFO, DEBUG, WARN, ERROR など）
 * @param message メッセージ
 */
function logToSheet(level: string, message: string): void {
  try {
    // コンソールにも出力（デバッグ時に便利）
    console.log(`[${level}]: ${message}`);
    
    const spreadsheetId =
      PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_KEY);
    if (!spreadsheetId) {
      return; // スプレッドシートが設定されていない場合は早期リターン
    }

    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('Logs');
    if (!sheet) {
      console.log('ログシートが見つかりません');
      return;
    }

    // ログエントリを作成
    const timestamp = new Date().toISOString();
    const functionName = getFunctionName();
    sheet.appendRow([timestamp, level, functionName, message]);

    // 行数が1000を超えた場合は古いログを削除（パフォーマンス対策）
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
 * 呼び出し元の関数名を取得する補助関数
 */
function getFunctionName(): string {
  try {
    throw new Error();
  } catch (e: any) {
    const stack = e.stack.toString().split('\n');
    if (stack.length >= 3) {
      const callerLine = stack[2].trim();
      const functionMatch = callerLine.match(/at ([^(]+)/);
      if (functionMatch && functionMatch[1]) {
        return functionMatch[1].trim();
      }
    }
    return 'unknown';
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
 * DEBUG レベルのログを出力（開発時のみ使用）
 * @param message メッセージ
 */
function logDebug(message: string): void {
  logToSheet('DEBUG', message);
}

/**
 * スプレッドシートIDを設定する関数（改善版）
 */
function setupLogSpreadsheet(): void {
  // 既存のスプレッドシートがあるか確認
  const existingId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_KEY);
  
  let spreadsheetId: string;
  let ss: GoogleAppsScript.Spreadsheet.Spreadsheet;
  
  if (existingId) {
    try {
      // 既存のスプレッドシートを開く
      ss = SpreadsheetApp.openById(existingId);
      spreadsheetId = existingId;
      logInfo(`既存のログスプレッドシートを使用します: ${spreadsheetId}`);
    } catch (e) {
      // 既存のIDが無効な場合は新規作成
      logWarning(`既存のスプレッドシートが見つかりません: ${e}`);
      ss = SpreadsheetApp.create('Slack Voice Converter Logs');
      spreadsheetId = ss.getId();
    }
  } else {
    // 新規作成
    ss = SpreadsheetApp.create('Slack Voice Converter Logs');
    spreadsheetId = ss.getId();
    logInfo(`新しいログスプレッドシートを作成しました: ${spreadsheetId}`);
  }

  // スプレッドシートIDを保存
  PropertiesService.getScriptProperties().setProperty(
    SPREADSHEET_ID_KEY,
    spreadsheetId
  );

  // シートが存在するか確認し、なければ作成
  if (!ss.getSheetByName('Logs')) {
    const sheet = ss.insertSheet('Logs');
    // ヘッダー行を設定
    sheet.appendRow(['Timestamp', 'Level', 'Function', 'Message']);
    // 列の幅を調整
    sheet.setColumnWidth(1, 180); // Timestamp
    sheet.setColumnWidth(2, 70);  // Level
    sheet.setColumnWidth(3, 120); // Function
    sheet.setColumnWidth(4, 600); // Message
    // ヘッダー行を固定
    sheet.setFrozenRows(1);
    // ヘッダー行の書式設定
    sheet.getRange(1, 1, 1, 4).setBackground('#f3f3f3').setFontWeight('bold');
  }

  // 設定情報を記録
  logInfo('ログスプレッドシートの設定が完了しました');
  
  // スプレッドシートへのリンクをログに記録
  logInfo(`ログスプレッドシートURL: ${ss.getUrl()}`);
}

/**
 * 改善されたSlack認証情報設定関数
 */
function setupCredentials(botToken?: string, userToken?: string, channelName?: string): void {
  const scriptProperties = PropertiesService.getScriptProperties();
  
  // 既存の設定値を取得
  const existingBotToken = scriptProperties.getProperty('SLACK_BOT_TOKEN');
  const existingUserToken = scriptProperties.getProperty('SLACK_USER_TOKEN');
  const existingChannelName = scriptProperties.getProperty('SLACK_CHANNEL_NAME');
  
  // 新しい値または既存の値を使用
  const newBotToken = botToken || existingBotToken;
  const newUserToken = userToken || existingUserToken;
  const newChannelName = channelName || existingChannelName;
  
  // 値が提供されていない場合はエラー
  if (!newBotToken) {
    throw new Error('ボットトークンが指定されていません');
  }
  
  if (!newUserToken) {
    logWarning('ユーザートークンが指定されていません。メッセージの削除ができない可能性があります。');
  }
  
  if (!newChannelName) {
    logWarning('チャンネル名が指定されていません。特定のチャンネルに制限されません。');
  }
  
  // 値を保存
  scriptProperties.setProperty('SLACK_BOT_TOKEN', newBotToken);
  if (newUserToken) scriptProperties.setProperty('SLACK_USER_TOKEN', newUserToken);
  if (newChannelName) scriptProperties.setProperty('SLACK_CHANNEL_NAME', newChannelName);
  
  logInfo(`Slack認証情報を保存しました: ボットトークン=${newBotToken.substring(0, 5)}..., ユーザートークン=${newUserToken ? newUserToken.substring(0, 5) + '...' : 'なし'}, チャンネル=${newChannelName || 'すべて'}`);
  
  // トークンの検証
  if (newBotToken) {
    validateToken(newBotToken, 'ボット');
  }
  
  if (newUserToken) {
    validateToken(newUserToken, 'ユーザー');
  }
}

/**
 * トークンが有効か検証する関数
 */
function validateToken(token: string, tokenType: string): void {
  const url = 'https://slack.com/api/auth.test';
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());
    
    if (responseData.ok) {
      logInfo(`✅ ${tokenType}トークンの検証成功: チーム=${responseData.team}, ユーザー=${responseData.user}`);
    } else {
      logError(`❌ ${tokenType}トークンの検証失敗: ${responseData.error}`);
    }
  } catch (error) {
    logError(`❌ ${tokenType}トークンの検証中にエラー: ${error}`);
  }
}

/**
 * アプリの全設定を確認する関数
 */
function checkAllSettings(): void {
  logInfo('アプリケーション設定の確認を開始します');
  
  const scriptProperties = PropertiesService.getScriptProperties();
  const allProperties = scriptProperties.getProperties();
  
  // Slack設定の確認
  const botToken = allProperties['SLACK_BOT_TOKEN'];
  const userToken = allProperties['SLACK_USER_TOKEN'];
  const channelName = allProperties['SLACK_CHANNEL_NAME'];
  
  logInfo(`Slack設定: ボットトークン=${botToken ? '設定済み' : '未設定'}, ユーザートークン=${userToken ? '設定済み' : '未設定'}, チャンネル=${channelName || '未設定'}`);
  
  // ログスプレッドシート設定の確認
  const spreadsheetId = allProperties[SPREADSHEET_ID_KEY];
  logInfo(`ログスプレッドシート: ${spreadsheetId ? '設定済み' : '未設定'}`);
  
  if (spreadsheetId) {
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      logInfo(`ログスプレッドシート名: ${ss.getName()}, URL: ${ss.getUrl()}`);
    } catch (e) {
      logError(`ログスプレッドシートの取得エラー: ${e}`);
    }
  }
  
  // Webアプリケーションのデプロイ状態確認
  const deploymentId = ScriptApp.getService().getUrl();
  if (deploymentId && deploymentId.length > 0) {
    logInfo(`Webアプリケーション URL: ${deploymentId}`);
  } else {
    logWarning('Webアプリケーションがデプロイされていません');
  }
  
  logInfo('アプリケーション設定の確認が完了しました');
}

