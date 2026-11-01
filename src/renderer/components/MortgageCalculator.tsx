import React, { useMemo, useState } from 'react';
import { AmortizationType, simulateMortgage } from '../utils/financeSim';

interface MortgageCalculatorProps {
  formatEuro: (val: number) => string;
}

const quickAmounts = [100000, 150000, 200000, 250000, 300000];

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/**
 * Simulatore mutui: rata, piano di ammortamento, costo reale del credito e
 * impatto di un versamento extra mensile.
 */
export const MortgageCalculator: React.FC<MortgageCalculatorProps> = ({ formatEuro }) => {
  const [principal, setPrincipal] = useState<number>(200000);
  const [years, setYears] = useState<number>(30);
  const [annualRate, setAnnualRate] = useState<number>(3.5);
  const [type, setType] = useState<AmortizationType>('french');
  const [initialCosts, setInitialCosts] = useState<number>(5000);
  const [extraPayment, setExtraPayment] = useState<number>(0);
  const [monthlyBudget, setMonthlyBudget] = useState<number>(1200);
  const [showMonthlySchedule, setShowMonthlySchedule] = useState<boolean>(false);

  const simulation = useMemo(
    () =>
      simulateMortgage({
        principal,
        years,
        annualRatePercent: annualRate,
        type,
        extraMonthlyPayment: extraPayment,
        initialCosts,
      }),
    [principal, years, annualRate, type, extraPayment, initialCosts],
  );

  const baseSimulation = useMemo(
    () =>
      simulateMortgage({
        principal,
        years,
        annualRatePercent: annualRate,
        type,
        extraMonthlyPayment: 0,
        initialCosts,
      }),
    [principal, years, annualRate, type, initialCosts],
  );

  const maxAffordableLoan = useMemo(() => simulation.maxLoanForBudget(monthlyBudget), [simulation, monthlyBudget]);
  const interestSaved = baseSimulation.totalInterest - simulation.totalInterest;
  const monthsSaved = (baseSimulation.durationYears - simulation.durationYears) * 12;

  // Chart
  const svgWidth = 860;
  const svgHeight = 260;
  const paddingX = 48;
  const paddingY = 30;
  const chartRows = simulation.rows;

  const maxYearValue = Math.max(...chartRows.map((r) => r.payment), 1);
  const maxRemaining = Math.max(...chartRows.map((r) => r.remaining), principal, 1);

  const plotWidth = svgWidth - 2 * paddingX;
  const plotHeight = svgHeight - 2 * paddingY;
  const barWidth = chartRows.length > 0 ? Math.max(3, (plotWidth / chartRows.length) * 0.62) : 10;
  const step = chartRows.length > 1 ? plotWidth / (chartRows.length - 1) : plotWidth;
  const getX = (idx: number) => paddingX + idx * step;
  const getY = (val: number) => svgHeight - paddingY - (val / maxYearValue) * plotHeight;
  const getYRemaining = (val: number) => svgHeight - paddingY - (val / maxRemaining) * plotHeight;

  return (
    <article className="panel large-panel" style={{ margin: 0 }}>
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' }}>
        <div>
          <p className="panel-title">Simulatore Mutui</p>
          <h4 style={{ margin: '4px 0 0' }}>Rata, piano di ammortamento e costo reale del credito</h4>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', background: 'var(--overlay-subtle)', padding: '6px 12px', borderRadius: '10px', border: '1px solid var(--border)' }}>
          Tasso TAEG effettivo: {annualRate.toFixed(2)}% annuo
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px', marginBottom: '22px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Importo del Mutuo (€)</span>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
          />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {quickAmounts.map((amount) => (
              <button
                key={amount}
                type="button"
                className="ghost-button"
                onClick={() => setPrincipal(amount)}
                style={{ padding: '3px 9px', fontSize: '0.68rem', borderRadius: '8px' }}
              >
                {currencyFormatter.format(amount / 1000)}k
              </button>
            ))}
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Durata</span>
            <strong style={{ fontSize: '0.75rem', color: 'var(--info)' }}>{years} anni</strong>
          </div>
          <input
            type="range"
            min="5"
            max="40"
            step="1"
            value={years}
            onChange={(e) => setYears(parseInt(e.target.value, 10))}
            style={{ accentColor: 'var(--info)' }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Piano di rimborsamento.</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Tasso di Interesse</span>
            <strong style={{ fontSize: '0.75rem', color: 'var(--success)' }}>{annualRate.toFixed(2)}%</strong>
          </div>
          <input
            type="number"
            step="0.05"
            value={annualRate}
            onChange={(e) => setAnnualRate(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>TAN applicato alla banca.</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Tipo di Ammortamento</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AmortizationType)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
          >
            <option value="french">Francese (rata costante)</option>
            <option value="italian">Italiano (capitale costante)</option>
          </select>
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
            {type === 'french'
              ? 'Rata fissa uguale per tutta la durata.'
              : 'Quota capitale fissa, rata iniziale più alta e decrescente.'}
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Spese Iniziali (€)</span>
          <input
            type="number"
            value={initialCosts}
            onChange={(e) => setInitialCosts(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
            Notarile, valutazione, imposte… ({principal > 0 ? ((initialCosts / principal) * 100).toFixed(1) : '0'}% del mutuo).
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Versamento Extra Mensile (€)</span>
          <input
            type="number"
            value={extraPayment}
            onChange={(e) => setExtraPayment(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Accelerazione dell'estinzione del debito.</span>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '22px' }}>
        <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)', borderLeft: '4px solid var(--accent)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Rata Mensile
          </span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent)', marginTop: '4px' }}>
            {formatEuro(simulation.monthlyPayment)}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            {extraPayment > 0 ? `+ ${formatEuro(extraPayment)} extra = ${formatEuro(simulation.monthlyPayment + extraPayment)}` : 'rata costante (ammortamento francese)'}
          </span>
        </div>

        <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)', borderLeft: '4px solid var(--warning)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Totale Interessi
          </span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--warning)', marginTop: '4px' }}>
            {formatEuro(simulation.totalInterest)}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{simulation.interestPercent.toFixed(0)}% di quanto rimborsi</span>
        </div>

        <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)', borderLeft: '4px solid var(--danger)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Costo Totale del Credito
          </span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--danger)', marginTop: '4px' }}>
            {formatEuro(simulation.totalCost)}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            capitale + interessi{initialCosts > 0 ? ` + spese (${formatEuro(simulation.initialCosts)})` : ''}
          </span>
        </div>

        <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)', borderLeft: '4px solid var(--success)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Durata Effettiva
          </span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--success)', marginTop: '4px' }}>
            {simulation.durationYears} anni
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            {monthsSaved > 0 ? `${monthsSaved} mesi risparmiati con l'estra` : 'mutuo estinto nel piano previsto'}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginBottom: '22px' }}>
        <div style={{ padding: '14px 16px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
          <strong style={{ fontSize: '0.82rem', color: 'var(--text)', display: 'block', marginBottom: '4px' }}>
            💶 Capacità di rimborso
          </strong>
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--muted)', lineHeight: 1.45 }}>
            Con una rata mensile sostenibile di <strong style={{ color: 'var(--accent)' }}>{formatEuro(monthlyBudget)}</strong> puoi ottenere
            un mutuo fino a <strong style={{ color: 'var(--success)' }}>{formatEuro(maxAffordableLoan)}</strong> su {years} anni al {annualRate.toFixed(2)}%.
          </p>
          <input
            type="number"
            value={monthlyBudget}
            onChange={(e) => setMonthlyBudget(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{ marginTop: '10px', padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600, width: '100%' }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Rata massima che riesci a sostenere ogni mese.</span>
        </div>

        <div style={{ padding: '14px 16px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
          <strong style={{ fontSize: '0.82rem', color: 'var(--text)', display: 'block', marginBottom: '4px' }}>
            🚀 Effetto del versamento extra
          </strong>
          {extraPayment > 0 ? (
            <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--muted)', lineHeight: 1.45 }}>
              Versando <strong>{formatEuro(extraPayment)}</strong> in più al mese risparmi <strong style={{ color: 'var(--success)' }}>{formatEuro(interestSaved)}</strong> di interessi
              e estingui il mutuo <strong>{monthsSaved} mesi</strong> prima ({baseSimulation.durationYears} → {simulation.durationYears} anni).
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--muted)', lineHeight: 1.45 }}>
              Aggiungi un versamento extra mensile per confrontare il risparmio di interessi e l'anticipo dell'estinzione.
            </p>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--panel-card-bg)', borderRadius: '12px', padding: '16px 12px 8px', border: '1px solid var(--border)', overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '0 8px', fontSize: '0.75rem', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>Composizione delle rate per anno</span>
          <div style={{ display: 'flex', gap: '14px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--success)' }}>
              <span style={{ width: '12px', height: '10px', background: 'var(--success)', display: 'inline-block', borderRadius: '2px' }} /> Quota capitale
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--warning)' }}>
              <span style={{ width: '12px', height: '10px', background: 'var(--warning)', display: 'inline-block', borderRadius: '2px' }} /> Interessi
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--chart-2)' }}>
              <span style={{ width: '12px', height: '2px', background: 'var(--chart-2)', display: 'inline-block' }} /> Debito residuo
            </span>
          </div>
        </div>

        <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ overflow: 'visible', display: 'block' }}>
          {[0, 0.33, 0.66, 1].map((p, idx) => {
            const yVal = p * maxYearValue;
            const y = getY(yVal);
            return (
              <g key={`mgrid-${idx}`}>
                <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
                <text x={paddingX - 6} y={y + 3} textAnchor="end" fontSize="0.65rem" fill="var(--muted)">
                  {currencyFormatter.format(Math.round(yVal))}
                </text>
              </g>
            );
          })}

          {chartRows.map((row, idx) => {
            const x = getX(idx) - barWidth / 2;
            const principalHeight = (row.principal / maxYearValue) * plotHeight;
            const interestHeight = (row.interest / maxYearValue) * plotHeight;
            const baseY = svgHeight - paddingY;
            return (
              <g key={`mbar-${row.year}`}>
                <rect x={x} y={baseY - principalHeight} width={barWidth} height={principalHeight} fill="var(--success)" opacity={0.85} />
                <rect x={x} y={baseY - principalHeight - interestHeight} width={barWidth} height={interestHeight} fill="var(--warning)" opacity={0.85} />
                {(idx === 0 || idx === chartRows.length - 1) && (
                  <text x={getX(idx)} y={svgHeight - 10} textAnchor="middle" fontSize="0.65rem" fill="var(--muted)">
                    Anno {row.year}
                  </text>
                )}
              </g>
            );
          })}

          <path
            d={chartRows.map((row, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getYRemaining(row.remaining)}`).join(' ')}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth={2}
          />
        </svg>
      </div>

      <div style={{ marginTop: '18px' }}>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setShowMonthlySchedule((prev) => !prev)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', padding: '6px 14px', borderRadius: '10px' }}
        >
          <span>📋</span>
          <span>{showMonthlySchedule ? 'Nascondi piano mensile' : 'Mostra piano mensile completo'}</span>
        </button>

        {showMonthlySchedule && (
          <div style={{ marginTop: '12px', maxHeight: '380px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px' }}>
            <table className="transaction-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Mese</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Rata</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Capitale</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Interessi</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Residuo</th>
                </tr>
              </thead>
              <tbody>
                {simulation.schedule.map((row) => (
                  <tr key={`mm-${row.month}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 12px' }}>{row.month}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right' }}>{formatEuro(row.payment)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', color: 'var(--success)' }}>{formatEuro(row.principal)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', color: 'var(--warning)' }}>{formatEuro(row.interest)}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700 }}>{formatEuro(row.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </article>
  );
};
