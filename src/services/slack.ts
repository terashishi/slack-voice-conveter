import { getSlackConfig } from '../config';
import { logInfo, logError, logWarning } from './logging';

/**
 * Slackからファイル情報を取得する
 * @param fileId ファイルID
 * @returns ファイル情報オブジェクト、失敗時はnull
 */
export function getFileInfo(fileId: string): SlackApiResponse | null {
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
export function getChannelInfo(channelId: string): SlackApiResponse | null {
  logInfo('チャンネル情報を取得します: ' + channelId);

  const SLACK_CONFIG = getSlackConfig();

  const url = `https://slack.com/api/conversations.info?channel=${channelId}`;
  logInfo('リクエストURL: ' + url);

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

    if (!responseData.ok) {
      logError('チャンネル情報の取得に失敗: ' + responseData.error);
      return null;
    }

    return responseData;
  } catch (error) {
    logError('チャンネル情報取得エラー: ' + JSON.stringify(error));
    return null;
  }
}

/**
 * 完全版のトランスクリプションを取得（必要な場合）
 * @param fileId ファイルID
 * @returns 完全なトランスクリプションテキスト、または失敗時はnull
 */
export function getFullTranscription(fileId: string): string | null {
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
 * 文字起こし結果を投稿する
 * @param channelId 投稿先チャンネルID
 * @param text 投稿するテキスト
 * @returns 投稿成功のブール値
 */
export function postTranscription(channelId: string, text: string): boolean {
  logInfo(`文字起こし結果を投稿します: チャンネル=${channelId}`);

  const SLACK_CONFIG = getSlackConfig();
  
  // ユーザートークンを使用（ボットトークンではなく）
  const token = SLACK_CONFIG.userToken; 

  const url = 'https://slack.com/api/chat.postMessage';
  
  // 投稿するテキストを整形
  const formattedText = text.trim() || ":speech_balloon::arrow_right: :memo: … :x:";
  
  const payload = {
    channel: channelId,
    text: formattedText, 
    as_user: true,  // 重要: これを追加してユーザーとして投稿
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${token}`,
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
 * Slackのファイルを削除する
 * @param fileId 削除するファイルのID
 * @returns 削除成功のブール値
 */
export function deleteFile(fileId: string): boolean {
  logInfo(`ファイル削除開始: ファイルID=${fileId}`);

  const SLACK_CONFIG = getSlackConfig();

  // ユーザートークンが設定されているか確認
  if (!SLACK_CONFIG.userToken) {
    logError('ユーザートークンが設定されていません。ファイルを削除できません。');
    return false;
  }

  const url = 'https://slack.com/api/files.delete';
  const payload = {
    file: fileId
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${SLACK_CONFIG.userToken}`, // ファイル削除にはユーザートークンが必要
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    logInfo(`ファイル削除リクエスト送信中... ファイルID: ${fileId}`);
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    logInfo(`ファイル削除レスポンスコード: ${responseCode}`);
    
    if (responseCode !== 200) {
      logError(`ファイル削除HTTP エラー: ${responseCode}`);
      return false;
    }
    
    const responseData = JSON.parse(response.getContentText());

    if (!responseData.ok) {
      // エラーの種類を確認
      if (responseData.error === 'cant_delete_file') {
        logError('ファイル削除権限エラー: このファイルを削除する権限がありません');
        logInfo('ユーザートークンの権限設定を確認してください。ファイル削除には User Token Scopes の files:write が必要です。');
        return false;
      } else if (responseData.error === 'file_not_found') {
        logError('ファイルが見つかりません');
        return false;
      } else {
        logError(`ファイル削除エラー: ${responseData.error}`);
        return false;
      }
    }
    
    logInfo(`✅ ファイルID: ${fileId} を削除しました`);
    return true;
  } catch (error) {
    logError(`❌ ファイル削除エラー: ${JSON.stringify(error)}`);
    return false;
  }
}
