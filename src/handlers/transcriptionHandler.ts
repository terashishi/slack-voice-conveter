import { logInfo, logError } from '../services/logging';
import { getFileInfo, getFullTranscription, postTranscription, deleteFile } from '../services/slack';

/**
 * ボイスメモの文字起こし処理を行う
 * @param event Slackイベント
 */
export function processVoiceMemo(event: SlackEvent): void {
  try {
    const fileId = event.files && event.files[0] && event.files[0].id;
    const channelId = event.channel;
    const timestamp = event.ts;
    
    if (!fileId) {
      logError("ファイルIDが見つかりません");
      return;
    }
    
    // まず初回チェック
    const fileInfo = getFileInfo(fileId);
    
    if (!fileInfo || !fileInfo.file) {
      logError("ファイル情報の取得に失敗しました");
      return;
    }
    
    const file = fileInfo.file;
    
    // 音声ファイルであることを確認
    if (!file.mimetype || !(/^audio\/|^video\/|.*mp4$/.test(file.mimetype))) {
      logInfo(`音声ファイルではありません: ${file.mimetype}`);
      return;
    }
    
    logInfo('✅ 音声ファイルを検出しました');
    
    // トランスクリプションの状態を確認
    if (file.transcription && file.transcription.status === 'complete') {
      // すでに完了している場合は即時処理
      processTranscription(file, channelId, timestamp);
    } else {
      // まだ処理中の場合は遅延処理をスケジュール
      schedulePendingTranscription(fileId, channelId, timestamp);
    }
  } catch (error) {
    logError(`ボイスメモ処理エラー: ${JSON.stringify(error)}`);
  }
}

/**
 * 保留中のトランスクリプション処理をスケジュールする
 * @param fileId ファイルID
 * @param channelId チャンネルID
 * @param timestamp タイムスタンプ
 */
function schedulePendingTranscription(fileId: string, channelId: string, timestamp: string): void {
  // トリガーを設定して10秒後に再試行
  ScriptApp.newTrigger('retryTranscriptionCheck')
    .timeBased()
    .after(10000) // 10秒後
    .create();
  
  // 再試行に必要な情報をプロパティに保存
  const pendingData: PendingTranscription = {
    fileId: fileId,
    channelId: channelId,
    timestamp: timestamp,
    retryCount: 0,
    maxRetries: 6 // 最大6回試行（計60秒）
  };
  
  PropertiesService.getScriptProperties().setProperty(
    'PENDING_TRANSCRIPTION', 
    JSON.stringify(pendingData)
  );
  
  logInfo(`トランスクリプション処理をスケジュール: ファイルID=${fileId}, 10秒後に再試行`);
}

/**
 * トランスクリプション再チェック関数 - タイムトリガーから呼び出される
 */
export function retryTranscriptionCheck(): void {
  try {
    // 保存された情報を取得
    const pendingDataStr = PropertiesService.getScriptProperties().getProperty('PENDING_TRANSCRIPTION');
    if (!pendingDataStr) {
      logError("再試行情報が見つかりません");
      return;
    }
    
    const pendingData = JSON.parse(pendingDataStr) as PendingTranscription;
    const { fileId, channelId, timestamp, retryCount, maxRetries } = pendingData;
    
    logInfo(`トランスクリプション再チェック: ファイルID=${fileId}, 試行回数=${retryCount+1}/${maxRetries}`);
    
    // ファイル情報を再取得
    const fileInfo = getFileInfo(fileId);
    
    if (!fileInfo || !fileInfo.file) {
      logError("ファイル情報の再取得に失敗");
      cleanupPendingTranscription();
      return;
    }
    
    const file = fileInfo.file;
    
    // トランスクリプションの状態を確認
    if (file.transcription && file.transcription.status === 'complete') {
      // 完了していたら処理実行
      logInfo("トランスクリプション完了を検出、処理を実行します");
      processTranscription(file, channelId, timestamp);
      
      // 保存データをクリア
      cleanupPendingTranscription();
    } else if (retryCount >= maxRetries) {
      // 最大試行回数に達した場合
      logInfo("最大試行回数に達しました。最新の状態で処理を実行します");
      processTranscription(file, channelId, timestamp);
      
      // 保存データをクリア
      cleanupPendingTranscription();
    } else {
      // まだ処理中の場合は再度スケジュール
      PropertiesService.getScriptProperties().setProperty(
        'PENDING_TRANSCRIPTION', 
        JSON.stringify({
          ...pendingData,
          retryCount: retryCount + 1
        })
      );
      
      // 次の再試行をスケジュール
      ScriptApp.newTrigger('retryTranscriptionCheck')
        .timeBased()
        .after(10000) // 10秒後
        .create();
    }
  } catch (error) {
    logError(`再試行処理エラー: ${JSON.stringify(error)}`);
    cleanupPendingTranscription();
  }
}

/**
 * 保留中のトランスクリプション情報をクリアする
 */
function cleanupPendingTranscription(): void {
  PropertiesService.getScriptProperties().deleteProperty('PENDING_TRANSCRIPTION');
  
  // 未使用のトリガーを全て削除
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'retryTranscriptionCheck') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  logInfo('保留中のトランスクリプション情報をクリアしました');
}

/**
 * Slackのトランスクリプト機能を使用して処理
 * @param file ファイル情報オブジェクト
 * @param channelId チャンネルID
 * @param timestamp タイムスタンプ
 */
export function processTranscription(file: SlackFile, channelId: string, timestamp: string): void {
  logInfo('Slackのトランスクリプト機能を使用します');
  let transcription = '文字起こしできる内容がありませんでした。';
  
  try {
    // ファイルIDを保存（後で削除するため）
    const fileId = file.id;
    
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
            const fullTranscription = getFullTranscription(fileId);
            
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
        
        // 文字起こし結果を投稿
        postTranscription(channelId, transcription);
        
        // ファイルを削除
        deleteFile(fileId);
        
      } else if (file.transcription.status === 'processing') {
        // まだ処理中の場合は、処理中メッセージを送信
        // 元のファイルは残しておく（トランスクリプト完了後にSlack内で確認できるように）
        logInfo('トランスクリプションは処理中です。処理中メッセージを送信します。');
        postTranscription(channelId, '音声の文字起こしは処理中です。しばらくするとSlack内でファイルのトランスクリプトが利用可能になります。');
      } else if (file.transcription.status === 'failed') {
        // 失敗した場合
        logInfo('Slackのトランスクリプションが失敗しました。');
        postTranscription(channelId, '音声の文字起こしに失敗しました。');
      } else {
        logInfo(`不明なトランスクリプション状態: ${file.transcription.status}`);
        postTranscription(channelId, '文字起こし状態を確認できませんでした。');
      }
    } else {
      logInfo('このファイルにはトランスクリプション情報がありません。');
      postTranscription(channelId, 'このファイルには文字起こし情報がありません。');
    }
    
  } catch (error) {
    logError(`Slackトランスクリプション処理エラー: ${error}`);
    // エラーがあっても最低限の結果を投稿
    postTranscription(channelId, transcription);
  }
}

/**
 * 特定のファイルのトランスクリプション状態を手動で確認する
 * @param fileId ファイルID
 */
export function checkFileTranscription(fileId: string): void {
  logInfo(`ファイル ${fileId} のトランスクリプション状態を確認します`);
  
  const fileInfo = getFileInfo(fileId);
  
  if (!fileInfo || !fileInfo.file) {
    logError("ファイル情報の取得に失敗しました");
    return;
  }
  
  const file = fileInfo.file;
  
  if (file.transcription) {
    logInfo(`トランスクリプション状態: ${file.transcription.status}`);
    
    if (file.transcription.preview && file.transcription.preview.content) {
      const preview = file.transcription.preview.content;
      logInfo(`プレビュー内容: ${preview.substring(0, 100)}${preview.length > 100 ? '...' : ''}`);
      logInfo(`続きがあるか: ${file.transcription.preview.has_more ? 'はい' : 'いいえ'}`);
      
      if (file.transcription.preview.has_more) {
        const fullTranscription = getFullTranscription(fileId);
        if (fullTranscription) {
          logInfo(`完全版内容: ${fullTranscription.substring(0, 100)}${fullTranscription.length > 100 ? '...' : ''}`);
        }
      }
    } else {
      logInfo('トランスクリプション内容はありません');
    }
  } else {
    logInfo('このファイルにはトランスクリプション情報がありません');
  }
}
