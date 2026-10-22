/**
 * Motore di riconoscimento scontrini.
 *
 * Riceve il testo grezzo prodotto dall'OCR (Apple Vision, lato nativo) e ne
 * estrae i campi della transazione: esercente, data, totale, IVA, metodo di
 * pagamento, righe dettaglio e categoria suggerita.
 *
 * E' deliberatamente **puro** (nessuna dipendenza, nessuna I/O): gira
 * identico su macOS, iOS e browser, ed e' testabile in Node.
 *
 * Le euristiche sono tarate su scontrini italiani (supermercati, bar,
 * ristoranti, benzinai, negozi) ma gestiscono anche lo stile anglosassone.
 */

import { inferCategory } from './categoryInference';

export interface ReceiptLineItem {
  description: string;
  amount: number;
  quantity?: number;
}

export interface ReceiptScanResult {
  /** Il testo contiene un totale utilizzabile. */
  ok: boolean;
  merchant: string;
  /** Formato ISO `YYYY-MM-DD`, come richiesto dal modello `Transaction`. */
  date: string;
  /** Totale assoluto in euro. */
  amount: number;
  currency: string;
  category: string;
  paymentMethod: string;
  taxAmount: number | null;
  subtotal: number | null;
  items: ReceiptLineItem[];
  rawText: string;
  /** 0..1 — quanto il risultato e' affidabile. */
  confidence: number;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Normalizzazione                                                     */
/* ------------------------------------------------------------------ */

/** Rimuove accenti e maiuscole, per confronti robusti. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

/**
 * Converte un importo testuale in numero.
 *
 * Gestisce gli stili europei (`1.250,50`), anglosassoni (`1,250.50`) e
 * semplici (`12,34`, `12.34`). La regola: quando compaiono entrambi i
 * separatori, e' decimale l'ultimo; con un solo separatore, e' decimale se
 * e' seguito da 1-2 cifre, altrimenti e' un separatore delle migliaia.
 */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;

  let value = raw.replace(/[€$£\s\u00a0]/g, '').replace(/[^\d.,\-]/g, '');
  if (!value || value === '-' || value === '.' || value === ',') return null;

  const hasComma = value.includes(',');
  const hasDot = value.includes('.');

  if (hasComma && hasDot) {
    // Con entrambi i separatori, e' decimale quello che viene per ultimo.
    if (value.lastIndexOf(',') > value.lastIndexOf('.')) {
      value = value.replace(/\./g, '').replace(',', '.');
    } else {
      value = value.replace(/,/g, '');
    }
  } else if (hasComma || hasDot) {
    const separator = hasComma ? ',' : '.';
    const parts = value.split(separator);
    const occurrences = parts.length - 1;
    const decimals = (parts[parts.length - 1] || '').length;

    if (occurrences > 1 || decimals === 3) {
      // Separatore delle migliaia ("1.234" / "1,234").
      value = parts.join('');
    } else {
      value = parts.join('.');
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rimuove date e percentuali: non sono importi. */
function stripNonAmounts(line: string): string {
  return line
    .replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}\s+[a-zA-Z]{3,10}\s+\d{2,4}\b/g, ' ')
    .replace(/\d{1,3}\s?%/g, ' ');
}

/**
 * Estrae gli importi presenti in una riga di testo.
 *
 * Il gruppo decimale e' opzionale: obbligatorio, la regex non agganciava
 * nessun numero senza parte decimale (es. "2026").
 */
function extractAmounts(line: string): number[] {
  const cleaned = stripNonAmounts(line);
  const matches = cleaned.match(/-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/g);
  if (!matches) return [];

  return matches
    .map((match) => parseAmount(match))
    .filter((value): value is number => value !== null && value > 0);
}

/* ------------------------------------------------------------------ */
/* Date                                                                */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  gen: 1, genn: 1, gennaio: 1, gen_eng: 1, january: 1, jan: 1,
  feb: 2, febbr: 2, febbraio: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  apr: 4, aprile: 4, april: 4,
  mag: 5, maggio: 5, may: 5,
  giu: 6, giugno: 6, june: 6, jun: 6,
  lug: 7, luglio: 7, july: 7, jul: 7,
  ago: 8, agosto: 8, august: 8, aug: 8,
  set: 9, sett: 9, settembre: 9, september: 9, sep: 9,
  ott: 10, ottobre: 10, october: 10, oct: 10,
  nov: 11, novembre: 11, november: 11,
  dic: 12, dicembre: 12, december: 12, dec: 12,
};

/** Cerca il mese tollerando abbreviazioni ("ott", "ottobre", "ot"). */
function monthFromName(name: string): number | null {
  const key = normalize(name);
  if (!key) return null;
  if (MONTHS[key] !== undefined) return MONTHS[key];
  for (let length = key.length; length >= 3; length -= 1) {
    const prefix = key.slice(0, length);
    if (MONTHS[prefix] !== undefined) return MONTHS[prefix];
  }
  return null;
}

const MONTH_NAMES = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

function toIsoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Cerca una data dello scontrino.
 *
 * Preferisce le date piu' recenti plausibili (uno scontrino e' recente) e
 * scarta quelle che sono chiaramente orari, codici fiscali o numeri civici.
 */
export function extractReceiptDate(lines: string[]): string | null {
  const candidates: string[] = [];

  for (const line of lines) {
    // 12/10/2026, 12-10-26, 12.10.2026
    const numeric = line.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g);
    if (numeric) {
      for (const match of numeric) {
        const parts = match.split(/[/\-.]/).map((part) => Number(part));
        if (parts.length !== 3) continue;
        const [day, month, year] = parts;
        let fullYear = year;
        if (year < 100) fullYear = year > 70 ? 1900 + year : 2000 + year;
        // Prima gg/mm, poi mm/gg (stile americano).
        const interpretations = [toIsoDate(fullYear, month, day), toIsoDate(fullYear, day, month)];
        for (const iso of interpretations) {
          if (iso) {
            candidates.push(iso);
            break;
          }
        }
      }
    }

    // 12 OTT 2026 / 12 OTTOBRE 2026
    const textual = line.match(/\b(\d{1,2})[\s.\-]+([a-zA-Z]{3,10})[\s.,\-]+(\d{2,4})\b/g);
    if (textual) {
      for (const match of textual) {
        const parts = match.split(/[\s.\-]+/).filter(Boolean);
        if (parts.length < 3) continue;
        const day = Number(parts[0]);
        let year = Number(parts[2]);
        if (year < 100) year = year > 70 ? 1900 + year : 2000 + year;
        const month = monthFromName(parts[1]);
        if (month) {
          const iso = toIsoDate(year, month, day);
          if (iso) candidates.push(iso);
        }
      }
    }

    // 2026-10-12
    const iso = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      const value = toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      if (value) candidates.push(value);
    }
  }

  if (candidates.length === 0) return null;

  // Preferisce la data piu' recente non nel futuro lontano.
  const today = new Date();
  const parsed = candidates
    .map((iso) => ({ iso, time: Date.parse(`${iso}T12:00:00Z`) }))
    .filter((item) => item.time <= today.getTime() + 3 * 24 * 3600 * 1000)
    .sort((a, b) => b.time - a.time);

  if (parsed.length > 0) return parsed[0].iso;
  return candidates[candidates.length - 1];
}

/* ------------------------------------------------------------------ */
/* Importi: totale, subtotale, IVA                                      */
/* ------------------------------------------------------------------ */

/**
 * Keyword del totale, IN ORDINE DI PRIORITA.
 *
 * L'ordine conta: "totale" e' contenuto in "subtotale" e in "totale articoli",
 * quindi la parola piu' specifica va cercata per prima. Inoltre "importa" e'
 * contenuto in "importazione" (l'importo delle mere, non il totale).
 */
const TOTAL_KEYWORDS = [
  'totale complessivo documento',
  'totale complessivo',
  'totale documento',
  'totale da pagare',
  'totale da saldare',
  'importo totale',
  'ammontare totale',
  'totale acquisti',
  'totale iva inclusa',
  'totale',
  // "IMPORTO 63,80" e' la riga del totale negli scontrini del terminale
  // (Nexi/Verifone): "importa" non la matcherebbe.
  'importo',
  'importa',
  'da pagare',
  'grand total',
  'total amount',
  'amount due',
  'total',
];

const SUBTOTAL_KEYWORDS = [
  'totale imponibile',
  'totale parziale',
  'subtotale',
  'imponibile',
  'subtotal',
  'totale articoli',
  'totale merce',
];

const TAX_KEYWORDS = ['iva', 'imposta', 'tax', 'vat'];

/**
 * Righe che NON sono il totale, anche se contengono la parola "totale"
 * (contatori di pezzi, punti fedelta', importo delle mere, subtotale, IVA).
 */
const IGNORED_TOTAL_LINES = [
  'importazione',
  'totale articoli',
  'totale quantita',
  'totale pezzi',
  'totale punti',
  'punti fedelta',
  'totale pezzi venduti',
  'totale merce',
];

/** Righe di cambio/resto: non sono il totale. */
const PAYMENT_LINES = ['cambio', 'resto', 'moneta', 'ricevuta'];

/**
 * Cerca l'importo associato a una label.
 *
 * Le keyword vengono valutate una alla volta in ordine di priorita' e, per
 * ogni keyword, si scandisce il documento dal fondo: vince sempre la label piu'
 * specifica e la sua ultima occorrenza valida.
 */
function findLabeledAmount(
  lines: string[],
  keywords: string[],
  options: { ignore?: string[] } = {}
): number | null {
  const { ignore = [] } = options;

  for (const keyword of keywords) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      const normalized = normalize(line);

      if (ignore.some((excluded) => normalized.includes(excluded))) continue;
      if (!normalized.includes(keyword)) continue;

      // Importo sulla stessa riga.
      const sameLine = amountFromLine(line);
      if (sameLine !== null) return sameLine;

      // Importo sulla riga successiva (scontrini a colonna).
      const nextLine = lines[index + 1];
      if (nextLine) {
        const nextAmount = amountFromLine(nextLine);
        if (nextAmount !== null) return nextAmount;
      }
    }
  }

  return null;
}

/**
 * Importo di una riga. Se ci sono piu' valori si preferisce quello con i
 * decimali (il totale) rispetto a un semplice contatore ("TOTALE 16,28 3").
 */
function amountFromLine(line: string): number | null {
  const amounts = extractAmounts(line);
  if (amounts.length === 0) return null;

  const withDecimals = amounts.filter((amount) => !Number.isInteger(amount));
  if (withDecimals.length > 0) return withDecimals[withDecimals.length - 1];

  return amounts[amounts.length - 1];
}

/* ------------------------------------------------------------------ */
/* Esercente                                                           */
/* ------------------------------------------------------------------ */

/**
 * Prefissi che indicano chiaramente che la riga NON e' il nome
 * dell'esercente (recapiti, partite IVA, siti web).
 */
/**
 * Righe dei terminali di pagamento (Nexi, Verifone, ecc.): non sono
 * l'esercente, anche se compaiono prima del nome del negozio.
 */
const TERMINAL_NOISE = [
  'nexi',
  'visa',
  'mastercard',
  'maestro',
  'postepay',
  'paypal',
  'acquist',
  'transazione eseguita',
  'grazie e arrivederci',
  'verified by device',
  'pan:',
  'exp:',
  'aut.',
  'oper.',
  'atc ',
  'tvr',
  'a.r.q.c',
  'iad ',
  'tml ',
  'stan ',
  'mod. online',
  'ctls',
  'ico ',
  'a. id',
  'contactless',
  'eser.',
  'a. i. i. c',
  'cless',
  'cod. auth',
  'codice autorizzazione',
  'approvato',
  'declinata',
  'autorizzazione',
  'ref.',
  'referenza',
];

const MERCHANT_BLOCK_PREFIXES = [
  'p.iva',
  'p iva',
  'partita iva',
  'partitaiva',
  'codice fiscale',
  'cod.fisc',
  'tel',
  'fax',
  'www',
  'http',
  '@',
  'e-mail',
  'email',
];

/**
 * Sigle societarie: da scartare solo se costituiscono **tutta** la riga
 * ("S.p.A." isolata), non se fanno parte del nome ("Q8 S.P.A.").
 */
const MERCHANT_ONLY_TOKENS = [
  's.p.a.',
  'spa',
  's.r.l.',
  'srl',
  's.n.c.',
  'snc',
  's.a.s.',
  'sas',
];

function looksLikeAddress(line: string): boolean {
  const normalized = normalize(line);
  if (!/\d/.test(line)) return false;
  return (
    /via |viale |piazza |corso |vicolo |strada |largo |piazza /.test(normalized) ||
    // CAP e civico all'inizio ("20090 Assago", "Via Roma 45").
    /^\d{2,6}\s/.test(line.trim()) ||
    /^\d{1,4}\s+[a-z]/i.test(line.trim())
  );
}

/** La riga contiene una data? (allora non e' il nome del negozio) */
function containsDate(line: string): boolean {
  return (
    /\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}/.test(line) ||
    /\d{4}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2}/.test(line) ||
    /\b\d{1,2}\s+[a-zA-Z]{3,10}\s+\d{2,4}\b/.test(line)
  );
}

/** Individua il nome dell'esercente: la prima riga "significativa". */
export function extractMerchant(lines: string[]): string {
  for (const raw of lines.slice(0, 12)) {
    const line = raw.trim();
    if (!line || line.length < 3 || line.length > 48) continue;

    const normalized = normalize(line);
    if (MERCHANT_ONLY_TOKENS.includes(normalized)) continue;
    if (TERMINAL_NOISE.some((noise) => normalized.includes(noise))) continue;
    if (MERCHANT_BLOCK_PREFIXES.some((prefix) => normalized.startsWith(prefix))) continue;
    if (TOTAL_KEYWORDS.some((keyword) => normalized.includes(keyword))) continue;
    if (PAYMENT_METHODS.some(([keyword]) => normalized.includes(keyword))) continue;
    if (containsDate(line)) continue;
    if (looksLikeAddress(line)) continue;

    // Servono almeno 3 lettere: esclude le righe puramente numeriche.
    const letters = line.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 3) continue;

    // Le righe con sequenze numeriche lunghe (codici, autorizzazioni, PAN)
    // non sono il nome del negozio.
    if (/\d{5,}/.test(line)) continue;

    const cleaned = line
      .replace(/\s{2,}/g, ' ')
      .replace(/^[|\-_*#\s]+/, '')
      .trim();

    if (cleaned.length >= 3) return cleaned;
  }

  return '';
}

/* ------------------------------------------------------------------ */
/* Metodo di pagamento e righe dettaglio                                */
/* ------------------------------------------------------------------ */

const PAYMENT_METHODS: [string, string][] = [
  ['contanti', 'Contanti'],
  ['cash', 'Contanti'],
  ['bancomat', 'Bancomat'],
  ['pago bancomat', 'Bancomat'],
  ['carta di credito', 'Carta di credito'],
  ['carta credito', 'Carta di credito'],
  ['credit card', 'Carta di credito'],
  ['carta di debito', 'Carta di debito'],
  ['carta debito', 'Carta di debito'],
  ['debit card', 'Carta di debito'],
  ['visa', 'Carta di credito'],
  ['mastercard', 'Carta di credito'],
  ['maestro', 'Carta di credito'],
  ['bonifico', 'Bonifico'],
  ['assegno', 'Assegno'],
  ['cheque', 'Assegno'],
  ['carte', 'Carta di credito'],
  ['carta', 'Carta'],
];

export function extractPaymentMethod(lines: string[]): string {
  for (const line of lines) {
    const normalized = normalize(line);
    for (const [keyword, label] of PAYMENT_METHODS) {
      if (normalized.includes(keyword)) return label;
    }
  }
  return '';
}

/** Estrae le righe di dettaglio (articoli acquistati). */
export function extractItems(lines: string[]): ReceiptLineItem[] {
  const items: ReceiptLineItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    const normalized = normalize(trimmed);

    // Percentuali (servizio, sconto, IVA) e righe di data/header.
    if (trimmed.includes('%')) continue;
    if (containsDate(trimmed)) continue;
    if (looksLikeAddress(trimmed)) continue;

    if (
      TOTAL_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      SUBTOTAL_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      TAX_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      PAYMENT_METHODS.some(([keyword]) => normalized.includes(keyword)) ||
      normalized.includes('p.iva') ||
      normalized.includes('totale qta') ||
      normalized.includes('quantita') ||
      normalized.includes('scontrino') ||
      normalized.includes('ricevuta') ||
      normalized.includes('receipt') ||
      normalized.includes('tavolo') ||
      normalized.includes('coperti') ||
      normalized.includes('cassa')
    ) {
      continue;
    }

    // "2 x 3,50" oppure "3,50 x 2"
    const multiplied = trimmed.match(/^(\d+)\s*[xX*]\s*([\d.,]+)/);
    if (multiplied) {
      const quantity = Number(multiplied[1]);
      const unit = parseAmount(multiplied[2]);
      const description = trimmed.slice(multiplied[0].length).trim();
      if (unit !== null && unit > 0 && description) {
        items.push({ description, amount: round2(unit * quantity), quantity });
        continue;
      }
    }

    const amounts = extractAmounts(trimmed);
    if (amounts.length === 0) continue;

    const amount = amounts[amounts.length - 1];
    const description = trimmed
      .replace(/[\d.,]+$/, '')
      .replace(/[€\s]+$/, '')
      .trim();

    if (!description || description.length < 2) continue;
    if (!/[a-zA-Z]/.test(description)) continue;
    if (amount <= 0 || amount > 100000) continue;

    items.push({ description, amount });
  }

  return items.slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Ricostruzione delle colonne                                         */
/* ------------------------------------------------------------------ */

/** La riga contiene solo un importo (nessuna lettera)? */
function isPriceOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/[a-zA-Z]/.test(trimmed)) return false;
  // Una data ("12/10/2026 18:42") non e' un prezzo.
  if (/\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}/.test(trimmed)) return false;
  if (!/[\d]/.test(trimmed)) return false;
  return extractAmounts(trimmed).length > 0;
}

/** La riga contiene solo una data (o un orario)? */
function isDateOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /[a-zA-Z]{4,}/.test(trimmed)) return false;
  return /\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}/.test(trimmed);
}

/**
 * Ricostruisce lo scontrino quando l'OCR ha letto le colonne una dopo
 * l'altra (tutte le descrizioni e poi tutti i prezzi), come accade spesso
 * con le stampanti termiche.
 *
 * Se l'ultimo blocco di righe "solo prezzo" ha lo stesso numero di righe di
 * descrizione che lo precedono (saltando le righe di data), le due colonne
 * vengono accoppiate.
 */
export function reconstructColumns(lines: string[]): string[] {
  if (lines.length === 0) return lines;

  const priceOnly = lines.map(isPriceOnlyLine);

  // Il blocco di prezzi deve essere in fondo al testo.
  if (!priceOnly[lines.length - 1]) return lines;

  let blockEnd = lines.length;
  let blockStart = blockEnd;
  while (blockStart > 0 && priceOnly[blockStart - 1]) blockStart -= 1;

  const blockSize = blockEnd - blockStart;
  if (blockSize < 2) return lines;

  // Righe di descrizione immediatamente precedenti (saltando le date).
  const descriptions: number[] = [];
  for (let index = blockStart - 1; index >= 0 && descriptions.length < blockSize; index -= 1) {
    if (isDateOnlyLine(lines[index])) continue;
    if (isPriceOnlyLine(lines[index])) break;
    if (!/[a-zA-Z]/.test(lines[index])) break;
    descriptions.unshift(index);
  }

  if (descriptions.length !== blockSize) return lines;

  const result = [...lines];
  descriptions.forEach((lineIndex, position) => {
    result[lineIndex] = `${result[lineIndex].trim()}  ${lines[blockStart + position].trim()}`;
  });

  return result;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Analizza il testo OCR di uno scontrino.
 *
 * @param rawText testo riconosciuto dall'OCR (una riga per elemento)
 */
export function parseReceiptText(rawText: string): ReceiptScanResult {
  const warnings: string[] = [];
  const text = (rawText || '').replace(/\r/g, '');

  const rawLines = text.split('\n').map((line) => line.trim());

  // L'OCR spesso legge le colonne una dopo l'altra: si ricostruiscono.
  const lines = reconstructColumns(rawLines).filter((line) => line.length > 0);

  // 1. Totale
  let amount = findLabeledAmount(lines, TOTAL_KEYWORDS, { ignore: IGNORED_TOTAL_LINES });

  // 2. Se non c'e' un totale esplicito, prova il subtotale + IVA.
  const subtotal = findLabeledAmount(lines, SUBTOTAL_KEYWORDS);
  const taxAmount = findLabeledAmount(lines, TAX_KEYWORDS);

  if (amount === null && subtotal !== null && taxAmount !== null) {
    amount = round2(subtotal + taxAmount);
    warnings.push('Totale calcolato come imponibile + IVA.');
  }

  // 3. Ultimo fallback: il totale e' l'importo piu' "alto" dello scontrino,
  //    ignorando le righe di cambio/resto/punti fedelta'.
  if (amount === null) {
    const candidates: number[] = [];
    for (const line of lines) {
      const normalized = normalize(line);
      if (PAYMENT_LINES.some((keyword) => normalized.includes(keyword))) continue;
      if (normalized.includes('punti') || normalized.includes('points')) continue;
      candidates.push(...extractAmounts(line));
    }
    if (candidates.length > 0) {
      amount = Math.max(...candidates);
      warnings.push('Totale non etichettato: uso l\'importo piu\' alto trovato.');
    }
  }

  const merchant = extractMerchant(lines);
  const date = extractReceiptDate(lines);
  const paymentMethod = extractPaymentMethod(lines);
  const items = extractItems(lines);
  const category = inferCategory(merchant || 'scontrino', 'expense');

  // Confidenza: quanto sono stato trovato i dati essenziali.
  let confidence = 0.15;
  if (amount !== null) confidence += 0.45;
  if (merchant) confidence += 0.2;
  if (date) confidence += 0.15;
  if (items.length > 0) confidence += 0.05;

  if (amount === null) warnings.push('Non sono riuscito a individuare il totale.');
  if (!merchant) warnings.push('Non sono riuscito a individuare l\'esercente.');
  if (!date) warnings.push('Non sono riuscito a individuare la data.');
  if (subtotal !== null && amount !== null && Math.abs(subtotal + (taxAmount ?? 0) - amount) > 0.02) {
    warnings.push('Le cifre dello scontrino non tornano esattamente: verifica l\'importo.');
  }

  return {
    ok: amount !== null && amount > 0,
    merchant,
    date: date || new Date().toISOString().slice(0, 10),
    amount: amount !== null ? round2(amount) : 0,
    currency: 'EUR',
    category,
    paymentMethod,
    taxAmount: taxAmount !== null ? round2(taxAmount) : null,
    subtotal: subtotal !== null ? round2(subtotal) : null,
    items,
    rawText: text,
    confidence: Math.min(1, round2(confidence)),
    warnings,
  };
}

/** Elenco dei mesi in italiano, usato nelle anteprime per lato utente. */
export const RECEIPT_MONTH_NAMES = MONTH_NAMES;
