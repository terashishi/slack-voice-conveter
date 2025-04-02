import { logInfo, logError } from '../services/logging';
import { isAudioFile, createEventKey, isDuplicateEvent } from '../utils/helpers';
import * as transcriptionHandler from './transcriptionHandler';

/**
 * Slackイベントを処理する
 * @param data Slackイベントデータ
 * @returns 処理結果テキスト
 */
export function handleEvent(data: any): string {
  logInfo('イベント処理を開始します');
  
  try {
    // イベントなしは無視
    if (!data.event) {
      logInfo('イベントデータがありません');
      return 'No event data';
    }
    
    // URL検証
    if (data.type === 'url_verification') {
      logInfo('URL検証リクエストを処理します');
      return data.challenge;
    }
    
    // イベントの重複確認用キーを作成
    const eventKey = createEventKey(data);
    
    // ボイスメモファイル共有処理（file_sharedイベント または message/file_shareイベント）
    if (data.event.type === 'file_shared') {
      logInfo('ファイル共有イベント（file_shared）を検出しました');
      // このイベントはファイルIDのみを含む通知、実際の処理はあとでmessage/file_shareで行う
      return 'File shared event received';
    } 
    else if (data.event.type === 'message' && data.event.subtype === 'file_share') {
      return handleFileShareEvent(data, eventKey);
    }
    else {
      logInfo(`サポート外のイベント: type=${data.event.type}, subtype=${data.event.subtype}`);
      return 'Unsupported event type';
    }
  } catch (error) {
    logError(`イベント処理エラー: ${JSON.stringify(error)}`);
    return 'Error processing event';
  }
}

/**
 * ファイル共有イベントを処理する
 * @param data イベントデータ
 * @param eventKey 重複検出用キー
 * @returns 処理結果テキスト
 */
function handleFileShareEvent(data: any, eventKey: string): string {
  logInfo('ファイル共有メッセージイベント（message/file_share）を検出しました');
  
  // ファイル情報と音声ファイルの確認
  if (!data.event.files || data.event.files.length === 0) {
    logInfo('ファイル情報が含まれていません');
    return 'No file information';
  }
  
  const fileInfo = data.event.files[0];
  logInfo(`ファイル情報: id=${fileInfo.id}, type=${fileInfo.filetype || 'unknown'}`);
  
  // 音声ファイルのみ処理
  if (!isAudioFile(fileInfo.filetype, fileInfo.mimetype)) {
    logInfo(`音声ファイルではありません: ${fileInfo.filetype}`);
    return 'Not an audio file';
  }
  
  // 重複イベントのチェック
  if (isDuplicateEvent(eventKey)) {
    logInfo(`重複イベントを検出しました: ${eventKey}`);
    return 'Duplicate event';
  }
  
  // ボイスメモ処理の実行
  transcriptionHandler.processVoiceMemo(data.event);
  return 'Processing voice memo';
}

/**
 * テスト用にモックイベントで処理を実行する
 * @param mockEvent モックイベント
 */
export function testWithMockEvent(mockEvent: GoogleAppsScript.Events.DoPost): void {  
  logInfo('テスト用のモックイベントでdoPost関数を実行します');
  
  try {
    // イベントデータをパース
    const data = JSON.parse(mockEvent.postData.contents);
    
    // イベントを処理
    const result = handleEvent(data);
    logInfo(`モックイベント処理結果: ${result}`);
  } catch (error) {
    logError(`モックイベント処理エラー: ${error}`);
  }
}
