import React, { useState, useMemo } from 'react';

type TransactionKind = 'expense' | 'income';

type Transaction = {
  id: string;
  createdAt: number;
  date: string; // YYYY-MM-DD
  merchant: string;
  category: string;
  subcategory: string;
  account: string;
  amount: number;
  kind: TransactionKind;
  note: string;
  needsReimbursement?: boolean;
  reimbursesTransactionId?: string;
};

export function isTransferCategory(category?: string, subcategory?: string): boolean {
  if (!category && !subcategory) return false;
  const cat = (category || '').trim().toLowerCase();
  const sub = (subcategory || '').trim().toLowerCase();
  const keywords = ['trasferimento', 'trasferimenti', 'giroconto', 'giroconti', 'transfer', 'transfers'];
  return keywords.some((kw) => cat.includes(kw) || sub.includes(kw));
}

interface CategoryTrendReportProps {
  transactions: Transaction[];
  formatEuro: (val: number) => string;
  formatSignedEuro: (val: number) => string;
}

export const CategoryTrendReport: React.FC<CategoryTrendReportProps> = ({
  transactions,
  formatEuro,
  formatSignedEuro,
}) => {
  // Generate the 6 consecutive calendar months ending with current month
  const sixMonths = useMemo(() => {
    const list: { key: string; label: string; fullLabel: string; year: number; month: number }[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
      const fullLabel = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      list.push({ key, label, fullLabel, year, month });
    }
    return list;
  }, []);

  // Discover all expense categories and compute their 6-month totals to find the most relevant ones (excluding internal transfers)
  const { allCategories, categoryTotals6M, topCategories } = useMemo(() => {
    const totals: Record<string, number> = {};
    const set = new Set<string>();

    const sixMonthsKeys = new Set(sixMonths.map((m) => m.key));

    transactions.forEach((tx) => {
      if (tx.kind === 'expense' && !isTransferCategory(tx.category, tx.subcategory)) {
        const cat = tx.category?.trim() || 'Altro';
        set.add(cat);
        const txMonthKey = tx.date.slice(0, 7);
        if (sixMonthsKeys.has(txMonthKey)) {
          totals[cat] = (totals[cat] || 0) + Math.abs(tx.amount);
        }
      }
    });

    const sorted = Array.from(set).sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
    return {
      allCategories: sorted,
      categoryTotals6M: totals,
      topCategories: sorted.slice(0, 5),
    };
  }, [transactions, sixMonths]);

  // Selected category (default to top 1 spending category or 'all')
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    return allCategories.length > 0 ? allCategories[0] : 'all';
  });

  const [hoveredMonthKey, setHoveredMonthKey] = useState<string | null>(null);

  // Compute 6-month trend data for selected category
  const trendData = useMemo(() => {
    const isAll = selectedCategory === 'all';

    const monthData = sixMonths.map((m, idx) => {
      const txsInMonth = transactions.filter((tx) => {
        if (tx.kind !== 'expense') return false;
        if (isTransferCategory(tx.category, tx.subcategory)) return false;
        if (!tx.date.startsWith(m.key)) return false;
        if (!isAll && tx.category?.trim().toLowerCase() !== selectedCategory.toLowerCase()) {
          return false;
        }
        return true;
      });

      const totalSpent = txsInMonth.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
      const txCount = txsInMonth.length;
      const avgTx = txCount > 0 ? totalSpent / txCount : 0;

      // Subcategory breakdown
      const subMap: Record<string, number> = {};
      txsInMonth.forEach((tx) => {
        if (isTransferCategory(tx.category, tx.subcategory)) return;
        const sub = tx.subcategory?.trim() || 'Non specificata';
        subMap[sub] = (subMap[sub] || 0) + Math.abs(tx.amount);
      });

      const topSubcategories = Object.entries(subMap)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

      return {
        ...m,
        totalSpent,
        txCount,
        avgTx,
        topSubcategories,
        txs: txsInMonth.sort((a, b) => b.date.localeCompare(a.date)),
      };
    });

    // Compute Month-over-Month (MoM) variations
    const enrichedMonths = monthData.map((curr, idx) => {
      if (idx === 0) {
        return {
          ...curr,
          momDiffVal: 0,
          momDiffPct: 0,
          isFirst: true,
        };
      }

      const prev = monthData[idx - 1];
      const momDiffVal = curr.totalSpent - prev.totalSpent;
      let momDiffPct = 0;

      if (prev.totalSpent > 0) {
        momDiffPct = ((curr.totalSpent - prev.totalSpent) / prev.totalSpent) * 100;
      } else if (curr.totalSpent > 0) {
        momDiffPct = 100; // New expense appeared
      }

      return {
        ...curr,
        momDiffVal,
        momDiffPct,
        isFirst: false,
      };
    });

    // Summary statistics
    const totalSpent6M = enrichedMonths.reduce((sum, m) => sum + m.totalSpent, 0);
    const avgMonthly = totalSpent6M / 6;

    let peakMonth = enrichedMonths[0];
    enrichedMonths.forEach((m) => {
      if (m.totalSpent > peakMonth.totalSpent) {
        peakMonth = m;
      }
    });

    const latestMonth = enrichedMonths[enrichedMonths.length - 1];
    const prevMonth = enrichedMonths[enrichedMonths.length - 2];

    const latestVsAvgDiff = latestMonth ? latestMonth.totalSpent - avgMonthly : 0;
    const latestVsAvgPct = avgMonthly > 0 ? (latestVsAvgDiff / avgMonthly) * 100 : 0;

    return {
      months: enrichedMonths,
      totalSpent6M,
      avgMonthly,
      peakMonth,
      latestMonth,
      prevMonth,
      latestVsAvgDiff,
      latestVsAvgPct,
    };
  }, [sixMonths, transactions, selectedCategory]);

  // Comparative ranking of all categories by MoM change (identifying where user is spending more)
  const categoryMoMRanking = useMemo(() => {
    if (sixMonths.length < 2) {
      return {
        all: [],
        topIncreases: [],
        topDecreases: [],
        lastMonthLabel: '',
        prevMonthLabel: '',
      };
    }

    const lastMonthKey = sixMonths[sixMonths.length - 1].key;
    const prevMonthKey = sixMonths[sixMonths.length - 2].key;

    const rankList = allCategories.map((cat) => {
      let spentLast = 0;
      let spentPrev = 0;
      let spent6M = 0;

      transactions.forEach((tx) => {
        if (tx.kind === 'expense' && (tx.category?.trim().toLowerCase() === cat.toLowerCase())) {
          const amt = Math.abs(tx.amount);
          if (tx.date.startsWith(lastMonthKey)) spentLast += amt;
          if (tx.date.startsWith(prevMonthKey)) spentPrev += amt;
          spent6M += amt;
        }
      });

      const diffVal = spentLast - spentPrev;
      let diffPct = 0;
      if (spentPrev > 0) {
        diffPct = ((spentLast - spentPrev) / spentPrev) * 100;
      } else if (spentLast > 0) {
        diffPct = 100;
      }

      return {
        cat,
        spentLast,
        spentPrev,
        spent6M,
        diffVal,
        diffPct,
      };
    });

    // Top spenders with greatest positive increase
    const topIncreases = rankList
      .filter((r) => r.spentLast > 0 && r.diffVal > 0)
      .sort((a, b) => b.diffVal - a.diffVal);

    // Categories with savings / reduction
    const topDecreases = rankList
      .filter((r) => r.diffVal < 0)
      .sort((a, b) => a.diffVal - b.diffVal);

    return {
      all: rankList.sort((a, b) => b.spentLast - a.spentLast),
      topIncreases,
      topDecreases,
      lastMonthLabel: sixMonths[sixMonths.length - 1].fullLabel,
      prevMonthLabel: sixMonths[sixMonths.length - 2].fullLabel,
    };
  }, [allCategories, sixMonths, transactions]);

  // Chart layout dimensions
  const chartHeight = 220;
  const maxVal = Math.max(1, ...trendData.months.map((m) => m.totalSpent));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      {/* Header & Controls Panel */}
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>📉</span>
              <p className="panel-title" style={{ margin: 0 }}>Trend di Spesa 6 Mensilità &amp; Variazione Mese su Mese</p>
            </div>
            <h4 style={{ margin: '4px 0 0 0' }}>
              {selectedCategory === 'all'
                ? 'Andamento Spesa Totale negli ultimi 6 Mesi'
                : `Analisi Mensile Categoria: "${selectedCategory}"`}
            </h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
              Monitora l'evoluzione temporale, calcola la variazione percentuale (MoM) e individua dove stai spendendo di più.
            </p>
          </div>

          {/* Category Dropdown Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 600 }}>
              <span>Seleziona Categoria:</span>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                style={{
                  padding: '7px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'var(--input-bg)',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  fontWeight: 650,
                  minWidth: '200px',
                }}
              >
                <option value="all">🌐 Tutte le Categorie (Spesa Globale)</option>
                {allCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat} ({formatEuro(categoryTotals6M[cat] || 0)})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Quick Category Chips */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600 }}>Scelta rapida top categorie:</span>
          <button
            type="button"
            className="pill"
            onClick={() => setSelectedCategory('all')}
            style={{
              fontSize: '0.75rem',
              padding: '4px 10px',
              background: selectedCategory === 'all' ? 'var(--accent)' : 'var(--overlay-subtle)',
              color: selectedCategory === 'all' ? 'var(--pill-primary-text)' : 'var(--text)',
              fontWeight: selectedCategory === 'all' ? 700 : 500,
            }}
          >
            🌐 Tutte
          </button>
          {topCategories.map((cat) => (
            <button
              key={`chip-${cat}`}
              type="button"
              className="pill"
              onClick={() => setSelectedCategory(cat)}
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                background: selectedCategory === cat ? 'var(--accent)' : 'var(--overlay-subtle)',
                color: selectedCategory === cat ? 'var(--pill-primary-text)' : 'var(--text)',
                fontWeight: selectedCategory === cat ? 700 : 500,
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* 4 Summary KPI Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            marginTop: '16px',
            marginBottom: '20px',
          }}
        >
          {/* KPI 1: Spesa Totale 6 Mesi */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600 }}>Spesa Totale (6 Mesi)</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              {formatEuro(trendData.totalSpent6M)}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
              Totale cumulato da {sixMonths[0].label} a {sixMonths[5].label}
            </span>
          </div>

          {/* KPI 2: Media Mensile */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600 }}>Media Mensile</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#38bdf8', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              {formatEuro(trendData.avgMonthly)}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
              Spesa media attesa su 6 mesi
            </span>
          </div>

          {/* KPI 3: Variazione MoM Ultimo Mese */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600 }}>
              Variazione Ultimo Mese ({trendData.latestMonth?.label})
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
              <span
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  color: trendData.latestMonth.momDiffVal > 0 ? '#fb7185' : trendData.latestMonth.momDiffVal < 0 ? '#10b981' : 'var(--text)',
                }}
              >
                {trendData.latestMonth.momDiffVal > 0 ? `+${trendData.latestMonth.momDiffPct.toFixed(1)}%` : `${trendData.latestMonth.momDiffPct.toFixed(1)}%`}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600 }}>
                ({trendData.latestMonth.momDiffVal >= 0 ? `+${formatEuro(trendData.latestMonth.momDiffVal)}` : formatEuro(trendData.latestMonth.momDiffVal)})
              </span>
            </div>
            <span style={{ fontSize: '0.7rem', color: trendData.latestMonth.momDiffVal > 0 ? '#fb7185' : '#10b981', marginTop: '2px', display: 'block' }}>
              {trendData.latestMonth.momDiffVal > 0 ? '⚠️ Spesa in aumento rispetto al mese precedente' : trendData.latestMonth.momDiffVal < 0 ? '✓ Spesa in calo (risparmio)' : 'Stabile'}
            </span>
          </div>

          {/* KPI 4: Mese con Picco Massimo */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 600 }}>Mese di Massimo Rincaro / Picco</span>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f59e0b', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
              {formatEuro(trendData.peakMonth.totalSpent)}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px', display: 'block' }}>
              Raggiunto in <strong>{trendData.peakMonth.fullLabel}</strong>
            </span>
          </div>
        </div>

        {/* SVG Interactive Trend Chart */}
        <div style={{ padding: '20px', borderRadius: '14px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>
                Grafico Istogramma Mensile con Indicatore MoM
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                (Passa sopra alle barre per i dettagli)
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.74rem', color: 'var(--muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6' }} />
                Spesa del Mese
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#f59e0b' }} />
                Mese di Picco
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '18px', height: '2px', borderTop: '2px dashed #94a3b8' }} />
                Media 6 Mesi ({formatEuro(trendData.avgMonthly)})
              </span>
            </div>
          </div>

          <div style={{ width: '100%', overflowX: 'auto' }}>
            <svg viewBox={`0 0 640 ${chartHeight}`} style={{ width: '100%', minWidth: '540px', height: 'auto', overflow: 'visible' }}>
              {/* Average Baseline Line */}
              {(() => {
                const avgY = chartHeight - 50 - (trendData.avgMonthly / maxVal) * (chartHeight - 85);
                return (
                  <g>
                    <line
                      x1="30"
                      y1={avgY}
                      x2="610"
                      y2={avgY}
                      stroke="#94a3b8"
                      strokeWidth="1.5"
                      strokeDasharray="4,4"
                      opacity="0.6"
                    />
                    <text
                      x="615"
                      y={avgY + 4}
                      fill="#94a3b8"
                      fontSize="9"
                      fontWeight="600"
                      textAnchor="start"
                    >
                      Media
                    </text>
                  </g>
                );
              })()}

              {/* 6 Monthly Bars */}
              {trendData.months.map((m, idx) => {
                const colWidth = 60;
                const gap = (600 - 6 * colWidth) / 5;
                const x = 30 + idx * (colWidth + gap);
                const usableHeight = chartHeight - 85;
                const barHeight = maxVal > 0 ? Math.max(4, (m.totalSpent / maxVal) * usableHeight) : 4;
                const y = chartHeight - 50 - barHeight;

                const isPeak = m.totalSpent === trendData.peakMonth.totalSpent && m.totalSpent > 0;
                const isHovered = hoveredMonthKey === m.key;
                const barColor = isPeak ? '#f59e0b' : isHovered ? '#60a5fa' : '#3b82f6';

                return (
                  <g
                    key={`bar-${m.key}`}
                    onMouseEnter={() => setHoveredMonthKey(m.key)}
                    onMouseLeave={() => setHoveredMonthKey(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Background hover pillar */}
                    <rect
                      x={x - 8}
                      y={10}
                      width={colWidth + 16}
                      height={chartHeight - 30}
                      fill={isHovered ? 'var(--overlay-medium)' : 'transparent'}
                      rx={8}
                      style={{ transition: 'fill 0.15s ease' }}
                    />

                    {/* Bar */}
                    <rect
                      x={x}
                      y={y}
                      width={colWidth}
                      height={barHeight}
                      fill={barColor}
                      rx={6}
                      style={{ transition: 'all 0.2s ease' }}
                    />

                    {/* Direct Euro Label on top of Bar */}
                    <text
                      x={x + colWidth / 2}
                      y={y - 8}
                      fill={isPeak ? '#f59e0b' : 'var(--text)'}
                      fontSize="11"
                      fontWeight="700"
                      textAnchor="middle"
                      fontFamily="var(--font-mono)"
                    >
                      {formatEuro(m.totalSpent)}
                    </text>

                    {/* Month Label below Bar */}
                    <text
                      x={x + colWidth / 2}
                      y={chartHeight - 34}
                      fill={isHovered ? 'var(--text)' : 'var(--muted)'}
                      fontSize="11"
                      fontWeight={isHovered ? 700 : 600}
                      textAnchor="middle"
                    >
                      {m.label}
                    </text>

                    {/* MoM % Change Badge below Month Label */}
                    {!m.isFirst ? (
                      <g>
                        <rect
                          x={x + colWidth / 2 - 28}
                          y={chartHeight - 26}
                          width="56"
                          height="16"
                          rx="4"
                          fill={m.momDiffVal > 0 ? 'rgba(251, 113, 133, 0.15)' : m.momDiffVal < 0 ? 'rgba(16, 185, 129, 0.15)' : 'var(--overlay-medium)'}
                        />
                        <text
                          x={x + colWidth / 2}
                          y={chartHeight - 14}
                          fill={m.momDiffVal > 0 ? '#fb7185' : m.momDiffVal < 0 ? '#10b981' : 'var(--muted)'}
                          fontSize="9.5"
                          fontWeight="750"
                          textAnchor="middle"
                          fontFamily="var(--font-mono)"
                        >
                          {m.momDiffVal > 0 ? `↑ +${m.momDiffPct.toFixed(0)}%` : m.momDiffVal < 0 ? `↓ ${m.momDiffPct.toFixed(0)}%` : '0%'}
                        </text>
                      </g>
                    ) : (
                      <text
                        x={x + colWidth / 2}
                        y={chartHeight - 14}
                        fill="var(--muted)"
                        fontSize="8.5"
                        textAnchor="middle"
                      >
                        (Base)
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Detailed 6-Month Data Table */}
        <div style={{ marginTop: '20px' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>
            Riepilogo Dettagliato Mensile e Variazioni Mese su Mese
          </div>
          <div className="transaction-table" style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Mese</th>
                  <th style={{ textAlign: 'right' }}>Spesa Totale</th>
                  <th style={{ textAlign: 'right' }}>Variazione vs Mese Prec. (€)</th>
                  <th style={{ textAlign: 'right' }}>Variazione MoM (%)</th>
                  <th style={{ textAlign: 'right' }}>N° Transazioni</th>
                  <th style={{ textAlign: 'right' }}>Scontrino Medio</th>
                  <th>Sottocategorie Principali</th>
                </tr>
              </thead>
              <tbody>
                {trendData.months.map((m) => {
                  const isUp = m.momDiffVal > 0;
                  const isDown = m.momDiffVal < 0;

                  return (
                    <tr key={`table-row-${m.key}`} style={{ background: hoveredMonthKey === m.key ? 'var(--overlay-subtle)' : 'transparent' }}>
                      <td>
                        <strong style={{ fontSize: '0.85rem' }}>{m.fullLabel}</strong>
                        {m.totalSpent === trendData.peakMonth.totalSpent && m.totalSpent > 0 && (
                          <span style={{ marginLeft: '6px', fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontWeight: 700 }}>
                            Picco
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {formatEuro(m.totalSpent)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {m.isFirst ? (
                          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>-</span>
                        ) : (
                          <span style={{ color: isUp ? '#fb7185' : isDown ? '#10b981' : 'var(--muted)', fontWeight: 650 }}>
                            {formatSignedEuro(m.momDiffVal)}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {m.isFirst ? (
                          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Base iniziale</span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              background: isUp ? 'rgba(251, 113, 133, 0.15)' : isDown ? 'rgba(16, 185, 129, 0.15)' : 'var(--overlay-subtle)',
                              color: isUp ? '#fb7185' : isDown ? '#10b981' : 'var(--muted)',
                            }}
                          >
                            {isUp ? `+${m.momDiffPct.toFixed(1)}%` : `${m.momDiffPct.toFixed(1)}%`}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                        {m.txCount} op.
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        {formatEuro(m.avgTx)}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                        {m.topSubcategories.length > 0 ? (
                          <span>
                            {m.topSubcategories.slice(0, 2).map((s) => `${s.name} (${formatEuro(s.amount)})`).join(', ')}
                            {m.topSubcategories.length > 2 && ` + altri ${m.topSubcategories.length - 2}`}
                          </span>
                        ) : (
                          <span style={{ fontStyle: 'italic' }}>Nessuna spesa</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </article>

      {/* "Dove stai spendendo di più?" - Comparative Ranking Table */}
      <article className="panel large-panel" style={{ margin: 0 }}>
        <div className="panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>🔍</span>
              <p className="panel-title" style={{ margin: 0 }}>Dove Stai Spendendo di Più?</p>
            </div>
            <h4 style={{ margin: '4px 0 0 0' }}>Confronto Rincari &amp; Risparmi tra Categorie ({categoryMoMRanking.prevMonthLabel} ➔ {categoryMoMRanking.lastMonthLabel})</h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
              Fai clic su qualsiasi categoria per caricarne istantaneamente il trend semestrale dettagliato nel grafico in alto.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* Box 1: Categorie con Maggiore Aumento (Spendi di più!) */}
          <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
              <span style={{ fontSize: '1rem' }}>📈</span>
              <strong style={{ fontSize: '0.88rem', color: '#fb7185' }}>Maggiori Aumenti di Spesa (Mese su Mese)</strong>
            </div>

            {categoryMoMRanking.topIncreases.length === 0 ? (
              <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--overlay-subtle)', color: 'var(--muted)', fontSize: '0.78rem', textAlign: 'center' }}>
                ✓ Ottime notizie! Nessuna categoria presenta rincari rispetto al mese precedente.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {categoryMoMRanking.topIncreases.slice(0, 6).map((item) => (
                  <div
                    key={`inc-${item.cat}`}
                    onClick={() => setSelectedCategory(item.cat)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: selectedCategory === item.cat ? 'rgba(251, 113, 133, 0.15)' : 'var(--overlay-subtle)',
                      border: `1px solid ${selectedCategory === item.cat ? 'rgba(251, 113, 133, 0.4)' : 'var(--border)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title="Clicca per aprire il trend di questa categoria"
                  >
                    <div>
                      <strong style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{item.cat}</strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'block' }}>
                        Spesi: {formatEuro(item.spentLast)} (era {formatEuro(item.spentPrev)})
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fb7185', fontFamily: 'var(--font-mono)' }}>
                        +{formatEuro(item.diffVal)}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#fb7185', fontWeight: 700, display: 'block' }}>
                        +{item.diffPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Box 2: Categorie con Maggiore Risparmio (Spendi di meno!) */}
          <div style={{ padding: '16px', borderRadius: '14px', background: 'var(--panel-card-bg)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
              <span style={{ fontSize: '1rem' }}>🎉</span>
              <strong style={{ fontSize: '0.88rem', color: '#10b981' }}>Maggiori Risparmi (Spesa in Calo)</strong>
            </div>

            {categoryMoMRanking.topDecreases.length === 0 ? (
              <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--overlay-subtle)', color: 'var(--muted)', fontSize: '0.78rem', textAlign: 'center' }}>
                Nessuna riduzione di spesa rilevata nell'ultimo mese.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {categoryMoMRanking.topDecreases.slice(0, 6).map((item) => (
                  <div
                    key={`dec-${item.cat}`}
                    onClick={() => setSelectedCategory(item.cat)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: selectedCategory === item.cat ? 'rgba(16, 185, 129, 0.15)' : 'var(--overlay-subtle)',
                      border: `1px solid ${selectedCategory === item.cat ? 'rgba(16, 185, 129, 0.4)' : 'var(--border)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title="Clicca per aprire il trend di questa categoria"
                  >
                    <div>
                      <strong style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{item.cat}</strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'block' }}>
                        Spesi: {formatEuro(item.spentLast)} (era {formatEuro(item.spentPrev)})
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                        {formatEuro(item.diffVal)}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700, display: 'block' }}>
                        {item.diffPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  );
};
