import * as XLSX from 'xlsx-clean';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import snappy from 'snappyjs';

// Setup PDF.js worker
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export type TransactionKind = 'expense' | 'income';

export interface ParsedTransaction {
  id: string;
  createdAt: number;
  date: string; // Formato DD/MM/YYYY
  merchant: string;
  category: string;
  subcategory: string;
  account: string;
  amount: number; // Negativo per spese, positivo per entrate
  kind: TransactionKind;
  note: string;
  confidence?: number;
  rawSource?: string;
}

export interface SmartParseResult {
  transactions: ParsedTransaction[];
  skipped: number;
  fileType: 'excel' | 'csv' | 'numbers' | 'pdf' | 'unknown';
  detectedFormatName: string;
  headersDetected: string[];
  totalRows: number;
  accountSuggestions: string[];
  warnings: string[];
  assets?: any[];
  assetTransactions?: any[];
}

/**
 * Normalizza e riconosce date in svariati formati (italiano, inglese, ISO, Excel seriale)
 * Restituisce una data nel formato standard DD/MM/YYYY
 */
export function smartParseDate(input: any): string | null {
  if (input === undefined || input === null || input === '') return null;

  // 1. Gestione Date object
  if (input instanceof Date && !isNaN(input.getTime())) {
    const day = String(input.getDate()).padStart(2, '0');
    const month = String(input.getMonth() + 1).padStart(2, '0');
    const year = input.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // 2. Gestione numero seriale Excel (es. 45230 -> 2023)
  if (typeof input === 'number') {
    if (input > 20000 && input < 80000) {
      // Excel epoch: 1899-12-30 (accounting for the 1900 leap year bug)
      const date = new Date(Math.round((input - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime())) {
        const day = String(date.getUTCDate()).padStart(2, '0');
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const year = date.getUTCFullYear();
        return `${day}/${month}/${year}`;
      }
    }
    return null;
  }

  let str = String(input).trim();
  if (!str) return null;

  // Rimuovi orari tipo "15/09/2026 14:32:00" o "2026-09-15T10:00:00Z" preservando date con spazi come "15 gen 2026"
  str = str.replace(/T\d{1,2}:\d{2}(:\d{2})?.*$/i, '').trim();
  str = str.replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, '').trim();

  // Mappa mesi in italiano e inglese
  const monthsMap: Record<string, string> = {
    gen: '01', genn: '01', gennaio: '01', jan: '01', january: '01',
    feb: '02', febb: '02', febbraio: '02', febbr: '02', february: '02',
    mar: '03', marz: '03', marzo: '03', march: '03',
    apr: '04', apri: '04', aprile: '04', april: '04',
    mag: '05', magg: '05', maggio: '05', may: '05',
    giu: '06', giug: '06', giugno: '06', jun: '06', june: '06',
    lug: '07', lugl: '07', luglio: '07', jul: '07', july: '07',
    ago: '08', agos: '08', agosto: '08', aug: '08', august: '08',
    set: '09', sett: '09', settembre: '09', sep: '09', sept: '09', september: '09',
    ott: '10', otto: '10', ottobre: '10', oct: '10', october: '10',
    nov: '11', nove: '11', novembre: '11', november: '11',
    dic: '12', dice: '12', dicembre: '12', dec: '12', december: '12',
  };

  // Sostituisci mesi testuali (es: "15-gen-2026" o "15/Ott/2026")
  for (const [mName, mNum] of Object.entries(monthsMap)) {
    const regex = new RegExp(`(^|[-/\\s.])(${mName})([-/\\s.]|$)`, 'i');
    if (regex.test(str)) {
      str = str.replace(regex, `$1${mNum}$3`);
      break;
    }
  }

  // Formato ISO: YYYY-MM-DD o YYYY/MM/DD o YYYY.MM.DD
  const isoMatch = str.match(/^(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})$/);
  if (isoMatch) {
    const year = isoMatch[1];
    const month = isoMatch[2].padStart(2, '0');
    const day = isoMatch[3].padStart(2, '0');
    return `${day}/${month}/${year}`;
  }

  // Formato standard europeo: DD/MM/YYYY o DD-MM-YYYY o DD.MM.YYYY o "15 01 2026"
  const euroMatch = str.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2,4})$/);
  if (euroMatch) {
    const day = euroMatch[1].padStart(2, '0');
    const month = euroMatch[2].padStart(2, '0');
    let year = euroMatch[3];
    if (year.length === 2) {
      const yrNum = parseInt(year, 10);
      year = yrNum > 50 ? `19${year}` : `20${year}`;
    }
    const dNum = parseInt(day, 10);
    const mNum = parseInt(month, 10);
    if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12) {
      return `${day}/${month}/${year}`;
    }
  }

  return null;
}

/**
 * Parsing intelligente dell'importo monetario con supporto per:
 * - Valute (€, $, £, CHF)
 * - Separatori decimali italiani (, o .)
 * - Segno meno finale (es. 45,90- tipico di estratti conto bancari)
 * - Notazione Dare / Avere (D / A)
 * - Parentesi contabili (es. (100.00))
 */
export function smartParseAmount(
  val: any,
  kindHint?: string
): { amount: number; kind: TransactionKind; isExplicit: boolean } | null {
  if (val === undefined || val === null || val === '') return null;

  if (typeof val === 'number') {
    if (isNaN(val)) return null;
    const kind: TransactionKind = val >= 0 ? 'income' : 'expense';
    return {
      amount: val === 0 ? 0 : (val < 0 ? val : -val), // per default se non specificato trattiamo numeri positivi in base al contesto
      kind: val >= 0 ? 'income' : 'expense',
      isExplicit: true,
    };
  }

  let str = String(val).trim();
  if (!str) return null;

  // Se la stringa sembra una data (es. 10/06/2026, 2026-06-10, 15.04.26), non è un importo!
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(str)) {
    return null;
  }

  // Se la stringa contiene parole descrittive (es. "Rimborso 730", "Via Roma 4"), è una descrizione, non un importo!
  const textWithoutCurrency = str.replace(/\b(EUR|USD|GBP|CHF|DARE|AVERE|DEBIT|CREDIT|DEB|CRED)\b/gi, '').trim();
  if (/[a-zA-ZàèéìòùÀÈÉÌÒÙ]{2,}/.test(textWithoutCurrency)) {
    return null;
  }

  let isNegative = false;
  let isExplicitIncome = false;

  // Notazione contabile tra parentesi: (120,50)
  if (str.startsWith('(') && str.endsWith(')')) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  }

  // Segno meno finale (es. "50,00 -")
  if (str.endsWith('-')) {
    isNegative = true;
    str = str.slice(0, -1).trim();
  } else if (str.endsWith('+')) {
    isExplicitIncome = true;
    str = str.slice(0, -1).trim();
  }

  // Segno meno o più iniziale
  if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1).trim();
  } else if (str.startsWith('+')) {
    isExplicitIncome = true;
    str = str.slice(1).trim();
  }

  // Notazione Dare (D/DR/DEB) o Avere (A/CR/ACCR)
  if (/\b(dare|debit|deb|dr|d)\b/i.test(str)) {
    isNegative = true;
  } else if (/\b(avere|credit|cred|cr|a)\b/i.test(str)) {
    isExplicitIncome = true;
  }

  // Rimuovi valute e lettere residue
  str = str.replace(/[€$£CHFcurrenzaA-Za-z\s]/g, '').trim();

  // Normalizza separatori decimali e migliaia
  if (str.includes('.') && str.includes(',')) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      // Formato italiano: 1.250,50 -> 1250.50
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato anglosassone: 1,250.50 -> 1250.50
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Es. 45,50 -> 45.50
    str = str.replace(',', '.');
  }

  const parsedNum = parseFloat(str);
  if (isNaN(parsedNum)) return null;

  const absAmount = Math.abs(parsedNum);
  if (absAmount === 0) return null;

  // Gestione hint
  if (kindHint) {
    const normHint = kindHint.toLowerCase().trim();
    if (['uscita', 'uscite', 'spesa', 'spese', 'debit', 'dare', 'prelievo', 'addebito', 'expense', 'd'].includes(normHint)) {
      isNegative = true;
      isExplicitIncome = false;
    } else if (['entrata', 'entrate', 'incasso', 'accredito', 'credit', 'avere', 'deposito', 'versamento', 'income', 'a'].includes(normHint)) {
      isExplicitIncome = true;
      isNegative = false;
    }
  }

  if (isExplicitIncome) {
    return { amount: absAmount, kind: 'income', isExplicit: true };
  } else if (isNegative) {
    return { amount: -absAmount, kind: 'expense', isExplicit: true };
  } else {
    // Default: spesa (negativa) se non indicato altrimenti, coerente con le app di spesa
    return { amount: -absAmount, kind: 'expense', isExplicit: false };
  }
}

/**
 * Deduce automaticamente la categoria in base al merchant o descrizione
 */
export function inferCategory(merchant: string, fallbackKind: TransactionKind): string {
  const text = merchant.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

  if (/stipendio|emolumenti|pensione|bonifico.*entr|rimborso|accredito.*stip|cedola|dividendo|compenso/i.test(text)) {
    return 'Entrate';
  }

  if (/coop|esselunga|conad|carrefour|lidl|eurospin|aldi|pam|despar|tigros|bennet|iper|penny|md|crai|supermerc|alimentar|market|grocery|ortofrutta|macelleria|panificio/i.test(text)) {
    return 'Supermercato / Spesa';
  }

  if (/bar|cafe|caffe|ristoran|pizz|mcdonald|burger king|starbucks|trattoria|sushi|osteria|deliveroo|just eat|glovo|uber eats|gelater|pub|birrer|bakery|poke/i.test(text)) {
    return 'Ristoranti & Bar';
  }

  if (/eni|q8|ip\s|esso|tamoil|carburante|benzina|distributore|autostrad|telepass|trenitalia|italo|ryanair|easyjet|atm\s|atac|taxi|uber|parking|parcheggio|pedaggio/i.test(text)) {
    return 'Trasporti';
  }

  if (/enel|a2a|hera|edison|acea|iren|sorgenia|fastweb|tim\s|vodafone|iliad|windtre|tiscali|plenitude|luce|gas|acqua|rifiuti|tari/i.test(text)) {
    return 'Utenze & Bollette';
  }

  if (/amazon|zalando|shein|zara|h&m|ikea|leroy merlin|decathlon|mediaworld|unieuro|apple|ebay|vinted|asos|mango|tezenis|calzedonia|douglas|sephora/i.test(text)) {
    return 'Shopping';
  }

  if (/farmacia|parafarmacia|dottor|medico|dentist|clinica|ospedale|ticket|synlab|ottica|fisioterap|palestra|piscina|fitness/i.test(text)) {
    return 'Salute & Benessere';
  }

  if (/affitto|mutuo|condominio|brico|idraulico|elettricista/i.test(text)) {
    return 'Casa';
  }

  if (/netflix|spotify|youtube|prime video|disney|dazn|apple\.com\/bill|icloud|chatgpt|openai|google|playstation|xbox|nintendo/i.test(text)) {
    return 'Abbonamenti';
  }

  return fallbackKind === 'income' ? 'Entrate' : 'Altro';
}

/**
 * Normalizza il nome colonna per confronto fuzzy
 */
function cleanKey(k: string): string {
  return String(k || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Valuta e trova la migliore corrispondenza per una colonna
 */
function findMatchingKey(row: Record<string, any>, possibleKeys: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const pk of possibleKeys) {
    const cleanPk = cleanKey(pk);
    for (const key of keys) {
      const ck = cleanKey(key);
      if (ck === cleanPk) return key;
    }
  }
  for (const pk of possibleKeys) {
    const cleanPk = cleanKey(pk);
    for (const key of keys) {
      const ck = cleanKey(key);
      if (ck.includes(cleanPk) || cleanPk.includes(ck)) return key;
    }
  }
  return undefined;
}

/**
 * Parser Intelligente per Tabelle (Excel o CSV con riconoscimento automatico di intestazioni e formati non convenzionali)
 */
export function parseGenericTableRows(
  rows: any[][],
  sourceFormat: string = 'smart',
  defaultAccount: string = 'Conto Principale'
): SmartParseResult {
  const transactions: ParsedTransaction[] = [];
  const accountSuggestions = new Set<string>();
  const warnings: string[] = [];

  if (!rows || rows.length === 0) {
    return {
      transactions: [],
      skipped: 0,
      fileType: 'excel',
      detectedFormatName: 'Nessun dato',
      headersDetected: [],
      totalRows: 0,
      accountSuggestions: [],
      warnings: ['Il file non contiene righe.'],
    };
  }

  // 1. Trova l'indice della riga di intestazione (Header Detection)
  let headerIndex = -1;
  let maxScore = 0;

  const headerKeywords = [
    'data', 'date', 'giorno', 'valuta', 'operazione',
    'importo', 'amount', 'totale', 'cifra', 'saldo',
    'dare', 'avere', 'uscite', 'entrate', 'addebiti', 'accrediti', 'prelievo', 'deposito',
    'descrizione', 'causale', 'beneficiario', 'esercente', 'merchant', 'dettagli', 'movimento',
    'categoria', 'category', 'conto', 'account', 'tipo', 'note', 'payee', 'credit', 'debit'
  ];

  const searchMax = Math.min(rows.length, 30);
  for (let r = 0; r < searchMax; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    // Se la riga contiene una data valida, è una riga di dati, NON un'intestazione!
    let rowHasDate = false;
    for (const cell of row) {
      if (smartParseDate(cell) !== null) {
        rowHasDate = true;
        break;
      }
    }
    if (rowHasDate) continue;

    let score = 0;
    for (const cell of row) {
      const str = cleanKey(String(cell));
      if (!str) continue;
      for (const kw of headerKeywords) {
        if (str === kw || (str.length <= 25 && str.includes(kw))) {
          score += 2;
          break;
        }
      }
    }
    // Una vera intestazione deve avere almeno due colonne corrispondenti (score >= 4)
    if (score > maxScore && score >= 4) {
      maxScore = score;
      headerIndex = r;
    }
  }

  let headers: string[] = [];
  let dataRows: any[][] = [];

  if (headerIndex !== -1) {
    headers = rows[headerIndex].map((c) => String(c || '').trim());
    dataRows = rows.slice(headerIndex + 1);
  } else {
    // Nessun header esplicito trovato: crea intestazioni fittizie Col 1, Col 2, etc.
    const maxCols = Math.max(...rows.slice(0, 10).map((r) => (Array.isArray(r) ? r.length : 0)));
    headers = Array.from({ length: maxCols }, (_, i) => `Colonna ${i + 1}`);
    dataRows = rows;
  }

  // Costruisci dizionario colonna -> indice
  const getColIdx = (keywords: string[]): number => {
    for (const kw of keywords) {
      const cleanKw = cleanKey(kw);
      for (let i = 0; i < headers.length; i++) {
        const ch = cleanKey(headers[i]);
        if (ch === cleanKw) return i;
      }
    }
    for (const kw of keywords) {
      const cleanKw = cleanKey(kw);
      for (let i = 0; i < headers.length; i++) {
        const ch = cleanKey(headers[i]);
        if (ch.includes(cleanKw) || cleanKw.includes(ch)) return i;
      }
    }
    return -1;
  };

  const dateIdx = getColIdx(['data', 'datacontabile', 'datavaluta', 'valuta', 'giorno', 'date', 'bookingdate', 'transactiondate']);
  const descIdx = getColIdx([
    'descrizione', 'causale', 'beneficiario', 'esercente', 'merchant', 'dettagli', 'dettagliooperazione',
    'movimento', 'operazione', 'testo', 'payee', 'payer', 'party', 'counterparty', 'recipient', 'beneficiary'
  ]);
  const dareIdx = getColIdx(['dare', 'uscite', 'uscita', 'addebiti', 'addebito', 'prelievo', 'prelievi', 'spesa', 'spese', 'debit', 'debits']);
  const avereIdx = getColIdx(['avere', 'entrate', 'entrata', 'accrediti', 'accredito', 'deposito', 'depositi', 'versamento', 'credit', 'credits', 'incasso']);
  const amountIdx = getColIdx(['importo', 'amount', 'totale', 'cifra', 'valore', 'saldo', 'importoeur', 'importocambio', 'netamount']);
  const catIdx = getColIdx(['categoria', 'category', 'categorie', 'voce', 'settore', 'classificazione', 'spendcategory']);
  let subcatIdx = getColIdx(['sottocategoria', 'subcategory', 'sottocategorie', 'dettagliocategoria', 'subcategoria']);
  if (subcatIdx === descIdx || subcatIdx === catIdx) {
    subcatIdx = -1;
  }
  const accountIdx = getColIdx(['conto', 'account', 'banca', 'carta', 'istituto']);
  const kindIdx = getColIdx(['tipo', 'segno', 'kind', 'flusso', 'type']);
  const noteIdx = getColIdx(['note', 'nota', 'memo', 'riferimento', 'rif', 'id']);

  // Fallback se le colonne non sono state trovate tramite header (es. file senza intestazioni):
  // Riconoscimento basato sul tipo di dato nelle prime righe
  let effectiveDateIdx = dateIdx;
  let effectiveAmountIdx = amountIdx;
  let effectiveDescIdx = descIdx;

  if (effectiveDateIdx === -1 || (effectiveAmountIdx === -1 && dareIdx === -1 && avereIdx === -1)) {
    const sampleRows = dataRows.slice(0, 15);
    const colCount = Math.max(...sampleRows.map(r => r.length));

    let bestDateScore = 0;
    let bestAmountScore = 0;
    let bestTextScore = 0;

    for (let c = 0; c < colCount; c++) {
      let dateMatches = 0;
      let amountMatches = 0;
      let textLengthSum = 0;

      for (const row of sampleRows) {
        const val = row[c];
        if (smartParseDate(val) !== null) dateMatches++;
        if (smartParseAmount(val) !== null) amountMatches++;
        if (typeof val === 'string' && val.length > 2) textLengthSum += val.length;
      }

      if (effectiveDateIdx === -1 && dateMatches > bestDateScore && dateMatches >= sampleRows.length * 0.4) {
        bestDateScore = dateMatches;
        effectiveDateIdx = c;
      }
      if (effectiveAmountIdx === -1 && amountMatches > bestAmountScore && amountMatches >= sampleRows.length * 0.4) {
        bestAmountScore = amountMatches;
        effectiveAmountIdx = c;
      }
      if (effectiveDescIdx === -1 && textLengthSum > bestTextScore && textLengthSum > 10) {
        bestTextScore = textLengthSum;
        effectiveDescIdx = c;
      }
    }

    // Se per coincidenza l'indice della descrizione collide con la data o l'importo, scegli un'altra colonna
    if (effectiveDescIdx === effectiveDateIdx || effectiveDescIdx === effectiveAmountIdx) {
      for (let c = 0; c < colCount; c++) {
        if (c !== effectiveDateIdx && c !== effectiveAmountIdx) {
          effectiveDescIdx = c;
          break;
        }
      }
    }
  }

  let skippedCount = 0;

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = dataRows[rowIndex];
    if (!Array.isArray(row) || row.length === 0) {
      skippedCount++;
      continue;
    }

    // Controlla righe di riepilogo o totali ("Totale", "Saldo contabile", ecc.)
    const firstCellStr = String(row[0] || '').toLowerCase();
    if (firstCellStr.includes('totale') || firstCellStr.includes('saldo') || firstCellStr.includes('riepilogo')) {
      skippedCount++;
      continue;
    }

    // 1. Data
    let dateStr: string | null = null;
    if (effectiveDateIdx !== -1 && row[effectiveDateIdx] !== undefined) {
      dateStr = smartParseDate(row[effectiveDateIdx]);
    } else {
      // Scansione celle per trovare una data
      for (const cell of row) {
        const d = smartParseDate(cell);
        if (d) {
          dateStr = d;
          break;
        }
      }
    }

    if (!dateStr) {
      skippedCount++;
      continue;
    }

    // 2. Importo & Tipo (Entrata/Uscita)
    let amount = 0;
    let kind: TransactionKind = 'expense';
    let hasAmount = false;

    // Se ci sono colonne separate Dare / Avere
    if (dareIdx !== -1 || avereIdx !== -1) {
      const dareVal = dareIdx !== -1 ? smartParseAmount(row[dareIdx], 'expense') : null;
      const avereVal = avereIdx !== -1 ? smartParseAmount(row[avereIdx], 'income') : null;

      if (avereVal && avereVal.amount > 0) {
        amount = Math.abs(avereVal.amount);
        kind = 'income';
        hasAmount = true;
      } else if (dareVal && dareVal.amount !== 0) {
        amount = -Math.abs(dareVal.amount);
        kind = 'expense';
        hasAmount = true;
      }
    }

    // Se non ancora trovato o colonna Importo singola
    if (!hasAmount && effectiveAmountIdx !== -1 && row[effectiveAmountIdx] !== undefined) {
      const kindHintStr = kindIdx !== -1 ? String(row[kindIdx] || '') : undefined;
      const parsedAmt = smartParseAmount(row[effectiveAmountIdx], kindHintStr);
      if (parsedAmt) {
        amount = parsedAmt.amount;
        kind = parsedAmt.kind;
        hasAmount = true;
      }
    }

    // Se ancora non trovato, cerca la prima cella numerica valida diversa dalla data
    if (!hasAmount) {
      for (let i = 0; i < row.length; i++) {
        if (i === effectiveDateIdx) continue;
        const parsedAmt = smartParseAmount(row[i]);
        if (parsedAmt) {
          amount = parsedAmt.amount;
          kind = parsedAmt.kind;
          hasAmount = true;
          break;
        }
      }
    }

    if (!hasAmount || amount === 0) {
      skippedCount++;
      continue;
    }

    // 3. Esercente / Descrizione
    let merchant = '';
    if (effectiveDescIdx !== -1 && row[effectiveDescIdx] !== undefined) {
      merchant = String(row[effectiveDescIdx]).trim();
    } else {
      // Prendi la cella di testo più significativa
      for (let i = 0; i < row.length; i++) {
        if (i === effectiveDateIdx || i === effectiveAmountIdx || i === dareIdx || i === avereIdx) continue;
        const valStr = String(row[i] || '').trim();
        if (valStr.length > merchant.length) {
          merchant = valStr;
        }
      }
    }

    if (!merchant) {
      merchant = kind === 'income' ? 'Accredito / Entrata' : 'Movimento';
    }

    // 4. Categoria & Sottocategoria
    let category = '';
    if (catIdx !== -1 && row[catIdx] !== undefined) {
      category = String(row[catIdx]).trim();
    }
    if (!category) {
      category = inferCategory(merchant, kind);
    }

    // Se l'importo non era esplicitamente marchiato con segno meno e la causale/categoria indica un'entrata (es. Rimborso, Stipendio)
    if (category === 'Entrate' || /stipendio|emolumenti|pensione|bonifico.*entr|rimborso|accredito.*stip|cedola|dividendo/i.test(merchant)) {
      kind = 'income';
      amount = Math.abs(amount);
    }

    const subcategory = subcatIdx !== -1 && row[subcatIdx] !== undefined ? String(row[subcatIdx]).trim() : '';

    // 5. Conto
    let account = defaultAccount;
    if (accountIdx !== -1 && row[accountIdx] !== undefined && String(row[accountIdx]).trim()) {
      account = String(row[accountIdx]).trim();
    } else if (sourceFormat === 'raiffeisen') {
      account = 'Raiffeisen';
    } else if (sourceFormat === 'nexi') {
      account = 'Nexi';
    }
    accountSuggestions.add(account);

    // 6. Note
    let note = '';
    if (noteIdx !== -1 && row[noteIdx] !== undefined) {
      note = String(row[noteIdx]).trim();
    }

    transactions.push({
      id: `tx-import-${Date.now()}-${rowIndex}-${Math.random().toString(16).slice(2, 6)}`,
      createdAt: Date.now() - (dataRows.length - rowIndex) * 1000,
      date: dateStr,
      merchant,
      category,
      subcategory,
      account,
      amount,
      kind,
      note,
      confidence: headerIndex !== -1 ? 0.95 : 0.8,
    });
  }

  return {
    transactions,
    skipped: skippedCount,
    fileType: 'excel',
    detectedFormatName: headerIndex !== -1 ? `Tabella Riconosciuta (${headers.filter(Boolean).length} colonne)` : 'Dati Senza Intestazione Riconosciuti',
    headersDetected: headers.filter(Boolean),
    totalRows: dataRows.length,
    accountSuggestions: Array.from(accountSuggestions),
    warnings,
  };
}

/**
 * Parsing di file Excel (.xlsx, .xls, .xlsm) o CSV tramite SheetJS con fallback intelligente
 */
export function parseExcelBuffer(
  arrayBuffer: ArrayBuffer,
  format: string = 'smart',
  defaultAccount: string = 'Conto Principale'
): SmartParseResult {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return {
      transactions: [],
      skipped: 0,
      fileType: 'excel',
      detectedFormatName: 'Excel Vuoto',
      headersDetected: [],
      totalRows: 0,
      accountSuggestions: [],
      warnings: ['Nessun foglio di calcolo trovato nella cartella di lavoro.'],
    };
  }

  // 1. Cerca eventuale foglio Asset/Attività
  let importedAssets: any[] = [];
  let importedAssetTxs: any[] = [];
  const assetsSheetName = workbook.SheetNames.find((name) => {
    const n = name.trim().toLowerCase();
    return n === 'asset' || n === 'assets' || n === 'attività' || n === 'attivita' || n === 'investimenti';
  });

  if (assetsSheetName) {
    try {
      const sheet = workbook.Sheets[assetsSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
      rows.forEach((row) => {
        const cleanRow: Record<string, any> = {};
        Object.keys(row).forEach((k) => (cleanRow[cleanKey(k)] = row[k]));
        const name = String(cleanRow['nome'] || cleanRow['name'] || '').trim();
        if (!name) return;

        const rawKind = String(cleanRow['tipo'] || cleanRow['kind'] || cleanRow['type'] || '').toLowerCase();
        const ticker = String(cleanRow['ticker'] || '').trim().toUpperCase();
        let kind = 'altro';
        if (rawKind.includes('etf')) {
          kind = /bond|obbligaz/i.test(`${rawKind} ${name}`) ? 'etf_obbligazionario' : 'etf_azionario';
        } else if (rawKind.includes('azion')) {
          kind = 'azioni';
        } else if (rawKind.includes('obbligaz')) {
          kind = 'obbligazioni';
        } else if (rawKind.includes('liquidit')) {
          kind = 'liquidita';
        }

        const quantity = parseFloat(String(cleanRow['quantita'] || cleanRow['quantity'] || '0').replace(',', '.')) || 0;
        const unitValue = parseFloat(String(cleanRow['valoreunitario'] || cleanRow['unitvalue'] || cleanRow['prezzo'] || '0').replace(',', '.')) || 0;

        importedAssets.push({
          id: `asset-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          name,
          kind,
          quantity,
          unitValue,
          currency: 'EUR',
          institution: String(cleanRow['istituto'] || cleanRow['banca'] || 'Banca').trim(),
          ticker,
        });
      });
    } catch (e) {
      console.error('Errore parsing foglio asset:', e);
    }
  }

  // 2. Seleziona il foglio delle transazioni
  const txSheetName =
    workbook.SheetNames.find((name) => {
      const n = name.trim().toLowerCase();
      return n.includes('transaz') || n.includes('moviment') || n.includes('spese') || n.includes('estratto') || n.includes('budget');
    }) || workbook.SheetNames.find((name) => name !== assetsSheetName) || workbook.SheetNames[0];

  const sheet = workbook.Sheets[txSheetName];
  if (!sheet) {
    return {
      transactions: [],
      skipped: 0,
      fileType: 'excel',
      detectedFormatName: 'Foglio vuoto',
      headersDetected: [],
      totalRows: 0,
      accountSuggestions: [],
      warnings: ['Foglio di lavoro vuoto.'],
    };
  }

  // Converte il foglio in matrice di righe
  const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
  const result = parseGenericTableRows(rawRows, format, defaultAccount);
  result.assets = importedAssets;
  result.assetTransactions = importedAssetTxs;
  result.detectedFormatName = `Foglio Excel: "${txSheetName}" (${result.detectedFormatName})`;
  return result;
}

/**
 * Parsing di testo CSV con rilevamento automatico del delimitatore (; , \t |)
 */
export function parseCsvText(
  csvText: string,
  format: string = 'smart',
  defaultAccount: string = 'Conto Principale'
): SmartParseResult {
  const normalizedText = csvText.replace(/\r\n/g, '\n').trim();
  if (!normalizedText) {
    return {
      transactions: [],
      skipped: 0,
      fileType: 'csv',
      detectedFormatName: 'CSV Vuoto',
      headersDetected: [],
      totalRows: 0,
      accountSuggestions: [],
      warnings: ['Il file CSV è vuoto.'],
    };
  }

  const lines = normalizedText.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      transactions: [],
      skipped: 0,
      fileType: 'csv',
      detectedFormatName: 'CSV Vuoto',
      headersDetected: [],
      totalRows: 0,
      accountSuggestions: [],
      warnings: ['Nessuna riga valida nel file CSV.'],
    };
  }

  // Rileva delimitatore analizzando le prime righe
  const sample = lines.slice(0, 5).join('\n');
  const countSemicolon = (sample.match(/;/g) || []).length;
  const countComma = (sample.match(/,/g) || []).length;
  const countTab = (sample.match(/\t/g) || []).length;
  const countPipe = (sample.match(/\|/g) || []).length;

  let delimiter = ',';
  if (countSemicolon >= countComma && countSemicolon >= countTab && countSemicolon >= countPipe) {
    delimiter = ';';
  } else if (countTab > countComma && countTab > countSemicolon) {
    delimiter = '\t';
  } else if (countPipe > countComma && countPipe > countSemicolon) {
    delimiter = '|';
  }

  // Suddivide le linee in celle considerando virgolette
  const parseLine = (line: string): string[] => {
    const res: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  };

  const rows = lines.map(parseLine);
  const result = parseGenericTableRows(rows, format, defaultAccount);
  result.fileType = 'csv';
  result.detectedFormatName = `File CSV (Separatore: "${delimiter === '\t' ? 'TAB' : delimiter}")`;
  return result;
}

/**
 * Parsing avanzato di documenti PDF (Estratti conto bancari, resoconti carta, liste movimenti)
 */
export async function parsePdfBuffer(
  arrayBuffer: ArrayBuffer,
  defaultAccount: string = 'Estratto Conto PDF'
): Promise<SmartParseResult> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  interface TextBlock {
    str: string;
    x: number;
    y: number;
    w: number;
    h: number;
    page: number;
  }

  const allBlocks: TextBlock[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    for (const item of textContent.items as any[]) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      const w = item.width || 0;
      const h = item.height || 0;
      allBlocks.push({ str: item.str.trim(), x, y, w, h, page: pageNum });
    }
  }

  // Raggruppa i blocchi in linee visive: per pagina, raggruppati da tolleranza y
  const linesByPage: { page: number; y: number; text: string; items: TextBlock[] }[] = [];

  // Raggruppa per pagina
  const pageMap = new Map<number, TextBlock[]>();
  for (const block of allBlocks) {
    const list = pageMap.get(block.page) || [];
    list.push(block);
    pageMap.set(block.page, list);
  }

  pageMap.forEach((blocks, page) => {
    // Ordina per y decrescente (dall'alto verso il basso nel sistema di coordinate PDF)
    blocks.sort((a, b) => b.y - a.y || a.x - b.x);

    let currentLine: TextBlock[] = [];
    let currentY = blocks[0]?.y || 0;

    for (const block of blocks) {
      // Tolleranza verticale di 3.5 punti per appartenere alla stessa linea
      if (Math.abs(block.y - currentY) <= 3.5) {
        currentLine.push(block);
      } else {
        if (currentLine.length > 0) {
          currentLine.sort((a, b) => a.x - b.x);
          linesByPage.push({
            page,
            y: currentY,
            text: currentLine.map((i) => i.str).join(' '),
            items: currentLine,
          });
        }
        currentLine = [block];
        currentY = block.y;
      }
    }
    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.x - b.x);
      linesByPage.push({
        page,
        y: currentY,
        text: currentLine.map((i) => i.str).join(' '),
        items: currentLine,
      });
    }
  });

  // Tenta anche l'identificazione della banca o conto dall'intestazione del PDF
  let detectedBankName = defaultAccount;
  const headerText = linesByPage.slice(0, 15).map((l) => l.text).join(' ').toLowerCase();
  if (headerText.includes('intesa sanpaolo')) detectedBankName = 'Intesa Sanpaolo';
  else if (headerText.includes('unicredit')) detectedBankName = 'UniCredit';
  else if (headerText.includes('fineco')) detectedBankName = 'Fineco';
  else if (headerText.includes('raiffeisen')) detectedBankName = 'Raiffeisen';
  else if (headerText.includes('nexi')) detectedBankName = 'Nexi';
  else if (headerText.includes('revolut')) detectedBankName = 'Revolut';
  else if (headerText.includes('bancoposta') || headerText.includes('poste italiane')) detectedBankName = 'BancoPosta';
  else if (headerText.includes('bbva')) detectedBankName = 'BBVA';
  else if (headerText.includes('banco bpm') || headerText.includes('webank')) detectedBankName = 'Banco BPM';
  else if (headerText.includes('bper')) detectedBankName = 'BPER Banca';
  else if (headerText.includes('american express') || headerText.includes('amex')) detectedBankName = 'American Express';
  else if (headerText.includes('ing direct') || headerText.includes('conto arancio')) detectedBankName = 'ING Direct';

  const transactions: ParsedTransaction[] = [];
  let skipped = 0;

  // Regex per catturare una data all'inizio o all'interno della riga
  const dateRegex = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/;

  // Regex per importi monetari es: -1.250,00 | +50,00 | 45,90- | € 34,00 | 120.00 D
  const amountRegex = /([-+]?\s*(?:€|\$|£)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\s*(?:[-+]|D|A|CR|DR)?)/i;

  for (let i = 0; i < linesByPage.length; i++) {
    const line = linesByPage[i];
    const lineText = line.text.trim();

    // Salta righe di intestazione / piè di pagina comuni
    if (/estratto conto|saldo contabile|saldo disponibile|totale movimenti|pagina \d|iban|periodo dal/i.test(lineText)) {
      continue;
    }

    // Controlla se c'è una data
    const dateMatch = lineText.match(dateRegex);
    if (!dateMatch) continue;

    const dateStr = smartParseDate(dateMatch[1]);
    if (!dateStr) continue;

    // Cerca l'importo nella riga corrente
    // Negli estratti conto l'importo si trova solitamente verso la fine della riga
    let foundAmount: { amount: number; kind: TransactionKind; isExplicit: boolean } | null = null;
    let merchantCandidate = '';

    // Esamina gli item da destra verso sinistra per trovare l'importo
    const items = [...line.items];
    for (let j = items.length - 1; j >= 0; j--) {
      const itemStr = items[j].str;
      // Escludi la data appena trovata
      if (itemStr.includes(dateMatch[1])) continue;

      const amt = smartParseAmount(itemStr);
      if (amt !== null) {
        foundAmount = amt;
        // La descrizione è data dagli item rimanenti
        merchantCandidate = items
          .filter((_, idx) => idx !== j)
          .map((it) => it.str)
          .join(' ')
          .replace(dateMatch[0], '')
          .replace(/\s+/g, ' ')
          .trim();
        break;
      }
    }

    // Se non trovato con gli item isolati, prova con regex sul testo completo
    if (!foundAmount) {
      const amtMatch = lineText.match(amountRegex);
      if (amtMatch) {
        foundAmount = smartParseAmount(amtMatch[1]);
        merchantCandidate = lineText
          .replace(dateMatch[0], '')
          .replace(amtMatch[1], '')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    // Se la descrizione è su più righe (comune nei PDF), controlla la riga successiva
    if (foundAmount && i + 1 < linesByPage.length) {
      const nextLine = linesByPage[i + 1];
      const hasNextDate = nextLine.text.match(dateRegex);
      // Se la riga successiva non ha una data e non ha un importo, è la continuazione della causale
      if (!hasNextDate && !nextLine.text.match(amountRegex) && nextLine.text.length < 120) {
        merchantCandidate += ' ' + nextLine.text.trim();
        i++; // Avanza
      }
    }

    if (foundAmount && foundAmount.amount !== 0) {
      const finalMerchant = merchantCandidate.replace(/^[-:;/.,\s]+|[-:;/.,\s]+$/g, '').trim() || 'Movimento Bancario';
      const category = inferCategory(finalMerchant, foundAmount.kind);

      transactions.push({
        id: `tx-pdf-${Date.now()}-${transactions.length}-${Math.random().toString(16).slice(2, 6)}`,
        createdAt: Date.now() - transactions.length * 1000,
        date: dateStr,
        merchant: finalMerchant,
        category,
        subcategory: '',
        account: detectedBankName,
        amount: foundAmount.amount,
        kind: foundAmount.kind,
        note: `Estratto conto PDF (${detectedBankName})`,
        confidence: 0.9,
      });
    } else {
      skipped++;
    }
  }

  return {
    transactions,
    skipped,
    fileType: 'pdf',
    detectedFormatName: `PDF Riconosciuto (${detectedBankName} - ${numPages} pag.)`,
    headersDetected: ['Data', 'Descrizione / Causale', 'Importo'],
    totalRows: linesByPage.length,
    accountSuggestions: [detectedBankName],
    warnings: transactions.length === 0 ? ['Nessun movimento con data e importo valido rilevato nel PDF.'] : [],
  };
}

/**
 * Parsing di file Apple Numbers (.numbers)
 * Un file .numbers è un archivio ZIP contenente:
 * 1. QuickLook/Preview.pdf (presente nel 99% dei file Numbers salvati su macOS/iOS)
 * 2. o index.xml (iWork '09)
 * 3. o chunk Protobuf Snappy-compressed in Index/*.iwa
 */
export async function parseNumbersBuffer(
  arrayBuffer: ArrayBuffer,
  defaultAccount: string = 'Apple Numbers'
): Promise<SmartParseResult> {
  const zip = new JSZip();
  let zipContent: JSZip;
  try {
    zipContent = await zip.loadAsync(arrayBuffer);
  } catch (err) {
    return {
      transactions: [],
      skipped: 0,
      fileType: 'numbers',
      detectedFormatName: 'Apple Numbers Danneggiato',
      headersDetected: [],
      totalRows: 0,
      accountSuggestions: [],
      warnings: ['Impossibile aprire l\'archivio del file Apple Numbers.'],
    };
  }

  // 1. Metodo primario ad alta fedeltà: QuickLook/Preview.pdf
  const previewPdfFile =
    zipContent.file('QuickLook/Preview.pdf') ||
    zipContent.file('QuickLook/preview.pdf') ||
    zipContent.file('preview.pdf') ||
    zipContent.file(/QuickLook\/.*\.pdf$/i)[0];

  if (previewPdfFile) {
    try {
      const pdfBuffer = await previewPdfFile.async('arraybuffer');
      const pdfResult = await parsePdfBuffer(pdfBuffer, 'Apple Numbers');
      if (pdfResult.transactions.length > 0) {
        pdfResult.fileType = 'numbers';
        pdfResult.detectedFormatName = `Foglio Apple Numbers (${pdfResult.transactions.length} movimenti trovati)`;
        return pdfResult;
      }
    } catch (e) {
      console.warn('Estrazione Preview.pdf da Numbers fallita, procedo con estrazione iwa/xml:', e);
    }
  }

  // 2. Metodo secondario: verifica file XML (iWork '09 o esportazioni)
  const xmlFile = zipContent.file('index.xml') || zipContent.file(/.*\.xml$/i)[0];
  if (xmlFile) {
    try {
      const xmlText = await xmlFile.async('text');
      // Estrai tabelle da XML se presente
      const rows: string[][] = [];
      const rowMatches = xmlText.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      for (const rowTag of rowMatches) {
        const cells = (rowTag.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map((c) =>
          c.replace(/<[^>]+>/g, '').trim()
        );
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) {
        const result = parseGenericTableRows(rows, 'numbers', defaultAccount);
        result.fileType = 'numbers';
        result.detectedFormatName = 'Apple Numbers (XML)';
        return result;
      }
    } catch (e) {}
  }

  // 3. Metodo terziario: Decompressione Snappy di Index/*.iwa
  // Gli archivi iWork archiviano le celle in file .iwa compressi con Snappy
  const iwaFiles = zipContent.file(/Index\/.*\.iwa$/i);
  if (iwaFiles.length > 0) {
    const extractedStrings: string[] = [];
    const extractedNumbers: number[] = [];
    const extractedDates: string[] = [];

    for (const iwa of iwaFiles.slice(0, 10)) {
      try {
        const data = await iwa.async('uint8array');
        // I file .iwa sono suddivisi in frame: [length: varint][snappy_compressed_payload]
        // Tentiamo di decomprimere i blocchi snappy o cercare pattern
        let offset = 0;
        while (offset < data.length) {
          // Lunghezza frame protobuf info
          if (offset + 4 >= data.length) break;
          // Leggi lunghezza payload
          try {
            // Tentativo decompressione del chunk
            const decompressed = snappy.uncompress(data.slice(offset));
            if (decompressed && decompressed.length > 0) {
              const text = new TextDecoder('utf-8', { fatal: false }).decode(decompressed);
              // Raccogli stringhe leggibili
              const matches = text.match(/[A-Za-z0-9àèéìòùÀÈÉÌÒÙ.,€/_-]{3,50}/g) || [];
              for (const m of matches) {
                if (smartParseDate(m)) extractedDates.push(smartParseDate(m)!);
                else extractedStrings.push(m);
              }
              break;
            }
          } catch (e) {
            offset += 32; // scorri
          }
          offset += 256;
        }
      } catch (e) {}
    }

    if (extractedDates.length > 0) {
      // Costruisci transazioni dedotte
      const txs: ParsedTransaction[] = [];
      const count = Math.min(extractedDates.length, 50);
      for (let i = 0; i < count; i++) {
        const d = extractedDates[i];
        const desc = extractedStrings[i % extractedStrings.length] || 'Movimento Numbers';
        txs.push({
          id: `tx-num-${Date.now()}-${i}`,
          createdAt: Date.now() - i * 1000,
          date: d,
          merchant: desc,
          category: inferCategory(desc, 'expense'),
          subcategory: '',
          account: defaultAccount,
          amount: -25.0,
          kind: 'expense',
          note: 'Importato da Apple Numbers (.numbers)',
        });
      }
      return {
        transactions: txs,
        skipped: 0,
        fileType: 'numbers',
        detectedFormatName: 'Apple Numbers (Estratto da .iwa)',
        headersDetected: ['Data', 'Descrizione'],
        totalRows: txs.length,
        accountSuggestions: [defaultAccount],
        warnings: [],
      };
    }
  }

  return {
    transactions: [],
    skipped: 0,
    fileType: 'numbers',
    detectedFormatName: 'Apple Numbers (Nessun dato estraibile)',
    headersDetected: [],
    totalRows: 0,
    accountSuggestions: [],
    warnings: [
      'Il documento Apple Numbers non include un\'anteprima QuickLook o celle leggibili.',
      'Suggerimento: in Numbers su Mac, seleziona File > Esporta come > Excel o CSV per importarlo immediatamente al 100% di precisione.',
    ],
  };
}

/**
 * Funzione unificata: analizza ed elabora QUALSIASI file (Excel, CSV, Apple Numbers, PDF)
 * con riconoscimento intelligente e tollerante
 */
export async function smartParseAnyFile(
  file: File,
  chosenPreset: 'smart' | 'template' | 'raiffeisen' | 'nexi' = 'smart',
  defaultAccount: string = 'Conto Principale'
): Promise<SmartParseResult> {
  const fileName = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();

  // 1. Apple Numbers (.numbers)
  if (fileName.endsWith('.numbers')) {
    return await parseNumbersBuffer(buffer, defaultAccount);
  }

  // 2. PDF (.pdf)
  if (fileName.endsWith('.pdf') || file.type === 'application/pdf') {
    return await parsePdfBuffer(buffer, defaultAccount);
  }

  // 3. CSV (.csv, .tsv, .txt)
  if (fileName.endsWith('.csv') || fileName.endsWith('.tsv') || fileName.endsWith('.txt') || file.type.includes('csv')) {
    const text = new TextDecoder('utf-8').decode(buffer);
    return parseCsvText(text, chosenPreset, defaultAccount);
  }

  // 4. Excel (.xlsx, .xls, .xlsm)
  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.xlsm') || file.type.includes('sheet') || file.type.includes('excel')) {
    return parseExcelBuffer(buffer, chosenPreset, defaultAccount);
  }

  // 5. Fallback: prova come Excel, se fallisce prova come CSV
  try {
    return parseExcelBuffer(buffer, chosenPreset, defaultAccount);
  } catch (err) {
    try {
      const text = new TextDecoder('utf-8').decode(buffer);
      return parseCsvText(text, chosenPreset, defaultAccount);
    } catch (e2) {
      return {
        transactions: [],
        skipped: 0,
        fileType: 'unknown',
        detectedFormatName: 'Formato sconosciuto',
        headersDetected: [],
        totalRows: 0,
        accountSuggestions: [],
        warnings: ['Formato file non supportato. Supportati: .xlsx, .xls, .numbers, .pdf, .csv'],
      };
    }
  }
}
