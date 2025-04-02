/**
 * @OnlyCurrentDoc
 * @Logging(true)
 */

import { logInfo, logError, setupLogSpreadsheet } from './services/logging';
import * as eventHandler from './handlers/eventHandler';
import * as transcriptionHandler from './handlers/transcriptionHandler';
import * as config from './config';
import { createMockEvent } from './utils/helpers';

/**
 * Slackイベント処理エンドポイント
 * @param e イベントオブジェクト
 * @returns テキスト出力
 */
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  logInfo('🔍 doPost関数が呼び出されました');
  
  try {
    // 受信データ
    const data = JSON.parse(e.postData.contents);
    
    // URL検証（Challenge Response）
    if (data.type === 'url_verification') {
      logInfo('🔍 URL検証リクエストを処理します');
      return ContentService.createTextOutput(data.challenge);
    }
  
    // 短縮版のログ（大きすぎる場合があるため）
    logInfo(`🔍 受信データタイプ: ${data.type}, イベントタイプ: ${data.event?.type}, サブタイプ: ${data.event?.subtype}`);
    
    // イベント処理
    const result = eventHandler.handleEvent(data);
    
    logInfo('🔍 doPost処理を完了しました');
    return ContentService.createTextOutput(result);
    
  } catch (error) {
    logError(`❌ doPost処理エラー: ${JSON.stringify(error)}`);
    return ContentService.createTextOutput('Error processing event');
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
 * テスト用の関数
 */
function testWithMockEvent(): void {
  const mockEvent = createMockEvent();
  eventHandler.testWithMockEvent(mockEvent);
}

/**
 * アプリケーションの初期設定
 */
function setup(): void {
  logInfo('🔍 setup関数が呼び出されました');
  logInfo('Setup completed. Deploy as web app to use with Slack Events API.');
  logInfo('Remember to run the setupCredentials() function to save your Slack tokens securely.');
}

// 以下、スクリプトプロパティの設定関数をエクスポート
// これらの関数は直接実行可能にする必要があるため、export しない

/**
 * Slack API の認証情報を設定する
 */
function setupCredentials(botToken?: string, userToken?: string, channelName?: string): void {
  config.setupCredentials(botToken, userToken, channelName);
}

/**
 * ログ記録用のスプレッドシートをセットアップする
 */
function setupSpreadsheet(): void {
  // services/logging からインポートしたものを使用
  setupLogSpreadsheet();
}

/**
 * 現在の設定を確認する
 */
function checkAllSettings(): void {
  config.checkAllSettings();
}

// トランスクリプション再試行トリガー用のグローバル関数
function retryTranscriptionCheck(): void {
  transcriptionHandler.retryTranscriptionCheck();
}

// 特定のファイルのトランスクリプション状態を確認する関数
function checkFileTranscription(fileId: string): void {
  transcriptionHandler.checkFileTranscription(fileId);
}

// デプロイ時に必要な関数をグローバルに公開
global.doPost = doPost;
global.doGet = doGet;
global.setup = setup;
global.setupCredentials = setupCredentials;
global.setupSpreadsheet = setupSpreadsheet;
global.checkAllSettings = checkAllSettings;
global.testWithMockEvent = testWithMockEvent;
global.retryTranscriptionCheck = retryTranscriptionCheck;
global.checkFileTranscription = checkFileTranscription;
