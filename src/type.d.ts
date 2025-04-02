/**
 * Slack設定関連の型定義
 */

// Slack認証情報の型
declare interface SlackConfig {
  token: string;         // ボットトークン
  userToken: string;     // ユーザートークン（ファイル削除に必要）
  channelName: string;   // 監視対象チャンネル名（任意）
}

// Slackイベント関連の型
declare interface SlackEvent {
  type: string;
  subtype?: string;
  files?: SlackFile[];
  file?: SlackFile;
  file_id?: string;
  channel: string;
  channel_id?: string;
  ts: string;
  event_ts?: string;
  user: string;
  user_id?: string;
}

// Slackファイル情報の型
declare interface SlackFile {
  id: string;
  filetype?: string;
  mimetype?: string;
  name?: string;
  transcription?: {
    status: 'processing' | 'complete' | 'failed';
    preview?: {
      content: string;
      has_more: boolean;
    };
    full?: {
      content: string;
    };
  };
}

// トランスクリプション待機情報の型
declare interface PendingTranscription {
  fileId: string;
  channelId: string;
  timestamp: string;
  retryCount: number;
  maxRetries: number;
}

// APIレスポンスの型
declare interface SlackApiResponse {
  ok: boolean;
  error?: string;
  file?: SlackFile;
  channel?: any;
}

// ログレベルの型
declare type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

declare var global: {
  [key: string]: any;
};