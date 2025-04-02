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
 * Speech-to-Text APIのレスポンス型を定義
 */
interface SpeechToTextResponse {
  results?: {
    alternatives?: {
      transcript?: string;
      confidence?: number;
    }[];
  }[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  totalBilledTime?: string;
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
 * 改善されたファイル処理
 * - サムネイルURLではなく正規のダウンロードURLを使用
 * - ファイル情報取得を改善
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
    logInfo(`URL情報: 直接URL=${file.url_private}、ダウンロードURL=${file.url_private_download || "未定義"}`);
    
    // MIMEタイプでの音声ファイル確認（より広範なサポート）
    if (!file.mimetype || !(/^audio\/|^video\/|.*mp4$/.test(file.mimetype))) {
      logInfo(`音声ファイルではありません: ${file.mimetype}`);
      return;
    }
    
    logInfo('✅ 音声ファイルを検出しました');
    
    // ダウンロードURLの確保（ダウンロード専用URLがあればそれを、なければ直接URLを使用）
    const downloadUrl = file.url_private_download || file.url_private;
    if (!downloadUrl) {
      logError("ダウンロードURLが見つかりません");
      return;
    }
    
    // 音声ファイルをダウンロード
    logInfo(`🔍 ファイルダウンロード開始: ${downloadUrl}`);
    const audioBlob = downloadFile(downloadUrl);
    
    if (!audioBlob) {
      logError("ファイルのダウンロードに失敗しました");
      // Slackの文字起こし結果があれば利用（フォールバック）
      if (file.transcription && file.transcription.status === 'complete') {
        handleTranscriptionWithoutAudio(file, event.channel, event.ts);
      } else {
        logError("ファイルのダウンロードに失敗し、Slackの文字起こしも利用できません");
      }
      return;
    }
    
    // 音声ファイルの情報をログ
    logInfo(`音声ファイルサイズ: ${audioBlob.getBytes().length} バイト`);
    
    // ファイルのコンテンツタイプを確認
    const contentType = audioBlob.getContentType();
    logInfo(`音声ファイル形式: ${contentType}`);
    
    // 文字起こし処理
    logInfo('文字起こし処理を開始します');
    const transcriptionText = transcribeAudio(audioBlob);
    logInfo(`文字起こし結果: ${transcriptionText.substring(0, 100)}${transcriptionText.length > 100 ? '...' : ''}`);
    
    // 文字起こし結果をSlackに投稿
    postTranscription(event.channel, transcriptionText);
    
    // 元のメッセージを削除
    try {
      deleteOriginalMessage(event.channel, event.ts);
      logInfo('元のメッセージを削除しました');
    } catch (error) {
      logWarning(`元メッセージの削除に失敗: ${error}`);
    }
    
  } catch (error) {
    logError(`ボイスメモ処理エラー: ${JSON.stringify(error)}`);
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
 * 改善されたファイルダウンロード
 */
function downloadFile(fileUrl: string): GoogleAppsScript.Base.Blob | null {
  logInfo(`🔍 ファイルダウンロード開始: ${fileUrl}`);

  const SLACK_CONFIG = getSlackConfig();

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.token}`,
    },
    muteHttpExceptions: true,
  };

  try {
    logInfo('ダウンロードリクエスト送信中...');
    const response = UrlFetchApp.fetch(fileUrl, options);
    const responseCode = response.getResponseCode();
    logInfo(`🔍 ダウンロードレスポンスコード: ${responseCode}`);

    if (responseCode === 200) {
      const blob = response.getBlob();
      logInfo(`ダウンロード成功: ${blob.getName()}, サイズ: ${blob.getBytes().length} バイト`);
      return blob;
    } else {
      logError(`❌ ファイルダウンロードエラー: ステータスコード ${responseCode}`);
      return null;
    }
  } catch (error) {
    logError(`❌ ファイルダウンロードエラー: ${JSON.stringify(error)}`);
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
 * 改善された音声文字起こし - 認識問題の対応強化
 * @param audioBlob 音声データのBlobオブジェクト
 * @returns 文字起こしテキスト
 */
function transcribeAudio(audioBlob: GoogleAppsScript.Base.Blob): string {
  logInfo('🔍 文字起こし処理を開始します');
  
  try {
    // Google Cloud APIキーを取得
    const apiKeyJson = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLOUD_API_KEY');
    if (!apiKeyJson) {
      throw new Error('Speech-to-Text API設定が見つかりません。setupSpeechToTextAPI()関数を実行してください。');
    }
    
    // ファイル形式の確認とエンコード
    const contentType = audioBlob.getContentType() as string;
    logInfo(`ファイル形式: ${contentType}`);
    
    // サポートされる形式かチェック
    const supportedFormats = ['audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a', 'video/mp4'];
    if (!supportedFormats.includes(contentType) && !contentType.includes('audio/')) {
      logWarning(`非標準の音声形式: ${contentType} - 変換が必要かもしれません`);
    }
    
    // バイナリデータ取得とBase64エンコード
    const audioBytes = audioBlob.getBytes();
    logInfo(`音声データサイズ: ${audioBytes.length} バイト`);
    
    if (audioBytes.length === 0) {
      throw new Error('音声データが空です');
    }
    
    const base64Audio = Utilities.base64Encode(audioBytes);
    logInfo(`Base64エンコード完了: ${base64Audio.length} 文字`);
    
    // サービスアカウントキーをパース
    let serviceAccount: GcpMinimalServiceAccount;
    try {
      serviceAccount = JSON.parse(apiKeyJson);
      logInfo(`サービスアカウント: ${serviceAccount.client_email}`);
    } catch (e) {
      throw new Error(`サービスアカウント情報の解析に失敗: ${e}`);
    }
    
    // JWTトークンを生成
    logInfo('JWTトークン生成中...');
    const jwt = generateJWT(serviceAccount);
    
    // アクセストークンを取得
    logInfo('アクセストークン取得中...');
    const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      muteHttpExceptions: true
    });
    
    const tokenResponseCode = tokenResponse.getResponseCode();
    logInfo(`トークンレスポンスコード: ${tokenResponseCode}`);
    
    if (tokenResponseCode !== 200) {
      throw new Error(`アクセストークン取得エラー: ${tokenResponse.getContentText()}`);
    }
    
    const tokenData = JSON.parse(tokenResponse.getContentText());
    if (!tokenData.access_token) {
      throw new Error(`アクセストークンが返されませんでした: ${tokenResponse.getContentText()}`);
    }
    
    const accessToken = tokenData.access_token;
    logInfo('アクセストークン取得成功');
    
    // 言語設定の改善 - 日本語と英語の両方をサポート、主言語は日本語
    // Slackボイスメモに最適化したGoogle Cloud Speech-to-Text APIリクエスト
    const requestData = {
      config: {
        // 音声エンコーディングは自動検出に任せる
        languageCode: 'ja-JP',
        alternativeLanguageCodes: ['en-US'], // バイリンガル対応
        
        // 短時間音声に適したモデル
        model: 'latest_short',
        useEnhanced: true,
        
        // 認識精度向上のための設定
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        profanityFilter: false,
        maxAlternatives: 1,
        
        // 詳細設定
        enableSpokenPunctuation: true,
        enableSpokenEmojis: true,
        
        // 音声品質設定
        audioChannelCount: 1,  // モノラル（ボイスメモ）
        
        // メタデータ
        metadata: {
          interactionType: 'DICTATION',
          recordingDeviceType: 'SMARTPHONE',
          microphoneDistance: 'NEARFIELD',
          originalMediaType: 'AUDIO',
          audioTopic: 'voice memo'
        }
      },
      audio: {
        content: base64Audio
      }
    };
    
    // リクエスト情報のログ（機密情報以外）
    logInfo(`Speech APIリクエスト設定: 言語=${requestData.config.languageCode}, モデル=${requestData.config.model}`);
    
    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      payload: JSON.stringify(requestData),
      muteHttpExceptions: true
    };
    
    // Speech-to-Text API呼び出し
    logInfo('Google Speech-to-Text API呼び出し中...');
    const response = UrlFetchApp.fetch('https://speech.googleapis.com/v1/speech:recognize', options);
    
    const responseCode = response.getResponseCode();
    logInfo(`Speech API レスポンスコード: ${responseCode}`);
    
    if (responseCode !== 200) {
      throw new Error(`Speech API エラー: ${response.getContentText()}`);
    }
    
    const responseText = response.getContentText();
    const responseData = JSON.parse(responseText) as SpeechToTextResponse;
    
    // 結果の処理
    if (responseData.results && responseData.results.length > 0) {
      // すべての結果を連結
      const allTranscripts = responseData.results.map(result => {
        if (result.alternatives && result.alternatives.length > 0) {
          return result.alternatives[0].transcript || '';
        }
        return '';
      }).filter(text => text.trim().length > 0);
      
      const transcription = allTranscripts.join(' ').trim();
      
      if (transcription) {
        logInfo(`文字起こし成功: ${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}`);
        return transcription;
      }
    }
    
    // 結果がない場合は、Slackの内部文字起こしがあるかチェック
    logWarning('Speech APIからの文字起こし結果が空でした');
    return '文字起こしできる内容がありませんでした。';
    
  } catch (error) {
    logError(`文字起こしエラー: ${error}`);
    return `音声の文字起こし中にエラーが発生しました: ${error}`;
  }
}

/**
 * 音声なしでの文字起こし（Slackの結果だけを使用）- 改善版
 */
function handleTranscriptionWithoutAudio(file: any, channelId: string, timestamp: string): void {
  logInfo('Slackの文字起こし結果を使用します');
  let transcription = '文字起こしできる内容がありませんでした。';
  
  try {
    // Slackの文字起こしがあれば使用
    if (file.transcription) {
      logInfo(`Slack文字起こし状態: ${file.transcription.status}`);
      
      if (file.transcription.status === 'complete' && 
          file.transcription.preview && 
          file.transcription.preview.content) {
        
        transcription = file.transcription.preview.content;
        logInfo(`Slack文字起こし内容: ${transcription}`);
        
        // 続きがある場合
        if (file.transcription.preview.has_more) {
          transcription += " (続きがあります)";
          
          // 完全な文字起こしを取得するための追加APIコールも可能（オプション）
          // この例では省略
        }
      }
    } else {
      logInfo('Slackの文字起こし情報がありません');
    }
    
    // 文字起こし結果を投稿
    postTranscription(channelId, transcription);
    
    // 元のメッセージを削除
    deleteOriginalMessage(channelId, timestamp);
    
  } catch (error) {
    logError(`Slack文字起こし処理エラー: ${error}`);
    // エラーがあっても最低限の結果を投稿
    postTranscription(channelId, transcription);
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
 * 改善されたGoogle Cloud Speech-to-Text API設定関数
 */
function setupSpeechToTextAPI(apiKey?: string): void {
  const scriptProperties = PropertiesService.getScriptProperties();
  
  // 既存の設定を取得
  const existingApiKey = scriptProperties.getProperty('GOOGLE_CLOUD_API_KEY');
  
  // 新しい値または既存の値を使用
  const newApiKey = apiKey || existingApiKey;
  
  if (!newApiKey) {
    throw new Error('Google Cloud API Keyが指定されていません');
  }
  
  try {
    // APIキーが有効なJSONかチェック
    const parsedKey = JSON.parse(newApiKey);
    if (!parsedKey.private_key || !parsedKey.client_email) {
      throw new Error('APIキーに必要なフィールド（private_key, client_email）が含まれていません');
    }
    
    // APIキーを保存
    scriptProperties.setProperty('GOOGLE_CLOUD_API_KEY', newApiKey);
    
    logInfo(`Google Cloud Speech-to-Text API設定を保存しました: client_email=${parsedKey.client_email}`);
    
    // サービスアカウントのプロジェクトIDを記録
    if (parsedKey.project_id) {
      logInfo(`プロジェクトID: ${parsedKey.project_id}`);
    }
    
  } catch (error) {
    logError(`APIキー設定エラー: ${error}`);
    throw new Error('無効なGoogle Cloud APIキー形式です。サービスアカウントのJSONキーファイルの内容を使用してください。');
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
  
  // Google Cloud API設定の確認
  const apiKey = allProperties['GOOGLE_CLOUD_API_KEY'];
  logInfo(`Google Cloud API: ${apiKey ? '設定済み' : '未設定'}`);
  
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

