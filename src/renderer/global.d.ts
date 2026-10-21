export interface UpdateAsset {
  name: string;
  downloadUrl: string;
  apiUrl?: string;
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
  isPrerelease?: boolean;
  asset?: UpdateAsset | null;
  message?: string;
  error?: string;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  phase?: 'downloading' | 'installing';
}

export interface DataFileInfo {
  filePath: string;
  fileName?: string;
  folderPath?: string;
  displayLocation?: string;
  isICloud?: boolean;
  isCustomPrimary?: boolean;
  iCloudAvailable?: boolean;
  iCloudDefaultPath?: string;
  exists: boolean;
  size: number;
  lastModified: number;
  candidates: string[];
}

export interface BudgetAppBridge {
  ping(): Promise<{
    ok: boolean;
    version: string;
    platform: string;
    dataFilePath?: string;
  }>;
  platform: string;
  saveData(data: any): Promise<{ success: boolean; filePath?: string; error?: string }>;
  loadData(): Promise<any>;
  getDataFileInfo(): Promise<DataFileInfo>;
  selectDataFile(): Promise<{
    success: boolean;
    data?: any;
    filePath?: string;
    displayLocation?: string;
    isICloud?: boolean;
    canceled?: boolean;
    error?: string;
  }>;
  chooseSaveDataLocation(currentData?: any, startInICloud?: boolean): Promise<{
    success: boolean;
    data?: any;
    filePath?: string;
    displayLocation?: string;
    isICloud?: boolean;
    canceled?: boolean;
    error?: string;
  }>;
  useICloudDataLocation(currentData?: any): Promise<{
    success: boolean;
    data?: any;
    filePath?: string;
    displayLocation?: string;
    isICloud?: boolean;
    error?: string;
  }>;
  openDataFolder(): Promise<boolean>;
  getTickerPrice(ticker: string): Promise<any>;
  checkForUpdates(repo?: string, githubToken?: string): Promise<UpdateCheckResult>;
  downloadAndInstallUpdate(options: {
    downloadUrl: string;
    apiUrl?: string;
    assetName: string;
    githubToken?: string;
  }): Promise<{
    success: boolean;
    message?: string;
    filePath?: string;
    error?: string;
  }>;
  sendNotification?: (payload: {
    title: string;
    body?: string;
    icon?: string;
    silent?: boolean;
  }) => Promise<{ success: boolean; error?: string; reason?: string }>;
  openExternal(url: string): Promise<boolean>;
  onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void;
  onDataUpdatedOnDisk(callback: (payload: any) => void): () => void;
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