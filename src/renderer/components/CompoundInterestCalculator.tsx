import React, { useMemo, useState } from 'react';
import { projectCompoundInterest } from '../utils/financeSim';

interface CompoundInterestCalculatorProps {
  formatEuro: (val: number) => string;
  currentNetWorth?: number;
}

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/**
 * Simulatore del calcolo dell'interesse composto: mostra come capitale
 * iniziale + versamenti periodici crescono grazie al reinvestimento degli
 * interessi, con tabella year-by-year e grafico di evoluzione.
 */
export const CompoundInterestCalculator: React.FC<CompoundInterestCalculatorProps> = ({
  formatEuro,
  currentNetWorth = 0,
}) => {
  const [initialCapital, setInitialCapital] = useState<number>(() => Math.max(1000, Math.round(currentNetWorth || 10000)));
  const [monthlyContribution, setMonthlyContribution] = useState<number>(500);
  const [annualReturnRate, setAnnualReturnRate] = useState<number>(7);
  const [inflationRate, setInflationRate] = useState<number>(2);
  const [years, setYears] = useState<number>(20);
  const [adjustForInflation, setAdjustForInflation] = useState<boolean>(true);
  const [showTable, setShowTable] = useState<boolean>(false);

  const simulation = useMemo(
    () =>
      projectCompoundInterest({
        initialCapital,
        monthlyContribution,
        annualReturnPercent: annualReturnRate,
        inflationPercent: adjustForInflation ? inflationRate : 0,
        years,
      }),
    [initialCapital, monthlyContribution, annualReturnRate, inflationRate, years, adjustForInflation],
  );

  const svgWidth = 860;
  const svgHeight = 250;
  const paddingX = 48;
  const paddingY = 30;

  const maxVal = Math.max(...simulation.yearlyData.map((d) => d.total), 1000);
  const getX = (idx: number) =>
    paddingX + (idx / Math.max(1, simulation.yearlyData.length - 1)) * (svgWidth - 2 * paddingX);
  const getY = (val: number) => svgHeight - paddingY - (val / maxVal) * (svgHeight - 2 * paddingY);

  const interestShare =
    simulation.finalTotal > 0 ? (simulation.finalInterest / simulation.finalTotal) * 100 : 0;

  return (
    <article className="panel large-panel" style={{ margin: 0 }}>
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' }}>
        <div>
          <p className="panel-title">Calcolo Interesse Composto</p>
          <h4 style={{ margin: '4px 0 0' }}>Quanto crescono i tuoi risparmi grazie al reinvestimento degli interessi?</h4>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setShowTable((prev) => !prev)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', padding: '6px 14px', borderRadius: '10px' }}
        >
          <span>📋</span>
          <span>{showTable ? 'Nascondi tabella' : 'Mostra tabella anno per anno'}</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px', marginBottom: '22px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Capitale Iniziale (€)</span>
            {currentNetWorth > 0 && (
              <button
                type="button"
                onClick={() => setInitialCapital(Math.max(0, Math.round(currentNetWorth)))}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.7rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
              >
                Usa patrimonio ({formatEuro(currentNetWorth)})
              </button>
            )}
          </div>
          <input
            type="number"
            value={initialCapital}
            onChange={(e) => setInitialCapital(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Quanto possiedi oggi.</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Versamento Mensile (€)</span>
          <input
            type="number"
            value={monthlyContribution}
            onChange={(e) => setMonthlyContribution(Math.max(0, parseFloat(e.target.value) || 0))}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Contributo ricorrente a fine mese.</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Rendimento Annuo</span>
            <strong style={{ fontSize: '0.75rem', color: 'var(--success)' }}>{annualReturnRate}%</strong>
          </div>
          <input
            type="range"
            min="0"
            max="15"
            step="0.5"
            value={annualReturnRate}
            onChange={(e) => setAnnualReturnRate(parseFloat(e.target.value))}
            style={{ accentColor: 'var(--success)' }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Rendimento nominale annuo ipotizzato (media storica globale ~7%).</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Durata</span>
            <strong style={{ fontSize: '0.75rem', color: 'var(--info)' }}>{years} anni</strong>
          </div>
          <input
            type="range"
            min="1"
            max="45"
            step="1"
            value={years}
            onChange={(e) => setYears(parseInt(e.target.value, 10))}
            style={{ accentColor: 'var(--info)' }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Orizzonte temporale dell'accumulo.</span>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', justifyContent: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text)' }}>
            <input type="checkbox" checked={adjustForInflation} onChange={(e) => setAdjustForInflation(e.target.checked)} />
            <span>Considera l'inflazione ({inflationRate}%)</span>
          </label>
          {adjustForInflation && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Inflazione annua (%)</span>
              <input
                type="number"
                step="0.5"
                value={inflationRate}
                onChange={(e) => setInflationRate(Math.max(0, parseFloat(e.target.value) || 0))}
                style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600, maxWidth: '110px' }}
              />
            </label>
          )}
          <small style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            {adjustForInflation
              ? 'Valori espressi in potere d’acquisto odierno.'
              : 'Valori nominali futuri, senza correzione del carovita.'}
          </small>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '22px' }}>
        <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)', borderLeft: '4px solid var(--success)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Capitale Finale
          </span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--success)', marginTop: '4px' }}>
            {formatEuro(simulation.finalTotal)}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>dopo {years} anni</span>
        </div>

        <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)', borderLeft: '4px solid var(--chart-3)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Interessi Generati
          </span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--chart-3)', marginTop: '4px' }}>
            +{formatEuro(simulation.finalInterest)}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{interestShare.toFixed(0)}% del totale</span>
        </div>

        <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)', borderLeft: '4px solid var(--info)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Capitale Versato
          </span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--info)', marginTop: '4px' }}>
            {formatEuro(simulation.finalContributed)}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>contributi tuoi + capitale iniziale</span>
        </div>

        <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)', borderLeft: '4px solid var(--warning)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Effetto Moltiplicatore
          </span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--warning)', marginTop: '4px' }}>
            {simulation.multiplier.toFixed(2)}×
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>ogni € versato ne genera {simulation.multiplier.toFixed(2)}</span>
        </div>
      </div>

      <div style={{ background: 'var(--panel-card-bg)', borderRadius: '12px', padding: '16px 12px 8px', border: '1px solid var(--border)', overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '0 8px', fontSize: '0.75rem', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>Andamento del capitale</span>
          <div style={{ display: 'flex', gap: '14px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--chart-2)' }}>
              <span style={{ width: '12px', height: '2px', background: 'var(--chart-2)', display: 'inline-block' }} /> Versamenti
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--chart-positive)' }}>
              <span style={{ width: '12px', height: '3px', background: 'var(--chart-positive)', display: 'inline-block' }} /> Totale con interessi
            </span>
          </div>
        </div>

        <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ overflow: 'visible', display: 'block' }}>
          {[0, 0.33, 0.66, 1].map((p, idx) => {
            const yVal = p * maxVal;
            const y = getY(yVal);
            return (
              <g key={`cgrid-${idx}`}>
                <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
                <text x={paddingX - 6} y={y + 3} textAnchor="end" fontSize="0.65rem" fill="var(--muted)">
                  {currencyFormatter.format(Math.round(yVal))}
                </text>
              </g>
            );
          })}

          <path
            d={simulation.yearlyData.map((d, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(d.contributed)}`).join(' ')}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth={2}
            strokeDasharray="4 2"
          />

          <path
            d={simulation.yearlyData.map((d, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(d.total)}`).join(' ')}
            fill="none"
            stroke="var(--chart-positive)"
            strokeWidth={2.8}
          />

          {simulation.yearlyData.map((d, idx) => (
            <g key={`cdot-${idx}`}>
              <circle cx={getX(idx)} cy={getY(d.total)} r={3.2} fill="var(--chart-positive)" />
              {(idx === 0 || idx === simulation.yearlyData.length - 1) && (
                <text x={getX(idx)} y={svgHeight - 10} textAnchor="middle" fontSize="0.68rem" fill="var(--muted)">
                  Anno {d.year}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      {showTable && (
        <div style={{ marginTop: '18px', maxHeight: '340px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px' }}>
          <table className="transaction-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Anno</th>
                <th style={{ textAlign: 'right', padding: '10px 12px' }}>Versato</th>
                <th style={{ textAlign: 'right', padding: '10px 12px' }}>Interessi</th>
                <th style={{ textAlign: 'right', padding: '10px 12px' }}>Totale</th>
              </tr>
            </thead>
            <tbody>
              {simulation.yearlyData.map((row) => (
                <tr key={`ctable-${row.year}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px' }}>{row.year}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>{formatEuro(row.contributed)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--chart-3)' }}>{formatEuro(row.interest)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{formatEuro(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
};
