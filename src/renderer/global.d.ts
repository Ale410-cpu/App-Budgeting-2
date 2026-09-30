export interface UpdateAsset {
  name: string;
  downloadUrl: string;
  size: number;
  contentType?: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  tagName?: string;
  releaseName?: string;
  releaseNotes?: string;
  publishedAt?: string;
  htmlUrl?: string;
  repo: string;
  asset?: UpdateAsset | null;
  message?: string;
  error?: string;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
}

export interface BudgetAppBridge {
  ping(): Promise<{
    ok: boolean;
    version: string;
    platform: string;
  }>;
  platform: string;
  saveData(data: any): Promise<{ success: boolean; error?: string }>;
  loadData(): Promise<any>;
  getTickerPrice(ticker: string): Promise<any>;
  checkForUpdates(repo?: string): Promise<UpdateCheckResult>;
  downloadAndInstallUpdate(options: { downloadUrl: string; assetName: string }): Promise<{
    success: boolean;
    message?: string;
    filePath?: string;
    error?: string;
  }>;
  openExternal(url: string): Promise<boolean>;
  onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void;
}

declare global {
  interface Window {
    budgetApp?: BudgetAppBridge;
  }
}

declare module 'snappyjs' {
  const snappy: {
    compress(buffer: ArrayBuffer | Uint8Array | Buffer): Uint8Array;
    uncompress(buffer: ArrayBuffer | Uint8Array | Buffer): Uint8Array;
  };
  export default snappy;
}

export {};