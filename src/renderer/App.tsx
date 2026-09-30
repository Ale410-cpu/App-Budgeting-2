import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import * as XLSX from 'xlsx-clean';
import { Eye, EyeOff } from 'lucide-react';
import defaultBrandLogo from './assets/icon.png';
import { SankeyChart } from './components/SankeyChart';
import { NetWorthHistoryChart } from './components/NetWorthHistoryChart';
import { AssetAllocationPanel, isAssetBondEtf, isAssetEquityEtf } from './components/AssetAllocationPanel';
import { FireCalculator } from './components/FireCalculator';
import { SubscriptionsManager, type Subscription } from './components/SubscriptionsManager';
import { ReimbursementSchedulePanel } from './components/ReimbursementSchedulePanel';
import { CategoryTrendReport } from './components/CategoryTrendReport';
import { CashbackManager, type CashbackRule, type NewAssetPayload } from './components/CashbackManager';
import { UpdateModal } from './components/UpdateModal';
import { ImportDataModal } from './components/ImportDataModal';
import { APP_VERSION } from '../version';
import type { ParsedTransaction } from './utils/smartFileParser';
import type { UpdateCheckResult, UpdateProgress } from './global';

type TransactionKind = 'expense' | 'income';

type Transaction = {
  id: string;
  createdAt: number;
  date: string;
  merchant: string;
  category: string;
  subcategory: string;
  account: string;
  amount: number;
  kind: TransactionKind;
  note: string;
  needsReimbursement?: boolean;
  reimbursementDueDate?: string;
  reimbursesTransactionId?: string;
};

type TransactionDraft = {
  date: string;
  merchant: string;
  category: string;
  subcategory: string;
  account: string;
  amount: string;
  kind: TransactionKind;
  note: string;
  needsReimbursement: boolean;
  reimbursementDueDate: string;
  isReimbursement: boolean;
  reimbursesTransactionId: string;
};

type ReimbursementStatus = 'pending' | 'partial' | 'reimbursed';

type ReimbursementInfo = {
  totalReimbursed: number;
  remainingAmount: number;
  status: ReimbursementStatus;
  refunds: Transaction[];
};

type TransactionBulkDraft = {
  date: string;
  category: string;
  subcategory: string;
  account: string;
  kind: TransactionKind | '';
  note: string;
};

type BudgetSubcategory = {
  id: string;
  name: string;
  limit: number;
  limitType?: 'fixed' | 'percentage';
  limitPercent?: number;
  note: string;
};

type BudgetCategory = {
  id: string;
  name: string;
  limit: number;
  limitType?: 'fixed' | 'percentage';
  limitPercent?: number;
  color: string;
  note: string;
  subcategories: BudgetSubcategory[];
};

type BudgetSubcategoryDraft = {
  id: string;
  name: string;
  limit: string;
  limitType: 'fixed' | 'percentage';
  limitPercent: string;
  note: string;
};

type BudgetCategoryDraft = {
  name: string;
  limit: string;
  limitType: 'fixed' | 'percentage';
  limitPercent: string;
  color: string;
  note: string;
  subcategories: BudgetSubcategoryDraft[];
};

type AssetKind = string;

type Asset = {
  id: string;
  name: string;
  kind: AssetKind;
  institution: string;
  quantity: number;
  unitValue: number;
  note: string;
  createdAt: number;
  ticker?: string;
  etfSubtype?: 'azionario' | 'obbligazionario';
};

type AssetDraft = {
  name: string;
  kind: AssetKind;
  institution: string;
  quantity: string;
  unitValue: string;
  note: string;
  ticker: string;
  etfSubtype: 'azionario' | 'obbligazionario' | '';
};

type AssetTransactionKind = 'buy' | 'sell';

type AssetTransaction = {
  id: string;
  assetId: string;
  date: string; // YYYY-MM-DD
  kind: AssetTransactionKind;
  quantity: number;
  unitValue: number;
  note: string;
  createdAt: number;
};

type AssetTransactionDraft = {
  date: string;
  kind: AssetTransactionKind;
  quantity: string;
  unitValue: string;
  note: string;
};

type Insight = {
  title: string;
  detail: string;
};

type PortfolioPoint = {
  label: string;
  value: number;
};

type RecurringFrequency = 'weekly' | 'monthly' | 'custom_days';

type RecurringTransaction = {
  id: string;
  merchant: string;
  amount: number;
  kind: TransactionKind;
  category: string;
  subcategory: string;
  account: string;
  frequency: RecurringFrequency;
  dayOfMonth?: number; // 1-31
  dayOfWeek?: number; // 0-6
  intervalDays?: number;
  startDate: string; // YYYY-MM-DD
  note: string;
  isActive: boolean;
  createdAt: number;
  autoPost?: boolean;
  lastPostedDate?: string; // YYYY-MM-DD of last auto post
};

type PAC = {
  id: string;
  name: string;
  assetId: string;
  amount: number;
  dayOfMonth: number;
  startDate: string; // YYYY-MM-DD
  isActive: boolean;
  createdAt: number;
  autoPost?: boolean;
  account?: string;
  category?: string;
  subcategory?: string;
  lastPostedDate?: string;
  createAssetTransaction?: boolean;
};

type SectionId = 'dashboard' | 'transazioni' | 'budget' | 'report' | 'patrimonio' | 'attivita' | 'ricorrenti' | 'impostazioni';

type SectionConfig = {
  id: SectionId;
  label: string;
  title: string;
  description: string;
};

const STORAGE_KEY = 'budget-ledger-transactions-v1';
const ORDER_STORAGE_KEY = 'budget-ledger-transactions-order-v1';
const BUDGET_STORAGE_KEY = 'budget-ledger-budget-categories-v1';
const ASSET_STORAGE_KEY = 'budget-ledger-assets-v1';
const ASSET_TX_STORAGE_KEY = 'budget-ledger-asset-transactions-v1';
const OPENING_CASH_STORAGE_KEY = 'budget-ledger-opening-cash-v1';
const OPENING_NET_WORTH_STORAGE_KEY = 'budget-ledger-opening-net-worth-v1';
const OPENING_DATE_STORAGE_KEY = 'budget-ledger-opening-date-v1';
const RECURRING_TX_STORAGE_KEY = 'budget-ledger-recurring-transactions-v1';
const PAC_STORAGE_KEY = 'budget-ledger-pac-v1';
const SUBSCRIPTION_STORAGE_KEY = 'budget-ledger-subscriptions-v1';
const ACCOUNT_INITIAL_CAPITALS_STORAGE_KEY = 'budget-ledger-account-initial-capitals-v1';
const HIDE_NUMBERS_STORAGE_KEY = 'budget-ledger-hide-numbers-v1';
const CASHBACK_RULES_STORAGE_KEY = 'budget-ledger-cashback-rules-v1';
const RECURRENT_EXPENSE_BUFFER = 2620;

const defaultCashbackRules: CashbackRule[] = [
  {
    id: 'cb-default-trade-republic',
    name: 'Trade Republic Saveback',
    account: 'Trade Republic',
    percentage: 1.0,
    destination: 'asset',
    investmentDayOfMonth: 2,
    monthlyCap: 15,
    isActive: true,
    notes: '1% Saveback investito il 2 del mese su ETF o azioni (massimale 15€/mese)',
    createdAt: Date.now() - 30 * 86400000,
  }
];

const defaultSubscriptions: Subscription[] = [
  {
    id: 'sub-netflix',
    name: 'Netflix',
    amount: 17.99,
    frequency: 'monthly',
    category: 'Abbonamenti',
    account: 'Conto principale',
    nextRenewalDate: getTodayIso(),
    status: 'active',
    notes: 'Piano Premium 4K',
    createdAt: Date.now() - 30 * 86400000,
  },
  {
    id: 'sub-spotify',
    name: 'Spotify Family',
    amount: 17.99,
    frequency: 'monthly',
    category: 'Abbonamenti',
    account: 'Conto principale',
    nextRenewalDate: getTodayIso(),
    status: 'active',
    notes: 'Streaming musicale illimitato',
    createdAt: Date.now() - 25 * 86400000,
  },
  {
    id: 'sub-prime',
    name: 'Amazon Prime',
    amount: 49.90,
    frequency: 'yearly',
    category: 'Abbonamenti',
    account: 'Conto principale',
    nextRenewalDate: '2026-11-15',
    status: 'active',
    notes: 'Spedizioni e Prime Video',
    createdAt: Date.now() - 100 * 86400000,
  },
  {
    id: 'sub-icloud',
    name: 'iCloud 200GB',
    amount: 2.99,
    frequency: 'monthly',
    category: 'Abbonamenti',
    account: 'Conto principale',
    nextRenewalDate: getTodayIso(),
    status: 'active',
    notes: 'Backup foto e documenti',
    createdAt: Date.now() - 40 * 86400000,
  },
];

const sections: SectionConfig[] = [
  {
    id: 'dashboard',
    label: 'Panoramica',
    title: 'Panoramica',
    description: '',
  },
  {
    id: 'transazioni',
    label: 'Transazioni',
    title: 'Transazioni',
    description: '',
  },
  {
    id: 'budget',
    label: 'Budget',
    title: 'Budget per categoria',
    description: '',
  },
  {
    id: 'report',
    label: 'Report & Patrimonio',
    title: 'Report, Patrimonio & Analisi',
    description: 'Quadro patrimoniale, bilancio dei flussi, asset allocation e simulatore FIRE.',
  },
  {
    id: 'attivita',
    label: 'Asset',
    title: 'Asset e strumenti finanziari',
    description: '',
  },
  {
    id: 'ricorrenti',
    label: 'Ricorrenti, PAC & Cashback',
    title: 'Transazioni Ricorrenti, PAC & Cashback',
    description: 'Pianifica entrate/uscite periodiche, Piani di Accumulo Capitale (PAC) e regole di Cashback & Saveback automatico.',
  },
  {
    id: 'impostazioni',
    label: 'Impostazioni',
    title: 'Impostazioni dell’app',
    description: 'Controlla i parametri di archiviazione, formato Excel e comportamento generale.',
  },
];

const initialBudgetCategories: BudgetCategory[] = [];

const initialAssets: Asset[] = [];

const initialAssetTransactions: AssetTransaction[] = [];

const initialTransactions: Transaction[] = [];

const insights: Insight[] = [
  {
    title: 'Benvenuto nel tuo Registro Budget!',
    detail: 'Inizia creando delle categorie di budget e registrando le tue prime transazioni o asset.',
  },
  {
    title: 'Nessun dato registrato',
    detail: 'Inserisci le transazioni per sbloccare l’analisi automatica delle spese e dei flussi finanziari.',
  },
  {
    title: 'Monitoraggio patrimonio',
    detail: 'Imposta la tua cassa iniziale e il tuo patrimonio netto nella sezione Impostazioni per seguire la crescita nel tempo.',
  },
];

function createTransactionId() {
  return `tx-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getDueDatesForRecurring(tx: RecurringTransaction, todayStr: string): string[] {
  const dueDates: string[] = [];
  const startRef = tx.lastPostedDate || tx.startDate;
  
  if (startRef > todayStr) return [];

  // Helper to parse date
  const parseDate = (dStr: string) => {
    const parts = dStr.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  };

  const formatDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const startRefDate = parseDate(startRef);
  const todayDate = parseDate(todayStr);

  if (tx.frequency === 'monthly') {
    // Generate potential monthly dates from startRef's month/year to today's month/year
    const startYear = startRefDate.getFullYear();
    const startMonth = startRefDate.getMonth();
    const endYear = todayDate.getFullYear();
    const endMonth = todayDate.getMonth();

    const dom = tx.dayOfMonth || 1;

    let currentYear = startYear;
    let currentMonth = startMonth;

    while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
      // Find date for dom in currentYear & currentMonth
      const daysInM = new Date(currentYear, currentMonth + 1, 0).getDate();
      const actualDom = Math.min(dom, daysInM);
      const occurrenceDate = new Date(currentYear, currentMonth, actualDom);
      const occurrenceStr = formatDate(occurrenceDate);

      // Verify bounds
      if (occurrenceStr >= tx.startDate && occurrenceStr <= todayStr) {
        if (!tx.lastPostedDate || occurrenceStr > tx.lastPostedDate) {
          dueDates.push(occurrenceStr);
        }
      }

      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
    }
  } else if (tx.frequency === 'weekly') {
    const targetDow = tx.dayOfWeek !== undefined ? tx.dayOfWeek : 1; // 0 Sunday, 1 Monday...
    // Step from startRefDate to todayDate
    const current = new Date(startRefDate);
    const limitDays = 365;
    let count = 0;
    while (current <= todayDate && count < limitDays) {
      const occurrenceStr = formatDate(current);
      if (current.getDay() === targetDow) {
        if (occurrenceStr >= tx.startDate && occurrenceStr <= todayStr) {
          if (!tx.lastPostedDate || occurrenceStr > tx.lastPostedDate) {
            dueDates.push(occurrenceStr);
          }
        }
      }
      current.setDate(current.getDate() + 1);
      count++;
    }
  } else if (tx.frequency === 'custom_days') {
    const interval = tx.intervalDays || 15;
    const current = parseDate(tx.startDate);
    
    let count = 0;
    while (count < 100) {
      current.setDate(current.getDate() + interval);
      const occurrenceStr = formatDate(current);
      if (occurrenceStr > todayStr) break;

      if (occurrenceStr >= tx.startDate && occurrenceStr <= todayStr) {
        if (!tx.lastPostedDate || occurrenceStr > tx.lastPostedDate) {
          dueDates.push(occurrenceStr);
        }
      }
      count++;
    }
  }

  const uniqueSorted = Array.from(new Set(dueDates)).sort();
  return uniqueSorted.slice(0, 10);
}

function getDueDatesForPAC(pac: PAC, todayStr: string): string[] {
  const dueDates: string[] = [];
  const startRef = pac.lastPostedDate || pac.startDate;
  
  if (startRef > todayStr) return [];

  const parseDate = (dStr: string) => {
    const parts = dStr.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  };

  const formatDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const startRefDate = parseDate(startRef);
  const todayDate = parseDate(todayStr);

  const startYear = startRefDate.getFullYear();
  const startMonth = startRefDate.getMonth();
  const endYear = todayDate.getFullYear();
  const endMonth = todayDate.getMonth();

  const dom = pac.dayOfMonth || 1;

  let currentYear = startYear;
  let currentMonth = startMonth;

  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
    const daysInM = new Date(currentYear, currentMonth + 1, 0).getDate();
    const actualDom = Math.min(dom, daysInM);
    const occurrenceDate = new Date(currentYear, currentMonth, actualDom);
    const occurrenceStr = formatDate(occurrenceDate);

    if (occurrenceStr >= pac.startDate && occurrenceStr <= todayStr) {
      if (!pac.lastPostedDate || occurrenceStr > pac.lastPostedDate) {
        dueDates.push(occurrenceStr);
      }
    }

    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
  }

  const uniqueSorted = Array.from(new Set(dueDates)).sort();
  return uniqueSorted.slice(0, 12);
}

function getMonthStartIso() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return monthStart.toISOString().slice(0, 10);
}

function getPresetDateRange(preset: string): { start: string; end: string } {
  const today = new Date();
  const format = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  switch (preset) {
    case 'today': {
      const t = format(today);
      return { start: t, end: t };
    }
    case 'last7': {
      const past = new Date(today);
      past.setDate(past.getDate() - 6);
      return { start: format(past), end: format(today) };
    }
    case 'last30': {
      const past = new Date(today);
      past.setDate(past.getDate() - 29);
      return { start: format(past), end: format(today) };
    }
    case 'thisMonth': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: format(first), end: format(last) };
    }
    case 'lastMonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: format(first), end: format(last) };
    }
    case 'thisYear': {
      const first = new Date(today.getFullYear(), 0, 1);
      const last = new Date(today.getFullYear(), 11, 31);
      return { start: format(first), end: format(last) };
    }
    case 'lastYear': {
      const first = new Date(today.getFullYear() - 1, 0, 1);
      const last = new Date(today.getFullYear() - 1, 11, 31);
      return { start: format(first), end: format(last) };
    }
    case 'all':
    default:
      return { start: '', end: '' };
  }
}


// Cached instances of Intl formatters for extreme speed and memory efficiency
const euroFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: 1,
});

const displayDateFormat = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const longDateFormat = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const portfolioDateFormat = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: 'short',
});

let globalHideNumbers = loadStoredValue<boolean>(HIDE_NUMBERS_STORAGE_KEY, false);

function setGlobalHideNumbers(val: boolean) {
  globalHideNumbers = val;
}

function formatEuro(amount: number) {
  if (globalHideNumbers) return '€ •••••';
  const absolute = euroFormatter.format(Math.abs(amount));
  return `${amount < 0 ? '-' : ''}€${absolute}`;
}

function formatEuroCompact(amount: number) {
  if (globalHideNumbers) return '€ •••••';
  const isNegative = amount < 0;
  const absVal = Math.abs(amount);
  if (absVal === 0) return '€0';
  if (absVal >= 1000000) {
    return `${isNegative ? '-' : ''}€${compactFormatter.format(absVal / 1000000)}M`;
  }
  if (absVal >= 1000) {
    return `${isNegative ? '-' : ''}€${compactFormatter.format(absVal / 1000)}k`;
  }
  return `${isNegative ? '-' : ''}€${Math.round(absVal)}`;
}

function adjustColorBrightness(hex: string, percent: number) {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map((char) => char + char).join('');
  }
  const num = parseInt(cleanHex, 16);
  if (Number.isNaN(num)) return hex;
  
  let r = (num >> 16) + percent;
  let g = ((num >> 8) & 0x00ff) + percent;
  let b = (num & 0x0000ff) + percent;
  
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  
  const hexStr = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return `#${hexStr}`;
}

function formatTickerCurrency(amount: number, currencyCode?: string) {
  if (globalHideNumbers) return '•••••';
  const code = currencyCode ? currencyCode.trim().toUpperCase() : 'EUR';
  const absolute = euroFormatter.format(Math.abs(amount));
  const sign = amount < 0 ? '-' : '';

  if (code === 'EUR') {
    return `${sign}€${absolute}`;
  } else if (code === 'USD') {
    return `${sign}${absolute} USD`;
  } else {
    return `${sign}${absolute} ${code}`;
  }
}

function formatSignedEuro(amount: number) {
  if (globalHideNumbers) return `${amount >= 0 ? '+' : '-'}€ •••••`;
  return `${amount >= 0 ? '+' : '-'}€${euroFormatter.format(Math.abs(amount))}`;
}

function formatQuantity(qty: number) {
  if (globalHideNumbers) return '••••';
  return String(qty);
}

function getDonutSlicePath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  let diff = endAngle - startAngle;
  if (diff >= 360) {
    endAngle = startAngle + 359.99;
    diff = 359.99;
  }
  if (diff <= 0) return '';

  const startRad = ((startAngle - 90) * Math.PI) / 180;
  const endRad = ((endAngle - 90) * Math.PI) / 180;

  const x1_out = cx + outerRadius * Math.cos(startRad);
  const y1_out = cy + outerRadius * Math.sin(startRad);
  const x2_out = cx + outerRadius * Math.cos(endRad);
  const y2_out = cy + outerRadius * Math.sin(endRad);

  const x1_in = cx + innerRadius * Math.cos(startRad);
  const y1_in = cy + innerRadius * Math.sin(startRad);
  const x2_in = cx + innerRadius * Math.cos(endRad);
  const y2_in = cy + innerRadius * Math.sin(endRad);

  const largeArcFlag = diff > 180 ? 1 : 0;

  return [
    `M ${x1_out} ${y1_out}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x2_out} ${y2_out}`,
    `L ${x2_in} ${y2_in}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x1_in} ${y1_in}`,
    'Z',
  ].join(' ');
}

function formatDisplayDate(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const differenceInDays = Math.round((startOfToday - startOfTarget) / 86400000);

  if (differenceInDays === 0) {
    return 'Oggi';
  }

  if (differenceInDays === 1) {
    return 'Ieri';
  }

  return displayDateFormat.format(date);
}

function formatLongDate(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return longDateFormat.format(date);
}

export function isTransferCategory(category?: string, subcategory?: string): boolean {
  if (!category && !subcategory) return false;
  const cat = (category || '').trim().toLowerCase();
  const sub = (subcategory || '').trim().toLowerCase();
  const keywords = ['trasferimento', 'trasferimenti', 'giroconto', 'giroconti', 'transfer', 'transfers'];
  return keywords.some((kw) => cat.includes(kw) || sub.includes(kw));
}

function formatKindLabel(kind: TransactionKind, category?: string, subcategory?: string) {
  if (isTransferCategory(category, subcategory)) {
    return 'Trasferimento';
  }
  return kind === 'income' ? 'Entrata' : 'Uscita';
}

function formatCategoryPath(category: string, subcategory: string) {
  return subcategory.trim() ? `${category} · ${subcategory}` : category;
}

function formatAssetKindLabel(kind: AssetKind, etfSubtype?: string) {
  if (kind === 'etf_azionario' || etfSubtype === 'azionario') return 'ETF Azionario';
  if (kind === 'etf_obbligazionario' || etfSubtype === 'obbligazionario') return 'ETF Obbligazionario';
  const labels: Record<string, string> = {
    azioni: 'Azioni',
    obbligazioni: 'Obbligazioni',
    etf: 'ETF',
    etf_azionario: 'ETF Azionario',
    etf_obbligazionario: 'ETF Obbligazionario',
    liquidita: 'Liquidità',
    fondo: 'Fondo',
    proprieta_mobili: 'Proprietà Mobili',
    proprieta_immobili: 'Proprietà Immobili',
    cripto: 'Criptovalute',
    altro: 'Altro',
  };

  return labels[kind] || kind;
}

function formatPortfolioLabel(timestamp: number) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return 'Avvio';
  }

  return portfolioDateFormat.format(date);
}

function defaultDraft(): TransactionDraft {
  return {
    date: getTodayIso(),
    merchant: '',
    category: 'Ristoranti',
    subcategory: '',
    account: 'Conto principale',
    amount: '',
    kind: 'expense',
    note: '',
    needsReimbursement: false,
    reimbursementDueDate: '',
    isReimbursement: false,
    reimbursesTransactionId: '',
  };
}

function defaultBudgetDraft(): BudgetCategoryDraft {
  return {
    name: '',
    limit: '',
    limitType: 'fixed',
    limitPercent: '',
    color: '#38bdf8',
    note: '',
    subcategories: [],
  };
}

function createBudgetSubcategoryDraft(): BudgetSubcategoryDraft {
  return {
    id: `subcat-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    name: '',
    limit: '',
    limitType: 'fixed',
    limitPercent: '',
    note: '',
  };
}

function defaultAssetDraft(): AssetDraft {
  return {
    name: '',
    kind: 'etf_azionario',
    institution: '',
    quantity: '',
    unitValue: '',
    note: '',
    ticker: '',
    etfSubtype: 'azionario',
  };
}

function safeJsonParse<T>(raw: string, fallbackValue: T): T {
  try {
    return JSON.parse(raw, (key, value) => {
      // Prototype pollution mitigation
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    }) as T;
  } catch {
    return fallbackValue;
  }
}

function loadStoredValue<T>(storageKey: string, fallbackValue: T): T {
  if (typeof window === 'undefined') {
    return fallbackValue;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return fallbackValue;
  }

  return safeJsonParse<T>(raw, fallbackValue);
}

function normalizeBudgetSubcategory(input: Partial<BudgetSubcategory>, fallbackIndex: number): BudgetSubcategory {
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id : `subcat-${fallbackIndex}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    name: typeof input.name === 'string' ? input.name : '',
    limit: typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : 0,
    note: typeof input.note === 'string' ? input.note : '',
  };
}

function normalizeBudgetCategory(input: Partial<BudgetCategory>, fallbackIndex: number): BudgetCategory {
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id : `budget-${fallbackIndex}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    name: typeof input.name === 'string' ? input.name : '',
    limit: typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : 0,
    color: typeof input.color === 'string' ? input.color : '#38bdf8',
    note: typeof input.note === 'string' ? input.note : '',
    subcategories: Array.isArray(input.subcategories)
      ? input.subcategories.map((subcategory, index) => normalizeBudgetSubcategory(subcategory, index))
      : [],
  };
}

function loadStoredTransactions(): Transaction[] {
  if (typeof window === 'undefined') {
    return initialTransactions;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return initialTransactions;
  }

  const parsed = safeJsonParse<Transaction[]>(raw, initialTransactions);

  if (!Array.isArray(parsed)) {
    return initialTransactions;
  }

  return parsed
    .map((transaction) => ({
      ...transaction,
      subcategory: typeof transaction.subcategory === 'string' ? transaction.subcategory : '',
      createdAt: typeof transaction.createdAt === 'number' ? transaction.createdAt : Date.now(),
      needsReimbursement: Boolean(transaction.needsReimbursement),
      reimbursesTransactionId: typeof transaction.reimbursesTransactionId === 'string' ? transaction.reimbursesTransactionId : undefined,
    }))
    .sort((left, right) => right.createdAt - left.createdAt);
}

function loadStoredTransactionOrder() {
  const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  const parsed = safeJsonParse<unknown>(raw, []);
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
}

function mergeDuplicateCategories(categories: BudgetCategory[]): BudgetCategory[] {
  if (!Array.isArray(categories)) return [];
  const merged: BudgetCategory[] = [];

  for (const cat of categories) {
    if (!cat || typeof cat.name !== 'string') continue;
    const trimmedName = cat.name.trim();
    if (!trimmedName) continue;

    const existing = merged.find(c => c.name.toLowerCase().trim() === trimmedName.toLowerCase());

    if (existing) {
      // Fusion of Category limits
      const existingLimitType = existing.limitType || 'fixed';
      const catLimitType = cat.limitType || 'fixed';

      if (existingLimitType === 'percentage' || catLimitType === 'percentage') {
        existing.limitType = 'percentage';
        const p1 = existingLimitType === 'percentage' ? (existing.limitPercent ?? 0) : 0;
        const p2 = catLimitType === 'percentage' ? (cat.limitPercent ?? 0) : 0;
        existing.limitPercent = Math.min(100, p1 + p2);
        existing.limit = 0;
      } else {
        existing.limitType = 'fixed';
        existing.limit = (existing.limit || 0) + (cat.limit || 0);
        existing.limitPercent = undefined;
      }

      // Fusion of Notes
      if (cat.note && cat.note.trim()) {
        const catNoteTrimmed = cat.note.trim();
        if (!existing.note) {
          existing.note = catNoteTrimmed;
        } else if (!existing.note.includes(catNoteTrimmed)) {
          existing.note = `${existing.note}; ${catNoteTrimmed}`;
        }
      }

      // Fusion of Subcategories
      const mergedSubs: BudgetSubcategory[] = [...existing.subcategories];
      if (Array.isArray(cat.subcategories)) {
        for (const sub of cat.subcategories) {
          if (!sub || typeof sub.name !== 'string') continue;
          const trimmedSubName = sub.name.trim();
          if (!trimmedSubName) continue;

          const existingSub = mergedSubs.find(s => s.name.toLowerCase().trim() === trimmedSubName.toLowerCase());
          if (existingSub) {
            const subLimitType = sub.limitType || 'fixed';
            const existingSubLimitType = existingSub.limitType || 'fixed';

            if (existingSubLimitType === 'percentage' || subLimitType === 'percentage') {
              existingSub.limitType = 'percentage';
              const sp1 = existingSubLimitType === 'percentage' ? (existingSub.limitPercent ?? 0) : 0;
              const sp2 = subLimitType === 'percentage' ? (sub.limitPercent ?? 0) : 0;
              existingSub.limitPercent = Math.min(100, sp1 + sp2);
              existingSub.limit = 0;
            } else {
              existingSub.limitType = 'fixed';
              existingSub.limit = (existingSub.limit || 0) + (sub.limit || 0);
              existingSub.limitPercent = undefined;
            }

            if (sub.note && sub.note.trim()) {
              const subNoteTrimmed = sub.note.trim();
              if (!existingSub.note) {
                existingSub.note = subNoteTrimmed;
              } else if (!existingSub.note.includes(subNoteTrimmed)) {
                existingSub.note = `${existingSub.note}; ${subNoteTrimmed}`;
              }
            }
          } else {
            mergedSubs.push({
              ...sub,
              name: trimmedSubName,
            });
          }
        }
      }
      existing.subcategories = mergedSubs;
    } else {
      merged.push({
        ...cat,
        name: trimmedName,
        subcategories: Array.isArray(cat.subcategories)
          ? cat.subcategories
              .filter(sub => sub && typeof sub.name === 'string')
              .map(sub => ({
                ...sub,
                name: sub.name.trim(),
              }))
          : [],
      });
    }
  }

  // Sort categories alphabetically by name (locale-aware, case-insensitive)
  const sorted = [...merged].sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));

  // Also sort subcategories for each category alphabetically by name
  sorted.forEach((cat) => {
    if (cat.subcategories && Array.isArray(cat.subcategories)) {
      cat.subcategories.sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
    }
  });

  return sorted;
}

function loadStoredBudgetCategories(): BudgetCategory[] {
  const loadedCategories = loadStoredValue<BudgetCategory[]>(BUDGET_STORAGE_KEY, initialBudgetCategories);

  const normalized = Array.isArray(loadedCategories) && loadedCategories.length > 0
    ? loadedCategories.map((category, index) => normalizeBudgetCategory(category, index))
    : initialBudgetCategories;

  return mergeDuplicateCategories(normalized);
}

function loadStoredAssets(): Asset[] {
  const loadedAssets = loadStoredValue<Asset[]>(ASSET_STORAGE_KEY, initialAssets);

  return Array.isArray(loadedAssets) && loadedAssets.length > 0 ? loadedAssets : initialAssets;
}

function parseItalianDate(dateInput: any): string {
  if (!dateInput) return '';
  if (dateInput instanceof Date || Object.prototype.toString.call(dateInput) === '[object Date]') {
    const yyyy = dateInput.getFullYear();
    const mm = String(dateInput.getMonth() + 1).padStart(2, '0');
    const dd = String(dateInput.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const strVal = String(dateInput).trim();

  // Handle Excel serial date numbers (e.g., 44363 or "44363.87" representing 16/06/2021)
  const num = Number(strVal);
  if (!isNaN(num) && num >= 20000 && num < 100000) {
    // Excel serial date starting point is 1899-12-30
    const dateNum = Math.floor(num);
    const date = new Date((dateNum - 25569) * 86400 * 1000);
    if (Number.isFinite(date.getTime())) {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  const clean = strVal;

  // Try DD/MM/YY or DD/MM/YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
  if (dmyMatch) {
    let day = dmyMatch[1].padStart(2, '0');
    let month = dmyMatch[2].padStart(2, '0');
    let yearStr = dmyMatch[3];
    let year = parseInt(yearStr, 10);
    if (yearStr.length === 2) {
      year = 2000 + year; // assume 20xx
    }
    return `${year}-${month}-${day}`;
  }

  // Fallback to ISO format if it's already YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  // Fallback to JavaScript Date.parse if it can understand it
  const parsedTime = Date.parse(clean);
  if (!isNaN(parsedTime)) {
    const date = new Date(parsedTime);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return clean;
}

function formatDateToItalian(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0]; // full year, e.g. "2026"
    const month = parts[1];
    const day = parts[2];
    return `${day}/${month}/${year}`;
  }
  return dateStr;
}

function cleanAndParseAmount(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') {
    return Math.abs(val);
  }
  const str = String(val).replace(/[\s€]/g, '').replace(',', '.').trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : Math.abs(num);
}

function normalizeHeader(header: string) {
  const value = header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '');

  const aliases: Record<string, string> = {
    id: 'id',
    date: 'date',
    data: 'date',
    merchant: 'merchant',
    esercente: 'merchant',
    beneficiario: 'merchant',
    category: 'category',
    categoria: 'category',
    subcategory: 'subcategory',
    sottocategoria: 'subcategory',
    sottocategorie: 'subcategory',
    account: 'account',
    conto: 'account',
    amount: 'amount',
    importo: 'amount',
    kind: 'kind',
    tipo: 'kind',
    note: 'note',
    nota: 'note',
    createdat: 'createdAt',
    creatoil: 'createdAt',
    valuta: 'valuta',
    prelievo: 'prelievo',
    deposito: 'deposito',
  };

  return aliases[value] ?? value;
}

function splitCsvLine(line: string, delimiter: string) {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      const nextCharacter = line[index + 1];

      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (character === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  result.push(current.trim());
  return result;
}

function detectDelimiter(headerLine: string) {
  const semicolonCount = (headerLine.match(/;/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;

  return semicolonCount > commaCount ? ';' : ',';
}

function parseTransactionKind(value: string, amount: number) {
  const normalized = value.trim().toLowerCase();

  if (['income', 'entrata', 'entrate', 'incasso', 'credit', 'deposito'].includes(normalized)) {
    return 'income' as const;
  }

  if (['expense', 'uscita', 'uscite', 'spesa', 'debit', 'prelievo'].includes(normalized)) {
    return 'expense' as const;
  }

  return amount >= 0 ? 'income' : 'expense';
}

function normalizeImportedTransaction(input: Record<string, any>): Transaction | null {
  const merchant = String(input.merchant ?? '').trim();
  const category = String(input.category ?? '').trim();
  const subcategory = String(input.subcategory ?? '').trim();
  const account = String(input.account ?? '').trim();
  const dateVal = input.date;
  const note = String(input.note ?? '').trim();

  if (!merchant || !account || !dateVal) {
    return null;
  }

  const date = parseItalianDate(dateVal);

  const prelievoStr = input.prelievo !== undefined ? String(input.prelievo).trim() : '';
  const depositoStr = input.deposito !== undefined ? String(input.deposito).trim() : '';
  const hasPrelievo = prelievoStr !== '';
  const hasDeposito = depositoStr !== '';

  let amount = 0;
  let kind: TransactionKind = 'expense';

  if (hasDeposito && cleanAndParseAmount(depositoStr) > 0) {
    amount = cleanAndParseAmount(depositoStr);
    kind = 'income';
  } else if (hasPrelievo && cleanAndParseAmount(prelievoStr) > 0) {
    amount = -cleanAndParseAmount(prelievoStr);
    kind = 'expense';
  } else {
    // Check 'tipo' or 'kind' value
    const tipoText = String(input.kind ?? '').trim().toLowerCase();
    const parsedAmount = Number(String(input.amount ?? '').replace(',', '.'));
    
    if (tipoText === 'deposito') {
      amount = Number.isFinite(parsedAmount) ? Math.abs(parsedAmount) : 0;
      kind = 'income';
    } else if (tipoText === 'prelievo') {
      amount = Number.isFinite(parsedAmount) ? -Math.abs(parsedAmount) : 0;
      kind = 'expense';
    } else if (Number.isFinite(parsedAmount)) {
      kind = parseTransactionKind(tipoText, parsedAmount);
      amount = Math.abs(parsedAmount) * (kind === 'expense' ? -1 : 1);
    } else {
      return null;
    }
  }

  const createdAt = input.createdAt ? Number(input.createdAt) : Date.now();
  const finalCategory = category || (kind === 'income' ? 'Entrate' : 'Altro');

  return {
    id: String(input.id ?? '').trim() || createTransactionId(),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    date,
    merchant,
    category: finalCategory,
    subcategory,
    account,
    amount,
    kind,
    note,
  };
}

function parseRaiffeisenRow(row: Record<string, any>): Transaction | null {
  const findValue = (possibleKeys: string[]) => {
    for (const pk of possibleKeys) {
      for (const key of Object.keys(row)) {
        const normalizedKey = key.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '');
        if (normalizedKey === pk || normalizedKey.includes(pk) || pk.includes(normalizedKey)) {
          if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
            return row[key];
          }
        }
      }
    }
    return undefined;
  };

  const rawDate = findValue(['valutabeneficiario', 'valutabenefici', 'valutabenefi', 'valutabenef', 'valuta', 'datacontabi', 'datacontabile', 'data']);
  const rawDare = findValue(['dare']);
  const rawAvere = findValue(['avere']);
  const rawDescrizione = findValue(['descrizione', 'causale']);
  const rawCausale = findValue(['causale']);
  const rawNote = findValue(['note', 'nota']);

  if (!rawDate) return null;

  const date = parseItalianDate(rawDate);
  if (!date) return null;

  const merchant = String(rawDescrizione || rawCausale || 'Raiffeisen Transaction').trim();
  const noteParts: string[] = [];
  if (rawCausale) noteParts.push(`Causale: ${rawCausale}`);
  if (rawNote) noteParts.push(String(rawNote));
  const note = noteParts.join(' - ').trim();

  const parseNum = (val: any): number => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    let str = String(val).trim();
    if (str.includes('.') && str.includes(',')) {
      if (str.indexOf('.') < str.indexOf(',')) {
        str = str.replace(/\./g, '').replace(/,/g, '.');
      } else {
        str = str.replace(/,/g, '').replace(/\./g, '.');
      }
    } else if (str.includes(',')) {
      str = str.replace(/,/g, '.');
    }
    const parsed = parseFloat(str);
    return isNaN(parsed) ? 0 : parsed;
  };

  const dareVal = parseNum(rawDare);
  const avereVal = parseNum(rawAvere);

  let amount = 0;
  let kind: TransactionKind = 'expense';

  if (avereVal !== 0) {
    amount = Math.abs(avereVal);
    kind = 'income';
  } else if (dareVal !== 0) {
    amount = -Math.abs(dareVal);
    kind = 'expense';
  } else {
    return null;
  }

  return {
    id: createTransactionId(),
    createdAt: Date.now(),
    date,
    merchant,
    category: kind === 'income' ? 'Entrate' : 'Altro',
    subcategory: '',
    account: 'Raiffeisen',
    amount,
    kind,
    note,
  };
}

function parseNexiRow(row: Record<string, any>): Transaction | null {
  const findValue = (possibleKeys: string[]) => {
    for (const key of Object.keys(row)) {
      const normalizedKey = key.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '');
      if (possibleKeys.some(pk => normalizedKey.includes(pk))) {
        return row[key];
      }
    }
    return undefined;
  };

  const rawDate = findValue(['data']);
  const rawDescrizione = findValue(['descrizione']);
  const rawCategorie = findValue(['categorie', 'categoria']);
  const rawAmount = findValue(['importocambio', 'importo', 'amount']);
  const rawRiferimento = findValue(['riferimento']);
  const rawStato = findValue(['stato']);
  const rawCommNexi = findValue(['commissionenexi']);
  const rawCommCircuiti = findValue(['commissionecircuiti']);

  if (!rawDate) return null;

  const date = parseItalianDate(rawDate);
  if (!date) return null;

  const merchant = String(rawDescrizione || 'Nexi Transaction').trim();
  const category = String(rawCategorie || 'Altro').trim();

  const parseNum = (val: any): number => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    let str = String(val).trim();
    if (str.includes('.') && str.includes(',')) {
      if (str.indexOf('.') < str.indexOf(',')) {
        str = str.replace(/\./g, '').replace(/,/g, '.');
      } else {
        str = str.replace(/,/g, '').replace(/\./g, '.');
      }
    } else if (str.includes(',')) {
      str = str.replace(/,/g, '.');
    }
    const parsed = parseFloat(str);
    return isNaN(parsed) ? 0 : parsed;
  };

  const parsedAmount = parseNum(rawAmount);
  if (parsedAmount === 0) return null;

  // Nexi is a credit card statement, positive numbers represent charges (expenses)
  let amount = -Math.abs(parsedAmount);
  let kind: TransactionKind = 'expense';

  // If parsedAmount is negative, it's a refund (income)
  if (parsedAmount < 0) {
    amount = Math.abs(parsedAmount);
    kind = 'income';
  }

  const noteParts: string[] = [];
  if (rawRiferimento) noteParts.push(`Rif: ${rawRiferimento}`);
  if (rawStato) noteParts.push(`Stato: ${rawStato}`);
  
  const commNexi = parseNum(rawCommNexi);
  const commCirc = parseNum(rawCommCircuiti);
  if (commNexi > 0) noteParts.push(`Comm. Nexi: €${commNexi.toFixed(2)}`);
  if (commCirc > 0) noteParts.push(`Comm. Circuiti: €${commCirc.toFixed(2)}`);

  const note = noteParts.join(' - ').trim();

  return {
    id: createTransactionId(),
    createdAt: Date.now(),
    date,
    merchant,
    category,
    subcategory: '',
    account: 'Nexi',
    amount,
    kind,
    note,
  };
}

function parseFileRows(rows: Record<string, any>[], format: 'template' | 'raiffeisen' | 'nexi') {
  const transactions: Transaction[] = [];
  let skipped = 0;

  rows.forEach((row) => {
    let importedTransaction: Transaction | null = null;
    if (format === 'raiffeisen') {
      importedTransaction = parseRaiffeisenRow(row);
    } else if (format === 'nexi') {
      importedTransaction = parseNexiRow(row);
    } else {
      // template
      const normalizedRow: Record<string, any> = Object.create(null);
      Object.keys(row).forEach((key) => {
        const normKey = normalizeHeader(key);
        if (normKey !== '__proto__' && normKey !== 'constructor' && normKey !== 'prototype') {
          normalizedRow[normKey] = row[key];
        }
      });
      importedTransaction = normalizeImportedTransaction(normalizedRow);
    }

    if (importedTransaction) {
      transactions.push(importedTransaction);
    } else {
      skipped += 1;
    }
  });

  return { transactions, skipped };
}

function parseTransactionsCsv(csvText: string, format: 'template' | 'raiffeisen' | 'nexi' = 'template') {
  const normalizedText = csvText.replace(/\r\n/g, '\n').trim();

  if (!normalizedText) {
    return { transactions: [] as Transaction[], skipped: 0 };
  }

  const lines = normalizedText.split('\n').filter(Boolean);

  if (!lines.length) {
    return { transactions: [] as Transaction[], skipped: 0 };
  }

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitCsvLine(lines[0], delimiter);
  const headers = format === 'template'
    ? rawHeaders.map(normalizeHeader)
    : rawHeaders.map(h => h.trim());

  const rows = lines.slice(1);

  const parsedRows: Record<string, any>[] = [];

  rows.forEach((rowLine) => {
    const cells = splitCsvLine(rowLine, delimiter);
    const record: Record<string, string> = {};

    headers.forEach((header, index) => {
      record[header] = cells[index] ?? '';
    });
    parsedRows.push(record);
  });

  return parseFileRows(parsedRows, format);
}

function parseTransactionsWorkbook(arrayBuffer: ArrayBuffer, format: 'template' | 'raiffeisen' | 'nexi' = 'template') {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return { transactions: [] as Transaction[], skipped: 0 };
  }

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return { transactions: [] as Transaction[], skipped: 0 };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
  return parseFileRows(rows, format);
}

function parseAssetsFromWorkbook(arrayBuffer: ArrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  
  const assetsSheetName = workbook.SheetNames.find(name => {
    const n = name.trim().toLowerCase();
    return n === 'asset' || n === 'assets' || n === 'attività' || n === 'attivita';
  });

  const importedAssets: Asset[] = [];
  const importedAssetTxs: AssetTransaction[] = [];

  if (!assetsSheetName) {
    return { assets: importedAssets, assetTransactions: importedAssetTxs };
  }

  const sheet = workbook.Sheets[assetsSheetName];
  if (!sheet) {
    return { assets: importedAssets, assetTransactions: importedAssetTxs };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
  
  const cleanNum = (val: any) => {
    if (val === undefined || val === null || val === '') return 0;
    const str = String(val).replace(/[^0-9\.,-]/g, '').replace(',', '.');
    return parseFloat(str) || 0;
  };

  rows.forEach((row) => {
    const normalizedRow: Record<string, any> = Object.create(null);
    Object.keys(row).forEach((key) => {
      const cleanKey = key.trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (cleanKey !== '__proto__' && cleanKey !== 'constructor' && cleanKey !== 'prototype') {
        normalizedRow[cleanKey] = row[key];
      }
    });

    const name = String(normalizedRow['nome'] || normalizedRow['name'] || '').trim();
    if (!name) return;

    const rawKind = String(normalizedRow['tipo'] || normalizedRow['kind'] || normalizedRow['type'] || '').toLowerCase();
    const ticker = String(normalizedRow['ticker'] || '').trim().toUpperCase();
    let kind: AssetKind = 'altro';
    let etfSubtype: 'azionario' | 'obbligazionario' | undefined = undefined;

    if (rawKind.includes('etf')) {
      const isBond = rawKind.includes('obbligaz') || rawKind.includes('bond') || /bond|obbligaz|treasury|bpt|bund|fixed income/i.test(`${name} ${ticker}`);
      kind = isBond ? 'etf_obbligazionario' : 'etf_azionario';
      etfSubtype = isBond ? 'obbligazionario' : 'azionario';
    } else if (rawKind.includes('azion')) {
      kind = 'azioni';
    } else if (rawKind.includes('obbligazion')) {
      kind = 'obbligazioni';
    } else if (rawKind.includes('liquidit')) {
      kind = 'liquidita';
    } else if (rawKind.includes('fond')) {
      kind = 'fondo';
    } else if (rawKind.includes('cripto') || rawKind.includes('crypto')) {
      kind = 'cripto';
    }

    const institution = String(normalizedRow['istituto'] || normalizedRow['institution'] || '').trim();
    const quantity = cleanNum(normalizedRow['quantita'] || normalizedRow['quantity']);
    const unitValue = cleanNum(normalizedRow['valore unitario'] || normalizedRow['valore_unitario'] || normalizedRow['unit value'] || normalizedRow['unit_value'] || normalizedRow['prezzo'] || normalizedRow['price']);
    const note = String(normalizedRow['note'] || normalizedRow['notes'] || '').trim();

    const asset: Asset = {
      id: 'asset-' + Math.random().toString(36).substr(2, 9),
      name,
      kind,
      institution,
      quantity,
      unitValue,
      note,
      ticker: ticker || undefined,
      etfSubtype,
      createdAt: Date.now()
    };

    importedAssets.push(asset);
  });

  importedAssets.forEach((asset) => {
    const assetSheetName = workbook.SheetNames.find(name => {
      const n = name.trim().toLowerCase();
      const assetName = asset.name.toLowerCase();
      const assetTicker = asset.ticker ? asset.ticker.toLowerCase() : '';
      return n === assetName || (assetTicker && n === assetTicker);
    });

    if (assetSheetName) {
      const assetSheet = workbook.Sheets[assetSheetName];
      if (assetSheet) {
        const txRows = XLSX.utils.sheet_to_json<Record<string, any>>(assetSheet, { defval: '' });
        txRows.forEach((row) => {
          const normRow: Record<string, any> = Object.create(null);
          Object.keys(row).forEach((k) => {
            const cleanK = k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (cleanK !== '__proto__' && cleanK !== 'constructor' && cleanK !== 'prototype') {
              normRow[cleanK] = row[k];
            }
          });

          const rawDate = normRow['data'] || normRow['date'];
          const parsedDate = parseItalianDate(rawDate);
          
          const rawAzioni = normRow['azioni'] || normRow['shares'] || normRow['quantita'] || normRow['quantity'];
          const qtyVal = cleanNum(rawAzioni);
          if (qtyVal === 0) return;

          const rawPrezzo = normRow['prezzo'] || normRow['price'] || normRow['valore unitario'];
          const priceVal = cleanNum(rawPrezzo);

          const rawComm = normRow['commissioni'] || normRow['commissione'] || normRow['fees'] || normRow['fee'] || normRow['commission'];
          const commVal = cleanNum(rawComm);

          let finalNote = '';
          if (commVal > 0) {
            finalNote = `Commissioni: ${commVal.toFixed(2)} €`;
          }

          const tx: AssetTransaction = {
            id: 'asset-tx-' + Math.random().toString(36).substr(2, 9),
            assetId: asset.id,
            date: parsedDate || new Date().toISOString().split('T')[0],
            kind: qtyVal >= 0 ? 'buy' : 'sell',
            quantity: Math.abs(qtyVal),
            unitValue: priceVal,
            note: finalNote,
            createdAt: Date.now()
          };

          importedAssetTxs.push(tx);
        });
      }
    }
  });

  return { assets: importedAssets, assetTransactions: importedAssetTxs };
}

function buildTransactionsCsv(transactions: Transaction[]) {
  const headers = [
    'Data',
    'Tipo',
    'Conto',
    'Beneficiario',
    'Valuta',
    'Categoria',
    'Sotto-Categoria',
    'Note',
    'Prelievo',
    'Deposito'
  ];

  const escapeCell = (value: string | number) => {
    let text = String(value ?? '');

    // Prevent CSV Formula Injection (CWE-1236):
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }

    if (/[";\n,]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
  };

  const rows = transactions.map((transaction) => {
    const isIncome = transaction.kind === 'income';
    const amountVal = Math.abs(transaction.amount);
    return [
      formatDateToItalian(transaction.date),
      isIncome ? 'Deposito' : 'Prelievo',
      transaction.account,
      transaction.merchant,
      'EUR',
      transaction.category,
      transaction.subcategory,
      transaction.note,
      !isIncome ? amountVal.toFixed(2) : '',
      isIncome ? amountVal.toFixed(2) : '',
    ];
  });

  return [headers.join(';'), ...rows.map((row) => row.map(escapeCell).join(';'))].join('\n');
}

function sanitizeFormulaInjection(value: string | number | undefined): string | number {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^[=+\-@\t\r]/.test(trimmed)) {
      return `'${value}`;
    }
    return value;
  }
  return value ?? '';
}

function buildTransactionsWorkbook(transactions: Transaction[]) {
  const rows = transactions.map((transaction) => {
    const isIncome = transaction.kind === 'income';
    const amountVal = Math.abs(transaction.amount);
    return {
      'Data': formatDateToItalian(transaction.date),
      'Tipo': isIncome ? 'Deposito' : 'Prelievo',
      'Conto': sanitizeFormulaInjection(transaction.account),
      'Beneficiario': sanitizeFormulaInjection(transaction.merchant),
      'Valuta': 'EUR',
      'Categoria': sanitizeFormulaInjection(transaction.category),
      'Sotto-Categoria': sanitizeFormulaInjection(transaction.subcategory),
      'Note': sanitizeFormulaInjection(transaction.note),
      'Prelievo': !isIncome ? amountVal : '',
      'Deposito': isIncome ? amountVal : '',
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      'Data',
      'Tipo',
      'Conto',
      'Beneficiario',
      'Valuta',
      'Categoria',
      'Sotto-Categoria',
      'Note',
      'Prelievo',
      'Deposito'
    ],
  });
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Transazioni');

  return workbook;
}

function buildImportTemplateWorkbook() {
  const templateRows = [
    {
      'Data': '16/06/2021',
      'Tipo': 'Prelievo',
      'Conto': 'Raiffeisen',
      'Beneficiario': 'POS SKORPION EXPRESS GMBH 16.06.21 21:07:00 EUR',
      'Valuta': 'EUR',
      'Categoria': 'Alimentazione',
      'Sotto-Categoria': 'Ristorante',
      'Note': '',
      'Prelievo': '37,00 €',
      'Deposito': '',
    },
    {
      'Data': '17/06/2021',
      'Tipo': 'Deposito',
      'Conto': 'Conto principale',
      'Beneficiario': 'Stipendio',
      'Valuta': 'EUR',
      'Categoria': 'Entrate',
      'Sotto-Categoria': 'Lavoro',
      'Note': '',
      'Prelievo': '',
      'Deposito': '1500,00 €',
    }
  ];

  const templateSheet = XLSX.utils.json_to_sheet(templateRows, {
    header: [
      'Data',
      'Tipo',
      'Conto',
      'Beneficiario',
      'Valuta',
      'Categoria',
      'Sotto-Categoria',
      'Note',
      'Prelievo',
      'Deposito'
    ],
  });

  const assetTemplateRows = [
    {
      'Nome': 'SWDA.MI',
      'Tipo': 'ETF',
      'Istituto': 'Directa',
      'Quantità': '10',
      'Valore Unitario': '82,50',
      'Ticker': 'SWDA.MI',
      'Note': 'Msci World ETF'
    },
    {
      'Nome': 'Bitcoin',
      'Tipo': 'Altro',
      'Istituto': 'Coinbase',
      'Quantità': '0,05',
      'Valore Unitario': '58000,00',
      'Ticker': 'BTC-USD',
      'Note': 'Crypto'
    }
  ];

  const assetTemplateSheet = XLSX.utils.json_to_sheet(assetTemplateRows, {
    header: [
      'Nome',
      'Tipo',
      'Istituto',
      'Quantità',
      'Valore Unitario',
      'Ticker',
      'Note'
    ]
  });

  const swdaTransactionsRows = [
    {
      'Data': '10/03/25',
      'Azioni': '0,0139',
      'Prezzo': '35,96 €',
      'Commissioni': '1,00 €',
      'Valore': '0,50 €'
    },
    {
      'Data': '12/03/25',
      'Azioni': '10,0000',
      'Prezzo': '82,50 €',
      'Commissioni': '1,50 €',
      'Valore': '826,50 €'
    }
  ];

  const swdaSheet = XLSX.utils.json_to_sheet(swdaTransactionsRows, {
    header: [
      'Data',
      'Azioni',
      'Prezzo',
      'Commissioni',
      'Valore'
    ]
  });

  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ['Importazione guidata in Excel'],
    ['1. FOGLIO TRANSAZIONI (Transazioni generali):'],
    ['Compila il foglio "Transazioni" con le tue spese ed entrate giornaliere.'],
    ['Colonne: Data, Tipo, Conto, Beneficiario, Valuta, Categoria, Sotto-Categoria, Note, Prelievo, Deposito.'],
    ['Usa date nel formato italiano (es. DD/MM/YYYY o DD/MM/YY).'],
    [''],
    ['2. FOGLIO ASSET (Importazione Asset patrimoniali):'],
    ['Compila il foglio "Asset" con gli investimenti o beni patrimoniali che possiedi.'],
    ['Colonne: Nome, Tipo, Istituto, Quantità, Valore Unitario, Ticker, Note.'],
    ['Tipo consigliati: "ETF", "Azioni", "Obbligazioni", "Liquidità", "Fondo", "Altro".'],
    [''],
    ['3. FOGLI DI DETTAGLIO ASSET (Transazioni relative a ciascun Asset):'],
    ['Puoi creare un foglio Excel separato denominato ESATTAMENTE come il "Nome" dell\'asset (es. "SWDA.MI" o "Bitcoin").'],
    ['In quel foglio, compila le transazioni di acquisto o vendita di quell\'asset con queste esatte colonne:'],
    ['Data, Azioni, Prezzo, Commissioni, Valore.'],
    ['La colonna "Azioni" rappresenta la quantità di quote acquistate (numero positivo) o vendute (numero negativo).'],
    ['La colonna "Prezzo" è il prezzo di carico unitario, "Commissioni" sono i costi e "Valore" è il totale dell\'operazione.'],
  ]);

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, templateSheet, 'Transazioni');
  XLSX.utils.book_append_sheet(workbook, assetTemplateSheet, 'Asset');
  XLSX.utils.book_append_sheet(workbook, swdaSheet, 'SWDA.MI');
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Istruzioni');

  return workbook;
}

function MetricCard({ label, value, delta, subValue }: { label: string; value: string; delta: string; subValue?: React.ReactNode }) {
  return (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {subValue && (
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '2px', display: 'block', fontWeight: 500 }}>
          {subValue}
        </span>
      )}
      <span className="metric-delta">{delta}</span>
    </article>
  );
}

function TransactionEditor({
  mode,
  draft,
  editingTransaction,
  categoryOptions,
  subcategoryOptions,
  accountOptions,
  candidateExpenses,
  allTransactions,
  onChange,
  onSubmit,
  onReset,
  onDelete,
}: {
  mode: 'create' | 'edit';
  draft: TransactionDraft;
  editingTransaction: Transaction | null;
  categoryOptions: string[];
  subcategoryOptions: string[];
  accountOptions: string[];
  candidateExpenses: Transaction[];
  allTransactions: Transaction[];
  onChange: <K extends keyof TransactionDraft>(field: K, value: TransactionDraft[K]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const [isCustomAccount, setIsCustomAccount] = useState<boolean>(false);
  const [newAccountName, setNewAccountName] = useState<string>('');

  useEffect(() => {
    if (isCustomAccount && accountOptions.includes(draft.account)) {
      setIsCustomAccount(false);
      setNewAccountName('');
    }
  }, [draft.account, accountOptions, isCustomAccount]);

  const handleConfirmNewAccount = (nameToConfirm: string) => {
    const trimmed = nameToConfirm.trim();
    if (!trimmed) {
      handleCancelNewAccount();
      return;
    }

    const existing = accountOptions.find((acc) => acc.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onChange('account', existing);
      setIsCustomAccount(false);
      setNewAccountName('');
      return;
    }

    onChange('account', trimmed);
    setIsCustomAccount(false);
    setNewAccountName('');
  };

  const handleCancelNewAccount = () => {
    setNewAccountName('');
    setIsCustomAccount(false);
    const fallback = accountOptions.includes(draft.account) ? draft.account : (accountOptions[0] || 'Conto principale');
    onChange('account', fallback);
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCustomAccount) {
      const trimmed = newAccountName.trim();
      if (!trimmed) {
        handleCancelNewAccount();
        return;
      }
      const existing = accountOptions.find((acc) => acc.toLowerCase() === trimmed.toLowerCase());
      if (existing) {
        onChange('account', existing);
        setIsCustomAccount(false);
      } else {
        onChange('account', trimmed);
        setIsCustomAccount(false);
        setNewAccountName('');
      }
    }
    onSubmit(event);
  };

  return (
    <article className="panel editor-panel">
      <div className="panel-header">
        <div>
          <p className="panel-title">{mode === 'edit' ? 'Modifica transazione' : 'Nuova transazione'}</p>
          <h4>{mode === 'edit' ? 'Aggiorna il movimento selezionato' : 'Crea un nuovo movimento nel registro'}</h4>
        </div>
      </div>

      <form className="transaction-form" onSubmit={handleFormSubmit}>
        <div className="form-grid">
          <label className="form-field">
            <span>Data</span>
            <input type="date" value={draft.date} onChange={(event) => onChange('date', event.target.value)} required />
          </label>
          <label className="form-field">
            <span>Esercente</span>
            <input value={draft.merchant} onChange={(event) => onChange('merchant', event.target.value)} placeholder="Nome esercente" required />
          </label>
          <label className="form-field">
            <span>Categoria</span>
            <input
              value={draft.category}
              onChange={(event) => onChange('category', event.target.value)}
              placeholder="Categoria budget"
              list="category-options"
              required
            />
          </label>
          <label className="form-field">
            <span>Sottocategoria</span>
            <input
              value={draft.subcategory}
              onChange={(event) => onChange('subcategory', event.target.value)}
              placeholder="Sottocategoria facoltativa"
              list="subcategory-options"
            />
          </label>
          <label className="form-field">
            <span>Conto</span>
            {!isCustomAccount ? (
              <select
                value={accountOptions.includes(draft.account) ? draft.account : (draft.account ? '__CUSTOM__' : '')}
                onChange={(event) => {
                  const val = event.target.value;
                  if (val === '__NEW__') {
                    setIsCustomAccount(true);
                    setNewAccountName('');
                  } else if (val === '__CUSTOM__') {
                    setIsCustomAccount(true);
                    setNewAccountName(draft.account);
                  } else {
                    setIsCustomAccount(false);
                    onChange('account', val);
                  }
                }}
                required
              >
                <option value="" disabled>-- Seleziona un conto --</option>
                {accountOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {!accountOptions.includes(draft.account) && draft.account ? (
                  <option value="__CUSTOM__">{draft.account} (Nuovo)</option>
                ) : null}
                <option value="__NEW__" style={{ fontWeight: 600, color: 'var(--accent)' }}>
                  + Inserisci nuovo conto...
                </option>
              </select>
            ) : (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%' }}>
                <input
                  type="text"
                  value={newAccountName}
                  onChange={(event) => setNewAccountName(event.target.value)}
                  placeholder="Nome del nuovo conto"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleConfirmNewAccount(newAccountName);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      handleCancelNewAccount();
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="pill pill-primary"
                  style={{ padding: '6px 10px', fontSize: '0.78rem', whiteSpace: 'nowrap', cursor: 'pointer' }}
                  onClick={() => handleConfirmNewAccount(newAccountName)}
                >
                  OK
                </button>
                <button
                  type="button"
                  className="pill"
                  style={{ padding: '6px 10px', fontSize: '0.78rem', whiteSpace: 'nowrap', cursor: 'pointer' }}
                  onClick={handleCancelNewAccount}
                >
                  Annulla
                </button>
              </div>
            )}
          </label>
          <label className="form-field">
            <span>Importo</span>
            <input type="number" inputMode="decimal" step="0.01" value={draft.amount} onChange={(event) => onChange('amount', event.target.value)} placeholder="0,00" required />
          </label>
          <label className="form-field">
            <span>Tipo</span>
            <select
              value={draft.kind}
              onChange={(event) => {
                const nextKind = event.target.value as TransactionKind;
                onChange('kind', nextKind);
                if (nextKind === 'income') {
                  onChange('needsReimbursement', false);
                } else {
                  onChange('isReimbursement', false);
                  onChange('reimbursesTransactionId', '');
                }
              }}
            >
              <option value="expense">Uscita</option>
              <option value="income">Entrata</option>
            </select>
          </label>
        </div>

        {/* Banner Informativo Trasferimento Patrimoniale */}
        {isTransferCategory(draft.category, draft.subcategory) && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '0.82rem',
              color: '#38bdf8',
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>🔄</span>
            <div>
              <strong style={{ display: 'block', color: 'var(--text)', fontSize: '0.84rem' }}>
                Trasferimento Patrimoniale Interno
              </strong>
              <span style={{ color: 'var(--muted)', fontSize: '0.76rem', lineHeight: '1.3' }}>
                Questo movimento viene considerato uno spostamento interno tra conti o verso asset/investimenti. Non compare come spesa/uscita nei grafici e preserva l'integrità del patrimonio complessivo.
              </span>
            </div>
          </div>
        )}

        {/* Sezione Gestione Rimborsi */}
        {draft.kind === 'expense' && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              background: draft.needsReimbursement ? 'rgba(245, 158, 11, 0.08)' : 'var(--overlay-subtle)',
              border: draft.needsReimbursement ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--border)',
              transition: 'all 0.2s ease',
              marginBottom: '14px',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={draft.needsReimbursement}
                onChange={(e) => onChange('needsReimbursement', e.target.checked)}
                style={{ accentColor: '#f59e0b', width: '18px', height: '18px', cursor: 'pointer', marginTop: '2px' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 650, fontSize: '0.84rem', color: draft.needsReimbursement ? '#f59e0b' : 'var(--text)' }}>
                    ⏳ Questa spesa deve essere rimborsata
                  </span>
                  {draft.needsReimbursement && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '1px 7px',
                        borderRadius: '6px',
                        background: 'rgba(245, 158, 11, 0.2)',
                        color: '#f59e0b',
                        fontWeight: 650,
                      }}
                    >
                      In attesa di rimborso
                    </span>
                  )}
                </div>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.73rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                  Spunta questa casella se stai anticipando denaro (es. conto pagato per amici, viaggi, spese lavorative o di salute) e prevedi di ricevere un rimborso.
                </p>
                {draft.needsReimbursement && (
                  <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600 }}>Scadenza concordata (opzionale):</span>
                    <input
                      type="date"
                      value={draft.reimbursementDueDate || ''}
                      onChange={(e) => onChange('reimbursementDueDate', e.target.value)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--input-bg)',
                        color: 'var(--text)',
                        fontSize: '0.76rem',
                      }}
                    />
                  </div>
                )}
              </div>
            </label>
          </div>
        )}

        {draft.kind === 'income' && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              background: draft.isReimbursement ? 'rgba(16, 185, 129, 0.08)' : 'var(--overlay-subtle)',
              border: draft.isReimbursement ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border)',
              transition: 'all 0.2s ease',
              marginBottom: '14px',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={draft.isReimbursement}
                onChange={(e) => {
                  const checked = e.target.checked;
                  onChange('isReimbursement', checked);
                  if (!checked) {
                    onChange('reimbursesTransactionId', '');
                  } else if (!draft.reimbursesTransactionId && candidateExpenses.length > 0) {
                    const firstTarget = candidateExpenses.find((t) => t.needsReimbursement) || candidateExpenses[0];
                    if (firstTarget) {
                      onChange('reimbursesTransactionId', firstTarget.id);
                      const alreadyReimbursed = allTransactions
                        .filter((t) => t.kind === 'income' && t.reimbursesTransactionId === firstTarget.id && (!editingTransaction || t.id !== editingTransaction.id))
                        .reduce((s, t) => s + Math.abs(t.amount), 0);
                      const rem = Math.max(0, Math.abs(firstTarget.amount) - alreadyReimbursed);
                      if (!draft.amount || Number(draft.amount) === 0) {
                        onChange('amount', rem > 0 ? rem.toFixed(2) : Math.abs(firstTarget.amount).toFixed(2));
                      }
                      if (!draft.merchant || draft.merchant === 'Rimborso' || draft.merchant.startsWith('Rimborso da ')) {
                        onChange('merchant', `Rimborso da ${firstTarget.merchant}`);
                      }
                    }
                  }
                }}
                style={{ accentColor: '#10b981', width: '18px', height: '18px', cursor: 'pointer', marginTop: '2px' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 650, fontSize: '0.84rem', color: draft.isReimbursement ? '#10b981' : 'var(--text)' }}>
                    🔄 Questa entrata è un rimborso di una spesa precedente
                  </span>
                  {draft.isReimbursement && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '1px 7px',
                        borderRadius: '6px',
                        background: 'rgba(16, 185, 129, 0.2)',
                        color: '#10b981',
                        fontWeight: 650,
                      }}
                    >
                      Rimborso collegato
                    </span>
                  )}
                </div>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.73rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                  Collega questo accredito a una spesa sostenuta in precedenza per saldare o coprire il rimborso dovuto.
                </p>
              </div>
            </label>

            {draft.isReimbursement && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Seleziona la spesa da rimborsare:
                </label>
                {candidateExpenses.length === 0 ? (
                  <div style={{ fontSize: '0.76rem', color: 'var(--muted)', fontStyle: 'italic', padding: '4px 0' }}>
                    Nessuna spesa trovata nel registro da collegare.
                  </div>
                ) : (
                  <>
                    <select
                      value={draft.reimbursesTransactionId}
                      onChange={(e) => {
                        const selectedId = e.target.value;
                        onChange('reimbursesTransactionId', selectedId);
                        const targetTx = candidateExpenses.find((t) => t.id === selectedId);
                        if (targetTx) {
                          const alreadyReimbursed = allTransactions
                            .filter((t) => t.kind === 'income' && t.reimbursesTransactionId === targetTx.id && (!editingTransaction || t.id !== editingTransaction.id))
                            .reduce((s, t) => s + Math.abs(t.amount), 0);
                          const rem = Math.max(0, Math.abs(targetTx.amount) - alreadyReimbursed);
                          if (!draft.amount || Number(draft.amount) === 0 || draft.amount === '0,00') {
                            onChange('amount', rem > 0 ? rem.toFixed(2) : Math.abs(targetTx.amount).toFixed(2));
                          }
                          if (!draft.merchant || draft.merchant === 'Rimborso' || draft.merchant.startsWith('Rimborso da ')) {
                            onChange('merchant', `Rimborso da ${targetTx.merchant}`);
                          }
                        }
                      }}
                      required={draft.isReimbursement}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'var(--input-bg)',
                        color: 'var(--text)',
                        fontSize: '0.82rem',
                        fontWeight: 500,
                        width: '100%',
                      }}
                    >
                      <option value="" disabled>-- Scegli la spesa precedente --</option>
                      {candidateExpenses.filter((t) => t.needsReimbursement).length > 0 && (
                        <optgroup label="⏳ Spese contrassegnate 'Da rimborsare'">
                          {candidateExpenses.filter((t) => t.needsReimbursement).map((tx) => {
                            const alreadyReimbursed = allTransactions
                              .filter((t) => t.kind === 'income' && t.reimbursesTransactionId === tx.id && (!editingTransaction || t.id !== editingTransaction.id))
                              .reduce((s, t) => s + Math.abs(t.amount), 0);
                            const rem = Math.max(0, Math.abs(tx.amount) - alreadyReimbursed);
                            const isDone = rem <= 0.009;
                            return (
                              <option key={tx.id} value={tx.id}>
                                {formatDisplayDate(tx.date)} - {tx.merchant} ({formatEuro(Math.abs(tx.amount))}) - {isDone ? 'Già saldata' : `Restano da rimborsare: ${formatEuro(rem)}`}
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                      {candidateExpenses.filter((t) => !t.needsReimbursement).length > 0 && (
                        <optgroup label="Altre uscite registrate nel budget">
                          {candidateExpenses.filter((t) => !t.needsReimbursement).map((tx) => (
                            <option key={tx.id} value={tx.id}>
                              {formatDisplayDate(tx.date)} - {tx.merchant} ({formatEuro(Math.abs(tx.amount))})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    {/* Dettaglio Spesa Selezionata */}
                    {(() => {
                      const selectedExpense = candidateExpenses.find((t) => t.id === draft.reimbursesTransactionId);
                      if (!selectedExpense) return null;
                      const alreadyReimbursed = allTransactions
                        .filter((t) => t.kind === 'income' && t.reimbursesTransactionId === selectedExpense.id && (!editingTransaction || t.id !== editingTransaction.id))
                        .reduce((s, t) => s + Math.abs(t.amount), 0);
                      const remaining = Math.max(0, Math.abs(selectedExpense.amount) - alreadyReimbursed);
                      return (
                        <div
                          style={{
                            padding: '9px 12px',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(56, 189, 248, 0.08)',
                            border: '1px solid rgba(56, 189, 248, 0.25)',
                            fontSize: '0.76rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '8px',
                          }}
                        >
                          <div>
                            <span style={{ color: 'var(--muted)' }}>Spesa collegata: </span>
                            <strong style={{ color: 'var(--text)' }}>{selectedExpense.merchant}</strong> ({formatDisplayDate(selectedExpense.date)})
                            <div style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: '2px' }}>
                              {selectedExpense.category}{selectedExpense.subcategory ? ` · ${selectedExpense.subcategory}` : ''} ({selectedExpense.account})
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Importo spesa: <strong>{formatEuro(Math.abs(selectedExpense.amount))}</strong></div>
                            <div style={{ fontSize: '0.76rem', color: remaining > 0 ? '#f59e0b' : '#10b981', fontWeight: 650 }}>
                              {remaining > 0 ? `Restano da coprire: ${formatEuro(remaining)}` : 'Interamente rimborsata'}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <label className="form-field form-field-wide">
          <span>Nota</span>
          <textarea
            rows={3}
            value={draft.note}
            onChange={(event) => onChange('note', event.target.value)}
            placeholder="Dettaglio opzionale della transazione"
          />
        </label>

        <div className="form-actions">
          <button className="pill pill-primary" type="submit">
            {mode === 'edit' ? 'Salva modifiche' : 'Aggiungi transazione'}
          </button>
          <button
            className="pill"
            type="button"
            onClick={() => {
              setIsCustomAccount(false);
              setNewAccountName('');
              onReset();
            }}
          >
            Svuota modulo
          </button>
          {mode === 'edit' ? (
            <button className="danger-button" type="button" onClick={onDelete}>
              Elimina transazione
            </button>
          ) : null}
        </div>

        {editingTransaction ? (
          <p className="import-hint">Stai modificando {editingTransaction.merchant} del {formatLongDate(editingTransaction.date)}.</p>
        ) : null}
      </form>

      <datalist id="category-options">
        {categoryOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="subcategory-options">
        {subcategoryOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </article>
  );
}

function BudgetCategoryEditor({
  mode,
  draft,
  editingCategory,
  onChange,
  onSubcategoryChange,
  onAddSubcategory,
  onRemoveSubcategory,
  onSubmit,
  onReset,
  onDelete,
  totalMonthIncome,
}: {
  mode: 'create' | 'edit';
  draft: BudgetCategoryDraft;
  editingCategory: BudgetCategory | null;
  onChange: (field: keyof Omit<BudgetCategoryDraft, 'subcategories'>, value: any) => void;
  onSubcategoryChange: (subcategoryId: string, field: keyof Omit<BudgetSubcategoryDraft, 'id'>, value: any) => void;
  onAddSubcategory: () => void;
  onRemoveSubcategory: (subcategoryId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onDelete: () => void;
  totalMonthIncome: number;
}) {
  const limitType = draft.limitType || 'fixed';

  return (
    <div className="budget-editor">
      <div className="panel-header">
        <div>
          <p className="panel-title">{mode === 'edit' ? 'Modifica categoria' : 'Nuova categoria'}</p>
          <h4>{mode === 'edit' ? 'Aggiorna il budget e le sottocategorie' : 'Crea una categoria con budget dedicato'}</h4>
        </div>
      </div>

      <form className="transaction-form" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="form-field">
            <span>Nome categoria</span>
            <input value={draft.name} onChange={(event) => onChange('name', event.target.value)} placeholder="Nome categoria" required />
          </label>
          <label className="form-field">
            <span>Tipo di limite</span>
            <select
              value={limitType}
              onChange={(event) => onChange('limitType', event.target.value)}
            >
              <option value="fixed">Importo fisso (€)</option>
              <option value="percentage">Percentuale entrate (%)</option>
            </select>
          </label>
          {limitType === 'percentage' ? (
            <label className="form-field">
              <span>Quota percentuale (%)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0.1"
                max="100"
                value={draft.limitPercent}
                onChange={(event) => onChange('limitPercent', event.target.value)}
                placeholder="%"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
                Equivale a <strong>{formatEuro((totalMonthIncome * (Number(draft.limitPercent) || 0)) / 100)}</strong> (su {formatEuro(totalMonthIncome)} entrate)
              </span>
            </label>
          ) : (
            <label className="form-field">
              <span>Budget (€)</span>
              <input type="number" inputMode="decimal" step="0.01" value={draft.limit} onChange={(event) => onChange('limit', event.target.value)} placeholder="0,00" />
            </label>
          )}
          <label className="form-field">
            <span>Colore</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
              <input
                type="color"
                value={draft.color}
                onChange={(event) => onChange('color', event.target.value)}
                style={{
                  width: '36px',
                  height: '36px',
                  padding: '2px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: 'var(--input-bg)',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text)', textTransform: 'uppercase' }}>
                {draft.color}
              </span>
            </div>
          </label>
          <label className="form-field" style={{ gridColumn: 'span 2' }}>
            <span>Nota</span>
            <input value={draft.note} onChange={(event) => onChange('note', event.target.value)} placeholder="Annotazione facoltativa" />
          </label>
        </div>

        <div className="subcategory-editor">
          <div className="subcategory-editor-header">
            <div>
              <p className="panel-title">Sottocategorie</p>
              <h4>Dettaglio per voci più specifiche</h4>
            </div>
            <button className="ghost-button" type="button" onClick={onAddSubcategory}>
              Aggiungi sottocategoria
            </button>
          </div>

          <div className="subcategory-list">
            {draft.subcategories.length ? (
              draft.subcategories.map((subcategory) => {
                const subLimitType = subcategory.limitType || 'fixed';
                return (
                  <div
                    className="subcategory-row"
                    key={subcategory.id}
                    style={{
                      gridTemplateColumns: 'minmax(0, 1.2fr) minmax(130px, 0.8fr) minmax(110px, 0.8fr) minmax(0, 1.2fr) auto',
                      borderLeft: `4px solid ${draft.color || 'var(--primary)'}`,
                    }}
                  >
                    <label className="form-field">
                      <span>Nome</span>
                      <input
                        value={subcategory.name}
                        onChange={(event) => onSubcategoryChange(subcategory.id, 'name', event.target.value)}
                        placeholder="Nome sottocategoria"
                        required
                      />
                    </label>
                    <label className="form-field">
                      <span>Tipo limite</span>
                      <select
                        value={subLimitType}
                        onChange={(event) => onSubcategoryChange(subcategory.id, 'limitType', event.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.6rem',
                          borderRadius: 'var(--radius)',
                          border: '1px solid var(--border)',
                          background: 'var(--panel-bg)',
                          color: 'var(--text)',
                        }}
                      >
                        <option value="fixed">Fisso (€)</option>
                        <option value="percentage">% Entrate</option>
                      </select>
                    </label>
                    {subLimitType === 'percentage' ? (
                      <label className="form-field">
                        <span>Quota (%)</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0.1"
                          max="100"
                          value={subcategory.limitPercent}
                          onChange={(event) => onSubcategoryChange(subcategory.id, 'limitPercent', event.target.value)}
                          placeholder="%"
                        />
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'block' }}>
                          ~{formatEuro((totalMonthIncome * (Number(subcategory.limitPercent) || 0)) / 100)}
                        </span>
                      </label>
                    ) : (
                      <label className="form-field">
                        <span>Budget (€)</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={subcategory.limit}
                          onChange={(event) => onSubcategoryChange(subcategory.id, 'limit', event.target.value)}
                          placeholder="0,00"
                        />
                      </label>
                    )}
                    <label className="form-field form-field-wide">
                      <span>Nota</span>
                      <input
                        value={subcategory.note}
                        onChange={(event) => onSubcategoryChange(subcategory.id, 'note', event.target.value)}
                        placeholder="Nota facoltativa"
                      />
                    </label>
                    <button className="danger-button" type="button" onClick={() => onRemoveSubcategory(subcategory.id)}>
                      Rimuovi
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="empty-state">
                <strong>Nessuna sottocategoria ancora inserita.</strong>
                <p>Usa il pulsante sopra per aggiungere voci dedicate a questa categoria.</p>
              </div>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button className="pill pill-primary" type="submit">
            {mode === 'edit' ? 'Salva categoria' : 'Aggiungi categoria'}
          </button>
          <button className="pill" type="button" onClick={onReset}>
            Svuota modulo
          </button>
          {mode === 'edit' ? (
            <button className="danger-button" type="button" onClick={onDelete}>
              Elimina categoria
            </button>
          ) : null}
        </div>

        {editingCategory ? (
          <p className="import-hint">Stai modificando {editingCategory.name} con budget {formatEuro(editingCategory.limitType === 'percentage' ? (totalMonthIncome * (editingCategory.limitPercent || 0)) / 100 : editingCategory.limit)}.</p>
        ) : null}
      </form>
    </div>
  );
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('app-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  });

  const [accentColor, setAccentColor] = useState<string>(() => {
    const saved = localStorage.getItem('budget-ledger-accent-color-v1');
    return saved || '';
  });

  const [bgEffect, setBgEffect] = useState<'none' | 'stars' | 'grid' | 'waves' | 'dots'>(() => {
    const saved = localStorage.getItem('budget-ledger-bg-effect-v1');
    return (saved as any) || 'none';
  });

  useEffect(() => {
    localStorage.setItem('app-theme', theme);
    if (theme === 'light') {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
  }, [theme]);

  useEffect(() => {
    if (accentColor) {
      localStorage.setItem('budget-ledger-accent-color-v1', accentColor);
      document.documentElement.style.setProperty('--accent', accentColor);
      const strongColor = adjustColorBrightness(accentColor, theme === 'light' ? 25 : -25);
      document.documentElement.style.setProperty('--accent-strong', strongColor);
    } else {
      localStorage.removeItem('budget-ledger-accent-color-v1');
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--accent-strong');
    }
  }, [accentColor, theme]);

  useEffect(() => {
    localStorage.setItem('budget-ledger-bg-effect-v1', bgEffect);
  }, [bgEffect]);

  const [platform, setPlatform] = useState('macOS');
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');
  const [statusMessage, setStatusMessage] = useState('Pronto. Seleziona una sezione o crea una nuova operazione.');
  const [customLogo, setCustomLogo] = useState<string | null>(() => {
    try {
      return localStorage.getItem('budget_custom_brand_logo');
    } catch {
      return null;
    }
  });
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatusMessage('Errore: seleziona un file immagine valido (PNG, JPG, SVG, WebP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setCustomLogo(dataUrl);
        try {
          localStorage.setItem('budget_custom_brand_logo', dataUrl);
          setStatusMessage('Logo personalizzato caricato e salvato con successo!');
        } catch {
          setStatusMessage('Logo applicato per la sessione corrente.');
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [budgetSortCriteria, setBudgetSortCriteria] = useState<'name' | 'spent' | 'limit' | 'remaining'>('name');
  const [budgetSortOrder, setBudgetSortOrder] = useState<'asc' | 'desc'>('asc');
  const [transactions, setTransactions] = useState<Transaction[]>(() => loadStoredTransactions());
  const [budgetCategoriesRaw, setBudgetCategoriesRaw] = useState<BudgetCategory[]>(() => loadStoredBudgetCategories());
  const setBudgetCategories = useCallback((value: BudgetCategory[] | ((prev: BudgetCategory[]) => BudgetCategory[])) => {
    setBudgetCategoriesRaw((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      return mergeDuplicateCategories(next);
    });
  }, []);
  const budgetCategories = budgetCategoriesRaw;
  const [assets, setAssets] = useState<Asset[]>(() => loadStoredAssets());
  const [tickerData, setTickerData] = useState<Record<string, {
    price: number;
    previousClose: number;
    currency: string;
    symbol: string;
    longName: string;
    history: { date: string; price: number }[];
  }>>({});
  const [isFetchingTickers, setIsFetchingTickers] = useState(false);
  const [tickerError, setTickerError] = useState<string | null>(null);

  // GitHub Auto-Update State
  const [githubRepo, setGithubRepo] = useState<string>(() => {
    try {
      return localStorage.getItem('budget_github_repo') || 'Ale410-cpu/App-Budgeting-2';
    } catch {
      return 'Ale410-cpu/App-Budgeting-2';
    }
  });
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('budget_auto_check_updates');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem('budget_dismissed_update_version');
    } catch {
      return null;
    }
  });
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<'prompt' | 'downloading' | 'installing' | 'completed' | 'error'>('prompt');
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress>({ percent: 0, transferred: 0, total: 0 });
  const [updateErrorMessage, setUpdateErrorMessage] = useState<string | null>(null);
  const [updateSuccessMessage, setUpdateSuccessMessage] = useState<string | null>(null);
  const [isCheckingUpdateManual, setIsCheckingUpdateManual] = useState<boolean>(false);
  const [manualCheckFeedback, setManualCheckFeedback] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('budget_github_repo', githubRepo);
    } catch {}
  }, [githubRepo]);

  useEffect(() => {
    try {
      localStorage.setItem('budget_auto_check_updates', String(autoCheckUpdates));
    } catch {}
  }, [autoCheckUpdates]);

  const performCheckForUpdates = useCallback(async (isManual: boolean = false, repoToUse?: string) => {
    const repo = (repoToUse || githubRepo || 'Ale410-cpu/App-Budgeting-2').trim();
    if (isManual) {
      setIsCheckingUpdateManual(true);
      setManualCheckFeedback(null);
    }

    try {
      let result: UpdateCheckResult;
      if (window.budgetApp && typeof window.budgetApp.checkForUpdates === 'function') {
        result = await window.budgetApp.checkForUpdates(repo);
      } else {
        const response = await fetch(`/api/check-update?repo=${encodeURIComponent(repo)}`);
        if (!response.ok) {
          throw new Error(`Server ha risposto con codice ${response.status}`);
        }
        result = await response.json();
      }

      setUpdateInfo(result);

      if (result.updateAvailable) {
        const latestVer = (result.latestVersion || result.tagName || '').replace(/^v/i, '');
        const isSnoozed = dismissedVersion && dismissedVersion.replace(/^v/i, '') === latestVer;

        if (isManual || !isSnoozed) {
          setUpdateStatus('prompt');
          setUpdateErrorMessage(null);
          setUpdateSuccessMessage(null);
          setShowUpdateModal(true);
        }
        if (isManual) {
          setManualCheckFeedback(`Nuovo aggiornamento trovato: v${latestVer}!`);
        }
      } else {
        if (isManual) {
          setManualCheckFeedback(
            result.message || result.error || `Stai già usando l'ultima versione disponibile (${result.currentVersion ? 'v' + result.currentVersion.replace(/^v/i, '') : 'v' + APP_VERSION}).`
          );
        }
      }
    } catch (err: any) {
      console.error('Verifica aggiornamenti fallita:', err);
      if (isManual) {
        setManualCheckFeedback(`Impossibile verificare gli aggiornamenti: ${err?.message || 'errore di rete'}`);
      }
    } finally {
      if (isManual) {
        setIsCheckingUpdateManual(false);
      }
    }
  }, [githubRepo, dismissedVersion]);

  // Controllo automatico aggiornamenti su GitHub ad ogni apertura dell'app
  useEffect(() => {
    if (autoCheckUpdates) {
      const timer = setTimeout(() => {
        performCheckForUpdates(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [autoCheckUpdates, performCheckForUpdates]);

  // Listener per l'avanzamento del download in Electron
  useEffect(() => {
    if (window.budgetApp && typeof window.budgetApp.onUpdateProgress === 'function') {
      const unsubscribe = window.budgetApp.onUpdateProgress((prog: UpdateProgress) => {
        setUpdateProgress(prog);
      });
      return () => {
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    }
  }, []);

  const handleConfirmInstallUpdate = async () => {
    if (!updateInfo) return;
    setUpdateStatus('downloading');
    setUpdateProgress({ percent: 0, transferred: 0, total: updateInfo.asset?.size || 0 });
    setUpdateErrorMessage(null);
    setUpdateSuccessMessage(null);

    try {
      if (window.budgetApp && typeof window.budgetApp.downloadAndInstallUpdate === 'function' && updateInfo.asset?.downloadUrl) {
        const res = await window.budgetApp.downloadAndInstallUpdate({
          downloadUrl: updateInfo.asset.downloadUrl,
          assetName: updateInfo.asset.name,
        });

        if (res.success) {
          setUpdateStatus('completed');
          setUpdateSuccessMessage(res.message || 'Aggiornamento scaricato e preparato con successo.');
          setStatusMessage('Aggiornamento scaricato con successo.');
        } else {
          setUpdateStatus('error');
          setUpdateErrorMessage(res.error || 'Errore durante l\'aggiornamento.');
        }
      } else {
        if (updateInfo.asset?.downloadUrl) {
          window.open(updateInfo.asset.downloadUrl, '_blank');
        } else if (updateInfo.htmlUrl) {
          window.open(updateInfo.htmlUrl, '_blank');
        }
        setUpdateStatus('completed');
        setUpdateSuccessMessage('Download avviato nel browser.');
      }
    } catch (err: any) {
      setUpdateStatus('error');
      setUpdateErrorMessage(err?.message || 'Errore imprevisto durante l\'installazione.');
    }
  };

  const handleRemindLater = () => {
    setShowUpdateModal(false);
  };

  const handleSkipVersion = () => {
    const ver = (updateInfo?.latestVersion || updateInfo?.tagName || '').replace(/^v/i, '');
    if (ver) {
      setDismissedVersion(ver);
      try {
        localStorage.setItem('budget_dismissed_update_version', ver);
      } catch {}
    }
    setShowUpdateModal(false);
    setStatusMessage(`Aggiornamento alla versione v${ver} posticipato.`);
  };

  const handleOpenReleaseUrl = () => {
    const url = updateInfo?.htmlUrl || `https://github.com/${githubRepo}/releases`;
    if (window.budgetApp && typeof window.budgetApp.openExternal === 'function') {
      window.budgetApp.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const tickerDataRef = useRef(tickerData);
  tickerDataRef.current = tickerData;

  const getHistoricalTickerPrice = useCallback((ticker: string, date: string, fallbackPrice: number): number => {
    const data = tickerDataRef.current[ticker.toUpperCase()];
    if (!data || !data.history || data.history.length === 0) {
      return fallbackPrice;
    }
    
    const sortedHistory = [...data.history].sort((a, b) => a.date.localeCompare(b.date));
    
    let lastPrice = sortedHistory[0].price;
    for (const item of sortedHistory) {
      if (item.date <= date) {
        lastPrice = item.price;
      } else {
        break;
      }
    }
    return lastPrice;
  }, []);

  const fetchAllTickers = useCallback(async (force = false) => {
    const currentAssets = assetsRef.current;
    const assetsWithTickers = currentAssets.filter((asset) => asset.ticker && asset.ticker.trim());
    if (assetsWithTickers.length === 0) return;

    setIsFetchingTickers(true);
    setTickerError(null);
    let updatedCount = 0;
    
    const nextTickerData = { ...tickerDataRef.current };
    const updatedAssetsMap = new Map<string, number>();

    for (const asset of assetsWithTickers) {
      const tickerClean = asset.ticker!.trim().toUpperCase();
      if (force || !nextTickerData[tickerClean]) {
        try {
          let data = null;
          if (window.budgetApp && typeof window.budgetApp.getTickerPrice === 'function') {
            data = await window.budgetApp.getTickerPrice(tickerClean);
          } else {
            const response = await fetch(`/api/ticker-price?ticker=${encodeURIComponent(tickerClean)}`);
            if (response.ok) {
              data = await response.json();
            } else {
              const errData = await response.json().catch(() => ({}));
              const errMsg = errData.error || `Status ${response.status}`;
              console.warn(`Could not fetch price for ${tickerClean}: ${errMsg}`);
            }
          }

          if (data) {
            nextTickerData[tickerClean] = data;
            
            if (data.price && data.price !== asset.unitValue) {
              updatedAssetsMap.set(asset.id, data.price);
              updatedCount++;
            }
          }
        } catch (err) {
          console.error(`Error fetching ticker ${tickerClean}:`, err);
        }
      }
    }

    if (updatedAssetsMap.size > 0) {
      setAssets((currentAssets) =>
        currentAssets.map((a) => {
          const newPrice = updatedAssetsMap.get(a.id);
          return newPrice !== undefined ? { ...a, unitValue: newPrice } : a;
        })
      );
    }

    setTickerData(nextTickerData);
    setIsFetchingTickers(false);
    if (updatedCount > 0) {
      setStatusMessage(`Aggiornati in tempo reale i prezzi di ${updatedCount} asset con ticker.`);
    }
  }, []);
  const [draft, setDraft] = useState<TransactionDraft>(defaultDraft());
  const [bulkDraft, setBulkDraft] = useState<TransactionBulkDraft>({
    date: '',
    category: '',
    subcategory: '',
    account: '',
    kind: '',
    note: '',
  });
  const [budgetDraft, setBudgetDraft] = useState<BudgetCategoryDraft>(defaultBudgetDraft());
  const [assetDraft, setAssetDraft] = useState<AssetDraft>(defaultAssetDraft());
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [transactionOrder, setTransactionOrder] = useState<string[]>(() => loadStoredTransactionOrder());
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [activeDatePreset, setActiveDatePreset] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubcategory, setFilterSubcategory] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterKind, setFilterKind] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [filterAmountPreset, setFilterAmountPreset] = useState<string>('all');
  const [filterReimbursement, setFilterReimbursement] = useState<'' | 'pending' | 'reimbursed' | 'all_reimbursable' | 'refund_income'>('');
  const [sortBy, setSortBy] = useState<string>('date');

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [reportRange, setReportRange] = useState(() => ({
    start: getMonthStartIso(),
    end: getTodayIso(),
  }));
  const [assetRange, setAssetRange] = useState(() => ({
    start: getMonthStartIso(),
    end: getTodayIso(),
  }));
  const [confirmDeleteAssetId, setConfirmDeleteAssetId] = useState<string | null>(null);
  const [showNetWorthExplanation, setShowNetWorthExplanation] = useState<boolean>(false);

  // Global Confirmation Modal State for all deletions across the app
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    message: string;
    itemDetails?: { label: string; value: string }[];
    confirmLabel?: string;
    confirmVariant?: 'danger' | 'warning' | 'primary';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const askConfirmation = useCallback((options: {
    title: string;
    subtitle?: string;
    message: string;
    itemDetails?: { label: string; value: string }[];
    confirmLabel?: string;
    confirmVariant?: 'danger' | 'warning' | 'primary';
    onConfirm: () => void;
    onCancel?: () => void;
  }) => {
    setConfirmModal({
      isOpen: true,
      title: options.title,
      subtitle: options.subtitle,
      message: options.message,
      itemDetails: options.itemDetails,
      confirmLabel: options.confirmLabel || 'Elimina definitivamente',
      confirmVariant: options.confirmVariant || 'danger',
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        options.onConfirm();
      },
      onCancel: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        if (options.onCancel) options.onCancel();
      },
    });
  }, []);

  useEffect(() => {
    if (!confirmModal.isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmModal.onCancel) confirmModal.onCancel();
        else setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmModal]);
  const [assetFilterCategory, setAssetFilterCategory] = useState('');
  const [assetFilterInstitution, setAssetFilterInstitution] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [assetSortBy, setAssetSortBy] = useState<string>('value');
  const [assetSortOrder, setAssetSortOrder] = useState<'asc' | 'desc'>('desc');
  const [hoveredSlice, setHoveredSlice] = useState<{ name: string; spent: number; percent: number; color: string; isSub: boolean } | null>(null);
  const [hideNumbers, setHideNumbers] = useState<boolean>(() => loadStoredValue<boolean>(HIDE_NUMBERS_STORAGE_KEY, false));

  // Update global privacy flag for instantaneous formatting during render
  setGlobalHideNumbers(hideNumbers);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // States for dynamic initial capital and asset transactions ledger
  const [storedOpeningCash, setStoredOpeningCash] = useState<number>(() => loadStoredValue<number>(OPENING_CASH_STORAGE_KEY, 0));
  const [accountInitialCapitals, setAccountInitialCapitals] = useState<Record<string, number>>(() => loadStoredValue<Record<string, number>>(ACCOUNT_INITIAL_CAPITALS_STORAGE_KEY, {}));

  const openingCash = useMemo(() => {
    const keys = Object.keys(accountInitialCapitals);
    if (keys.length > 0) {
      return keys.reduce((sum, key) => sum + (accountInitialCapitals[key] || 0), 0);
    }
    return storedOpeningCash;
  }, [accountInitialCapitals, storedOpeningCash]);

  const [openingNetWorth, setOpeningNetWorth] = useState<number>(() => loadStoredValue<number>(OPENING_NET_WORTH_STORAGE_KEY, 0));
  const [openingDate, setOpeningDate] = useState<string>(() => loadStoredValue<string>(OPENING_DATE_STORAGE_KEY, '2026-01-01'));
  const [assetTransactions, setAssetTransactions] = useState<AssetTransaction[]>(() => loadStoredValue<AssetTransaction[]>(ASSET_TX_STORAGE_KEY, initialAssetTransactions));
  const [selectedAssetIdForDetails, setSelectedAssetIdForDetails] = useState<string | null>(null);
  const [editingAssetTxId, setEditingAssetTxId] = useState<string | null>(null);
  const [hoveredAllocationSlice, setHoveredAllocationSlice] = useState<{ name: string; value: number; percentage: number; color: string } | null>(null);
  const [assetTxDraft, setAssetTxDraft] = useState<AssetTransactionDraft>({
    date: getTodayIso(),
    kind: 'buy',
    quantity: '',
    unitValue: '',
    note: '',
  });
  const [assetChartMode, setAssetChartMode] = useState<'capital' | 'price' | 'return'>('capital');
  const [portfolioChartMode, setPortfolioChartMode] = useState<'total' | 'no-transactions'>('total');
  const [reportViewMode, setReportViewMode] = useState<'charts' | 'sankey'>('charts');
  const [netWorthViewMode, setNetWorthViewMode] = useState<'history' | 'allocation' | 'fire'>('history');
  const [unifiedReportTab, setUnifiedReportTab] = useState<'patrimonio' | 'flussi' | 'trend' | 'sankey' | 'allocation' | 'fire'>('patrimonio');
  const [recurringViewMode, setRecurringViewMode] = useState<'scadenziario' | 'recurring' | 'pac' | 'cashback'>('scadenziario');
  const [scadenziarioHorizon, setScadenziarioHorizon] = useState<'month' | '30d' | '60d' | '90d'>('month');
  const [scadenziarioTypeFilter, setScadenziarioTypeFilter] = useState<'all' | 'expense' | 'income' | 'pac'>('all');
  const [scadenziarioAccountFilter, setScadenziarioAccountFilter] = useState<string>('all');
  const [scadenziarioSearch, setScadenziarioSearch] = useState<string>('');
  const [showReimbursementSchedule, setShowReimbursementSchedule] = useState<boolean>(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(() =>
    loadStoredValue<Subscription[]>(SUBSCRIPTION_STORAGE_KEY, defaultSubscriptions)
  );
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>(() =>
    loadStoredValue<RecurringTransaction[]>(RECURRING_TX_STORAGE_KEY, [])
  );
  const [pianiAccumulo, setPianiAccumulo] = useState<PAC[]>(() =>
    loadStoredValue<PAC[]>(PAC_STORAGE_KEY, [])
  );
  const [cashbackRules, setCashbackRules] = useState<CashbackRule[]>(() =>
    loadStoredValue<CashbackRule[]>(CASHBACK_RULES_STORAGE_KEY, defaultCashbackRules)
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(CASHBACK_RULES_STORAGE_KEY, JSON.stringify(cashbackRules));
    } catch {}
  }, [cashbackRules]);
  const [recurringDraft, setRecurringDraft] = useState({
    merchant: '',
    amount: '',
    kind: 'expense' as TransactionKind,
    category: '',
    subcategory: '',
    account: '',
    frequency: 'monthly' as RecurringFrequency,
    dayOfMonth: '1',
    dayOfWeek: '1',
    intervalDays: '15',
    startDate: getTodayIso(),
    note: '',
    autoPost: false,
  });
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [pacDraft, setPacDraft] = useState({
    name: '',
    assetId: '',
    amount: '',
    dayOfMonth: '1',
    startDate: getTodayIso(),
    account: '',
    category: 'Investimenti',
    subcategory: 'PAC',
    autoPost: true,
    createAssetTransaction: true,
  });
  const [editingPacId, setEditingPacId] = useState<string | null>(null);
  const [selectedAssetIdsForChart, setSelectedAssetIdsForChart] = useState<string[]>([]);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [hoveredSpecificPointIndex, setHoveredSpecificPointIndex] = useState<number | null>(null);
  const [isStorageInitialized, setIsStorageInitialized] = useState(false);
  const autoPostCheckedRef = useRef(false);

  const ensureCategoriesAndSubcategories = useCallback((items: { category: string; subcategory?: string }[]) => {
    setBudgetCategories((currentCategories) => {
      // Helper function to find the exact case of an existing category
      const existingCatNameOf = (categories: BudgetCategory[], name: string): string => {
        const found = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
        return found ? found.name : name;
      };

      // 1. Create a fast lookup structure of existing categories and their subcategories
      const catMap = new Map<string, Set<string>>();
      for (const cat of currentCategories) {
        const catNameLower = cat.name.toLowerCase().trim();
        let subSet = catMap.get(catNameLower);
        if (!subSet) {
          subSet = new Set<string>();
          catMap.set(catNameLower, subSet);
        }
        for (const sub of cat.subcategories) {
          subSet.add(sub.name.toLowerCase().trim());
        }
      }

      // 2. Identify what actually needs to be added
      const newCatsToAdd = new Map<string, Set<string>>(); // categoryExactName -> Set of subcategoryNames

      for (const item of items) {
        const catName = item.category?.trim();
        if (!catName) continue;
        const catNameLower = catName.toLowerCase();
        const subName = item.subcategory?.trim() || '';
        const subNameLower = subName.toLowerCase();

        const hasCat = catMap.has(catNameLower);
        if (!hasCat) {
          // Category itself is missing
          let pendingSubs = newCatsToAdd.get(catName);
          if (!pendingSubs) {
            pendingSubs = new Set<string>();
            newCatsToAdd.set(catName, pendingSubs);
          }
          if (subName) {
            pendingSubs.add(subName);
          }
        } else {
          // Category exists, check subcategory
          if (subName) {
            const hasSub = catMap.get(catNameLower)!.has(subNameLower);
            if (!hasSub) {
              // Subcategory is missing from existing category
              const exactCatName = existingCatNameOf(currentCategories, catName);
              let pendingSubs = newCatsToAdd.get(exactCatName);
              if (!pendingSubs) {
                pendingSubs = new Set<string>();
                newCatsToAdd.set(exactCatName, pendingSubs);
              }
              pendingSubs.add(subName);
            }
          }
        }
      }

      if (newCatsToAdd.size === 0) {
        return currentCategories;
      }

      // 3. Construct the updated categories array
      const nextCategories = currentCategories.map((cat) => {
        const pendingSubs = newCatsToAdd.get(cat.name);
        if (pendingSubs && pendingSubs.size > 0) {
          const updatedSubs = [...cat.subcategories];
          for (const subName of pendingSubs) {
            const exists = updatedSubs.some((s) => s.name.toLowerCase() === subName.toLowerCase());
            if (!exists) {
              updatedSubs.push({
                id: `sub-${Date.now()}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 4)}`,
                name: subName,
                limit: 0,
                note: '',
              });
            }
          }
          newCatsToAdd.delete(cat.name);
          return {
            ...cat,
            subcategories: updatedSubs,
          };
        }
        return cat;
      });

      // Any remaining entries in newCatsToAdd are brand new categories
      for (const [catName, subNames] of newCatsToAdd.entries()) {
        const newCat: BudgetCategory = {
          id: `budget-${Date.now()}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 4)}`,
          name: catName,
          limit: 0,
          color: '#38bdf8',
          note: '',
          subcategories: [],
        };
        for (const subName of subNames) {
          newCat.subcategories.push({
            id: `sub-${Date.now()}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 4)}`,
            name: subName,
            limit: 0,
            note: '',
          });
        }
        nextCategories.push(newCat);
      }

      return nextCategories;
    });
  }, []);

  useEffect(() => {
    if (!isStorageInitialized) return;
    if (transactions.length > 0) {
      ensureCategoriesAndSubcategories(transactions);
    }
  }, [isStorageInitialized, transactions, ensureCategoriesAndSubcategories]);

  useEffect(() => {
    if (isStorageInitialized && assets.length > 0) {
      fetchAllTickers(false);
    }
  }, [isStorageInitialized, assets.length, fetchAllTickers]);

  useEffect(() => {
    window.budgetApp?.ping().then((result) => {
      if (result?.platform) {
        setPlatform(result.platform);
      }
    });
  }, []);

  useEffect(() => {
    const initDiskData = async () => {
      if (window.budgetApp && typeof window.budgetApp.loadData === 'function') {
        try {
          const fileData = await window.budgetApp.loadData();
          if (fileData) {
            if (Array.isArray(fileData.transactions)) setTransactions(fileData.transactions);
            if (Array.isArray(fileData.transactionOrder)) setTransactionOrder(fileData.transactionOrder);
            if (Array.isArray(fileData.budgetCategories)) setBudgetCategories(fileData.budgetCategories);
            if (Array.isArray(fileData.assets)) setAssets(fileData.assets);
            if (typeof fileData.openingCash === 'number') setStoredOpeningCash(fileData.openingCash);
            if (typeof fileData.openingNetWorth === 'number') setOpeningNetWorth(fileData.openingNetWorth);
            if (typeof fileData.openingDate === 'string') setOpeningDate(fileData.openingDate);
            if (Array.isArray(fileData.assetTransactions)) setAssetTransactions(fileData.assetTransactions);
            if (Array.isArray(fileData.recurringTransactions)) setRecurringTransactions(fileData.recurringTransactions);
            if (Array.isArray(fileData.pianiAccumulo)) setPianiAccumulo(fileData.pianiAccumulo);
            if (Array.isArray(fileData.cashbackRules)) setCashbackRules(fileData.cashbackRules);
            if (fileData.accountInitialCapitals && typeof fileData.accountInitialCapitals === 'object') setAccountInitialCapitals(fileData.accountInitialCapitals);
            if (typeof fileData.githubRepo === 'string') setGithubRepo(fileData.githubRepo);
            if (typeof fileData.autoCheckUpdates === 'boolean') setAutoCheckUpdates(fileData.autoCheckUpdates);
            
            setStatusMessage('Dati utente sincronizzati con successo dal disco locale (al sicuro da futuri aggiornamenti dell’app).');
          }
        } catch (err) {
          console.error('Errore durante il caricamento dei dati da disco:', err);
        }
      }
      setIsStorageInitialized(true);
    };
    initDiskData();
  }, []);

  useEffect(() => {
    if (!isStorageInitialized) return;

    if (window.budgetApp && typeof window.budgetApp.saveData === 'function') {
      const dataToSave = {
        transactions,
        transactionOrder,
        budgetCategories,
        assets,
        openingCash,
        openingNetWorth,
        openingDate,
        assetTransactions,
        recurringTransactions,
        pianiAccumulo,
        cashbackRules,
        accountInitialCapitals,
        githubRepo,
        autoCheckUpdates,
      };

      window.budgetApp.saveData(dataToSave).catch((err) => {
        console.error('Errore durante il salvataggio dei dati su disco:', err);
      });
    }
  }, [
    isStorageInitialized,
    transactions,
    transactionOrder,
    budgetCategories,
    assets,
    openingCash,
    openingNetWorth,
    openingDate,
    assetTransactions,
    recurringTransactions,
    pianiAccumulo,
    cashbackRules,
    accountInitialCapitals,
    githubRepo,
    autoCheckUpdates,
  ]);

  // Automatic posting of recurring transactions and PACs on startup and sync
  const executeAutoPostSync = useCallback((customToday?: string): boolean => {
    const todayStr = customToday || getTodayIso();
    const newTransactionsToPost: Transaction[] = [];
    const newAssetTransactionsToPost: AssetTransaction[] = [];
    let recurringUpdated = false;
    let pacUpdated = false;

    // 1. Process Recurring Transactions
    const updatedRecurringTransactions = recurringTransactions.map((tx) => {
      if (!tx.isActive || !tx.autoPost) return tx;

      const dueDates = getDueDatesForRecurring(tx, todayStr);
      if (dueDates.length === 0) return tx;

      dueDates.forEach((dueDate) => {
        const newTx: Transaction = {
          id: createTransactionId(),
          createdAt: Date.now(),
          date: dueDate,
          merchant: `${tx.merchant} (Ricorrente)`,
          category: tx.category,
          subcategory: tx.subcategory,
          account: tx.account,
          amount: tx.amount,
          kind: tx.kind,
          note: tx.note ? `${tx.note} (Inserita automaticamente)` : 'Inserita automaticamente da ricorrenza',
        };
        newTransactionsToPost.push(newTx);
      });

      const latestDueDate = dueDates[dueDates.length - 1];
      recurringUpdated = true;
      return {
        ...tx,
        lastPostedDate: latestDueDate,
      };
    });

    // 2. Process PACs (Piani di Accumulo)
    const updatedPianiAccumulo = pianiAccumulo.map((pac) => {
      if (!pac.isActive || pac.autoPost === false) return pac;

      const dueDates = getDueDatesForPAC(pac, todayStr);
      if (dueDates.length === 0) return pac;

      const targetAsset = assets.find((a) => a.id === pac.assetId);
      const defaultAccount = pac.account || (targetAsset ? targetAsset.institution : '') || 'Conto principale';

      dueDates.forEach((dueDate) => {
        // A) Cash transaction (Expense / Investment)
        const newTx: Transaction = {
          id: createTransactionId(),
          createdAt: Date.now(),
          date: dueDate,
          merchant: `PAC: ${pac.name}`,
          category: pac.category || 'Investimenti',
          subcategory: pac.subcategory || 'PAC',
          account: defaultAccount,
          amount: pac.amount,
          kind: 'expense',
          note: `Versamento automatico PAC (${pac.name}) su ${targetAsset ? targetAsset.name : 'Asset'}`,
        };
        newTransactionsToPost.push(newTx);

        // B) Asset transaction (Buy)
        if (targetAsset && pac.createAssetTransaction !== false) {
          const unitPrice = targetAsset.unitValue > 0 ? targetAsset.unitValue : pac.amount;
          const qty = targetAsset.unitValue > 0 ? +(pac.amount / targetAsset.unitValue).toFixed(6) : 1;
          const newAssetTx: AssetTransaction = {
            id: createTransactionId(),
            assetId: targetAsset.id,
            date: dueDate,
            kind: 'buy',
            quantity: qty,
            unitValue: unitPrice,
            note: `Acquisto automatico PAC: ${pac.name}`,
            createdAt: Date.now(),
          };
          newAssetTransactionsToPost.push(newAssetTx);
        }
      });

      const latestDueDate = dueDates[dueDates.length - 1];
      pacUpdated = true;
      return {
        ...pac,
        lastPostedDate: latestDueDate,
      };
    });

    if (newTransactionsToPost.length > 0 || newAssetTransactionsToPost.length > 0) {
      if (newTransactionsToPost.length > 0) {
        setTransactions((prev) => [...newTransactionsToPost, ...prev]);
      }
      if (newAssetTransactionsToPost.length > 0) {
        setAssetTransactions((prev) => [...prev, ...newAssetTransactionsToPost]);
      }
      if (recurringUpdated) {
        setRecurringTransactions(updatedRecurringTransactions);
      }
      if (pacUpdated) {
        setPianiAccumulo(updatedPianiAccumulo);
      }
      const recCount = newTransactionsToPost.filter((t) => !t.merchant.startsWith('PAC:')).length;
      const pacCount = newTransactionsToPost.filter((t) => t.merchant.startsWith('PAC:')).length;
      const msgParts: string[] = [];
      if (recCount > 0) msgParts.push(`${recCount} transazioni ricorrenti`);
      if (pacCount > 0) msgParts.push(`${pacCount} rate PAC`);
      setStatusMessage(`Sincronizzazione completata: inserite automaticamente ${msgParts.join(' e ')}.`);
      return true;
    }
    return false;
  }, [recurringTransactions, pianiAccumulo, assets]);

  // Automatic posting on startup
  useEffect(() => {
    if (!isStorageInitialized || autoPostCheckedRef.current) return;
    autoPostCheckedRef.current = true;
    executeAutoPostSync();
  }, [isStorageInitialized, executeAutoPostSync]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    } catch {
      setStatusMessage('Impossibile salvare automaticamente i dati locali.');
    }
  }, [transactions]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(transactionOrder));
    } catch {
      setStatusMessage('Impossibile salvare il riordino delle transazioni.');
    }
  }, [transactionOrder]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(budgetCategories));
    } catch {
      setStatusMessage('Impossibile salvare i budget modificati.');
    }
  }, [budgetCategories]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(assets));
    } catch {
      setStatusMessage('Impossibile salvare gli asset modificati.');
    }
  }, [assets]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPENING_CASH_STORAGE_KEY, JSON.stringify(storedOpeningCash));
    } catch {
      setStatusMessage('Impossibile salvare la cassa iniziale.');
    }
  }, [storedOpeningCash]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACCOUNT_INITIAL_CAPITALS_STORAGE_KEY, JSON.stringify(accountInitialCapitals));
    } catch {
      setStatusMessage('Impossibile salvare il capitale iniziale dei conti.');
    }
  }, [accountInitialCapitals]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPENING_NET_WORTH_STORAGE_KEY, JSON.stringify(openingNetWorth));
    } catch {
      setStatusMessage('Impossibile salvare il patrimonio netto iniziale.');
    }
  }, [openingNetWorth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RECURRING_TX_STORAGE_KEY, JSON.stringify(recurringTransactions));
    } catch {
      setStatusMessage('Impossibile salvare le transazioni ricorrenti.');
    }
  }, [recurringTransactions]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAC_STORAGE_KEY, JSON.stringify(pianiAccumulo));
    } catch {
      setStatusMessage('Impossibile salvare i piani di accumulo.');
    }
  }, [pianiAccumulo]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPENING_DATE_STORAGE_KEY, JSON.stringify(openingDate));
    } catch {
      setStatusMessage('Impossibile salvare la data del capitale iniziale.');
    }
  }, [openingDate]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSET_TX_STORAGE_KEY, JSON.stringify(assetTransactions));
    } catch {
      setStatusMessage('Impossibile salvare le transazioni degli asset.');
    }
  }, [assetTransactions]);

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDE_NUMBERS_STORAGE_KEY, JSON.stringify(hideNumbers));
    } catch {
      setStatusMessage('Impossibile salvare le preferenze di privacy.');
    }
    setGlobalHideNumbers(hideNumbers);
  }, [hideNumbers]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(subscriptions));
    } catch {
      setStatusMessage('Impossibile salvare gli abbonamenti.');
    }
  }, [subscriptions]);

  const activeSectionConfig = sections.find((section) => section.id === activeSection) ?? sections[0];

  const orderedTransactions = useMemo(() => {
    const map = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const orderSet = new Set(transactionOrder);
    const ordered = transactionOrder.map((id) => map.get(id)).filter((transaction): transaction is Transaction => Boolean(transaction));
    const remaining = transactions.filter((transaction) => !orderSet.has(transaction.id));

    return [...ordered, ...remaining.sort((left, right) => right.createdAt - left.createdAt)];
  }, [transactions, transactionOrder]);

  const uniqueCategories = useMemo(() => {
    const categoriesSet = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.category) categoriesSet.add(tx.category);
    });
    return Array.from(categoriesSet).sort();
  }, [transactions]);

  const uniqueSubcategories = useMemo(() => {
    const subSet = new Set<string>();
    transactions.forEach((tx) => {
      if (filterCategory) {
        if (tx.category.toLowerCase() === filterCategory.toLowerCase() && tx.subcategory) {
          subSet.add(tx.subcategory);
        }
      } else if (tx.subcategory) {
        subSet.add(tx.subcategory);
      }
    });
    return Array.from(subSet).sort();
  }, [transactions, filterCategory]);

  const uniqueAccounts = useMemo(() => {
    const accountsSet = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.account) accountsSet.add(tx.account);
    });
    return Array.from(accountsSet).sort();
  }, [transactions]);

  const reimbursementMap = useMemo(() => {
    const map = new Map<string, ReimbursementInfo>();

    const refundsByExpenseId = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      if (tx.kind === 'income' && tx.reimbursesTransactionId) {
        const list = refundsByExpenseId.get(tx.reimbursesTransactionId) || [];
        list.push(tx);
        refundsByExpenseId.set(tx.reimbursesTransactionId, list);
      }
    }

    for (const tx of transactions) {
      if (tx.kind === 'expense' && (tx.needsReimbursement || refundsByExpenseId.has(tx.id))) {
        const refunds = refundsByExpenseId.get(tx.id) || [];
        const totalReimbursed = refunds.reduce((sum, r) => sum + Math.abs(r.amount), 0);
        const originalAmount = Math.abs(tx.amount);
        const remainingAmount = Math.max(0, originalAmount - totalReimbursed);
        let status: ReimbursementStatus = 'pending';
        if (totalReimbursed >= originalAmount - 0.009) {
          status = 'reimbursed';
        } else if (totalReimbursed > 0) {
          status = 'partial';
        }

        map.set(tx.id, {
          totalReimbursed,
          remainingAmount,
          status,
          refunds,
        });
      }
    }

    return map;
  }, [transactions]);

  const reimbursementStats = useMemo(() => {
    let pendingCount = 0;
    let pendingAmount = 0;
    let partialCount = 0;
    let reimbursedCount = 0;
    let reimbursedAmount = 0;

    for (const [_, info] of reimbursementMap) {
      if (info.status === 'pending') {
        pendingCount++;
        pendingAmount += info.remainingAmount;
      } else if (info.status === 'partial') {
        partialCount++;
        pendingAmount += info.remainingAmount;
        reimbursedAmount += info.totalReimbursed;
      } else if (info.status === 'reimbursed') {
        reimbursedCount++;
        reimbursedAmount += info.totalReimbursed;
      }
    }

    return {
      pendingCount,
      pendingAmount,
      partialCount,
      reimbursedCount,
      reimbursedAmount,
      totalTracked: pendingCount + partialCount + reimbursedCount,
    };
  }, [reimbursementMap]);

  const candidateExpensesForReimbursement = useMemo(() => {
    return transactions
      .filter((t) => t.kind === 'expense')
      .sort((a, b) => {
        const aInfo = reimbursementMap.get(a.id);
        const bInfo = reimbursementMap.get(b.id);
        const aPending = a.needsReimbursement && aInfo?.status !== 'reimbursed';
        const bPending = b.needsReimbursement && bInfo?.status !== 'reimbursed';
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;

        if (a.needsReimbursement && !b.needsReimbursement) return -1;
        if (!a.needsReimbursement && b.needsReimbursement) return 1;

        return b.date.localeCompare(a.date);
      });
  }, [transactions, reimbursementMap]);

  const filteredTransactions = useMemo(() => {
    let result = orderedTransactions;

    const minVal = filterMinAmount ? parseFloat(filterMinAmount) : NaN;
    const maxVal = filterMaxAmount ? parseFloat(filterMaxAmount) : NaN;
    const query = searchQuery.trim().toLowerCase();

    if (
      filterStartDate ||
      filterEndDate ||
      filterCategory ||
      filterSubcategory ||
      filterAccount ||
      filterKind ||
      filterReimbursement ||
      !isNaN(minVal) ||
      !isNaN(maxVal) ||
      query
    ) {
      result = result.filter((tx) => {
        if (filterStartDate && tx.date < filterStartDate) return false;
        if (filterEndDate && tx.date > filterEndDate) return false;
        if (filterCategory && tx.category.toLowerCase() !== filterCategory.toLowerCase()) return false;
        if (filterSubcategory && tx.subcategory.toLowerCase() !== filterSubcategory.toLowerCase()) return false;
        if (filterAccount && tx.account.toLowerCase() !== filterAccount.toLowerCase()) return false;
        if (filterKind && tx.kind !== filterKind) return false;
        if (filterReimbursement) {
          const info = reimbursementMap.get(tx.id);
          if (filterReimbursement === 'pending') {
            if (tx.kind !== 'expense') return false;
            if (!info || info.status === 'reimbursed') return false;
          } else if (filterReimbursement === 'reimbursed') {
            if (tx.kind !== 'expense') return false;
            if (!info || info.status !== 'reimbursed') return false;
          } else if (filterReimbursement === 'all_reimbursable') {
            if (tx.kind !== 'expense' || !info) return false;
          } else if (filterReimbursement === 'refund_income') {
            if (tx.kind !== 'income' || !tx.reimbursesTransactionId) return false;
          }
        }
        if (!isNaN(minVal) && Math.abs(tx.amount) < minVal) return false;
        if (!isNaN(maxVal) && Math.abs(tx.amount) > maxVal) return false;

        if (query) {
          const matchMerchant = tx.merchant.toLowerCase().includes(query);
          const matchCategory = tx.category.toLowerCase().includes(query);
          const matchSubcategory = tx.subcategory?.toLowerCase().includes(query);
          const matchAccount = tx.account.toLowerCase().includes(query);
          const matchNote = tx.note?.toLowerCase().includes(query);
          const matchDate = tx.date.includes(query);
          const matchAmount = String(tx.amount).includes(query);
          const matchReimbursement = (
            (query.includes('rimbors') || query.includes('da rimborsare')) && (
              Boolean(tx.needsReimbursement) ||
              Boolean(tx.reimbursesTransactionId) ||
              reimbursementMap.has(tx.id)
            )
          );
          if (
            matchMerchant ||
            matchCategory ||
            matchSubcategory ||
            matchAccount ||
            matchNote ||
            matchDate ||
            matchAmount ||
            matchReimbursement
          ) {
            return true;
          }

          // Lazy fallback for display date
          if (formatDisplayDate(tx.date).toLowerCase().includes(query)) return true;

          return false;
        }

        return true;
      });
    }

    // Apply sorting
    if (sortBy !== 'custom') {
      result = [...result].sort((left, right) => {
        let comparison = 0;
        if (sortBy === 'date') {
          comparison = left.date.localeCompare(right.date);
          if (comparison === 0) {
            comparison = left.createdAt - right.createdAt;
          }
        } else if (sortBy === 'amount') {
          comparison = left.amount - right.amount;
        } else if (sortBy === 'category') {
          comparison = left.category.localeCompare(right.category);
        } else if (sortBy === 'merchant') {
          comparison = left.merchant.localeCompare(right.merchant);
        } else if (sortBy === 'account') {
          comparison = left.account.localeCompare(right.account);
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [
    searchQuery,
    orderedTransactions,
    filterStartDate,
    filterEndDate,
    filterCategory,
    filterSubcategory,
    filterAccount,
    filterKind,
    filterReimbursement,
    filterMinAmount,
    filterMaxAmount,
    sortBy,
    sortOrder,
    reimbursementMap,
  ]);

  const reportTransactions = useMemo(() => {
    const start = reportRange.start ? new Date(`${reportRange.start}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const end = reportRange.end ? new Date(`${reportRange.end}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;

    return transactions.filter((transaction) => {
      const transactionTime = new Date(`${transaction.date}T12:00:00`).getTime();

      if (Number.isNaN(transactionTime)) {
        return false;
      }

      return transactionTime >= start && transactionTime <= end;
    });
  }, [reportRange, transactions]);

  const editingTransaction = transactions.find((transaction) => transaction.id === editingTransactionId) ?? null;
  const selectedTransactions = transactions.filter((transaction) => selectedTransactionIds.includes(transaction.id));
  const selectedTransactionsSum = useMemo(() => {
    return selectedTransactions.reduce((acc, t) => acc + t.amount, 0);
  }, [selectedTransactions]);
  const allFilteredSelected = filteredTransactions.length > 0 && filteredTransactions.every((transaction) => selectedTransactionIds.includes(transaction.id));

  const filteredSummary = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;
    let incomeCount = 0;
    let expenseCount = 0;

    filteredTransactions.forEach((tx) => {
      const val = Math.abs(tx.amount);
      if (tx.kind === 'income' || tx.amount > 0) {
        totalIncome += val;
        incomeCount++;
      } else {
        totalExpense += val;
        expenseCount++;
      }
    });

    const netTotal = totalIncome - totalExpense;
    const totalCount = filteredTransactions.length;
    const avgTransaction = totalCount > 0 ? (totalIncome + totalExpense) / totalCount : 0;

    return {
      totalIncome,
      totalExpense,
      netTotal,
      incomeCount,
      expenseCount,
      totalCount,
      avgTransaction,
    };
  }, [filteredTransactions]);

  const selectedSummary = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;
    let incomeCount = 0;
    let expenseCount = 0;

    selectedTransactions.forEach((tx) => {
      const val = Math.abs(tx.amount);
      if (tx.kind === 'income' || tx.amount > 0) {
        totalIncome += val;
        incomeCount++;
      } else {
        totalExpense += val;
        expenseCount++;
      }
    });

    const netTotal = totalIncome - totalExpense;
    const totalCount = selectedTransactions.length;
    const avgTransaction = totalCount > 0 ? (totalIncome + totalExpense) / totalCount : 0;

    return {
      totalIncome,
      totalExpense,
      netTotal,
      incomeCount,
      expenseCount,
      totalCount,
      avgTransaction,
    };
  }, [selectedTransactions]);


  const getAssetCurrentQuantity = (asset: Asset) => {
    const txs = assetTransactions.filter((tx) => tx.assetId === asset.id);
    if (txs.length === 0) {
      return asset.quantity;
    }
    return txs.reduce((sum, tx) => {
      return tx.kind === 'buy' ? sum + tx.quantity : sum - tx.quantity;
    }, 0);
  };

  const activeTransactionsForBalances = useMemo(() => {
    return transactions.filter((transaction) => transaction.date >= openingDate);
  }, [transactions, openingDate]);

  const expenseTransactions = useMemo(() => {
    return activeTransactionsForBalances.filter((transaction) => transaction.kind === 'expense');
  }, [activeTransactionsForBalances]);

  const incomeTransactions = useMemo(() => {
    return activeTransactionsForBalances.filter((transaction) => transaction.kind === 'income');
  }, [activeTransactionsForBalances]);

  const reportExpenseTransactions = reportTransactions.filter(
    (transaction) => transaction.kind === 'expense' && !isTransferCategory(transaction.category, transaction.subcategory)
  );
  const reportIncomeTransactions = reportTransactions.filter(
    (transaction) => transaction.kind === 'income' && !isTransferCategory(transaction.category, transaction.subcategory)
  );

  const reportCategoryBreakdown = useMemo(() => {
    const categoryMap = new Map<string, { spent: number; color: string; subcategories: Map<string, number> }>();
    
    budgetCategories.forEach((cat) => {
      if (isTransferCategory(cat.name)) return;
      categoryMap.set(cat.name.toUpperCase(), {
        spent: 0,
        color: cat.color || '#3b82f6',
        subcategories: new Map<string, number>()
      });
    });

    reportExpenseTransactions.forEach((tx) => {
      const catName = tx.category ? tx.category.trim() : 'Senza Categoria';
      const catKey = catName.toUpperCase();
      const subcatName = tx.subcategory ? tx.subcategory.trim() : 'Altro';
      const amount = Math.abs(tx.amount);

      if (!categoryMap.has(catKey)) {
        categoryMap.set(catKey, {
          spent: 0,
          color: '#64748b',
          subcategories: new Map<string, number>()
        });
      }

      const catData = categoryMap.get(catKey)!;
      catData.spent += amount;
      
      const subcatKey = subcatName.toUpperCase();
      const currentSubspent = catData.subcategories.get(subcatKey) || 0;
      catData.subcategories.set(subcatKey, currentSubspent + amount);
    });

    return Array.from(categoryMap.entries())
      .map(([key, data]) => {
        const originalCategory = budgetCategories.find(c => c.name.toUpperCase() === key);
        const name = originalCategory ? originalCategory.name : (key === 'SENZA CATEGORIA' ? 'Senza Categoria' : key);
        
        const subcategoriesArray = Array.from(data.subcategories.entries())
          .map(([subKey, subSpent]) => {
            const originalSub = originalCategory?.subcategories.find(s => s.name.toUpperCase() === subKey);
            const subName = originalSub ? originalSub.name : (subKey === 'ALTRO' ? 'Altro' : subKey);
            return {
              name: subName,
              spent: subSpent
            };
          })
          .filter(sub => sub.spent > 0)
          .sort((a, b) => b.spent - a.spent);

        return {
          name,
          spent: data.spent,
          color: data.color,
          subcategories: subcategoriesArray
        };
      })
      .filter(cat => cat.spent > 0)
      .sort((a, b) => b.spent - a.spent);
  }, [budgetCategories, reportExpenseTransactions]);

  const reportAccountsBalances = useMemo(() => {
    const startIso = reportRange.start;
    const endIso = reportRange.end;

    return uniqueAccounts.map((accountName) => {
      const allTxs = transactions.filter((tx) => tx.account === accountName);

      let initialAllocated = accountInitialCapitals[accountName] !== undefined ? accountInitialCapitals[accountName] : 0;
      if (Object.keys(accountInitialCapitals).length === 0 && uniqueAccounts[0] === accountName) {
        initialAllocated = openingCash;
      }
      
      const activeTxs = allTxs.filter((tx) => tx.date >= openingDate);
      const prevTxs = activeTxs.filter((tx) => tx.date < startIso);
      const prevIncomes = prevTxs.filter((tx) => tx.kind === 'income').reduce((sum, tx) => sum + tx.amount, 0);
      const prevExpenses = prevTxs.filter((tx) => tx.kind === 'expense').reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

      const rangeIncomes = activeTxs
        .filter((tx) => tx.kind === 'income' && tx.date >= startIso && tx.date <= endIso)
        .reduce((sum, tx) => sum + tx.amount, 0);

      const rangeExpenses = activeTxs
        .filter((tx) => tx.kind === 'expense' && tx.date >= startIso && tx.date <= endIso)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

      // Liquidity includes the initial capital plus active transactions (prev and range)
      const liquidity = initialAllocated + prevIncomes - prevExpenses + rangeIncomes - rangeExpenses;

      const assetsValue = assets
        .filter((asset) => asset.institution.trim().toLowerCase() === accountName.trim().toLowerCase())
        .reduce((sum, asset) => {
          const txs = assetTransactions.filter((tx) => tx.assetId === asset.id && tx.date <= endIso);
          const quantityOnDate = txs.length === 0 ? asset.quantity : txs.reduce((s, tx) => {
            return tx.kind === 'buy' ? s + tx.quantity : s - tx.quantity;
          }, 0);
          
          const price = asset.ticker ? getHistoricalTickerPrice(asset.ticker, endIso, asset.unitValue) : asset.unitValue;
          return sum + quantityOnDate * price;
        }, 0);

      const totalBalance = liquidity + assetsValue;

      return {
        name: accountName,
        initialCapital: initialAllocated, // Must exactly correspond to what is written in settings
        rangeIncomes,
        rangeExpenses,
        liquidity,
        assetsValue,
        totalBalance,
      };
    });
  }, [uniqueAccounts, transactions, reportRange, openingCash, accountInitialCapitals, assets, assetTransactions, getHistoricalTickerPrice, openingDate]);

  const expenseTotal = expenseTransactions.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const incomeTotal = incomeTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const netFlow = incomeTotal - expenseTotal;
  const cashAvailable = openingCash + netFlow;

  const {
    projectedEndBalance,
    projectedRemainingRecurringIncomes,
    projectedRemainingRecurringExpenses,
    projectedRemainingPACs,
    upcomingMovementsList,
    minProjectedBalance,
    minProjectedBalanceDate,
  } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-11
    const currentDay = today.getDate(); // 1-31

    let horizonEndDate: Date;
    if (scadenziarioHorizon === '30d') {
      horizonEndDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    } else if (scadenziarioHorizon === '60d') {
      horizonEndDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
    } else if (scadenziarioHorizon === '90d') {
      horizonEndDate = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
    } else {
      // Default: end of current month
      horizonEndDate = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);
    }

    type UpcomingMovement = {
      id: string;
      sourceId: string;
      name: string;
      amount: number;
      kind: 'income' | 'expense' | 'pac';
      dateStr: string;
      categoryOrAsset: string;
      subcategory?: string;
      account?: string;
      frequencyLabel?: string;
      note?: string;
      daysRemaining: number;
      projectedBalanceAfter?: number;
    };

    const movements: UpcomingMovement[] = [];

    // Calculate recurring transactions
    recurringTransactions.forEach((tx) => {
      if (!tx.isActive) return;

      if (tx.frequency === 'monthly') {
        const dom = tx.dayOfMonth || 1;
        let mRunner = new Date(currentYear, currentMonth, 1);
        while (mRunner <= horizonEndDate) {
          const y = mRunner.getFullYear();
          const m = mRunner.getMonth();
          const daysInThisMonth = new Date(y, m + 1, 0).getDate();
          const actualDay = Math.min(dom, daysInThisMonth);
          const eventDate = new Date(y, m, actualDay, 12, 0, 0);

          if (eventDate >= today && eventDate <= horizonEndDate) {
            const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
            const diffDays = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            movements.push({
              id: `rec-${tx.id}-${dateStr}`,
              sourceId: tx.id,
              name: tx.merchant,
              amount: tx.amount,
              kind: tx.kind,
              dateStr,
              categoryOrAsset: tx.category,
              subcategory: tx.subcategory,
              account: tx.account,
              frequencyLabel: `Mensile (il ${dom}°)`,
              note: tx.note,
              daysRemaining: diffDays,
            });
          }
          mRunner.setMonth(mRunner.getMonth() + 1);
        }
      } else if (tx.frequency === 'weekly') {
        const targetDow = tx.dayOfWeek !== undefined ? tx.dayOfWeek : 1; // Default Monday
        const runner = new Date(today);
        while (runner <= horizonEndDate) {
          if (runner.getDay() === targetDow) {
            const y = runner.getFullYear();
            const m = runner.getMonth();
            const d = runner.getDate();
            const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const diffDays = Math.ceil((runner.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            movements.push({
              id: `rec-${tx.id}-${dateStr}`,
              sourceId: tx.id,
              name: `${tx.merchant}`,
              amount: tx.amount,
              kind: tx.kind,
              dateStr,
              categoryOrAsset: tx.category,
              subcategory: tx.subcategory,
              account: tx.account,
              frequencyLabel: 'Settimanale',
              note: tx.note,
              daysRemaining: diffDays,
            });
          }
          runner.setDate(runner.getDate() + 1);
        }
      } else if (tx.frequency === 'custom_days') {
        const interval = tx.intervalDays || 30;
        const start = new Date(tx.startDate + 'T12:00:00');
        if (!isNaN(start.getTime())) {
          const runner = new Date(start.getTime());
          const intervalMs = interval * 24 * 60 * 60 * 1000;
          while (runner <= horizonEndDate) {
            if (runner >= today) {
              const y = runner.getFullYear();
              const m = runner.getMonth();
              const d = runner.getDate();
              const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const diffDays = Math.ceil((runner.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              movements.push({
                id: `rec-${tx.id}-${dateStr}`,
                sourceId: tx.id,
                name: `${tx.merchant}`,
                amount: tx.amount,
                kind: tx.kind,
                dateStr,
                categoryOrAsset: tx.category,
                subcategory: tx.subcategory,
                account: tx.account,
                frequencyLabel: `Ogni ${interval} gg`,
                note: tx.note,
                daysRemaining: diffDays,
              });
            }
            runner.setTime(runner.getTime() + intervalMs);
          }
        }
      }
    });

    // Calculate Piani di Accumulo (PAC)
    pianiAccumulo.forEach((pac) => {
      if (!pac.isActive) return;

      const dom = pac.dayOfMonth || 1;
      let mRunner = new Date(currentYear, currentMonth, 1);
      while (mRunner <= horizonEndDate) {
        const y = mRunner.getFullYear();
        const m = mRunner.getMonth();
        const daysInThisMonth = new Date(y, m + 1, 0).getDate();
        const actualDay = Math.min(dom, daysInThisMonth);
        const eventDate = new Date(y, m, actualDay, 12, 0, 0);

        if (eventDate >= today && eventDate <= horizonEndDate) {
          const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
          const targetAsset = assets.find((a) => a.id === pac.assetId);
          const assetName = targetAsset ? targetAsset.name : 'Asset Sconosciuto';
          const debitAccount = pac.account || (targetAsset ? targetAsset.institution : '') || 'Conto principale';
          const diffDays = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          movements.push({
            id: `pac-${pac.id}-${dateStr}`,
            sourceId: pac.id,
            name: `PAC: ${pac.name}`,
            amount: pac.amount,
            kind: 'pac',
            dateStr,
            categoryOrAsset: assetName,
            account: debitAccount,
            frequencyLabel: `Mensile (il ${dom}°)`,
            daysRemaining: diffDays,
          });
        }
        mRunner.setMonth(mRunner.getMonth() + 1);
      }
    });

    // Calculate Cashback & Saveback scheduled investments
    cashbackRules.forEach((cb) => {
      if (!cb.isActive) return;

      const dom = cb.investmentDayOfMonth || 2;
      let mRunner = new Date(currentYear, currentMonth, 1);
      while (mRunner <= horizonEndDate) {
        const y = mRunner.getFullYear();
        const m = mRunner.getMonth();
        const daysInThisMonth = new Date(y, m + 1, 0).getDate();
        const actualDay = Math.min(dom, daysInThisMonth);
        const eventDate = new Date(y, m, actualDay, 12, 0, 0);

        if (eventDate >= today && eventDate <= horizonEndDate) {
          const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
          const targetAsset = assets.find((a) => a.id === cb.assetId);
          const diffDays = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          const isCurrentMonth = m === currentMonth && y === currentYear;
          let estAmount = cb.monthlyCap && cb.monthlyCap > 0 ? cb.monthlyCap : 15;
          if (isCurrentMonth) {
            const matchingTxs = transactions.filter((tx) => {
              return (
                tx.kind === 'expense' &&
                tx.date.startsWith(currentMonthStr) &&
                !isTransferCategory(tx.category, tx.subcategory) &&
                tx.account?.trim().toLowerCase() === cb.account.trim().toLowerCase()
              );
            });
            const spent = matchingTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
            const accrued = (spent * cb.percentage) / 100;
            if (accrued > 0) {
              estAmount = cb.monthlyCap && cb.monthlyCap > 0 ? Math.min(accrued, cb.monthlyCap) : accrued;
            }
          }

          movements.push({
            id: `cb-${cb.id}-${dateStr}`,
            sourceId: cb.id,
            name: cb.destination === 'asset' ? `Saveback: ${cb.name}` : `Cashback: ${cb.name}`,
            amount: parseFloat(estAmount.toFixed(2)),
            kind: cb.destination === 'asset' ? 'pac' : 'income',
            dateStr,
            categoryOrAsset: cb.destination === 'asset' ? (targetAsset ? targetAsset.name : 'Investimento Asset') : 'Cashback Conto',
            account: cb.account,
            frequencyLabel: `Mensile (il ${dom}°)`,
            note: `${cb.percentage}% ${cb.destination === 'asset' ? 'Saveback investito' : 'Cashback accreditato'}`,
            daysRemaining: diffDays,
          });
        }
        mRunner.setMonth(mRunner.getMonth() + 1);
      }
    });

    // Sort movements chronologically
    movements.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    // Calculate totals and running projected cash balance
    let expectedIncomes = 0;
    let expectedExpenses = 0;
    let expectedPACs = 0;

    let runningBalance = cashAvailable;
    let minBal = cashAvailable;
    let minBalDate = '';

    movements.forEach((mv) => {
      if (mv.kind === 'income') {
        expectedIncomes += mv.amount;
        runningBalance += mv.amount;
      } else if (mv.kind === 'expense') {
        expectedExpenses += mv.amount;
        runningBalance -= mv.amount;
      } else {
        expectedPACs += mv.amount;
        runningBalance -= mv.amount;
      }
      mv.projectedBalanceAfter = runningBalance;
      if (runningBalance < minBal) {
        minBal = runningBalance;
        minBalDate = mv.dateStr;
      }
    });

    const endBalance = cashAvailable + expectedIncomes - expectedExpenses - expectedPACs;

    return {
      projectedEndBalance: endBalance,
      projectedRemainingRecurringIncomes: expectedIncomes,
      projectedRemainingRecurringExpenses: expectedExpenses,
      projectedRemainingPACs: expectedPACs,
      upcomingMovementsList: movements,
      minProjectedBalance: minBal,
      minProjectedBalanceDate: minBalDate,
    };
  }, [cashAvailable, recurringTransactions, pianiAccumulo, assets, scadenziarioHorizon]);
  const currentMonthStr = useMemo(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const {
    currentMonthTransactions,
    currentMonthExpenseTransactions,
    currentMonthIncomeTransactions,
    currentMonthIncomeTotal
  } = useMemo(() => {
    const currentMonth: Transaction[] = [];
    const expenses: Transaction[] = [];
    const incomes: Transaction[] = [];
    let incomeSum = 0;

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (tx.date.startsWith(currentMonthStr)) {
        currentMonth.push(tx);
        const isTransfer = isTransferCategory(tx.category, tx.subcategory);
        if (tx.kind === 'expense') {
          if (!isTransfer) {
            expenses.push(tx);
          }
        } else if (tx.kind === 'income') {
          if (!isTransfer) {
            incomes.push(tx);
            incomeSum += tx.amount;
          }
        }
      }
    }

    return {
      currentMonthTransactions: currentMonth,
      currentMonthExpenseTransactions: expenses,
      currentMonthIncomeTransactions: incomes,
      currentMonthIncomeTotal: incomeSum,
    };
  }, [transactions, currentMonthStr]);

  const currentMonthUpcomingRecurringExpenses = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-11
    const currentDay = today.getDate(); // 1-31
    const lastDateOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDateOfMonth.getDate();

    const expected: { category: string; subcategory: string; amount: number }[] = [];

    recurringTransactions.forEach((tx) => {
      if (!tx.isActive || tx.kind !== 'expense' || isTransferCategory(tx.category, tx.subcategory)) return;

      if (tx.frequency === 'monthly') {
        const dom = tx.dayOfMonth || 1;
        if (dom >= currentDay && dom <= daysInMonth) {
          expected.push({
            category: tx.category,
            subcategory: tx.subcategory,
            amount: tx.amount
          });
        }
      } else if (tx.frequency === 'weekly') {
        const targetDow = tx.dayOfWeek !== undefined ? tx.dayOfWeek : 1;
        const runner = new Date(currentYear, currentMonth, currentDay);
        while (runner <= lastDateOfMonth) {
          if (runner.getDay() === targetDow) {
            expected.push({
              category: tx.category,
              subcategory: tx.subcategory,
              amount: tx.amount
            });
          }
          runner.setDate(runner.getDate() + 1);
        }
      } else if (tx.frequency === 'custom_days') {
        const interval = tx.intervalDays || 30;
        const start = new Date(tx.startDate + 'T12:00:00');
        if (!isNaN(start.getTime())) {
          const runner = new Date(start.getTime());
          const intervalMs = interval * 24 * 60 * 60 * 1000;
          const startOfToday = new Date(currentYear, currentMonth, currentDay);
          while (runner <= lastDateOfMonth) {
            if (runner >= startOfToday) {
              expected.push({
                category: tx.category,
                subcategory: tx.subcategory,
                amount: tx.amount
              });
            }
            runner.setTime(runner.getTime() + intervalMs);
          }
        }
      }
    });

    return expected;
  }, [recurringTransactions]);

  const totalMonthIncome = useMemo(() => {
    return currentMonthIncomeTotal + projectedRemainingRecurringIncomes;
  }, [currentMonthIncomeTotal, projectedRemainingRecurringIncomes]);

  const budgetLimit = useMemo(() => {
    return budgetCategories.reduce((sum, category) => {
      const resolvedLimit = category.limitType === 'percentage'
        ? (totalMonthIncome * (category.limitPercent || 0)) / 100
        : category.limit;
      return sum + resolvedLimit;
    }, 0);
  }, [budgetCategories, totalMonthIncome]);

  const budgetSpent = useMemo(() => {
    return budgetCategories.reduce((sum, category) => {
      const categorySpent = currentMonthExpenseTransactions
        .filter((transaction) => transaction.category === category.name)
        .reduce((categorySum, transaction) => categorySum + Math.abs(transaction.amount), 0);

      const categoryExpected = currentMonthUpcomingRecurringExpenses
        .filter((tx) => tx.category === category.name)
        .reduce((sum, tx) => sum + tx.amount, 0);

      return sum + categorySpent + categoryExpected;
    }, 0);
  }, [budgetCategories, currentMonthExpenseTransactions, currentMonthUpcomingRecurringExpenses]);

  const budgetRemaining = useMemo(() => {
    return budgetLimit - budgetSpent;
  }, [budgetLimit, budgetSpent]);

  const budgetUsage = useMemo(() => {
    return budgetLimit > 0 ? Math.round((budgetSpent / budgetLimit) * 100) : 0;
  }, [budgetSpent, budgetLimit]);

  const assetMarketValue = useMemo(() => {
    return assets.reduce((sum, asset) => {
      const currentQty = getAssetCurrentQuantity(asset);
      const tickerClean = asset.ticker ? asset.ticker.toUpperCase() : '';
      const tData = tickerClean ? tickerData[tickerClean] : null;
      const price = tData && typeof tData.price === 'number' ? tData.price : asset.unitValue;
      return sum + currentQty * price;
    }, 0);
  }, [assets, assetTransactions, tickerData]);

  const currentNetWorth = cashAvailable + assetMarketValue;

  const monthlyExpensesAverage = useMemo(() => {
    const totalActiveExpenses = activeTransactionsForBalances
      .filter((tx) => tx.kind === 'expense' && !isTransferCategory(tx.category, tx.subcategory))
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    
    const startDate = new Date(openingDate);
    const endDate = new Date();
    let months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
    if (months <= 0) {
      months = 1;
    }
    
    return totalActiveExpenses / months;
  }, [activeTransactionsForBalances, openingDate]);

  const emergencyAutonomyMonths = useMemo(() => {
    const avgExpenses = monthlyExpensesAverage;
    if (avgExpenses <= 0) {
      return 12; // default fallback
    }
    const autonomy = (cashAvailable + assetMarketValue) / avgExpenses;
    return Math.max(0, parseFloat(autonomy.toFixed(1)));
  }, [cashAvailable, assetMarketValue, monthlyExpensesAverage]);

  const totalAssetsVal = useMemo(() => {
    const positiveLiquidity = reportAccountsBalances.reduce((sum, acc) => sum + Math.max(0, acc.liquidity), 0);
    return positiveLiquidity + assetMarketValue;
  }, [reportAccountsBalances, assetMarketValue]);

  const assetAllocationData = useMemo(() => {
    // Macro asset allocation: ETF azionari count as Azioni, ETF obbligazionari count as Obbligazioni
    const categories: Record<string, { value: number; color: string; label: string }> = {
      cash: { value: Math.max(0, cashAvailable), color: '#06b6d4', label: 'Liquidità (Conti)' },
      azioni: { value: 0, color: '#3b82f6', label: 'Azioni (incl. ETF Azionari)' },
      obbligazioni: { value: 0, color: '#10b981', label: 'Obbligazioni (incl. ETF Obbligazionari)' },
      liquidita: { value: 0, color: '#67e8f9', label: 'Liquidità (Titoli)' },
      fondo: { value: 0, color: '#ec4899', label: 'Fondi Comuni' },
      cripto: { value: 0, color: '#f59e0b', label: 'Criptovalute' },
      proprieta_mobili: { value: 0, color: '#cbd5e1', label: 'Proprietà Mobili' },
      proprieta_immobili: { value: 0, color: '#ef4444', label: 'Proprietà Immobili' },
      altro: { value: 0, color: '#64748b', label: 'Altro' },
    };

    assets.forEach((asset) => {
      const qty = getAssetCurrentQuantity(asset);
      const tickerClean = asset.ticker ? asset.ticker.toUpperCase() : '';
      const tData = tickerClean ? tickerData[tickerClean] : null;
      const price = tData && typeof tData.price === 'number' ? tData.price : asset.unitValue;
      const val = Math.max(0, qty) * price;

      if (val > 0) {
        if (isAssetEquityEtf(asset)) {
          categories.azioni.value += val;
        } else if (isAssetBondEtf(asset)) {
          categories.obbligazioni.value += val;
        } else if (asset.kind === 'azioni') {
          categories.azioni.value += val;
        } else if (asset.kind === 'obbligazioni') {
          categories.obbligazioni.value += val;
        } else if (asset.kind === 'cripto') {
          categories.cripto.value += val;
        } else {
          const kind = asset.kind;
          if (categories[kind]) {
            categories[kind].value += val;
          } else {
            // Custom dynamic categories
            categories[kind] = { value: val, color: '#84cc16', label: formatAssetKindLabel(kind, asset.etfSubtype) };
          }
        }
      }
    });

    const list = Object.entries(categories)
      .map(([key, item]) => ({
        key,
        label: item.label,
        value: item.value,
        color: item.color,
      }))
      .filter((item) => item.value > 0);

    const total = list.reduce((sum, item) => sum + item.value, 0);

    return {
      list: list.map((item) => ({
        ...item,
        percentage: total > 0 ? (item.value / total) * 100 : 0,
      })),
      total,
    };
  }, [assets, assetTransactions, tickerData, cashAvailable]);

  const totalLiabilitiesVal = useMemo(() => {
    return reportAccountsBalances.reduce((sum, acc) => sum + Math.abs(Math.min(0, acc.liquidity)), 0);
  }, [reportAccountsBalances]);

  const assetsPercent = 100;
  
  const liabilitiesPercent = useMemo(() => {
    return totalAssetsVal > 0 ? Math.min(100, Math.round((totalLiabilitiesVal / totalAssetsVal) * 100)) : 0;
  }, [totalAssetsVal, totalLiabilitiesVal]);

  const assetPortfolioTrend: PortfolioPoint[] = useMemo(() => {
    const activeAssets = selectedAssetIdsForChart.length === 0 ? assets : assets.filter((a) => selectedAssetIdsForChart.includes(a.id));
    if (activeAssets.length === 0) {
      return [{ label: 'Inizio', value: 0 }];
    }

    const activeAssetIds = new Set(activeAssets.map((a) => a.id));
    const activeAssetTransactions = assetTransactions.filter((tx) => activeAssetIds.has(tx.assetId));

    const txDates = activeAssetTransactions.map((tx) => tx.date);
    const tickerDates: string[] = [];
    Object.entries(tickerData).forEach(([ticker, data]) => {
      const hasActiveAssetWithTicker = activeAssets.some((a) => a.ticker && a.ticker.toUpperCase() === ticker.toUpperCase());
      if (hasActiveAssetWithTicker && data.history) {
        data.history.forEach((h) => tickerDates.push(h.date));
      }
    });

    const todayIso = getTodayIso();
    const allDatesSet = new Set<string>([...txDates, ...tickerDates, todayIso]);

    let earliestAvailableDate = todayIso;
    if (txDates.length > 0) {
      earliestAvailableDate = txDates.reduce((min, d) => d < min ? d : min);
    } else if (tickerDates.length > 0) {
      earliestAvailableDate = tickerDates.reduce((min, d) => d < min ? d : min);
    } else {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      earliestAvailableDate = d.toISOString().split('T')[0];
    }

    const startFilter = assetRange.start || earliestAvailableDate;
    const endFilter = assetRange.end || todayIso;

    let dates = Array.from(allDatesSet)
      .filter((d) => d >= startFilter && d <= endFilter)
      .sort();

    if (dates.length === 0) {
      dates = [startFilter, endFilter].sort();
    }
    if (dates.length === 1) {
      const dObj = new Date(`${dates[0]}T12:00:00`);
      dObj.setDate(dObj.getDate() - 30);
      dates = [dObj.toISOString().split('T')[0], dates[0]].sort();
    }

    let sampledDates = dates;
    if (dates.length > 70) {
      const step = Math.ceil(dates.length / 60);
      const criticalSet = new Set([...txDates, dates[0], dates[dates.length - 1]]);
      sampledDates = dates.filter((d, idx) => idx % step === 0 || criticalSet.has(d) || idx === dates.length - 1);
      sampledDates = Array.from(new Set(sampledDates)).sort();
    }

    const getAssetQtyOnDate = (asset: Asset, d: string): number => {
      const assetTxs = assetTransactions.filter((tx) => tx.assetId === asset.id);
      if (assetTxs.length === 0) {
        return asset.quantity;
      }
      const priorTxs = assetTxs.filter((tx) => tx.date <= d);
      if (priorTxs.length === 0) return 0;
      return priorTxs.reduce((sum, tx) => tx.kind === 'buy' ? sum + tx.quantity : sum - tx.quantity, 0);
    };

    const getAssetPriceOnDate = (asset: Asset, d: string): number => {
      if (asset.ticker) {
        return getHistoricalTickerPrice(asset.ticker, d, asset.unitValue);
      }
      const assetTxs = assetTransactions
        .filter((tx) => tx.assetId === asset.id && tx.date <= d)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (assetTxs.length > 0) {
        return assetTxs[assetTxs.length - 1].unitValue;
      }
      return asset.unitValue;
    };

    const points: PortfolioPoint[] = [];

    if (portfolioChartMode === 'total') {
      // MODALITÀ CON TRANSAZIONI (Valore Totale di Portafoglio in €)
      // Varia sia sulla base delle transazioni (quantità cambiano ad ogni acquisto/vendita),
      // sia sulla base dell'andamento delle quotazioni giornaliere
      sampledDates.forEach((date) => {
        let dateTotal = 0;
        activeAssets.forEach((asset) => {
          const qty = getAssetQtyOnDate(asset, date);
          const price = getAssetPriceOnDate(asset, date);
          dateTotal += Math.max(0, qty) * price;
        });

        points.push({
          label: formatPortfolioLabel(new Date(`${date}T12:00:00`).getTime()),
          value: Math.round(dateTotal * 100) / 100,
        });
      });

      let activeMarketValue = 0;
      activeAssets.forEach((asset) => {
        const currentQty = getAssetCurrentQuantity(asset);
        const tickerClean = asset.ticker ? asset.ticker.toUpperCase() : '';
        const tData = tickerClean ? tickerData[tickerClean] : null;
        const price = tData && typeof tData.price === 'number' ? tData.price : asset.unitValue;
        activeMarketValue += Math.max(0, currentQty) * price;
      });

      if (points.length > 0 && points[points.length - 1].label !== 'Oggi' && todayIso >= startFilter && todayIso <= endFilter) {
        points.push({
          label: 'Oggi',
          value: Math.round(activeMarketValue * 100) / 100,
        });
      }
    } else {
      // MODALITÀ SENZA TRANSAZIONI (Rendimento Quotazioni % - Time-Weighted Return)
      // Elimina completamente l'effetto distorsivo di versamenti/prelievi e acquisti/vendite:
      // ad ogni passaggio, il rendimento misura esclusivamente la variazione delle quotazioni dei titoli detenuti!
      let cumCompound = 1.0;
      points.push({
        label: formatPortfolioLabel(new Date(`${sampledDates[0]}T12:00:00`).getTime()),
        value: 0.0,
      });

      for (let i = 1; i < sampledDates.length; i++) {
        const prevDate = sampledDates[i - 1];
        const currDate = sampledDates[i];

        let prevValAtPrevPrices = 0;
        let prevValAtCurrPrices = 0;
        let purePriceSumPrev = 0;
        let purePriceSumCurr = 0;

        activeAssets.forEach((asset) => {
          const qtyPrev = getAssetQtyOnDate(asset, prevDate);
          const pricePrev = getAssetPriceOnDate(asset, prevDate);
          const priceCurr = getAssetPriceOnDate(asset, currDate);

          if (qtyPrev > 0) {
            prevValAtPrevPrices += qtyPrev * pricePrev;
            prevValAtCurrPrices += qtyPrev * priceCurr;
          }
          if (pricePrev > 0) {
            purePriceSumPrev += pricePrev;
            purePriceSumCurr += priceCurr;
          }
        });

        let stepReturn = 0;
        if (prevValAtPrevPrices > 0) {
          // Rendimento ponderato sui titoli detenuti prima del nuovo giorno (immune da depositi a currDate)
          stepReturn = (prevValAtCurrPrices - prevValAtPrevPrices) / prevValAtPrevPrices;
        } else if (purePriceSumPrev > 0) {
          // Fallback quotazioni pure se non ci sono ancora quote prima di tale data
          stepReturn = (purePriceSumCurr - purePriceSumPrev) / purePriceSumPrev;
        }

        cumCompound *= (1 + stepReturn);
        const cumPercent = (cumCompound - 1) * 100;

        points.push({
          label: formatPortfolioLabel(new Date(`${currDate}T12:00:00`).getTime()),
          value: Math.round(cumPercent * 100) / 100,
        });
      }
    }

    return points;
  }, [assets, assetTransactions, tickerData, getHistoricalTickerPrice, selectedAssetIdsForChart, assetRange, portfolioChartMode]);

  const assetTrendMax = useMemo(() => {
    if (assetPortfolioTrend.length === 0) return 1;
    const maxVal = Math.max(...assetPortfolioTrend.map((point) => point.value));
    if (portfolioChartMode === 'no-transactions') {
      const minVal = Math.min(...assetPortfolioTrend.map((point) => point.value));
      return maxVal === minVal ? maxVal + 2 : maxVal;
    }
    return Math.max(maxVal, 1);
  }, [assetPortfolioTrend, portfolioChartMode]);

  const assetTrendMin = useMemo(() => {
    if (assetPortfolioTrend.length === 0) return 0;
    const minVal = Math.min(...assetPortfolioTrend.map((point) => point.value));
    if (portfolioChartMode === 'no-transactions') {
      const maxVal = Math.max(...assetPortfolioTrend.map((point) => point.value));
      return maxVal === minVal ? minVal - 2 : minVal;
    }
    return Math.min(minVal, 0);
  }, [assetPortfolioTrend, portfolioChartMode]);

  const processedAssets = useMemo(() => {
    let result = [...assets];

    // Search filter
    if (assetSearch.trim()) {
      const query = assetSearch.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          (a.ticker && a.ticker.toLowerCase().includes(query))
      );
    }

    // Category filter
    if (assetFilterCategory) {
      if (assetFilterCategory === 'azioni_all') {
        result = result.filter((a) => a.kind === 'azioni' || isAssetEquityEtf(a));
      } else if (assetFilterCategory === 'obbligazioni_all') {
        result = result.filter((a) => a.kind === 'obbligazioni' || isAssetBondEtf(a));
      } else if (assetFilterCategory === 'etf_azionario') {
        result = result.filter((a) => isAssetEquityEtf(a));
      } else if (assetFilterCategory === 'etf_obbligazionario') {
        result = result.filter((a) => isAssetBondEtf(a));
      } else {
        result = result.filter((a) => a.kind === assetFilterCategory);
      }
    }

    // Institution filter
    if (assetFilterInstitution) {
      result = result.filter((a) => a.institution === assetFilterInstitution);
    }

    // Sort
    result.sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      if (assetSortBy === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (assetSortBy === 'qty') {
        valA = getAssetCurrentQuantity(a);
        valB = getAssetCurrentQuantity(b);
      } else if (assetSortBy === 'unitValue') {
        const tickerCleanA = a.ticker ? a.ticker.toUpperCase() : '';
        const tDataA = tickerCleanA ? tickerData[tickerCleanA] : null;
        valA = tDataA && typeof tDataA.price === 'number' ? tDataA.price : a.unitValue;

        const tickerCleanB = b.ticker ? b.ticker.toUpperCase() : '';
        const tDataB = tickerCleanB ? tickerData[tickerCleanB] : null;
        valB = tDataB && typeof tDataB.price === 'number' ? tDataB.price : b.unitValue;
      } else {
        // 'value' (total value) is default
        const qtyA = getAssetCurrentQuantity(a);
        const tickerCleanA = a.ticker ? a.ticker.toUpperCase() : '';
        const tDataA = tickerCleanA ? tickerData[tickerCleanA] : null;
        const priceA = tDataA && typeof tDataA.price === 'number' ? tDataA.price : a.unitValue;
        valA = qtyA * priceA;

        const qtyB = getAssetCurrentQuantity(b);
        const tickerCleanB = b.ticker ? b.ticker.toUpperCase() : '';
        const tDataB = tickerCleanB ? tickerData[tickerCleanB] : null;
        const priceB = tDataB && typeof tDataB.price === 'number' ? tDataB.price : b.unitValue;
        valB = qtyB * priceB;
      }

      if (valA < valB) return assetSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return assetSortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [assets, assetSearch, assetFilterCategory, assetFilterInstitution, assetSortBy, assetSortOrder, tickerData, assetTransactions]);

  const uniqueAssetKinds = useMemo(() => {
    return Array.from(new Set(assets.map((a) => a.kind))).sort();
  }, [assets]);

  const uniqueAssetInstitutions = useMemo(() => {
    return Array.from(new Set(assets.map((a) => a.institution))).sort();
  }, [assets]);

  const setAssetPresetRange = (preset: 'questo-mese' | 'mese-scorso' | 'quest-anno' | 'ultimi-3-mesi' | 'tutto') => {
    const today = new Date();
    let start = '';
    let end = '';

    switch (preset) {
      case 'questo-mese': {
        start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
        break;
      }
      case 'mese-scorso': {
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
        end = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);
        break;
      }
      case 'quest-anno': {
        start = `${today.getFullYear()}-01-01`;
        end = `${today.getFullYear()}-12-31`;
        break;
      }
      case 'ultimi-3-mesi': {
        start = new Date(today.getFullYear(), today.getMonth() - 2, 1).toISOString().slice(0, 10);
        end = today.toISOString().slice(0, 10);
        break;
      }
      case 'tutto': {
        start = '';
        end = '';
        break;
      }
    }

    setAssetRange({ start, end });
  };

  const handleDeleteAssetDirect = (assetId: string) => {
    const targetAsset = assets.find((a) => a.id === assetId);
    if (!targetAsset) return;
    const relatedCount = assetTransactions.filter((tx) => tx.assetId === assetId).length;

    askConfirmation({
      title: 'Elimina Asset / Investimento',
      subtitle: targetAsset.name,
      message: `Sei sicuro di voler eliminare l'asset "${targetAsset.name}"? L'operazione cancellerà la posizione dal portafoglio e rimuoverà ${relatedCount} movimenti storici collegati.`,
      itemDetails: [
        { label: 'Asset', value: targetAsset.name },
        { label: 'Tipologia', value: formatAssetKindLabel(targetAsset.kind) },
        { label: 'Istituto', value: targetAsset.institution },
        { label: 'Operazioni collegate', value: `${relatedCount}` },
      ],
      confirmLabel: 'Elimina asset',
      onConfirm: () => {
        setAssets((currentAssets) => currentAssets.filter((a) => a.id !== assetId));
        setAssetTransactions((prev) => prev.filter((tx) => tx.assetId !== assetId));
        if (selectedAssetIdForDetails === assetId) {
          setSelectedAssetIdForDetails(null);
        }
        setStatusMessage(`Asset eliminato: ${targetAsset.name}.`);
      },
    });
  };

  const categoryOptions = Array.from(
    new Set([
      ...budgetCategories.map((category) => category.name),
      'Trasferimento',
      'Spesa alimentare',
      'Trasporti',
      'Ristoranti',
      'Casa',
      'Utenze',
      'Salute',
      'Tempo libero',
      'Shopping',
      'Altro',
    ])
  ).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));

  const subcategoryOptions = Array.from(
    new Set([
      ...budgetCategories.flatMap((category) => category.subcategories.map((subcategory) => subcategory.name)),
      'Giroconto',
      'Versamento',
      'Prelievo',
      'Investimento',
      'Conto Deposito',
    ]),
  ).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));

  const accountOptions = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.account) set.add(tx.account);
    });
    Object.keys(accountInitialCapitals).forEach((acc) => {
      if (acc) set.add(acc);
    });
    if (set.size === 0) {
      set.add('Conto principale');
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }, [transactions, accountInitialCapitals]);

  const categoryRows = useMemo(() => {
    return budgetCategories.map((category) => {
      const resolvedLimit = category.limitType === 'percentage'
        ? (totalMonthIncome * (category.limitPercent || 0)) / 100
        : category.limit;

      const actualSpent = currentMonthExpenseTransactions
        .filter((transaction) => transaction.category === category.name)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

      const expectedSpent = currentMonthUpcomingRecurringExpenses
        .filter((tx) => tx.category === category.name)
        .reduce((sum, tx) => sum + tx.amount, 0);

      const totalProjectedSpent = actualSpent + expectedSpent;
      const remaining = resolvedLimit - totalProjectedSpent;
      const ratio = resolvedLimit > 0 ? Math.min((totalProjectedSpent / resolvedLimit) * 100, 100) : 0;

      const subcategories = category.subcategories.map((subcategory) => {
        const resolvedSubLimit = subcategory.limitType === 'percentage'
          ? (totalMonthIncome * (subcategory.limitPercent || 0)) / 100
          : subcategory.limit;

        const subcategoryActualSpent = currentMonthExpenseTransactions
          .filter((transaction) => transaction.category === category.name && transaction.subcategory === subcategory.name)
          .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);

        const subcategoryExpectedSpent = currentMonthUpcomingRecurringExpenses
          .filter((tx) => tx.category === category.name && tx.subcategory === subcategory.name)
          .reduce((sum, tx) => sum + tx.amount, 0);

        const subcategoryTotalProjected = subcategoryActualSpent + subcategoryExpectedSpent;
        const subcategoryRemaining = resolvedSubLimit - subcategoryTotalProjected;
        const subcategoryRatio = resolvedSubLimit > 0 ? Math.min((subcategoryTotalProjected / resolvedSubLimit) * 100, 100) : 0;

        return {
          ...subcategory,
          limit: resolvedSubLimit,
          actualSpent: subcategoryActualSpent,
          expectedSpent: subcategoryExpectedSpent,
          spent: subcategoryTotalProjected,
          remaining: subcategoryRemaining,
          ratio: subcategoryRatio,
        };
      });

      return {
        ...category,
        limit: resolvedLimit,
        actualSpent,
        expectedSpent,
        spent: totalProjectedSpent,
        remaining,
        ratio,
        subcategories,
      };
    });
  }, [budgetCategories, currentMonthExpenseTransactions, currentMonthUpcomingRecurringExpenses, totalMonthIncome]);

  const sortedCategoryRows = useMemo(() => {
    const rows = [...categoryRows];
    rows.sort((a, b) => {
      let comp = 0;
      if (budgetSortCriteria === 'name') {
        comp = a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
      } else if (budgetSortCriteria === 'spent') {
        comp = a.spent - b.spent;
      } else if (budgetSortCriteria === 'limit') {
        comp = a.limit - b.limit;
      } else if (budgetSortCriteria === 'remaining') {
        comp = a.remaining - b.remaining;
      }
      return budgetSortOrder === 'asc' ? comp : -comp;
    });
    return rows;
  }, [categoryRows, budgetSortCriteria, budgetSortOrder]);

  const currentYear = new Date().getFullYear();

  const currentYearMonthlyData = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonthIndex = today.getMonth(); // 0-11
    
    const italianMonths = [
      'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
      'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'
    ];

    // Solamente i mesi trascorsi e quello in corso
    const monthsToShow = italianMonths.slice(0, currentMonthIndex + 1);

    return monthsToShow.map((label, index) => {
      const prefix = `${currentYear}-${String(index + 1).padStart(2, '0')}`;
      const monthTx = transactions.filter((tx) => tx.date.startsWith(prefix));

      const expenses = monthTx
        .filter((tx) => tx.kind === 'expense' && !isTransferCategory(tx.category, tx.subcategory))
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

      const income = monthTx
        .filter((tx) => tx.kind === 'income' && !isTransferCategory(tx.category, tx.subcategory))
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

      return {
        label,
        expenses,
        income,
      };
    });
  }, [transactions]);

  const currentMonthSavings = useMemo(() => {
    const incomes = currentMonthIncomeTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const expenses = currentMonthExpenseTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    return incomes - expenses;
  }, [currentMonthIncomeTransactions, currentMonthExpenseTransactions]);

  const previousMonthNetFlow = useMemo(() => {
    const today = new Date();
    const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevYear = prevMonthDate.getFullYear();
    const prevMonth = prevMonthDate.getMonth(); // 0-11
    
    const prevYearStr = String(prevYear);
    const prevMonthStr = String(prevMonth + 1).padStart(2, '0');
    const yearMonthPrefix = `${prevYearStr}-${prevMonthStr}`;
    
    const prevMonthTxs = transactions.filter(
      (tx) => tx.date.startsWith(yearMonthPrefix) && tx.date >= openingDate
    );
    const incomes = prevMonthTxs
      .filter((tx) => tx.kind === 'income' && !isTransferCategory(tx.category, tx.subcategory))
      .reduce((sum, tx) => sum + tx.amount, 0);
    const expenses = prevMonthTxs
      .filter((tx) => tx.kind === 'expense' && !isTransferCategory(tx.category, tx.subcategory))
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    return incomes - expenses;
  }, [transactions, openingDate]);

  const dashboardCards = [
    {
      label: 'Liquidità disponibile',
      value: formatEuro(cashAvailable),
      delta: `Flusso netto: ${formatSignedEuro(netFlow)} rispetto alla base iniziale`,
    },
    {
      label: 'Saldo previsto a fine mese',
      value: formatEuro(projectedEndBalance),
      delta: 'Stima costruita su uscite ricorrenti e movimenti attesi',
    },
    {
      label: 'Risparmio del mese',
      value: formatEuro(currentMonthSavings),
      delta: `Mese prec: ${formatSignedEuro(previousMonthNetFlow)}`,
      subValue: (
        <span style={{ fontSize: '0.73rem', color: 'var(--muted)' }}>
          Differenza: <strong style={{ color: currentMonthSavings - previousMonthNetFlow >= 0 ? '#10b981' : '#f43f5e' }}>{formatSignedEuro(currentMonthSavings - previousMonthNetFlow)}</strong>
        </span>
      ),
    },
    {
      label: 'Patrimonio netto',
      value: formatEuro(currentNetWorth),
      delta: 'Aggiornato in base al flusso netto corrente e al portafoglio asset',
    },
  ];

  const reportExpenseTotal = reportExpenseTransactions.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const reportIncomeTotal = reportIncomeTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const reportNetFlow = reportIncomeTotal - reportExpenseTotal;
  const recentTransactions = filteredTransactions.slice(0, 6);
  const monthlySavings = Math.max(netFlow, 0);

  useEffect(() => {
    setSelectedTransactionIds((currentSelected) =>
      currentSelected.filter((id) => transactions.some((transaction) => transaction.id === id)),
    );
  }, [transactions]);

  const handleAddRecurringTransaction = (e: FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(recurringDraft.amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      setStatusMessage('Inserisci un importo valido maggiore di zero.');
      return;
    }
    if (!recurringDraft.merchant.trim()) {
      setStatusMessage('Inserisci un nome o esercente.');
      return;
    }

    if (editingRecurringId) {
      setRecurringTransactions((prev) =>
        prev.map((tx) =>
          tx.id === editingRecurringId
            ? {
                ...tx,
                merchant: recurringDraft.merchant.trim(),
                amount: amountVal,
                kind: recurringDraft.kind,
                category: recurringDraft.category || (recurringDraft.kind === 'income' ? 'Entrate' : 'Altro'),
                subcategory: recurringDraft.subcategory.trim(),
                account: recurringDraft.account.trim() || 'Conto principale',
                frequency: recurringDraft.frequency,
                dayOfMonth: recurringDraft.frequency === 'monthly' ? parseInt(recurringDraft.dayOfMonth, 10) : undefined,
                dayOfWeek: recurringDraft.frequency === 'weekly' ? parseInt(recurringDraft.dayOfWeek, 10) : undefined,
                intervalDays: recurringDraft.frequency === 'custom_days' ? parseInt(recurringDraft.intervalDays, 10) : undefined,
                startDate: recurringDraft.startDate || getTodayIso(),
                note: recurringDraft.note.trim(),
                autoPost: recurringDraft.autoPost,
              }
            : tx
        )
      );
      setEditingRecurringId(null);
      setRecurringDraft({
        merchant: '',
        amount: '',
        kind: 'expense',
        category: '',
        subcategory: '',
        account: '',
        frequency: 'monthly',
        dayOfMonth: '1',
        dayOfWeek: '1',
        intervalDays: '15',
        startDate: getTodayIso(),
        note: '',
        autoPost: false,
      });
      setStatusMessage('Transazione ricorrente aggiornata con successo!');
    } else {
      const newRec: RecurringTransaction = {
        id: `recurring-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        merchant: recurringDraft.merchant.trim(),
        amount: amountVal,
        kind: recurringDraft.kind,
        category: recurringDraft.category || (recurringDraft.kind === 'income' ? 'Entrate' : 'Altro'),
        subcategory: recurringDraft.subcategory.trim(),
        account: recurringDraft.account.trim() || 'Conto principale',
        frequency: recurringDraft.frequency,
        dayOfMonth: recurringDraft.frequency === 'monthly' ? parseInt(recurringDraft.dayOfMonth, 10) : undefined,
        dayOfWeek: recurringDraft.frequency === 'weekly' ? parseInt(recurringDraft.dayOfWeek, 10) : undefined,
        intervalDays: recurringDraft.frequency === 'custom_days' ? parseInt(recurringDraft.intervalDays, 10) : undefined,
        startDate: recurringDraft.startDate || getTodayIso(),
        note: recurringDraft.note.trim(),
        isActive: true,
        createdAt: Date.now(),
        autoPost: recurringDraft.autoPost,
      };

      setRecurringTransactions((prev) => [newRec, ...prev]);
      setRecurringDraft({
        merchant: '',
        amount: '',
        kind: 'expense',
        category: '',
        subcategory: '',
        account: '',
        frequency: 'monthly',
        dayOfMonth: '1',
        dayOfWeek: '1',
        intervalDays: '15',
        startDate: getTodayIso(),
        note: '',
        autoPost: false,
      });
      setStatusMessage(`Transazione ricorrente "${newRec.merchant}" creata con successo!`);
    }
  };

  const handleEditRecurringTransaction = (tx: RecurringTransaction) => {
    setEditingRecurringId(tx.id);
    setRecurringDraft({
      merchant: tx.merchant,
      amount: String(tx.amount),
      kind: tx.kind,
      category: tx.category,
      subcategory: tx.subcategory,
      account: tx.account,
      frequency: tx.frequency,
      dayOfMonth: String(tx.dayOfMonth || '1'),
      dayOfWeek: String(tx.dayOfWeek !== undefined ? tx.dayOfWeek : '1'),
      intervalDays: String(tx.intervalDays || '15'),
      startDate: tx.startDate,
      note: tx.note,
      autoPost: !!tx.autoPost,
    });
  };

  const handleCancelEditRecurringTransaction = () => {
    setEditingRecurringId(null);
    setRecurringDraft({
      merchant: '',
      amount: '',
      kind: 'expense',
      category: '',
      subcategory: '',
      account: '',
      frequency: 'monthly',
      dayOfMonth: '1',
      dayOfWeek: '1',
      intervalDays: '15',
      startDate: getTodayIso(),
      note: '',
      autoPost: false,
    });
  };

  const handleDeleteRecurringTransaction = (id: string) => {
    const target = recurringTransactions.find((tx) => tx.id === id);
    const merchant = target ? target.merchant : 'questa transazione ricorrente';

    askConfirmation({
      title: 'Elimina transazione ricorrente',
      subtitle: merchant,
      message: `Sei sicuro di voler eliminare la transazione ricorrente "${merchant}"? I movimenti futuri non verranno più generati o proiettati nelle scadenze.`,
      itemDetails: target ? [
        { label: 'Esercente / Voce', value: target.merchant },
        { label: 'Importo', value: formatEuro(target.amount) },
        { label: 'Frequenza', value: target.frequency },
        { label: 'Giorno addebito', value: `Giorno ${target.dayOfMonth}` },
      ] : undefined,
      confirmLabel: 'Elimina ricorrente',
      onConfirm: () => {
        if (editingRecurringId === id) {
          handleCancelEditRecurringTransaction();
        }
        setRecurringTransactions((prev) => prev.filter((tx) => tx.id !== id));
        setStatusMessage(`Transazione ricorrente "${merchant}" eliminata.`);
      },
    });
  };

  const handleToggleRecurringTransaction = (id: string) => {
    setRecurringTransactions((prev) =>
      prev.map((tx) => (tx.id === id ? { ...tx, isActive: !tx.isActive } : tx))
    );
    setStatusMessage('Stato transazione ricorrente modificato.');
  };

  const handleAddPAC = (e: FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(pacDraft.amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      setStatusMessage('Inserisci un importo PAC valido maggiore di zero.');
      return;
    }
    if (!pacDraft.name.trim()) {
      setStatusMessage('Inserisci un nome per il piano di accumulo.');
      return;
    }
    if (!pacDraft.assetId) {
      setStatusMessage('Seleziona un asset valido da associare al PAC.');
      return;
    }

    if (editingPacId) {
      setPianiAccumulo((prev) =>
        prev.map((p) =>
          p.id === editingPacId
            ? {
                ...p,
                name: pacDraft.name.trim(),
                assetId: pacDraft.assetId,
                amount: amountVal,
                dayOfMonth: parseInt(pacDraft.dayOfMonth, 10) || 1,
                startDate: pacDraft.startDate || getTodayIso(),
                account: pacDraft.account,
                category: pacDraft.category || 'Investimenti',
                subcategory: pacDraft.subcategory || 'PAC',
                autoPost: pacDraft.autoPost,
                createAssetTransaction: pacDraft.createAssetTransaction,
              }
            : p
        )
      );
      setEditingPacId(null);
      setPacDraft({
        name: '',
        assetId: '',
        amount: '',
        dayOfMonth: '1',
        startDate: getTodayIso(),
        account: '',
        category: 'Investimenti',
        subcategory: 'PAC',
        autoPost: true,
        createAssetTransaction: true,
      });
      setStatusMessage(`Piano di accumulo (PAC) aggiornato con successo!`);
    } else {
      const newPac: PAC = {
        id: `pac-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: pacDraft.name.trim(),
        assetId: pacDraft.assetId,
        amount: amountVal,
        dayOfMonth: parseInt(pacDraft.dayOfMonth, 10) || 1,
        startDate: pacDraft.startDate || getTodayIso(),
        isActive: true,
        createdAt: Date.now(),
        account: pacDraft.account,
        category: pacDraft.category || 'Investimenti',
        subcategory: pacDraft.subcategory || 'PAC',
        autoPost: pacDraft.autoPost !== false,
        createAssetTransaction: pacDraft.createAssetTransaction !== false,
      };

      setPianiAccumulo((prev) => [newPac, ...prev]);
      setPacDraft({
        name: '',
        assetId: '',
        amount: '',
        dayOfMonth: '1',
        startDate: getTodayIso(),
        account: '',
        category: 'Investimenti',
        subcategory: 'PAC',
        autoPost: true,
        createAssetTransaction: true,
      });
      setStatusMessage(`Piano di accumulo (PAC) "${newPac.name}" programmato con successo!`);
    }
  };

  const handleEditPAC = (pac: PAC) => {
    setEditingPacId(pac.id);
    setPacDraft({
      name: pac.name,
      assetId: pac.assetId,
      amount: String(pac.amount),
      dayOfMonth: String(pac.dayOfMonth),
      startDate: pac.startDate,
      account: pac.account || '',
      category: pac.category || 'Investimenti',
      subcategory: pac.subcategory || 'PAC',
      autoPost: pac.autoPost !== false,
      createAssetTransaction: pac.createAssetTransaction !== false,
    });
  };

  const handleCancelEditPAC = () => {
    setEditingPacId(null);
    setPacDraft({
      name: '',
      assetId: '',
      amount: '',
      dayOfMonth: '1',
      startDate: getTodayIso(),
      account: '',
      category: 'Investimenti',
      subcategory: 'PAC',
      autoPost: true,
      createAssetTransaction: true,
    });
  };

  const handleDeletePAC = (id: string) => {
    const target = pianiAccumulo.find((p) => p.id === id);
    const pacName = target ? target.name : 'questo piano di accumulo';

    askConfirmation({
      title: 'Elimina Piano di Accumulo (PAC)',
      subtitle: pacName,
      message: `Sei sicuro di voler eliminare il piano di accumulo "${pacName}"? I versamenti futuri programmati non verranno più eseguiti.`,
      itemDetails: target ? [
        { label: 'Nome PAC', value: target.name },
        { label: 'Rata periodica', value: formatEuro(target.amount) },
        { label: 'Giorno addebito', value: `Giorno ${target.dayOfMonth}` },
      ] : undefined,
      confirmLabel: 'Elimina PAC',
      onConfirm: () => {
        if (editingPacId === id) {
          handleCancelEditPAC();
        }
        setPianiAccumulo((prev) => prev.filter((p) => p.id !== id));
        setStatusMessage(`Piano di accumulo (PAC) "${pacName}" rimosso.`);
      },
    });
  };

  const handleTogglePAC = (id: string) => {
    setPianiAccumulo((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p))
    );
    setStatusMessage('Stato piano di accumulo (PAC) modificato.');
  };

  const handleTogglePACAutoPost = (id: string) => {
    setPianiAccumulo((prev) =>
      prev.map((p) => (p.id === id ? { ...p, autoPost: p.autoPost === false ? true : false } : p))
    );
    setStatusMessage('Impostazione inserimento automatico PAC aggiornata.');
  };

  const handlePostPACManual = (pac: PAC) => {
    const todayStr = getTodayIso();
    const targetAsset = assets.find((a) => a.id === pac.assetId);
    const debitAccount = pac.account || (targetAsset ? targetAsset.institution : '') || 'Conto principale';

    const newTx: Transaction = {
      id: createTransactionId(),
      createdAt: Date.now(),
      date: todayStr,
      merchant: `PAC: ${pac.name}`,
      category: pac.category || 'Investimenti',
      subcategory: pac.subcategory || 'PAC',
      account: debitAccount,
      amount: pac.amount,
      kind: 'expense',
      note: `Versamento manuale PAC (${pac.name}) su ${targetAsset ? targetAsset.name : 'Asset'}`,
    };

    const newAssetTxs: AssetTransaction[] = [];
    if (targetAsset && pac.createAssetTransaction !== false) {
      const unitPrice = targetAsset.unitValue > 0 ? targetAsset.unitValue : pac.amount;
      const qty = targetAsset.unitValue > 0 ? +(pac.amount / targetAsset.unitValue).toFixed(6) : 1;
      const newAssetTx: AssetTransaction = {
        id: createTransactionId(),
        assetId: targetAsset.id,
        date: todayStr,
        kind: 'buy',
        quantity: qty,
        unitValue: unitPrice,
        note: `Acquisto manuale PAC: ${pac.name}`,
        createdAt: Date.now(),
      };
      newAssetTxs.push(newAssetTx);
    }

    setTransactions((prev) => [newTx, ...prev]);
    if (newAssetTxs.length > 0) {
      setAssetTransactions((prev) => [...prev, ...newAssetTxs]);
    }
    setPianiAccumulo((prev) =>
      prev.map((p) => (p.id === pac.id ? { ...p, lastPostedDate: todayStr } : p))
    );
    setStatusMessage(`Rata PAC "${pac.name}" di ${formatEuro(pac.amount)} registrata per la data di oggi!`);
  };

  const handleAddCashbackRule = (ruleData: Omit<CashbackRule, 'id' | 'createdAt'>, newAsset?: NewAssetPayload) => {
    let finalAssetId = ruleData.assetId;
    if (newAsset) {
      const createdAssetId = createTransactionId();
      const createdAsset: Asset = {
        id: createdAssetId,
        name: newAsset.name.trim(),
        kind: newAsset.kind,
        institution: newAsset.institution.trim() || ruleData.account,
        quantity: 0,
        unitValue: Number(newAsset.unitValue) || 1,
        note: 'Creato da regola Cashback / Saveback',
        createdAt: Date.now(),
        ticker: newAsset.ticker?.trim().toUpperCase(),
      };
      setAssets((prev) => [...prev, createdAsset]);
      finalAssetId = createdAssetId;
    }

    const newRule: CashbackRule = {
      ...ruleData,
      id: createTransactionId(),
      assetId: finalAssetId,
      createdAt: Date.now(),
    };
    setCashbackRules((prev) => [...prev, newRule]);
    setStatusMessage(`Regola cashback "${newRule.name}" salvata con successo!`);
  };

  const handleUpdateCashbackRule = (id: string, updates: Partial<CashbackRule>, newAsset?: NewAssetPayload) => {
    let finalAssetId = updates.assetId;
    if (newAsset) {
      const createdAssetId = createTransactionId();
      const createdAsset: Asset = {
        id: createdAssetId,
        name: newAsset.name.trim(),
        kind: newAsset.kind,
        institution: newAsset.institution.trim() || (updates.account || 'Conto'),
        quantity: 0,
        unitValue: Number(newAsset.unitValue) || 1,
        note: 'Creato da regola Cashback / Saveback',
        createdAt: Date.now(),
        ticker: newAsset.ticker?.trim().toUpperCase(),
      };
      setAssets((prev) => [...prev, createdAsset]);
      finalAssetId = createdAssetId;
    }

    setCashbackRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates, ...(finalAssetId ? { assetId: finalAssetId } : {}) } : r))
    );
    setStatusMessage('Regola cashback aggiornata con successo.');
  };

  const handleDeleteCashbackRule = (id: string) => {
    setCashbackRules((prev) => prev.filter((r) => r.id !== id));
    setStatusMessage('Regola cashback rimossa.');
  };

  const handleToggleCashbackRule = (id: string) => {
    setCashbackRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isActive: !r.isActive } : r))
    );
    setStatusMessage('Stato della regola cashback aggiornato.');
  };

  const handleExecuteCashback = (rule: CashbackRule, amount: number, qualifyingSpent: number) => {
    const todayStr = getTodayIso();
    const targetAsset = rule.destination === 'asset' && rule.assetId ? assets.find((a) => a.id === rule.assetId) : undefined;

    if (rule.destination === 'asset') {
      // 1. Accredit the cashback as an income on rule.account
      const incomeTx: Transaction = {
        id: createTransactionId(),
        createdAt: Date.now(),
        date: todayStr,
        merchant: `Cashback maturato: ${rule.name}`,
        category: 'Entrate',
        subcategory: 'Cashback',
        account: rule.account,
        amount: amount,
        kind: 'income',
        note: `Saveback maturato (${rule.percentage}% su spese di ${formatEuro(qualifyingSpent)}) su ${rule.account}`,
      };

      // 2. Invest it in target asset (creates an expense/investment from rule.account)
      const investTx: Transaction = {
        id: createTransactionId(),
        createdAt: Date.now() + 1,
        date: todayStr,
        merchant: `Investimento Saveback: ${targetAsset ? targetAsset.name : rule.name}`,
        category: 'Investimenti',
        subcategory: 'Saveback',
        account: rule.account,
        amount: amount,
        kind: 'expense',
        note: `Acquisto quote con Saveback ${rule.percentage}% in ${targetAsset ? targetAsset.name : 'Asset'}`,
      };

      // 3. Asset transaction (buy quote)
      if (targetAsset) {
        const unitPrice = targetAsset.unitValue > 0 ? targetAsset.unitValue : amount;
        const qty = targetAsset.unitValue > 0 ? +(amount / targetAsset.unitValue).toFixed(6) : 1;
        const newAssetTx: AssetTransaction = {
          id: createTransactionId(),
          assetId: targetAsset.id,
          date: todayStr,
          kind: 'buy',
          quantity: qty,
          unitValue: unitPrice,
          note: `Saveback ${rule.name}: accredito e acquisto quote`,
          createdAt: Date.now(),
        };
        setAssetTransactions((prev) => [...prev, newAssetTx]);
        setAssets((prev) =>
          prev.map((a) => (a.id === targetAsset.id ? { ...a, quantity: +(a.quantity + qty).toFixed(6) } : a))
        );
      }

      setTransactions((prev) => [investTx, incomeTx, ...prev]);
      setCashbackRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, lastInvestedDate: todayStr } : r))
      );
      setStatusMessage(
        `Saveback di ${formatEuro(amount)} accreditato e investito con successo in ${targetAsset ? targetAsset.name : 'asset'}!`
      );
    } else {
      // Cash destination: direct credit on account
      const incomeTx: Transaction = {
        id: createTransactionId(),
        createdAt: Date.now(),
        date: todayStr,
        merchant: `Cashback: ${rule.name}`,
        category: 'Entrate',
        subcategory: 'Cashback',
        account: rule.account,
        amount: amount,
        kind: 'income',
        note: `Accredito cashback ${rule.percentage}% su spese di ${formatEuro(qualifyingSpent)}`,
      };

      setTransactions((prev) => [incomeTx, ...prev]);
      setCashbackRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, lastInvestedDate: todayStr } : r))
      );
      setStatusMessage(`Cashback di ${formatEuro(amount)} accreditato sul conto "${rule.account}".`);
    }
  };

  const startNewTransaction = () => {
    setEditorMode('create');
    setEditingTransactionId(null);
    setDraft(defaultDraft());
    setActiveSection('transazioni');
    setStatusMessage('Nuova transazione pronta per l’inserimento.');
  };

  const openEditTransaction = (transaction: Transaction) => {
    setEditorMode('edit');
    setEditingTransactionId(transaction.id);
    const isReimb = Boolean(transaction.reimbursesTransactionId);
    setDraft({
      date: transaction.date,
      merchant: transaction.merchant,
      category: transaction.category,
      subcategory: transaction.subcategory,
      account: transaction.account,
      amount: Math.abs(transaction.amount).toFixed(2),
      kind: transaction.kind,
      note: transaction.note,
      needsReimbursement: Boolean(transaction.needsReimbursement),
      reimbursementDueDate: transaction.reimbursementDueDate || '',
      isReimbursement: isReimb,
      reimbursesTransactionId: transaction.reimbursesTransactionId || '',
    });
    setActiveSection('transazioni');
    setStatusMessage(`Modifica aperta per ${transaction.merchant}.`);
  };

  const handleStartReimbursementForExpense = (expense: Transaction) => {
    const alreadyReimbursed = transactions
      .filter((t) => t.kind === 'income' && t.reimbursesTransactionId === expense.id)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const remaining = Math.max(0, Math.abs(expense.amount) - alreadyReimbursed);

    setEditorMode('create');
    setEditingTransactionId(null);
    setDraft({
      date: getTodayIso(),
      merchant: `Rimborso da ${expense.merchant}`,
      category: expense.category || 'Entrate',
      subcategory: expense.subcategory || '',
      account: expense.account || accountOptions[0] || 'Conto principale',
      amount: (remaining > 0 ? remaining : Math.abs(expense.amount)).toFixed(2),
      kind: 'income',
      note: `Rimborso per la spesa "${expense.merchant}" del ${formatDisplayDate(expense.date)}`,
      needsReimbursement: false,
      reimbursementDueDate: '',
      isReimbursement: true,
      reimbursesTransactionId: expense.id,
    });
    setActiveSection('transazioni');
    setStatusMessage(`Modulo pronto per registrare il rimborso di "${expense.merchant}".`);
  };

  const handleUpdateReimbursementDueDate = (expenseId: string, newDueDate: string) => {
    setTransactions((prev) =>
      prev.map((tx) => (tx.id === expenseId ? { ...tx, reimbursementDueDate: newDueDate } : tx))
    );
    setStatusMessage(`Scadenza rimborso aggiornata: ${newDueDate ? formatDisplayDate(newDueDate) : 'rimossa'}.`);
  };

  const handleAddSubscription = (subData: Omit<Subscription, 'id' | 'createdAt'>) => {
    const newSub: Subscription = {
      ...subData,
      id: `sub-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      createdAt: Date.now(),
    };
    setSubscriptions((prev) => [newSub, ...prev]);
    setStatusMessage(`Abbonamento "${newSub.name}" aggiunto con successo.`);
  };

  const handleUpdateSubscription = (id: string, updates: Partial<Subscription>) => {
    setSubscriptions((prev) =>
      prev.map((sub) => (sub.id === id ? { ...sub, ...updates } : sub))
    );
    setStatusMessage('Abbonamento aggiornato.');
  };

  const handleDeleteSubscription = (id: string) => {
    const target = subscriptions.find((sub) => sub.id === id);
    const name = target ? target.name : 'questo abbonamento';

    askConfirmation({
      title: 'Elimina abbonamento',
      subtitle: name,
      message: `Sei sicuro di voler eliminare l'abbonamento "${name}"? I futuri rinnovi periodici non verranno più monitorati.`,
      itemDetails: target ? [
        { label: 'Servizio', value: target.name },
        { label: 'Costo', value: formatEuro(target.amount) },
        { label: 'Frequenza', value: target.frequency },
      ] : undefined,
      confirmLabel: 'Elimina abbonamento',
      onConfirm: () => {
        setSubscriptions((prev) => prev.filter((sub) => sub.id !== id));
        setStatusMessage(`Abbonamento "${name}" eliminato.`);
      },
    });
  };

  const handleRecordTransactionForSubscription = (sub: Subscription) => {
    const newTx: Transaction = {
      id: createTransactionId(),
      date: getTodayIso(),
      merchant: sub.name,
      category: sub.category || 'Abbonamenti',
      subcategory: 'Abbonamento',
      account: sub.account || accountOptions[0] || 'Conto principale',
      amount: -Math.abs(sub.amount),
      kind: 'expense',
      note: `Rinnovo ${sub.name} (${sub.frequency})`,
      createdAt: Date.now(),
    };

    upsertTransaction(newTx);

    const curDate = new Date(sub.nextRenewalDate || getTodayIso());
    if (sub.frequency === 'yearly') {
      curDate.setFullYear(curDate.getFullYear() + 1);
    } else if (sub.frequency === 'quarterly') {
      curDate.setMonth(curDate.getMonth() + 3);
    } else if (sub.frequency === 'semiannual') {
      curDate.setMonth(curDate.getMonth() + 6);
    } else {
      curDate.setMonth(curDate.getMonth() + 1);
    }
    const nextDateStr = curDate.toISOString().slice(0, 10);

    handleUpdateSubscription(sub.id, { nextRenewalDate: nextDateStr });
    setStatusMessage(`Registrata spesa per "${sub.name}" (${formatEuro(sub.amount)}). Prossimo rinnovo al ${formatDisplayDate(nextDateStr)}.`);
  };

  const resetEditor = () => {
    setEditorMode('create');
    setEditingTransactionId(null);
    setDraft(defaultDraft());
    setStatusMessage('Modulo transazione svuotato.');
  };

  const updateDraft = <K extends keyof TransactionDraft>(field: K, value: TransactionDraft[K]) => {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
  };

  const upsertTransaction = (nextTransaction: Transaction) => {
    setTransactions((currentTransactions) => {
      const existingIndex = currentTransactions.findIndex((transaction) => transaction.id === nextTransaction.id);
      setTransactionOrder((currentOrder) => (currentOrder.includes(nextTransaction.id) ? currentOrder : [nextTransaction.id, ...currentOrder]));

      if (existingIndex >= 0) {
        const nextTransactions = [...currentTransactions];
        nextTransactions[existingIndex] = nextTransaction;
        return nextTransactions.sort((left, right) => right.createdAt - left.createdAt);
      }

      return [nextTransaction, ...currentTransactions].sort((left, right) => right.createdAt - left.createdAt);
    });
  };

  const deleteTransaction = () => {
    if (!editingTransaction) {
      return;
    }
    const targetTransaction = editingTransaction;

    askConfirmation({
      title: 'Elimina transazione',
      subtitle: targetTransaction.merchant,
      message: `Sei sicuro di voler eliminare la transazione "${targetTransaction.merchant}"? L'operazione rimuoverà il movimento dal registro e ricalcolerà i totali.`,
      itemDetails: [
        { label: 'Esercente', value: targetTransaction.merchant },
        { label: 'Importo', value: formatEuro(targetTransaction.amount) },
        { label: 'Data', value: targetTransaction.date },
        { label: 'Conto', value: targetTransaction.account },
      ],
      confirmLabel: 'Elimina transazione',
      onConfirm: () => {
        setTransactions((currentTransactions) => currentTransactions.filter((transaction) => transaction.id !== targetTransaction.id));
        setTransactionOrder((currentOrder) => currentOrder.filter((id) => id !== targetTransaction.id));
        resetEditor();
        setStatusMessage(`Transazione eliminata: ${targetTransaction.merchant}. (salvato automaticamente)`);
      },
    });
  };

  const handleDeleteSpecificTransaction = (id: string, merchant: string) => {
    const targetTransaction = transactions.find((t) => t.id === id);

    askConfirmation({
      title: 'Elimina transazione',
      subtitle: merchant,
      message: `Sei sicuro di voler eliminare la transazione "${merchant}"? L'operazione rimuoverà il movimento dal registro.`,
      itemDetails: targetTransaction ? [
        { label: 'Esercente', value: targetTransaction.merchant },
        { label: 'Importo', value: formatEuro(targetTransaction.amount) },
        { label: 'Data', value: targetTransaction.date },
        { label: 'Conto', value: targetTransaction.account },
      ] : undefined,
      confirmLabel: 'Elimina transazione',
      onConfirm: () => {
        setTransactions((currentTransactions) => currentTransactions.filter((transaction) => transaction.id !== id));
        setTransactionOrder((currentOrder) => currentOrder.filter((itemId) => itemId !== id));
        if (editingTransactionId === id) {
          resetEditor();
        }
        setStatusMessage(`Transazione eliminata: ${merchant}. (salvato automaticamente)`);
      },
    });
  };

  const bulkDeleteTransactions = () => {
    if (!selectedTransactionIds.length) {
      setStatusMessage('Seleziona almeno una transazione da eliminare.');
      return;
    }

    const count = selectedTransactionIds.length;
    const sum = selectedTransactions.reduce((acc, t) => acc + t.amount, 0);

    askConfirmation({
      title: 'Elimina transazioni selezionate',
      subtitle: `${count} movimenti selezionati`,
      message: `Sei sicuro di voler eliminare definitivamente le ${count} transazioni selezionate? Questa operazione non può essere annullata.`,
      itemDetails: [
        { label: 'Movimenti selezionati', value: `${count}` },
        { label: 'Saldo totale elementi', value: formatEuro(sum) },
      ],
      confirmLabel: `Elimina ${count} transazioni`,
      onConfirm: () => {
        setTransactions((currentTransactions) =>
          currentTransactions.filter((transaction) => !selectedTransactionIds.includes(transaction.id))
        );
        setTransactionOrder((currentOrder) =>
          currentOrder.filter((id) => !selectedTransactionIds.includes(id))
        );
        clearTransactionSelection();
        setStatusMessage(`Eliminate con successo ${count} transazioni. (salvato automaticamente)`);
      },
    });
  };

  const toggleTransactionSelection = (transactionId: string) => {
    setSelectedTransactionIds((currentSelected) =>
      currentSelected.includes(transactionId)
        ? currentSelected.filter((id) => id !== transactionId)
        : [...currentSelected, transactionId],
    );
  };

  const toggleAllFilteredTransactions = () => {
    setSelectedTransactionIds((currentSelected) => {
      if (allFilteredSelected) {
        const filteredIds = new Set(filteredTransactions.map((transaction) => transaction.id));
        return currentSelected.filter((id) => !filteredIds.has(id));
      }

      return Array.from(new Set([...currentSelected, ...filteredTransactions.map((transaction) => transaction.id)]));
    });
  };

  const clearTransactionSelection = () => {
    setSelectedTransactionIds([]);
  };

  const moveTransactionInOrder = (transactionId: string, direction: -1 | 1) => {
    setTransactionOrder((currentOrder) => {
      const currentIndex = currentOrder.indexOf(transactionId);

      if (currentIndex < 0) {
        return currentOrder;
      }

      const nextIndex = currentIndex + direction;

      if (nextIndex < 0 || nextIndex >= currentOrder.length) {
        return currentOrder;
      }

      const nextOrder = [...currentOrder];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
      return nextOrder;
    });
  };

  const applyBulkUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedTransactionIds.length) {
      setStatusMessage('Seleziona almeno una transazione da modificare in blocco.');
      return;
    }

    setTransactions((currentTransactions) =>
      currentTransactions.map((transaction) => {
        if (!selectedTransactionIds.includes(transaction.id)) {
          return transaction;
        }

        const nextAmount = bulkDraft.kind ? Math.abs(transaction.amount) * (bulkDraft.kind === 'expense' ? -1 : 1) : transaction.amount;

        return {
          ...transaction,
          date: bulkDraft.date || transaction.date,
          category: bulkDraft.category.trim() || transaction.category,
          subcategory: bulkDraft.subcategory.trim() || transaction.subcategory,
          account: bulkDraft.account.trim() || transaction.account,
          kind: bulkDraft.kind || transaction.kind,
          note: bulkDraft.note.trim() || transaction.note,
          amount: bulkDraft.kind ? nextAmount : transaction.amount,
        };
      }),
    );

    setStatusMessage(`Aggiornate in blocco ${selectedTransactionIds.length} transazioni. (salvato automaticamente)`);
    setBulkDraft({
      date: '',
      category: '',
      subcategory: '',
      account: '',
      kind: '',
      note: '',
    });
    clearTransactionSelection();
  };

  const handleSubmitTransaction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const amountValue = Number(draft.amount.replace(',', '.'));

    if (!draft.merchant.trim() || !draft.category.trim() || !draft.account.trim()) {
      setStatusMessage('Compila almeno esercente, categoria e conto.');
      return;
    }

    const targetAccount = draft.account.trim();

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setStatusMessage('Inserisci un importo valido maggiore di zero.');
      return;
    }

    const nextTransaction: Transaction = {
      id: editingTransaction?.id ?? `txn-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      date: draft.date,
      merchant: draft.merchant.trim(),
      category: draft.category.trim(),
      subcategory: draft.subcategory.trim(),
      account: targetAccount,
      amount: draft.kind === 'income' ? amountValue : -amountValue,
      kind: draft.kind,
      note: draft.note.trim(),
      createdAt: editingTransaction?.createdAt ?? Date.now(),
      needsReimbursement: draft.kind === 'expense' ? draft.needsReimbursement : false,
      reimbursementDueDate:
        draft.kind === 'expense' && draft.needsReimbursement && draft.reimbursementDueDate
          ? draft.reimbursementDueDate
          : undefined,
      reimbursesTransactionId:
        draft.kind === 'income' && draft.isReimbursement && draft.reimbursesTransactionId
          ? draft.reimbursesTransactionId
          : undefined,
    };

    upsertTransaction(nextTransaction);

    if (nextTransaction.reimbursesTransactionId) {
      setTransactions((currentTransactions) =>
        currentTransactions.map((tx) =>
          tx.id === nextTransaction.reimbursesTransactionId && !tx.needsReimbursement
            ? { ...tx, needsReimbursement: true }
            : tx
        )
      );
    }
    setStatusMessage(
      editorMode === 'edit'
        ? `Transazione aggiornata: ${nextTransaction.merchant}. (salvato automaticamente)`
        : `Transazione aggiunta: ${nextTransaction.merchant}. (salvato automaticamente)`,
    );
    setEditorMode('create');
    setEditingTransactionId(null);
    setDraft(defaultDraft());
  };

  const getSpecificAssetTrendPoints = (assetId: string, mode: 'capital' | 'price' | 'return') => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return [];

    const txs = assetTransactions
      .filter((tx) => tx.assetId === assetId)
      .sort((a, b) => a.date.localeCompare(b.date));

    const tickerClean = asset.ticker ? asset.ticker.toUpperCase() : '';
    const tData = tickerClean ? tickerData[tickerClean] : null;
    const todayIso = getTodayIso();

    const txDates = txs.map((tx) => tx.date);
    const histDates = (tData && tData.history) ? tData.history.map((h) => h.date) : [];

    let earliestDate = todayIso;
    if (txDates.length > 0) {
      earliestDate = txDates.reduce((min, d) => d < min ? d : min);
    } else if (histDates.length > 0) {
      earliestDate = histDates.reduce((min, d) => d < min ? d : min);
    } else {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      earliestDate = d.toISOString().split('T')[0];
    }

    const startFilter = assetRange.start || earliestDate;
    const endFilter = assetRange.end || todayIso;

    const allDatesSet = new Set<string>([...txDates, ...histDates, todayIso]);
    let dates = Array.from(allDatesSet)
      .filter((d) => d >= startFilter && d <= endFilter)
      .sort();

    if (dates.length === 0) {
      dates = [startFilter, endFilter].sort();
    }
    if (dates.length === 1) {
      const dObj = new Date(`${dates[0]}T12:00:00`);
      dObj.setDate(dObj.getDate() - 30);
      dates = [dObj.toISOString().split('T')[0], dates[0]].sort();
    }

    let sampledDates = dates;
    if (dates.length > 70) {
      const step = Math.ceil(dates.length / 60);
      const criticalSet = new Set([...txDates, dates[0], dates[dates.length - 1]]);
      sampledDates = dates.filter((d, idx) => idx % step === 0 || criticalSet.has(d) || idx === dates.length - 1);
      sampledDates = Array.from(new Set(sampledDates)).sort();
    }

    const getQtyOnDate = (d: string): number => {
      if (txs.length === 0) return asset.quantity;
      const priorTxs = txs.filter((tx) => tx.date <= d);
      if (priorTxs.length === 0) return 0;
      return priorTxs.reduce((sum, tx) => tx.kind === 'buy' ? sum + tx.quantity : sum - tx.quantity, 0);
    };

    const getPriceOnDate = (d: string): number => {
      if (tickerClean) {
        return getHistoricalTickerPrice(tickerClean, d, asset.unitValue);
      }
      const priorTxs = txs.filter((tx) => tx.date <= d);
      if (priorTxs.length > 0) {
        return priorTxs[priorTxs.length - 1].unitValue;
      }
      return asset.unitValue;
    };

    const basePrice = getPriceOnDate(sampledDates[0]) || asset.unitValue || 1;
    const points: PortfolioPoint[] = [];

    sampledDates.forEach((date) => {
      const qty = getQtyOnDate(date);
      const price = getPriceOnDate(date);

      let val = 0;
      if (mode === 'capital') {
        // Con transazioni: varia per acquisti/vendite (quote) e per quotazioni
        val = Math.round(qty * price * 100) / 100;
      } else if (mode === 'return') {
        // Senza transazioni: variazione percentuale % pura della quotazione
        val = Math.round(((price - basePrice) / basePrice) * 10000) / 100;
      } else {
        // mode === 'price' (Senza transazioni: prezzo unitario della sola quotazione)
        val = Math.round(price * 100) / 100;
      }

      points.push({
        label: formatPortfolioLabel(new Date(`${date}T12:00:00`).getTime()),
        value: val,
      });
    });

    return points;
  };

  const handleStartEditAssetTransaction = (tx: AssetTransaction) => {
    setEditingAssetTxId(tx.id);
    setAssetTxDraft({
      date: tx.date,
      kind: tx.kind,
      quantity: tx.quantity.toString(),
      unitValue: tx.unitValue.toString(),
      note: tx.note || '',
    });
    setStatusMessage(`Modifica dell'operazione del ${formatDisplayDate(tx.date)} attivata.`);
  };

  const handleCancelEditAssetTransaction = () => {
    setEditingAssetTxId(null);
    setAssetTxDraft({
      date: getTodayIso(),
      kind: 'buy',
      quantity: '',
      unitValue: '',
      note: '',
    });
  };

  const handleSubmitAssetTransaction = (event: FormEvent<HTMLFormElement>, assetId: string) => {
    event.preventDefault();

    const quantity = Number(assetTxDraft.quantity.replace(',', '.'));
    const unitValue = Number(assetTxDraft.unitValue.replace(',', '.'));

    if (!assetTxDraft.date || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitValue) || unitValue <= 0) {
      setStatusMessage('Inserisci una data, quantità e valore unitario validi.');
      return;
    }

    if (editingAssetTxId) {
      setAssetTransactions((prev) =>
        prev.map((tx) =>
          tx.id === editingAssetTxId
            ? {
                ...tx,
                date: assetTxDraft.date,
                kind: assetTxDraft.kind,
                quantity,
                unitValue,
                note: assetTxDraft.note.trim() || (assetTxDraft.kind === 'buy' ? 'Acquisto' : 'Vendita'),
              }
            : tx
        )
      );
      setEditingAssetTxId(null);
      setAssetTxDraft({
        date: getTodayIso(),
        kind: 'buy',
        quantity: '',
        unitValue: '',
        note: '',
      });
      setStatusMessage('Transazione dell\'asset modificata con successo. (salvato automaticamente)');
      return;
    }

    const newTx: AssetTransaction = {
      id: `asset-tx-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      assetId,
      date: assetTxDraft.date,
      kind: assetTxDraft.kind,
      quantity,
      unitValue,
      note: assetTxDraft.note.trim() || (assetTxDraft.kind === 'buy' ? 'Acquisto' : 'Vendita'),
      createdAt: Date.now(),
    };

    setAssetTransactions((prev) => [...prev, newTx]);
    setAssetTxDraft({
      date: getTodayIso(),
      kind: 'buy',
      quantity: '',
      unitValue: '',
      note: '',
    });
    setStatusMessage(assetTxDraft.kind === 'buy' ? `Registrato acquisto di ${quantity} quote. (salvato automaticamente)` : `Registrata vendita di ${quantity} quote. (salvato automaticamente)`);
  };

  const handleDeleteAssetTransaction = (txId: string) => {
    const targetTx = assetTransactions.find((tx) => tx.id === txId);

    askConfirmation({
      title: 'Elimina movimento asset',
      message: 'Sei sicuro di voler eliminare questa operazione dell\'asset? La quantità e i rendimenti verranno ricalcolati automaticamente.',
      itemDetails: targetTx ? [
        { label: 'Tipo', value: targetTx.kind === 'buy' ? 'Acquisto quote' : 'Vendita quote' },
        { label: 'Data', value: targetTx.date },
        { label: 'Quantità', value: `${targetTx.quantity}` },
        { label: 'Prezzo unitario', value: formatEuro(targetTx.unitValue) },
      ] : undefined,
      confirmLabel: 'Elimina movimento',
      onConfirm: () => {
        if (editingAssetTxId === txId) {
          handleCancelEditAssetTransaction();
        }
        setAssetTransactions((prev) => prev.filter((tx) => tx.id !== txId));
        setStatusMessage('Transazione dell\'asset eliminata. (salvato automaticamente)');
      },
    });
  };

  const renderAssetDetailsPanel = (asset: Asset) => {
    const txs = assetTransactions
      .filter((tx) => tx.assetId === asset.id)
      .sort((a, b) => b.date.localeCompare(a.date));

    const currentQty = getAssetCurrentQuantity(asset);
    const trendPoints = getSpecificAssetTrendPoints(asset.id, assetChartMode);
    const maxVal = Math.max(...trendPoints.map((p) => p.value));
    const minVal = Math.min(...trendPoints.map((p) => p.value));
    const trendMax = assetChartMode === 'return' ? (maxVal === minVal ? maxVal + 2 : maxVal) : Math.max(maxVal, 1);
    const trendMin = assetChartMode === 'return' ? (maxVal === minVal ? minVal - 2 : minVal) : Math.min(minVal, 0);
    const tickerClean = asset.ticker ? asset.ticker.toUpperCase() : '';
    const tData = tickerClean ? tickerData[tickerClean] : null;

    const showSpecificChart = trendPoints.length > 1;

    const formatAssetPointVal = (val: number) => {
      if (assetChartMode === 'return') {
        return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
      }
      return tData && assetChartMode === 'price'
        ? formatTickerCurrency(val, tData.currency)
        : formatEuro(val);
    };

    return (
      <div className="panel panel-large" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div className="panel-header panel-header-wrap" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '0.25rem' }}>
          <div>
            <p className="section-label" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem', color: 'var(--muted)' }}>Dettaglio Strumento</p>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '4px 0 0 0' }}>{asset.name}</h2>
            <p className="asset-institution-label" style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '4px 0 0 0' }}>
              Gestito su: <strong style={{ color: 'var(--text)' }}>{asset.institution}</strong> · Tipo: <strong style={{ color: 'var(--text)' }}>{formatAssetKindLabel(asset.kind)}</strong>
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={() => { setSelectedAssetIdForDetails(null); handleCancelEditAssetTransaction(); }} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            Chiudi scheda
          </button>
        </div>

        <div className="mini-stat-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          <div className="mini-stat-card" style={{ padding: '10px 12px', borderRadius: '12px', backgroundColor: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Quantità</span>
            <strong style={{ fontSize: '1rem', display: 'block', marginTop: '2px', color: 'var(--text)' }}>{currentQty}</strong>
          </div>
          <div className="mini-stat-card" style={{ padding: '10px 12px', borderRadius: '12px', backgroundColor: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Valore Totale</span>
            <strong style={{ fontSize: '1rem', display: 'block', marginTop: '2px', color: '#10b981' }}>
              {tData && typeof tData.price === 'number' ? formatTickerCurrency(currentQty * tData.price, tData.currency) : formatEuro(currentQty * asset.unitValue)}
            </strong>
          </div>
          <div className="mini-stat-card" style={{ padding: '10px 12px', borderRadius: '12px', backgroundColor: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Quotazione</span>
            <strong style={{ fontSize: '1rem', display: 'block', marginTop: '2px', color: '#38bdf8' }}>
              {tData && typeof tData.price === 'number' ? formatTickerCurrency(tData.price, tData.currency) : formatEuro(asset.unitValue)}
            </strong>
          </div>
        </div>

        {showSpecificChart ? (
          <div className="asset-trend-card" style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '16px', backgroundColor: 'rgba(255, 255, 255, 0.01)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <p className="panel-title" style={{ fontSize: '0.75rem', margin: 0, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.02em' }}>
                  {assetChartMode === 'capital' ? 'Andamento Capitale (Transazioni + Quotazioni)' : 'Andamento Quotazioni (Escluse Transazioni)'}
                </p>
                <h3 style={{ fontSize: '0.95rem', margin: '2px 0 0 0', fontWeight: 600 }}>
                  {assetChartMode === 'capital' && 'Capitale dell\'asset nel tempo'}
                  {assetChartMode === 'price' && 'Quotazione Unitaria nel tempo'}
                  {assetChartMode === 'return' && 'Rendimento % della Quotazione'}
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.72rem', color: 'var(--muted)' }}>
                  {assetChartMode === 'capital'
                    ? 'La linea riflette sia le compravendite di quote sia le oscillazioni di prezzo.'
                    : 'Influenza transazioni neutralizzata: isola l\'andamento puro del valore di mercato.'}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--overlay-subtle)', padding: '2px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    className={`pill-button ${assetChartMode === 'capital' ? 'active' : ''}`}
                    onClick={() => setAssetChartMode('capital')}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '0.7rem',
                      backgroundColor: assetChartMode === 'capital' ? '#0d9488' : 'transparent',
                      color: assetChartMode === 'capital' ? '#fff' : 'var(--muted)',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                    title="Varia per compravendite e quotazioni"
                  >
                    💼 Capitale
                  </button>
                  <button
                    type="button"
                    className={`pill-button ${assetChartMode === 'price' ? 'active' : ''}`}
                    onClick={() => setAssetChartMode('price')}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '0.7rem',
                      backgroundColor: assetChartMode === 'price' ? '#0d9488' : 'transparent',
                      color: assetChartMode === 'price' ? '#fff' : 'var(--muted)',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                    title="Prezzo unitario: esclude influenza transazioni"
                  >
                    🏷️ Prezzo
                  </button>
                  <button
                    type="button"
                    className={`pill-button ${assetChartMode === 'return' ? 'active' : ''}`}
                    onClick={() => setAssetChartMode('return')}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '0.7rem',
                      backgroundColor: assetChartMode === 'return' ? '#0d9488' : 'transparent',
                      color: assetChartMode === 'return' ? '#fff' : 'var(--muted)',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                    title="Rendimento % quotazione: esclude influenza transazioni"
                  >
                    📈 Rendimento %
                  </button>
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '0.68rem', color: 'var(--text)', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={assetChartMode !== 'capital'}
                    onChange={(e) => setAssetChartMode(e.target.checked ? 'price' : 'capital')}
                    style={{ cursor: 'pointer', accentColor: '#10b981' }}
                  />
                  <span style={{ color: assetChartMode !== 'capital' ? '#10b981' : 'var(--muted)', fontWeight: assetChartMode !== 'capital' ? 600 : 400 }}>
                    Elimina influenza transazioni
                  </span>
                </label>
              </div>
            </div>

            <div className="line-chart asset-line-chart" aria-label="Andamento dello specifico asset" style={{ height: '110px', position: 'relative' }}>
              <div className="line-chart-scale" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', position: 'absolute', left: 0, top: 0, fontSize: '0.65rem', color: 'var(--muted)', zIndex: 1, pointerEvents: 'none', padding: '4px 0' }}>
                <span>{formatAssetPointVal(trendMax)}</span>
                <span>{formatAssetPointVal(trendMin)}</span>
              </div>
              <svg 
                viewBox="0 0 100 100" 
                preserveAspectRatio="none" 
                role="img" 
                aria-hidden="true"
                onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const x = event.clientX - rect.left;
                  const pctX = (x / rect.width) * 100;
                  const numPoints = trendPoints.length;
                  if (numPoints > 0) {
                    let closestIdx = 0;
                    let minDiff = Infinity;
                    for (let i = 0; i < numPoints; i++) {
                      const ptX = numPoints > 1 ? (i / (numPoints - 1)) * 100 : 100;
                      const diff = Math.abs(ptX - pctX);
                      if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = i;
                      }
                    }
                    setHoveredSpecificPointIndex(closestIdx);
                  }
                }}
                onMouseLeave={() => setHoveredSpecificPointIndex(null)}
                style={{ cursor: 'crosshair', overflow: 'visible', width: '100%', height: '100%' }}
              >
                <defs>
                  <linearGradient id="specificAssetTrendStroke" x1="0%" x2="100%" y1="0%" y2="0%">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                </defs>

                {assetChartMode === 'return' && trendMin < 0 && trendMax > 0 && (() => {
                  const zeroY = 100 - ((0 - trendMin) / (trendMax - trendMin || 1)) * 76 - 8;
                  return (
                    <line
                      x1={0}
                      y1={zeroY}
                      x2={100}
                      y2={zeroY}
                      stroke="rgba(255, 255, 255, 0.2)"
                      strokeWidth={0.5}
                      strokeDasharray="2,2"
                    />
                  );
                })()}

                <path
                  className="line-chart-area"
                  d={`M 0 100 ${trendPoints
                    .map((point, index) => {
                      const x = trendPoints.length > 1 ? (index / (trendPoints.length - 1)) * 100 : 100;
                      const y = 100 - ((point.value - trendMin) / (trendMax - trendMin || 1)) * 76 - 8;
                      return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
                    })
                    .join(' ')} L 100 100 Z`}
                  fill="rgba(16, 185, 129, 0.05)"
                />
                <path
                  className="line-chart-line"
                  d={trendPoints
                    .map((point, index) => {
                      const x = trendPoints.length > 1 ? (index / (trendPoints.length - 1)) * 100 : 100;
                      const y = 100 - ((point.value - trendMin) / (trendMax - trendMin || 1)) * 76 - 8;
                      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
                    })
                    .join(' ')}
                  stroke="url(#specificAssetTrendStroke)"
                  strokeWidth={1.5}
                  fill="none"
                />

                {/* Interactive guides */}
                {hoveredSpecificPointIndex !== null && trendPoints[hoveredSpecificPointIndex] && (
                  <>
                    <line
                      x1={(hoveredSpecificPointIndex / (trendPoints.length - 1)) * 100}
                      y1={0}
                      x2={(hoveredSpecificPointIndex / (trendPoints.length - 1)) * 100}
                      y2={100}
                      stroke="rgba(16, 185, 129, 0.4)"
                      strokeWidth={0.4}
                      strokeDasharray="1.5,1.5"
                    />
                    {(() => {
                      const point = trendPoints[hoveredSpecificPointIndex];
                      const x = trendPoints.length > 1 ? (hoveredSpecificPointIndex / (trendPoints.length - 1)) * 100 : 100;
                      const y = 100 - ((point.value - trendMin) / (trendMax - trendMin || 1)) * 76 - 8;
                      return (
                        <>
                          <circle
                            cx={x}
                            cy={y}
                            r={1.8}
                            fill="#10b981"
                            stroke="#0f172a"
                            strokeWidth={0.4}
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r={3.5}
                            fill="none"
                            stroke="#10b981"
                            strokeWidth={0.2}
                            opacity={0.6}
                          />
                        </>
                      );
                    })()}
                  </>
                )}
              </svg>

              {/* Tooltip Overlay */}
              {hoveredSpecificPointIndex !== null && trendPoints[hoveredSpecificPointIndex] && (
                <div
                  style={{
                    position: 'absolute',
                    top: '-50px',
                    left: `${Math.max(12, Math.min(88, (hoveredSpecificPointIndex / (trendPoints.length - 1)) * 100))}%`,
                    transform: 'translateX(-50%)',
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    borderRadius: '8px',
                    padding: '4px 8px',
                    color: '#fff',
                    pointerEvents: 'none',
                    zIndex: 10,
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.55)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '1px',
                    backdropFilter: 'blur(4px)',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <span style={{ color: 'var(--muted)', fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                    {trendPoints[hoveredSpecificPointIndex].label}
                  </span>
                  <strong style={{
                    color: assetChartMode === 'return'
                      ? (trendPoints[hoveredSpecificPointIndex].value >= 0 ? '#10b981' : '#f43f5e')
                      : '#10b981',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {formatAssetPointVal(trendPoints[hoveredSpecificPointIndex].value)}
                  </strong>
                  {assetChartMode !== 'capital' && (
                    <span style={{ fontSize: '0.55rem', color: 'var(--muted)', marginTop: '-2px' }}>
                      Pura quotazione
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="asset-trend-points" style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
              {trendPoints.slice(-3).map((point) => (
                <div className="asset-trend-point" key={`${point.label}-${point.value}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{point.label}</span>
                  <strong style={{
                    fontSize: '0.75rem',
                    color: assetChartMode === 'return'
                      ? (point.value >= 0 ? '#10b981' : '#f43f5e')
                      : '#cbd5e1',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {formatAssetPointVal(point.value)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px', border: '1px dashed var(--border)', borderRadius: '12px', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.01)', color: 'var(--muted)' }}>
            <p style={{ fontSize: '0.75rem', margin: 0, fontWeight: 500 }}>Nessun andamento storico disponibile.</p>
            <p style={{ fontSize: '0.68rem', margin: '2px 0 0 0', opacity: 0.75 }}>Registra transazioni o inserisci un ticker valido per tracciare le quotazioni storiche.</p>
          </div>
        )}

        <div style={{ padding: '0.75rem 1rem', border: editingAssetTxId ? '1px solid #38bdf8' : '1px solid var(--border)', borderRadius: '12px', backgroundColor: editingAssetTxId ? 'rgba(56, 189, 248, 0.03)' : 'rgba(255,255,255,0.01)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '0.85rem', margin: 0, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.03em', color: editingAssetTxId ? '#38bdf8' : '#cbd5e1' }}>
              {editingAssetTxId ? '✏️ Modifica Operazione Asset' : 'Registra Operazione'}
            </h3>
            {editingAssetTxId && (
              <button
                className="ghost-button"
                type="button"
                onClick={handleCancelEditAssetTransaction}
                style={{ fontSize: '0.7rem', padding: '2px 8px', color: 'var(--muted)', cursor: 'pointer' }}
              >
                Annulla Modifica
              </button>
            )}
          </div>
          <form className="editor-form" onSubmit={(e) => handleSubmitAssetTransaction(e, asset.id)} style={{ gap: '0.5rem', display: 'flex', flexDirection: 'column' }}>
            <div className="form-row" style={{ gap: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <label style={{ margin: 0 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Data</span>
                <input type="date" value={assetTxDraft.date} onChange={(event) => setAssetTxDraft((current) => ({ ...current, date: event.target.value }))} required style={{ padding: '5px 8px', fontSize: '0.8rem', borderRadius: '6px' }} />
              </label>
              <label style={{ margin: 0 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Operazione</span>
                <select value={assetTxDraft.kind} onChange={(event) => setAssetTxDraft((current) => ({ ...current, kind: event.target.value as AssetTransactionKind }))} style={{ padding: '5px 8px', fontSize: '0.8rem', borderRadius: '6px' }}>
                  <option value="buy">Compra (Buy)</option>
                  <option value="sell">Vendi (Sell)</option>
                </select>
              </label>
            </div>
            <div className="form-row" style={{ gap: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <label style={{ margin: 0 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Quantità</span>
                <input value={assetTxDraft.quantity} onChange={(event) => setAssetTxDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="0" required inputMode="decimal" style={{ padding: '5px 8px', fontSize: '0.8rem', borderRadius: '6px' }} />
              </label>
              <label style={{ margin: 0 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Prezzo Unitario (€)</span>
                <input value={assetTxDraft.unitValue} onChange={(event) => setAssetTxDraft((current) => ({ ...current, unitValue: event.target.value }))} placeholder={asset.unitValue.toString()} required inputMode="decimal" style={{ padding: '5px 8px', fontSize: '0.8rem', borderRadius: '6px' }} />
              </label>
            </div>
            <label style={{ margin: 0 }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Nota</span>
              <input value={assetTxDraft.note} onChange={(event) => setAssetTxDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Es. Acquisto aggiuntivo o dividendo" style={{ padding: '5px 8px', fontSize: '0.8rem', borderRadius: '6px' }} />
            </label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '0.25rem' }}>
              <button
                className="primary-button"
                type="submit"
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  borderRadius: '8px',
                  background: editingAssetTxId ? '#38bdf8' : undefined,
                  color: editingAssetTxId ? '#07111f' : undefined,
                  fontWeight: editingAssetTxId ? 600 : undefined
                }}
              >
                {editingAssetTxId ? 'Salva Modifiche Transazione' : 'Registra Transazione'}
              </button>
              {editingAssetTxId && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleCancelEditAssetTransaction}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px' }}
                >
                  Annulla
                </button>
              )}
            </div>
          </form>
        </div>

        <div>
          <h3 style={{ fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#cbd5e1' }}>Registro Operazioni</h3>
          {txs.length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic', margin: 0 }}>Nessuna operazione registrata.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '160px', overflowY: 'auto', paddingRight: '4px' }}>
              {txs.map((tx) => {
                const totalTxVal = tx.quantity * tx.unitValue;
                const isBeingEdited = editingAssetTxId === tx.id;
                return (
                  <div
                    key={tx.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 8px',
                      border: isBeingEdited ? '1px solid #38bdf8' : '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      backgroundColor: isBeingEdited ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.01)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: tx.kind === 'buy' ? '#10b981' : '#f43f5e', fontWeight: 700, fontSize: '0.7rem' }}>
                          {tx.kind === 'buy' ? 'BUY' : 'SELL'}
                        </span>
                        <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{formatDisplayDate(tx.date)}</span>
                        {isBeingEdited && (
                          <span style={{ fontSize: '0.625rem', backgroundColor: '#38bdf8', color: '#07111f', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, letterSpacing: '0.02em' }}>
                            IN MODIFICA
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: '2px', color: 'var(--text)' }}>
                        Qty: <strong>{tx.quantity}</strong> @ <strong>{tData ? formatTickerCurrency(tx.unitValue, tData.currency) : formatEuro(tx.unitValue)}</strong>
                      </div>
                      {tx.note ? <p style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '2px', margin: 0 }}>{tx.note}</p> : null}
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{tData ? formatTickerCurrency(totalTxVal, tData.currency) : formatEuro(totalTxVal)}</strong>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            if (isBeingEdited) {
                              handleCancelEditAssetTransaction();
                            } else {
                              handleStartEditAssetTransaction(tx);
                            }
                          }}
                          style={{ color: isBeingEdited ? '#f59e0b' : '#38bdf8', fontSize: '0.7rem', padding: 0, fontWeight: 500 }}
                        >
                          {isBeingEdited ? 'Annulla' : 'Modifica'}
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => handleDeleteAssetTransaction(tx.id)}
                          style={{ color: '#f43f5e', fontSize: '0.7rem', padding: 0 }}
                        >
                          Elimina
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAssets = () => {
    const selectedAsset = assets.find((a) => a.id === selectedAssetIdForDetails) ?? null;
    const showPortfolioChart = assetPortfolioTrend.length > 1;

    return (
      <section className="section-grid" style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        <div className="panel panel-large" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="panel-header panel-header-wrap" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '0.25rem' }}>
            <div>
              <p className="section-label" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem', color: 'var(--muted)' }}>Portafoglio Asset</p>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '4px 0 0 0' }}>Strumenti & Investimenti</h2>
            </div>
            <div className="panel-actions" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              {assets.some((a) => a.ticker) && (
                <button
                  className="pill pill-soft"
                  type="button"
                  onClick={() => fetchAllTickers(true)}
                  disabled={isFetchingTickers}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    backgroundColor: isFetchingTickers ? 'rgba(255,255,255,0.02)' : 'rgba(56, 189, 248, 0.08)',
                    borderColor: 'rgba(56, 189, 248, 0.2)',
                    color: '#38bdf8',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                  }}
                >
                  {isFetchingTickers ? 'Aggiornamento...' : '🔄 Aggiorna Quotazioni'}
                </button>
              )}
              <span className="pill pill-soft" style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '999px', backgroundColor: 'rgba(16, 185, 129, 0.08)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
                Totale: {formatEuro(assetMarketValue)}
              </span>
              <button className="primary-button" type="button" onClick={startNewAsset} style={{ padding: '5px 10px', fontSize: '0.75rem', borderRadius: '8px' }}>
                + Nuovo Asset
              </button>
            </div>
          </div>

          {showPortfolioChart ? (
            <div className="asset-trend-card" style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '16px', backgroundColor: 'rgba(255, 255, 255, 0.01)' }}>
              <div className="asset-trend-copy" style={{ paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ flex: '1 1 240px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <p className="panel-title" style={{ fontSize: '0.75rem', margin: 0, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.02em' }}>
                      {portfolioChartMode === 'total' ? 'Andamento Totale di Portafoglio' : 'Andamento Quotazioni (Escluse Transazioni)'}
                    </p>
                    <span style={{
                      fontSize: '0.65rem',
                      padding: '2px 7px',
                      borderRadius: '4px',
                      backgroundColor: portfolioChartMode === 'total' ? 'rgba(56, 189, 248, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                      color: portfolioChartMode === 'total' ? '#38bdf8' : '#10b981',
                      border: `1px solid ${portfolioChartMode === 'total' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                      fontWeight: 600
                    }}>
                      {portfolioChartMode === 'total' ? 'Transazioni + Quotazioni' : 'Solo Quotazioni (Time-Weighted)'}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '0.95rem', margin: '3px 0 0 0', fontWeight: 600 }}>
                    {portfolioChartMode === 'total' ? 'Evoluzione del Capitale Investito' : 'Rendimento Puro delle Quotazioni di Mercato'}
                  </h3>
                  <p style={{ margin: '3px 0 6px 0', fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                    {portfolioChartMode === 'total'
                      ? 'La curva varia sia per le transazioni (acquisti, vendite, nuovi versamenti) sia per le oscillazioni quotidiane delle quotazioni di mercato.'
                      : 'Influenza delle transazioni neutralizzata: il grafico isola il rendimento reale delle quotazioni di mercato (Time-Weighted Return), eliminando i salti dovuti a versamenti o prelievi.'}
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--overlay-subtle)', padding: '2px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <button
                        type="button"
                        className={`pill-button ${portfolioChartMode === 'total' ? 'active' : ''}`}
                        onClick={() => setPortfolioChartMode('total')}
                        style={{
                          padding: '4px 9px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          backgroundColor: portfolioChartMode === 'total' ? '#0284c7' : 'transparent',
                          color: portfolioChartMode === 'total' ? '#fff' : 'var(--muted)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        title="Mostra il valore in Euro (€), combinando transazioni e quotazioni"
                      >
                        💼 Valore Totale (€)
                      </button>
                      <button
                        type="button"
                        className={`pill-button ${portfolioChartMode === 'no-transactions' ? 'active' : ''}`}
                        onClick={() => setPortfolioChartMode('no-transactions')}
                        style={{
                          padding: '4px 9px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          backgroundColor: portfolioChartMode === 'no-transactions' ? '#059669' : 'transparent',
                          color: portfolioChartMode === 'no-transactions' ? '#fff' : 'var(--muted)',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        title="Elimina l'influenza delle transazioni: mostra la pura variazione percentuale % delle quotazioni di mercato"
                      >
                        📈 Senza Transazioni (Quotazioni %)
                      </button>
                    </div>

                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text)', userSelect: 'none', padding: '3px 6px', borderRadius: '6px', backgroundColor: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
                      <input
                        type="checkbox"
                        checked={portfolioChartMode === 'no-transactions'}
                        onChange={(e) => setPortfolioChartMode(e.target.checked ? 'no-transactions' : 'total')}
                        style={{ cursor: 'pointer', accentColor: '#10b981' }}
                      />
                      <span style={{ color: portfolioChartMode === 'no-transactions' ? '#10b981' : 'var(--muted)', fontWeight: portfolioChartMode === 'no-transactions' ? 600 : 400 }}>
                        Elimina influenza transazioni
                      </span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.7rem', color: 'var(--muted)' }}>
                      <span>Inizio intervallo</span>
                      <input
                        type="date"
                        value={assetRange.start}
                        onChange={(e) => setAssetRange(curr => ({ ...curr, start: e.target.value }))}
                        style={{
                          background: 'var(--input-bg)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '4px 6px',
                          color: 'var(--text)',
                          marginTop: '2px',
                          font: 'inherit',
                          fontSize: '0.75rem'
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.7rem', color: 'var(--muted)' }}>
                      <span>Fine intervallo</span>
                      <input
                        type="date"
                        value={assetRange.end}
                        onChange={(e) => setAssetRange(curr => ({ ...curr, end: e.target.value }))}
                        style={{
                          background: 'var(--input-bg)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '4px 6px',
                          color: 'var(--text)',
                          marginTop: '2px',
                          font: 'inherit',
                          fontSize: '0.75rem'
                        }}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="pill" type="button" onClick={() => setAssetPresetRange('questo-mese')} style={{ fontSize: '0.65rem', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', backgroundColor: 'var(--overlay-subtle)', color: 'var(--text)' }}>Questo mese</button>
                    <button className="pill" type="button" onClick={() => setAssetPresetRange('mese-scorso')} style={{ fontSize: '0.65rem', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', backgroundColor: 'var(--overlay-subtle)', color: 'var(--text)' }}>Mese scorso</button>
                    <button className="pill" type="button" onClick={() => setAssetPresetRange('ultimi-3-mesi')} style={{ fontSize: '0.65rem', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', backgroundColor: 'var(--overlay-subtle)', color: 'var(--text)' }}>3 Mesi</button>
                    <button className="pill" type="button" onClick={() => setAssetPresetRange('quest-anno')} style={{ fontSize: '0.65rem', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', backgroundColor: 'var(--overlay-subtle)', color: 'var(--text)' }}>Anno</button>
                    <button className="pill" type="button" onClick={() => setAssetPresetRange('tutto')} style={{ fontSize: '0.65rem', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', backgroundColor: 'var(--overlay-subtle)', color: 'var(--text)' }}>Tutto</button>
                  </div>
                </div>
              </div>
                
                {assets.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--muted)' }}>Filtra strumenti nel grafico:</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {assets.map((asset) => {
                        const isSelected = selectedAssetIdsForChart.length === 0 || selectedAssetIdsForChart.includes(asset.id);
                        return (
                          <button
                            key={asset.id}
                            className="pill"
                            type="button"
                            onClick={() => {
                              let currentSelected = selectedAssetIdsForChart.length === 0 ? assets.map(a => a.id) : [...selectedAssetIdsForChart];
                              if (currentSelected.includes(asset.id)) {
                                currentSelected = currentSelected.filter(id => id !== asset.id);
                              } else {
                                currentSelected.push(asset.id);
                              }
                              if (currentSelected.length === assets.length) {
                                setSelectedAssetIdsForChart([]);
                              } else {
                                setSelectedAssetIdsForChart(currentSelected);
                              }
                            }}
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              border: '1px solid var(--border)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.01)',
                              color: isSelected ? '#38bdf8' : 'var(--muted)',
                              borderColor: isSelected ? 'rgba(56, 189, 248, 0.25)' : 'var(--border)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <span style={{
                              width: '5px',
                              height: '5px',
                              borderRadius: '50%',
                              backgroundColor: isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.15)'
                            }} />
                            {asset.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              <div className="line-chart asset-line-chart" aria-label="Andamento del portafoglio asset" style={{ height: '110px', position: 'relative' }}>
                <div className="line-chart-scale" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', position: 'absolute', left: 0, top: 0, fontSize: '0.65rem', color: 'var(--muted)', zIndex: 1, pointerEvents: 'none', padding: '4px 0' }}>
                  <span>{portfolioChartMode === 'no-transactions' ? `${assetTrendMax >= 0 ? '+' : ''}${assetTrendMax.toFixed(2)}%` : formatEuro(assetTrendMax)}</span>
                  <span>{portfolioChartMode === 'no-transactions' ? `${assetTrendMin >= 0 ? '+' : ''}${assetTrendMin.toFixed(2)}%` : formatEuro(assetTrendMin)}</span>
                </div>
                <svg 
                  viewBox="0 0 100 100" 
                  preserveAspectRatio="none" 
                  role="img" 
                  aria-hidden="true"
                  onMouseMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = event.clientX - rect.left;
                    const pctX = (x / rect.width) * 100;
                    const numPoints = assetPortfolioTrend.length;
                    if (numPoints > 0) {
                      let closestIdx = 0;
                      let minDiff = Infinity;
                      for (let i = 0; i < numPoints; i++) {
                        const ptX = numPoints > 1 ? (i / (numPoints - 1)) * 100 : 100;
                        const diff = Math.abs(ptX - pctX);
                        if (diff < minDiff) {
                          minDiff = diff;
                          closestIdx = i;
                        }
                      }
                      setHoveredPointIndex(closestIdx);
                    }
                  }}
                  onMouseLeave={() => setHoveredPointIndex(null)}
                  style={{ cursor: 'crosshair', overflow: 'visible', width: '100%', height: '100%' }}
                >
                  <defs>
                    <linearGradient id="assetTrendStrokeTotal" x1="0%" x2="100%" y1="0%" y2="0%">
                      <stop offset="0%" stopColor="#5eead4" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                    <linearGradient id="assetTrendStrokeNoTx" x1="0%" x2="100%" y1="0%" y2="0%">
                      <stop offset="0%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#059669" />
                    </linearGradient>
                  </defs>

                  {portfolioChartMode === 'no-transactions' && assetTrendMin < 0 && assetTrendMax > 0 && (() => {
                    const zeroY = 100 - ((0 - assetTrendMin) / (assetTrendMax - assetTrendMin || 1)) * 76 - 8;
                    return (
                      <line
                        x1={0}
                        y1={zeroY}
                        x2={100}
                        y2={zeroY}
                        stroke="rgba(255, 255, 255, 0.2)"
                        strokeWidth={0.5}
                        strokeDasharray="2,2"
                      />
                    );
                  })()}

                  <path
                    className="line-chart-area"
                    d={`M 0 100 ${assetPortfolioTrend
                      .map((point, index) => {
                        const x = assetPortfolioTrend.length > 1 ? (index / (assetPortfolioTrend.length - 1)) * 100 : 100;
                        const y = 100 - ((point.value - assetTrendMin) / (assetTrendMax - assetTrendMin || 1)) * 76 - 8;
                        return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
                      })
                      .join(' ')} L 100 100 Z`}
                    fill={portfolioChartMode === 'total' ? 'rgba(56, 189, 248, 0.04)' : 'rgba(16, 185, 129, 0.05)'}
                  />
                  <path
                    className="line-chart-line"
                    d={assetPortfolioTrend
                      .map((point, index) => {
                        const x = assetPortfolioTrend.length > 1 ? (index / (assetPortfolioTrend.length - 1)) * 100 : 100;
                        const y = 100 - ((point.value - assetTrendMin) / (assetTrendMax - assetTrendMin || 1)) * 76 - 8;
                        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
                      })
                      .join(' ')}
                    stroke={portfolioChartMode === 'total' ? 'url(#assetTrendStrokeTotal)' : 'url(#assetTrendStrokeNoTx)'}
                    strokeWidth={1.5}
                    fill="none"
                  />

                  {/* Interactive guides */}
                  {hoveredPointIndex !== null && assetPortfolioTrend[hoveredPointIndex] && (
                    <>
                      <line
                        x1={(hoveredPointIndex / (assetPortfolioTrend.length - 1)) * 100}
                        y1={0}
                        x2={(hoveredPointIndex / (assetPortfolioTrend.length - 1)) * 100}
                        y2={100}
                        stroke={portfolioChartMode === 'total' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(16, 185, 129, 0.4)'}
                        strokeWidth={0.4}
                        strokeDasharray="1.5,1.5"
                      />
                      {(() => {
                        const point = assetPortfolioTrend[hoveredPointIndex];
                        const x = assetPortfolioTrend.length > 1 ? (hoveredPointIndex / (assetPortfolioTrend.length - 1)) * 100 : 100;
                        const y = 100 - ((point.value - assetTrendMin) / (assetTrendMax - assetTrendMin || 1)) * 76 - 8;
                        const guideColor = portfolioChartMode === 'total' ? '#38bdf8' : '#10b981';
                        return (
                          <>
                            <circle
                              cx={x}
                              cy={y}
                              r={1.8}
                              fill={guideColor}
                              stroke="#0f172a"
                              strokeWidth={0.4}
                            />
                            <circle
                              cx={x}
                              cy={y}
                              r={3.5}
                              fill="none"
                              stroke={guideColor}
                              strokeWidth={0.2}
                              opacity={0.6}
                            />
                          </>
                        );
                      })()}
                    </>
                  )}
                </svg>

                {/* Tooltip Overlay */}
                {hoveredPointIndex !== null && assetPortfolioTrend[hoveredPointIndex] && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-50px',
                      left: `${Math.max(12, Math.min(88, (hoveredPointIndex / (assetPortfolioTrend.length - 1)) * 100))}%`,
                      transform: 'translateX(-50%)',
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: `1px solid ${portfolioChartMode === 'total' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
                      borderRadius: '8px',
                      padding: '4px 8px',
                      color: '#fff',
                      pointerEvents: 'none',
                      zIndex: 10,
                      boxShadow: '0 4px 14px rgba(0, 0, 0, 0.55)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '1px',
                      backdropFilter: 'blur(4px)',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span style={{ color: 'var(--muted)', fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                      {assetPortfolioTrend[hoveredPointIndex].label}
                    </span>
                    <strong style={{
                      color: portfolioChartMode === 'no-transactions'
                        ? (assetPortfolioTrend[hoveredPointIndex].value >= 0 ? '#10b981' : '#f43f5e')
                        : '#38bdf8',
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {portfolioChartMode === 'no-transactions'
                        ? `${assetPortfolioTrend[hoveredPointIndex].value >= 0 ? '+' : ''}${assetPortfolioTrend[hoveredPointIndex].value.toFixed(2)}%`
                        : formatEuro(assetPortfolioTrend[hoveredPointIndex].value)}
                    </strong>
                    {portfolioChartMode === 'no-transactions' && (
                      <span style={{ fontSize: '0.55rem', color: 'var(--muted)', marginTop: '-2px' }}>
                        Rendimento quotazioni
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="asset-trend-points" style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                {assetPortfolioTrend.slice(-4).map((point) => (
                  <div className="asset-trend-point" key={`${point.label}-${point.value}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{point.label}</span>
                    <strong style={{
                      fontSize: '0.75rem',
                      color: portfolioChartMode === 'no-transactions'
                        ? (point.value >= 0 ? '#10b981' : '#f43f5e')
                        : '#cbd5e1',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {portfolioChartMode === 'no-transactions'
                        ? `${point.value >= 0 ? '+' : ''}${point.value.toFixed(2)}%`
                        : formatEuro(point.value)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: '16px', border: '1px dashed var(--border)', borderRadius: '16px', textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.01)', color: 'var(--muted)', margin: '0.25rem 0' }}>
              <p style={{ fontSize: '0.8rem', margin: 0, fontWeight: 500 }}>Nessun grafico di portafoglio disponibile.</p>
              <p style={{ fontSize: '0.7rem', margin: '4px 0 0 0', opacity: 0.75 }}>Fornisci degli strumenti con transazioni storiche per tracciare la crescita cumulativa.</p>
            </div>
          )}

          <div className="asset-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <article className="mini-stat-card" style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--overlay-subtle)' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Valore di Mercato</span>
              <strong style={{ fontSize: '1.05rem', display: 'block', marginTop: '2px', color: '#10b981' }}>{formatEuro(assetMarketValue)}</strong>
              <p style={{ fontSize: '0.68rem', color: 'var(--muted)', margin: '4px 0 0 0', lineHeight: 1.25 }}>Valore attuale dei titoli.</p>
            </article>
            <article className="mini-stat-card" style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--overlay-subtle)' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Strumenti</span>
              <strong style={{ fontSize: '1.05rem', display: 'block', marginTop: '2px', color: '#cbd5e1' }}>{assets.length}</strong>
              <p style={{ fontSize: '0.68rem', color: 'var(--muted)', margin: '4px 0 0 0', lineHeight: 1.25 }}>Quantità di asset unici.</p>
            </article>
            <article className="mini-stat-card" style={{ padding: '12px', borderRadius: '12px', border: '1px solid var(--border)', backgroundColor: 'var(--overlay-subtle)' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Patrimonio Totale</span>
              <strong style={{ fontSize: '1.05rem', display: 'block', marginTop: '2px', color: '#38bdf8' }}>{formatEuro(currentNetWorth)}</strong>
              <p style={{ fontSize: '0.68rem', color: 'var(--muted)', margin: '4px 0 0 0', lineHeight: 1.25 }}>Saldo conti + titoli.</p>
            </article>
          </div>

          {/* Asset Allocation Chart Card */}
          <div className="asset-allocation-card" style={{ padding: '1.25rem', border: '1px solid var(--border)', borderRadius: '16px', backgroundColor: 'rgba(255, 255, 255, 0.01)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <p className="panel-title" style={{ fontSize: '0.75rem', margin: 0, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.02em' }}>Ripartizione Patrimoniale</p>
              <h3 style={{ fontSize: '0.95rem', margin: '2px 0 0 0', fontWeight: 600 }}>Allocazione di Asset &amp; Liquidità</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--muted)', lineHeight: '1.3' }}>
                Suddivisione percentuale del capitale totale tra la liquidità liquida nei conti correnti e gli investimenti in portafoglio.
              </p>
            </div>

            {assetAllocationData.list.length === 0 ? (
              <div style={{ padding: '24px', border: '1px dashed var(--border)', borderRadius: '12px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.8rem' }}>
                <p style={{ margin: 0, fontWeight: 500 }}>Nessuna allocazione disponibile.</p>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.7rem', opacity: 0.75 }}>Aggiungi dei fondi nei conti in Settings o crea degli asset per visualizzare il grafico di ripartizione.</p>
              </div>
            ) : (
              <div className="pie-chart-container" style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', marginTop: '4px' }}>
                
                {/* SVG DONUT CHART */}
                <div style={{ position: 'relative', width: '160px', height: '160px', flexShrink: 0 }}>
                  <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                    <g>
                      {(() => {
                        let currentAngle = 0;
                        return assetAllocationData.list.map((item) => {
                          const angleSpan = (item.value / assetAllocationData.total) * 360;
                          const startAngle = currentAngle;
                          const endAngle = currentAngle + angleSpan;
                          currentAngle = endAngle;

                          const isHovered = hoveredAllocationSlice?.name === item.label;
                          const scale = isHovered ? 1.05 : 1.0;
                          const slicePath = getDonutSlicePath(60, 60, 24 * scale, 42 * scale, startAngle, endAngle);

                          return (
                            <path
                              key={`alloc-slice-${item.key}`}
                              d={slicePath}
                              fill={item.color}
                              stroke="var(--bg)"
                              strokeWidth="1.2"
                              style={{ transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', cursor: 'pointer' }}
                              onMouseEnter={() => {
                                setHoveredAllocationSlice({
                                  name: item.label,
                                  value: item.value,
                                  percentage: item.percentage,
                                  color: item.color,
                                });
                              }}
                              onMouseLeave={() => {
                                setHoveredAllocationSlice(null);
                              }}
                            />
                          );
                        });
                      })()}
                    </g>
                  </svg>
                  
                  {/* Center Text (dynamic) */}
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                    pointerEvents: 'none',
                    width: '85px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center'
                  }}>
                    {hoveredAllocationSlice ? (
                      <>
                        <span style={{ fontSize: '0.625rem', color: 'var(--muted)', fontWeight: 600, display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', textTransform: 'uppercase' }}>
                          {hoveredAllocationSlice.name}
                        </span>
                        <strong style={{ fontSize: '0.8rem', color: hoveredAllocationSlice.color, fontFamily: 'var(--font-mono)', display: 'block', marginTop: '1px' }}>
                          {hoveredAllocationSlice.percentage.toFixed(1)}%
                        </strong>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: '0.625rem', color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Totale</span>
                        <strong style={{ fontSize: '0.725rem', color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', display: 'block', marginTop: '1px' }}>
                          {formatEuro(assetAllocationData.total)}
                        </strong>
                      </>
                    )}
                  </div>
                </div>

                {/* Legend and stats */}
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', minWidth: '180px' }}>
                  {assetAllocationData.list.map((item) => {
                    const isHovered = hoveredAllocationSlice?.name === item.label;
                    return (
                      <div
                        key={`alloc-legend-${item.key}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px 10px',
                          borderRadius: '10px',
                          backgroundColor: isHovered ? 'rgba(255,255,255,0.03)' : 'transparent',
                          border: isHovered ? '1px solid var(--border)' : '1px solid transparent',
                          transition: 'all 0.15s ease',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={() => {
                          setHoveredAllocationSlice({
                            name: item.label,
                            value: item.value,
                            percentage: item.percentage,
                            color: item.color,
                          });
                        }}
                        onMouseLeave={() => {
                          setHoveredAllocationSlice(null);
                        }}
                      >
                        <span style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: item.color,
                          flexShrink: 0,
                          boxShadow: isHovered ? `0 0 8px ${item.color}` : 'none',
                          transition: 'all 0.15s ease'
                        }} />
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ fontSize: '0.75rem', color: isHovered ? 'var(--text)' : '#94a3b8', fontWeight: isHovered ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.label}
                          </span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: '1px' }}>
                            {formatEuro(item.value)} <span style={{ opacity: 0.7, fontSize: '0.625rem' }}>({item.percentage.toFixed(1)}%)</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Asset Filtering and Sorting Bar */}
          {assets.length > 0 && (
            <div className="asset-filters-bar" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '8px',
              padding: '12px',
              borderRadius: '16px',
              backgroundColor: 'var(--overlay-subtle)',
              border: '1px solid var(--border)',
              marginTop: '4px',
              marginBottom: '4px'
            }}>
              {/* Search Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 500 }}>Cerca</span>
                <input
                  type="text"
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  placeholder="Nome o ticker..."
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                    width: '100%'
                  }}
                />
              </div>

              {/* Category Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 500 }}>Categoria</span>
                <select
                  value={assetFilterCategory}
                  onChange={(e) => setAssetFilterCategory(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                    width: '100%'
                  }}
                >
                  <option value="">Tutte le categorie</option>
                  <option value="azioni_all">📊 Azioni &amp; ETF Azionari (Macro)</option>
                  <option value="obbligazioni_all">🏛️ Obbligazioni &amp; ETF Obbligazionari (Macro)</option>
                  <option value="etf_azionario">📈 Solo ETF Azionari</option>
                  <option value="etf_obbligazionario">🏛️ Solo ETF Obbligazionari</option>
                  <option value="azioni">🏢 Solo Azioni Singole</option>
                  <option value="obbligazioni">📜 Solo Obbligazioni Singole</option>
                  <option value="liquidita">💳 Liquidità / Depositi</option>
                  {uniqueAssetKinds
                    .filter((kind) => !['azioni', 'obbligazioni', 'etf', 'etf_azionario', 'etf_obbligazionario', 'liquidita'].includes(kind))
                    .map((kind) => (
                      <option key={kind} value={kind}>{formatAssetKindLabel(kind)}</option>
                    ))}
                </select>
              </div>

              {/* Institution Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 500 }}>Istituzione</span>
                <select
                  value={assetFilterInstitution}
                  onChange={(e) => setAssetFilterInstitution(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                    width: '100%'
                  }}
                >
                  <option value="">Tutte ({uniqueAssetInstitutions.length})</option>
                  {uniqueAssetInstitutions.map((inst) => (
                    <option key={inst} value={inst}>{inst}</option>
                  ))}
                </select>
              </div>

              {/* Sort By Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 500 }}>Ordina per</span>
                <select
                  value={assetSortBy}
                  onChange={(e) => setAssetSortBy(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                    width: '100%'
                  }}
                >
                  <option value="value">Valore Totale</option>
                  <option value="name">Nome</option>
                  <option value="qty">Quantità</option>
                  <option value="unitValue">Quotazione</option>
                </select>
              </div>

              {/* Sort Direction Toggle */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 500 }}>Ordinamento</span>
                <button
                  type="button"
                  onClick={() => setAssetSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--overlay-medium)',
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    textAlign: 'center',
                    fontWeight: 500,
                    width: '100%'
                  }}
                >
                  {assetSortOrder === 'asc' ? '⬆️ Ascendente' : '⬇️ Discendente'}
                </button>
              </div>
            </div>
          )}

          <div className="asset-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {assets.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center', fontStyle: 'italic', padding: '1.5rem 0' }}>Nessun asset in portafoglio. Creane uno usando il modulo a destra.</p>
            ) : processedAssets.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center', fontStyle: 'italic', padding: '1.5rem 0' }}>Nessun asset corrisponde ai filtri impostati.</p>
            ) : (
              processedAssets.map((asset) => {
                const currentQty = getAssetCurrentQuantity(asset);
                const tickerClean = asset.ticker ? asset.ticker.toUpperCase() : '';
                const tData = tickerClean ? tickerData[tickerClean] : null;
                const currentPrice = tData && typeof tData.price === 'number' ? tData.price : asset.unitValue;
                const totalValue = currentQty * currentPrice;

                return (
                  <article
                    className={`asset-card ${selectedAssetIdForDetails === asset.id ? 'active-asset-card' : ''}`}
                    key={asset.id}
                    onClick={() => {
                      if (selectedAssetIdForDetails !== asset.id) {
                        handleCancelEditAssetTransaction();
                      }
                      setSelectedAssetIdForDetails(asset.id);
                    }}
                    style={{
                      padding: '16px 18px',
                      borderRadius: '16px',
                      border: '1px solid var(--border)',
                      backgroundColor: selectedAssetIdForDetails === asset.id ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255,255,255,0.02)',
                      borderLeft: selectedAssetIdForDetails === asset.id ? '4px solid #10b981' : '1px solid var(--border)',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: selectedAssetIdForDetails === asset.id ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <div className="asset-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem', fontWeight: 500, margin: 0, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                          {asset.name}
                          {asset.ticker ? (
                            <span className="ticker-badge" style={{
                              fontSize: '0.625rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(56, 189, 248, 0.1)',
                              color: '#38bdf8',
                              border: '1px solid rgba(56, 189, 248, 0.2)',
                              letterSpacing: '0.03em',
                              fontFamily: 'var(--font-mono)'
                            }}>
                              {tickerClean}
                            </span>
                          ) : null}
                        </h3>
                        <p style={{ margin: '6px 0 0 0', fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span>{formatAssetKindLabel(asset.kind, asset.etfSubtype)} · <strong style={{ color: 'var(--text)', fontWeight: 500 }}>{asset.institution}</strong></span>
                          {(asset.kind.includes('etf') || asset.etfSubtype) && (
                            <span
                              style={{
                                fontSize: '0.68rem',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontWeight: 650,
                                background: isAssetBondEtf(asset) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                                color: isAssetBondEtf(asset) ? '#10b981' : '#3b82f6',
                                border: `1px solid ${isAssetBondEtf(asset) ? 'rgba(16, 185, 129, 0.25)' : 'rgba(59, 130, 246, 0.25)'}`,
                              }}
                            >
                              {isAssetBondEtf(asset) ? '🏛️ ETF Obbligazionario (conta in Obbligazioni)' : '📈 ETF Azionario (conta in Azioni)'}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="asset-card-meta" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <strong style={{ fontSize: '1.2rem', color: '#10b981', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {tData ? formatTickerCurrency(totalValue, tData.currency) : formatEuro(totalValue)}
                        </strong>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => {
                              if (selectedAssetIdForDetails !== asset.id) {
                                handleCancelEditAssetTransaction();
                              }
                              setSelectedAssetIdForDetails(asset.id);
                            }}
                            style={{ fontSize: '0.725rem', padding: 0, color: '#38bdf8', fontWeight: 500 }}
                          >
                            Dettagli & Transazioni
                          </button>
                          <button className="text-button" type="button" onClick={(e) => { e.stopPropagation(); openEditAsset(asset); }} style={{ fontSize: '0.725rem', padding: 0, color: '#94a3b8', fontWeight: 500 }}>
                            Modifica
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeleteAssetDirect(asset.id); }}
                            style={{
                              fontSize: '0.725rem',
                              padding: 0,
                              color: '#fb7185',
                              fontWeight: 600,
                              textDecoration: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            Elimina
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="asset-details" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.78rem', color: 'var(--muted)', marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '8px' }}>
                      <span>Qta: <strong style={{ color: 'var(--text)' }}>{currentQty}</strong></span>
                      <span>Quotazione: <strong style={{ color: 'var(--text)' }}>{tData && typeof tData.price === 'number' ? formatTickerCurrency(tData.price, tData.currency) : formatEuro(asset.unitValue)}</strong></span>
                      {tData ? (
                        <span style={{ color: tData.price >= tData.previousClose ? '#10b981' : '#f43f5e', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.55rem' }}>●</span> Real-time: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{formatTickerCurrency(tData.price, tData.currency)}</strong>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>
                            ({tData.price >= tData.previousClose ? '+' : ''}{((tData.price - tData.previousClose) / (tData.previousClose || 1) * 100).toFixed(2)}%)
                          </span>
                        </span>
                      ) : asset.ticker ? (
                        <span style={{ color: 'var(--muted)', fontSize: '0.7rem', fontStyle: 'italic' }}>
                          Connessione quotazione in corso...
                        </span>
                      ) : null}
                    </div>
                    {asset.note ? (
                      <p className="asset-note" style={{ margin: '8px 0 0 0', fontSize: '0.725rem', color: 'var(--muted)', fontStyle: 'italic', backgroundColor: 'rgba(255,255,255,0.015)', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                        {asset.note}
                      </p>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </div>

        {selectedAsset ? renderAssetDetailsPanel(selectedAsset) : (
          <div className="panel panel-large" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="panel-header panel-header-wrap" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '0.25rem' }}>
              <div>
                <p className="section-label" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem', color: 'var(--muted)' }}>Editor Asset</p>
                <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '4px 0 0 0' }}>{editingAssetId ? 'Aggiorna Asset' : 'Aggiungi Titolo'}</h2>
              </div>
              {editingAssetId ? <span className="pill pill-soft" style={{ fontSize: '0.7rem', padding: '3px 8px', backgroundColor: 'rgba(234, 179, 8, 0.08)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.15)' }}>Modifica attiva</span> : null}
            </div>
            <form className="transaction-form" onSubmit={handleSubmitAsset}>
              <div className="form-grid">
                <label className="form-field">
                  <span>Nome Strumento</span>
                  <input value={assetDraft.name} onChange={(event) => setAssetDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Es. ETF S&P 500 o Azione Apple" required />
                </label>
                <label className="form-field">
                  <span>Categoria</span>
                  <select
                    value={['azioni', 'obbligazioni', 'etf', 'etf_azionario', 'etf_obbligazionario', 'liquidita', 'fondo', 'cripto', 'proprieta_mobili', 'proprieta_immobili', 'altro'].includes(assetDraft.kind) ? assetDraft.kind : 'custom'}
                    onChange={(event) => {
                      const val = event.target.value;
                      if (val === 'custom') {
                        setAssetDraft((current) => ({ ...current, kind: '', etfSubtype: '' }));
                      } else if (val === 'etf_azionario') {
                        setAssetDraft((current) => ({ ...current, kind: 'etf_azionario', etfSubtype: 'azionario' }));
                      } else if (val === 'etf_obbligazionario') {
                        setAssetDraft((current) => ({ ...current, kind: 'etf_obbligazionario', etfSubtype: 'obbligazionario' }));
                      } else if (val === 'etf') {
                        setAssetDraft((current) => ({ ...current, kind: 'etf', etfSubtype: current.etfSubtype || 'azionario' }));
                      } else {
                        setAssetDraft((current) => ({ ...current, kind: val, etfSubtype: '' }));
                      }
                    }}
                  >
                    <option value="etf_azionario">📈 ETF Azionario (conta come Azioni)</option>
                    <option value="etf_obbligazionario">🏛️ ETF Obbligazionario (conta come Obbligazioni)</option>
                    <option value="azioni">🏢 Azioni Singole</option>
                    <option value="obbligazioni">📜 Obbligazioni Singole / Titoli di Stato</option>
                    <option value="liquidita">💳 Liquidità / Conto Deposito</option>
                    <option value="fondo">📦 Fondo Comune</option>
                    <option value="cripto">🪙 Criptovalute</option>
                    <option value="proprieta_mobili">🚗 Proprietà Mobili</option>
                    <option value="proprieta_immobili">🏠 Proprietà Immobili</option>
                    <option value="altro">Altro</option>
                    <option value="custom">Nuova categoria...</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Istituzione</span>
                  <input value={assetDraft.institution} onChange={(event) => setAssetDraft((current) => ({ ...current, institution: event.target.value }))} placeholder="Es. Fineco, Degiro, N26" required />
                </label>
                {/* Dedicated ETF Subtype Selector */}
                {(assetDraft.kind === 'etf' || assetDraft.kind === 'etf_azionario' || assetDraft.kind === 'etf_obbligazionario') && (
                  <div className="form-field" style={{ gridColumn: 'span 2' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Classificazione ETF per Asset Allocation</span>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <button
                        type="button"
                        className={assetDraft.etfSubtype === 'azionario' || assetDraft.kind === 'etf_azionario' || (assetDraft.kind === 'etf' && assetDraft.etfSubtype !== 'obbligazionario') ? 'pill pill-primary' : 'pill'}
                        onClick={() => setAssetDraft((c) => ({ ...c, kind: 'etf_azionario', etfSubtype: 'azionario' }))}
                        style={{ flex: 1, padding: '7px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      >
                        📈 ETF Azionario (conta come Azioni)
                      </button>
                      <button
                        type="button"
                        className={assetDraft.etfSubtype === 'obbligazionario' || assetDraft.kind === 'etf_obbligazionario' ? 'pill pill-primary' : 'pill'}
                        onClick={() => setAssetDraft((c) => ({ ...c, kind: 'etf_obbligazionario', etfSubtype: 'obbligazionario' }))}
                        style={{ flex: 1, padding: '7px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      >
                        🏛️ ETF Obbligazionario (conta come Obbligazioni)
                      </button>
                    </div>
                    <span style={{ fontSize: '0.73rem', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
                      Gli ETF azionari concorrono al peso delle Azioni nel portafoglio, mentre gli ETF obbligazionari concorrono a quello delle Obbligazioni.
                    </span>
                  </div>
                )}
                {!['azioni', 'obbligazioni', 'etf', 'etf_azionario', 'etf_obbligazionario', 'liquidita', 'fondo', 'cripto', 'proprieta_mobili', 'proprieta_immobili', 'altro'].includes(assetDraft.kind) && (
                  <label className="form-field">
                    <span>Specifica Categoria</span>
                    <input
                      value={assetDraft.kind}
                      onChange={(event) => setAssetDraft((current) => ({ ...current, kind: event.target.value }))}
                      placeholder="Es. Opzioni, Crypto, Beni di lusso..."
                      required
                    />
                  </label>
                )}
                {editingAssetId ? (
                  <>
                    <label className="form-field">
                      <span>Quantità</span>
                      <input value={assetDraft.quantity} onChange={(event) => setAssetDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="0" inputMode="decimal" />
                    </label>
                    <label className="form-field">
                      <span>Quotazione (€)</span>
                      <input value={assetDraft.unitValue} onChange={(event) => setAssetDraft((current) => ({ ...current, unitValue: event.target.value }))} placeholder="0.00" inputMode="decimal" />
                    </label>
                  </>
                ) : null}
                <label className="form-field" style={{ gridColumn: 'span 2' }}>
                  <span>Ticker Quotazione Live (opzionale)</span>
                  <input value={assetDraft.ticker} onChange={(event) => setAssetDraft((current) => ({ ...current, ticker: event.target.value }))} placeholder="Es. AAPL, TSLA, BTC-USD, SWDA.MI" />
                  <span style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>Associa ticker di Yahoo Finance per sincronizzare il prezzo in tempo reale.</span>
                </label>
              </div>
              <label className="form-field form-field-wide">
                <span>Nota</span>
                <textarea rows={3} value={assetDraft.note} onChange={(event) => setAssetDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Aggiungi dettagli o note sulla strategia di investimento" />
              </label>
              <div className="form-actions" style={{ marginTop: '0.5rem' }}>
                <button className="pill pill-primary" type="submit">
                  {editingAssetId ? 'Salva Modifiche' : 'Crea Strumento'}
                </button>
                <button className="pill" type="button" onClick={resetAssetEditor}>
                  Annulla
                </button>
                {editingAssetId && (
                  <button className="danger-button" type="button" onClick={deleteAsset}>
                    Elimina Strumento
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </section>
    );
  };

  const handleSectionChange = (sectionId: SectionId) => {
    setActiveSection(sectionId);
    const sectionLabel = sections.find((section) => section.id === sectionId)?.label ?? sectionId;
    setStatusMessage(`Sezione aperta: ${sectionLabel}.`);
  };

  const handleExportExcel = () => {
    const workbook = buildTransactionsWorkbook(transactions);
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `registro-budget-transazioni-${getTodayIso()}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMessage(`Esportate ${transactions.length} transazioni in Excel.`);
  };

  const handleDownloadTemplate = () => {
    const workbook = buildImportTemplateWorkbook();
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'template-import-transazioni.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMessage('Template Excel scaricato: compila il foglio Transazioni e reimportalo.');
  };

  const setPresetRange = (preset: 'questo-mese' | 'mese-scorso' | 'quest-anno' | 'ultimi-3-mesi' | 'tutto') => {
    const today = new Date();
    let start = '';
    let end = '';

    switch (preset) {
      case 'questo-mese': {
        start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
        break;
      }
      case 'mese-scorso': {
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
        end = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);
        break;
      }
      case 'quest-anno': {
        start = `${today.getFullYear()}-01-01`;
        end = `${today.getFullYear()}-12-31`;
        break;
      }
      case 'ultimi-3-mesi': {
        start = new Date(today.getFullYear(), today.getMonth() - 2, 1).toISOString().slice(0, 10);
        end = today.toISOString().slice(0, 10);
        break;
      }
      case 'tutto': {
        if (transactions.length > 0) {
          const sortedTxDates = [...transactions].map(t => t.date).sort();
          start = sortedTxDates[0] || '2020-01-01';
        } else {
          start = '2020-01-01';
        }
        end = today.toISOString().slice(0, 10);
        break;
      }
    }

    if (start && end) {
      setReportRange({ start, end });
    }
  };

  const handleImportClick = () => {
    setShowImportModal(true);
  };

  const handleReportSliceClick = useCallback((categoryName: string, subcategoryName?: string) => {
    // 1. Go to Transactions section
    setActiveSection('transazioni');
    
    // 2. Filter by Report Range period
    if (reportRange.start) {
      setFilterStartDate(reportRange.start);
    } else {
      setFilterStartDate('');
    }
    if (reportRange.end) {
      setFilterEndDate(reportRange.end);
    } else {
      setFilterEndDate('');
    }

    // 3. Set Categoria
    setFilterCategory(categoryName);

    // 4. Set Sottocategoria (or clear if not specified)
    if (subcategoryName) {
      setFilterSubcategory(subcategoryName);
    } else {
      setFilterSubcategory('');
    }

    // 5. Only show expenses
    setFilterKind('expense');

    // 6. Reset other filters that might restrict view
    setFilterAccount('');
    setFilterMinAmount('');
    setFilterMaxAmount('');
    setSearchQuery('');
  }, [reportRange]);

  const handleConfirmImportData = (
    importedTransactions: ParsedTransaction[],
    importedAssetsList?: any[],
    importedAssetTxsList?: any[],
    destinationAccount?: string
  ) => {
    // 1. Merge standard transactions
    if (importedTransactions.length > 0) {
      setTransactions((currentTransactions) => {
        const map = new Map<string, Transaction>();

        currentTransactions.forEach((transaction) => {
          map.set(transaction.id, transaction);
        });

        importedTransactions.forEach((imported) => {
          const finalTx: Transaction = {
            id: imported.id,
            createdAt: imported.createdAt,
            date: imported.date,
            merchant: imported.merchant,
            category: imported.category,
            subcategory: imported.subcategory,
            account: destinationAccount || imported.account || 'Conto Principale',
            amount: imported.amount,
            kind: imported.kind,
            note: imported.note,
          };
          map.set(finalTx.id, finalTx);
        });

        const merged = Array.from(map.values()).sort((left, right) => right.createdAt - left.createdAt);
        setTransactionOrder((currentOrder) => {
          const nextIds = merged.map((transaction) => transaction.id);
          const preserved = currentOrder.filter((id) => nextIds.includes(id));
          const appended = nextIds.filter((id) => !preserved.includes(id));
          return [...preserved, ...appended];
        });
        return merged;
      });
    }

    // 2. Merge assets and re-link imported transactions to existing assets if name matches
    if (importedAssetsList && importedAssetsList.length > 0) {
      setAssets((currentAssets) => {
        const nextAssets = [...currentAssets];
        importedAssetsList.forEach((imported) => {
          const existingIndex = nextAssets.findIndex((a) => a.name.toLowerCase() === imported.name.toLowerCase());
          if (existingIndex !== -1) {
            const existingId = nextAssets[existingIndex].id;
            
            // Re-route imported transaction assetIds to the existing asset ID
            if (importedAssetTxsList) {
              importedAssetTxsList.forEach((tx) => {
                if (tx.assetId === imported.id) {
                  tx.assetId = existingId;
                }
              });
            }

            // Merge properties
            nextAssets[existingIndex] = {
              ...nextAssets[existingIndex],
              kind: imported.kind,
              institution: imported.institution || nextAssets[existingIndex].institution,
              quantity: imported.quantity !== 0 ? imported.quantity : nextAssets[existingIndex].quantity,
              unitValue: imported.unitValue !== 0 ? imported.unitValue : nextAssets[existingIndex].unitValue,
              ticker: imported.ticker || nextAssets[existingIndex].ticker,
              note: imported.note || nextAssets[existingIndex].note,
            };
          } else {
            nextAssets.push(imported);
          }
        });
        return nextAssets;
      });
    }

    // 3. Merge asset transactions avoiding duplicates
    if (importedAssetTxsList && importedAssetTxsList.length > 0) {
      setAssetTransactions((currentTxs) => {
        const nextTxs = [...currentTxs];
        importedAssetTxsList.forEach((importedTx) => {
          const isDuplicate = nextTxs.some((tx) => 
            tx.assetId === importedTx.assetId &&
            tx.date === importedTx.date &&
            tx.kind === importedTx.kind &&
            Math.abs(tx.quantity - importedTx.quantity) < 0.0001 &&
            Math.abs(tx.unitValue - importedTx.unitValue) < 0.0001
          );
          if (!isDuplicate) {
            nextTxs.push(importedTx);
          }
        });
        return nextTxs;
      });
    }

    // 4. Navigate to correct view & build status message
    const msgParts: string[] = [];
    if (importedTransactions.length > 0) {
      msgParts.push(`importate ${importedTransactions.length} transazioni`);
    }
    if (importedAssetsList && importedAssetsList.length > 0) {
      msgParts.push(`importati ${importedAssetsList.length} asset`);
    }
    if (importedAssetTxsList && importedAssetTxsList.length > 0) {
      msgParts.push(`importate ${importedAssetTxsList.length} operazioni asset`);
    }

    if (importedAssetsList && importedAssetsList.length > 0 && importedTransactions.length === 0) {
      setActiveSection('attivita');
    } else {
      setActiveSection('transazioni');
    }

    setStatusMessage(`${msgParts.join(', ')} con successo (salvato automaticamente).`);
    setShowImportModal(false);
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setStatusMessage('Il file selezionato supera la dimensione massima consentita di 50 MB.');
      setShowImportModal(false);
      return;
    }

    setShowImportModal(true);
  };

  const startNewBudgetCategory = () => {
    setEditingBudgetId(null);
    setBudgetDraft(defaultBudgetDraft());
    setActiveSection('budget');
    setStatusMessage('Nuovo budget pronto per l’inserimento.');
  };

  const openEditBudgetCategory = (category: BudgetCategory) => {
    setEditingBudgetId(category.id);
    setBudgetDraft({
      name: category.name,
      limit: category.limit.toString(),
      limitType: category.limitType || 'fixed',
      limitPercent: (category.limitPercent || 0).toString(),
      color: category.color,
      note: category.note,
      subcategories: category.subcategories.map((subcategory) => ({
        id: subcategory.id,
        name: subcategory.name,
        limit: subcategory.limit.toString(),
        limitType: subcategory.limitType || 'fixed',
        limitPercent: (subcategory.limitPercent || 0).toString(),
        note: subcategory.note,
      })),
    });
    setActiveSection('budget');
    setStatusMessage(`Budget aperto per la modifica: ${category.name}.`);
  };

  const resetBudgetEditor = () => {
    setEditingBudgetId(null);
    setBudgetDraft(defaultBudgetDraft());
    setStatusMessage('Editor budget svuotato.');
  };

  const updateBudgetDraft = (field: keyof Omit<BudgetCategoryDraft, 'subcategories'>, value: string) => {
    setBudgetDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
  };

  const addBudgetSubcategoryDraft = () => {
    setBudgetDraft((currentDraft) => ({
      ...currentDraft,
      subcategories: [...currentDraft.subcategories, createBudgetSubcategoryDraft()],
    }));
  };

  const updateBudgetSubcategoryDraft = (
    subcategoryId: string,
    field: keyof Omit<BudgetSubcategoryDraft, 'id'>,
    value: string,
  ) => {
    setBudgetDraft((currentDraft) => ({
      ...currentDraft,
      subcategories: currentDraft.subcategories.map((subcategory) =>
        subcategory.id === subcategoryId ? { ...subcategory, [field]: value } : subcategory,
      ),
    }));
  };

  const removeBudgetSubcategoryDraft = (subcategoryId: string) => {
    setBudgetDraft((currentDraft) => ({
      ...currentDraft,
      subcategories: currentDraft.subcategories.filter((subcategory) => subcategory.id !== subcategoryId),
    }));
  };

  const handleSubmitBudgetCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const limitType = budgetDraft.limitType || 'fixed';
    const limitPercentNum = budgetDraft.limitPercent.trim() === '' ? 0 : Number(budgetDraft.limitPercent.replace(',', '.'));
    const normalizedLimit = budgetDraft.limit.trim() === '' ? 0 : Number(budgetDraft.limit.replace(',', '.'));

    const normalizedSubcategories = budgetDraft.subcategories
      .map((subcategory) => {
        const subLimitType = subcategory.limitType || 'fixed';
        const subLimitPercentNum = subcategory.limitPercent.trim() === '' ? 0 : Number(subcategory.limitPercent.replace(',', '.'));
        const subNormalizedLimit = subcategory.limit.trim() === '' ? 0 : Number(subcategory.limit.replace(',', '.'));

        return {
          id: subcategory.id,
          name: subcategory.name.trim(),
          limit: subLimitType === 'percentage' ? 0 : (Number.isFinite(subNormalizedLimit) ? subNormalizedLimit : 0),
          limitType: subLimitType,
          limitPercent: subLimitType === 'percentage' ? (Number.isFinite(subLimitPercentNum) ? subLimitPercentNum : 0) : undefined,
          note: subcategory.note.trim(),
        };
      })
      .filter((subcategory) => subcategory.name.length > 0);

    const isCategoryInvalid =
      !budgetDraft.name.trim() ||
      (limitType === 'fixed' && !Number.isFinite(normalizedLimit)) ||
      (limitType === 'percentage' && (!Number.isFinite(limitPercentNum) || limitPercentNum < 0 || limitPercentNum > 100));

    const isSubcategoryInvalid = normalizedSubcategories.some((subcategory) => {
      const subLimitType = subcategory.limitType || 'fixed';
      if (subLimitType === 'fixed') {
        return !Number.isFinite(subcategory.limit) || subcategory.limit < 0;
      } else {
        return subcategory.limitPercent !== undefined && (!Number.isFinite(subcategory.limitPercent) || subcategory.limitPercent < 0 || subcategory.limitPercent > 100);
      }
    });

    if (isCategoryInvalid || isSubcategoryInvalid) {
      setStatusMessage('Inserisci un nome budget e valori validi.');
      return;
    }

    const previousCategory = editingBudgetId ? budgetCategories.find((category) => category.id === editingBudgetId) ?? null : null;
    const nextCategory: BudgetCategory = {
      id: editingBudgetId ?? `budget-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      name: budgetDraft.name.trim(),
      limit: limitType === 'percentage' ? 0 : normalizedLimit,
      limitType: limitType,
      limitPercent: limitType === 'percentage' ? limitPercentNum : undefined,
      color: budgetDraft.color,
      note: budgetDraft.note.trim(),
      subcategories: normalizedSubcategories,
    };

    setBudgetCategories((currentCategories) => {
      const existingIndex = currentCategories.findIndex((category) => category.id === nextCategory.id);

      if (existingIndex >= 0) {
        const nextCategories = [...currentCategories];
        nextCategories[existingIndex] = nextCategory;
        return nextCategories;
      }

      return [...currentCategories, nextCategory];
    });

    if (previousCategory && previousCategory.name !== nextCategory.name) {
      setTransactions((currentTransactions) =>
        currentTransactions.map((transaction) =>
          transaction.category === previousCategory.name ? { ...transaction, category: nextCategory.name } : transaction,
        ),
      );
    }

    setEditingBudgetId(null);
    setBudgetDraft(defaultBudgetDraft());
    setStatusMessage(previousCategory ? `Budget aggiornato: ${nextCategory.name}. (salvato automaticamente)` : `Budget aggiunto: ${nextCategory.name}. (salvato automaticamente)`);
  };

  const deleteBudgetCategory = () => {
    if (!editingBudgetId) {
      return;
    }

    const targetCategory = budgetCategories.find((category) => category.id === editingBudgetId);

    if (!targetCategory) {
      return;
    }

    askConfirmation({
      title: 'Elimina categoria di budget',
      subtitle: targetCategory.name,
      message: `Sei sicuro di voler eliminare la categoria di budget "${targetCategory.name}"? Le transazioni esistenti manterranno la categoria, ma la soglia limite impostata verrà rimossa.`,
      itemDetails: [
        { label: 'Categoria', value: targetCategory.name },
        { label: 'Limite mensile', value: formatEuro(targetCategory.limit) },
      ],
      confirmLabel: 'Elimina budget',
      onConfirm: () => {
        setBudgetCategories((currentCategories) => currentCategories.filter((category) => category.id !== editingBudgetId));
        resetBudgetEditor();
        setStatusMessage(`Budget eliminato: ${targetCategory.name}. (salvato automaticamente)`);
      },
    });
  };

  const startNewAsset = () => {
    setEditingAssetId(null);
    setAssetDraft(defaultAssetDraft());
    setSelectedAssetIdForDetails(null);
    setActiveSection('attivita');
    setStatusMessage('Nuovo asset pronto per l’inserimento.');
  };

  const openEditAsset = (asset: Asset) => {
    setEditingAssetId(asset.id);
    const inferredEtfSubtype = asset.etfSubtype || (isAssetBondEtf(asset) ? 'obbligazionario' : isAssetEquityEtf(asset) ? 'azionario' : '');
    setAssetDraft({
      name: asset.name,
      kind: asset.kind,
      institution: asset.institution,
      quantity: asset.quantity.toString(),
      unitValue: asset.unitValue.toString(),
      note: asset.note,
      ticker: asset.ticker || '',
      etfSubtype: inferredEtfSubtype,
    });
    setSelectedAssetIdForDetails(null);
    setActiveSection('attivita');
    setStatusMessage(`Asset aperto per la modifica: ${asset.name}.`);
  };

  const resetAssetEditor = () => {
    setEditingAssetId(null);
    setAssetDraft(defaultAssetDraft());
    setStatusMessage('Editor asset svuotato.');
  };

  const handleSubmitAsset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    let quantity = 0;
    let unitValue = 0;

    if (editingAssetId) {
      quantity = Number(assetDraft.quantity.replace(',', '.'));
      unitValue = Number(assetDraft.unitValue.replace(',', '.'));
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitValue) || unitValue < 0) {
        setStatusMessage('Inserisci una quantità e quotazione valide.');
        return;
      }
    }

    if (!assetDraft.name.trim() || !assetDraft.institution.trim()) {
      setStatusMessage('Inserisci nome e istituzione validi.');
      return;
    }

    const finalEtfSubtype = assetDraft.etfSubtype || (assetDraft.kind === 'etf_obbligazionario' ? 'obbligazionario' : assetDraft.kind === 'etf_azionario' || assetDraft.kind === 'etf' ? 'azionario' : undefined);

    const nextAsset: Asset = {
      id: editingAssetId ?? `asset-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      name: assetDraft.name.trim(),
      kind: assetDraft.kind,
      institution: assetDraft.institution.trim(),
      quantity,
      unitValue,
      note: assetDraft.note.trim(),
      createdAt: assets.find((asset) => asset.id === editingAssetId)?.createdAt ?? Date.now(),
      ticker: assetDraft.ticker.trim() ? assetDraft.ticker.trim().toUpperCase() : undefined,
      etfSubtype: finalEtfSubtype as ('azionario' | 'obbligazionario' | undefined),
    };

    if (!editingAssetId) {
      // Creation of new asset starts with 0 qty/value. No initial transaction is added to keep history clean.
    }

    setAssets((currentAssets) => {
      const existingIndex = currentAssets.findIndex((asset) => asset.id === nextAsset.id);

      if (existingIndex >= 0) {
        const nextAssets = [...currentAssets];
        nextAssets[existingIndex] = nextAsset;
        return nextAssets.sort((left, right) => right.createdAt - left.createdAt);
      }

      return [nextAsset, ...currentAssets].sort((left, right) => right.createdAt - left.createdAt);
    });

    setEditingAssetId(null);
    setAssetDraft(defaultAssetDraft());
    setStatusMessage(editingAssetId ? `Asset aggiornato: ${nextAsset.name}. (salvato automaticamente)` : `Asset aggiunto: ${nextAsset.name}. (salvato automaticamente)`);
  };

  const deleteAsset = () => {
    if (!editingAssetId) {
      return;
    }

    const targetAsset = assets.find((asset) => asset.id === editingAssetId);
    if (!targetAsset) {
      return;
    }

    handleDeleteAssetDirect(editingAssetId);
    resetAssetEditor();
  };

  const renderDashboard = () => (
    <>
      <section className="hero">
        <div>
          <p className="hero-label">Stato budget famigliare</p>
          <h3>Un quadro completo per vedere flusso di cassa, pressione sulle categorie e progresso del risparmio.</h3>
          <p className="hero-copy">
            
          </p>
        </div>

        <div className="hero-rail">
          <div className="hero-rail-item">
            <span className="rail-label">Utilizzo budget</span>
            <strong>{budgetUsage}%</strong>
            <div className="progress">
              <span style={{ width: `${budgetUsage}%` }} />
            </div>
          </div>
          <div className="hero-rail-item">
            <span className="rail-label">Entrate del mese</span>
            <strong>{formatEuro(currentMonthIncomeTotal)}</strong>
          </div>
        </div>
      </section>

      <section className="metric-grid">
        {dashboardCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </section>

      <section className="content-grid">
        <article className="panel large-panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Budget per categoria</p>
              <h4>Allocazione dettagliata e margine residuo</h4>
            </div>
            <button className="ghost-button" type="button" onClick={() => setActiveSection('budget')}>
              Vedi tutte le categorie
            </button>
          </div>

          <div className="category-list">
            {categoryRows.map((category) => (
              <div className="category-row" key={category.name} style={{ borderLeft: `4px solid ${category.color || 'var(--primary)'}` }}>
                <div className="category-meta">
                  <div className="category-dot" style={{ background: category.color }} />
                  <div>
                    <strong>{category.name}</strong>
                    <p>{category.note}</p>
                  </div>
                </div>

                <div className="category-stats">
                  <span>
                    {formatEuro(category.spent)} / {formatEuro(category.limit)}
                  </span>
                  <div className="progress slim">
                    <span style={{ width: `${category.ratio}%`, background: category.color }} />
                  </div>
                  <small>{formatEuro(category.remaining)} residui</small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <p className="panel-title">Andamento mensile {currentYear}</p>
              <h4>Entrate vs Uscite</h4>
              <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', marginTop: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: 'linear-gradient(180deg, #34d399, #10b981)' }} />
                  <span style={{ color: 'var(--muted)' }}>Entrate</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: 'linear-gradient(180deg, #fb7185, #f43f5e)' }} />
                  <span style={{ color: 'var(--muted)' }}>Uscite</span>
                </div>
              </div>
            </div>
            <button className="ghost-button" type="button" onClick={() => setActiveSection('report')}>
              Apri report
            </button>
          </div>

          <div className="bar-chart" aria-label="Monthly comparison dashboard chart" style={{ gridTemplateColumns: `repeat(${currentYearMonthlyData.length}, minmax(0, 1fr))`, minHeight: '260px' }}>
            {(() => {
              const maxVal = Math.max(...currentYearMonthlyData.map((p) => Math.max(p.income, p.expenses)), 1);
              return currentYearMonthlyData.map((point) => (
                <div className="bar-column" key={point.label} style={{ gap: '6px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontSize: '0.7rem', lineHeight: 1.1, minHeight: '32px', justifyContent: 'end' }}>
                    <span style={{ color: '#10b981', fontWeight: 600 }}>{formatEuroCompact(point.income)}</span>
                    <span style={{ color: '#f43f5e', fontWeight: 600 }}>{formatEuroCompact(point.expenses)}</span>
                  </div>
                  <div className="bar-track" style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', justifyContent: 'center', padding: '4px' }}>
                    <span
                      title={`Entrate: ${formatEuro(point.income)}`}
                      style={{
                        height: `${Math.max((point.income / maxVal) * 100, 4)}%`,
                        background: 'linear-gradient(180deg, #34d399, #10b981)',
                        boxShadow: '0 8px 16px rgba(16, 185, 129, 0.16)',
                        borderRadius: '6px',
                        width: '100%'
                      }}
                    />
                    <span
                      title={`Uscite: ${formatEuro(point.expenses)}`}
                      style={{
                        height: `${Math.max((point.expenses / maxVal) * 100, 4)}%`,
                        background: 'linear-gradient(180deg, #fb7185, #f43f5e)',
                        boxShadow: '0 8px 16px rgba(244, 63, 94, 0.16)',
                        borderRadius: '6px',
                        width: '100%'
                      }}
                    />
                  </div>
                  <span className="bar-label" style={{ fontWeight: 500, color: 'var(--text)' }}>{point.label}</span>
                </div>
              ));
            })()}
          </div>
        </article>
      </section>

      <section className="content-grid" style={{ gridTemplateColumns: '1fr' }}>
        <article className="panel large-panel" style={{ margin: 0 }}>
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <p className="panel-title">Distribuzione Spese (Riepilogo)</p>
              <h4>Analisi a torta per categoria e sottocategoria</h4>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', color: 'var(--muted)' }}>
                <span>Inizio intervallo</span>
                <input
                  type="date"
                  value={reportRange.start}
                  style={{
                    background: 'rgba(8, 16, 30, 0.6)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '4px 8px',
                    color: '#fff',
                    marginTop: '2px',
                    font: 'inherit',
                    fontSize: '0.8rem'
                  }}
                  onChange={(event) => setReportRange((current) => ({ ...current, start: event.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', color: 'var(--muted)' }}>
                <span>Fine intervallo</span>
                <input
                  type="date"
                  value={reportRange.end}
                  style={{
                    background: 'rgba(8, 16, 30, 0.6)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '4px 8px',
                    color: '#fff',
                    marginTop: '2px',
                    font: 'inherit',
                    fontSize: '0.8rem'
                  }}
                  onChange={(event) => setReportRange((current) => ({ ...current, end: event.target.value }))}
                />
              </label>
            </div>
          </div>

          {reportCategoryBreakdown.length === 0 ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '220px', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Nessuna spesa registrata nell'intervallo selezionato.
            </div>
          ) : (
            <div className="pie-chart-container" style={{ display: 'flex', gap: '32px', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
              
              {/* SVG PIE CHART */}
              <div style={{ position: 'relative', width: '300px', height: '300px', flexShrink: 0 }}>
                <svg viewBox="0 0 240 240" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                  <g>
                    {(() => {
                      let currentAngle = 0;
                      return reportCategoryBreakdown.map((cat) => {
                        const angleSpan = (cat.spent / reportExpenseTotal) * 360;
                        const catStartAngle = currentAngle;
                        const catEndAngle = currentAngle + angleSpan;
                        currentAngle = catEndAngle;

                        const isCatHovered = activeCategory === cat.name || (hoveredSlice && hoveredSlice.name === cat.name && !hoveredSlice.isSub);
                        const scale = isCatHovered ? 1.05 : 1.0;
                        const slicePath = getDonutSlicePath(120, 120, 48 * scale, 75 * scale, catStartAngle, catEndAngle);

                        return (
                          <g key={`dash-cat-g-${cat.name}`}>
                            <path
                              d={slicePath}
                              fill={cat.color}
                              stroke="var(--bg)"
                              strokeWidth="1.5"
                              style={{ transition: 'all 0.2s ease', cursor: 'pointer' }}
                              onClick={() => handleReportSliceClick(cat.name)}
                              onMouseEnter={() => {
                                setHoveredSlice({
                                  name: cat.name,
                                  spent: cat.spent,
                                  percent: (cat.spent / reportExpenseTotal) * 100,
                                  color: cat.color,
                                  isSub: false,
                                });
                                setActiveCategory(cat.name);
                              }}
                              onMouseLeave={() => {
                                setHoveredSlice(null);
                                setActiveCategory(null);
                              }}
                            />
                            
                            {/* Subcategories */}
                            {(() => {
                              let subCurrentAngle = catStartAngle;
                              return cat.subcategories.map((sub, sIdx) => {
                                const subAngleSpan = (sub.spent / cat.spent) * angleSpan;
                                const subStartAngle = subCurrentAngle;
                                const subEndAngle = subCurrentAngle + subAngleSpan;
                                subCurrentAngle = subEndAngle;

                                const isSubHovered = hoveredSlice && hoveredSlice.name === sub.name && hoveredSlice.isSub;
                                const subScale = isSubHovered ? 1.05 : (isCatHovered ? 1.02 : 1.0);
                                const subSlicePath = getDonutSlicePath(120, 120, 78 * subScale, 102 * subScale, subStartAngle, subEndAngle);
                                
                                const subOpacity = Math.max(0.3, 0.85 - sIdx * 0.15);

                                return (
                                  <path
                                    key={`dash-sub-path-${cat.name}-${sub.name}`}
                                    d={subSlicePath}
                                    fill={cat.color}
                                    opacity={subOpacity}
                                    stroke="var(--bg)"
                                    strokeWidth="1"
                                    style={{ transition: 'all 0.2s ease', cursor: 'pointer' }}
                                    onClick={() => handleReportSliceClick(cat.name, sub.name)}
                                    onMouseEnter={() => {
                                      setHoveredSlice({
                                        name: sub.name,
                                        spent: sub.spent,
                                        percent: (sub.spent / reportExpenseTotal) * 100,
                                        color: cat.color,
                                        isSub: true,
                                      });
                                      setActiveCategory(cat.name);
                                    }}
                                    onMouseLeave={() => {
                                      setHoveredSlice(null);
                                      setActiveCategory(null);
                                    }}
                                  />
                                );
                              });
                            })()}
                          </g>
                        );
                      });
                    })()}
                  </g>
                </svg>

                {/* Center Hole Tooltip/Display */}
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  width: '110px',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}>
                  {hoveredSlice ? (
                    <>
                      <div style={{
                        fontSize: '0.78rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: hoveredSlice.isSub ? 'var(--muted)' : 'var(--text)',
                        fontWeight: hoveredSlice.isSub ? 400 : 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {hoveredSlice.name}
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: hoveredSlice.color, marginTop: '2px' }}>
                        {formatEuro(hoveredSlice.spent)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '1px' }}>
                        {hoveredSlice.percent.toFixed(1)}%
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }}>
                        Spese
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', marginTop: '2px' }}>
                        {formatEuro(reportExpenseTotal)}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '1px' }}>
                        Selezionato
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* DETAILED LEGEND / EXPANDABLE LIST */}
              <div style={{ flex: 1, minWidth: '240px', maxHeight: '220px', overflowY: 'auto', paddingRight: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {reportCategoryBreakdown.map((cat) => {
                    const isCatActive = activeCategory === cat.name;
                    return (
                      <div
                        key={`dash-legend-${cat.name}`}
                        style={{
                          background: isCatActive ? 'rgba(255,255,255,0.03)' : 'transparent',
                          borderRadius: '10px',
                          padding: '6px 10px',
                          transition: 'all 0.2s ease',
                          cursor: 'pointer',
                          border: isCatActive ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent'
                        }}
                        onClick={() => handleReportSliceClick(cat.name)}
                        onMouseEnter={() => setActiveCategory(cat.name)}
                        onMouseLeave={() => setActiveCategory(null)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cat.color }} />
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>{cat.name}</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{formatEuro(cat.spent)}</strong>
                            <small style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: '6px' }}>
                              ({((cat.spent / reportExpenseTotal) * 100).toFixed(1)}%)
                            </small>
                          </div>
                        </div>

                        {/* Expandable subcategories */}
                        {isCatActive && cat.subcategories.length > 0 && (
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            marginTop: '6px',
                            paddingLeft: '18px',
                            borderLeft: `1.5px solid ${cat.color}`,
                            paddingBottom: '2px'
                          }}>
                            {cat.subcategories.map((sub) => (
                              <div
                                key={`dash-legend-sub-${cat.name}-${sub.name}`}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  fontSize: '0.75rem',
                                  color: 'var(--muted)',
                                  cursor: 'pointer'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation(); // Avoid triggering parent Category's onClick
                                  handleReportSliceClick(cat.name, sub.name);
                                }}
                                onMouseEnter={() => {
                                  setHoveredSlice({
                                    name: sub.name,
                                    spent: sub.spent,
                                    percent: (sub.spent / reportExpenseTotal) * 100,
                                    color: cat.color,
                                    isSub: true,
                                  });
                                }}
                                onMouseLeave={() => {
                                  setHoveredSlice(null);
                                }}
                              >
                                <span>{sub.name}</span>
                                <div>
                                  <strong>{formatEuro(sub.spent)}</strong>
                                  <small style={{ fontSize: '0.65rem', marginLeft: '4px' }}>
                                    ({((sub.spent / cat.spent) * 100).toFixed(0)}%)
                                  </small>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}
        </article>
      </section>

      <section className="content-grid secondary-grid">
        <article className="panel large-panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Attività recente</p>
              <h4>Ultime transazioni e movimenti del conto</h4>
            </div>
          </div>

          <div className="transaction-table">
            {recentTransactions.map((transaction) => (
              <div className="transaction-row" key={transaction.id}>
                <div>
                  <strong>{transaction.merchant}</strong>
                  <p>
                    {formatCategoryPath(transaction.category, transaction.subcategory)} · {transaction.account}
                  </p>
                  <small>{formatDisplayDate(transaction.date)} · {transaction.note || 'Nessuna nota'}</small>
                </div>
                <span>{formatKindLabel(transaction.kind, transaction.category, transaction.subcategory)}</span>
                <strong
                  className={
                    isTransferCategory(transaction.category, transaction.subcategory)
                      ? 'amount'
                      : transaction.kind === 'income'
                      ? 'amount positive'
                      : 'amount negative'
                  }
                  style={isTransferCategory(transaction.category, transaction.subcategory) ? { color: '#38bdf8' } : undefined}
                >
                  {isTransferCategory(transaction.category, transaction.subcategory)
                    ? `⇆ ${formatEuro(Math.abs(transaction.amount))}`
                    : formatSignedEuro(transaction.amount)}
                </strong>
                <button className="ghost-button" type="button" onClick={() => openEditTransaction(transaction)}>
                  Modifica
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="panel networth-panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Patrimonio netto</p>
              <h4>Attività, passività e autonomia finanziaria</h4>
            </div>
          </div>

          <div className="networth-value">{formatEuro(currentNetWorth)}</div>
          <p className="networth-copy">
            Attività: {formatEuro(totalAssetsVal)} · Passività: {formatEuro(totalLiabilitiesVal)}
          </p>

          <div className="stacked-bars">
            <div className="stacked-bar assets" style={{ width: `${assetsPercent}%` }} />
            <div className="stacked-bar liabilities" style={{ width: `${liabilitiesPercent}%` }} />
          </div>

          <div className="bottom-note" style={{ display: 'flex' }}>
            <span>Autonomia di emergenza</span>
            <strong>{emergencyAutonomyMonths} {emergencyAutonomyMonths === 1 ? 'mese' : 'mesi'}</strong>
          </div>
        </article>
      </section>
    </>
  );

  const renderTransactions = () => {
    const hasActiveFilters = Boolean(
      filterStartDate ||
      filterEndDate ||
      filterCategory ||
      filterSubcategory ||
      filterAccount ||
      filterKind ||
      filterReimbursement ||
      filterMinAmount ||
      filterMaxAmount ||
      searchQuery.trim()
    );

    const handleApplyDatePreset = (preset: string) => {
      setActiveDatePreset(preset);
      const range = getPresetDateRange(preset);
      setFilterStartDate(range.start);
      setFilterEndDate(range.end);
    };

    const handleApplyAmountPreset = (preset: string) => {
      setFilterAmountPreset(preset);
      if (preset === 'under50') {
        setFilterMinAmount('');
        setFilterMaxAmount('50');
      } else if (preset === '50to200') {
        setFilterMinAmount('50');
        setFilterMaxAmount('200');
      } else if (preset === 'over200') {
        setFilterMinAmount('200');
        setFilterMaxAmount('');
      } else if (preset === 'over1000') {
        setFilterMinAmount('1000');
        setFilterMaxAmount('');
      } else {
        setFilterMinAmount('');
        setFilterMaxAmount('');
      }
    };

    const handleResetAllFilters = () => {
      setFilterStartDate('');
      setFilterEndDate('');
      setActiveDatePreset('all');
      setFilterCategory('');
      setFilterSubcategory('');
      setFilterAccount('');
      setFilterKind('');
      setFilterReimbursement('');
      setFilterMinAmount('');
      setFilterMaxAmount('');
      setFilterAmountPreset('all');
      setSearchQuery('');
    };

    return (
      <section className="section-grid transactions-layout">
        <article className="panel large-panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Archivio transazioni</p>
              <h4>
                {filteredTransactions.length} movimenti trovati
                {filteredTransactions.length !== transactions.length && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 400, marginLeft: '8px' }}>
                    (su {transactions.length} totali)
                  </span>
                )}
              </h4>
            </div>
            <div className="section-actions">
              <button className="pill" type="button" onClick={toggleAllFilteredTransactions}>
                {allFilteredSelected ? 'Deseleziona filtrate' : 'Seleziona filtrate'}
              </button>
              <button className="pill pill-primary" type="button" onClick={startNewTransaction}>
                Nuova transazione
              </button>
            </div>
          </div>

          {/* Schede di Riepilogo e Somma Transazioni Filtrate */}
          <div className="tx-summary-grid">
            <div className="tx-summary-card">
              <div className="card-label">
                <span>Saldo Netto Filtrato</span>
                <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: filteredSummary.netTotal >= 0 ? 'rgba(52, 211, 153, 0.15)' : 'rgba(251, 113, 133, 0.15)', color: filteredSummary.netTotal >= 0 ? '#34d399' : '#fb7185' }}>
                  {filteredSummary.netTotal >= 0 ? 'Surplus' : 'Deficit'}
                </span>
              </div>
              <div className={`card-value ${filteredSummary.netTotal >= 0 ? 'net-positive' : 'net-negative'}`}>
                {formatSignedEuro(filteredSummary.netTotal)}
              </div>
              <div className="card-subtext">
                {filteredSummary.totalCount} {filteredSummary.totalCount === 1 ? 'movimento analizzato' : 'movimenti analizzati'}
              </div>
            </div>

            <div className="tx-summary-card">
              <div className="card-label">
                <span>Totale Entrate</span>
                <span style={{ fontSize: '0.7rem', color: '#34d399', fontWeight: 600 }}>
                  {filteredSummary.incomeCount} {filteredSummary.incomeCount === 1 ? 'accredito' : 'accrediti'}
                </span>
              </div>
              <div className="card-value" style={{ color: '#34d399' }}>
                +{formatEuro(filteredSummary.totalIncome)}
              </div>
              <div className="card-subtext">
                {filteredSummary.totalCount > 0 ? `${((filteredSummary.incomeCount / filteredSummary.totalCount) * 100).toFixed(0)}% del totale movimenti` : '0%'}
              </div>
            </div>

            <div className="tx-summary-card">
              <div className="card-label">
                <span>Totale Uscite / Spese</span>
                <span style={{ fontSize: '0.7rem', color: '#fb7185', fontWeight: 600 }}>
                  {filteredSummary.expenseCount} {filteredSummary.expenseCount === 1 ? 'addebito' : 'addebiti'}
                </span>
              </div>
              <div className="card-value" style={{ color: '#fb7185' }}>
                -{formatEuro(filteredSummary.totalExpense)}
              </div>
              <div className="card-subtext">
                {filteredSummary.totalCount > 0 ? `${((filteredSummary.expenseCount / filteredSummary.totalCount) * 100).toFixed(0)}% del totale movimenti` : '0%'}
              </div>
            </div>

            <div className="tx-summary-card">
              <div className="card-label">
                <span>Media per Movimento</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                  Volume lordo
                </span>
              </div>
              <div className="card-value" style={{ color: 'var(--text)' }}>
                {formatEuro(filteredSummary.avgTransaction)}
              </div>
              <div className="card-subtext">
                Volume tot: {formatEuro(filteredSummary.totalIncome + filteredSummary.totalExpense)}
              </div>
            </div>
          </div>

          {/* Scheda Gestione Rimborsi */}
          {reimbursementStats.totalTracked > 0 && (
            <div
              style={{
                marginTop: '16px',
                padding: '14px 18px',
                borderRadius: '14px',
                background: 'var(--panel-strong)',
                border: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.4rem' }}>🔄</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--text)' }}>
                      Gestione Spese con Rimborso
                    </strong>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '1px 8px',
                        borderRadius: '999px',
                        background: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                        fontWeight: 650,
                      }}
                    >
                      {reimbursementStats.totalTracked} {reimbursementStats.totalTracked === 1 ? 'spesa monitorata' : 'spese monitorate'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '2px' }}>
                    Monitora lo stato delle spese da rimborsare e le entrate collegate.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setFilterReimbursement((curr) => (curr === 'pending' ? '' : 'pending'))}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    backgroundColor: filterReimbursement === 'pending' ? 'rgba(245, 158, 11, 0.22)' : 'rgba(245, 158, 11, 0.08)',
                    borderColor: filterReimbursement === 'pending' ? '#f59e0b' : 'rgba(245, 158, 11, 0.35)',
                    color: '#f59e0b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  title="Filtra le spese ancora in attesa di rimborso totale o parziale"
                >
                  <span>⏳ Da rimborsare:</span>
                  <strong>{formatEuro(reimbursementStats.pendingAmount)}</strong>
                  <span style={{ opacity: 0.85, fontSize: '0.7rem' }}>
                    ({reimbursementStats.pendingCount + reimbursementStats.partialCount})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterReimbursement((curr) => (curr === 'reimbursed' ? '' : 'reimbursed'))}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    backgroundColor: filterReimbursement === 'reimbursed' ? 'rgba(16, 185, 129, 0.22)' : 'rgba(16, 185, 129, 0.08)',
                    borderColor: filterReimbursement === 'reimbursed' ? '#10b981' : 'rgba(16, 185, 129, 0.35)',
                    color: '#10b981',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  title="Filtra le spese che sono state completamente rimborsate"
                >
                  <span>✅ Rimborsate:</span>
                  <strong>{formatEuro(reimbursementStats.reimbursedAmount)}</strong>
                  <span style={{ opacity: 0.85, fontSize: '0.7rem' }}>
                    ({reimbursementStats.reimbursedCount})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowReimbursementSchedule((prev) => !prev)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 650,
                    cursor: 'pointer',
                    border: '1px solid',
                    backgroundColor: showReimbursementSchedule ? 'var(--accent)' : 'rgba(56, 189, 248, 0.12)',
                    borderColor: showReimbursementSchedule ? 'var(--accent)' : 'rgba(56, 189, 248, 0.35)',
                    color: showReimbursementSchedule ? 'var(--pill-primary-text)' : '#38bdf8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  title="Apri lo Scadenzario Rimborsi con date previste, monitoraggio ritardi e solleciti"
                >
                  <span>📅 {showReimbursementSchedule ? 'Nascondi Scadenzario' : 'Scadenzario Rimborsi'}</span>
                </button>

                {filterReimbursement && (
                  <button
                    type="button"
                    onClick={() => setFilterReimbursement('')}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '8px',
                      fontSize: '0.74rem',
                      color: 'var(--muted)',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    Rimuovi filtro rimborsi ✕
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Scadenzario Rimborsi Espanso */}
          {showReimbursementSchedule && (
            <div style={{ marginTop: '16px' }}>
              <ReimbursementSchedulePanel
                transactions={transactions}
                reimbursementMap={reimbursementMap}
                formatEuro={formatEuro}
                formatDisplayDate={formatDisplayDate}
                onStartReimbursement={handleStartReimbursementForExpense}
                onUpdateDueDate={handleUpdateReimbursementDueDate}
                onClose={() => setShowReimbursementSchedule(false)}
              />
            </div>
          )}

          {/* Barra Dinamica Somma Selezionate */}
          {selectedTransactions.length > 0 && (
            <div className="tx-selection-bar">
              <div className="tx-selection-stats">
                <span className="tx-selection-badge">
                  ✓ {selectedTransactions.length} selezionate
                </span>
                <div className="tx-selection-item">
                  <span style={{ color: 'var(--muted)' }}>Saldo Netto:</span>
                  <strong className={selectedSummary.netTotal >= 0 ? 'net-positive' : 'net-negative'}>
                    {formatSignedEuro(selectedSummary.netTotal)}
                  </strong>
                </div>
                <div className="tx-selection-item">
                  <span style={{ color: 'var(--muted)' }}>Entrate ({selectedSummary.incomeCount}):</span>
                  <strong style={{ color: '#34d399' }}>+{formatEuro(selectedSummary.totalIncome)}</strong>
                </div>
                <div className="tx-selection-item">
                  <span style={{ color: 'var(--muted)' }}>Uscite ({selectedSummary.expenseCount}):</span>
                  <strong style={{ color: '#fb7185' }}>-{formatEuro(selectedSummary.totalExpense)}</strong>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="pill"
                  type="button"
                  onClick={clearTransactionSelection}
                  style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                >
                  Deseleziona
                </button>
                <button
                  className="pill"
                  type="button"
                  onClick={toggleAllFilteredTransactions}
                  style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                >
                  {allFilteredSelected ? 'Deseleziona filtrate' : `Seleziona tutte (${filteredTransactions.length})`}
                </button>
              </div>
            </div>
          )}

          {/* Pannello dei filtri avanzati */}
          <div style={{
            background: 'var(--panel-strong)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '20px',
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            {/* Riga superiore con Ricerca e Reset */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '260px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                  Filtri e Ricerca
                </span>
                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                  <input
                    type="text"
                    placeholder="Cerca beneficiario, categoria, note, conto..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 28px 7px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--input-bg)',
                      color: 'var(--text)',
                      fontSize: '0.82rem',
                      fontWeight: 500,
                    }}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        padding: 0
                      }}
                      title="Cancella ricerca"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              {hasActiveFilters && (
                <button
                  className="text-button"
                  type="button"
                  onClick={handleResetAllFilters}
                  style={{ fontSize: '0.8rem', color: '#fb7185', background: 'none', border: 'none', padding: '4px 8px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Resetta tutti i filtri ✕
                </button>
              )}
            </div>

            {/* Pulsanti Rapidi Periodo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Periodo Rapido
              </span>
              <div className="filter-preset-group">
                {[
                  { id: 'all', label: 'Tutto' },
                  { id: 'today', label: 'Oggi' },
                  { id: 'last7', label: 'Ultimi 7 gg' },
                  { id: 'last30', label: 'Ultimi 30 gg' },
                  { id: 'thisMonth', label: 'Questo mese' },
                  { id: 'lastMonth', label: 'Mese scorso' },
                  { id: 'thisYear', label: 'Questo anno' },
                  { id: 'lastYear', label: 'Anno scorso' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-preset-pill ${activeDatePreset === item.id && (!filterStartDate && !filterEndDate ? item.id === 'all' : true) ? 'active' : ''}`}
                    onClick={() => handleApplyDatePreset(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pulsanti Rapidi Tipo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Tipo Movimento
              </span>
              <div className="filter-preset-group">
                {[
                  { id: '', label: 'Tutti i tipi' },
                  { id: 'expense', label: 'Solo Uscite (Spese)' },
                  { id: 'income', label: 'Solo Entrate' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-preset-pill ${filterKind === item.id ? 'active' : ''}`}
                    onClick={() => setFilterKind(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pulsanti Rapidi Rimborsi */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                Filtro Stato Rimborsi
              </span>
              <div className="filter-preset-group">
                {[
                  { id: '', label: 'Tutti' },
                  { id: 'pending', label: `⏳ Da rimborsare (${reimbursementStats.pendingCount + reimbursementStats.partialCount})` },
                  { id: 'reimbursed', label: `✅ Rimborsate (${reimbursementStats.reimbursedCount})` },
                  { id: 'all_reimbursable', label: `Tutte le spese con rimborso (${reimbursementStats.totalTracked})` },
                  { id: 'refund_income', label: '🔄 Solo entrate da rimborsi' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-preset-pill ${filterReimbursement === item.id ? 'active' : ''}`}
                    onClick={() => setFilterReimbursement(item.id as any)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Griglia Parametri Dettagliati */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600, textTransform: 'uppercase', opacity: 0.85 }}>Da Data</span>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => {
                    setFilterStartDate(e.target.value);
                    setActiveDatePreset('custom');
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.85rem',
                    fontWeight: 500
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600, textTransform: 'uppercase', opacity: 0.85 }}>A Data</span>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => {
                    setFilterEndDate(e.target.value);
                    setActiveDatePreset('custom');
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.85rem',
                    fontWeight: 500
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600, textTransform: 'uppercase', opacity: 0.85 }}>Conto</span>
                <select
                  value={filterAccount}
                  onChange={(e) => setFilterAccount(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.85rem',
                    fontWeight: 500
                  }}
                >
                  <option value="" style={{ background: 'var(--input-bg)', color: 'var(--text)' }}>Tutti i conti ({transactions.length})</option>
                  {uniqueAccounts.map((account) => {
                    const count = transactions.filter((t) => t.account === account).length;
                    return (
                      <option key={account} value={account} style={{ background: 'var(--input-bg)', color: 'var(--text)' }}>
                        {account} ({count})
                      </option>
                    );
                  })}
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600, textTransform: 'uppercase', opacity: 0.85 }}>Categoria</span>
                <select
                  value={filterCategory}
                  onChange={(e) => {
                    setFilterCategory(e.target.value);
                    setFilterSubcategory('');
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.85rem',
                    fontWeight: 500
                  }}
                >
                  <option value="" style={{ background: 'var(--input-bg)', color: 'var(--text)' }}>Tutte le categorie</option>
                  {uniqueCategories.map((cat) => (
                    <option key={cat} value={cat} style={{ background: 'var(--input-bg)', color: 'var(--text)' }}>{cat}</option>
                  ))}
                </select>
              </label>

              {filterCategory && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600, textTransform: 'uppercase', opacity: 0.85 }}>Sotto-Categoria</span>
                  <select
                    value={filterSubcategory}
                    onChange={(e) => setFilterSubcategory(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'var(--input-bg)',
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                      fontWeight: 500
                    }}
                  >
                    <option value="" style={{ background: 'var(--input-bg)', color: 'var(--text)' }}>Tutte le sotto-categorie</option>
                    {uniqueSubcategories.map((sub) => (
                      <option key={sub} value={sub} style={{ background: 'var(--input-bg)', color: 'var(--text)' }}>{sub}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {/* Riga Filtro Importo */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600, textTransform: 'uppercase', opacity: 0.85 }}>Importo Minimo (€)</span>
                <input
                  type="number"
                  placeholder="es. 10"
                  value={filterMinAmount}
                  onChange={(e) => {
                    setFilterMinAmount(e.target.value);
                    setFilterAmountPreset('custom');
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.85rem',
                    fontWeight: 500
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600, textTransform: 'uppercase', opacity: 0.85 }}>Importo Massimo (€)</span>
                <input
                  type="number"
                  placeholder="es. 1000"
                  value={filterMaxAmount}
                  onChange={(e) => {
                    setFilterMaxAmount(e.target.value);
                    setFilterAmountPreset('custom');
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.85rem',
                    fontWeight: 500
                  }}
                />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Fasce Rapide</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[
                    { id: 'all', label: 'Tutti' },
                    { id: 'under50', label: '< 50€' },
                    { id: '50to200', label: '50-200€' },
                    { id: 'over200', label: '> 200€' },
                    { id: 'over1000', label: '> 1.000€' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`filter-preset-pill ${filterAmountPreset === p.id ? 'active' : ''}`}
                      onClick={() => handleApplyAmountPreset(p.id)}
                      style={{ fontSize: '0.72rem', padding: '5px 8px' }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sezione Ordinamento */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Ordinamento
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Ordina per</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'rgba(7, 14, 26, 0.6)',
                      color: 'var(--text)',
                      fontSize: '0.85rem'
                    }}
                  >
                    <option value="date">Data</option>
                    <option value="amount">Importo</option>
                    <option value="category">Categoria</option>
                    <option value="merchant">Beneficiario/Descrizione</option>
                    <option value="account">Conto</option>
                    <option value="custom">Ordine personalizzato</option>
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Direzione</span>
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                    disabled={sortBy === 'custom'}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'rgba(7, 14, 26, 0.6)',
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                      opacity: sortBy === 'custom' ? 0.5 : 1
                    }}
                  >
                    <option value="desc">Discendente (più recente / più grande)</option>
                    <option value="asc">Crescente (più vecchio / più piccolo)</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Tag Filtri Attivi (Chips) */}
            {hasActiveFilters && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>Filtri attivi:</span>
                {searchQuery && (
                  <span className="filter-badge-chip">
                    Cerca: "{searchQuery}"
                    <button type="button" onClick={() => setSearchQuery('')}>✕</button>
                  </span>
                )}
                {filterKind && (
                  <span className="filter-badge-chip">
                    Tipo: {filterKind === 'expense' ? 'Solo Uscite' : 'Solo Entrate'}
                    <button type="button" onClick={() => setFilterKind('')}>✕</button>
                  </span>
                )}
                {(filterStartDate || filterEndDate) && (
                  <span className="filter-badge-chip">
                    Periodo: {filterStartDate || '...'} → {filterEndDate || '...'}
                    <button type="button" onClick={() => { setFilterStartDate(''); setFilterEndDate(''); setActiveDatePreset('all'); }}>✕</button>
                  </span>
                )}
                {filterAccount && (
                  <span className="filter-badge-chip">
                    Conto: {filterAccount}
                    <button type="button" onClick={() => setFilterAccount('')}>✕</button>
                  </span>
                )}
                {filterCategory && (
                  <span className="filter-badge-chip">
                    Categoria: {filterCategory}
                    <button type="button" onClick={() => { setFilterCategory(''); setFilterSubcategory(''); }}>✕</button>
                  </span>
                )}
                {filterSubcategory && (
                  <span className="filter-badge-chip">
                    Sotto-categoria: {filterSubcategory}
                    <button type="button" onClick={() => setFilterSubcategory('')}>✕</button>
                  </span>
                )}
                {(filterMinAmount || filterMaxAmount) && (
                  <span className="filter-badge-chip">
                    Importo: {filterMinAmount ? `da ${filterMinAmount}€` : ''} {filterMaxAmount ? `a ${filterMaxAmount}€` : ''}
                    <button type="button" onClick={() => { setFilterMinAmount(''); setFilterMaxAmount(''); setFilterAmountPreset('all'); }}>✕</button>
                  </span>
                )}
              </div>
            )}
          </div>

          {selectedTransactions.length ? (
            <form className="bulk-editor" onSubmit={applyBulkUpdate}>
              <div className="bulk-editor-head">
                <div className="bulk-editor-header-left">
                  <div className="bulk-editor-badge">
                    <span>⚡ MODIFICA IN BLOCCO</span>
                  </div>
                  <span className="bulk-editor-sum-badge">
                    <strong>{selectedTransactions.length}</strong> {selectedTransactions.length === 1 ? 'transazione selezionata' : 'transazioni selezionate'}
                  </span>
                  <span className="bulk-editor-sum-badge">
                    Totale importi: <strong style={{ color: selectedTransactionsSum >= 0 ? '#34d399' : '#fb7185' }}>{formatEuro(selectedTransactionsSum)}</strong>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {selectedTransactionIds.length < filteredTransactions.length && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setSelectedTransactionIds(filteredTransactions.map((t) => t.id))}
                      style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                    >
                      Seleziona tutte ({filteredTransactions.length})
                    </button>
                  )}
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={clearTransactionSelection}
                    style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                  >
                    Deseleziona tutto
                  </button>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted)', lineHeight: '1.4' }}>
                Applica modifiche contemporanee a tutti i movimenti spuntati. I campi lasciati non compilati manterranno i valori originali di ciascuna transazione.
              </p>

              <div className="bulk-editor-grid">
                <label className="form-field">
                  <span>Nuova Data</span>
                  <input
                    type="date"
                    value={bulkDraft.date}
                    onChange={(event) => setBulkDraft((current) => ({ ...current, date: event.target.value }))}
                  />
                </label>

                <label className="form-field">
                  <span>Nuovo Conto</span>
                  <select
                    value={bulkDraft.account}
                    onChange={(event) => setBulkDraft((current) => ({ ...current, account: event.target.value }))}
                  >
                    <option value="">-- Mantieni conti originali --</option>
                    {accountOptions.map((acc) => (
                      <option key={acc} value={acc}>
                        {acc}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Nuova Categoria</span>
                  <input
                    list="category-options"
                    value={bulkDraft.category}
                    onChange={(event) => setBulkDraft((current) => ({ ...current, category: event.target.value }))}
                    placeholder="Mantieni originale..."
                  />
                </label>

                <label className="form-field">
                  <span>Nuova Sottocategoria</span>
                  <input
                    list="subcategory-options"
                    value={bulkDraft.subcategory}
                    onChange={(event) => setBulkDraft((current) => ({ ...current, subcategory: event.target.value }))}
                    placeholder="Mantieni originale..."
                  />
                </label>

                <label className="form-field">
                  <span>Tipo Movimento</span>
                  <select
                    value={bulkDraft.kind}
                    onChange={(event) => setBulkDraft((current) => ({ ...current, kind: event.target.value as TransactionBulkDraft['kind'] }))}
                  >
                    <option value="">-- Mantieni tipo originale --</option>
                    <option value="expense">🔴 Uscita (Spesa)</option>
                    <option value="income">🟢 Entrata</option>
                  </select>
                </label>

                <label className="form-field">
                  <span>Nota o Dettagli</span>
                  <input
                    value={bulkDraft.note}
                    onChange={(event) => setBulkDraft((current) => ({ ...current, note: event.target.value }))}
                    placeholder="Mantieni nota originale..."
                  />
                </label>
              </div>

              <div className="bulk-editor-actions">
                <div className="bulk-editor-actions-left">
                  <button className="primary-button" type="submit">
                    ✓ Applica modifiche ({selectedTransactions.length})
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={bulkDeleteTransactions}
                  >
                    🗑️ Elimina selezionate ({selectedTransactions.length})
                  </button>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={clearTransactionSelection}
                  style={{ padding: '10px 16px', fontSize: '0.84rem' }}
                >
                  Annulla
                </button>
              </div>
            </form>
          ) : null}

          <div className="transaction-table transaction-table-scroll">
            <div className="transaction-row transaction-row-header">
              <span />
              <span>Stato</span>
              <span>Movimento</span>
              <span>Ordine</span>
            </div>
            {filteredTransactions.map((transaction) => {
              const reimbInfo = reimbursementMap.get(transaction.id);
              const linkedExpense = transaction.reimbursesTransactionId
                ? transactions.find((t) => t.id === transaction.reimbursesTransactionId)
                : null;

              return (
                <div className={`transaction-row ${transaction.id === editingTransactionId ? 'is-active' : ''}`} key={transaction.id}>
                  <label className="transaction-select">
                    <input
                      type="checkbox"
                      checked={selectedTransactionIds.includes(transaction.id)}
                      onChange={() => toggleTransactionSelection(transaction.id)}
                      aria-label={`Seleziona ${transaction.merchant}`}
                    />
                  </label>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong>{transaction.merchant}</strong>
                      {reimbInfo && (
                        reimbInfo.status === 'reimbursed' ? (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontWeight: 650,
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#10b981',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                            title={`Spesa interamente saldata e rimborsata. Rimborsi collegati: ${reimbInfo.refunds.map((r) => `${r.merchant} (+${formatEuro(r.amount)}) del ${formatDisplayDate(r.date)}`).join(', ')}`}
                          >
                            ✓ Rimborsata
                          </span>
                        ) : reimbInfo.status === 'partial' ? (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontWeight: 650,
                              background: 'rgba(56, 189, 248, 0.15)',
                              color: '#38bdf8',
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                            title={`Ricevuti finora ${formatEuro(reimbInfo.totalReimbursed)} su ${formatEuro(Math.abs(transaction.amount))}. Restano: ${formatEuro(reimbInfo.remainingAmount)}`}
                          >
                            ⏳ Parz. rimborsata ({formatEuro(reimbInfo.remainingAmount)} rimanenti)
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontWeight: 650,
                              background: 'rgba(245, 158, 11, 0.15)',
                              color: '#f59e0b',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                            title="Spesa contrassegnata in attesa di rimborso"
                          >
                            ⏳ Da rimborsare
                          </span>
                        )
                      )}
                      {transaction.kind === 'income' && transaction.reimbursesTransactionId && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontWeight: 650,
                            background: 'rgba(56, 189, 248, 0.12)',
                            color: '#38bdf8',
                            border: '1px solid rgba(56, 189, 248, 0.25)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                          title={linkedExpense ? `Questo accredito rimborsa la spesa: "${linkedExpense.merchant}" (${formatEuro(Math.abs(linkedExpense.amount))}) del ${formatDisplayDate(linkedExpense.date)}` : 'Rimborso spesa'}
                        >
                          🔄 Rimborso spesa
                        </span>
                      )}
                    </div>
                    <p>
                      {formatCategoryPath(transaction.category, transaction.subcategory)} · {transaction.account}
                    </p>
                    <small>
                      {formatDisplayDate(transaction.date)} · {transaction.note || 'Nessuna nota'}
                      {reimbInfo && reimbInfo.refunds.length > 0 && (
                        <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.7rem', marginTop: '2px' }}>
                          Rimborsi ricevuti: {reimbInfo.refunds.map((r) => `+${formatEuro(r.amount)} (${r.merchant} · ${formatDisplayDate(r.date)})`).join(', ')}
                        </span>
                      )}
                      {linkedExpense && (
                        <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.7rem', marginTop: '2px' }}>
                          Collagata a spesa: {linkedExpense.merchant} ({formatEuro(Math.abs(linkedExpense.amount))}) del {formatDisplayDate(linkedExpense.date)}
                        </span>
                      )}
                    </small>
                  </div>
                  <span>{formatKindLabel(transaction.kind, transaction.category, transaction.subcategory)}</span>
                  <strong
                    className={
                      isTransferCategory(transaction.category, transaction.subcategory)
                        ? 'amount'
                        : transaction.kind === 'income'
                        ? 'amount positive'
                        : 'amount negative'
                    }
                    style={isTransferCategory(transaction.category, transaction.subcategory) ? { color: '#38bdf8' } : undefined}
                  >
                    {isTransferCategory(transaction.category, transaction.subcategory)
                      ? `⇆ ${formatEuro(Math.abs(transaction.amount))}`
                      : formatSignedEuro(transaction.amount)}
                  </strong>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
                    {reimbInfo && reimbInfo.status !== 'reimbursed' && (
                      <button
                        className="ghost-button"
                        style={{ fontSize: '0.72rem', padding: '4px 8px', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)', background: 'rgba(16, 185, 129, 0.06)', whiteSpace: 'nowrap' }}
                        type="button"
                        onClick={() => handleStartReimbursementForExpense(transaction)}
                        title="Registra subito l'entrata per questo rimborso"
                      >
                        + Ricevi rimborso
                      </button>
                    )}
                    <button className="ghost-button" type="button" onClick={() => openEditTransaction(transaction)}>
                      Modifica
                    </button>
                    <button
                      className="ghost-button"
                      style={{ color: '#fb7185', borderColor: 'rgba(251, 113, 133, 0.24)', background: 'rgba(251, 113, 133, 0.05)' }}
                      type="button"
                      onClick={() => handleDeleteSpecificTransaction(transaction.id, transaction.merchant)}
                    >
                      Elimina
                    </button>
                  </div>
                </div>
              );
            })}

            {!filteredTransactions.length ? (
              <div className="empty-state">
                <strong>Nessuna transazione corrisponde alla ricerca.</strong>
                <p>Prova a cambiare o resettare i filtri oppure importa un file Excel.</p>
              </div>
            ) : null}
          </div>

          {/* Riepilogo Totale a Piè di Tabella */}
          {filteredTransactions.length > 0 && (
            <div className="tx-table-footer-row">
              <div>
                <strong>Totale Vista ({filteredTransactions.length} movimenti)</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '2px' }}>
                  Entrate: <span style={{ color: '#34d399', fontWeight: 600 }}>+{formatEuro(filteredSummary.totalIncome)}</span> ({filteredSummary.incomeCount}) · Uscite: <span style={{ color: '#fb7185', fontWeight: 600 }}>-{formatEuro(filteredSummary.totalExpense)}</span> ({filteredSummary.expenseCount})
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Saldo Complessivo Filtrato
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: filteredSummary.netTotal >= 0 ? '#34d399' : '#fb7185' }}>
                  {formatSignedEuro(filteredSummary.netTotal)}
                </div>
              </div>
            </div>
          )}
        </article>

        <TransactionEditor
          mode={editorMode}
          draft={draft}
          editingTransaction={editingTransaction}
          categoryOptions={categoryOptions}
          subcategoryOptions={subcategoryOptions}
          accountOptions={accountOptions}
          candidateExpenses={candidateExpensesForReimbursement}
          allTransactions={transactions}
          onChange={updateDraft}
          onSubmit={handleSubmitTransaction}
          onReset={resetEditor}
          onDelete={deleteTransaction}
        />
      </section>
    );
  };

  const renderBudget = () => (
    <section className="section-grid budget-layout">
      <article className="panel large-panel">
        <div className="panel-header">
          <div>
            <p className="panel-title">Allocazione budget</p>
            <h4>Categorie sotto controllo</h4>
          </div>
          <button className="ghost-button" type="button" onClick={() => setActiveSection('transazioni')}>
            Vai alle transazioni
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: '12px', paddingLeft: '16px', paddingRight: '16px', marginTop: '-4px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, marginRight: '4px' }}>Ordina per:</span>
          <button
            className={`pill ${budgetSortCriteria === 'name' ? 'pill-primary' : ''}`}
            style={{ fontSize: '0.75rem', padding: '6px 12px', borderRadius: '8px' }}
            type="button"
            onClick={() => {
              if (budgetSortCriteria === 'name') {
                setBudgetSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
              } else {
                setBudgetSortCriteria('name');
                setBudgetSortOrder('asc');
              }
            }}
          >
            Alfabetico {budgetSortCriteria === 'name' && (budgetSortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button
            className={`pill ${budgetSortCriteria === 'spent' ? 'pill-primary' : ''}`}
            style={{ fontSize: '0.75rem', padding: '6px 12px', borderRadius: '8px' }}
            type="button"
            onClick={() => {
              if (budgetSortCriteria === 'spent') {
                setBudgetSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
              } else {
                setBudgetSortCriteria('spent');
                setBudgetSortOrder('desc');
              }
            }}
          >
            Già speso {budgetSortCriteria === 'spent' && (budgetSortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button
            className={`pill ${budgetSortCriteria === 'limit' ? 'pill-primary' : ''}`}
            style={{ fontSize: '0.75rem', padding: '6px 12px', borderRadius: '8px' }}
            type="button"
            onClick={() => {
              if (budgetSortCriteria === 'limit') {
                setBudgetSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
              } else {
                setBudgetSortCriteria('limit');
                setBudgetSortOrder('desc');
              }
            }}
          >
            Budget allocato {budgetSortCriteria === 'limit' && (budgetSortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button
            className={`pill ${budgetSortCriteria === 'remaining' ? 'pill-primary' : ''}`}
            style={{ fontSize: '0.75rem', padding: '6px 12px', borderRadius: '8px' }}
            type="button"
            onClick={() => {
              if (budgetSortCriteria === 'remaining') {
                setBudgetSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
              } else {
                setBudgetSortCriteria('remaining');
                setBudgetSortOrder('asc');
              }
            }}
          >
            Disponibile {budgetSortCriteria === 'remaining' && (budgetSortOrder === 'asc' ? '↑' : '↓')}
          </button>
        </div>

        <div className="category-list">
          {sortedCategoryRows.map((category) => (
            <div className="category-row" key={category.id} style={{ borderLeft: `4px solid ${category.color || 'var(--primary)'}` }}>
              <div className="category-meta category-meta-stack">
                <div className="category-meta-main">
                  <div className="category-dot" style={{ background: category.color }} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong>{category.name}</strong>
                      {category.limitType === 'percentage' && (
                        <span style={{ fontSize: '0.65rem', background: 'rgba(94, 234, 212, 0.15)', color: 'var(--primary)', padding: '1px 6px', borderRadius: '4px' }}>
                          % Limit ({category.limitPercent}%)
                        </span>
                      )}
                    </div>
                    {category.note && <p>{category.note}</p>}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <span>Effettivo: <strong>{formatEuro(category.actualSpent)}</strong></span>
                      {category.expectedSpent > 0 && (
                        <span>• Previsto: <strong>{formatEuro(category.expectedSpent)}</strong></span>
                      )}
                    </div>
                  </div>
                </div>

                {category.subcategories.length ? (
                  <div className="subcategory-summary">
                    {category.subcategories.map((subcategory) => (
                      <div className="subcategory-pill" key={subcategory.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', padding: '6px 10px' }}>
                        <span style={{ fontWeight: 500 }}>{subcategory.name}</span>
                        <small style={{ fontSize: '0.72rem' }}>
                          {formatEuro(subcategory.spent)} / {formatEuro(subcategory.limit)} {subcategory.limitType === 'percentage' && `(${subcategory.limitPercent}%)`}
                        </small>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                          Eff: {formatEuro(subcategory.actualSpent)} {subcategory.expectedSpent > 0 && ` • Prev: ${formatEuro(subcategory.expectedSpent)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <small className="subcategory-empty">Nessuna sottocategoria impostata</small>
                )}
              </div>

              <div className="category-stats">
                <span>
                  {formatEuro(category.spent)} / {formatEuro(category.limit)}
                </span>
                <div className="progress slim">
                  <span style={{ width: `${category.ratio}%`, background: category.color }} />
                </div>
                <small>{formatEuro(category.remaining)} residui</small>
                <button className="ghost-button" type="button" onClick={() => openEditBudgetCategory(category)}>
                  Modifica
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-title">Editor budget</p>
            <h4>Categoria e sottocategorie</h4>
          </div>
          <button className="ghost-button" type="button" onClick={startNewBudgetCategory}>
            Nuovo budget
          </button>
        </div>

        <BudgetCategoryEditor
          mode={editingBudgetId ? 'edit' : 'create'}
          draft={budgetDraft}
          editingCategory={budgetCategories.find((category) => category.id === editingBudgetId) ?? null}
          onChange={updateBudgetDraft}
          onSubcategoryChange={updateBudgetSubcategoryDraft}
          onAddSubcategory={addBudgetSubcategoryDraft}
          onRemoveSubcategory={removeBudgetSubcategoryDraft}
          onSubmit={handleSubmitBudgetCategory}
          onReset={resetBudgetEditor}
          onDelete={deleteBudgetCategory}
          totalMonthIncome={totalMonthIncome}
        />

        <div className="mini-stat-list budget-stat-list">
          <div className="mini-stat-card">
            <span>Budget totale</span>
            <strong>{formatEuro(budgetLimit)}</strong>
          </div>
          <div className="mini-stat-card">
            <span>Budget utilizzato</span>
            <strong>{formatEuro(budgetSpent)}</strong>
          </div>
          <div className="mini-stat-card">
            <span>Margine residuo</span>
            <strong>{formatEuro(budgetRemaining)}</strong>
          </div>
          <div className="mini-stat-card">
            <span>Pressione media</span>
            <strong>{budgetUsage}%</strong>
          </div>
        </div>

        <p className="import-hint">Quando rinomini una categoria, le transazioni esistenti vengono aggiornate automaticamente.</p>
      </article>
    </section>
  );

  const renderUnifiedReportAndNetWorth = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header with Title and Net Worth Explanation Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <span style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 700 }}>
            Quadro Finanziario & Analisi
          </span>
          <h2 style={{ margin: '2px 0 0', fontSize: '1.45rem', fontWeight: 700 }}>Report, Patrimonio & Proiezioni</h2>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setShowNetWorthExplanation((prev) => !prev)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', padding: '8px 16px', borderRadius: '12px', cursor: 'pointer' }}
        >
          <span style={{ fontSize: '1rem' }}>💡</span>
          <span>{showNetWorthExplanation ? 'Nascondi logica di calcolo' : 'Come viene calcolato il Patrimonio?'}</span>
        </button>
      </div>

      {showNetWorthExplanation && (
        <div style={{
          background: 'var(--panel-card-bg)',
          border: '1px solid rgba(94, 234, 212, 0.28)',
          borderRadius: '22px',
          padding: '22px',
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <strong style={{ color: 'var(--accent)', fontSize: '0.94rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📊 Formule e Fonti Dati del Patrimonio Netto
            </strong>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowNetWorthExplanation(false)}
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            >
              Chiudi ✕
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            <div style={{ background: 'rgba(148, 163, 184, 0.05)', padding: '14px', borderRadius: '14px', border: '1px solid var(--border)' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 650, color: 'var(--text)', fontSize: '0.85rem' }}>
                1. Patrimonio Netto Complessivo
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: 'var(--input-bg)', padding: '6px 10px', borderRadius: '8px', marginBottom: '8px', color: 'var(--accent)' }}>
                Patrimonio Netto = Attività Totali - Passività
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', lineHeight: '1.4' }}>
                Somma di <strong>Liquidità Netta</strong> su tutti i conti ({formatEuro(cashAvailable)}) e <strong>Controvalore Investimenti</strong> ({formatEuro(assetMarketValue)}).
              </p>
            </div>

            <div style={{ background: 'rgba(148, 163, 184, 0.05)', padding: '14px', borderRadius: '14px', border: '1px solid var(--border)' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 650, color: 'var(--text)', fontSize: '0.85rem' }}>
                2. Liquidità Disponibile (Cassa Conti)
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: 'var(--input-bg)', padding: '6px 10px', borderRadius: '8px', marginBottom: '8px', color: '#38bdf8' }}>
                Liquidità = Cassa Iniziale + Entrate - Uscite
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', lineHeight: '1.4' }}>
                Calcolata partendo dal Capitale Iniziale impostato in Impostazioni ({formatEuro(openingCash)}), sommando le entrate e sottraendo uscite e acquisti titoli dalla data di inizio ({openingDate}).
              </p>
            </div>

            <div style={{ background: 'rgba(148, 163, 184, 0.05)', padding: '14px', borderRadius: '14px', border: '1px solid var(--border)' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 650, color: 'var(--text)', fontSize: '0.85rem' }}>
                3. Attività e Valutazione Investimenti
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: 'var(--input-bg)', padding: '6px 10px', borderRadius: '8px', marginBottom: '8px', color: '#34d399' }}>
                Valore Titolo = Quantità Detenuta × Prezzo di Mercato
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', lineHeight: '1.4' }}>
                La quantità attuale considera tutti gli acquisti e vendite. Il prezzo è ricavato dalle quotazioni Ticker Yahoo Finance in tempo reale o dall'ultimo prezzo unitario inserito.
              </p>
            </div>

            <div style={{ background: 'rgba(148, 163, 184, 0.05)', padding: '14px', borderRadius: '14px', border: '1px solid var(--border)' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 650, color: 'var(--text)', fontSize: '0.85rem' }}>
                4. Passività e Fondo Emergenza
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: 'var(--input-bg)', padding: '6px 10px', borderRadius: '8px', marginBottom: '8px', color: '#f59e0b' }}>
                Autonomia (Mesi) = Patrimonio / Spesa Media Mensile
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', lineHeight: '1.4' }}>
                Le passività ({formatEuro(totalLiabilitiesVal)}) sommano gli eventuali saldi negativi dei conti. L'autonomia indica per quanti mesi saresti coperto con le sole riserve al ritmo di spesa medio storico.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Top Overview KPI Cards */}
      <section className="metric-grid">
        <div className="metric-card">
          <p className="metric-label">Patrimonio Netto Complessivo</p>
          <h3>{formatEuro(currentNetWorth)}</h3>
          <span className="metric-delta">Liquidità ({formatEuro(cashAvailable)}) + Titoli ({formatEuro(assetMarketValue)})</span>
        </div>

        <div className="metric-card" style={{ borderLeftColor: 'var(--accent)' }}>
          <p className="metric-label">Attività Totali</p>
          <h3>{formatEuro(totalAssetsVal)}</h3>
          <span className="metric-delta">{assets.length} posizioni attive in portafoglio</span>
        </div>

        <div className="metric-card" style={{ borderLeftColor: 'var(--danger)' }}>
          <p className="metric-label">Passività / Debiti</p>
          <h3>{formatEuro(totalLiabilitiesVal)}</h3>
          <span className="metric-delta">{totalLiabilitiesVal === 0 ? 'Nessun debito pendente' : 'Esposizione debitoria'}</span>
        </div>

        <div className="metric-card" style={{ borderLeftColor: 'var(--warning)' }}>
          <p className="metric-label">Fondo Emergenza & Autonomia</p>
          <h3>{emergencyAutonomyMonths} {emergencyAutonomyMonths === 1 ? 'mese' : 'mesi'}</h3>
          <span className="metric-delta">Autonomia con le spese mensili medie</span>
        </div>
      </section>

      {/* Harmonious Tab Switcher */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setUnifiedReportTab('patrimonio')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 650,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: unifiedReportTab === 'patrimonio' ? 'var(--accent)' : 'transparent',
            color: unifiedReportTab === 'patrimonio' ? 'var(--pill-primary-text)' : 'var(--muted)',
            transition: 'all 0.15s ease'
          }}
        >
          📈 Patrimonio & Evoluzione
        </button>

        <button
          type="button"
          onClick={() => setUnifiedReportTab('flussi')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 650,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: unifiedReportTab === 'flussi' ? 'var(--accent)' : 'transparent',
            color: unifiedReportTab === 'flussi' ? 'var(--pill-primary-text)' : 'var(--muted)',
            transition: 'all 0.15s ease'
          }}
        >
          📊 Flussi & Spese
        </button>

        <button
          type="button"
          onClick={() => setUnifiedReportTab('trend')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 650,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: unifiedReportTab === 'trend' ? 'var(--accent)' : 'transparent',
            color: unifiedReportTab === 'trend' ? 'var(--pill-primary-text)' : 'var(--muted)',
            transition: 'all 0.15s ease'
          }}
        >
          📉 Trend 6 Mesi
        </button>

        <button
          type="button"
          onClick={() => setUnifiedReportTab('sankey')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 650,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: unifiedReportTab === 'sankey' ? 'var(--accent)' : 'transparent',
            color: unifiedReportTab === 'sankey' ? 'var(--pill-primary-text)' : 'var(--muted)',
            transition: 'all 0.15s ease'
          }}
        >
          🌊 Diagramma Flussi (Sankey)
        </button>

        <button
          type="button"
          onClick={() => setUnifiedReportTab('allocation')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 650,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: unifiedReportTab === 'allocation' ? 'var(--accent)' : 'transparent',
            color: unifiedReportTab === 'allocation' ? 'var(--pill-primary-text)' : 'var(--muted)',
            transition: 'all 0.15s ease'
          }}
        >
          ⚖️ Asset Allocation
        </button>

        <button
          type="button"
          onClick={() => setUnifiedReportTab('fire')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: 650,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: unifiedReportTab === 'fire' ? 'var(--accent)' : 'transparent',
            color: unifiedReportTab === 'fire' ? 'var(--pill-primary-text)' : 'var(--muted)',
            transition: 'all 0.15s ease'
          }}
        >
          🚀 Simulatore FIRE & Rendita
        </button>
      </div>

      {/* Dynamic Tab Content */}
      {unifiedReportTab === 'patrimonio' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <NetWorthHistoryChart
            transactions={transactions}
            assetTransactions={assetTransactions}
            assets={assets}
            accountInitialCapitals={accountInitialCapitals}
            storedOpeningCash={storedOpeningCash}
            openingDate={openingDate}
            formatEuro={formatEuro}
          />

          {/* BILANCIO DEI CONTI */}
          <article className="panel large-panel" style={{ margin: 0 }}>
            <div className="panel-header">
              <div>
                <p className="panel-title">Bilancio dei Conti</p>
                <h4>Conto, liquidità, entrate, uscite e asset nel tempo</h4>
              </div>
            </div>

            <p className="import-hint" style={{ marginTop: '2px', marginBottom: '14px' }}>
              Dati calcolati per il periodo dal <strong>{formatDisplayDate(reportRange.start)}</strong> al <strong>{formatDisplayDate(reportRange.end)}</strong>.
            </p>

            <div className="account-balances-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {reportAccountsBalances.length === 0 ? (
                <div style={{ display: 'grid', placeItems: 'center', height: '100px', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  Nessun conto associato a transazioni in questo periodo.
                </div>
              ) : (
                reportAccountsBalances.map((acc) => (
                  <div className="account-balance-card" key={acc.name} style={{
                    padding: '16px',
                    borderRadius: '18px',
                    background: 'var(--panel-card-bg)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.95rem', color: 'var(--text)' }}>{acc.name}</strong>
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '3px 8px',
                        borderRadius: '8px',
                        background: 'rgba(94, 234, 212, 0.08)',
                        color: 'var(--accent)',
                        fontWeight: 600
                      }}>
                        CONTO ATTIVO
                      </span>
                    </div>
                    
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                      gap: '12px'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.725rem', color: 'var(--muted)' }}>Cap. Iniziale</span>
                        <strong style={{ fontSize: '0.95rem', color: 'var(--text)' }}>{formatEuro(acc.initialCapital)}</strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.725rem', color: 'var(--muted)' }}>Totale Entrate</span>
                        <strong style={{ fontSize: '0.95rem', color: '#34d399' }}>+{formatEuro(acc.rangeIncomes)}</strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.725rem', color: 'var(--muted)' }}>Totale Uscite</span>
                        <strong style={{ fontSize: '0.95rem', color: '#fb7185' }}>-{formatEuro(acc.rangeExpenses)}</strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.725rem', color: 'var(--muted)' }}>Liquidità</span>
                        <strong style={{ fontSize: '0.95rem', color: '#38bdf8' }}>{formatEuro(acc.liquidity)}</strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.725rem', color: 'var(--muted)' }}>Asset</span>
                        <strong style={{ fontSize: '0.95rem', color: '#c084fc' }}>{formatEuro(acc.assetsValue)}</strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.725rem', color: 'var(--muted)', fontWeight: 600 }}>Bilancio Totale</span>
                        <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>{formatEuro(acc.totalBalance)}</strong>
                      </div>
                    </div>
                    
                    {acc.totalBalance !== 0 && (
                      <div style={{ marginTop: '2px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.675rem', color: 'var(--muted)', marginBottom: '4px' }}>
                          <span>Liquidità: {acc.totalBalance > 0 ? ((Math.max(0, acc.liquidity) / acc.totalBalance) * 100).toFixed(0) : '0'}%</span>
                          <span>Asset: {acc.totalBalance > 0 ? ((Math.max(0, acc.assetsValue) / acc.totalBalance) * 100).toFixed(0) : '0'}%</span>
                        </div>
                        <div style={{ height: '4px', borderRadius: '2px', background: 'var(--overlay-subtle)', display: 'flex', overflow: 'hidden' }}>
                          <div style={{ width: `${acc.totalBalance > 0 ? (Math.max(0, acc.liquidity) / acc.totalBalance) * 100 : 0}%`, background: '#38bdf8' }} />
                          <div style={{ width: `${acc.totalBalance > 0 ? (Math.max(0, acc.assetsValue) / acc.totalBalance) * 100 : 0}%`, background: '#c084fc' }} />
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      )}

      {unifiedReportTab === 'flussi' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <article className="panel large-panel" style={{ margin: 0 }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <p className="panel-title">Report mensile</p>
                <h4>Entrate vs Uscite (Anno in Corso)</h4>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setUnifiedReportTab('trend')}
                style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                📉 Analisi Trend 6 Mesi per Categoria ➔
              </button>
            </div>

            <div className="report-range">
              <label className="form-field">
                <span>Inizio intervallo</span>
                <input
                  type="date"
                  value={reportRange.start}
                  onChange={(event) => setReportRange((current) => ({ ...current, start: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Fine intervallo</span>
                <input
                  type="date"
                  value={reportRange.end}
                  onChange={(event) => setReportRange((current) => ({ ...current, end: event.target.value }))}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', marginBottom: '24px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 500, marginRight: '4px' }}>Intervalli rapidi:</span>
              <button className="pill" type="button" onClick={() => setPresetRange('questo-mese')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Questo mese</button>
              <button className="pill" type="button" onClick={() => setPresetRange('mese-scorso')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Mese scorso</button>
              <button className="pill" type="button" onClick={() => setPresetRange('ultimi-3-mesi')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Ultimi 3 mesi</button>
              <button className="pill" type="button" onClick={() => setPresetRange('quest-anno')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Quest'anno</button>
              <button className="pill" type="button" onClick={() => setPresetRange('tutto')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Tutto</button>
            </div>

            <div className="metric-grid metric-grid-report">
              <MetricCard label="Entrate totali" value={formatEuro(reportIncomeTotal)} delta="Entrate riconosciute nell'intervallo selezionato" />
              <MetricCard label="Uscite totali" value={formatEuro(reportExpenseTotal)} delta="Somma delle spese registrate nell'intervallo" />
              <MetricCard
                label="Flusso netto"
                value={formatEuro(reportNetFlow)}
                delta="Saldo generato dalle transazioni filtrate"
                subValue={
                  <span style={{ color: 'var(--muted)', fontSize: '0.73rem' }}>
                    Mese prec: <strong style={{ color: previousMonthNetFlow >= 0 ? '#10b981' : '#f43f5e' }}>{formatSignedEuro(previousMonthNetFlow)}</strong>
                  </span>
                }
              />
              <MetricCard label="Risparmio mensile" value={formatEuro(Math.max(reportNetFlow, 0))} delta="Parte positiva del flusso netto filtrato" />
              <MetricCard label="Transazioni" value={String(reportTransactions.length)} delta="Voci presenti nell'intervallo scelto" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 12px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Confronto Mensile {currentYear}</h3>
              <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: 'linear-gradient(180deg, #34d399, #10b981)' }} />
                  <span>Entrate</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: 'linear-gradient(180deg, #fb7185, #f43f5e)' }} />
                  <span>Uscite</span>
                </div>
              </div>
            </div>
            <div className="bar-chart bar-chart-wide" aria-label="Monthly comparison report chart" style={{ gridTemplateColumns: `repeat(${currentYearMonthlyData.length}, minmax(0, 1fr))`, minHeight: '260px' }}>
              {(() => {
                const maxVal = Math.max(...currentYearMonthlyData.map((p) => Math.max(p.income, p.expenses)), 1);
                return currentYearMonthlyData.map((point) => (
                  <div className="bar-column" key={point.label} style={{ gap: '6px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontSize: '0.75rem', lineHeight: 1.1, minHeight: '32px', justifyContent: 'end' }}>
                      <span style={{ color: '#10b981', fontWeight: 600 }}>{formatEuroCompact(point.income)}</span>
                      <span style={{ color: '#f43f5e', fontWeight: 600 }}>{formatEuroCompact(point.expenses)}</span>
                    </div>
                    <div className="bar-track" style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', justifyContent: 'center', padding: '6px' }}>
                      <span
                        title={`Entrate: ${formatEuro(point.income)}`}
                        style={{
                          height: `${Math.max((point.income / maxVal) * 100, 4)}%`,
                          background: 'linear-gradient(180deg, #34d399, #10b981)',
                          boxShadow: '0 8px 16px rgba(16, 185, 129, 0.16)',
                          borderRadius: '6px',
                          width: '100%'
                        }}
                      />
                      <span
                        title={`Uscite: ${formatEuro(point.expenses)}`}
                        style={{
                          height: `${Math.max((point.expenses / maxVal) * 100, 4)}%`,
                          background: 'linear-gradient(180deg, #fb7185, #f43f5e)',
                          boxShadow: '0 8px 16px rgba(244, 63, 94, 0.16)',
                          borderRadius: '6px',
                          width: '100%'
                        }}
                      />
                    </div>
                    <span className="bar-label" style={{ fontWeight: 500, color: 'var(--text)' }}>{point.label}</span>
                  </div>
                ));
              })()}
            </div>
          </article>

          {/* SPESE CATEGORIE E SOTTO-CATEGORIE */}
          <article className="panel large-panel" style={{ margin: 0 }}>
            <div className="panel-header">
              <div>
                <p className="panel-title">Distribuzione Spese</p>
                <h4>Analisi per categoria e sottocategoria</h4>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'var(--overlay-subtle)', padding: '4px 8px', borderRadius: '8px' }}>
                Totale spese filtrate: <strong style={{ color: 'var(--text)' }}>{formatEuro(reportExpenseTotal)}</strong>
              </div>
            </div>

            {reportCategoryBreakdown.length === 0 ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '220px', color: 'var(--muted)', fontSize: '0.9rem' }}>
                Nessuna spesa registrata nell'intervallo selezionato.
              </div>
            ) : (
              <div className="pie-chart-container" style={{ display: 'flex', gap: '32px', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
                
                {/* SVG PIE CHART */}
                <div style={{ position: 'relative', width: '300px', height: '300px', flexShrink: 0 }}>
                  <svg viewBox="0 0 240 240" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                    <g>
                      {(() => {
                        let currentAngle = 0;
                        return reportCategoryBreakdown.map((cat) => {
                          const angleSpan = (cat.spent / reportExpenseTotal) * 360;
                          const catStartAngle = currentAngle;
                          const catEndAngle = currentAngle + angleSpan;
                          currentAngle = catEndAngle;

                          const isCatHovered = activeCategory === cat.name || (hoveredSlice && hoveredSlice.name === cat.name && !hoveredSlice.isSub);
                          const scale = isCatHovered ? 1.05 : 1.0;
                          const slicePath = getDonutSlicePath(120, 120, 48 * scale, 75 * scale, catStartAngle, catEndAngle);

                          return (
                            <g key={`cat-g-${cat.name}`}>
                              <path
                                d={slicePath}
                                fill={cat.color}
                                stroke="var(--bg)"
                                strokeWidth="1.5"
                                style={{ transition: 'all 0.2s ease', cursor: 'pointer' }}
                                onClick={() => handleReportSliceClick(cat.name)}
                                onMouseEnter={() => {
                                  setHoveredSlice({
                                    name: cat.name,
                                    spent: cat.spent,
                                    percent: (cat.spent / reportExpenseTotal) * 100,
                                    color: cat.color,
                                    isSub: false,
                                  });
                                  setActiveCategory(cat.name);
                                }}
                                onMouseLeave={() => {
                                  setHoveredSlice(null);
                                  setActiveCategory(null);
                                }}
                              />
                              
                              {/* Subcategories inside this category slice */}
                              {(() => {
                                let subCurrentAngle = catStartAngle;
                                return cat.subcategories.map((sub, sIdx) => {
                                  const subAngleSpan = (sub.spent / cat.spent) * angleSpan;
                                  const subStartAngle = subCurrentAngle;
                                  const subEndAngle = subCurrentAngle + subAngleSpan;
                                  subCurrentAngle = subEndAngle;

                                  const isSubHovered = hoveredSlice && hoveredSlice.name === sub.name && hoveredSlice.isSub;
                                  const subScale = isSubHovered ? 1.05 : (isCatHovered ? 1.02 : 1.0);
                                  const subSlicePath = getDonutSlicePath(120, 120, 78 * subScale, 102 * subScale, subStartAngle, subEndAngle);
                                  
                                  const subOpacity = Math.max(0.3, 0.85 - sIdx * 0.15);

                                  return (
                                    <path
                                      key={`sub-path-${cat.name}-${sub.name}`}
                                      d={subSlicePath}
                                      fill={cat.color}
                                      opacity={subOpacity}
                                      stroke="var(--bg)"
                                      strokeWidth="1"
                                      style={{ transition: 'all 0.2s ease', cursor: 'pointer' }}
                                      onClick={() => handleReportSliceClick(cat.name, sub.name)}
                                      onMouseEnter={() => {
                                        setHoveredSlice({
                                          name: sub.name,
                                          spent: sub.spent,
                                          percent: (sub.spent / reportExpenseTotal) * 100,
                                          color: cat.color,
                                          isSub: true,
                                        });
                                        setActiveCategory(cat.name);
                                      }}
                                      onMouseLeave={() => {
                                        setHoveredSlice(null);
                                        setActiveCategory(null);
                                      }}
                                    />
                                  );
                                });
                              })()}
                            </g>
                          );
                        });
                      })()}
                    </g>
                  </svg>

                  {/* Center Hole Tooltip/Display */}
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                    width: '110px',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}>
                    {hoveredSlice ? (
                      <>
                        <div style={{
                          fontSize: '0.78rem',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          color: hoveredSlice.isSub ? 'var(--muted)' : 'var(--text)',
                          fontWeight: hoveredSlice.isSub ? 400 : 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {hoveredSlice.name}
                        </div>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: hoveredSlice.color, marginTop: '2px' }}>
                          {formatEuro(hoveredSlice.spent)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '1px' }}>
                          {hoveredSlice.percent.toFixed(1)}%
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }}>
                          Spese
                        </div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', marginTop: '2px' }}>
                          {formatEuro(reportExpenseTotal)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '1px' }}>
                          Selezionato
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* DETAILED LEGEND / EXPANDABLE LIST */}
                <div style={{ flex: 1, minWidth: '240px', paddingRight: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {reportCategoryBreakdown.map((cat) => {
                      const isCatActive = activeCategory === cat.name;
                      return (
                        <div
                          key={`legend-${cat.name}`}
                          style={{
                            background: isCatActive ? 'var(--overlay-subtle)' : 'transparent',
                            borderRadius: '10px',
                            padding: '6px 10px',
                            transition: 'all 0.2s ease',
                            cursor: 'pointer',
                            border: isCatActive ? '1px solid var(--border)' : '1px solid transparent'
                          }}
                          onClick={() => handleReportSliceClick(cat.name)}
                          onMouseEnter={() => setActiveCategory(cat.name)}
                          onMouseLeave={() => setActiveCategory(null)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cat.color }} />
                              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>{cat.name}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{formatEuro(cat.spent)}</strong>
                              <small style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: '6px' }}>
                                ({((cat.spent / reportExpenseTotal) * 100).toFixed(1)}%)
                              </small>
                            </div>
                          </div>

                          {/* Expandable subcategories */}
                          {isCatActive && cat.subcategories.length > 0 && (
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              marginTop: '6px',
                              paddingLeft: '18px',
                              borderLeft: `1.5px solid ${cat.color}`,
                              paddingBottom: '2px'
                            }}>
                              {cat.subcategories.map((sub) => (
                                <div
                                  key={`legend-sub-${cat.name}-${sub.name}`}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: '0.75rem',
                                    color: 'var(--muted)',
                                    cursor: 'pointer'
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReportSliceClick(cat.name, sub.name);
                                  }}
                                  onMouseEnter={() => {
                                    setHoveredSlice({
                                      name: sub.name,
                                      spent: sub.spent,
                                      percent: (sub.spent / reportExpenseTotal) * 100,
                                      color: cat.color,
                                      isSub: true,
                                    });
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredSlice(null);
                                  }}
                                >
                                  <span>{sub.name}</span>
                                  <div>
                                    <strong>{formatEuro(sub.spent)}</strong>
                                    <small style={{ fontSize: '0.65rem', marginLeft: '4px' }}>
                                      ({((sub.spent / cat.spent) * 100).toFixed(0)}%)
                                    </small>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}
          </article>
        </div>
      )}

      {unifiedReportTab === 'trend' && (
        <CategoryTrendReport
          transactions={transactions}
          formatEuro={formatEuro}
          formatSignedEuro={formatSignedEuro}
        />
      )}

      {unifiedReportTab === 'sankey' && (
        <article className="panel large-panel" style={{ margin: 0 }}>
          <div className="panel-header">
            <div>
              <p className="panel-title">Diagramma dei Flussi Finanziari</p>
              <h4>Mappa Visiva Entrate ➔ Macro-Aree ➔ Categorie Spesa</h4>
            </div>
          </div>

          <div className="report-range">
            <label className="form-field">
              <span>Inizio intervallo</span>
              <input
                type="date"
                value={reportRange.start}
                onChange={(event) => setReportRange((current) => ({ ...current, start: event.target.value }))}
              />
            </label>
            <label className="form-field">
              <span>Fine intervallo</span>
              <input
                type="date"
                value={reportRange.end}
                onChange={(event) => setReportRange((current) => ({ ...current, end: event.target.value }))}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', marginBottom: '24px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 500, marginRight: '4px' }}>Intervalli rapidi:</span>
            <button className="pill" type="button" onClick={() => setPresetRange('questo-mese')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Questo mese</button>
            <button className="pill" type="button" onClick={() => setPresetRange('mese-scorso')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Mese scorso</button>
            <button className="pill" type="button" onClick={() => setPresetRange('ultimi-3-mesi')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Ultimi 3 mesi</button>
            <button className="pill" type="button" onClick={() => setPresetRange('quest-anno')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Quest'anno</button>
            <button className="pill" type="button" onClick={() => setPresetRange('tutto')} style={{ fontSize: '0.78rem', padding: '6px 12px' }}>Tutto</button>
          </div>

          <SankeyChart transactions={reportTransactions} budgetCategories={budgetCategories} formatEuro={formatEuro} />
        </article>
      )}

      {unifiedReportTab === 'allocation' && (
        <AssetAllocationPanel
          assets={assets}
          assetTransactions={assetTransactions}
          tickerData={tickerData}
          getAssetCurrentQuantity={getAssetCurrentQuantity}
          cashAvailable={cashAvailable}
          formatEuro={formatEuro}
          onUpdateAsset={(updated) => {
            setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
            setStatusMessage(`Asset ${updated.name} aggiornato con successo.`);
          }}
        />
      )}

      {unifiedReportTab === 'fire' && (
        <FireCalculator
          currentNetWorth={currentNetWorth}
          formatEuro={formatEuro}
        />
      )}
    </div>
  );

  const renderReport = () => renderUnifiedReportAndNetWorth();
  const renderNetWorth = () => renderUnifiedReportAndNetWorth();

  const renderRecurringAndPAC = () => {
    const allCategories = Array.from(new Set([
      ...budgetCategories.map((c) => c.name),
      'Spesa alimentare', 'Trasporti', 'Ristoranti', 'Abbonamenti', 'Salute', 'Utenze', 'Casa', 'Tempo libero', 'Entrate', 'Altro'
    ]));

    const filteredMovements = upcomingMovementsList.filter((mv) => {
      if (scadenziarioTypeFilter !== 'all' && mv.kind !== scadenziarioTypeFilter) return false;
      if (scadenziarioAccountFilter !== 'all' && mv.account && mv.account !== scadenziarioAccountFilter) return false;
      if (scadenziarioSearch.trim()) {
        const q = scadenziarioSearch.trim().toLowerCase();
        const matchName = mv.name.toLowerCase().includes(q);
        const matchCat = mv.categoryOrAsset.toLowerCase().includes(q);
        const matchSub = (mv.subcategory || '').toLowerCase().includes(q);
        const matchAcc = (mv.account || '').toLowerCase().includes(q);
        const matchNote = (mv.note || '').toLowerCase().includes(q);
        if (!matchName && !matchCat && !matchSub && !matchAcc && !matchNote) return false;
      }
      return true;
    });

    const expensesCount = upcomingMovementsList.filter((m) => m.kind === 'expense').length;
    const incomesCount = upcomingMovementsList.filter((m) => m.kind === 'income').length;
    const pacsCount = upcomingMovementsList.filter((m) => m.kind === 'pac').length;

    const dueIn7DaysMovements = upcomingMovementsList.filter((m) => m.daysRemaining >= 0 && m.daysRemaining <= 7);
    const dueIn7DaysExpenses = dueIn7DaysMovements
      .filter((m) => m.kind === 'expense' || m.kind === 'pac')
      .reduce((s, m) => s + m.amount, 0);
    const dueIn7DaysIncomes = dueIn7DaysMovements
      .filter((m) => m.kind === 'income')
      .reduce((s, m) => s + m.amount, 0);

    const horizonLabel =
      scadenziarioHorizon === '30d'
        ? 'nei prossimi 30 giorni'
        : scadenziarioHorizon === '60d'
        ? 'nei prossimi 60 giorni'
        : scadenziarioHorizon === '90d'
        ? 'nei prossimi 90 giorni'
        : 'entro fine mese corrente';

    return (
      <div className="recurring-and-pac-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Navigation Tabs - No Subscriptions tab */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setRecurringViewMode('scadenziario')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 650,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: recurringViewMode === 'scadenziario' ? 'var(--accent)' : 'transparent',
              color: recurringViewMode === 'scadenziario' ? 'var(--pill-primary-text)' : 'var(--muted)',
            }}
          >
            📅 Scadenziario & Previsioni ({upcomingMovementsList.length})
          </button>

          <button
            type="button"
            onClick={() => setRecurringViewMode('recurring')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 650,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: recurringViewMode === 'recurring' ? 'var(--accent)' : 'transparent',
              color: recurringViewMode === 'recurring' ? 'var(--pill-primary-text)' : 'var(--muted)',
            }}
          >
            🔁 Movimenti Ricorrenti ({recurringTransactions.length})
          </button>

          <button
            type="button"
            onClick={() => setRecurringViewMode('pac')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 650,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: recurringViewMode === 'pac' ? 'var(--accent)' : 'transparent',
              color: recurringViewMode === 'pac' ? 'var(--pill-primary-text)' : 'var(--muted)',
            }}
          >
            📈 Piani di Accumulo (PAC) ({pianiAccumulo.length})
          </button>

          <button
            type="button"
            onClick={() => setRecurringViewMode('cashback')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 650,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: recurringViewMode === 'cashback' ? 'var(--accent)' : 'transparent',
              color: recurringViewMode === 'cashback' ? 'var(--pill-primary-text)' : 'var(--muted)',
            }}
          >
            💳 Cashback & Saveback ({cashbackRules.length})
          </button>
        </div>

        {/* Tab 1: Scadenziario & Previsioni - Consultative only, no transaction insertion */}
        {recurringViewMode === 'scadenziario' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Header with Horizon Selection */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                padding: '16px 20px',
                borderRadius: '14px',
                background: 'var(--panel-card-bg)',
                border: '1px solid var(--border)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.1rem' }}>📅</span>
                  <strong style={{ fontSize: '1.05rem', color: 'var(--text)' }}>
                    Scadenziario & Previsioni di Cassa
                  </strong>
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Monitoraggio e pianificazione delle scadenze {horizonLabel} ({upcomingMovementsList.length} movimenti previsti).
                </p>
              </div>

              {/* Horizon Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--overlay-subtle)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, padding: '0 6px' }}>Orizzonte:</span>
                <button
                  type="button"
                  onClick={() => setScadenziarioHorizon('month')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '7px',
                    fontSize: '0.75rem',
                    fontWeight: 650,
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: scadenziarioHorizon === 'month' ? 'var(--accent)' : 'transparent',
                    color: scadenziarioHorizon === 'month' ? 'var(--pill-primary-text)' : 'var(--muted)',
                  }}
                >
                  Questo Mese
                </button>
                <button
                  type="button"
                  onClick={() => setScadenziarioHorizon('30d')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '7px',
                    fontSize: '0.75rem',
                    fontWeight: 650,
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: scadenziarioHorizon === '30d' ? 'var(--accent)' : 'transparent',
                    color: scadenziarioHorizon === '30d' ? 'var(--pill-primary-text)' : 'var(--muted)',
                  }}
                >
                  30 Giorni
                </button>
                <button
                  type="button"
                  onClick={() => setScadenziarioHorizon('60d')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '7px',
                    fontSize: '0.75rem',
                    fontWeight: 650,
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: scadenziarioHorizon === '60d' ? 'var(--accent)' : 'transparent',
                    color: scadenziarioHorizon === '60d' ? 'var(--pill-primary-text)' : 'var(--muted)',
                  }}
                >
                  60 Giorni
                </button>
                <button
                  type="button"
                  onClick={() => setScadenziarioHorizon('90d')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '7px',
                    fontSize: '0.75rem',
                    fontWeight: 650,
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: scadenziarioHorizon === '90d' ? 'var(--accent)' : 'transparent',
                    color: scadenziarioHorizon === '90d' ? 'var(--pill-primary-text)' : 'var(--muted)',
                  }}
                >
                  90 Giorni
                </button>
              </div>
            </div>

            {/* 5 Executive Metric Cards */}
            <section className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <div className="metric-card" style={{ borderLeftColor: 'var(--danger)' }}>
                <p className="metric-label">Uscite in Scadenza</p>
                <h3>{formatEuro(projectedRemainingRecurringExpenses)}</h3>
                <span className="metric-delta">{expensesCount} addebiti attesi</span>
              </div>
              <div className="metric-card">
                <p className="metric-label">Entrate Attese</p>
                <h3>{formatEuro(projectedRemainingRecurringIncomes)}</h3>
                <span className="metric-delta">{incomesCount} accrediti attesi</span>
              </div>
              <div className="metric-card" style={{ borderLeftColor: 'var(--warning)' }}>
                <p className="metric-label">PAC Programmati</p>
                <h3>{formatEuro(projectedRemainingPACs)}</h3>
                <span className="metric-delta">{pacsCount} quote di investimento</span>
              </div>
              <div className="metric-card" style={{ borderLeftColor: (projectedRemainingRecurringIncomes - projectedRemainingRecurringExpenses - projectedRemainingPACs) >= 0 ? '#34d399' : '#fb7185' }}>
                <p className="metric-label">Flusso Netto Atteso</p>
                <h3 style={{ color: (projectedRemainingRecurringIncomes - projectedRemainingRecurringExpenses - projectedRemainingPACs) >= 0 ? '#34d399' : '#fb7185' }}>
                  {(projectedRemainingRecurringIncomes - projectedRemainingRecurringExpenses - projectedRemainingPACs) >= 0 ? '+' : ''}
                  {formatEuro(projectedRemainingRecurringIncomes - projectedRemainingRecurringExpenses - projectedRemainingPACs)}
                </h3>
                <span className="metric-delta">Delta liquidità del periodo</span>
              </div>
              <div className="metric-card" style={{ borderLeftColor: 'var(--accent)' }}>
                <p className="metric-label">Previsione Saldo Liquido</p>
                <h3>{formatEuro(projectedEndBalance)}</h3>
                <span className="metric-delta">Attuale: {formatEuro(cashAvailable)}</span>
              </div>
            </section>

            {/* Liquidity Health Indicator & Urgency */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '12px',
                  background: minProjectedBalance < 0 ? 'rgba(251, 113, 133, 0.08)' : 'rgba(52, 211, 153, 0.08)',
                  border: `1px solid ${minProjectedBalance < 0 ? 'rgba(251, 113, 133, 0.3)' : 'rgba(52, 211, 153, 0.25)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '1.4rem' }}>{minProjectedBalance < 0 ? '⚠️' : '🛡️'}</span>
                <div>
                  <strong style={{ fontSize: '0.85rem', color: minProjectedBalance < 0 ? '#fb7185' : '#34d399', display: 'block' }}>
                    {minProjectedBalance < 0 ? 'Attenzione: Rischio Scoperto di Cassa' : 'Sicurezza Liquidità Ottimale'}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {minProjectedBalance < 0
                      ? `Il saldo scenderebbe a ${formatEuro(minProjectedBalance)} il ${formatDisplayDate(minProjectedBalanceDate)}. Valuta un differimento o un rabbocco.`
                      : `Il saldo liquido rimarrà sempre positivo durante l'intero periodo (minimo stimato: ${formatEuro(minProjectedBalance)} il ${formatDisplayDate(minProjectedBalanceDate)}).`}
                  </span>
                </div>
              </div>

              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '12px',
                  background: 'rgba(56, 189, 248, 0.06)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '1.4rem' }}>⚡</span>
                <div>
                  <strong style={{ fontSize: '0.85rem', color: '#38bdf8', display: 'block' }}>
                    In scadenza entro 7 giorni: {dueIn7DaysMovements.length} moviment{dueIn7DaysMovements.length === 1 ? 'o' : 'i'}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    Uscite/PAC: <strong style={{ color: '#fb7185' }}>-{formatEuro(dueIn7DaysExpenses)}</strong> · Entrate: <strong style={{ color: '#34d399' }}>+{formatEuro(dueIn7DaysIncomes)}</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Filter Toolbar */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
                padding: '12px 16px',
                borderRadius: '12px',
                background: 'var(--panel-card-bg)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setScadenziarioTypeFilter('all')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: scadenziarioTypeFilter === 'all' ? 'var(--accent)' : 'var(--border)',
                    background: scadenziarioTypeFilter === 'all' ? 'var(--accent)' : 'transparent',
                    color: scadenziarioTypeFilter === 'all' ? 'var(--pill-primary-text)' : 'var(--muted)',
                  }}
                >
                  Tutti ({upcomingMovementsList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScadenziarioTypeFilter('expense')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: scadenziarioTypeFilter === 'expense' ? '#fb7185' : 'var(--border)',
                    background: scadenziarioTypeFilter === 'expense' ? 'rgba(251, 113, 133, 0.2)' : 'transparent',
                    color: scadenziarioTypeFilter === 'expense' ? '#fb7185' : 'var(--muted)',
                  }}
                >
                  Uscite ({expensesCount})
                </button>
                <button
                  type="button"
                  onClick={() => setScadenziarioTypeFilter('income')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: scadenziarioTypeFilter === 'income' ? '#34d399' : 'var(--border)',
                    background: scadenziarioTypeFilter === 'income' ? 'rgba(52, 211, 153, 0.2)' : 'transparent',
                    color: scadenziarioTypeFilter === 'income' ? '#34d399' : 'var(--muted)',
                  }}
                >
                  Entrate ({incomesCount})
                </button>
                <button
                  type="button"
                  onClick={() => setScadenziarioTypeFilter('pac')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: scadenziarioTypeFilter === 'pac' ? '#38bdf8' : 'var(--border)',
                    background: scadenziarioTypeFilter === 'pac' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                    color: scadenziarioTypeFilter === 'pac' ? '#38bdf8' : 'var(--muted)',
                  }}
                >
                  PAC ({pacsCount})
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={scadenziarioAccountFilter}
                  onChange={(e) => setScadenziarioAccountFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.78rem',
                  }}
                >
                  <option value="all">Tutti i conti</option>
                  {accountOptions.map((acc) => (
                    <option key={acc} value={acc}>{acc}</option>
                  ))}
                </select>

                <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Cerca per nome, categoria..."
                    value={scadenziarioSearch}
                    onChange={(e) => setScadenziarioSearch(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--input-bg)',
                      color: 'var(--text)',
                      fontSize: '0.78rem',
                      width: '200px',
                    }}
                  />
                  {scadenziarioSearch && (
                    <button
                      type="button"
                      onClick={() => setScadenziarioSearch('')}
                      style={{
                        position: 'absolute',
                        right: '6px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Scadenziario Agenda Table - Strictly read-only/consultative, no insert transactions */}
            <article className="panel" style={{ width: '100%' }}>
              <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p className="panel-title">Cronologia delle Scadenze</p>
                  <h4>{filteredMovements.length} movimenti pianificati nel periodo selezionato</h4>
                </div>
              </div>

              {filteredMovements.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  <p style={{ margin: 0, fontWeight: 550 }}>Nessun movimento programmato con i filtri attuali.</p>
                  <p style={{ margin: '6px 0 0 0', fontSize: '0.8rem' }}>
                    Puoi ampliare l'orizzonte a 30, 60 o 90 giorni oppure gestire le ricorrenze nelle schede dedicate.
                  </p>
                </div>
              ) : (
                <div className="transaction-table" style={{ maxHeight: '460px', overflowY: 'auto' }}>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Data Scadenza</th>
                        <th>Elemento & Frequenza</th>
                        <th>Tipo</th>
                        <th>Categoria / Target</th>
                        <th>Conto Riferimento</th>
                        <th style={{ textAlign: 'right' }}>Importo</th>
                        <th style={{ textAlign: 'right' }}>Saldo Stimato Dopo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMovements.map((mv) => {
                        const countdownBadge =
                          mv.daysRemaining === 0 ? (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(251, 113, 133, 0.2)', color: '#fb7185' }}>
                              Oggi
                            </span>
                          ) : mv.daysRemaining === 1 ? (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>
                              Domani
                            </span>
                          ) : mv.daysRemaining <= 7 ? (
                            <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8' }}>
                              Tra {mv.daysRemaining} gg
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--muted)' }}>
                              Tra {mv.daysRemaining} gg
                            </span>
                          );

                        const balanceColor =
                          (mv.projectedBalanceAfter ?? 0) < 0
                            ? '#fb7185'
                            : (mv.projectedBalanceAfter ?? 0) < 1000
                            ? '#f59e0b'
                            : '#34d399';

                        return (
                          <tr key={mv.id}>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>{formatDisplayDate(mv.dateStr)}</span>
                                {countdownBadge}
                              </div>
                            </td>
                            <td>
                              <div>
                                <strong style={{ fontSize: '0.88rem', color: 'var(--text)', display: 'block' }}>
                                  {mv.name}
                                </strong>
                                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                                  {mv.frequencyLabel} {mv.subcategory ? `· ${mv.subcategory}` : ''} {mv.note ? `· ${mv.note}` : ''}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span
                                className={`badge ${mv.kind === 'income' ? 'badge-income' : mv.kind === 'expense' ? 'badge-expense' : 'badge-pac'}`}
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  backgroundColor:
                                    mv.kind === 'income'
                                      ? 'rgba(52, 211, 153, 0.15)'
                                      : mv.kind === 'expense'
                                      ? 'rgba(251, 113, 133, 0.15)'
                                      : 'rgba(56, 189, 248, 0.15)',
                                  color: mv.kind === 'income' ? '#34d399' : mv.kind === 'expense' ? '#fb7185' : '#38bdf8',
                                }}
                              >
                                {mv.kind === 'income' ? 'Entrata' : mv.kind === 'expense' ? 'Uscita' : 'PAC'}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: '0.82rem' }}>{mv.categoryOrAsset}</span>
                            </td>
                            <td>
                              <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                                {mv.account || 'Conto predefinito'}
                              </span>
                            </td>
                            <td
                              style={{
                                textAlign: 'right',
                                fontWeight: 700,
                                fontFamily: 'var(--font-mono)',
                                color: mv.kind === 'income' ? '#34d399' : mv.kind === 'expense' ? '#fb7185' : '#38bdf8',
                              }}
                            >
                              {mv.kind === 'income' ? '+' : '-'}{formatEuro(mv.amount)}
                            </td>
                            <td
                              style={{
                                textAlign: 'right',
                                fontWeight: 700,
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.88rem',
                                color: balanceColor,
                              }}
                            >
                              {formatEuro(mv.projectedBalanceAfter ?? 0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--overlay-subtle)', borderRadius: '0 0 12px 12px' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                  💡 Questa sezione visualizza le scadenze e proietta l'evoluzione del saldo liquido. Per configurare nuove uscite ricorrenti o PAC, passa alle schede "Movimenti Ricorrenti" e "Piani di Accumulo (PAC)".
                </span>
              </div>
            </article>
          </div>
        )}

        {/* Panel 1: Recurring Transactions */}
        {recurringViewMode === 'recurring' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 440px) 1fr', gap: '2rem', alignItems: 'start' }}>
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">{editingRecurringId ? 'Modifica Transazione Ricorrente' : 'Aggiungi Transazione Ricorrente'}</p>
                  <h4>{editingRecurringId ? 'Aggiorna i dettagli della pianificazione' : 'Pianifica un\'entrata o un\'uscita periodica'}</h4>
                </div>
              </div>
              
              <form className="transaction-form" onSubmit={handleAddRecurringTransaction}>
                <div className="form-grid">
                  <label className="form-field">
                    <span>Esercente / Descrizione</span>
                    <input
                      type="text"
                      value={recurringDraft.merchant}
                      onChange={(e) => setRecurringDraft(prev => ({ ...prev, merchant: e.target.value }))}
                      placeholder="Es. Stipendio, Affitto casa, Netflix"
                      required
                    />
                  </label>
                  <label className="form-field">
                    <span>Importo (€)</span>
                    <input
                      type="number"
                      step="any"
                      value={recurringDraft.amount}
                      onChange={(e) => setRecurringDraft(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder="0.00"
                      required
                    />
                  </label>
                  <label className="form-field">
                    <span>Tipo</span>
                    <select
                      value={recurringDraft.kind}
                      onChange={(e) => setRecurringDraft(prev => ({ ...prev, kind: e.target.value as TransactionKind, category: e.target.value === 'income' ? 'Entrate' : prev.category }))}
                    >
                      <option value="expense">Uscita (Spesa)</option>
                      <option value="income">Entrata (Ricavo)</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Categoria</span>
                    <select
                      value={recurringDraft.category}
                      onChange={(e) => setRecurringDraft(prev => ({ ...prev, category: e.target.value }))}
                    >
                      <option value="">Scegli una categoria...</option>
                      {allCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Sottocategoria</span>
                    <input
                      type="text"
                      value={recurringDraft.subcategory}
                      onChange={(e) => setRecurringDraft(prev => ({ ...prev, subcategory: e.target.value }))}
                      placeholder="Es. Streaming, Spesa mensile"
                    />
                  </label>
                  <label className="form-field">
                    <span>Conto / Metodo</span>
                    <input
                      type="text"
                      value={recurringDraft.account}
                      onChange={(e) => setRecurringDraft(prev => ({ ...prev, account: e.target.value }))}
                      placeholder="Es. Conto principale, Carta di Credito"
                    />
                  </label>
                  <label className="form-field">
                    <span>Frequenza</span>
                    <select
                      value={recurringDraft.frequency}
                      onChange={(e) => setRecurringDraft(prev => ({ ...prev, frequency: e.target.value as RecurringFrequency }))}
                    >
                      <option value="monthly">Mensile (Giorno del mese)</option>
                      <option value="weekly">Settimanale (Giorno della settimana)</option>
                      <option value="custom_days">Intervallo personalizzato (Giorni)</option>
                    </select>
                  </label>

                  {recurringDraft.frequency === 'monthly' && (
                    <label className="form-field">
                      <span>Giorno del Mese</span>
                      <select
                        value={recurringDraft.dayOfMonth}
                        onChange={(e) => setRecurringDraft(prev => ({ ...prev, dayOfMonth: e.target.value }))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={day}>{day}°</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {recurringDraft.frequency === 'weekly' && (
                    <label className="form-field">
                      <span>Giorno della Settimana</span>
                      <select
                        value={recurringDraft.dayOfWeek}
                        onChange={(e) => setRecurringDraft(prev => ({ ...prev, dayOfWeek: e.target.value }))}
                      >
                        <option value="1">Lunedì</option>
                        <option value="2">Martedì</option>
                        <option value="3">Mercoledì</option>
                        <option value="4">Giovedì</option>
                        <option value="5">Venerdì</option>
                        <option value="6">Sabato</option>
                        <option value="0">Domenica</option>
                      </select>
                    </label>
                  )}

                  {recurringDraft.frequency === 'custom_days' && (
                    <label className="form-field">
                      <span>Ogni quanti giorni</span>
                      <input
                        type="number"
                        min="1"
                        value={recurringDraft.intervalDays}
                        onChange={(e) => setRecurringDraft(prev => ({ ...prev, intervalDays: e.target.value }))}
                        placeholder="15"
                        required
                      />
                    </label>
                  )}

                  <label className="form-field">
                    <span>Data d'Inizio</span>
                    <input
                      type="date"
                      value={recurringDraft.startDate}
                      onChange={(e) => setRecurringDraft(prev => ({ ...prev, startDate: e.target.value }))}
                      required
                    />
                  </label>
                </div>

                <label className="form-field form-field-wide">
                  <span>Nota aggiuntiva</span>
                  <input
                    type="text"
                    value={recurringDraft.note}
                    onChange={(e) => setRecurringDraft(prev => ({ ...prev, note: e.target.value }))}
                    placeholder="Nota o memo"
                  />
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none', margin: '4px 0' }}>
                  <input
                    type="checkbox"
                    id="auto-post-checkbox"
                    checked={recurringDraft.autoPost}
                    onChange={(e) => setRecurringDraft(prev => ({ ...prev, autoPost: e.target.checked }))}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="auto-post-checkbox" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>
                    Registra automaticamente come transazione reale alla data stabilita (Auto-Post ⚡)
                  </label>
                </div>

                <div className="form-actions" style={{ marginTop: '0.5rem' }}>
                  <button className="pill pill-primary" type="submit">
                    {editingRecurringId ? 'Aggiorna ricorrente' : 'Aggiungi ricorrente'}
                  </button>
                  {editingRecurringId && (
                    <button
                      className="pill"
                      type="button"
                      onClick={handleCancelEditRecurringTransaction}
                    >
                      Annulla modifica
                    </button>
                  )}
                </div>
              </form>
            </article>

            {/* List of active recurring transactions */}
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Lista Transazioni Ricorrenti</p>
                  <h4>{recurringTransactions.length} pianificate in memoria</h4>
                </div>
              </div>
              {recurringTransactions.length === 0 ? (
                <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.9rem', textAlign: 'center' }}>
                  Nessuna transazione ricorrente impostata. Compila il modulo sopra per iniziare.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '350px', overflowY: 'auto', padding: '0.5rem' }}>
                  {recurringTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      style={{
                        padding: '1rem',
                        border: '1px solid var(--border)',
                        borderRadius: '12px',
                        backgroundColor: tx.isActive ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255,255,255,0.01)',
                        opacity: tx.isActive ? 1 : 0.6,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '1rem'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                          <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: tx.kind === 'income' ? '#34d399' : '#fb7185'
                          }} />
                          <strong style={{ fontSize: '0.95rem' }}>{tx.merchant}</strong>
                          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px' }}>
                            {tx.frequency === 'monthly' ? `Ogni il ${tx.dayOfMonth}° del mese` : tx.frequency === 'weekly' ? 'Ogni settimana' : `Ogni ${tx.intervalDays} giorni`}
                          </span>
                          {tx.autoPost && (
                            <span style={{ fontSize: '0.7rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                              Auto-Registra ⚡
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: 0 }}>
                          Cat: {tx.category} · Inizio: {formatDisplayDate(tx.startDate)} {tx.note && `· ${tx.note}`}
                        </p>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          fontSize: '1rem',
                          color: tx.kind === 'income' ? '#34d399' : '#fb7185',
                          marginRight: '4px'
                        }}>
                          {tx.kind === 'income' ? '+' : '-'}{formatEuro(tx.amount)}
                        </span>
                        
                        <button
                          className="pill"
                          type="button"
                          onClick={() => handleToggleRecurringTransaction(tx.id)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '0.7rem',
                            background: tx.isActive ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                            color: tx.isActive ? '#34d399' : 'var(--muted)',
                          }}
                        >
                          {tx.isActive ? 'Attivo' : 'Pausa'}
                        </button>

                        <button
                          className="pill"
                          type="button"
                          onClick={() => handleEditRecurringTransaction(tx)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '0.7rem',
                            background: editingRecurringId === tx.id ? 'var(--accent)' : 'rgba(56, 189, 248, 0.15)',
                            color: editingRecurringId === tx.id ? '#07111f' : '#38bdf8',
                            fontWeight: editingRecurringId === tx.id ? 700 : 500
                          }}
                        >
                          Modifica
                        </button>

                        <button
                          className="pill"
                          type="button"
                          onClick={() => handleDeleteRecurringTransaction(tx.id)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '0.7rem',
                            background: 'rgba(251, 113, 133, 0.12)',
                            color: '#fb7185'
                          }}
                        >
                          Elimina
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        )}

        {/* Panel 2: Piani di Accumulo (PAC) */}
        {recurringViewMode === 'pac' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 440px) 1fr', gap: '2rem', alignItems: 'start' }}>
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">{editingPacId ? 'Modifica Piano di Accumulo (PAC)' : 'Aggiungi Piano di Accumulo (PAC)'}</p>
                  <h4>Investi una somma fissa mensile in un asset</h4>
                </div>
              </div>
              
              {assets.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '12px', color: 'var(--muted)' }}>
                  <p style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>Nessun asset inserito nel portafoglio.</p>
                  <button className="pill pill-primary" type="button" onClick={() => setActiveSection('attivita')}>
                    Crea prima un Asset
                  </button>
                </div>
              ) : (
                <form className="transaction-form" onSubmit={handleAddPAC}>
                  <div className="form-grid">
                    <label className="form-field">
                      <span>Nome del PAC</span>
                      <input
                        type="text"
                        value={pacDraft.name}
                        onChange={(e) => setPacDraft(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Es. PAC MSCI World, Risparmio Apple"
                        required
                      />
                    </label>
                    <label className="form-field">
                      <span>Versamento (€/mese)</span>
                      <input
                        type="number"
                        step="any"
                        value={pacDraft.amount}
                        onChange={(e) => setPacDraft(prev => ({ ...prev, amount: e.target.value }))}
                        placeholder="0.00"
                        required
                      />
                    </label>
                    <label className="form-field" style={{ gridColumn: 'span 2' }}>
                      <span>Asset di Destinazione</span>
                      <select
                        value={pacDraft.assetId}
                        onChange={(e) => setPacDraft(prev => ({ ...prev, assetId: e.target.value }))}
                        required
                      >
                        <option value="">Scegli un asset...</option>
                        {assets.map(asset => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name} ({asset.kind.toUpperCase()} - {asset.institution})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      <span>Conto di Addebito</span>
                      <select
                        value={pacDraft.account}
                        onChange={(e) => setPacDraft(prev => ({ ...prev, account: e.target.value }))}
                      >
                        <option value="">-- Conto dell'Asset / Predefinito --</option>
                        {accountOptions.map((acc) => (
                          <option key={acc} value={acc}>{acc}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      <span>Giorno del Mese</span>
                      <select
                        value={pacDraft.dayOfMonth}
                        onChange={(e) => setPacDraft(prev => ({ ...prev, dayOfMonth: e.target.value }))}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={day}>{day}° del mese</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field" style={{ gridColumn: 'span 2' }}>
                      <span>Data d'Inizio</span>
                      <input
                        type="date"
                        value={pacDraft.startDate}
                        onChange={(e) => setPacDraft(prev => ({ ...prev, startDate: e.target.value }))}
                        required
                      />
                    </label>
                  </div>

                  <div style={{
                    marginTop: '1rem',
                    padding: '0.85rem',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.05)',
                    border: '1px solid rgba(56, 189, 248, 0.15)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.6rem'
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                      <input
                        type="checkbox"
                        checked={pacDraft.autoPost}
                        onChange={(e) => setPacDraft(prev => ({ ...prev, autoPost: e.target.checked }))}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                        Inserimento automatico alla data prevista
                      </span>
                    </label>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)', paddingLeft: '24px' }}>
                      All'avvio dell'app o al raggiungimento del giorno del mese, registra in automatico la spesa e l'investimento.
                    </p>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                      <input
                        type="checkbox"
                        checked={pacDraft.createAssetTransaction}
                        onChange={(e) => setPacDraft(prev => ({ ...prev, createAssetTransaction: e.target.checked }))}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                        Registra acquisto quote nell'Asset
                      </span>
                    </label>
                  </div>

                  <div className="form-actions" style={{ marginTop: '1rem' }}>
                    <button className="pill pill-primary" type="submit">
                      {editingPacId ? 'Aggiorna PAC' : 'Attiva PAC'}
                    </button>
                    {editingPacId && (
                      <button className="pill" type="button" onClick={handleCancelEditPAC}>
                        Annulla
                      </button>
                    )}
                  </div>
                </form>
              )}
            </article>

            {/* List of active PACs */}
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Lista Piani di Accumulo (PAC)</p>
                  <h4>{pianiAccumulo.length} configurati ({pianiAccumulo.filter(p => p.isActive).length} attivi)</h4>
                </div>
              </div>
              {pianiAccumulo.length === 0 ? (
                <p style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.9rem', textAlign: 'center' }}>
                  Nessun piano di accumulo impostato. Compila il modulo sopra per iniziare.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxHeight: '420px', overflowY: 'auto', padding: '0.5rem' }}>
                  {pianiAccumulo.map((pac) => {
                    const targetAsset = assets.find((a) => a.id === pac.assetId);
                    const debitAccount = pac.account || (targetAsset ? targetAsset.institution : '') || 'Conto principale';
                    const isAuto = pac.autoPost !== false;

                    return (
                      <div
                        key={pac.id}
                        style={{
                          padding: '1rem',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          backgroundColor: pac.isActive ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255,255,255,0.01)',
                          opacity: pac.isActive ? 1 : 0.65,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.75rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                              <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: '#38bdf8'
                              }} />
                              <strong style={{ fontSize: '1rem' }}>{pac.name}</strong>
                              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '6px' }}>
                                Ogni {pac.dayOfMonth}° del mese
                              </span>
                              <span
                                onClick={() => handleTogglePACAutoPost(pac.id)}
                                title="Clicca per attivare/disattivare l'inserimento automatico alla data"
                                style={{
                                  fontSize: '0.7rem',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  backgroundColor: isAuto ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                                  color: isAuto ? '#38bdf8' : 'var(--muted)',
                                  border: isAuto ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid var(--border)',
                                }}
                              >
                                {isAuto ? '⚡ Auto-inserimento: ON' : '⏸ Auto-inserimento: OFF'}
                              </span>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: 0 }}>
                              Asset: <strong style={{ color: 'var(--text)' }}>{targetAsset ? targetAsset.name : 'Sconosciuto'}</strong> · Conto addebito: <strong>{debitAccount}</strong> · Inizio: {formatDisplayDate(pac.startDate)}
                            </p>
                            {pac.lastPostedDate && (
                              <p style={{ fontSize: '0.75rem', color: '#34d399', margin: '4px 0 0 0' }}>
                                ✓ Ultima rata registrata: {formatDisplayDate(pac.lastPostedDate)}
                              </p>
                            )}
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <span style={{
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              fontSize: '1.1rem',
                              color: '#38bdf8',
                              display: 'block'
                            }}>
                              {formatEuro(pac.amount)}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>al mese</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
                          <button
                            className="pill"
                            type="button"
                            onClick={() => handlePostPACManual(pac)}
                            title="Inserisci subito la rata per oggi"
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              background: 'rgba(56, 189, 248, 0.12)',
                              color: '#38bdf8',
                              border: '1px solid rgba(56, 189, 248, 0.25)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <span>⚡</span> Registra Rata Oggi
                          </button>

                          <button
                            className="pill"
                            type="button"
                            onClick={() => handleTogglePAC(pac.id)}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              background: pac.isActive ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                              color: pac.isActive ? '#34d399' : 'var(--muted)',
                            }}
                          >
                            {pac.isActive ? 'Attivo' : 'In Pausa'}
                          </button>

                          <button
                            className="pill"
                            type="button"
                            onClick={() => handleEditPAC(pac)}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              background: 'rgba(255, 255, 255, 0.08)',
                              color: 'var(--text)',
                            }}
                          >
                            Modifica
                          </button>

                          <button
                            className="pill"
                            type="button"
                            onClick={() => handleDeletePAC(pac.id)}
                            style={{
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              background: 'rgba(251, 113, 133, 0.12)',
                              color: '#fb7185'
                            }}
                          >
                            Rimuovi
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          </div>
        )}

        {/* Tab 4: Cashback & Saveback Manager */}
        {recurringViewMode === 'cashback' && (
          <CashbackManager
            cashbackRules={cashbackRules}
            transactions={transactions}
            assets={assets}
            accountOptions={accountOptions}
            formatEuro={formatEuro}
            formatDisplayDate={formatDisplayDate}
            onAddRule={handleAddCashbackRule}
            onUpdateRule={handleUpdateCashbackRule}
            onDeleteRule={handleDeleteCashbackRule}
            onToggleRule={handleToggleCashbackRule}
            onExecuteCashback={handleExecuteCashback}
          />
        )}
      </div>
    );
  };

  const renderSettings = () => (
    <section className="section-grid settings-layout">
      <article className="panel large-panel">
        <div className="panel-header">
          <div>
            <p className="panel-title">Personalizzazione & Privacy</p>
            <h4>Aspetto grafico, tema e sicurezza</h4>
          </div>
        </div>

        {/* Privacy & Oscuramento Cifre */}
        <div style={{ marginTop: '16px' }}>
          <p className="panel-title" style={{ marginBottom: '10px', fontSize: '0.72rem' }}>Privacy & Protezione Cifre</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--overlay-subtle)', padding: '12px 14px', borderRadius: '14px', border: '1px solid var(--border)', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {hideNumbers ? <EyeOff size={16} color="#f87171" /> : <Eye size={16} color="var(--accent)" />}
                Oscuramento dati finanziari
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Nascondi tutti i saldi, transazioni e dettagli patrimoniali per lavorare in sicurezza in pubblico</span>
            </div>

            <button
              type="button"
              onClick={() => {
                const nextVal = !hideNumbers;
                setHideNumbers(nextVal);
                setStatusMessage(nextVal ? 'Modalità privacy attivata: cifre oscurate.' : 'Modalità privacy disattivata: cifre visibili.');
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: hideNumbers ? '#ef4444' : 'var(--accent)',
                color: '#ffffff',
                transition: 'all 0.15s ease',
                border: '0',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {hideNumbers ? <EyeOff size={14} /> : <Eye size={14} />}
              <span>{hideNumbers ? 'Disattiva oscuramento' : 'Attiva oscuramento'}</span>
            </button>
          </div>
        </div>

        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <p className="panel-title" style={{ marginBottom: '10px', fontSize: '0.72rem' }}>Tema dell'applicazione</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--overlay-subtle)', padding: '10px 14px', borderRadius: '14px', border: '1px solid var(--border)', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>Personalizzazione visiva</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Seleziona la modalità chiara o scura</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--input-bg)', padding: '3px', borderRadius: '10px', border: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => {
                  setTheme('light');
                  setStatusMessage('Tema chiaro attivato.');
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '7px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: theme === 'light' ? 'var(--accent)' : 'transparent',
                  color: theme === 'light' ? (theme === 'light' ? '#ffffff' : '#07111f') : 'var(--muted)',
                  transition: 'all 0.15s ease',
                  border: '0',
                  cursor: 'pointer'
                }}
              >
                Chiaro
              </button>
              <button
                type="button"
                onClick={() => {
                  setTheme('dark');
                  setStatusMessage('Tema scuro attivato.');
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '7px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: theme === 'dark' ? 'var(--accent)' : 'transparent',
                  color: theme === 'dark' ? '#07111f' : 'var(--muted)',
                  transition: 'all 0.15s ease',
                  border: '0',
                  cursor: 'pointer'
                }}
              >
                Scuro
              </button>
            </div>
          </div>
        </div>

        {/* Secondary Color Customization */}
        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <p className="panel-title" style={{ marginBottom: '10px', fontSize: '0.72rem' }}>Colore Secondario (Palette Completa)</p>
          <div style={{ background: 'var(--overlay-subtle)', padding: '14px', borderRadius: '14px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>Personalizza l'accento dei conti e dei grafici</span>
              {accentColor && (
                <button
                  type="button"
                  onClick={() => {
                    setAccentColor('');
                    setStatusMessage('Colore secondario ripristinato ai valori predefiniti.');
                  }}
                  style={{
                    fontSize: '0.72rem',
                    background: 'var(--overlay-medium)',
                    color: 'var(--text)',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    cursor: 'pointer'
                  }}
                >
                  Ripristina predefinito
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
              {[
                { name: 'Smeraldo', value: '#10b981' },
                { name: 'Teal/Menta', value: '#14b8a6' },
                { name: 'Cielo', value: '#0ea5e9' },
                { name: 'Indaco', value: '#6366f1' },
                { name: 'Viola', value: '#a855f7' },
                { name: 'Rosa', value: '#ec4899' },
                { name: 'Arancio', value: '#f97316' },
                { name: 'Ambra', value: '#f59e0b' },
              ].map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    setAccentColor(preset.value);
                    setStatusMessage(`Colore secondario impostato a ${preset.name} (${preset.value}).`);
                  }}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: preset.value,
                    border: accentColor === preset.value ? '3px solid var(--text)' : '1px solid rgba(0,0,0,0.2)',
                    boxShadow: accentColor === preset.value ? '0 0 10px rgba(0,0,0,0.4)' : 'none',
                    cursor: 'pointer',
                    transition: 'transform 0.15s ease',
                  }}
                  title={preset.name}
                />
              ))}

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', background: 'var(--input-bg)', padding: '4px 10px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 500 }}>Personalizzato:</span>
                <input
                  type="color"
                  value={accentColor || (theme === 'light' ? '#0f766e' : '#5eead4')}
                  onChange={(e) => {
                    setAccentColor(e.target.value);
                    setStatusMessage(`Colore secondario personalizzato impostato a ${e.target.value}.`);
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    border: 'none',
                    borderRadius: '4px',
                    background: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  title="Scegli un colore personalizzato dalla palette completa"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Background Patterns & Watermarks */}
        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <p className="panel-title" style={{ marginBottom: '10px', fontSize: '0.72rem' }}>Personalizzazione dello Sfondo (Filigrane)</p>
          <div style={{ background: 'var(--overlay-subtle)', padding: '14px', borderRadius: '14px', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Scegli un effetto per lo sfondo</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'block', marginBottom: '12px' }}>Aggiunge texture eleganti per personalizzare il cruscotto</span>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px' }}>
              {[
                { id: 'none', label: 'Nessuno', desc: 'Pulito' },
                { id: 'stars', label: '✨ Stelline', desc: 'Notte magica' },
                { id: 'grid', label: '🌐 Griglia', desc: 'Developer style' },
                { id: 'waves', label: '〰️ Onde', desc: 'Filigrana banconota' },
                { id: 'dots', label: '░ Puntini', desc: 'Matrice retro' },
              ].map((effect) => (
                <button
                  key={effect.id}
                  type="button"
                  onClick={() => {
                    setBgEffect(effect.id as any);
                    setStatusMessage(`Effetto sfondo impostato a: ${effect.label}.`);
                  }}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '10px',
                    border: bgEffect === effect.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: bgEffect === effect.id ? 'var(--overlay-medium)' : 'var(--input-bg)',
                    color: bgEffect === effect.id ? 'var(--text)' : 'var(--muted)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <strong style={{ fontSize: '0.8rem', fontWeight: 650 }}>{effect.label}</strong>
                  <span style={{ fontSize: '0.62rem', color: 'var(--muted)', opacity: 0.8 }}>{effect.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </article>

      {/* GitHub Auto-Updates Panel */}
      <article className="panel large-panel">
        <div className="panel-header">
          <div>
            <p className="panel-title">Aggiornamenti & Versioni</p>
            <h4>Aggiornamenti Automatici da GitHub</h4>
          </div>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '100px',
              background: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)',
            }}
          >
            Versione attuale: v{APP_VERSION}
          </span>
        </div>

        <p className="import-hint" style={{ marginBottom: '1.2rem' }}>
          L'applicazione può verificare in autonomia la presenza di nuove release su GitHub ad ogni apertura.
          Quando è disponibile un aggiornamento, viene sempre richiesta la tua esplicita autorizzazione prima di procedere con il download e l'installazione.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Toggle Controllo Automatico ad ogni apertura */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--overlay-subtle)',
              padding: '14px',
              borderRadius: '14px',
              border: '1px solid var(--border)',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '480px' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>
                🔄 Controlla automaticamente su GitHub ad ogni apertura
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: '1.4' }}>
                All'avvio dell'app verrà interrogata l'API GitHub Releases. Se è disponibile una versione più recente, apparirà la finestra con il changelog e la richiesta di consenso.
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                const nextVal = !autoCheckUpdates;
                setAutoCheckUpdates(nextVal);
                setStatusMessage(
                  nextVal
                    ? 'Controllo automatico aggiornamenti abilitato: verificherà ad ogni avvio.'
                    : 'Controllo automatico aggiornamenti disabilitato.'
                );
              }}
              style={{
                padding: '7px 16px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: autoCheckUpdates ? '#10b981' : 'var(--overlay-medium)',
                color: '#ffffff',
                border: '0',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {autoCheckUpdates ? 'Attivo ad ogni avvio ✓' : 'Disattivato'}
            </button>
          </div>

          {/* Configurazione Repository GitHub */}
          <div
            style={{
              background: 'var(--overlay-subtle)',
              padding: '16px',
              borderRadius: '14px',
              border: '1px solid var(--border)',
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: '4px' }}>
              Repository GitHub da monitorare
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted)', display: 'block', marginBottom: '10px' }}>
              Specifica il repository pubblico su GitHub contenente le Release e gli installer (DMG, ZIP, EXE).
            </span>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="es. proprietario/nome-repository"
                style={{
                  flex: 1,
                  minWidth: '220px',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: 'var(--input-bg)',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                }}
              />
              <button
                type="button"
                className="pill"
                onClick={() => {
                  setGithubRepo('Ale410-cpu/App-Budgeting-2');
                  setStatusMessage('Repository GitHub reimpostato al valore predefinito (Ale410-cpu/App-Budgeting-2).');
                }}
                style={{ padding: '8px 14px', fontSize: '0.78rem' }}
              >
                Reimposta predefinito
              </button>
            </div>
          </div>

          {/* Pulsanti Azione e Feedback Manuale */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap',
              paddingTop: '6px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pill pill-primary"
                onClick={() => performCheckForUpdates(true)}
                disabled={isCheckingUpdateManual}
                style={{
                  padding: '9px 18px',
                  fontSize: '0.84rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: isCheckingUpdateManual ? 'wait' : 'pointer',
                  opacity: isCheckingUpdateManual ? 0.7 : 1,
                }}
              >
                {isCheckingUpdateManual ? 'Verifica in corso...' : '🔍 Controlla aggiornamenti adesso'}
              </button>

              <button
                type="button"
                className="pill"
                onClick={handleOpenReleaseUrl}
                style={{ padding: '9px 16px', fontSize: '0.84rem', cursor: 'pointer' }}
              >
                Apri pagina GitHub Releases ↗
              </button>
            </div>

            {dismissedVersion && (
              <button
                type="button"
                onClick={() => {
                  setDismissedVersion(null);
                  try {
                    localStorage.removeItem('budget_dismissed_update_version');
                  } catch {}
                  setStatusMessage('Notifiche ripristinate per tutte le versioni.');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Ripristina avvisi versione saltata (v{dismissedVersion})
              </button>
            )}
          </div>

          {/* Risultato della verifica manuale */}
          {manualCheckFeedback && (
            <div
              style={{
                marginTop: '4px',
                padding: '10px 14px',
                borderRadius: '10px',
                background: manualCheckFeedback.includes('Nuovo')
                  ? 'rgba(14, 165, 233, 0.12)'
                  : 'var(--overlay-subtle)',
                border: manualCheckFeedback.includes('Nuovo')
                  ? '1px solid rgba(14, 165, 233, 0.3)'
                  : '1px solid var(--border)',
                color: manualCheckFeedback.includes('Nuovo') ? '#38bdf8' : 'var(--text)',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>{manualCheckFeedback.includes('Nuovo') ? '✨' : 'ℹ️'}</span>
              <span>{manualCheckFeedback}</span>
            </div>
          )}
        </div>
      </article>

      <article className="panel large-panel">
        <div className="panel-header">
          <div>
            <p className="panel-title">Configurazione Capitale Iniziale</p>
            <h4>Imposta le cifre e la data di avvio per ogni conto</h4>
          </div>
        </div>
        <p className="import-hint" style={{ marginBottom: '1.2rem' }}>
          Imposta il capitale iniziale al giorno in cui decidi di iniziare a usare questo registro.
          Le transazioni registrate prima di questa data verranno escluse dal calcolo dei saldi attuali.
        </p>
        <div className="editor-form">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <label className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600 }}>Data del Capitale Iniziale</span>
              <input
                type="date"
                value={openingDate}
                onChange={(event) => {
                  const val = event.target.value || '2026-01-01';
                  setOpeningDate(val);
                  setStatusMessage(`Data del capitale iniziale aggiornata a ${formatDisplayDate(val)}.`);
                }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
              />
            </label>
          </div>

          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: '4px' }}>
              Capitale Iniziale per Conto
            </span>
            <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '16px' }}>
              Imposta il saldo iniziale di ogni conto alla data iniziale ({formatDisplayDate(openingDate)}).
            </p>

            {uniqueAccounts.length === 0 ? (
              <div style={{ padding: '20px', background: 'var(--overlay-subtle)', borderRadius: '14px', border: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center' }}>
                Nessun conto rilevato nelle transazioni esistenti.
                <div style={{ marginTop: '12px', maxWidth: '300px', margin: '12px auto 0', textAlign: 'left' }}>
                  <label className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Capitale Iniziale Fallback (€)</span>
                    <input
                      type="number"
                      step="any"
                      value={storedOpeningCash}
                      onChange={(event) => {
                        const val = Number(event.target.value) || 0;
                        setStoredOpeningCash(val);
                        setStatusMessage(`Cassa iniziale di fallback aggiornata a ${formatEuro(val)}.`);
                      }}
                      style={{ padding: '8px 12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {uniqueAccounts.map((accountName) => {
                  const val = accountInitialCapitals[accountName] !== undefined ? accountInitialCapitals[accountName] : 0;
                  return (
                    <div
                      key={`settings-capital-${accountName}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--panel-card-bg)',
                        padding: '12px 16px',
                        borderRadius: '14px',
                        border: '1px solid var(--border)',
                        gap: '12px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>{accountName}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Saldo iniziale al {formatDisplayDate(openingDate)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', maxWidth: '180px', minWidth: '140px' }}>
                        <input
                          type="number"
                          step="any"
                          value={val === 0 ? '' : val}
                          placeholder="0.00"
                          onChange={(event) => {
                            const inputVal = event.target.value === '' ? 0 : Number(event.target.value);
                            setAccountInitialCapitals((prev) => ({
                              ...prev,
                              [accountName]: inputVal,
                            }));
                            setStatusMessage(`Capitale iniziale per "${accountName}" impostato a ${formatEuro(inputVal)}.`);
                          }}
                          style={{
                            width: '100%',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            background: 'var(--input-bg)',
                            color: 'var(--text)',
                            textAlign: 'right',
                            fontWeight: 600,
                            fontSize: '0.85rem',
                          }}
                        />
                        <span style={{ fontSize: '0.85rem', color: 'var(--muted)', fontWeight: 600 }}>€</span>
                      </div>
                    </div>
                  );
                })}
                <div
                  style={{
                    marginTop: '8px',
                    padding: '12px 16px',
                    borderRadius: '14px',
                    border: '1px dashed var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.85rem',
                    background: 'rgba(94, 234, 212, 0.03)',
                  }}
                >
                  <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Cassa Iniziale Totale (Somma):</span>
                  <strong style={{ color: 'var(--accent)', fontSize: '0.95rem' }}>{formatEuro(openingCash)}</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-title">Azioni rapide</p>
            <h4>Operazioni utili</h4>
          </div>
        </div>

        <div className="form-actions settings-actions">
          <button className="pill" type="button" onClick={handleDownloadTemplate}>
            Scarica template Excel
          </button>
          <button className="pill" type="button" onClick={handleImportClick} title="Importa file Excel (.xlsx), Apple Numbers (.numbers), PDF o CSV">
            📥 Importa dati (Excel, Numbers, PDF)
          </button>
          <button className="pill" type="button" onClick={handleExportExcel}>
            Esporta Excel
          </button>
        </div>
      </article>
    </section>
  );

  const renderConfirmModal = () => {
    if (!confirmModal.isOpen) return null;

    return (
      <div
        className="confirm-modal-overlay"
        onClick={() => {
          if (confirmModal.onCancel) confirmModal.onCancel();
          else setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }}
      >
        <div
          className="confirm-modal-card"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="confirm-modal-header">
            <div className="confirm-modal-icon-badge">
              ⚠️
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                Conferma Eliminazione
              </span>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '4px 0 0', color: 'var(--text)' }}>
                {confirmModal.title}
              </h3>
              {confirmModal.subtitle && (
                <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: 'var(--accent)', fontWeight: 600 }}>
                  {confirmModal.subtitle}
                </p>
              )}
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--muted)', lineHeight: '1.5' }}>
            {confirmModal.message}
          </p>

          {confirmModal.itemDetails && confirmModal.itemDetails.length > 0 && (
            <div className="confirm-modal-details-list">
              {confirmModal.itemDetails.map((detail, idx) => (
                <div key={idx} className="confirm-modal-details-row">
                  <span>{detail.label}:</span>
                  <strong>{detail.value}</strong>
                </div>
              ))}
            </div>
          )}

          <div className="confirm-modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                if (confirmModal.onCancel) confirmModal.onCancel();
                else setConfirmModal((prev) => ({ ...prev, isOpen: false }));
              }}
              style={{ padding: '10px 18px', fontSize: '0.88rem' }}
            >
              Annulla
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={confirmModal.onConfirm}
              style={{
                padding: '10px 20px',
                fontSize: '0.88rem',
                background: '#e11d48',
                borderColor: '#f43f5e',
                color: '#ffffff',
                fontWeight: 700,
              }}
              autoFocus
            >
              {confirmModal.confirmLabel || 'Elimina definitivamente'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return renderDashboard();
      case 'transazioni':
        return renderTransactions();
      case 'budget':
        return renderBudget();
      case 'report':
      case 'patrimonio':
        return renderUnifiedReportAndNetWorth();
      case 'attivita':
        return renderAssets();
      case 'ricorrenti':
        return renderRecurringAndPAC();
      case 'impostazioni':
        return renderSettings();
      default:
        return renderDashboard();
    }
  };

  const renderBackgroundPattern = () => {
    if (bgEffect === 'none') return null;

    const isDark = theme === 'dark';
    const borderStroke = isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(100, 116, 139, 0.18)';
    const accentStroke = isDark ? 'rgba(94, 234, 212, 0.28)' : 'rgba(15, 118, 110, 0.24)';

    if (bgEffect === 'grid') {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 0,
            backgroundImage: `linear-gradient(${borderStroke} 1.2px, transparent 1.2px), linear-gradient(90deg, ${borderStroke} 1.2px, transparent 1.2px)`,
            backgroundSize: '64px 64px',
            opacity: 0.85,
          }}
        />
      );
    }

    if (bgEffect === 'dots') {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 0,
            backgroundImage: `radial-gradient(${borderStroke} 2.5px, transparent 2.5px)`,
            backgroundSize: '32px 32px',
            opacity: 0.9,
          }}
        />
      );
    }

    if (bgEffect === 'waves') {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 0,
            opacity: 0.85,
          }}
        >
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="waves-pattern" width="160" height="52" patternUnits="userSpaceOnUse">
                <path
                  d="M0 26 Q 40 5, 80 26 T 160 26"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.8"
                  opacity={isDark ? 0.22 : 0.16}
                />
                <path
                  d="M0 38 Q 40 17, 80 38 T 160 38"
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="1.2"
                  opacity={isDark ? 0.28 : 0.2}
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#waves-pattern)" />
          </svg>
        </div>
      );
    }

    if (bgEffect === 'stars') {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 0,
            opacity: 0.9,
          }}
        >
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="stars-pattern" width="240" height="240" patternUnits="userSpaceOnUse">
                {/* Stella grande a scintillio (giallo oro) */}
                <path
                  d="M 40 20 Q 40 40 20 40 Q 40 40 40 60 Q 40 40 60 40 Q 40 40 40 20 Z"
                  fill="#fbbf24"
                  opacity="0.48"
                />
                
                {/* Stella media a scintillio */}
                <path
                  d="M 180 68 Q 180 80 168 80 Q 180 80 180 92 Q 180 80 192 80 Q 180 80 180 68 Z"
                  fill="#fbbf24"
                  opacity="0.44"
                />

                {/* Stella media 2 a scintillio */}
                <path
                  d="M 100 148 Q 100 160 88 160 Q 100 160 100 172 Q 100 160 112 160 Q 100 160 100 148 Z"
                  fill="#f59e0b"
                  opacity="0.44"
                />

                {/* Stella piccola a scintillio */}
                <path
                  d="M 210 182 Q 210 190 202 190 Q 210 190 210 198 Q 210 190 218 190 Q 210 190 210 182 Z"
                  fill="#fbbf24"
                  opacity="0.4"
                />

                {/* Costellazione / Cerchietti lucenti dorati */}
                <circle cx="120" cy="50" r="3.5" fill="#fbbf24" opacity="0.38" />
                <circle cx="60" cy="200" r="2.8" fill="#eab308" opacity="0.34" />
                <circle cx="150" cy="220" r="2.2" fill="#fbbf24" opacity="0.42" />
                <circle cx="220" cy="30" r="1.8" fill="#fbbf24" opacity="0.3" />

                {/* Saturno */}
                <g transform="translate(145, 125) rotate(-18)">
                  {/* Retro dell'anello */}
                  <ellipse cx="0" cy="0" rx="20" ry="5" fill="none" stroke="#f59e0b" strokeWidth="2" opacity="0.3" />
                  {/* Corpo del pianeta */}
                  <circle cx="0" cy="0" r="10" fill="#fbbf24" opacity="0.5" />
                  {/* Fronte dell'anello */}
                  <path d="M -20 0 A 20 5 0 0 0 20 0" fill="none" stroke="#fbbf24" strokeWidth="2" opacity="0.5" />
                </g>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#stars-pattern)" />
          </svg>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="app-shell" style={{ position: 'relative' }}>
      {renderBackgroundPattern()}
      <aside className="sidebar" style={{ zIndex: 1 }}>
        <div className="brand" style={{ position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow">Registro budget</p>
            <h1>Cruscotto finanziario</h1>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {sections.map((section) => (
            <button
              key={section.id}
              className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
              onClick={() => handleSectionChange(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={() => {
              const nextVal = !hideNumbers;
              setHideNumbers(nextVal);
              setStatusMessage(nextVal ? 'Modalità privacy attivata: cifre oscurate.' : 'Modalità privacy disattivata: cifre visibili.');
            }}
            title={hideNumbers ? 'Mostra tutti gli importi' : 'Oscura i numeri (Privacy)'}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: '12px',
              background: hideNumbers ? 'rgba(239, 68, 68, 0.14)' : 'var(--overlay-subtle, rgba(255,255,255,0.03))',
              border: hideNumbers ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid var(--border)',
              color: hideNumbers ? '#f87171' : 'var(--text)',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 600,
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {hideNumbers ? <EyeOff size={16} color="#f87171" /> : <Eye size={16} color="var(--muted)" />}
              <span>{hideNumbers ? 'Cifre oscurate' : 'Oscura numeri'}</span>
            </div>
            <span
              style={{
                fontSize: '0.68rem',
                padding: '2px 6px',
                borderRadius: '6px',
                fontWeight: 700,
                background: hideNumbers ? 'rgba(239, 68, 68, 0.25)' : 'var(--overlay-medium)',
                color: hideNumbers ? '#fca5a5' : 'var(--muted)',
              }}
            >
              {hideNumbers ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
      </aside>

      <main className="workspace" style={{ zIndex: 1, position: 'relative' }}>
        <header className="topbar">
          <div>
            <p className="eyebrow">Luglio 2026</p>
            <h2>{activeSectionConfig.title}</h2>
            <p className="topbar-copy">{activeSectionConfig.description}</p>
          </div>
          <div className="topbar-actions">
            <input
              className="search"
              placeholder="Cerca transazioni, esercenti, categorie"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <button
              className="pill"
              type="button"
              onClick={() => {
                const nextVal = !hideNumbers;
                setHideNumbers(nextVal);
                setStatusMessage(nextVal ? 'Modalità privacy attivata: cifre oscurate.' : 'Modalità privacy disattivata: cifre visibili.');
              }}
              title={hideNumbers ? 'Mostra tutti gli importi' : 'Oscura tutti gli importi per la privacy'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                background: hideNumbers ? 'rgba(239, 68, 68, 0.16)' : 'var(--input-bg, rgba(255,255,255,0.06))',
                color: hideNumbers ? '#f87171' : 'var(--text, #e2e8f0)',
                border: hideNumbers ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--border, rgba(255,255,255,0.12))',
                fontWeight: 600,
                fontSize: '0.82rem',
                padding: '7px 14px',
                borderRadius: '10px',
                transition: 'all 0.2s ease',
              }}
            >
              {hideNumbers ? <EyeOff size={16} /> : <Eye size={16} />}
              <span>{hideNumbers ? 'Cifre oscurate' : 'Oscura cifre'}</span>
            </button>
            {activeSection === 'dashboard' && (
              <button className="pill pill-primary" type="button" onClick={handleImportClick} title="Importa file Excel (.xlsx), Apple Numbers (.numbers), PDF estratti conto o CSV">
                📥 Importa dati
              </button>
            )}
            {activeSection === 'impostazioni' && (
              <>
                <button className="pill" type="button" onClick={handleImportClick} title="Importa file Excel (.xlsx), Apple Numbers (.numbers), PDF estratti conto o CSV">
                  📥 Importa dati (Excel, Numbers, PDF)
                </button>
                <button className="pill pill-primary" type="button" onClick={handleExportExcel}>
                  Esporta Excel
                </button>
              </>
            )}
            {activeSection === 'transazioni' && (
              <>
                <button className="pill" type="button" onClick={handleImportClick} title="Importa movimenti da file Excel, Numbers, PDF bancari o CSV">
                  📥 Importa file
                </button>
                <button className="pill pill-primary" type="button" onClick={startNewTransaction}>
                  Nuova transazione
                </button>
              </>
            )}
          </div>
        </header>

        <section className="status-banner" aria-live="polite">
          <span className="status-badge">Azioni</span>
          <p>{statusMessage}</p>
          <div className="autosave-indicator" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#10b981', fontWeight: 500 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }}></span>
            <span>Autosalvataggio attivo</span>
          </div>
        </section>

        <input
          ref={importInputRef}
          className="hidden-file-input"
          type="file"
          accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.numbers,.pdf,application/pdf,application/vnd.apple.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          onChange={handleImportFile}
        />

        <ImportDataModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onConfirmImport={handleConfirmImportData}
          existingAccounts={uniqueAccounts}
        />
        {renderConfirmModal()}
        <UpdateModal
          isOpen={showUpdateModal}
          updateInfo={updateInfo}
          status={updateStatus}
          progress={updateProgress}
          errorMessage={updateErrorMessage}
          successMessage={updateSuccessMessage}
          onConfirmInstall={handleConfirmInstallUpdate}
          onRemindLater={handleRemindLater}
          onSkipVersion={handleSkipVersion}
          onOpenReleaseUrl={handleOpenReleaseUrl}
        />
        {renderActiveSection()}
      </main>
    </div>
  );
}

export default App;
