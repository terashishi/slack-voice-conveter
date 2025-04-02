import { logInfo, logWarning, logError } from './services/logging';

/**
 * スクリプトプロパティからSlackの認証情報を取得する
 * @returns Slack設定オブジェクト
 * @throws 設定が見つからない場合はエラー
 */
export function getSlackConfig(): SlackConfig {
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
 * Slack認証情報を設定する
 * @param botToken ボットトークン（必須）
 * @param userToken ユーザートークン（ファイル削除に必要）
 * @param channelName 監視するチャンネル名（任意）
 */
export function setupCredentials(botToken?: string, userToken?: string, channelName?: string): void {
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
    logWarning('ユーザートークンが指定されていません。ファイル削除ができない可能性があります。');
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
 * @param token 検証するトークン
 * @param tokenType トークンタイプ（表示用）
 */
export function validateToken(token: string, tokenType: string): void {
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
export function checkAllSettings(): void {
  logInfo('アプリケーション設定の確認を開始します');
  
  const scriptProperties = PropertiesService.getScriptProperties();
  const allProperties = scriptProperties.getProperties();
  
  // Slack設定の確認
  const botToken = allProperties['SLACK_BOT_TOKEN'];
  const userToken = allProperties['SLACK_USER_TOKEN'];
  const channelName = allProperties['SLACK_CHANNEL_NAME'];
  
  logInfo(`Slack設定: ボットトークン=${botToken ? '設定済み' : '未設定'}, ユーザートークン=${userToken ? '設定済み' : '未設定'}, チャンネル=${channelName || '未設定'}`);
  
  // ログスプレッドシート設定の確認
  const spreadsheetId = allProperties['SPREADSHEET_ID_KEY'];
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
