/**
 * Motori di calcolo delle simulazioni finanziarie.
 * Funzioni pure, prive di dipendenze React, cosi da essere riusabili anche
 * dai test e da eventuali export (CSV/PDF) futuri.
 */

/** Tipi di ammortamento supportati per i mutui. */
export type AmortizationType = 'french' | 'italian';

export interface CompoundInput {
  initialCapital: number;
  monthlyContribution: number;
  annualReturnPercent: number;
  inflationPercent?: number;
  years: number;
}

export interface CompoundYearRow {
  year: number;
  contributed: number;
  interest: number;
  total: number;
}

export interface CompoundResult {
  yearlyData: CompoundYearRow[];
  finalTotal: number;
  finalContributed: number;
  finalInterest: number;
  monthlyRate: number;
  netAnnualReturn: number;
  multiplier: number;
}

/**
 * Proietta la crescita di un capitale con versamenti periodici e rendimento
 * composto. I versamenti avvengono a fine mese (convenzione standard).
 */
export function projectCompoundInterest(input: CompoundInput): CompoundResult {
  const initialCapital = Math.max(0, input.initialCapital || 0);
  const monthlyContribution = Math.max(0, input.monthlyContribution || 0);
  const annualReturn = input.annualReturnPercent || 0;
  const inflation = input.inflationPercent || 0;
  const years = Math.max(0, Math.round(input.years || 0));

  const netAnnualReturn = inflation
    ? (1 + annualReturn / 100) / (1 + inflation / 100) - 1
    : annualReturn / 100;

  const monthlyRate = Math.pow(1 + netAnnualReturn, 1 / 12) - 1;
  const totalMonths = years * 12;

  const yearlyData: CompoundYearRow[] = [
    { year: 0, contributed: initialCapital, interest: 0, total: initialCapital },
  ];

  let balance = initialCapital;
  let contributed = initialCapital;

  for (let m = 1; m <= totalMonths; m++) {
    balance = balance * (1 + monthlyRate) + monthlyContribution;
    contributed += monthlyContribution;

    if (m % 12 === 0) {
      yearlyData.push({
        year: m / 12,
        contributed,
        interest: Math.max(0, balance - contributed),
        total: balance,
      });
    }
  }

  const finalTotal = balance;
  const finalContributed = contributed;
  const finalInterest = Math.max(0, finalTotal - finalContributed);

  return {
    yearlyData,
    finalTotal,
    finalContributed,
    finalInterest,
    monthlyRate,
    netAnnualReturn,
    multiplier: finalContributed > 0 ? finalTotal / finalContributed : 1,
  };
}

export interface FireInput {
  initialCapital: number;
  monthlyContribution: number;
  annualReturnPercent: number;
  inflationPercent?: number;
  targetMonthlyExpense: number;
  /** Orizzonte di proiezione in anni. */
  years: number;
  /** Withdrawal rate della regola 4% (default 4%). */
  withdrawalRatePercent?: number;
  /** Multiplicatore del capitale FIRE (default 25 = 4% rule). */
  multiple?: number;
}

export interface FireResult extends CompoundResult {
  fireNumber: number;
  yearsToFire: number | null;
  monthlyPassiveIncome: number;
  annualPassiveIncome: number;
  progressPercent: number;
}

/**
 * Simula l'obiettivo FIRE: capitale necessario (25x spese annue), tempo per
 * raggiungerlo e rendita passiva sostenibile (regola del 4%).
 */
export function simulateFire(input: FireInput): FireResult {
  const projection = projectCompoundInterest({
    initialCapital: input.initialCapital,
    monthlyContribution: input.monthlyContribution,
    annualReturnPercent: input.annualReturnPercent,
    inflationPercent: input.inflationPercent,
    years: Math.max(1, input.years || 1),
  });

  const withdrawalRate = (input.withdrawalRatePercent ?? 4) / 100;
  const multiple = input.multiple ?? 25;

  const annualExpense = Math.max(0, input.targetMonthlyExpense || 0) * 12;
  const fireNumber = annualExpense * multiple;

  const annualPassiveIncome = projection.finalTotal * withdrawalRate;
  const monthlyPassiveIncome = annualPassiveIncome / 12;

  // Stima degli anni necessari a raggiungere il capitale FIRE.
  let yearsToFire: number | null = null;
  let balance = Math.max(0, input.initialCapital || 0);
  const monthlyContribution = Math.max(0, input.monthlyContribution || 0);

  if (balance >= fireNumber && fireNumber > 0) {
    yearsToFire = 0;
  } else {
    for (let y = 1; y <= 80; y++) {
      for (let m = 0; m < 12; m++) {
        balance = balance * (1 + projection.monthlyRate) + monthlyContribution;
      }
      if (balance >= fireNumber) {
        yearsToFire = y;
        break;
      }
    }
  }

  const progressPercent = fireNumber > 0 ? Math.min(100, (projection.finalTotal / fireNumber) * 100) : 100;

  return {
    ...projection,
    fireNumber,
    yearsToFire,
    monthlyPassiveIncome,
    annualPassiveIncome,
    progressPercent,
  };
}

export interface MortgageInput {
  principal: number;
  years: number;
  annualRatePercent: number;
  type: AmortizationType;
  /** Versamento extra mensile che accelera l'estinzione. */
  extraMonthlyPayment?: number;
  /** Spese iniziali (notarile, valutazione, imposte...). */
  initialCosts?: number;
}

export interface MortgageYearRow {
  year: number;
  payment: number;
  principal: number;
  interest: number;
  remaining: number;
}

export interface MortgageMonthRow {
  month: number;
  year: number;
  payment: number;
  principal: number;
  interest: number;
  remaining: number;
}

export interface MortgageResult {
  monthlyPayment: number;
  totalPaid: number;
  totalPrincipal: number;
  totalInterest: number;
  initialCosts: number;
  totalCost: number;
  interestPercent: number;
  durationYears: number;
  rows: MortgageYearRow[];
  schedule: MortgageMonthRow[];
  maxLoanForBudget: (monthlyBudget: number) => number;
}

/** Rata mensile del piano di ammortamento francese (costante). */
export function frenchMonthlyPayment(principal: number, monthlyRate: number, months: number): number {
  if (months <= 0 || principal <= 0) return 0;
  if (monthlyRate <= 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

/**
 * Simula un mutuo con ammortamento francese (rata costante) o italiano
 * (capitale costante, rata decrescente), opzionalmente con un versamento
 * extra mensile.
 */
export function simulateMortgage(input: MortgageInput): MortgageResult {
  const principal = Math.max(0, input.principal || 0);
  const years = Math.max(1, Math.round(input.years || 1));
  const months = years * 12;
  const annualRate = Math.max(0, input.annualRatePercent || 0);
  const monthlyRate = Math.pow(1 + annualRate / 100, 1 / 12) - 1;
  const extra = Math.max(0, input.extraMonthlyPayment || 0);
  const initialCosts = Math.max(0, input.initialCosts || 0);

  const isFrench = input.type === 'french';
  const fixedPayment = isFrench
    ? frenchMonthlyPayment(principal, monthlyRate, months)
    : principal / months;

  const schedule: MortgageMonthRow[] = [];
  const rows: MortgageYearRow[] = [];

  let remaining = principal;
  let totalPaid = 0;
  let totalInterest = 0;
  let totalPrincipal = 0;

  const yearAggregates = new Map<number, MortgageYearRow>();

  for (let m = 1; m <= months && remaining > 0.005; m++) {
    const interest = remaining * monthlyRate;
    let principalPart: number;

    if (isFrench) {
      principalPart = fixedPayment - interest;
    } else {
      principalPart = principal / months;
    }

    // Se la rata non copre la quota capitale (tassi negativi o estremi), si
    // ripiega sul minimo richiesto per non andare sotto zero.
    if (principalPart > remaining) principalPart = remaining;
    if (principalPart < 0) principalPart = 0;

    let payment = principalPart + interest;

    // Versamento extra: riduce il capitale residuo (e di conseguenza gli
    // interessi futuri).
    if (extra > 0) {
      const extraPart = Math.min(extra, remaining - principalPart);
      if (extraPart > 0) {
        payment += extraPart;
        principalPart += extraPart;
      }
    }

    remaining = Math.max(0, remaining - principalPart);
    totalPaid += payment;
    totalInterest += interest;
    totalPrincipal += principalPart;

    const year = Math.ceil(m / 12);
    const row: MortgageMonthRow = {
      month: m,
      year,
      payment,
      principal: principalPart,
      interest,
      remaining,
    };
    schedule.push(row);

    const agg = yearAggregates.get(year) ?? {
      year,
      payment: 0,
      principal: 0,
      interest: 0,
      remaining,
    };
    agg.payment += payment;
    agg.principal += principalPart;
    agg.interest += interest;
    agg.remaining = remaining;
    yearAggregates.set(year, agg);
  }

  Array.from(yearAggregates.values())
    .sort((a, b) => a.year - b.year)
    .forEach((row) => rows.push(row));

  const durationYears = rows.length ? rows[rows.length - 1].year : 0;
  const totalCost = totalPaid + initialCosts;

  return {
    monthlyPayment: fixedPayment,
    totalPaid,
    totalPrincipal: totalPrincipal,
    totalInterest,
    initialCosts,
    totalCost,
    interestPercent: totalPaid > 0 ? (totalInterest / totalPaid) * 100 : 0,
    durationYears,
    rows,
    schedule,
    maxLoanForBudget: (monthlyBudget: number) => {
      const budget = Math.max(0, monthlyBudget || 0);
      if (budget <= 0) return 0;
      if (monthlyRate <= 0) return budget * months;
      return (budget * (1 - Math.pow(1 + monthlyRate, -months))) / monthlyRate;
    },
  };
}

// === Timeline mutuo con rinegoziazioni ===

/**
 * Rinegoziazione applicata a un mutuo esistente: dal giorno `date` il piano
 * viene ricalcolato sul capitale residuo con nuovo tasso e nuova durata.
 */
export interface MortgageTimelineRenegotiation {
  /** Data di applicazione (YYYY-MM-DD). */
  date: string;
  /** Nuovo TAN annuo in percentuale. */
  annualRatePercent: number;
  /** Nuova durata residua in anni. */
  remainingYears: number;
}

export interface MortgageTimelineRow {
  /** Data della rata (YYYY-MM-DD). */
  date: string;
  payment: number;
  principal: number;
  interest: number;
  /** Capitale residuo dopo la rata. */
  remaining: number;
  /** 0 = condizioni originarie, >0 = indice della rinegoziazione attiva. */
  phase: number;
}

export interface MortgageTimelineResult {
  rows: MortgageTimelineRow[];
  /** Rata della prima fase del piano. */
  initialMonthlyPayment: number;
  /** Rata attualmente in vigore (ultima rata <= oggi, o la prima). */
  currentMonthlyPayment: number;
  /** Tasso annuo attualmente in vigore (%). */
  currentRatePercent: number;
  totalPaid: number;
  totalInterest: number;
  totalPrincipal: number;
  /** Data dell'ultima rata (estinzione), null se il piano non si estingue. */
  payoffDate: string | null;
  /** Capitale residuo a una data (inclusa). Prima della prima rata restituisce il capitale iniziale. */
  remainingAt: (dateStr: string) => number;
}

function parseTimelineDate(s: string): Date {
  const parts = (s || '').split('-');
  return new Date(parseInt(parts[0], 10) || 1970, (parseInt(parts[1], 10) || 1) - 1, parseInt(parts[2], 10) || 1);
}

function timelineDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Simula l'intera timeline di un mutuo, mese per mese, a partire dalla data di
 * erogazione. Le rinegoziazioni dividono il piano in "fasi": alla data di ciascuna
 * rinegoziazione la rata viene ricalcolata sul capitale residuo con il nuovo tasso
 * e la nuova durata residua. Supporta ammortamento francese (rata costante per
 * fase) e italiano (quota capitale costante per fase), oltre a un versamento
 * extra mensile che accelera l'estinzione.
 */
export function simulateMortgageTimeline(input: {
  principal: number;
  years: number;
  annualRatePercent: number;
  type: AmortizationType;
  startDate: string;
  installmentDay?: number;
  extraMonthlyPayment?: number;
  renegotiations?: MortgageTimelineRenegotiation[];
}): MortgageTimelineResult {
  const principal = Math.max(0, input.principal || 0);
  const dom = Math.min(31, Math.max(1, Math.round(input.installmentDay || 1)));
  const extra = Math.max(0, input.extraMonthlyPayment || 0);
  const isFrench = input.type !== 'italian';

  const empty: MortgageTimelineResult = {
    rows: [],
    initialMonthlyPayment: 0,
    currentMonthlyPayment: 0,
    currentRatePercent: 0,
    totalPaid: 0,
    totalInterest: 0,
    totalPrincipal: 0,
    payoffDate: null,
    remainingAt: () => 0,
  };
  if (principal <= 0) return empty;

  const start = parseTimelineDate(input.startDate || '');
  if (isNaN(start.getTime())) {
    return { ...empty, remainingAt: () => principal };
  }

  // Fasi: condizioni originarie + rinegoziazioni ordinate per data
  type Phase = { date: string; rate: number; months: number };
  const phases: Phase[] = [
    {
      date: timelineDateIso(start),
      rate: Math.max(0, input.annualRatePercent || 0),
      months: Math.max(1, Math.round(input.years || 1)) * 12,
    },
  ];
  (input.renegotiations || [])
    .filter((r) => r && r.date && r.date >= phases[0].date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((r) =>
      phases.push({
        date: r.date,
        rate: Math.max(0, r.annualRatePercent || 0),
        months: Math.max(1, Math.round(r.remainingYears || 1)) * 12,
      })
    );

  const rows: MortgageTimelineRow[] = [];
  let remaining = principal;
  let totalPaid = 0;
  let totalInterest = 0;
  let totalPrincipal = 0;

  let phaseIdx = 0;
  let phaseFixedPayment = 0; // francese: rata costante della fase
  let phasePrincipalPart = 0; // italiano: quota capitale costante della fase

  const startPhase = (idx: number) => {
    phaseIdx = idx;
    const monthlyRate = Math.pow(1 + phases[idx].rate / 100, 1 / 12) - 1;
    if (isFrench) {
      phaseFixedPayment = frenchMonthlyPayment(remaining, monthlyRate, phases[idx].months);
    } else {
      phasePrincipalPart = phases[idx].months > 0 ? remaining / phases[idx].months : remaining;
    }
  };
  startPhase(0);

  // Prima rata: giorno della rata del mese successivo all'erogazione
  const firstMonth = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const firstDay = Math.min(dom, new Date(firstMonth.getFullYear(), firstMonth.getMonth() + 1, 0).getDate());
  let current = new Date(firstMonth.getFullYear(), firstMonth.getMonth(), firstDay);

  const MAX_MONTHS = 1200; // tappetino di sicurezza (100 anni)
  let count = 0;

  while (remaining > 0.005 && count < MAX_MONTHS) {
    count++;
    const dateStr = timelineDateIso(current);

    // Fase attiva: ultima rinegoziazione con data <= rata corrente
    let activePhase = phaseIdx;
    for (let i = phases.length - 1; i >= 0; i--) {
      if (phases[i].date <= dateStr) {
        activePhase = i;
        break;
      }
    }
    if (activePhase !== phaseIdx) startPhase(activePhase);

    const monthlyRate = Math.pow(1 + phases[phaseIdx].rate / 100, 1 / 12) - 1;
    const interest = remaining * monthlyRate;

    let principalPart = isFrench ? phaseFixedPayment - interest : phasePrincipalPart;
    if (principalPart < 0) principalPart = 0;
    if (principalPart > remaining) principalPart = remaining;

    let extraApplied = 0;
    if (extra > 0) {
      extraApplied = Math.min(extra, remaining - principalPart);
      if (extraApplied < 0) extraApplied = 0;
    }

    const totalPrincipalPart = principalPart + extraApplied;
    const payment = totalPrincipalPart + interest;

    remaining = Math.max(0, remaining - totalPrincipalPart);
    totalPaid += payment;
    totalInterest += interest;
    totalPrincipal += totalPrincipalPart;

    rows.push({ date: dateStr, payment, principal: totalPrincipalPart, interest, remaining, phase: phaseIdx });

    // Avanza al mese successivo
    const nextMonth = current.getMonth() + 1;
    const nextYear = current.getFullYear() + Math.floor(nextMonth / 12);
    const nextMonthIdx = nextMonth % 12;
    const nextDay = Math.min(dom, new Date(nextYear, nextMonthIdx + 1, 0).getDate());
    current = new Date(nextYear, nextMonthIdx, nextDay);
  }

  const todayIso = timelineDateIso(new Date());
  const initialMonthlyPayment = rows.length > 0 ? rows[0].payment : 0;

  let currentMonthlyPayment = initialMonthlyPayment;
  let currentRatePercent = phases[0].rate;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].date <= todayIso) {
      currentMonthlyPayment = rows[i].payment;
      currentRatePercent = phases[rows[i].phase].rate;
      break;
    }
  }

  const remainingAt = (dateStr: string): number => {
    if (!dateStr) return remaining;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].date <= dateStr) return rows[i].remaining;
    }
    return principal;
  };

  return {
    rows,
    initialMonthlyPayment,
    currentMonthlyPayment,
    currentRatePercent,
    totalPaid,
    totalInterest,
    totalPrincipal,
    payoffDate: rows.length > 0 ? rows[rows.length - 1].date : null,
    remainingAt,
  };
}
