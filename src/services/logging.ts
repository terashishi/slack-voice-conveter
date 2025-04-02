// スプレッドシートIDを保存するためのキー
const SPREADSHEET_ID_KEY = 'SPREADSHEET_ID_KEY';

/**
 * 詳細なログをスプレッドシートに出力する関数
 * @param level ログレベル
 * @param message メッセージ
 */
export function logToSheet(level: LogLevel, message: string): void {
  try {
    // コンソールにも出力（デバッグ時に便利）
    console.log(`[${level}]: ${message}`);
    
    const spreadsheetId = PropertiesService.getScriptProperties()
      .getProperty(SPREADSHEET_ID_KEY);
    
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
export function logInfo(message: string): void {
  logToSheet('INFO', message);
}

/**
 * WARNING レベルのログを出力
 * @param message メッセージ
 */
export function logWarning(message: string): void {
  logToSheet('WARN', message);
}

/**
 * ERROR レベルのログを出力
 * @param message メッセージ
 */
export function logError(message: string): void {
  logToSheet('ERROR', message);
}

/**
 * DEBUG レベルのログを出力（開発時のみ使用）
 * @param message メッセージ
 */
export function logDebug(message: string): void {
  logToSheet('DEBUG', message);
}

/**
 * スプレッドシートIDを設定する関数
 */
export function setupLogSpreadsheet(): void {
  // 既存のスプレッドシートがあるか確認
  const existingId = PropertiesService.getScriptProperties()
    .getProperty(SPREADSHEET_ID_KEY);
  
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
