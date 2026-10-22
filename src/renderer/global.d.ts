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

/** Channel used to deliver a notification to the operating system. */
export type NotificationChannel = 'native' | 'applescript' | 'none';

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
    tag?: string;
  }) => Promise<{
    success: boolean;
    channel?: NotificationChannel;
    reason?: string;
    error?: string;
  }>;
  getNotificationCapability?: () => Promise<{
    supported: boolean;
    channel: NotificationChannel;
    bundleId: string;
    appName: string;
    platform: string;
    signed?: boolean;
    error?: string;
  }>;
  openExternal(url: string): Promise<boolean>;
  /**
   * Salva un file sul dispositivo.
   * Solo iOS: su iOS non esiste il download "classico" del browser, quindi il
   * file viene passato al picker di sistema (Files / iCloud Drive).
   */
  saveFile?: (payload: {
    fileName: string;
    /** Contenuto del file codificato in base64. */
    content: string;
    mimeType?: string;
  }) => Promise<{ success: boolean; canceled?: boolean; message?: string; error?: string }>;
  /**
   * Scansiona uno scontrino (fotocamera su iOS, file su macOS) e restituisce
   * il testo riconosciuto dall'OCR nativo (Apple Vision).
   */
  scanReceipt?: () => Promise<{
    success: boolean;
    canceled?: boolean;
    text?: string;
    source?: string;
    error?: string;
  }>;
  /**
   * Scollega il file principale collegato (su iOS: la cartella scelta).
   * I dati tornano sul file locale del dispositivo.
   */
  unlinkPrimaryFile?: () => Promise<{ success: boolean; error?: string }>;
  /**
   * Collega un file `user-data.json` **esistente** (per esempio su iCloud
   * Drive) come posizione principale, senza sovrascriverlo.
   *
   * È il flusso che permette a Mac e iOS di usare lo stesso file: le
   * modifiche vengono sincronizzate da iCloud Drive.
   */
  linkPrimaryFile?: () => Promise<{
    success: boolean;
    canceled?: boolean;
    data?: any;
    filePath?: string;
    displayLocation?: string;
    isICloud?: boolean;
    error?: string;
  }>;
  /**
   * Rilegge subito il file principale (iCloud Drive) e restituisce i dati.
   * Utile per prendere subito le modifiche fatte sull'altra piattaforma.
   */
  reloadPrimaryFile?: () => Promise<{ success: boolean; data?: any; error?: string }>;
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