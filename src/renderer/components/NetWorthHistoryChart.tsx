import React, { useState, useMemo } from 'react';

type Transaction = {
  id: string;
  createdAt: number;
  date: string;
  merchant: string;
  category: string;
  subcategory: string;
  account: string;
  amount: number;
  kind: 'expense' | 'income';
  note: string;
};

type AssetTransaction = {
  id: string;
  assetId: string;
  date: string;
  kind: 'buy' | 'sell';
  quantity: number;
  unitValue: number;
  note?: string;
  createdAt: number;
};

type Asset = {
  id: string;
  name: string;
  kind: string;
  institution: string;
  account?: string;
  quantity: number;
  unitValue: number;
  note?: string;
  updatedAt?: string;
  ticker?: string;
};

interface NetWorthHistoryChartProps {
  transactions: Transaction[];
  assetTransactions: AssetTransaction[];
  assets: Asset[];
  accountInitialCapitals: Record<string, number>;
  storedOpeningCash: number;
  openingDate: string;
  formatEuro: (val: number) => string;
}

export const NetWorthHistoryChart: React.FC<NetWorthHistoryChartProps> = ({
  transactions,
  assetTransactions,
  assets,
  accountInitialCapitals,
  storedOpeningCash,
  openingDate,
  formatEuro,
}) => {
  const [timeRange, setTimeRange] = useState<'6m' | '1y' | '3y' | 'all'>('1y');
  const [hoveredPoint, setHoveredPoint] = useState<{
    dateStr: string;
    label: string;
    cash: number;
    investments: number;
    total: number;
  } | null>(null);

  // Generate monthly timeline points
  const timelineData = useMemo(() => {
    const today = new Date();
    const monthsCount = timeRange === '6m' ? 6 : timeRange === '1y' ? 12 : timeRange === '3y' ? 36 : 60;

    const baseOpeningCash = Object.keys(accountInitialCapitals).length > 0
      ? Object.values(accountInitialCapitals).reduce((a, b) => a + (b || 0), 0)
      : storedOpeningCash;

    // Asset unit values map
    const assetUnitMap = new Map<string, number>();
    assets.forEach((a) => assetUnitMap.set(a.id, a.unitValue));

    // Sort transactions chronologically
    const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    const sortedAssetTxs = [...assetTransactions].sort((a, b) => a.date.localeCompare(b.date));

    const points: Array<{
      dateStr: string;
      label: string;
      cash: number;
      investments: number;
      total: number;
    }> = [];

    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i + 1, 0); // End of month
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      const dayStr = String(d.getDate()).padStart(2, '0');
      const pointDateStr = `${yStr}-${mStr}-${dayStr}`;

      const monthNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
      const monthLabel = `${monthNames[d.getMonth()]} ${String(yStr).slice(2)}`;

      // 1. Calculate cumulative cash balance up to this date
      let cumulativeCash = baseOpeningCash;
      for (const tx of sortedTxs) {
        if (tx.date <= pointDateStr) {
          cumulativeCash += tx.amount;
        }
      }

      // 2. Calculate cumulative asset holdings and value up to this date
      const quantities = new Map<string, number>();
      for (const atx of sortedAssetTxs) {
        if (atx.date <= pointDateStr) {
          const currentQty = quantities.get(atx.assetId) || 0;
          if (atx.kind === 'buy') {
            quantities.set(atx.assetId, currentQty + atx.quantity);
          } else {
            quantities.set(atx.assetId, Math.max(0, currentQty - atx.quantity));
          }
        }
      }

      let cumulativeInvestments = 0;
      quantities.forEach((qty, aId) => {
        const uVal = assetUnitMap.get(aId) || 0;
        cumulativeInvestments += qty * uVal;
      });

      // If no asset transactions recorded yet, use static assets current value
      if (sortedAssetTxs.length === 0 && assets.length > 0) {
        cumulativeInvestments = assets.reduce((sum, a) => sum + (a.quantity * a.unitValue), 0);
      }

      const totalNW = cumulativeCash + cumulativeInvestments;

      points.push({
        dateStr: pointDateStr,
        label: monthLabel,
        cash: cumulativeCash,
        investments: cumulativeInvestments,
        total: totalNW,
      });
    }

    return points;
  }, [timeRange, transactions, assetTransactions, assets, accountInitialCapitals, storedOpeningCash]);

  // Overall metrics
  const firstPoint = timelineData[0] || { total: 0, cash: 0, investments: 0 };
  const lastPoint = timelineData[timelineData.length - 1] || { total: 0, cash: 0, investments: 0 };
  const diffVal = lastPoint.total - firstPoint.total;
  const diffPct = firstPoint.total > 0 ? (diffVal / firstPoint.total) * 100 : 0;
  const monthlyAvgGrowth = timelineData.length > 1 ? diffVal / (timelineData.length - 1) : 0;

  // SVG Chart Dimensions
  const svgWidth = 860;
  const svgHeight = 280;
  const paddingX = 50;
  const paddingY = 40;

  const minTotal = Math.min(...timelineData.map((p) => p.total), 0);
  const maxTotal = Math.max(...timelineData.map((p) => p.total), 1000);
  const rangeY = (maxTotal - minTotal) || 1;

  const getX = (idx: number) => paddingX + (idx / Math.max(1, timelineData.length - 1)) * (svgWidth - 2 * paddingX);
  const getY = (val: number) => svgHeight - paddingY - ((val - minTotal) / rangeY) * (svgHeight - 2 * paddingY);

  // SVG Path calculation
  const totalPathData = timelineData.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.total)}`).join(' ');
  const totalAreaPathData = `${totalPathData} L ${getX(timelineData.length - 1)} ${svgHeight - paddingY} L ${getX(0)} ${svgHeight - paddingY} Z`;

  const cashPathData = timelineData.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.cash)}`).join(' ');
  const investPathData = timelineData.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.investments)}`).join(' ');

  return (
    <article className="panel large-panel" style={{ margin: 0 }}>
      {/* Header and Controls */}
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <p className="panel-title">Evoluzione del Patrimonio Netto</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
              {formatEuro(lastPoint.total)}
            </h3>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 650,
                color: diffVal >= 0 ? '#10b981' : '#f43f5e',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              {diffVal >= 0 ? '▲ +' : '▼ '}{formatEuro(diffVal)} ({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(1)}%)
            </span>
          </div>
        </div>

        {/* Time range selector tabs */}
        <div style={{ display: 'flex', gap: '4px', background: 'var(--overlay-subtle)', padding: '3px', borderRadius: '10px', border: '1px solid var(--border)' }}>
          {[
            { id: '6m', label: '6 Mesi' },
            { id: '1y', label: '1 Anno' },
            { id: '3y', label: '3 Anni' },
            { id: 'all', label: '5 Anni / Tutto' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTimeRange(item.id as any)}
              style={{
                padding: '4px 10px',
                borderRadius: '7px',
                fontSize: '0.74rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: timeRange === item.id ? 'var(--accent)' : 'transparent',
                color: timeRange === item.id ? 'var(--pill-primary-text)' : 'var(--muted)',
                transition: 'all 0.15s ease',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Breakdown stat pills */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '14px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#38bdf8' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            Liquidità: <strong style={{ color: 'var(--text)' }}>{formatEuro(lastPoint.cash)}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#c084fc' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            Investimenti: <strong style={{ color: 'var(--text)' }}>{formatEuro(lastPoint.investments)}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#10b981' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            Crescita media mensile: <strong style={{ color: '#10b981' }}>+{formatEuro(monthlyAvgGrowth)}/mese</strong>
          </span>
        </div>
      </div>

      {/* SVG Chart */}
      <div style={{ position: 'relative', width: '100%', overflowX: 'auto', background: 'var(--panel-card-bg)', borderRadius: '14px', padding: '10px 0', border: '1px solid var(--border)' }}>
        <svg
          width="100%"
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ overflow: 'visible', display: 'block' }}
        >
          <defs>
            <linearGradient id="nw-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
            const yVal = minTotal + pct * rangeY;
            const y = getY(yVal);
            return (
              <g key={`grid-${idx}`}>
                <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
                <text x={paddingX - 8} y={y + 3} textAnchor="end" fontSize="0.65rem" fill="var(--muted)">
                  {formatEuro(yVal)}
                </text>
              </g>
            );
          })}

          {/* Area fill for total net worth */}
          <path d={totalAreaPathData} fill="url(#nw-gradient)" />

          {/* Cash line */}
          <path d={cashPathData} fill="none" stroke="#38bdf8" strokeWidth={1.8} strokeDasharray="4 2" opacity={0.7} />

          {/* Investments line */}
          <path d={investPathData} fill="none" stroke="#c084fc" strokeWidth={1.8} strokeDasharray="4 2" opacity={0.7} />

          {/* Total Net Worth main line */}
          <path d={totalPathData} fill="none" stroke="#10b981" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />

          {/* Points & Interactive circles */}
          {timelineData.map((pt, idx) => {
            const x = getX(idx);
            const y = getY(pt.total);
            const isHovered = hoveredPoint?.dateStr === pt.dateStr;

            return (
              <g key={`pt-${idx}`}>
                {/* Vertical guide when hovered */}
                {isHovered && (
                  <line x1={x} y1={paddingY} x2={x} y2={svgHeight - paddingY} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 2" />
                )}

                <circle
                  cx={x}
                  cy={y}
                  r={isHovered ? 6 : 3.5}
                  fill="#10b981"
                  stroke="var(--panel-strong)"
                  strokeWidth={2}
                  style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                />

                {/* X Axis Labels */}
                {(timelineData.length <= 12 || idx % Math.ceil(timelineData.length / 8) === 0 || idx === timelineData.length - 1) && (
                  <text x={x} y={svgHeight - 12} textAnchor="middle" fontSize="0.68rem" fill="var(--muted)">
                    {pt.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover card floating detail */}
        {hoveredPoint && (
          <div
            style={{
              position: 'absolute',
              top: '16px',
              right: '24px',
              padding: '10px 14px',
              background: 'var(--panel-strong)',
              borderRadius: '10px',
              border: '1px solid var(--border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              fontSize: '0.78rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <strong style={{ color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: '3px' }}>
              {hoveredPoint.label} ({hoveredPoint.dateStr})
            </strong>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
              <span style={{ color: 'var(--muted)' }}>Liquidità:</span>
              <strong style={{ color: '#38bdf8' }}>{formatEuro(hoveredPoint.cash)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
              <span style={{ color: 'var(--muted)' }}>Asset Investiti:</span>
              <strong style={{ color: '#c084fc' }}>{formatEuro(hoveredPoint.investments)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', borderTop: '1px solid var(--border)', paddingTop: '3px' }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>Patrimonio Totale:</span>
              <strong style={{ color: '#10b981' }}>{formatEuro(hoveredPoint.total)}</strong>
            </div>
          </div>
        )}
      </div>
    </article>
  );
};
