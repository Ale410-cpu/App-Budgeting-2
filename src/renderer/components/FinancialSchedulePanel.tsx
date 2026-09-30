import React, { useState, useMemo } from 'react';

export type TransactionKind = 'expense' | 'income';

export type RecurringFrequency = 'weekly' | 'monthly' | 'custom_days';

export type RecurringTransaction = {
  id: string;
  merchant: string;
  amount: number;
  kind: TransactionKind;
  category: string;
  subcategory: string;
  account: string;
  frequency: RecurringFrequency;
  dayOfMonth?: number;
  dayOfWeek?: number;
  intervalDays?: number;
  startDate: string;
  note: string;
  isActive: boolean;
  createdAt: number;
  autoPost?: boolean;
  lastPostedDate?: string;
};

export type PAC = {
  id: string;
  name: string;
  assetId: string;
  amount: number;
  dayOfMonth: number;
  startDate: string;
  isActive: boolean;
  createdAt: number;
  autoPost?: boolean;
  account?: string;
  category?: string;
  subcategory?: string;
  lastPostedDate?: string;
  createAssetTransaction?: boolean;
};

export type Asset = {
  id: string;
  name: string;
  kind: string;
  institution: string;
  quantity: number;
  unitValue: number;
  note: string;
  createdAt: number;
  ticker?: string;
  etfSubtype?: 'azionario' | 'obbligazionario';
};

export interface FinancialSchedulePanelProps {
  recurringTransactions: RecurringTransaction[];
  pianiAccumulo: PAC[];
  assets: Asset[];
  cashAvailable: number;
  formatEuro: (val: number) => string;
  onNavigateToRecurring: () => void;
  onNavigateToPAC: () => void;
}

export type ScheduleItem = {
  id: string;
  dateStr: string;
  dateObj: Date;
  daysRemaining: number;
  name: string;
  kind: 'income' | 'expense' | 'pac';
  categoryOrAsset: string;
  account: string;
  amount: number;
  note?: string;
  autoPost?: boolean;
  sourceType: 'recurring' | 'pac';
  runningBalance: number;
};

export const FinancialSchedulePanel: React.FC<FinancialSchedulePanelProps> = ({
  recurringTransactions,
  pianiAccumulo,
  assets,
  cashAvailable,
  formatEuro,
  onNavigateToRecurring,
  onNavigateToPAC,
}) => {
  // Timeframe filter: 'month' (rest of current month), '7days', '30days', '90days'
  const [timeHorizon, setTimeHorizon] = useState<'month' | '7days' | '30days' | '90days'>('month');
  const [typeFilter, setTypeFilter] = useState<'all' | 'expense' | 'income' | 'pac'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Asset name helper
  const assetNameMap = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [assets]);

  // Compute date range
  const { startDate, endDate, horizonTitle } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    let end: Date;
    let title = '';

    if (timeHorizon === 'month') {
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      title = `Questo Mese (fino al ${end.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })})`;
    } else if (timeHorizon === '7days') {
      end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      end.setHours(23, 59, 59, 999);
      title = 'Prossimi 7 Giorni (Urgente)';
    } else if (timeHorizon === '30days') {
      end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
      end.setHours(23, 59, 59, 999);
      title = 'Prossimi 30 Giorni';
    } else {
      end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
      end.setHours(23, 59, 59, 999);
      title = 'Prossimi 90 Giorni (Trimestre)';
    }

    return { startDate: start, endDate: end, horizonTitle: title };
  }, [timeHorizon]);

  // Generate all scheduled items in date range
  const allScheduledItems = useMemo(() => {
    const items: Omit<ScheduleItem, 'runningBalance'>[] = [];
    const todayTimestamp = startDate.getTime();

    // 1. Process active Recurring Transactions
    recurringTransactions.filter((tx) => tx.isActive).forEach((tx) => {
      const txStart = new Date(tx.startDate);
      txStart.setHours(0, 0, 0, 0);

      if (tx.frequency === 'monthly') {
        const targetDay = tx.dayOfMonth || 1;
        // Check for each month between start and end
        let curr = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        while (curr <= endDate) {
          const year = curr.getFullYear();
          const month = curr.getMonth();
          const daysInCurrMonth = new Date(year, month + 1, 0).getDate();
          const actualDay = Math.min(targetDay, daysInCurrMonth);
          const schedDate = new Date(year, month, actualDay, 0, 0, 0, 0);

          if (schedDate >= startDate && schedDate <= endDate && schedDate >= txStart) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
            const diffDays = Math.ceil((schedDate.getTime() - todayTimestamp) / (1000 * 60 * 60 * 24));

            items.push({
              id: `rec-${tx.id}-${dateStr}`,
              dateStr,
              dateObj: schedDate,
              daysRemaining: diffDays,
              name: tx.merchant,
              kind: tx.kind,
              categoryOrAsset: tx.category + (tx.subcategory ? ` · ${tx.subcategory}` : ''),
              account: tx.account || 'Conto predefinito',
              amount: tx.amount,
              note: tx.note,
              autoPost: tx.autoPost,
              sourceType: 'recurring',
            });
          }
          curr = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
        }
      } else if (tx.frequency === 'weekly') {
        const targetDayOfWeek = tx.dayOfWeek ?? 1;
        let curr = new Date(startDate);
        while (curr <= endDate) {
          if (curr.getDay() === targetDayOfWeek && curr >= txStart) {
            const year = curr.getFullYear();
            const month = curr.getMonth();
            const day = curr.getDate();
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const diffDays = Math.ceil((curr.getTime() - todayTimestamp) / (1000 * 60 * 60 * 24));

            items.push({
              id: `rec-${tx.id}-${dateStr}`,
              dateStr,
              dateObj: new Date(curr),
              daysRemaining: diffDays,
              name: tx.merchant,
              kind: tx.kind,
              categoryOrAsset: tx.category + (tx.subcategory ? ` · ${tx.subcategory}` : ''),
              account: tx.account || 'Conto predefinito',
              amount: tx.amount,
              note: tx.note,
              autoPost: tx.autoPost,
              sourceType: 'recurring',
            });
          }
          curr = new Date(curr.getTime() + 24 * 60 * 60 * 1000);
        }
      } else if (tx.frequency === 'custom_days') {
        const interval = Math.max(1, tx.intervalDays || 15);
        let curr = new Date(txStart);
        while (curr <= endDate) {
          if (curr >= startDate) {
            const year = curr.getFullYear();
            const month = curr.getMonth();
            const day = curr.getDate();
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const diffDays = Math.ceil((curr.getTime() - todayTimestamp) / (1000 * 60 * 60 * 24));

            items.push({
              id: `rec-${tx.id}-${dateStr}`,
              dateStr,
              dateObj: new Date(curr),
              daysRemaining: diffDays,
              name: tx.merchant,
              kind: tx.kind,
              categoryOrAsset: tx.category + (tx.subcategory ? ` · ${tx.subcategory}` : ''),
              account: tx.account || 'Conto predefinito',
              amount: tx.amount,
              note: tx.note,
              autoPost: tx.autoPost,
              sourceType: 'recurring',
            });
          }
          curr = new Date(curr.getTime() + interval * 24 * 60 * 60 * 1000);
        }
      }
    });

    // 2. Process active PACs
    pianiAccumulo.filter((pac) => pac.isActive).forEach((pac) => {
      const pacStart = new Date(pac.startDate);
      pacStart.setHours(0, 0, 0, 0);
      const targetDay = pac.dayOfMonth || 1;

      let curr = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      while (curr <= endDate) {
        const year = curr.getFullYear();
        const month = curr.getMonth();
        const daysInCurrMonth = new Date(year, month + 1, 0).getDate();
        const actualDay = Math.min(targetDay, daysInCurrMonth);
        const schedDate = new Date(year, month, actualDay, 0, 0, 0, 0);

        if (schedDate >= startDate && schedDate <= endDate && schedDate >= pacStart) {
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
          const diffDays = Math.ceil((schedDate.getTime() - todayTimestamp) / (1000 * 60 * 60 * 24));
          const assetName = assetNameMap.get(pac.assetId) || 'Asset in Portafoglio';

          items.push({
            id: `pac-${pac.id}-${dateStr}`,
            dateStr,
            dateObj: schedDate,
            daysRemaining: diffDays,
            name: pac.name || `PAC ${assetName}`,
            kind: 'pac',
            categoryOrAsset: `PAC ➔ ${assetName}`,
            account: pac.account || 'Conto principale',
            amount: pac.amount,
            autoPost: pac.autoPost,
            sourceType: 'pac',
          });
        }
        curr = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
      }
    });

    // Sort chronologically
    items.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

    // Calculate running balance
    let running = cashAvailable;
    const finalItems: ScheduleItem[] = items.map((it) => {
      if (it.kind === 'income') {
        running += it.amount;
      } else {
        running -= it.amount;
      }
      return {
        ...it,
        runningBalance: running,
      };
    });

    return finalItems;
  }, [recurringTransactions, pianiAccumulo, startDate, endDate, cashAvailable, assetNameMap]);

  // Totals and KPI calculations
  const totals = useMemo(() => {
    let incomeSum = 0;
    let expenseSum = 0;
    let pacSum = 0;

    allScheduledItems.forEach((it) => {
      if (it.kind === 'income') {
        incomeSum += it.amount;
      } else if (it.kind === 'expense') {
        expenseSum += it.amount;
      } else if (it.kind === 'pac') {
        pacSum += it.amount;
      }
    });

    const netOutflows = expenseSum + pacSum;
    const netScheduledCashflow = incomeSum - netOutflows;
    const projectedEndBalance = cashAvailable + netScheduledCashflow;

    // Lowest running balance point
    let minBalance = cashAvailable;
    allScheduledItems.forEach((it) => {
      if (it.runningBalance < minBalance) {
        minBalance = it.runningBalance;
      }
    });

    return {
      incomeSum,
      expenseSum,
      pacSum,
      netOutflows,
      netScheduledCashflow,
      projectedEndBalance,
      minBalance,
    };
  }, [allScheduledItems, cashAvailable]);

  // Filtered items based on user search and kind filter
  const displayedItems = useMemo(() => {
    return allScheduledItems.filter((it) => {
      if (typeFilter !== 'all' && it.kind !== typeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = it.name.toLowerCase().includes(q);
        const matchCat = it.categoryOrAsset.toLowerCase().includes(q);
        const matchAcc = it.account.toLowerCase().includes(q);
        if (!matchName && !matchCat && !matchAcc) return false;
      }
      return true;
    });
  }, [allScheduledItems, typeFilter, searchQuery]);

  // 3-Month Projection Forecast
  const threeMonthsForecast = useMemo(() => {
    const list = [];
    const now = new Date();

    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const monthLabel = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const lastDay = new Date(year, month + 1, 0).getDate();

      // Estimate monthly recurring incomes
      const monthlyIncome = recurringTransactions
        .filter((tx) => tx.isActive && tx.kind === 'income')
        .reduce((sum, tx) => {
          if (tx.frequency === 'monthly') return sum + tx.amount;
          if (tx.frequency === 'weekly') return sum + tx.amount * 4.33;
          if (tx.frequency === 'custom_days') return sum + (tx.amount * 30) / (tx.intervalDays || 15);
          return sum;
        }, 0);

      // Estimate monthly recurring expenses
      const monthlyExpense = recurringTransactions
        .filter((tx) => tx.isActive && tx.kind === 'expense')
        .reduce((sum, tx) => {
          if (tx.frequency === 'monthly') return sum + tx.amount;
          if (tx.frequency === 'weekly') return sum + tx.amount * 4.33;
          if (tx.frequency === 'custom_days') return sum + (tx.amount * 30) / (tx.intervalDays || 15);
          return sum;
        }, 0);

      // Estimate monthly PACs
      const monthlyPac = pianiAccumulo
        .filter((pac) => pac.isActive)
        .reduce((sum, pac) => sum + pac.amount, 0);

      const netCashflow = monthlyIncome - monthlyExpense - monthlyPac;

      list.push({
        monthLabel,
        monthlyIncome,
        monthlyExpense,
        monthlyPac,
        netCashflow,
      });
    }

    return list;
  }, [recurringTransactions, pianiAccumulo]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner & Navigation to Manage Rules */}
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.25rem' }}>📅</span>
              <p className="panel-title" style={{ margin: 0 }}>Scadenziario &amp; Monitoraggio Liquidità</p>
            </div>
            <h4 style={{ margin: '4px 0 0 0' }}>Previsione Flussi di Cassa e Calendario Scadenze</h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
              Visualizza tutte le entrate, le uscite programmate e i PAC con il saldo stimato progressivo giorno per giorno.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ghost-button"
              onClick={onNavigateToRecurring}
              style={{ fontSize: '0.8rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              🔄 Gestisci Ricorrenti ({recurringTransactions.filter(r => r.isActive).length}) ➔
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={onNavigateToPAC}
              style={{ fontSize: '0.8rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              📈 Gestisci PAC ({pianiAccumulo.filter(p => p.isActive).length}) ➔
            </button>
          </div>
        </div>

        {/* 5 KPI Projection Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            marginTop: '16px',
            marginBottom: '16px',
          }}
        >
          {/* Card 1: Saldo Liquido Attuale */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600 }}>Saldo Liquido Attuale</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              {formatEuro(cashAvailable)}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
              Disponibilità attuale sui conti
            </span>
          </div>

          {/* Card 2: Entrate Attese */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.74rem', color: '#10b981', fontWeight: 600 }}>+ Entrate in Arrivo</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10b981', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              +{formatEuro(totals.incomeSum)}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
              Stipendi e ricavi programmati
            </span>
          </div>

          {/* Card 3: Spese in Scadenza */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.74rem', color: '#fb7185', fontWeight: 600 }}>- Spese &amp; Bollette Fisse</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fb7185', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              -{formatEuro(totals.expenseSum)}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
              Spese ricorrenti da saldare
            </span>
          </div>

          {/* Card 4: PAC Programmati */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.74rem', color: '#38bdf8', fontWeight: 600 }}>- PAC &amp; Investimenti</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#38bdf8', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              -{formatEuro(totals.pacSum)}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
              Quote PAC automatiche previste
            </span>
          </div>

          {/* Card 5: Saldo Finale Stimato */}
          <div
            style={{
              padding: '14px',
              borderRadius: '12px',
              background: totals.projectedEndBalance >= 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(251, 113, 133, 0.12)',
              border: `1px solid ${totals.projectedEndBalance >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(251, 113, 133, 0.4)'}`,
            }}
          >
            <span style={{ fontSize: '0.74rem', color: totals.projectedEndBalance >= 0 ? '#10b981' : '#fb7185', fontWeight: 700 }}>
              = Saldo Finale Stimato
            </span>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: totals.projectedEndBalance >= 0 ? '#10b981' : '#fb7185', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              {formatEuro(totals.projectedEndBalance)}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text)', marginTop: '2px', display: 'block', fontWeight: 600 }}>
              {totals.minBalance < 0
                ? '⚠️ Rischio scoperto transitorio durante il periodo'
                : '✓ Copertura garantita per l\'intero periodo'}
            </span>
          </div>
        </div>

        {/* Safety Alert Banner */}
        <div
          style={{
            padding: '10px 16px',
            borderRadius: '10px',
            background: totals.minBalance >= 500 ? 'rgba(16, 185, 129, 0.1)' : totals.minBalance >= 0 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(251, 113, 133, 0.15)',
            border: `1px solid ${totals.minBalance >= 500 ? 'rgba(16, 185, 129, 0.25)' : totals.minBalance >= 0 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(251, 113, 133, 0.4)'}`,
            color: totals.minBalance >= 500 ? '#10b981' : totals.minBalance >= 0 ? '#f59e0b' : '#fb7185',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '1rem' }}>{totals.minBalance >= 500 ? '🛡️' : totals.minBalance >= 0 ? '⚠️' : '🚨'}</span>
          <span>
            {totals.minBalance >= 500
              ? `Ottimo cuscinetto di liquidità: il saldo non scenderà mai sotto ${formatEuro(totals.minBalance)} durante il periodo selezionato.`
              : totals.minBalance >= 0
              ? `Attenzione al margine di cassa: in un punto del periodo il saldo scenderà a ${formatEuro(totals.minBalance)}.`
              : `Attenzione: è previsto uno scoperto di ${formatEuro(Math.abs(totals.minBalance))} sui conti se non vengono integrati fondi prima delle scadenze.`}
          </span>
        </div>
      </article>

      {/* Interactive Controls & Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        {/* Time Horizons */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, marginRight: '4px' }}>Orizzonte:</span>
          <button
            type="button"
            className="pill"
            onClick={() => setTimeHorizon('month')}
            style={{
              fontSize: '0.78rem',
              padding: '5px 12px',
              background: timeHorizon === 'month' ? 'var(--accent)' : 'var(--overlay-subtle)',
              color: timeHorizon === 'month' ? 'var(--pill-primary-text)' : 'var(--text)',
              fontWeight: timeHorizon === 'month' ? 700 : 500,
            }}
          >
            📅 Questo Mese
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => setTimeHorizon('7days')}
            style={{
              fontSize: '0.78rem',
              padding: '5px 12px',
              background: timeHorizon === '7days' ? 'var(--accent)' : 'var(--overlay-subtle)',
              color: timeHorizon === '7days' ? 'var(--pill-primary-text)' : 'var(--text)',
              fontWeight: timeHorizon === '7days' ? 700 : 500,
            }}
          >
            ⚡ Prossimi 7 Giorni
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => setTimeHorizon('30days')}
            style={{
              fontSize: '0.78rem',
              padding: '5px 12px',
              background: timeHorizon === '30days' ? 'var(--accent)' : 'var(--overlay-subtle)',
              color: timeHorizon === '30days' ? 'var(--pill-primary-text)' : 'var(--text)',
              fontWeight: timeHorizon === '30days' ? 700 : 500,
            }}
          >
            🗓️ Prossimi 30 Giorni
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => setTimeHorizon('90days')}
            style={{
              fontSize: '0.78rem',
              padding: '5px 12px',
              background: timeHorizon === '90days' ? 'var(--accent)' : 'var(--overlay-subtle)',
              color: timeHorizon === '90days' ? 'var(--pill-primary-text)' : 'var(--text)',
              fontWeight: timeHorizon === '90days' ? 700 : 500,
            }}
          >
            📊 Trimestre (90 Giorni)
          </button>
        </div>

        {/* Type Filter & Search Input */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            <option value="all">Tutte le Tipologie ({allScheduledItems.length})</option>
            <option value="expense">Solo Uscite / Bollette ({allScheduledItems.filter(i => i.kind === 'expense').length})</option>
            <option value="income">Solo Entrate ({allScheduledItems.filter(i => i.kind === 'income').length})</option>
            <option value="pac">Solo PAC ({allScheduledItems.filter(i => i.kind === 'pac').length})</option>
          </select>

          <input
            type="text"
            placeholder="Cerca scadenza o conto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              fontSize: '0.8rem',
              width: '180px',
            }}
          />
        </div>
      </div>

      {/* Main Schedule Timeline Table */}
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong style={{ fontSize: '0.95rem' }}>Cronologia Dettagliata delle Scadenze</strong>
            <span style={{ fontSize: '0.78rem', color: 'var(--muted)', marginLeft: '8px' }}>
              ({displayedItems.length} eventi in programma per: {horizonTitle})
            </span>
          </div>
        </div>

        {displayedItems.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Nessuna scadenza trovata per i filtri selezionati nell'orizzonte temporale scelto.
          </div>
        ) : (
          <div className="transaction-table" style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Data Scadenza</th>
                  <th>Descrizione &amp; Fonte</th>
                  <th>Tipologia</th>
                  <th>Categoria / Asset</th>
                  <th>Conto d'Addebito</th>
                  <th style={{ textAlign: 'right' }}>Importo</th>
                  <th style={{ textAlign: 'right' }}>Saldo Stimato Post-Operazione</th>
                </tr>
              </thead>
              <tbody>
                {displayedItems.map((item) => {
                  const isIncome = item.kind === 'income';
                  const isPac = item.kind === 'pac';
                  const isToday = item.daysRemaining === 0;
                  const isTomorrow = item.daysRemaining === 1;
                  const isSoon = item.daysRemaining >= 0 && item.daysRemaining <= 3;

                  return (
                    <tr
                      key={item.id}
                      style={{
                        background: isToday ? 'rgba(245, 158, 11, 0.06)' : isSoon ? 'var(--overlay-subtle)' : 'transparent',
                      }}
                    >
                      {/* Date & Countdown */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '0.7rem',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              background: isToday ? 'rgba(239, 68, 68, 0.15)' : isTomorrow ? 'rgba(245, 158, 11, 0.15)' : 'var(--overlay-medium)',
                              color: isToday ? '#ef4444' : isTomorrow ? '#f59e0b' : 'var(--muted)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isToday ? '🔴 Oggi' : isTomorrow ? '🟠 Domani' : `tra ${item.daysRemaining} gg`}
                          </span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            {item.dateObj.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      </td>

                      {/* Name & Note */}
                      <td>
                        <div>
                          <strong style={{ fontSize: '0.88rem', color: 'var(--text)' }}>{item.name}</strong>
                          {item.note && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'block' }}>
                              {item.note}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Type Badge */}
                      <td>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontWeight: 700,
                            background: isIncome ? 'rgba(16, 185, 129, 0.15)' : isPac ? 'rgba(56, 189, 248, 0.15)' : 'rgba(251, 113, 133, 0.15)',
                            color: isIncome ? '#10b981' : isPac ? '#38bdf8' : '#fb7185',
                          }}
                        >
                          {isIncome ? '💰 Entrata' : isPac ? '📈 PAC Investimento' : '💸 Spesa Fissa'}
                        </span>
                      </td>

                      {/* Category or Asset */}
                      <td style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                        {item.categoryOrAsset}
                      </td>

                      {/* Account */}
                      <td style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                        {item.account}
                      </td>

                      {/* Amount */}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        <strong
                          style={{
                            fontSize: '0.95rem',
                            color: isIncome ? '#10b981' : isPac ? '#38bdf8' : '#fb7185',
                          }}
                        >
                          {isIncome ? `+${formatEuro(item.amount)}` : `-${formatEuro(item.amount)}`}
                        </strong>
                      </td>

                      {/* Running Projected Balance */}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        <span
                          style={{
                            fontSize: '0.88rem',
                            fontWeight: 700,
                            color: item.runningBalance >= 500 ? 'var(--text)' : item.runningBalance >= 0 ? '#f59e0b' : '#fb7185',
                          }}
                        >
                          {formatEuro(item.runningBalance)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* 3-Month Macro Cashflow Forecast Section */}
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>🔮</span>
              <p className="panel-title" style={{ margin: 0 }}>Previsione Flussi di Cassa a 3 Mesi</p>
            </div>
            <h4 style={{ margin: '4px 0 0 0' }}>Stima delle Entrate e Uscite Fisse per i Prossimi Mesi</h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
              Proiezione basata sull'insieme di tutte le transazioni ricorrenti attive e dei piani di accumulo impostati.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          {threeMonthsForecast.map((fc, idx) => (
            <div
              key={`fc-${idx}`}
              style={{
                padding: '16px',
                borderRadius: '14px',
                background: 'var(--panel-card-bg)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <strong style={{ fontSize: '0.95rem', color: 'var(--text)', textTransform: 'capitalize' }}>
                {fc.monthLabel}
              </strong>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--muted)', marginTop: '4px' }}>
                <span>Entrate Fisse Previste:</span>
                <strong style={{ color: '#10b981', fontFamily: 'var(--font-mono)' }}>+{formatEuro(fc.monthlyIncome)}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--muted)' }}>
                <span>Spese Fisse / Uscite:</span>
                <strong style={{ color: '#fb7185', fontFamily: 'var(--font-mono)' }}>-{formatEuro(fc.monthlyExpense)}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--muted)' }}>
                <span>Versamenti PAC:</span>
                <strong style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>-{formatEuro(fc.monthlyPac)}</strong>
              </div>

              <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Flusso Netto Stimato:</span>
                <strong
                  style={{
                    fontSize: '1.05rem',
                    fontFamily: 'var(--font-mono)',
                    color: fc.netCashflow >= 0 ? '#10b981' : '#fb7185',
                  }}
                >
                  {fc.netCashflow >= 0 ? `+${formatEuro(fc.netCashflow)}` : formatEuro(fc.netCashflow)}
                </strong>
              </div>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
};
