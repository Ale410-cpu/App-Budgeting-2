import React, { useState, useMemo } from 'react';

interface FireCalculatorProps {
  currentNetWorth: number;
  formatEuro: (val: number) => string;
}

export const FireCalculator: React.FC<FireCalculatorProps> = ({ currentNetWorth, formatEuro }) => {
  const [initialCapital, setInitialCapital] = useState<number>(() => Math.max(1000, Math.round(currentNetWorth || 10000)));
  const [monthlyContribution, setMonthlyContribution] = useState<number>(500);
  const [expectedReturnRate, setExpectedReturnRate] = useState<number>(7); // 7% annual return
  const [inflationRate, setInflationRate] = useState<number>(2); // 2% inflation
  const [years, setYears] = useState<number>(20);
  const [targetMonthlyExpense, setTargetMonthlyExpense] = useState<number>(1500);
  const [adjustForInflation, setAdjustForInflation] = useState<boolean>(true);
  const [showFireGuide, setShowFireGuide] = useState<boolean>(false);

  // Projections
  const simulation = useMemo(() => {
    const netReturn = adjustForInflation
      ? (1 + expectedReturnRate / 100) / (1 + inflationRate / 100) - 1
      : expectedReturnRate / 100;

    const monthlyRate = Math.pow(1 + netReturn, 1 / 12) - 1;
    const totalMonths = years * 12;

    const yearlyData: Array<{
      year: number;
      contributed: number;
      interest: number;
      total: number;
    }> = [];

    let currentBalance = initialCapital;
    let totalContributed = initialCapital;

    yearlyData.push({
      year: 0,
      contributed: initialCapital,
      interest: 0,
      total: initialCapital,
    });

    for (let m = 1; m <= totalMonths; m++) {
      currentBalance = currentBalance * (1 + monthlyRate) + monthlyContribution;
      totalContributed += monthlyContribution;

      if (m % 12 === 0) {
        const y = m / 12;
        yearlyData.push({
          year: y,
          contributed: totalContributed,
          interest: Math.max(0, currentBalance - totalContributed),
          total: currentBalance,
        });
      }
    }

    const finalTotal = currentBalance;
    const finalContributed = totalContributed;
    const finalInterest = Math.max(0, finalTotal - finalContributed);

    // 4% Rule: Safe Withdrawal Rate
    const annualPassiveIncome = finalTotal * 0.04;
    const monthlyPassiveIncome = annualPassiveIncome / 12;

    // Target FIRE capital needed (25x annual expenses)
    const annualExpense = targetMonthlyExpense * 12;
    const fireNumber = annualExpense * 25;

    // Estimate years to FIRE
    let yearsToFire = 0;
    let simBal = initialCapital;
    while (simBal < fireNumber && yearsToFire < 60) {
      yearsToFire++;
      for (let month = 0; month < 12; month++) {
        simBal = simBal * (1 + monthlyRate) + monthlyContribution;
      }
    }

    return {
      yearlyData,
      finalTotal,
      finalContributed,
      finalInterest,
      monthlyPassiveIncome,
      annualPassiveIncome,
      fireNumber,
      yearsToFire: simBal >= fireNumber ? yearsToFire : '> 60',
    };
  }, [initialCapital, monthlyContribution, expectedReturnRate, inflationRate, years, targetMonthlyExpense, adjustForInflation]);

  // Chart dimensions
  const svgWidth = 860;
  const svgHeight = 240;
  const paddingX = 40;
  const paddingY = 30;

  const maxVal = Math.max(...simulation.yearlyData.map((d) => d.total), 1000);
  const getX = (idx: number) => paddingX + (idx / (simulation.yearlyData.length - 1)) * (svgWidth - 2 * paddingX);
  const getY = (val: number) => svgHeight - paddingY - (val / maxVal) * (svgHeight - 2 * paddingY);

  const multiplier = simulation.finalContributed > 0 ? (simulation.finalTotal / simulation.finalContributed).toFixed(1) : '1.0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' }}>
          <div>
            <p className="panel-title">Simulatore Interesse Composto & FIRE</p>
            <h4 style={{ margin: '4px 0 0' }}>Proietta la crescita del tuo patrimonio e l'indipendenza finanziaria</h4>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setShowFireGuide((prev) => !prev)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', padding: '6px 14px', borderRadius: '10px' }}
          >
            <span>💡</span>
            <span>{showFireGuide ? 'Nascondi guida alle cifre' : 'Cosa significa ogni cifra?'}</span>
          </button>
        </div>

        {/* Guida rapida e non prolissa alle cifre */}
        {showFireGuide && (
          <div style={{
            background: 'var(--overlay-subtle)',
            border: '1px solid rgba(94, 234, 212, 0.25)',
            borderRadius: '16px',
            padding: '16px 20px',
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.88rem', color: 'var(--accent)' }}>
                📖 Guida rapida: cosa significano le cifre del simulatore
              </strong>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowFireGuide(false)}
                style={{ padding: '2px 8px', fontSize: '0.75rem' }}
              >
                Chiudi ✕
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', fontSize: '0.78rem', color: 'var(--text)' }}>
              <div style={{ background: 'var(--panel-card-bg)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <strong style={{ color: '#10b981', display: 'block', marginBottom: '4px' }}>🎯 Patrimonio Finale</strong>
                <span>Il valore totale del portafoglio all'anno <strong>{years}</strong>. È dato dalla somma del capitale che versi tu più tutti gli interessi composti reinvestiti nel tempo.</span>
              </div>
              <div style={{ background: 'var(--panel-card-bg)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '4px' }}>🛡️ Rendita Mensile (Regola 4%)</strong>
                <span>Lo "stipendio passivo" che puoi prelevare ogni mese per sempre senza intaccare il capitale. Basato sul <em>Trinity Study</em>: prelevare fino al 4% all'anno mantiene il capitale intatto nel tempo.</span>
              </div>
              <div style={{ background: 'var(--panel-card-bg)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <strong style={{ color: '#c084fc', display: 'block', marginBottom: '4px' }}>🏁 Capitale FIRE (25× spese)</strong>
                <span>La somma totale che ti serve per smettere di lavorare. Si calcola moltiplicando le tue spese annuali per 25 (es. {formatEuro(targetMonthlyExpense * 12)} × 25 = {formatEuro(simulation.fireNumber)}).</span>
              </div>
              <div style={{ background: 'var(--panel-card-bg)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <strong style={{ color: '#f59e0b', display: 'block', marginBottom: '4px' }}>⏳ Tempo a FIRE</strong>
                <span>Gli anni che ti separano dal Capitale FIRE continuando a risparmiare regolarmente {formatEuro(monthlyContribution)}/mese con il rendimento ipotizzato ({expectedReturnRate}%).</span>
              </div>
            </div>
          </div>
        )}

        {/* Inputs Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Capitale Iniziale (€)</span>
              {currentNetWorth > 0 && (
                <button
                  type="button"
                  onClick={() => setInitialCapital(Math.max(0, Math.round(currentNetWorth)))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline'
                  }}
                  title="Copia il valore del tuo Patrimonio Netto attuale"
                >
                  Usa attuale ({formatEuro(currentNetWorth)})
                </button>
              )}
            </div>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(Math.max(0, parseFloat(e.target.value) || 0))}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
            />
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Capitale liquido/investito da cui parti oggi.</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Risparmio / PAC Mensile (€)</span>
            <input
              type="number"
              value={monthlyContribution}
              onChange={(e) => setMonthlyContribution(Math.max(0, parseFloat(e.target.value) || 0))}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
            />
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Quota aggiunta ogni mese dai tuoi guadagni.</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Rendimento Annuo Stimato</span>
              <strong style={{ fontSize: '0.75rem', color: '#10b981' }}>{expectedReturnRate}%</strong>
            </div>
            <input
              type="range"
              min="1"
              max="15"
              step="0.5"
              value={expectedReturnRate}
              onChange={(e) => setExpectedReturnRate(parseFloat(e.target.value))}
              style={{ accentColor: '#10b981' }}
            />
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>La media storica azionaria globale è ~7-8% annuo.</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Orizzonte Temporale</span>
              <strong style={{ fontSize: '0.75rem', color: '#38bdf8' }}>{years} anni</strong>
            </div>
            <input
              type="range"
              min="3"
              max="40"
              step="1"
              value={years}
              onChange={(e) => setYears(parseInt(e.target.value, 10))}
              style={{ accentColor: '#38bdf8' }}
            />
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Durata in anni dell'accumulo del capitale.</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Spesa Mensile Target Desiderata (€)</span>
            <input
              type="number"
              value={targetMonthlyExpense}
              onChange={(e) => setTargetMonthlyExpense(Math.max(100, parseFloat(e.target.value) || 100))}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontWeight: 600 }}
            />
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Uscite mensili per vivere liberi dal lavoro.</span>
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', justifyContent: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={adjustForInflation}
                onChange={(e) => setAdjustForInflation(e.target.checked)}
              />
              <span>Aggiusta per inflazione (2% annuo)</span>
            </label>
            <small style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
              {adjustForInflation
                ? 'I valori riflettono il reale potere d’acquisto odierno (consigliato).'
                : 'I valori mostrano cifre nominali future senza tener conto del carovita.'}
            </small>
          </div>
        </div>

        {/* Results Highlight Cards with concise, clear explanations */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '24px' }}>
          
          {/* Card 1: Patrimonio Finale */}
          <div style={{
            padding: '16px',
            borderRadius: '14px',
            background: 'var(--panel-card-bg)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid #10b981',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Patrimonio Finale Stimato
              </span>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#10b981', marginTop: '4px', lineHeight: 1.2 }}>
                {formatEuro(simulation.finalTotal)}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>accumulato tra {years} anni</span>
            </div>
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)', fontSize: '0.73rem', color: 'var(--text)', lineHeight: '1.35' }}>
              <strong>Cosa significa:</strong> Il valore complessivo del tuo portafoglio a scadenza (capitale versato da te + tutti i rendimenti reinvestiti).
            </div>
          </div>

          {/* Card 2: Rendita Mensile */}
          <div style={{
            padding: '16px',
            borderRadius: '14px',
            background: 'var(--panel-card-bg)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid #38bdf8',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Rendita Mensile Sostenibile
              </span>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#38bdf8', marginTop: '4px', lineHeight: 1.2 }}>
                {formatEuro(simulation.monthlyPassiveIncome)}<span style={{ fontSize: '0.85rem', fontWeight: 600 }}>/mese</span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>prelievo sicuro del 4% annuo</span>
            </div>
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)', fontSize: '0.73rem', color: 'var(--text)', lineHeight: '1.35' }}>
              <strong>Cosa significa:</strong> Lo stipendio passivo che puoi prelevare ogni mese per sempre dal capitale senza mai intaccarlo o esaurirlo.
            </div>
          </div>

          {/* Card 3: Capitale FIRE Necessario */}
          <div style={{
            padding: '16px',
            borderRadius: '14px',
            background: 'var(--panel-card-bg)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid #c084fc',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Capitale FIRE Necessario
              </span>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#c084fc', marginTop: '4px', lineHeight: 1.2 }}>
                {formatEuro(simulation.fireNumber)}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>per coprire {formatEuro(targetMonthlyExpense)}/mese</span>
            </div>
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)', fontSize: '0.73rem', color: 'var(--text)', lineHeight: '1.35' }}>
              <strong>Cosa significa:</strong> Il capitale target da raggiungere (25 volte le spese annue) per essere libero finanziariamente senza dover lavorare.
            </div>
          </div>

          {/* Card 4: Tempo all'Indipendenza */}
          <div style={{
            padding: '16px',
            borderRadius: '14px',
            background: 'var(--panel-card-bg)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid #f59e0b',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Tempo a Indipendenza (FIRE)
              </span>
              <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#f59e0b', marginTop: '4px', lineHeight: 1.2 }}>
                {simulation.yearsToFire} {typeof simulation.yearsToFire === 'number' ? (simulation.yearsToFire === 1 ? 'anno' : 'anni') : ''}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>con l'attuale ritmo di risparmio</span>
            </div>
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)', fontSize: '0.73rem', color: 'var(--text)', lineHeight: '1.35' }}>
              <strong>Cosa significa:</strong> Quanti anni mancano al traguardo FIRE risparmiando {formatEuro(monthlyContribution)}/mese al {expectedReturnRate}% annuo.
            </div>
          </div>

        </div>

        {/* Breakdown bar: Versamenti vs Interessi composti */}
        <div style={{
          marginBottom: '20px',
          background: 'var(--panel-card-bg)',
          padding: '16px',
          borderRadius: '12px',
          border: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '0.76rem', color: 'var(--muted)', marginBottom: '8px' }}>
            <span>
              💰 <strong>Capitale Versato da te:</strong> <span style={{ color: '#38bdf8', fontWeight: 700 }}>{formatEuro(simulation.finalContributed)}</span> ({((simulation.finalContributed / simulation.finalTotal) * 100).toFixed(0)}%)
            </span>
            <span>
              📈 <strong>Interessi Composti Generati:</strong> <span style={{ color: '#10b981', fontWeight: 700 }}>+{formatEuro(simulation.finalInterest)}</span> ({((simulation.finalInterest / simulation.finalTotal) * 100).toFixed(0)}%)
            </span>
          </div>
          
          <div style={{ height: '14px', borderRadius: '7px', background: 'var(--overlay-medium)', display: 'flex', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{ width: `${(simulation.finalContributed / simulation.finalTotal) * 100}%`, background: '#38bdf8' }} title={`Versato: ${formatEuro(simulation.finalContributed)}`} />
            <div style={{ width: `${(simulation.finalInterest / simulation.finalTotal) * 100}%`, background: '#10b981' }} title={`Interessi: ${formatEuro(simulation.finalInterest)}`} />
          </div>

          <p style={{ margin: 0, fontSize: '0.73rem', color: 'var(--muted)' }}>
            💡 <strong>Effetto moltiplicatore:</strong> I tuoi versamenti personali vengono moltiplicati per <strong>{multiplier}×</strong> grazie al reinvestimento continuo degli interessi nel tempo.
          </p>
        </div>

        {/* Accumulation SVG Chart */}
        <div style={{ background: 'var(--panel-card-bg)', borderRadius: '12px', padding: '16px 12px 8px', border: '1px solid var(--border)', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '0 8px', fontSize: '0.75rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Evoluzione Temporale del Capitale</span>
            <div style={{ display: 'flex', gap: '14px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#38bdf8' }}>
                <span style={{ width: '12px', height: '2px', background: '#38bdf8', display: 'inline-block' }} /> Capitale versato
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#10b981' }}>
                <span style={{ width: '12px', height: '3px', background: '#10b981', display: 'inline-block' }} /> Capitale totale (+interessi)
              </span>
              {simulation.fireNumber <= maxVal && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#c084fc' }}>
                  <span style={{ width: '12px', height: '2px', borderTop: '2px dashed #c084fc', display: 'inline-block' }} /> Traguardo FIRE
                </span>
              )}
            </div>
          </div>

          <svg
            width="100%"
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{ overflow: 'visible', display: 'block' }}
          >
            {/* Grid */}
            {[0, 0.33, 0.66, 1].map((p, idx) => {
              const yVal = p * maxVal;
              const y = getY(yVal);
              return (
                <g key={`fgrid-${idx}`}>
                  <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
                  <text x={paddingX - 6} y={y + 3} textAnchor="end" fontSize="0.65rem" fill="var(--muted)">
                    {formatEuro(yVal)}
                  </text>
                </g>
              );
            })}

            {/* Fire Target Line */}
            {simulation.fireNumber <= maxVal && (
              <g>
                <line
                  x1={paddingX}
                  y1={getY(simulation.fireNumber)}
                  x2={svgWidth - paddingX}
                  y2={getY(simulation.fireNumber)}
                  stroke="#c084fc"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                />
                <text x={svgWidth - paddingX - 4} y={getY(simulation.fireNumber) - 4} textAnchor="end" fontSize="0.65rem" fill="#c084fc" fontWeight={700}>
                  Target FIRE ({formatEuro(simulation.fireNumber)})
                </text>
              </g>
            )}

            {/* Lines */}
            {/* Contributed line */}
            <path
              d={simulation.yearlyData.map((d, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(d.contributed)}`).join(' ')}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={2}
              strokeDasharray="4 2"
            />

            {/* Total line */}
            <path
              d={simulation.yearlyData.map((d, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(d.total)}`).join(' ')}
              fill="none"
              stroke="#10b981"
              strokeWidth={2.8}
            />

            {/* Dots */}
            {simulation.yearlyData.map((d, idx) => (
              <g key={`fdot-${idx}`}>
                <circle cx={getX(idx)} cy={getY(d.total)} r={3.5} fill="#10b981" />
                {(idx === 0 || idx === Math.floor(simulation.yearlyData.length / 2) || idx === simulation.yearlyData.length - 1) && (
                  <text x={getX(idx)} y={svgHeight - 10} textAnchor="middle" fontSize="0.68rem" fill="var(--muted)">
                    Anno {d.year}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      </article>
    </div>
  );
};

