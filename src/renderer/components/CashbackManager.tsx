import React, { useState, useMemo } from 'react';

export type CashbackDestination = 'cash' | 'asset';

export type CashbackRule = {
  id: string;
  name: string;
  account: string;
  percentage: number;
  destination: CashbackDestination;
  assetId?: string;
  investmentDayOfMonth: number; // 1-31
  monthlyCap?: number; // max per month, e.g. 15 or undefined/0 for unlimited
  isActive: boolean;
  notes?: string;
  lastInvestedDate?: string; // YYYY-MM-DD
  createdAt: number;
};

export type NewAssetPayload = {
  name: string;
  kind: string;
  institution: string;
  unitValue: number;
  ticker?: string;
};

export type Asset = {
  id: string;
  name: string;
  kind: string;
  institution: string;
  quantity: number;
  unitValue: number;
  ticker?: string;
  note?: string;
  etfSubtype?: string;
};

export type Transaction = {
  id: string;
  date: string;
  merchant: string;
  category: string;
  subcategory?: string;
  account: string;
  amount: number;
  kind: 'expense' | 'income';
  note?: string;
};

interface CashbackManagerProps {
  cashbackRules: CashbackRule[];
  transactions: Transaction[];
  assets: Asset[];
  accountOptions: string[];
  formatEuro: (val: number) => string;
  formatDisplayDate: (dStr: string) => string;
  onAddRule: (rule: Omit<CashbackRule, 'id' | 'createdAt'>, newAsset?: NewAssetPayload) => void;
  onUpdateRule: (id: string, updates: Partial<CashbackRule>, newAsset?: NewAssetPayload) => void;
  onDeleteRule: (id: string) => void;
  onToggleRule: (id: string) => void;
  onExecuteCashback: (rule: CashbackRule, amount: number, qualifyingSpent: number) => void;
}

export function isTransferCategory(category?: string, subcategory?: string): boolean {
  if (!category && !subcategory) return false;
  const cat = (category || '').trim().toLowerCase();
  const sub = (subcategory || '').trim().toLowerCase();
  const keywords = ['trasferimento', 'trasferimenti', 'giroconto', 'giroconti', 'transfer', 'transfers'];
  return keywords.some((kw) => cat.includes(kw) || sub.includes(kw));
}

export const CashbackManager: React.FC<CashbackManagerProps> = ({
  cashbackRules,
  transactions,
  assets,
  accountOptions,
  formatEuro,
  formatDisplayDate,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
  onToggleRule,
  onExecuteCashback,
}) => {
  const currentMonthStr = useMemo(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Form draft state
  const [ruleName, setRuleName] = useState('');
  const [account, setAccount] = useState(accountOptions[0] || 'Trade Republic');
  const [isCustomAccount, setIsCustomAccount] = useState(false);
  const [customAccountName, setCustomAccountName] = useState('');
  const [percentage, setPercentage] = useState('1.0');
  const [monthlyCap, setMonthlyCap] = useState('');
  const [destination, setDestination] = useState<CashbackDestination>('asset');
  const [assetChoice, setAssetChoice] = useState<'existing' | 'new'>('existing');
  const [selectedAssetId, setSelectedAssetId] = useState<string>(assets[0]?.id || '');
  const [investmentDayOfMonth, setInvestmentDayOfMonth] = useState<string>('2');
  const [notes, setNotes] = useState('');

  // New asset sub-form state
  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetKind, setNewAssetKind] = useState('etf_azionario');
  const [newAssetUnitValue, setNewAssetUnitValue] = useState('100');
  const [newAssetTicker, setNewAssetTicker] = useState('');

  // Modal for executing cashback
  const [executingRule, setExecutingRule] = useState<{
    rule: CashbackRule;
    accruedAmount: number;
    qualifyingSpent: number;
    customAmount: string;
  } | null>(null);

  const resetForm = () => {
    setEditingRuleId(null);
    setRuleName('');
    setAccount(accountOptions[0] || 'Trade Republic');
    setIsCustomAccount(false);
    setCustomAccountName('');
    setPercentage('1.0');
    setMonthlyCap('');
    setDestination('asset');
    setAssetChoice('existing');
    setSelectedAssetId(assets[0]?.id || '');
    setInvestmentDayOfMonth('2');
    setNotes('');
    setNewAssetName('');
    setNewAssetKind('etf_azionario');
    setNewAssetUnitValue('100');
    setNewAssetTicker('');
  };

  const handleEditRule = (rule: CashbackRule) => {
    setEditingRuleId(rule.id);
    setRuleName(rule.name);
    if (accountOptions.includes(rule.account)) {
      setAccount(rule.account);
      setIsCustomAccount(false);
    } else {
      setIsCustomAccount(true);
      setCustomAccountName(rule.account);
    }
    setPercentage(String(rule.percentage));
    setMonthlyCap(rule.monthlyCap ? String(rule.monthlyCap) : '');
    setDestination(rule.destination);
    setAssetChoice('existing');
    setSelectedAssetId(rule.assetId || assets[0]?.id || '');
    setInvestmentDayOfMonth(String(rule.investmentDayOfMonth || 2));
    setNotes(rule.notes || '');
  };

  // Preset quick appliers
  const applyPreset = (presetType: 'trade-republic' | 'bbva' | 'crypto' | 'revolut') => {
    if (presetType === 'trade-republic') {
      setRuleName('Trade Republic Saveback');
      setAccount('Trade Republic');
      setPercentage('1.0');
      setMonthlyCap('15');
      setDestination('asset');
      setInvestmentDayOfMonth('2');
      setNotes('1% Saveback investito il 2 del mese su ETF o azioni (massimale 15€/mese)');
    } else if (presetType === 'bbva') {
      setRuleName('BBVA Cashback');
      setAccount('BBVA');
      setPercentage('4.0');
      setMonthlyCap('200');
      setDestination('cash');
      setInvestmentDayOfMonth('1');
      setNotes('Cashback promozionale fino a 200€ al mese accreditato su conto');
    } else if (presetType === 'crypto') {
      setRuleName('Crypto.com Cashback Card');
      setAccount('Crypto.com');
      setPercentage('2.0');
      setMonthlyCap('');
      setDestination('asset');
      setInvestmentDayOfMonth('15');
      setNotes('2% di ricompensa su tutti gli acquisti investito in criptovalute');
      setNewAssetName('Cronos (CRO)');
      setNewAssetKind('cripto');
      setNewAssetUnitValue('0.10');
      setNewAssetTicker('CRO');
    } else if (presetType === 'revolut') {
      setRuleName('Revolut Pro Cashback');
      setAccount('Revolut');
      setPercentage('1.0');
      setMonthlyCap('');
      setDestination('cash');
      setInvestmentDayOfMonth('28');
      setNotes('1% Cashback su tutte le spese della carta Revolut');
    }
  };

  // Calculate live rule statistics
  const ruleStats = useMemo(() => {
    return cashbackRules.map((rule) => {
      // 1. Qualifying spending this month on rule.account
      const matchingTxs = transactions.filter((tx) => {
        if (tx.kind !== 'expense') return false;
        if (!tx.date.startsWith(currentMonthStr)) return false;
        if (isTransferCategory(tx.category, tx.subcategory)) return false;
        if (tx.account?.trim().toLowerCase() !== rule.account.trim().toLowerCase()) return false;
        return true;
      });

      const qualifyingSpent = matchingTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
      let accrued = (qualifyingSpent * rule.percentage) / 100;
      let capReached = false;
      if (rule.monthlyCap && rule.monthlyCap > 0 && accrued >= rule.monthlyCap) {
        accrued = rule.monthlyCap;
        capReached = true;
      }

      // Check if already executed this month
      const alreadyExecutedThisMonth = Boolean(rule.lastInvestedDate && rule.lastInvestedDate.startsWith(currentMonthStr));

      // Calculate next scheduled investment date
      const today = new Date();
      const currentYear = today.getFullYear();
      const currentMonthIndex = today.getMonth(); // 0-11
      const currentDay = today.getDate();

      let schedDate = new Date(currentYear, currentMonthIndex, rule.investmentDayOfMonth);
      if (currentDay > rule.investmentDayOfMonth || alreadyExecutedThisMonth) {
        schedDate = new Date(currentYear, currentMonthIndex + 1, rule.investmentDayOfMonth);
      }
      const schedIso = `${schedDate.getFullYear()}-${String(schedDate.getMonth() + 1).padStart(2, '0')}-${String(schedDate.getDate()).padStart(2, '0')}`;
      
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const startOfSched = new Date(schedDate.getFullYear(), schedDate.getMonth(), schedDate.getDate()).getTime();
      const daysRemaining = Math.max(0, Math.round((startOfSched - startOfToday) / 86400000));

      const targetAsset = assets.find((a) => a.id === rule.assetId);

      return {
        rule,
        qualifyingSpent,
        accrued,
        capReached,
        alreadyExecutedThisMonth,
        schedIso,
        daysRemaining,
        targetAsset,
        matchingTxsCount: matchingTxs.length,
      };
    });
  }, [cashbackRules, transactions, assets, currentMonthStr]);

  // Overall totals for Executive KPIs
  const totalAccruedThisMonth = ruleStats
    .filter((s) => s.rule.isActive)
    .reduce((sum, s) => sum + s.accrued, 0);

  const totalQualifyingSpentThisMonth = ruleStats
    .filter((s) => s.rule.isActive)
    .reduce((sum, s) => sum + s.qualifyingSpent, 0);

  const activeRulesCount = cashbackRules.filter((r) => r.isActive).length;

  const nextExecutionStat = useMemo(() => {
    const activeStats = ruleStats.filter((s) => s.rule.isActive);
    if (activeStats.length === 0) return null;
    return [...activeStats].sort((a, b) => a.daysRemaining - b.daysRemaining)[0];
  }, [ruleStats]);

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAccount = isCustomAccount ? customAccountName.trim() : account.trim();
    if (!finalAccount) {
      alert('Seleziona o inserisci un conto per la regola cashback.');
      return;
    }
    const pctVal = parseFloat(percentage);
    if (isNaN(pctVal) || pctVal <= 0) {
      alert('Inserisci una percentuale valida maggiore di zero.');
      return;
    }
    const capVal = monthlyCap.trim() ? parseFloat(monthlyCap) : undefined;
    const dayVal = parseInt(investmentDayOfMonth, 10) || 2;

    let newAssetPayload: NewAssetPayload | undefined = undefined;
    let targetAssetId = selectedAssetId;

    if (destination === 'asset' && assetChoice === 'new') {
      if (!newAssetName.trim()) {
        alert('Inserisci il nome del nuovo asset da creare.');
        return;
      }
      newAssetPayload = {
        name: newAssetName.trim(),
        kind: newAssetKind,
        institution: finalAccount,
        unitValue: parseFloat(newAssetUnitValue) || 100,
        ticker: newAssetTicker.trim() || undefined,
      };
    }

    if (editingRuleId) {
      onUpdateRule(
        editingRuleId,
        {
          name: ruleName.trim() || `Cashback ${finalAccount}`,
          account: finalAccount,
          percentage: pctVal,
          monthlyCap: capVal,
          destination,
          assetId: destination === 'asset' && assetChoice === 'existing' ? targetAssetId : undefined,
          investmentDayOfMonth: dayVal,
          notes: notes.trim(),
        },
        newAssetPayload
      );
    } else {
      onAddRule(
        {
          name: ruleName.trim() || `Cashback ${finalAccount}`,
          account: finalAccount,
          percentage: pctVal,
          monthlyCap: capVal,
          destination,
          assetId: destination === 'asset' && assetChoice === 'existing' ? targetAssetId : undefined,
          investmentDayOfMonth: dayVal,
          isActive: true,
          notes: notes.trim(),
        },
        newAssetPayload
      );
    }

    resetForm();
  };

  return (
    <div className="cashback-manager-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Executive KPI Grid */}
      <section className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <div className="metric-card" style={{ borderLeftColor: '#10b981' }}>
          <p className="metric-label">Cashback Maturato Questo Mese</p>
          <h3 style={{ color: '#10b981' }}>{formatEuro(totalAccruedThisMonth)}</h3>
          <span className="metric-delta">Somma calcolata sulle spese in corso</span>
        </div>
        <div className="metric-card" style={{ borderLeftColor: '#38bdf8' }}>
          <p className="metric-label">Spese Valide con Cashback</p>
          <h3>{formatEuro(totalQualifyingSpentThisMonth)}</h3>
          <span className="metric-delta">Esclusi trasferimenti e giroconti</span>
        </div>
        <div className="metric-card" style={{ borderLeftColor: 'var(--accent)' }}>
          <p className="metric-label">Regole Attive</p>
          <h3>{activeRulesCount} <small style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>/ {cashbackRules.length}</small></h3>
          <span className="metric-delta">Conti con cashback configurato</span>
        </div>
        <div className="metric-card" style={{ borderLeftColor: '#f59e0b' }}>
          <p className="metric-label">Prossimo Accredito / Investimento</p>
          <h3 style={{ fontSize: '1.15rem' }}>
            {nextExecutionStat ? formatDisplayDate(nextExecutionStat.schedIso) : 'Nessuna regola'}
          </h3>
          <span className="metric-delta">
            {nextExecutionStat
              ? `${nextExecutionStat.rule.account} (tra ${nextExecutionStat.daysRemaining} gg)`
              : 'Configura una regola qui sotto'}
          </span>
        </div>
      </section>

      {/* Main Grid: Form on Left, List on Right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 460px) 1fr', gap: '2rem', alignItems: 'start' }}>
        {/* Left Panel: Form */}
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">
                {editingRuleId ? 'Modifica Regola Cashback' : 'Aggiungi Regola Cashback & Saveback'}
              </p>
              <h4>Configura percentuale, conto e investimento automatico in asset</h4>
            </div>
          </div>

          {/* Quick Presets */}
          <div style={{ padding: '0 0 1rem 0' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
              Modelli rapidi diffusi:
            </span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pill"
                onClick={() => applyPreset('trade-republic')}
                style={{ fontSize: '0.72rem', padding: '4px 10px', background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8' }}
              >
                🚀 Trade Republic (1% Saveback)
              </button>
              <button
                type="button"
                className="pill"
                onClick={() => applyPreset('bbva')}
                style={{ fontSize: '0.72rem', padding: '4px 10px', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}
              >
                💳 BBVA (4% Cashback)
              </button>
              <button
                type="button"
                className="pill"
                onClick={() => applyPreset('crypto')}
                style={{ fontSize: '0.72rem', padding: '4px 10px', background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' }}
              >
                💎 Crypto.com (2% CRO)
              </button>
              <button
                type="button"
                className="pill"
                onClick={() => applyPreset('revolut')}
                style={{ fontSize: '0.72rem', padding: '4px 10px', background: 'rgba(168, 85, 247, 0.12)', color: '#a855f7' }}
              >
                ⚡ Revolut Pro (1%)
              </button>
            </div>
          </div>

          <form className="transaction-form" onSubmit={handleSubmitForm}>
            <div className="form-grid">
              <label className="form-field" style={{ gridColumn: 'span 2' }}>
                <span>Nome della Regola</span>
                <input
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Es. Saveback Trade Republic, Cashback BBVA"
                  required
                />
              </label>

              <label className="form-field" style={{ gridColumn: 'span 2' }}>
                <span>Conto che riconosce il Cashback</span>
                {!isCustomAccount ? (
                  <select
                    value={accountOptions.includes(account) ? account : (account ? '__CUSTOM__' : '')}
                    onChange={(e) => {
                      if (e.target.value === '__NEW__') {
                        setIsCustomAccount(true);
                        setCustomAccountName('');
                      } else {
                        setAccount(e.target.value);
                      }
                    }}
                    required
                  >
                    {accountOptions.map((acc) => (
                      <option key={acc} value={acc}>{acc}</option>
                    ))}
                    {!accountOptions.includes('Trade Republic') && (
                      <option value="Trade Republic">Trade Republic</option>
                    )}
                    {!accountOptions.includes('BBVA') && (
                      <option value="BBVA">BBVA</option>
                    )}
                    {!accountOptions.includes('Crypto.com') && (
                      <option value="Crypto.com">Crypto.com</option>
                    )}
                    <option value="__NEW__" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      + Inserisci nuovo conto...
                    </option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      value={customAccountName}
                      onChange={(e) => setCustomAccountName(e.target.value)}
                      placeholder="Nome del conto (es. Trade Republic)"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      className="pill"
                      onClick={() => setIsCustomAccount(false)}
                      style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                    >
                      Annulla
                    </button>
                  </div>
                )}
              </label>

              <label className="form-field">
                <span>Percentuale Cashback (%)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="100"
                  value={percentage}
                  onChange={(e) => setPercentage(e.target.value)}
                  placeholder="1.0"
                  required
                />
              </label>

              <label className="form-field">
                <span>Massimale Mensile (€ opzionale)</span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={monthlyCap}
                  onChange={(e) => setMonthlyCap(e.target.value)}
                  placeholder="Es. 15 (lascia vuoto per nessun limite)"
                />
              </label>

              <label className="form-field" style={{ gridColumn: 'span 2' }}>
                <span>Giorno del Mese per l'Investimento / Accredito</span>
                <select
                  value={investmentDayOfMonth}
                  onChange={(e) => setInvestmentDayOfMonth(e.target.value)}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Il {d}° del mese {d === 2 ? '(Consigliato Trade Republic Saveback)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {/* Destination Radio Selection */}
              <div style={{ gridColumn: 'span 2', background: 'var(--overlay-subtle)', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 650, color: 'var(--text)', display: 'block', marginBottom: '8px' }}>
                  Destinazione del Cashback Accumulato:
                </span>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.84rem' }}>
                    <input
                      type="radio"
                      name="cashback-destination"
                      value="asset"
                      checked={destination === 'asset'}
                      onChange={() => setDestination('asset')}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <strong style={{ color: destination === 'asset' ? 'var(--accent)' : 'var(--text)' }}>
                      📈 Investi in Asset / Azioni (Saveback)
                    </strong>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.84rem' }}>
                    <input
                      type="radio"
                      name="cashback-destination"
                      value="cash"
                      checked={destination === 'cash'}
                      onChange={() => setDestination('cash')}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span>💰 Accredito come liquidità sul conto</span>
                  </label>
                </div>
              </div>

              {/* Asset Destination Config: Choose Existing or Create New */}
              {destination === 'asset' && (
                <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(56, 189, 248, 0.05)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 650, color: '#38bdf8' }}>
                      Seleziona o crea l'Asset bersaglio:
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="pill"
                        onClick={() => setAssetChoice('existing')}
                        style={{
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          background: assetChoice === 'existing' ? 'var(--accent)' : 'transparent',
                          color: assetChoice === 'existing' ? 'var(--pill-primary-text)' : 'var(--muted)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        Asset Esistente ({assets.length})
                      </button>
                      <button
                        type="button"
                        className="pill"
                        onClick={() => setAssetChoice('new')}
                        style={{
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          background: assetChoice === 'new' ? 'var(--accent)' : 'transparent',
                          color: assetChoice === 'new' ? 'var(--pill-primary-text)' : 'var(--muted)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        + Crea Nuovo Asset
                      </button>
                    </div>
                  </div>

                  {assetChoice === 'existing' ? (
                    assets.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                        Nessun asset presente nel portafoglio. Passa alla scheda "Crea Nuovo Asset" per configurarne uno al volo.
                      </p>
                    ) : (
                      <label className="form-field" style={{ margin: 0 }}>
                        <span>Asset del Portafoglio</span>
                        <select
                          value={selectedAssetId}
                          onChange={(e) => setSelectedAssetId(e.target.value)}
                          required={destination === 'asset' && assetChoice === 'existing'}
                        >
                          {assets.map((ast) => (
                            <option key={ast.id} value={ast.id}>
                              {ast.name} ({ast.kind.toUpperCase()} · {ast.institution || 'Broker'}) · Valore quota: {formatEuro(ast.unitValue)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )
                  ) : (
                    /* Inline New Asset Creation Form */
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
                      <label className="form-field" style={{ gridColumn: 'span 2' }}>
                        <span>Nome del Nuovo Asset</span>
                        <input
                          type="text"
                          value={newAssetName}
                          onChange={(e) => setNewAssetName(e.target.value)}
                          placeholder="Es. iShares Core MSCI World ETF, Apple, Bitcoin"
                          required={destination === 'asset' && assetChoice === 'new'}
                        />
                      </label>
                      <label className="form-field">
                        <span>Tipologia</span>
                        <select
                          value={newAssetKind}
                          onChange={(e) => setNewAssetKind(e.target.value)}
                        >
                          <option value="etf_azionario">ETF Azionario</option>
                          <option value="azioni">Azioni</option>
                          <option value="cripto">Criptovalute</option>
                          <option value="etf_obbligazionario">ETF Obbligazionario</option>
                          <option value="fondo">Fondo Comune</option>
                          <option value="altro">Altro</option>
                        </select>
                      </label>
                      <label className="form-field">
                        <span>Prezzo Quota Stimato (€)</span>
                        <input
                          type="number"
                          step="any"
                          value={newAssetUnitValue}
                          onChange={(e) => setNewAssetUnitValue(e.target.value)}
                          placeholder="100.00"
                          required={destination === 'asset' && assetChoice === 'new'}
                        />
                      </label>
                      <label className="form-field" style={{ gridColumn: 'span 2' }}>
                        <span>Ticker Borsa (facoltativo)</span>
                        <input
                          type="text"
                          value={newAssetTicker}
                          onChange={(e) => setNewAssetTicker(e.target.value)}
                          placeholder="Es. SWDA, AAPL, BTC"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              <label className="form-field" style={{ gridColumn: 'span 2' }}>
                <span>Note & Condizioni (facoltativo)</span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Es. Richiede piano di accumulo attivo di almeno 50€/mese"
                />
              </label>
            </div>

            <div className="form-actions" style={{ marginTop: '1.25rem', display: 'flex', gap: '8px' }}>
              <button className="pill pill-primary" type="submit" style={{ flex: 1 }}>
                {editingRuleId ? 'Aggiorna Regola Cashback' : 'Salva Regola Cashback'}
              </button>
              {editingRuleId && (
                <button className="pill" type="button" onClick={resetForm}>
                  Annulla
                </button>
              )}
            </div>
          </form>
        </article>

        {/* Right Panel: Cashback Rules List & Live Accrual Cards */}
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Regole Cashback & Saveback Configurate</p>
              <h4>
                {cashbackRules.length} regol{cashbackRules.length === 1 ? 'a' : 'e'} ({activeRulesCount} attiv{activeRulesCount === 1 ? 'a' : 'e'})
              </h4>
            </div>
          </div>

          {ruleStats.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.9rem' }}>
              <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '8px' }}>💳</span>
              <p style={{ margin: 0, fontWeight: 600 }}>Nessuna regola di cashback ancora impostata.</p>
              <p style={{ margin: '6px 0 0 0', fontSize: '0.8rem' }}>
                Usa i modelli rapidi sopra (come Trade Republic Saveback o BBVA) per iniziare a tracciare e investire automaticamente il tuo cashback!
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {ruleStats.map((stat) => {
                const { rule, qualifyingSpent, accrued, capReached, alreadyExecutedThisMonth, schedIso, daysRemaining, targetAsset } = stat;

                return (
                  <div
                    key={rule.id}
                    style={{
                      padding: '1.2rem',
                      borderRadius: '14px',
                      border: '1px solid var(--border)',
                      background: rule.isActive ? 'var(--overlay-subtle)' : 'rgba(255, 255, 255, 0.01)',
                      opacity: rule.isActive ? 1 : 0.65,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {/* Top Row: Title, Badges, Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                          <span style={{ fontSize: '1.2rem' }}>
                            {rule.destination === 'asset' ? '📈' : '💰'}
                          </span>
                          <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>
                            {rule.name}
                          </strong>
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '6px',
                              background: 'rgba(52, 211, 153, 0.15)',
                              color: '#34d399',
                            }}
                          >
                            {rule.percentage}% {rule.destination === 'asset' ? 'Saveback' : 'Cashback'}
                          </span>
                          <span
                            style={{
                              fontSize: '0.72rem',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              background: 'var(--overlay-subtle)',
                              color: 'var(--muted)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            Conto: {rule.account}
                          </span>
                        </div>

                        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                          {rule.destination === 'asset' ? (
                            <>
                              Destinazione: <strong>{targetAsset ? targetAsset.name : 'Asset non trovato'}</strong> · Investito il <strong>{rule.investmentDayOfMonth}°</strong> di ogni mese
                            </>
                          ) : (
                            <>
                              Destinazione: <strong>Accredito su {rule.account}</strong> · Accreditato il <strong>{rule.investmentDayOfMonth}°</strong> di ogni mese
                            </>
                          )}
                          {rule.monthlyCap ? ` · Cap: ${formatEuro(rule.monthlyCap)}/mese` : ''}
                        </p>
                        {rule.notes && (
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.74rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                            {rule.notes}
                          </p>
                        )}
                      </div>

                      {/* Right top: Accrued Cashback Value */}
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Maturato questo mese
                        </span>
                        <strong style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)', color: '#10b981' }}>
                          {formatEuro(accrued)}
                        </strong>
                        {capReached && (
                          <span style={{ fontSize: '0.65rem', color: '#f59e0b', display: 'block', fontWeight: 600 }}>
                            Massimale mensile raggiunto
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle Row: Progress and Spending breakdown */}
                    <div style={{ background: 'rgba(0, 0, 0, 0.12)', padding: '10px 14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ fontSize: '0.78rem' }}>
                        <span style={{ color: 'var(--muted)' }}>Spese valide sul conto questo mese: </span>
                        <strong>{formatEuro(qualifyingSpent)}</strong>
                        <span style={{ color: 'var(--muted)', fontSize: '0.72rem', marginLeft: '6px' }}>
                          ({stat.matchingTxsCount} pagament{stat.matchingTxsCount === 1 ? 'o' : 'i'})
                        </span>
                      </div>

                      <div style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: 'var(--muted)' }}>Prossima data:</span>
                        <strong>{formatDisplayDate(schedIso)}</strong>
                        <span style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: '4px', background: daysRemaining <= 3 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.08)', color: daysRemaining <= 3 ? '#f59e0b' : 'var(--muted)' }}>
                          {daysRemaining === 0 ? 'Oggi' : `Tra ${daysRemaining} gg`}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Actions Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', paddingTop: '4px' }}>
                      {/* Left: Quick Execution button */}
                      <button
                        className="pill"
                        type="button"
                        onClick={() => {
                          setExecutingRule({
                            rule,
                            accruedAmount: accrued > 0 ? accrued : (rule.monthlyCap || 15),
                            qualifyingSpent,
                            customAmount: (accrued > 0 ? accrued : (rule.monthlyCap || 15)).toFixed(2),
                          });
                        }}
                        style={{
                          padding: '6px 14px',
                          fontSize: '0.78rem',
                          fontWeight: 650,
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#10b981',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          cursor: 'pointer',
                        }}
                        title="Registra immediatamente il cashback maturato come entrata o acquisto di quote"
                      >
                        <span>⚡</span>
                        {rule.destination === 'asset' ? 'Investi Saveback Ora' : 'Accredita Cashback Ora'}
                        {accrued > 0 ? ` (${formatEuro(accrued)})` : ''}
                      </button>

                      {/* Right: State toggle, edit, delete */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {alreadyExecutedThisMonth && (
                          <span style={{ fontSize: '0.72rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '3px 8px', borderRadius: '6px' }}>
                            ✓ Registrato il {formatDisplayDate(rule.lastInvestedDate!)}
                          </span>
                        )}

                        <button
                          className="pill"
                          type="button"
                          onClick={() => onToggleRule(rule.id)}
                          style={{
                            padding: '4px 10px',
                            fontSize: '0.72rem',
                            background: rule.isActive ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                            color: rule.isActive ? '#34d399' : 'var(--muted)',
                          }}
                        >
                          {rule.isActive ? 'Attivo' : 'In Pausa'}
                        </button>

                        <button
                          className="pill"
                          type="button"
                          onClick={() => handleEditRule(rule)}
                          style={{
                            padding: '4px 10px',
                            fontSize: '0.72rem',
                            background: editingRuleId === rule.id ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                            color: editingRuleId === rule.id ? 'var(--pill-primary-text)' : 'var(--text)',
                          }}
                        >
                          Modifica
                        </button>

                        <button
                          className="pill"
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Eliminare la regola cashback "${rule.name}"?`)) {
                              onDeleteRule(rule.id);
                            }
                          }}
                          style={{
                            padding: '4px 10px',
                            fontSize: '0.72rem',
                            background: 'rgba(251, 113, 133, 0.12)',
                            color: '#fb7185',
                          }}
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
        </article>
      </div>

      {/* Confirmation Modal for Executing Cashback Now */}
      {executingRule && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={() => setExecutingRule(null)}
        >
          <div
            style={{
              background: 'var(--panel-card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.5rem' }}>⚡</span>
              <div>
                <strong style={{ fontSize: '1.1rem', color: 'var(--text)' }}>
                  {executingRule.rule.destination === 'asset'
                    ? 'Investi Cashback in Asset (Saveback)'
                    : 'Accredita Cashback come Liquidità'}
                </strong>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                  Regola: {executingRule.rule.name} ({executingRule.rule.account})
                </p>
              </div>
            </div>

            <div style={{ background: 'var(--overlay-subtle)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)', fontSize: '0.84rem' }}>
              <p style={{ margin: '0 0 8px 0', color: 'var(--muted)' }}>
                Spese qualificanti del periodo sul conto: <strong>{formatEuro(executingRule.qualifyingSpent)}</strong>
              </p>
              <label className="form-field" style={{ margin: 0 }}>
                <span>Importo Cashback da Accreditare / Investire (€)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={executingRule.customAmount}
                  onChange={(e) => setExecutingRule({ ...executingRule, customAmount: e.target.value })}
                  style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                  required
                />
              </label>
            </div>

            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', lineHeight: '1.4' }}>
              {executingRule.rule.destination === 'asset' ? (
                <>
                  Verrà registrata un'entrata di cashback su <strong>{executingRule.rule.account}</strong> e contestualmente generato l'acquisto quote nell'asset associato nel tuo portafoglio.
                </>
              ) : (
                <>
                  Verrà registrata un'entrata di accredito cashback su <strong>{executingRule.rule.account}</strong> nella categoria "Entrate ➔ Cashback".
                </>
              )}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button
                type="button"
                className="pill"
                onClick={() => setExecutingRule(null)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="pill pill-primary"
                onClick={() => {
                  const amt = parseFloat(executingRule.customAmount);
                  if (isNaN(amt) || amt <= 0) {
                    alert('Inserisci un importo valido.');
                    return;
                  }
                  onExecuteCashback(executingRule.rule, amt, executingRule.qualifyingSpent);
                  setExecutingRule(null);
                }}
              >
                Conferma ed Esegui Subito
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
