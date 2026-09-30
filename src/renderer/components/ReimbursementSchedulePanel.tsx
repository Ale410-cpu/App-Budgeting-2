import React, { useState, useMemo } from 'react';

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

type ReimbursementStatus = 'pending' | 'partial' | 'reimbursed';

type ReimbursementInfo = {
  totalReimbursed: number;
  remainingAmount: number;
  status: ReimbursementStatus;
  refunds: Transaction[];
};

interface ReimbursementSchedulePanelProps {
  transactions: Transaction[];
  reimbursementMap: Map<string, ReimbursementInfo>;
  formatEuro: (val: number) => string;
  formatDisplayDate: (dStr: string) => string;
  onStartReimbursement: (expense: Transaction, remainingAmount: number) => void;
  onUpdateDueDate: (expenseId: string, newDueDate: string) => void;
  onClose: () => void;
}

export const ReimbursementSchedulePanel: React.FC<ReimbursementSchedulePanelProps> = ({
  transactions,
  reimbursementMap,
  formatEuro,
  formatDisplayDate,
  onStartReimbursement,
  onUpdateDueDate,
  onClose,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'overdue' | 'dueSoon' | 'noDate'>('all');
  const [copyFeedbackId, setCopyFeedbackId] = useState<string | null>(null);

  // Filter only candidate expenses that are still pending or partial
  const candidateExpenses = useMemo(() => {
    return transactions.filter((tx) => {
      if (tx.kind !== 'expense' || !tx.needsReimbursement) return false;
      const info = reimbursementMap.get(tx.id);
      return !info || info.status === 'pending' || info.status === 'partial';
    });
  }, [transactions, reimbursementMap]);

  // Compute days until/since due date or expense date
  const processedItems = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return candidateExpenses.map((tx) => {
      const info = reimbursementMap.get(tx.id);
      const remainingAmount = info ? info.remainingAmount : Math.abs(tx.amount);
      const alreadyReimbursed = info ? info.totalReimbursed : 0;

      // Expense date diff
      const expDate = new Date(tx.date);
      expDate.setHours(0, 0, 0, 0);
      const daysSinceExpense = Math.floor((today.getTime() - expDate.getTime()) / (1000 * 60 * 60 * 24));

      // Due date diff
      let daysUntilDue: number | null = null;
      let isOverdue = false;
      let isDueSoon = false;

      if (tx.reimbursementDueDate) {
        const dueDate = new Date(tx.reimbursementDueDate);
        dueDate.setHours(0, 0, 0, 0);
        daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilDue < 0) isOverdue = true;
        else if (daysUntilDue <= 7) isDueSoon = true;
      }

      return {
        tx,
        remainingAmount,
        alreadyReimbursed,
        daysSinceExpense,
        daysUntilDue,
        isOverdue,
        isDueSoon,
        hasDueDate: Boolean(tx.reimbursementDueDate),
      };
    }).sort((a, b) => {
      // Prioritize overdue, then due soon, then by expense date
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      if (a.daysUntilDue !== null && b.daysUntilDue !== null) return a.daysUntilDue - b.daysUntilDue;
      return b.tx.date.localeCompare(a.tx.date);
    });
  }, [candidateExpenses, reimbursementMap]);

  // Stats
  const stats = useMemo(() => {
    let totalPending = 0;
    let overdueCount = 0;
    let dueSoonCount = 0;

    processedItems.forEach((item) => {
      totalPending += item.remainingAmount;
      if (item.isOverdue) overdueCount++;
      if (item.isDueSoon) dueSoonCount++;
    });

    return {
      totalPending,
      pendingCount: processedItems.length,
      overdueCount,
      dueSoonCount,
    };
  }, [processedItems]);

  const filteredItems = useMemo(() => {
    return processedItems.filter((item) => {
      if (filterType === 'overdue') return item.isOverdue;
      if (filterType === 'dueSoon') return item.isDueSoon;
      if (filterType === 'noDate') return !item.hasDueDate;
      return true;
    });
  }, [processedItems, filterType]);

  const handleCopyReminder = (item: typeof processedItems[0]) => {
    const text = `Ciao! Ti ricordo la quota di spesa di ${formatEuro(item.remainingAmount)} per "${item.tx.merchant || item.tx.category}" effettuata in data ${formatDisplayDate(item.tx.date)}${item.tx.note ? ` (${item.tx.note})` : ''}. Fammi sapere quando puoi provvedere al rimborso, grazie!`;
    navigator.clipboard.writeText(text);
    setCopyFeedbackId(item.tx.id);
    setTimeout(() => setCopyFeedbackId(null), 2500);
  };

  return (
    <article className="panel large-panel" style={{ margin: 0, border: '1px solid var(--accent)', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
      {/* Header */}
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.1rem' }}>📅</span>
            <p className="panel-title" style={{ margin: 0 }}>Scadenzario e Sollecito Rimborsi</p>
          </div>
          <h4 style={{ margin: '4px 0 0 0' }}>
            {stats.pendingCount} {stats.pendingCount === 1 ? 'spesa in attesa' : 'spese in attesa'} di rimborso ({formatEuro(stats.totalPending)})
          </h4>
        </div>

        <button
          type="button"
          className="ghost-button"
          onClick={onClose}
          style={{ fontSize: '0.8rem', padding: '5px 12px' }}
        >
          ✕ Chiudi Scadenzario
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={{ padding: '12px', borderRadius: '10px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>Totale da Incassare</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#38bdf8', marginTop: '2px' }}>
            {formatEuro(stats.totalPending)}
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Crediti verso terzi</span>
        </div>

        <div style={{ padding: '12px', borderRadius: '10px', background: stats.overdueCount > 0 ? 'rgba(239, 68, 68, 0.12)' : 'var(--panel-card-bg)', border: stats.overdueCount > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.72rem', color: stats.overdueCount > 0 ? '#f87171' : 'var(--muted)', fontWeight: 600 }}>In Ritardo (Scaduti)</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: stats.overdueCount > 0 ? '#f87171' : 'var(--text)', marginTop: '2px' }}>
            {stats.overdueCount}
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Oltre la data concordata</span>
        </div>

        <div style={{ padding: '12px', borderRadius: '10px', background: stats.dueSoonCount > 0 ? 'rgba(245, 158, 11, 0.12)' : 'var(--panel-card-bg)', border: stats.dueSoonCount > 0 ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.72rem', color: stats.dueSoonCount > 0 ? '#f59e0b' : 'var(--muted)', fontWeight: 600 }}>In Scadenza (Prossimi 7 gg)</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: stats.dueSoonCount > 0 ? '#f59e0b' : 'var(--text)', marginTop: '2px' }}>
            {stats.dueSoonCount}
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Da incassare a breve</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: `Tutte (${processedItems.length})` },
          { id: 'overdue', label: `⚠️ Scaduti in ritardo (${stats.overdueCount})` },
          { id: 'dueSoon', label: `⏳ In scadenza (${stats.dueSoonCount})` },
          { id: 'noDate', label: `Senza data di scadenza` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterType(tab.id as any)}
            style={{
              padding: '5px 12px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: '1px solid',
              background: filterType === tab.id ? 'var(--accent)' : 'var(--overlay-subtle)',
              borderColor: filterType === tab.id ? 'var(--accent)' : 'var(--border)',
              color: filterType === tab.id ? 'var(--pill-primary-text)' : 'var(--muted)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {filteredItems.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
          Nessuna spesa da rimborsare corrisponde al filtro selezionato.
        </div>
      ) : (
        <div className="transaction-table" style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Spesa / Esercente</th>
                <th>Data Pagamento</th>
                <th>Scadenza Prevista</th>
                <th>Stato Tempistica</th>
                <th style={{ textAlign: 'right' }}>Importo Residuo</th>
                <th style={{ textAlign: 'right' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.tx.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong style={{ fontSize: '0.86rem' }}>{item.tx.merchant || item.tx.category}</strong>
                      <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                        {item.tx.category} {item.tx.subcategory ? `· ${item.tx.subcategory}` : ''}
                      </span>
                      {item.tx.note && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                          {item.tx.note}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {formatDisplayDate(item.tx.date)}
                    <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                      {item.daysSinceExpense} gg fa
                    </div>
                  </td>
                  <td>
                    <input
                      type="date"
                      value={item.tx.reimbursementDueDate || ''}
                      onChange={(e) => onUpdateDueDate(item.tx.id, e.target.value)}
                      title="Imposta o modifica la data entro cui concordato il rimborso"
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--input-bg)',
                        color: 'var(--text)',
                        fontSize: '0.76rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </td>
                  <td>
                    {item.isOverdue ? (
                      <span style={{ color: '#f87171', fontWeight: 650, fontSize: '0.75rem' }}>
                        ⚠️ Scaduto da {Math.abs(item.daysUntilDue!)} gg
                      </span>
                    ) : item.isDueSoon ? (
                      <span style={{ color: '#f59e0b', fontWeight: 650, fontSize: '0.75rem' }}>
                        ⏳ Scade tra {item.daysUntilDue} gg
                      </span>
                    ) : item.daysUntilDue !== null ? (
                      <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                        tra {item.daysUntilDue} gg
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>
                        Nessuna data
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <strong style={{ color: '#38bdf8', fontSize: '0.92rem', fontFamily: 'var(--font-mono)' }}>
                        {formatEuro(item.remainingAmount)}
                      </strong>
                      {item.alreadyReimbursed > 0 && (
                        <span style={{ fontSize: '0.68rem', color: '#10b981' }}>
                          incassati {formatEuro(item.alreadyReimbursed)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="ghost-button"
                        style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                        onClick={() => handleCopyReminder(item)}
                        title="Copia promemoria amichevole per WhatsApp/email"
                      >
                        {copyFeedbackId === item.tx.id ? '✓ Copiato!' : '📋 Promemoria'}
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '6px' }}
                        onClick={() => onStartReimbursement(item.tx, item.remainingAmount)}
                        title="Registra l'incasso del rimborso"
                      >
                        + Ricevi rimborso
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
};
