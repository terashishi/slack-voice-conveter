import { logInfo } from '../services/logging';

/**
 * イベントの重複を検出するためのキーを作成
 * @param data Slackイベントデータ
 * @returns 重複検出用のユニークキー
 */
export function createEventKey(data: any): string {
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

/**
 * 重複イベントかどうかを検出する
 * @param eventKey イベントキー
 * @returns 重複している場合はtrue
 */
export function isDuplicateEvent(eventKey: string): boolean {
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
 * ファイルが音声ファイルか判定する
 * @param filetype ファイルタイプ
 * @param mimetype MIMEタイプ
 * @returns 音声ファイルならtrue
 */
export function isAudioFile(filetype: string | undefined, mimetype: string | undefined): boolean {
  if (!filetype && !mimetype) return false;
  
  // ファイル拡張子での判定
  const validFileTypes = /^(m4a|mp3|mp4|wav|mpeg|ogg|aac)$/i;
  if (filetype && validFileTypes.test(filetype)) {
    return true;
  }
  
  // MIMEタイプでの判定
  if (mimetype && (/^audio\/|^video\/|.*mp4$/.test(mimetype))) {
    return true;
  }
  
  return false;
}

/**
 * テスト用の模擬的なイベントを生成する
 * @returns 模擬的なイベントオブジェクト
 */
export function createMockEvent(): GoogleAppsScript.Events.DoPost {
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
  
  logInfo('テスト用のモックイベントを作成しました');
  return mockEventFileShare;
}
