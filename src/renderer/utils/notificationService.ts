/**
 * Notification Service for Budget Ledger (macOS & Web Support)
 *
 * Delivery model
 * --------------
 * On macOS the notification is delivered to the **operating system** (Notification
 * Center), never to a banner inside the app:
 *
 *   1. Native system notification through the Electron main process, which uses
 *      `UNUserNotificationCenter` when the build is signed and falls back to the
 *      Apple-signed `osascript` helper when macOS refuses to authorize an
 *      unsigned application.
 *   2. Only when no system channel is available (browser build) the service
 *      falls back to the Service Worker / Web Notification API and to the
 *      in-app banner.
 *
 * The sound is played by the operating system for native notifications, so the
 * renderer never synthesizes a second chime on top of it.
 */

export type NotificationChannel = 'native' | 'applescript' | 'none';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  category: 'budget' | 'recurring' | 'goal' | 'system' | 'summary' | 'reimbursement';
  timestamp: number;
  read?: boolean;
}

export interface NativeNotificationCapability {
  supported: boolean;
  channel: NotificationChannel;
  bundleId: string;
  appName: string;
  platform: string;
  signed?: boolean;
  error?: string;
}

export interface NotificationSettings {
  enabled: boolean;
  budgetAlerts: boolean;
  recurringReminders: boolean;
  goalAlerts: boolean;
  soundEnabled: boolean;
  summaryAlerts: boolean;
  transactionReminderEnabled: boolean;
  transactionReminderIntervalHours: number;
  reimbursementAlerts: boolean;
}

const SETTINGS_KEY = 'budget_app_notification_settings';
const HISTORY_KEY = 'budget_app_notification_history';
const SENT_REGISTRY_KEY = 'budget_app_sent_notifications_registry';
const LAST_TX_REMINDER_KEY = 'budget_app_last_tx_reminder_time';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  budgetAlerts: true,
  recurringReminders: true,
  goalAlerts: true,
  soundEnabled: true,
  summaryAlerts: true,
  transactionReminderEnabled: true,
  transactionReminderIntervalHours: 24,
  reimbursementAlerts: true,
};

// Platform detection utilities
export const isElectronEnv = (): boolean => {
  return Boolean(
    typeof window !== 'undefined' &&
    window.budgetApp &&
    typeof window.budgetApp.sendNotification === 'function'
  );
};

export const isMacOSDevice = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (window.budgetApp?.platform === 'darwin') return true;
  return /Macintosh|Mac OS X/.test(navigator.userAgent);
};

export const isStandalonePwa = (): boolean => {
  if (typeof window === 'undefined') return false;
  const isStandaloneMedia = window.matchMedia('(display-mode: standalone)').matches;
  const isNavigatorStandalone = (navigator as any).standalone === true;
  return Boolean(isStandaloneMedia || isNavigatorStandalone);
};

export const getNotificationSupportStatus = (): {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  platformLabel: string;
} => {
  const isElec = isElectronEnv();
  const isMac = isMacOSDevice();

  let platformLabel = 'Web Browser';
  if (isElec) {
    platformLabel = 'macOS (Desktop App)';
  } else if (isMac) {
    platformLabel = 'macOS Safari / Web';
  }

  if (isElec) {
    return {
      supported: true,
      permission: 'granted',
      platformLabel,
    };
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      supported: false,
      permission: 'unsupported',
      platformLabel,
    };
  }

  return {
    supported: true,
    permission: Notification.permission,
    platformLabel,
  };
};

/**
 * Asks the main process which channel will carry the notifications.
 * On macOS this is the Notification Center, not the app window.
 */
export const getNativeNotificationCapability = async (): Promise<NativeNotificationCapability | null> => {
  if (!isElectronEnv() || !window.budgetApp?.getNotificationCapability) return null;
  try {
    return await window.budgetApp.getNotificationCapability();
  } catch {
    return null;
  }
};

export const loadNotificationSettings = (): NotificationSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return DEFAULT_NOTIFICATION_SETTINGS;
};

export const saveNotificationSettings = (settings: NotificationSettings): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
};

export const loadNotificationHistory = (): AppNotification[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return [];
};

export const saveNotificationHistory = (history: AppNotification[]): void => {
  try {
    // Keep last 50 notifications
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  } catch {}
};

export const clearNotificationHistory = (): void => {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {}
};

/**
 * Synthesizes a discrete, pleasant Apple-like notification chime using Web Audio API.
 * 100% offline, zero network requests, works on macOS e Web.
 */
export const playNotificationSound = (): void => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    // Harmonic bell chime note 1 (D5 -> A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.1);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Harmonic bell chime note 2 (A5 -> D6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.08);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.22);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.18, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.6);
  } catch {
    // Audio context may be restricted before user interaction
  }
};

/**
 * Request notification permission from the system/browser
 */
export const requestAppNotificationPermission = async (): Promise<{
  granted: boolean;
  permission: NotificationPermission | 'unsupported';
  message?: string;
}> => {
  // If in Electron on macOS, native notifications are directly available
  if (isElectronEnv()) {
    return {
      granted: true,
      permission: 'granted',
      message: 'Notifiche native macOS attivate.',
    };
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      granted: false,
      permission: 'unsupported',
      message: 'Le notifiche di sistema non sono supportate da questo browser.',
    };
  }

  try {
    const result = await Notification.requestPermission();
    return {
      granted: result === 'granted',
      permission: result,
      message:
        result === 'granted'
          ? 'Autorizzazione notifiche concessa con successo! Riceverai gli avvisi nel Centro Notifiche.'
          : result === 'denied'
          ? 'Autorizzazione negata dal browser. Clicca sull\'icona del lucchetto/impostazioni nella barra degli indirizzi per abilitarle.'
          : 'Richiesta di autorizzazione chiusa.',
    };
  } catch (err: any) {
    return {
      granted: false,
      permission: (Notification as any).permission || 'default',
      message: err?.message || 'Errore durante la richiesta di autorizzazione.',
    };
  }
};

/**
 * Dispatch an application notification.
 *
 * On macOS the notification is delivered by the operating system (Notification
 * Center). The in-app banner and the synthesized chime are only used by the
 * browser build, where no system channel is available.
 */
export const sendAppNotification = async (params: {
  title: string;
  body: string;
  category?: 'budget' | 'recurring' | 'goal' | 'system' | 'summary' | 'reimbursement';
  silent?: boolean;
  tag?: string;
}): Promise<{
  success: boolean;
  error?: string;
  deliveredToSystem?: boolean;
  deliveredInApp?: boolean;
  channel?: NotificationChannel;
  permission?: string;
}> => {
  const settings = loadNotificationSettings();
  if (!settings.enabled) {
    return { success: false, error: 'Notifiche disattivate nelle impostazioni dell\'app.' };
  }

  const category = params.category || 'system';
  if (category === 'budget' && !settings.budgetAlerts) return { success: false, error: 'Avvisi budget disattivati' };
  if (category === 'recurring' && !settings.recurringReminders) return { success: false, error: 'Promemoria ricorrenti disattivati' };
  if (category === 'goal' && !settings.goalAlerts) return { success: false, error: 'Avvisi obiettivi disattivati' };
  if (category === 'reimbursement' && !settings.reimbursementAlerts) return { success: false, error: 'Avvisi rimborsi disattivati' };
  if (category === 'summary' && !settings.summaryAlerts && !settings.transactionReminderEnabled) {
    return { success: false, error: 'Promemoria disattivati' };
  }

  const silent = Boolean(params.silent) || !settings.soundEnabled;

  // Record in the notification log (history of what the app reported)
  const historyItem: AppNotification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title: params.title,
    body: params.body,
    category,
    timestamp: Date.now(),
    read: false,
  };
  const history = loadNotificationHistory();
  saveNotificationHistory([historyItem, ...history]);

  let deliveredToSystem = false;
  let channel: NotificationChannel = 'none';

  // 1. macOS / Electron — the notification goes to Notification Center
  if (isElectronEnv() && window.budgetApp?.sendNotification) {
    try {
      const res = await window.budgetApp.sendNotification({
        title: params.title,
        body: params.body,
        silent,
        tag: params.tag,
      });
      if (res?.success) {
        deliveredToSystem = true;
        channel = res.channel ?? 'native';
      } else {
        channel = res?.channel ?? 'none';
      }
    } catch (err: any) {
      console.warn('Electron notification fallback:', err);
    }
  }

  // 2. Browser build only — Service Worker showNotification (background & desktop PWA)
  if (!deliveredToSystem && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        await reg.showNotification(params.title, {
          body: params.body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: params.tag || `budget-${category}-${Date.now()}`,
          vibrate: [100, 50, 100],
          silent,
        } as any);
        deliveredToSystem = true;
        channel = 'native';
      }
    } catch (swErr) {
      console.warn('Service worker showNotification fallback:', swErr);
    }
  }

  // 3. Browser build only — standard Web Notification API
  if (!deliveredToSystem && typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        const notif = new Notification(params.title, {
          body: params.body,
          icon: '/icon-192.png',
          tag: params.tag || `budget-${category}-${Date.now()}`,
          silent,
        });
        notif.onclick = () => {
          window.focus();
        };
        deliveredToSystem = true;
        channel = 'native';
      } catch (notifErr: any) {
        console.warn('Direct Notification constructor failed:', notifErr);
      }
    }
  }

  // 4. In-app banner — only when the system could not deliver the notification
  let deliveredInApp = false;
  if (!deliveredToSystem) {
    if (settings.soundEnabled && !params.silent) {
      playNotificationSound();
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('app-notification-received', {
          detail: historyItem,
        })
      );
      deliveredInApp = true;
    }
  }

  return {
    success: deliveredToSystem || deliveredInApp,
    deliveredToSystem,
    deliveredInApp,
    channel,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  };
};

/**
 * Checks financial triggers (recurring transactions due, budget limits)
 * and dispatches notifications if thresholds are met.
 */
export const checkAndTriggerFinancialAlerts = async (options: {
  categories: Array<{
    name: string;
    budget: number;
    spent: number;
  }>;
  recurringTransactions: Array<{
    id: string;
    merchant: string;
    amount: number;
    account: string;
    startDate: string;
    frequency: string;
    dayOfMonth?: number;
    isActive: boolean;
  }>;
}): Promise<number> => {
  const settings = loadNotificationSettings();
  if (!settings.enabled) return 0;

  const today = new Date();
  const todayDateStr = today.toISOString().split('T')[0];
  const todayDay = today.getDate();

  // Registry of sent alerts today to prevent duplicate spamming
  let sentRegistry: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(SENT_REGISTRY_KEY);
    if (raw) sentRegistry = JSON.parse(raw);
  } catch {}

  let alertCount = 0;

  // 1. Check Recurring Transactions due today or tomorrow
  if (settings.recurringReminders) {
    for (const rec of options.recurringTransactions) {
      if (!rec.isActive) continue;
      const key = `rec_${rec.id}_${todayDateStr}`;
      if (sentRegistry[key]) continue;

      let isDueToday = false;
      if (rec.frequency === 'monthly') {
        const targetDay = rec.dayOfMonth || (rec.startDate ? new Date(rec.startDate).getDate() : 1);
        if (targetDay === todayDay) {
          isDueToday = true;
        }
      } else if (rec.startDate === todayDateStr) {
        isDueToday = true;
      }

      if (isDueToday) {
        sentRegistry[key] = todayDateStr;
        alertCount++;
        await sendAppNotification({
          title: `Scadenza ricorrente: ${rec.merchant}`,
          body: `Oggi è prevista l'uscita ricorrente di € ${rec.amount.toFixed(2)} sul conto "${rec.account}".`,
          category: 'recurring',
          tag: `rec-${rec.id}`,
        });
      }
    }
  }

  // 2. Check Budget Category Limits (80% and 100%)
  if (settings.budgetAlerts) {
    for (const cat of options.categories) {
      if (!cat.budget || cat.budget <= 0) continue;
      const percentage = (cat.spent / cat.budget) * 100;

      if (percentage >= 100) {
        const key = `budget_100_${cat.name}_${todayDateStr.substring(0, 7)}`;
        if (!sentRegistry[key]) {
          sentRegistry[key] = todayDateStr;
          alertCount++;
          await sendAppNotification({
            title: `Budget superato: ${cat.name}`,
            body: `Hai superato il budget mensile per "${cat.name}": spesi € ${cat.spent.toFixed(2)} su € ${cat.budget.toFixed(2)} (${Math.round(percentage)}%).`,
            category: 'budget',
            tag: `budget-100-${cat.name}`,
          });
        }
      } else if (percentage >= 80) {
        const key = `budget_80_${cat.name}_${todayDateStr.substring(0, 7)}`;
        if (!sentRegistry[key]) {
          sentRegistry[key] = todayDateStr;
          alertCount++;
          await sendAppNotification({
            title: `Attenzione al budget: ${cat.name}`,
            body: `Sei all'${Math.round(percentage)}% del budget mensile per "${cat.name}" (€ ${cat.spent.toFixed(2)} / € ${cat.budget.toFixed(2)}).`,
            category: 'budget',
            tag: `budget-80-${cat.name}`,
          });
        }
      }
    }
  }

  try {
    localStorage.setItem(SENT_REGISTRY_KEY, JSON.stringify(sentRegistry));
  } catch {}

  return alertCount;
};

/**
 * Checks if it's time to remind the user to register/update their transactions,
 * based on the configured interval (e.g. every 12h, 24h, 48h, etc.).
 */
export const checkTransactionReminder = async (latestTransactionIsoDate?: string): Promise<boolean> => {
  const settings = loadNotificationSettings();
  if (!settings.enabled || !settings.transactionReminderEnabled) return false;

  const now = Date.now();
  const intervalHours = settings.transactionReminderIntervalHours || 24;
  const intervalMs = intervalHours * 3600 * 1000;

  let lastReminder = 0;
  try {
    const raw = localStorage.getItem(LAST_TX_REMINDER_KEY);
    if (raw) lastReminder = parseInt(raw, 10) || 0;
  } catch {}

  // If already notified within this interval window, skip
  if (lastReminder && now - lastReminder < intervalMs) {
    return false;
  }

  // Information about latest transaction
  let daysNotice = '';
  if (latestTransactionIsoDate) {
    const txTime = new Date(latestTransactionIsoDate).getTime();
    if (!isNaN(txTime)) {
      const diffDays = Math.floor((now - txTime) / (1000 * 3600 * 24));
      if (diffDays >= 1) {
        daysNotice = ` L'ultimo movimento registrato risale a ${diffDays === 1 ? 'ieri' : `${diffDays} giorni fa`}.`;
      }
    }
  }

  try {
    localStorage.setItem(LAST_TX_REMINDER_KEY, String(now));
  } catch {}

  await sendAppNotification({
    title: 'Promemoria: registra le tue spese',
    body: `È passato del tempo dal tuo ultimo aggiornamento.${daysNotice} Inserisci le spese o le entrate recenti per mantenere i conti in ordine.`,
    category: 'summary',
    tag: 'transaction-reminder',
  });

  return true;
};

/**
 * Sends an immediate test reminder for transactions update
 */
export const sendTestTransactionReminder = async (): Promise<{
  success: boolean;
  error?: string;
  deliveredToSystem?: boolean;
  deliveredInApp?: boolean;
  channel?: NotificationChannel;
}> => {
  return sendAppNotification({
    title: 'Promemoria: registra le tue spese',
    body: 'Questo è un promemoria di prova: ricordati di registrare i nuovi scontrini, uscite o bonifici per avere il budget aggiornato!',
    category: 'summary',
    tag: 'transaction-reminder-test',
  });
};

// === Rimborso (refund) notifications ===

/**
 * A spesa in attesa di rimborso da valutare per le notifiche automatiche.
 * Compilata dal chiamante (App.tsx) a partire dal reimbursementMap.
 */
export interface ReimbursementAlertItem {
  /** Id della spesa originaria */
  expenseId: string;
  /** Esercente o categoria della spesa anticipata */
  merchant: string;
  /** Categoria di budget della spesa */
  category: string;
  /** Importo ancora da recuperare */
  remainingAmount: number;
  /** Importo già incassato (rimborsi parziali) */
  totalReimbursed: number;
  /** Data concordata per il rimborso (YYYY-MM-DD), se presente */
  dueDate?: string;
  /** Data della spesa originaria */
  expenseDate: string;
  status: 'pending' | 'partial';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Formatta una data YYYY-MM-DD in italiano leggibile (es. "5 novembre 2026"). */
const formatReimbursementDueDate = (isoDate: string): string => {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
};

/**
 * Controlla le spese ancora da rimborsare e invia una notifica di sistema quando:
 *  - il rimborso è **in ritardo** (data concordata già trascorsa)
 *  - il rimborso **scade oggi**
 *  - il rimborso **scade entro 7 giorni** (un solo preavviso per data concordata)
 *
 * Anti-spam: ritardo e scadenza odierna vengono segnalati al massimo una volta
 * al giorno per spesa; il preavviso viene inviato una sola volta per ciascuna
 * data di scadenza. Ogni esecuzione notifica al massimo 5 spese, dando priorità
 * ai ritardi, poi alle scadenze del giorno, infine ai preavvisi.
 */
export const checkAndTriggerReimbursementAlerts = async (options: {
  items: ReimbursementAlertItem[];
}): Promise<number> => {
  const settings = loadNotificationSettings();
  if (!settings.enabled || !settings.reimbursementAlerts) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDateStr = today.toISOString().split('T')[0];
  const todayMs = today.getTime();

  // Registry of sent alerts to prevent duplicate spamming (shared with other checks)
  let sentRegistry: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(SENT_REGISTRY_KEY);
    if (raw) sentRegistry = JSON.parse(raw);
  } catch {}

  type ReimbursementAlertTask = {
    key: string;
    item: ReimbursementAlertItem;
    variant: 'overdue' | 'today' | 'soon';
    days: number;
  };

  const tasks: ReimbursementAlertTask[] = [];

  for (const item of options.items) {
    if (!item.dueDate) continue;

    const due = new Date(`${item.dueDate}T12:00:00`);
    if (Number.isNaN(due.getTime())) continue;
    const dueMs = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
    const diffDays = Math.round((dueMs - todayMs) / DAY_MS);

    if (diffDays < 0) {
      // In ritardo: sollecito quotidiano finché non viene saldato
      const key = `reimb_overdue_${item.expenseId}_${todayDateStr}`;
      if (!sentRegistry[key]) {
        tasks.push({ key, item, variant: 'overdue', days: Math.abs(diffDays) });
      }
    } else if (diffDays === 0) {
      const key = `reimb_today_${item.expenseId}_${todayDateStr}`;
      if (!sentRegistry[key]) {
        tasks.push({ key, item, variant: 'today', days: 0 });
      }
    } else if (diffDays <= 7) {
      // Preavviso: una sola notifica per ciascuna data di scadenza concordata
      const key = `reimb_soon_${item.expenseId}_${item.dueDate}`;
      if (!sentRegistry[key]) {
        tasks.push({ key, item, variant: 'soon', days: diffDays });
      }
    }
  }

  // Priorità: prima i ritardi, poi le scadenze odierne, infine i preavvisi
  const rank = { overdue: 0, today: 1, soon: 2 } as const;
  tasks.sort((a, b) => {
    if (rank[a.variant] !== rank[b.variant]) return rank[a.variant] - rank[b.variant];
    return a.days - b.days;
  });

  let alertCount = 0;

  for (const task of tasks.slice(0, 5)) {
    const { item, variant, days } = task;
    sentRegistry[task.key] = todayDateStr;
    alertCount++;

    const label = item.merchant || item.category;
    const amountText = `€ ${item.remainingAmount.toFixed(2)}`;
    const partialNote =
      item.status === 'partial'
        ? ` (già rimborsati € ${item.totalReimbursed.toFixed(2)})`
        : '';

    if (variant === 'overdue') {
      await sendAppNotification({
        title: `Rimborso in ritardo: ${label}`,
        body: `Il rimborso di ${amountText} per "${label}" era atteso ${days === 1 ? 'ieri' : `${days} giorni fa`}${partialNote}. Sollecita chi deve restituirti i soldi.`,
        category: 'reimbursement',
        tag: `reimb-overdue-${item.expenseId}`,
      });
    } else if (variant === 'today') {
      await sendAppNotification({
        title: `Rimborso in scadenza oggi: ${label}`,
        body: `Oggi scade il rimborso di ${amountText} per "${label}"${partialNote}.`,
        category: 'reimbursement',
        tag: `reimb-today-${item.expenseId}`,
      });
    } else {
      await sendAppNotification({
        title: `Rimborso in scadenza tra ${days} ${days === 1 ? 'giorno' : 'giorni'}: ${label}`,
        body: `Il ${formatReimbursementDueDate(item.dueDate!)} scade il rimborso di ${amountText} per "${label}"${partialNote}.`,
        category: 'reimbursement',
        tag: `reimb-soon-${item.expenseId}`,
      });
    }
  }

  if (alertCount > 0) {
    try {
      localStorage.setItem(SENT_REGISTRY_KEY, JSON.stringify(sentRegistry));
    } catch {}
  }

  return alertCount;
};

/**
 * Conferma immediata all'utente quando incassa un rimborso (entrata collegata
 * a una spesa "da rimborsare"). Distingue rimborso parziale e rimborso
 * completo (spesa interamente saldata).
 */
export const sendReimbursementReceivedNotification = async (params: {
  expenseMerchant: string;
  amount: number;
  remainingAmount: number;
}): Promise<{
  success: boolean;
  error?: string;
  deliveredToSystem?: boolean;
  deliveredInApp?: boolean;
  channel?: NotificationChannel;
}> => {
  const label = params.expenseMerchant || 'spesa';
  const settled = params.remainingAmount <= 0.009;

  return sendAppNotification({
    title: settled ? `Rimborso completato: ${label}` : `Rimborso ricevuto: ${label}`,
    body: settled
      ? `Accredito di € ${params.amount.toFixed(2)}: la spesa "${label}" è stata interamente rimborsata.`
      : `Incassati € ${params.amount.toFixed(2)} per "${label}": restano ancora da recuperare € ${params.remainingAmount.toFixed(2)}.`,
    category: 'reimbursement',
    tag: `reimb-received-${label}`,
  });
};

/**
 * Sends an immediate test reminder for reimbursement due dates
 */
export const sendTestReimbursementReminder = async (): Promise<{
  success: boolean;
  error?: string;
  deliveredToSystem?: boolean;
  deliveredInApp?: boolean;
  channel?: NotificationChannel;
}> => {
  return sendAppNotification({
    title: 'Rimborso in scadenza tra 3 giorni: Ristorante di prova',
    body: 'Tra 3 giorni (esempio) scade il rimborso di € 42,50 per "Ristorante di prova". Riceverai un avviso per ogni rimborso in ritardo, in scadenza oggi o in arrivo nei prossimi 7 giorni.',
    category: 'reimbursement',
    tag: 'reimbursement-test',
  });
};
