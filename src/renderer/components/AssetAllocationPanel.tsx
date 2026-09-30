import React, { useState, useMemo } from 'react';

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

export type AssetTransaction = {
  id: string;
  assetId: string;
  date: string;
  kind: 'buy' | 'sell';
  quantity: number;
  unitValue: number;
};

export type TickerPriceData = {
  price: number;
  currency: string;
};

export interface AssetAllocationPanelProps {
  assets: Asset[];
  assetTransactions?: AssetTransaction[];
  tickerData?: Record<string, TickerPriceData>;
  getAssetCurrentQuantity?: (asset: Asset) => number;
  cashAvailable: number;
  formatEuro: (val: number) => string;
  onUpdateAsset?: (asset: Asset) => void;
}

const STORAGE_KEY_TARGETS = 'budget-ledger-macro-targets-v3';

// Default targets: ETF azionari count as Azioni, ETF obbligazionari count as Obbligazioni
const DEFAULT_MACRO_TARGETS: Record<string, number> = {
  'Azioni': 60,
  'Obbligazioni': 30,
  'Liquidità': 10,
};

const MACRO_COLORS: Record<string, string> = {
  'Azioni': '#3b82f6',        // Blue for Equity & Equity ETFs
  'Obbligazioni': '#10b981',  // Emerald for Bonds & Bond ETFs
  'Liquidità': '#06b6d4',    // Cyan for Cash & Liquidity
  'Cripto': '#f59e0b',        // Amber for Crypto
  'Immobili': '#ec4899',      // Pink for Real Estate
  'Altro': '#8b5cf6',         // Violet for Other
};

export function isAssetBondEtf(asset: Asset): boolean {
  if (asset.kind === 'etf_obbligazionario' || asset.etfSubtype === 'obbligazionario') {
    return true;
  }
  if (asset.kind === 'etf_azionario' || asset.etfSubtype === 'azionario') {
    return false;
  }
  if (asset.kind === 'etf') {
    const text = `${asset.name} ${asset.ticker || ''}`.toLowerCase();
    return /bond|obbligaz|treasury|bpt|bund|fixed income|gov|tips|yield|xeon|aggh|agg/i.test(text);
  }
  return false;
}

export function isAssetEquityEtf(asset: Asset): boolean {
  if (asset.kind === 'etf_azionario' || asset.etfSubtype === 'azionario') {
    return true;
  }
  if (asset.kind === 'etf_obbligazionario' || asset.etfSubtype === 'obbligazionario') {
    return false;
  }
  if (asset.kind === 'etf') {
    return !isAssetBondEtf(asset);
  }
  return false;
}

export const AssetAllocationPanel: React.FC<AssetAllocationPanelProps> = ({
  assets,
  tickerData = {},
  getAssetCurrentQuantity,
  cashAvailable,
  formatEuro,
  onUpdateAsset,
}) => {
  const [macroTargets, setMacroTargets] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TARGETS);
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_MACRO_TARGETS;
  });

  const [viewMode, setViewMode] = useState<'macro' | 'detailed'>('macro');
  const [newCashToInvest, setNewCashToInvest] = useState<string>('500');
  const [isEditingTargets, setIsEditingTargets] = useState<boolean>(false);
  const [tempTargets, setTempTargets] = useState<Record<string, number>>(macroTargets);

  // Helper to compute live value of an individual asset
  const getAssetVal = (a: Asset) => {
    const qty = getAssetCurrentQuantity ? getAssetCurrentQuantity(a) : a.quantity;
    const tickerClean = a.ticker ? a.ticker.toUpperCase() : '';
    const tData = tickerClean ? tickerData[tickerClean] : null;
    const price = tData && typeof tData.price === 'number' ? tData.price : a.unitValue;
    return Math.max(0, qty) * price;
  };

  // Group portfolio with ETF Azionari -> Azioni and ETF Obbligazionari -> Obbligazioni
  const allocation = useMemo(() => {
    // 1. Compute components
    let valAzioniDirect = 0;
    let valEtfAzionari = 0;
    const itemsAzioniDirect: { name: string; val: number; ticker?: string }[] = [];
    const itemsEtfAzionari: { name: string; val: number; ticker?: string; id: string; asset: Asset }[] = [];

    let valObbligazioniDirect = 0;
    let valEtfObbligazionari = 0;
    const itemsObbligazioniDirect: { name: string; val: number; ticker?: string }[] = [];
    const itemsEtfObbligazionari: { name: string; val: number; ticker?: string; id: string; asset: Asset }[] = [];

    const cashConti = Math.max(0, cashAvailable);
    let valLiquiditaAssets = 0;
    const itemsLiquiditaAssets: { name: string; val: number }[] = [];

    let valCripto = 0;
    let valImmobili = 0;
    let valAltro = 0;

    assets.forEach((a) => {
      const val = getAssetVal(a);
      if (val <= 0) return;

      const kindLower = (a.kind || '').toLowerCase().trim();

      if (isAssetEquityEtf(a)) {
        valEtfAzionari += val;
        itemsEtfAzionari.push({ name: a.name, val, ticker: a.ticker, id: a.id, asset: a });
      } else if (isAssetBondEtf(a)) {
        valEtfObbligazionari += val;
        itemsEtfObbligazionari.push({ name: a.name, val, ticker: a.ticker, id: a.id, asset: a });
      } else if (kindLower === 'azioni') {
        valAzioniDirect += val;
        itemsAzioniDirect.push({ name: a.name, val, ticker: a.ticker });
      } else if (kindLower === 'obbligazioni') {
        valObbligazioniDirect += val;
        itemsObbligazioniDirect.push({ name: a.name, val, ticker: a.ticker });
      } else if (kindLower === 'liquidita') {
        valLiquiditaAssets += val;
        itemsLiquiditaAssets.push({ name: a.name, val });
      } else if (kindLower === 'cripto' || kindLower === 'crypto') {
        valCripto += val;
      } else if (kindLower.includes('immobili') || kindLower.includes('proprieta')) {
        valImmobili += val;
      } else {
        valAltro += val;
      }
    });

    const totalAzioni = valAzioniDirect + valEtfAzionari;
    const totalObbligazioni = valObbligazioniDirect + valEtfObbligazionari;
    const totalLiquidita = cashConti + valLiquiditaAssets;

    const totalPortfolioVal = totalAzioni + totalObbligazioni + totalLiquidita + valCripto + valImmobili + valAltro;

    // Macro-classes list
    const macroClassMap: Record<string, {
      actualVal: number;
      color: string;
      subItems: { label: string; val: number; details: string }[];
    }> = {
      'Azioni': {
        actualVal: totalAzioni,
        color: MACRO_COLORS['Azioni'],
        subItems: [
          {
            label: '📈 ETF Azionari',
            val: valEtfAzionari,
            details: itemsEtfAzionari.length > 0 ? itemsEtfAzionari.map(i => `${i.name} (${formatEuro(i.val)})`).join(', ') : 'Nessun ETF azionario',
          },
          {
            label: '🏢 Azioni Singole',
            val: valAzioniDirect,
            details: itemsAzioniDirect.length > 0 ? itemsAzioniDirect.map(i => `${i.name} (${formatEuro(i.val)})`).join(', ') : 'Nessuna azione singola',
          },
        ],
      },
      'Obbligazioni': {
        actualVal: totalObbligazioni,
        color: MACRO_COLORS['Obbligazioni'],
        subItems: [
          {
            label: '🏛️ ETF Obbligazionari',
            val: valEtfObbligazionari,
            details: itemsEtfObbligazionari.length > 0 ? itemsEtfObbligazionari.map(i => `${i.name} (${formatEuro(i.val)})`).join(', ') : 'Nessun ETF obbligazionario',
          },
          {
            label: '📜 Titoli di Stato & Obbligazioni',
            val: valObbligazioniDirect,
            details: itemsObbligazioniDirect.length > 0 ? itemsObbligazioniDirect.map(i => `${i.name} (${formatEuro(i.val)})`).join(', ') : 'Nessuna obbligazione diretta',
          },
        ],
      },
      'Liquidità': {
        actualVal: totalLiquidita,
        color: MACRO_COLORS['Liquidità'],
        subItems: [
          {
            label: '💳 Saldo Conti Correnti',
            val: cashConti,
            details: 'Liquidità netta disponibile sui conti correnti',
          },
          {
            label: '🏦 Conti Deposito / Titoli Liquidità',
            val: valLiquiditaAssets,
            details: itemsLiquiditaAssets.length > 0 ? itemsLiquiditaAssets.map(i => `${i.name} (${formatEuro(i.val)})`).join(', ') : 'Nessun conto deposito/titolo liquidità',
          },
        ],
      },
    };

    if (valCripto > 0 || (macroTargets['Cripto'] || 0) > 0) {
      macroClassMap['Cripto'] = {
        actualVal: valCripto,
        color: MACRO_COLORS['Cripto'],
        subItems: [{ label: '🪙 Criptovalute', val: valCripto, details: 'Posizioni in cripto' }],
      };
    }

    if (valImmobili > 0 || (macroTargets['Immobili'] || 0) > 0) {
      macroClassMap['Immobili'] = {
        actualVal: valImmobili,
        color: MACRO_COLORS['Immobili'],
        subItems: [{ label: '🏠 Proprietà & Immobili', val: valImmobili, details: 'Beni immobiliari e mobili' }],
      };
    }

    if (valAltro > 0 || (macroTargets['Altro'] || 0) > 0) {
      macroClassMap['Altro'] = {
        actualVal: valAltro,
        color: MACRO_COLORS['Altro'],
        subItems: [{ label: '📦 Altro', val: valAltro, details: 'Fondi comuni o altre attività' }],
      };
    }

    // Build items with strict math: actualPct, targetVal, deltaVal, deltaPct
    const macroItems = Object.entries(macroClassMap).map(([className, data]) => {
      const actualVal = data.actualVal;
      const actualPct = totalPortfolioVal > 0 ? (actualVal / totalPortfolioVal) * 100 : 0;
      const targetPct = macroTargets[className] || 0;
      const targetVal = totalPortfolioVal * (targetPct / 100);
      const deltaVal = targetVal - actualVal; // Positive: underweight (need to buy). Negative: overweight
      const deltaPct = targetPct - actualPct;

      return {
        className,
        color: data.color,
        actualVal,
        actualPct,
        targetPct,
        targetVal,
        deltaVal,
        deltaPct,
        subItems: data.subItems,
      };
    }).sort((a, b) => b.actualVal - a.actualVal);

    // Detailed view items (splitting ETF Azionari vs ETF Obbligazionari vs Azioni vs Obbligazioni)
    const detailedItems = [
      { name: 'ETF Azionari', val: valEtfAzionari, color: '#38bdf8', category: 'Azioni' },
      { name: 'Azioni Singole', val: valAzioniDirect, color: '#6366f1', category: 'Azioni' },
      { name: 'ETF Obbligazionari', val: valEtfObbligazionari, color: '#10b981', category: 'Obbligazioni' },
      { name: 'Obbligazioni Singole', val: valObbligazioniDirect, color: '#34d399', category: 'Obbligazioni' },
      { name: 'Liquidità Conti', val: cashConti, color: '#06b6d4', category: 'Liquidità' },
      { name: 'Titoli Liquidità / Depositi', val: valLiquiditaAssets, color: '#67e8f9', category: 'Liquidità' },
      { name: 'Criptovalute', val: valCripto, color: '#f59e0b', category: 'Cripto' },
      { name: 'Proprietà / Immobili', val: valImmobili, color: '#ec4899', category: 'Immobili' },
      { name: 'Altro / Fondi', val: valAltro, color: '#8b5cf6', category: 'Altro' },
    ].filter((item) => item.val > 0)
     .map((item) => ({
       ...item,
       pct: totalPortfolioVal > 0 ? (item.val / totalPortfolioVal) * 100 : 0,
     }))
     .sort((a, b) => b.val - a.val);

    return {
      totalPortfolioVal,
      macroItems,
      detailedItems,
      totalAzioni,
      valEtfAzionari,
      valAzioniDirect,
      totalObbligazioni,
      valEtfObbligazionari,
      valObbligazioniDirect,
      totalLiquidita,
      itemsEtfAzionari,
      itemsEtfObbligazionari,
    };
  }, [assets, cashAvailable, macroTargets, tickerData, getAssetCurrentQuantity]);

  // Robust Inflow Rebalancing Algorithm:
  // Mathematical optimization to bring under-weight classes closest to targets without selling anything!
  const rebalancePlan = useMemo(() => {
    const inflow = Math.max(0, parseFloat(newCashToInvest) || 0);
    if (inflow <= 0 || allocation.totalPortfolioVal <= 0) return [];

    const newTotal = allocation.totalPortfolioVal + inflow;

    // For each class, ideal target amount in the future portfolio
    const classAnalysis = allocation.macroItems.map((item) => {
      const idealTargetVal = newTotal * (item.targetPct / 100);
      const deficit = Math.max(0, idealTargetVal - item.actualVal);
      return {
        ...item,
        idealTargetVal,
        deficit,
      };
    });

    const totalDeficit = classAnalysis.reduce((sum, c) => sum + c.deficit, 0);

    let planItems = [];

    if (totalDeficit > 0) {
      if (inflow <= totalDeficit) {
        // Distribute proportionally to deficits so underweight classes catch up evenly
        planItems = classAnalysis
          .filter((c) => c.deficit > 0)
          .map((c) => {
            const allocatedInflow = (c.deficit / totalDeficit) * inflow;
            const futureVal = c.actualVal + allocatedInflow;
            const futurePct = (futureVal / newTotal) * 100;
            return {
              className: c.className,
              color: c.color,
              targetPct: c.targetPct,
              allocatedInflow,
              futureVal,
              futurePct,
            };
          });
      } else {
        // Inflow is greater than total deficit: fill all deficits first, then distribute excess according to target weights!
        const excessInflow = inflow - totalDeficit;
        const sumTargetPcts = classAnalysis.reduce((sum, c) => sum + c.targetPct, 0) || 100;

        planItems = classAnalysis.map((c) => {
          const excessShare = (c.targetPct / sumTargetPcts) * excessInflow;
          const allocatedInflow = c.deficit + excessShare;
          const futureVal = c.actualVal + allocatedInflow;
          const futurePct = (futureVal / newTotal) * 100;
          return {
            className: c.className,
            color: c.color,
            targetPct: c.targetPct,
            allocatedInflow,
            futureVal,
            futurePct,
          };
        }).filter((c) => c.allocatedInflow > 0.01);
      }
    } else {
      // Portfolio is already on target: distribute strictly by target weights
      const sumTargetPcts = classAnalysis.reduce((sum, c) => sum + c.targetPct, 0) || 100;
      planItems = classAnalysis.map((c) => {
        const allocatedInflow = (c.targetPct / sumTargetPcts) * inflow;
        const futureVal = c.actualVal + allocatedInflow;
        const futurePct = (futureVal / newTotal) * 100;
        return {
          className: c.className,
          color: c.color,
          targetPct: c.targetPct,
          allocatedInflow,
          futureVal,
          futurePct,
        };
      }).filter((c) => c.allocatedInflow > 0.01);
    }

    return planItems.sort((a, b) => b.allocatedInflow - a.allocatedInflow);
  }, [allocation, newCashToInvest]);

  const handleSaveTargets = () => {
    setMacroTargets(tempTargets);
    try {
      localStorage.setItem(STORAGE_KEY_TARGETS, JSON.stringify(tempTargets));
    } catch {}
    setIsEditingTargets(false);
  };

  const handleQuickSwitchEtfType = (asset: Asset) => {
    if (!onUpdateAsset) return;
    const currentIsBond = isAssetBondEtf(asset);
    const updated: Asset = {
      ...asset,
      etfSubtype: currentIsBond ? 'azionario' : 'obbligazionario',
      kind: currentIsBond ? 'etf_azionario' : 'etf_obbligazionario',
    };
    onUpdateAsset(updated);
  };

  const totalTargetPercent = Object.values(isEditingTargets ? tempTargets : macroTargets).reduce((a, b) => a + (b || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner / Allocation Header */}
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>⚖️</span>
              <p className="panel-title" style={{ margin: 0 }}>Asset Allocation &amp; Ribilanciamento</p>
            </div>
            <h4 style={{ margin: '4px 0 0 0' }}>Composizione del Portafoglio: Azioni, Obbligazioni &amp; Liquidità</h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
              Gli <strong>ETF Azionari</strong> concorrono alla classe <strong>Azioni</strong> e gli <strong>ETF Obbligazionari</strong> concorrono a <strong>Obbligazioni</strong>.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* View Mode Toggle */}
            <div style={{ display: 'flex', background: 'var(--overlay-medium)', padding: '3px', borderRadius: '8px', gap: '2px' }}>
              <button
                type="button"
                className="pill"
                onClick={() => setViewMode('macro')}
                style={{
                  fontSize: '0.76rem',
                  padding: '4px 10px',
                  background: viewMode === 'macro' ? 'var(--input-bg)' : 'transparent',
                  color: viewMode === 'macro' ? 'var(--text)' : 'var(--muted)',
                  fontWeight: viewMode === 'macro' ? 700 : 500,
                  boxShadow: viewMode === 'macro' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                📊 Vista Macro-Classi
              </button>
              <button
                type="button"
                className="pill"
                onClick={() => setViewMode('detailed')}
                style={{
                  fontSize: '0.76rem',
                  padding: '4px 10px',
                  background: viewMode === 'detailed' ? 'var(--input-bg)' : 'transparent',
                  color: viewMode === 'detailed' ? 'var(--text)' : 'var(--muted)',
                  fontWeight: viewMode === 'detailed' ? 700 : 500,
                  boxShadow: viewMode === 'detailed' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                🔍 Vista per Strumento
              </button>
            </div>

            {!isEditingTargets ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setTempTargets(macroTargets);
                  setIsEditingTargets(true);
                }}
                style={{ fontSize: '0.8rem', padding: '6px 14px' }}
              >
                ⚙️ Modifica Target %
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setIsEditingTargets(false)}
                  style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleSaveTargets}
                  style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                >
                  Salva Pesi Target
                </button>
              </>
            )}
          </div>
        </div>

        {/* Warning or indicator if targets don't sum to 100% */}
        {totalTargetPercent !== 100 && (
          <div style={{ padding: '8px 14px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b', fontSize: '0.78rem', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚠️ La somma dei pesi target è attualmente del <strong>{totalTargetPercent}%</strong> (dovrebbe essere esattamente 100%).</span>
            {isEditingTargets && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setTempTargets({ 'Azioni': 60, 'Obbligazioni': 30, 'Liquidità': 10 });
                }}
                style={{ fontSize: '0.75rem', color: '#f59e0b', textDecoration: 'underline' }}
              >
                Reimposta 60/30/10
              </button>
            )}
          </div>
        )}

        {/* Multi-segment Progress Bar: Actual vs Target */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '6px' }}>
            <span>
              Composizione Attuale del Portafoglio: <strong>{formatEuro(allocation.totalPortfolioVal)}</strong>
            </span>
            <span>100%</span>
          </div>
          <div style={{ height: '16px', borderRadius: '8px', background: 'var(--overlay-medium)', display: 'flex', overflow: 'hidden' }}>
            {allocation.macroItems.map((item) => (
              <div
                key={`bar-${item.className}`}
                style={{
                  width: `${item.actualPct}%`,
                  background: item.color,
                  transition: 'width 0.3s ease',
                }}
                title={`${item.className}: ${item.actualPct.toFixed(1)}% (${formatEuro(item.actualVal)})`}
              />
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--muted)', marginTop: '12px', marginBottom: '6px' }}>
            <span>Obiettivo Target Desiderato</span>
            <span>Target: {totalTargetPercent}%</span>
          </div>
          <div style={{ height: '16px', borderRadius: '8px', background: 'var(--overlay-medium)', display: 'flex', overflow: 'hidden' }}>
            {allocation.macroItems.map((item) => (
              <div
                key={`tbar-${item.className}`}
                style={{
                  width: `${item.targetPct}%`,
                  background: item.color,
                  opacity: 0.7,
                  transition: 'width 0.3s ease',
                }}
                title={`${item.className} Target: ${item.targetPct}%`}
              />
            ))}
          </div>
        </div>

        {/* Macro Class Table View */}
        {viewMode === 'macro' ? (
          <div className="transaction-table" style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Classe di Attività</th>
                  <th style={{ textAlign: 'right' }}>Valore Attuale</th>
                  <th style={{ textAlign: 'right' }}>% Attuale</th>
                  <th style={{ textAlign: 'right' }}>% Target</th>
                  <th style={{ textAlign: 'right' }}>Valore Target</th>
                  <th style={{ textAlign: 'right' }}>Scostamento (€)</th>
                  <th style={{ textAlign: 'center' }}>Stato Allocazione</th>
                </tr>
              </thead>
              <tbody>
                {allocation.macroItems.map((item) => {
                  const isUnder = item.deltaVal > 25;
                  const isOver = item.deltaVal < -25;

                  return (
                    <React.Fragment key={item.className}>
                      <tr style={{ background: 'var(--overlay-subtle)', borderTop: '2px solid var(--border)' }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '12px', height: '12px', borderRadius: '4px', background: item.color }} />
                            <div>
                              <strong style={{ fontSize: '0.9rem', color: 'var(--text)' }}>{item.className}</strong>
                              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'block' }}>
                                {item.className === 'Azioni' && 'Include Azioni singole + ETF Azionari'}
                                {item.className === 'Obbligazioni' && 'Include Obbligazioni + ETF Obbligazionari'}
                                {item.className === 'Liquidità' && 'Include Conti Correnti e Conti Deposito'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.92rem' }}>
                          {formatEuro(item.actualVal)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: item.color, fontSize: '0.92rem' }}>
                          {item.actualPct.toFixed(1)}%
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isEditingTargets ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={tempTargets[item.className] ?? 0}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value) || 0;
                                  setTempTargets((prev) => ({ ...prev, [item.className]: v }));
                                }}
                                style={{ width: '56px', padding: '3px 6px', borderRadius: '6px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 700 }}
                              />
                              <span>%</span>
                            </div>
                          ) : (
                            <strong style={{ fontSize: '0.9rem' }}>{item.targetPct}%</strong>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: '0.85rem' }}>
                          {formatEuro(item.targetVal)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          <span style={{ color: isUnder ? '#38bdf8' : isOver ? '#fb7185' : '#10b981', fontWeight: 700 }}>
                            {item.deltaVal > 0 ? `+${formatEuro(item.deltaVal)}` : formatEuro(item.deltaVal)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            style={{
                              fontSize: '0.72rem',
                              padding: '3px 10px',
                              borderRadius: '999px',
                              fontWeight: 700,
                              background: isUnder ? 'rgba(56, 189, 248, 0.15)' : isOver ? 'rgba(251, 113, 133, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: isUnder ? '#38bdf8' : isOver ? '#fb7185' : '#10b981',
                            }}
                          >
                            {isUnder ? '🛒 Da Incrementare' : isOver ? '⚠️ Sovrappesato' : '✓ In Target'}
                          </span>
                        </td>
                      </tr>

                      {/* Sub-item breakdowns: showing exactly how ETFs and direct holdings contribute! */}
                      {item.subItems.map((sub, idx) => (
                        <tr key={`${item.className}-sub-${idx}`} style={{ fontSize: '0.78rem', background: 'transparent' }}>
                          <td style={{ paddingLeft: '32px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ color: 'var(--muted)' }}>↳</span>
                              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{sub.label}</span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: '4px' }}>
                                ({sub.details})
                              </span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)', fontWeight: 600 }}>
                            {formatEuro(sub.val)}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                            {allocation.totalPortfolioVal > 0 ? ((sub.val / allocation.totalPortfolioVal) * 100).toFixed(1) : 0}%
                          </td>
                          <td colSpan={4} style={{ textAlign: 'left', color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.72rem' }}>
                            {item.actualVal > 0 ? `Rappresenta il ${((sub.val / item.actualVal) * 100).toFixed(0)}% di ${item.className}` : ''}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Detailed Tool View */
          <div className="transaction-table" style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Strumento / Tipologia</th>
                  <th>Macro-Classe di Appartenenza</th>
                  <th style={{ textAlign: 'right' }}>Valore Attuale</th>
                  <th style={{ textAlign: 'right' }}>% del Portafoglio</th>
                </tr>
              </thead>
              <tbody>
                {allocation.detailedItems.map((det) => (
                  <tr key={det.name}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: det.color }} />
                        <strong style={{ fontSize: '0.85rem' }}>{det.name}</strong>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: 'var(--overlay-medium)',
                          color: 'var(--text)',
                          fontWeight: 600,
                        }}
                      >
                        Conta in {det.category}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatEuro(det.val)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: det.color }}>{det.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* ETF Subtype Quick Classifier (Allows instant verification/toggling of any ETF) */}
      {(allocation.itemsEtfAzionari.length > 0 || allocation.itemsEtfObbligazionari.length > 0) && (
        <article className="panel" style={{ margin: 0, padding: '16px 20px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '1rem' }}>🏷️</span>
                <strong style={{ fontSize: '0.88rem', color: 'var(--text)' }}>Suddivisione ETF in Portafoglio</strong>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.74rem', color: 'var(--muted)' }}>
                Verifica come ogni ETF è attualmente classificato tra Azionario e Obbligazionario. Puoi invertire la tipologia con un clic.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
            {allocation.itemsEtfAzionari.map((etf) => (
              <div
                key={`etf-az-${etf.id}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.85rem' }}>📈</span>
                    <strong style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{etf.name}</strong>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#3b82f6', fontWeight: 600 }}>
                    ETF Azionario · {formatEuro(etf.val)} (conta in Azioni)
                  </span>
                </div>
                {onUpdateAsset && (
                  <button
                    type="button"
                    className="pill"
                    onClick={() => handleQuickSwitchEtfType(etf.asset)}
                    style={{ fontSize: '0.7rem', padding: '3px 8px' }}
                    title="Imposta come ETF Obbligazionario"
                  >
                    ⇄ Rendi Obbligazionario
                  </button>
                )}
              </div>
            ))}

            {allocation.itemsEtfObbligazionari.map((etf) => (
              <div
                key={`etf-ob-${etf.id}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.85rem' }}>🏛️</span>
                    <strong style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{etf.name}</strong>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>
                    ETF Obbligazionario · {formatEuro(etf.val)} (conta in Obbligazioni)
                  </span>
                </div>
                {onUpdateAsset && (
                  <button
                    type="button"
                    className="pill"
                    onClick={() => handleQuickSwitchEtfType(etf.asset)}
                    style={{ fontSize: '0.7rem', padding: '3px 8px' }}
                    title="Imposta come ETF Azionario"
                  >
                    ⇄ Rendi Azionario
                  </button>
                )}
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Smart Rebalancing Inflow Calculator */}
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>🎯</span>
              <p className="panel-title" style={{ margin: 0 }}>Simulatore di Ribilanciamento con Nuovi Flussi</p>
            </div>
            <h4 style={{ margin: '4px 0 0 0' }}>Come investire i prossimi risparmi per riallineare il portafoglio</h4>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Capitale da investire:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="number"
                value={newCashToInvest}
                onChange={(e) => setNewCashToInvest(e.target.value)}
                style={{
                  width: '120px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'var(--input-bg)',
                  color: 'var(--text)',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                }}
              />
              <span style={{ fontWeight: 700 }}>€</span>
            </div>
          </label>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
            Calcola la suddivisione esatta per acquistare solo le macro-classi sottopesate senza vendere titoli né pagare imposte sul capital gain.
          </div>
        </div>

        {rebalancePlan.length === 0 ? (
          <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--overlay-subtle)', color: 'var(--muted)', fontSize: '0.82rem' }}>
            ✓ Il portafoglio è già allineato ai tuoi pesi target, oppure inserisci un importo da investire maggiore di zero.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '14px' }}>
            {rebalancePlan.map((plan) => (
              <div
                key={`plan-${plan.className}`}
                style={{
                  padding: '16px',
                  borderRadius: '14px',
                  background: 'var(--panel-card-bg)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: plan.color }} />
                    <strong style={{ fontSize: '0.92rem', color: 'var(--text)' }}>{plan.className}</strong>
                  </div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600 }}>Target: {plan.targetPct}%</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '2px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Acquista per:</span>
                  <strong style={{ fontSize: '1.25rem', color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                    {formatEuro(plan.allocatedInflow)}
                  </strong>
                </div>

                <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                  Nuovo peso post-versamento: <strong>{plan.futurePct.toFixed(1)}%</strong> ({formatEuro(plan.futureVal)})
                </div>

                <div style={{ fontSize: '0.72rem', color: 'var(--text)', background: 'var(--overlay-subtle)', padding: '6px 8px', borderRadius: '6px', marginTop: '4px' }}>
                  {plan.className === 'Azioni' && '💡 Consigliato: versa su ETF Azionari per massima diversificazione globale.'}
                  {plan.className === 'Obbligazioni' && '💡 Consigliato: versa su ETF Obbligazionari o Titoli di Stato.'}
                  {plan.className === 'Liquidità' && '💡 Consigliato: incrementa il conto deposito o riserva emergenza.'}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
};
