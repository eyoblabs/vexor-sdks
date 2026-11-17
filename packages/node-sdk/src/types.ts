export type AssetState =
  | "uploading"
  | "uploaded"
  | "transcoding"
  | "preview_ready"
  | "ready"
  | "failed"
  | "deleting"
  | "deleted";

export interface Asset {
  id: string;
  state: AssetState;
  tus_id: string;
  filename?: string;
  file_size: number;
  mime_type: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  processing_stage?: string;
  processing_profile?: string;
  progress_percent?: number;
  media_size_bytes?: number;
  source_type?: string;
  media_storage_type?: string;
  error_msg?: string;
  enhance_upscale?: boolean;
  enhance_tier?: string;
  created_at?: string;
  updated_at?: string;
  [field: string]: unknown;
}

export interface CursorPage<T> {
  data: T[];
  next_cursor?: string;
}

export interface PlaybackSession {
  token: string;
  manifestUrl: string;
  thumbnailUrl?: string;
}

export interface CreatePlaybackTokenInput {
  assetId: string;
  viewerId?: string;
  sessionId?: string;
}

export type StorageAuthMode = "access_key" | "aws_role";

export interface StorageConnection {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  region: string;
  auth_mode: StorageAuthMode;
  role_arn?: string;
  external_id?: string;
  bucket: string;
  prefix: string;
  access_key_hint?: string;
  active: boolean;
  created_at: string;
}

interface StorageConnectionInputBase {
  name: string;
  bucket: string;
  region?: string;
  prefix?: string;
}

export type CreateStorageConnectionInput = StorageConnectionInputBase & (
  | {
      authMode: "aws_role";
      region: string;
      roleArn: string;
      externalId: string;
      endpoint?: string;
    }
  | {
      authMode?: "access_key";
      endpoint: string;
      accessKeyId: string;
      secretAccessKey: string;
    }
);

export interface ImportAssetInput {
  connectionId: string;
  objectKey: string;
  filename?: string;
  outputConnectionId?: string;
  enhanceUpscale?: boolean;
  enhanceTier?: string;
}

export interface VexorWebhookEvent<TData = unknown> {
  event_id: string;
  type: string;
  asset_id: string;
  account_id: string;
  timestamp: string;
  data?: TData;
}
