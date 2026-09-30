import React, { useState, useMemo } from 'react';

export type SubscriptionFrequency = 'monthly' | 'yearly' | 'quarterly' | 'semiannual';

export type Subscription = {
  id: string;
  name: string;
  amount: number;
  frequency: SubscriptionFrequency;
  category: string;
  account: string;
  nextRenewalDate: string; // YYYY-MM-DD
  status: 'active' | 'paused' | 'cancelled';
  notes?: string;
  createdAt: number;
};

interface SubscriptionsManagerProps {
  subscriptions: Subscription[];
  categoryOptions: string[];
  accountOptions: string[];
  formatEuro: (val: number) => string;
  onAddSubscription: (sub: Omit<Subscription, 'id' | 'createdAt'>) => void;
  onUpdateSubscription: (id: string, updates: Partial<Subscription>) => void;
  onDeleteSubscription: (id: string) => void;
  onRecordTransactionForSubscription: (sub: Subscription) => void;
}

export const SubscriptionsManager: React.FC<SubscriptionsManagerProps> = ({
  subscriptions,
  categoryOptions,
  accountOptions,
  formatEuro,
  onAddSubscription,
  onUpdateSubscription,
  onDeleteSubscription,
  onRecordTransactionForSubscription,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);

  // Form draft state
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<SubscriptionFrequency>('monthly');
  const [category, setCategory] = useState('Abbonamenti');
  const [account, setAccount] = useState(accountOptions[0] || 'Conto principale');
  const [nextRenewalDate, setNextRenewalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const resetForm = () => {
    setName('');
    setAmount('');
    setFrequency('monthly');
    setCategory('Abbonamenti');
    setAccount(accountOptions[0] || 'Conto principale');
    setNextRenewalDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setEditingSub(null);
    setShowAddModal(false);
  };

  const handleOpenEdit = (sub: Subscription) => {
    setEditingSub(sub);
    setName(sub.name);
    setAmount(String(sub.amount));
    setFrequency(sub.frequency);
    setCategory(sub.category);
    setAccount(sub.account);
    setNextRenewalDate(sub.nextRenewalDate);
    setNotes(sub.notes || '');
    setShowAddModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount.replace(',', '.')) || 0;
    if (!name.trim() || val <= 0) return;

    if (editingSub) {
      onUpdateSubscription(editingSub.id, {
        name: name.trim(),
        amount: val,
        frequency,
        category: category.trim() || 'Abbonamenti',
        account: account.trim(),
        nextRenewalDate,
        notes: notes.trim(),
      });
    } else {
      onAddSubscription({
        name: name.trim(),
        amount: val,
        frequency,
        category: category.trim() || 'Abbonamenti',
        account: account.trim(),
        nextRenewalDate,
        status: 'active',
        notes: notes.trim(),
      });
    }

    resetForm();
  };

  // Metrics
  const stats = useMemo(() => {
    let monthlyTotal = 0;
    let yearlyTotal = 0;
    let activeCount = 0;
    let pausedCount = 0;

    for (const sub of subscriptions) {
      if (sub.status === 'active') {
        activeCount++;
        let mVal = sub.amount;
        if (sub.frequency === 'yearly') mVal = sub.amount / 12;
        else if (sub.frequency === 'quarterly') mVal = sub.amount / 3;
        else if (sub.frequency === 'semiannual') mVal = sub.amount / 6;

        monthlyTotal += mVal;
        yearlyTotal += mVal * 12;
      } else if (sub.status === 'paused') {
        pausedCount++;
      }
    }

    return {
      monthlyTotal,
      yearlyTotal,
      activeCount,
      pausedCount,
      totalCount: subscriptions.length,
    };
  }, [subscriptions]);

  const filteredSubscriptions = useMemo(() => {
    return subscriptions
      .filter((s) => {
        if (filterStatus === 'active') return s.status === 'active';
        if (filterStatus === 'paused') return s.status === 'paused';
        if (filterStatus === 'cancelled') return s.status === 'cancelled';
        return true;
      })
      .sort((a, b) => {
        // Sort by next renewal date ascending
        return (a.nextRenewalDate || '').localeCompare(b.nextRenewalDate || '');
      });
  }, [subscriptions, filterStatus]);

  // Days remaining calculation helper
  const getDaysRemaining = (dateStr: string) => {
    if (!dateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    const diffTime = target.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getFrequencyLabel = (freq: SubscriptionFrequency) => {
    switch (freq) {
      case 'monthly': return 'Mensile';
      case 'yearly': return 'Annuale';
      case 'quarterly': return 'Trimestrale';
      case 'semiannual': return 'Semestrale';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Metric Cards */}
      <section className="metric-grid">
        <div className="metric-card">
          <p className="metric-label">Spesa Fissa Mensile Abbonamenti</p>
          <h3>{formatEuro(stats.monthlyTotal)}/mese</h3>
          <span className="metric-delta">{stats.activeCount} abbonamenti attivi</span>
        </div>

        <div className="metric-card" style={{ borderLeftColor: 'var(--accent)' }}>
          <p className="metric-label">Costo Annualizzato Complessivo</p>
          <h3>{formatEuro(stats.yearlyTotal)}/anno</h3>
          <span className="metric-delta">Incidenza annuale delle ricorrenze</span>
        </div>

        <div className="metric-card" style={{ borderLeftColor: 'var(--warning)' }}>
          <p className="metric-label">In Pausa / Sospesi</p>
          <h3>{stats.pausedCount}</h3>
          <span className="metric-delta">Servizi temporaneamente disattivati</span>
        </div>
      </section>

      {/* Main Panel */}
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <p className="panel-title">Gestione Abbonamenti e Servizi Fissi</p>
            <h4>Scadenziario dei rinnovi periodici (streaming, utenze, palestra, software)</h4>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Filter pills */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--overlay-subtle)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {[
                { id: 'all', label: 'Tutti' },
                { id: 'active', label: 'Solo Attivi' },
                { id: 'paused', label: 'In Pausa' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilterStatus(item.id)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: filterStatus === item.id ? 'var(--accent)' : 'transparent',
                    color: filterStatus === item.id ? 'var(--pill-primary-text)' : 'var(--muted)',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="primary-button"
              onClick={() => {
                resetForm();
                setShowAddModal(true);
              }}
              style={{ fontSize: '0.8rem', padding: '6px 14px' }}
            >
              + Nuovo Abbonamento
            </button>
          </div>
        </div>

        {/* Subscriptions Table */}
        {filteredSubscriptions.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
            Nessun abbonamento presente. Clicca su "+ Nuovo Abbonamento" per iniziare a tracciare i tuoi servizi periodici.
          </div>
        ) : (
          <div className="transaction-table" style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Servizio / Abbonamento</th>
                  <th>Cadenza</th>
                  <th>Conto di Addebito</th>
                  <th style={{ textAlign: 'right' }}>Importo per Ciclo</th>
                  <th style={{ textAlign: 'right' }}>Costo Mensile</th>
                  <th>Prossimo Rinnovo</th>
                  <th style={{ textAlign: 'center' }}>Stato</th>
                  <th style={{ textAlign: 'right' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubscriptions.map((sub) => {
                  const daysLeft = getDaysRemaining(sub.nextRenewalDate);
                  const isSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 5;
                  const isOverdue = daysLeft !== null && daysLeft < 0;

                  let monthlyEquiv = sub.amount;
                  if (sub.frequency === 'yearly') monthlyEquiv = sub.amount / 12;
                  else if (sub.frequency === 'quarterly') monthlyEquiv = sub.amount / 3;
                  else if (sub.frequency === 'semiannual') monthlyEquiv = sub.amount / 6;

                  return (
                    <tr key={sub.id} style={{ opacity: sub.status === 'paused' ? 0.65 : 1 }}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <strong style={{ fontSize: '0.88rem' }}>{sub.name}</strong>
                          <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{sub.category}</span>
                          {sub.notes && (
                            <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                              {sub.notes}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text)' }}>
                          {getFrequencyLabel(sub.frequency)}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>
                          {sub.account}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {formatEuro(sub.amount)}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        {formatEuro(monthlyEquiv)}/m
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {sub.nextRenewalDate}
                          </span>
                          {daysLeft !== null && (
                            <span
                              style={{
                                fontSize: '0.68rem',
                                fontWeight: 600,
                                color: isOverdue ? '#fb7185' : isSoon ? '#f59e0b' : 'var(--muted)',
                              }}
                            >
                              {daysLeft === 0
                                ? '⚠️ Rinnovo oggi!'
                                : daysLeft === 1
                                ? '⚠️ Rinnovo domani!'
                                : daysLeft < 0
                                ? `Scaduto da ${Math.abs(daysLeft)} gg`
                                : `tra ${daysLeft} giorni`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => {
                            const nextStatus = sub.status === 'active' ? 'paused' : 'active';
                            onUpdateSubscription(sub.id, { status: nextStatus });
                          }}
                          style={{
                            fontSize: '0.7rem',
                            padding: '3px 8px',
                            borderRadius: '999px',
                            fontWeight: 650,
                            cursor: 'pointer',
                            border: '1px solid',
                            background: sub.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            borderColor: sub.status === 'active' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)',
                            color: sub.status === 'active' ? '#10b981' : '#f59e0b',
                          }}
                          title="Clicca per mettere in pausa o riattivare"
                        >
                          {sub.status === 'active' ? '✓ Attivo' : '⏸ In Pausa'}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="ghost-button"
                            style={{ fontSize: '0.72rem', padding: '3px 8px', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.3)' }}
                            onClick={() => onRecordTransactionForSubscription(sub)}
                            title="Registra subito l'uscita nelle transazioni del mese"
                          >
                            + Registra
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                            onClick={() => handleOpenEdit(sub)}
                          >
                            Modifica
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            style={{ fontSize: '0.72rem', padding: '3px 8px', color: '#fb7185', borderColor: 'rgba(251, 113, 133, 0.25)' }}
                            title="Elimina abbonamento"
                            onClick={() => onDeleteSubscription(sub.id)}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* Modal / Form Add/Edit */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) resetForm();
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '520px',
              background: 'var(--panel-strong)',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow)',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text)' }}>
                {editingSub ? 'Modifica Abbonamento' : 'Aggiungi Nuovo Abbonamento'}
              </h3>
              <button
                type="button"
                onClick={resetForm}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Nome Servizio</span>
                <input
                  type="text"
                  required
                  placeholder="Es. Netflix, Spotify, Amazon Prime, Palestra"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Importo (€)</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Es. 12.99"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Frequenza</span>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as SubscriptionFrequency)}
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                  >
                    <option value="monthly">Mensile</option>
                    <option value="yearly">Annuale</option>
                    <option value="quarterly">Trimestrale</option>
                    <option value="semiannual">Semestrale</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Categoria</span>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Es. Abbonamenti"
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Conto di Addebito</span>
                  <input
                    type="text"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="Es. Carta di credito"
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                  />
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Data Prossimo Rinnovo</span>
                <input
                  type="date"
                  required
                  value={nextRenewalDate}
                  onChange={(e) => setNextRenewalDate(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Note (Opzionale)</span>
                <input
                  type="text"
                  placeholder="Es. Piano famiglia 4 account, include 4K"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" className="ghost-button" onClick={resetForm}>
                  Annulla
                </button>
                <button type="submit" className="primary-button">
                  {editingSub ? 'Salva Modifiche' : 'Crea Abbonamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
