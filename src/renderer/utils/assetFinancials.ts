/**
 * Asset Financial Calculations: Prezzo Medio di Carico (PMC) and Return on Investment (ROI)
 * Calculates weighted cost basis from historical transactions and compares against current live quotation.
 */

export interface AssetPerformance {
  pmc: number; // Prezzo Medio di Carico (€)
  currentPrice: number; // Quotazione di mercato attuale (€)
  currentQuantity: number; // Quantità attualmente detenuta
  totalCostInvested: number; // PMC * Quantità attuale (capitale investito residuo)
  totalMarketValue: number; // Quotazione * Quantità attuale (controvalore attuale di mercato)
  pnlEuro: number; // Plusvalenza / Minusvalenza assoluta (€)
  roiPercent: number; // Rendimento percentuale (%) = ((currentPrice - pmc) / pmc) * 100
  totalHistoricalBoughtQty: number; // Quantità totale acquistata storicamente
  totalHistoricalBoughtCost: number; // Totale speso negli acquisti storici (€)
  hasTransactions: boolean; // True se l'asset ha transazioni storiche registrate
}

/**
 * Computes PMC and ROI for an asset.
 * - Sorts historical transactions chronologically.
 * - Calculates weighted average purchase price (PMC).
 * - Compares with live market price to compute ROI % and PnL.
 */
export function computeAssetPerformance(
  asset: { id: string; quantity: number; unitValue: number; ticker?: string },
  assetTransactions: Array<{
    assetId: string;
    kind: 'buy' | 'sell';
    quantity: number;
    unitValue: number;
    date?: string;
    createdAt?: number;
  }>,
  currentPrice: number,
  currentQuantity: number
): AssetPerformance {
  const txs = (assetTransactions || []).filter((tx) => tx.assetId === asset.id);

  let pmc = 0;
  let totalHistoricalBoughtQty = 0;
  let totalHistoricalBoughtCost = 0;

  if (txs.length > 0) {
    // Sort transactions chronologically (by date ascending, then createdAt)
    const sortedTxs = [...txs].sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    let rollingQty = 0;
    let rollingCost = 0;

    for (const tx of sortedTxs) {
      if (tx.kind === 'buy') {
        rollingCost += tx.quantity * tx.unitValue;
        rollingQty += tx.quantity;
        totalHistoricalBoughtQty += tx.quantity;
        totalHistoricalBoughtCost += tx.quantity * tx.unitValue;
        pmc = rollingQty > 0 ? rollingCost / rollingQty : tx.unitValue;
      } else if (tx.kind === 'sell') {
        rollingQty = Math.max(0, rollingQty - tx.quantity);
        rollingCost = rollingQty * pmc;
      }
    }

    // Fallback to cumulative buy weighted average if rolling gave 0
    if (pmc <= 0 && totalHistoricalBoughtQty > 0) {
      pmc = totalHistoricalBoughtCost / totalHistoricalBoughtQty;
    }
    if (pmc <= 0) {
      pmc = asset.unitValue || 0;
    }
  } else {
    // No transaction history: cost basis is the asset's unitValue
    pmc = asset.unitValue || 0;
  }

  const effectiveQty = Math.max(0, currentQuantity);
  const effectivePrice = Math.max(0, currentPrice);
  const totalCostInvested = effectiveQty * pmc;
  const totalMarketValue = effectiveQty * effectivePrice;
  const pnlEuro = totalMarketValue - totalCostInvested;
  const roiPercent = pmc > 0 ? ((effectivePrice - pmc) / pmc) * 100 : 0;

  return {
    pmc,
    currentPrice: effectivePrice,
    currentQuantity: effectiveQty,
    totalCostInvested,
    totalMarketValue,
    pnlEuro,
    roiPercent,
    totalHistoricalBoughtQty,
    totalHistoricalBoughtCost,
    hasTransactions: txs.length > 0,
  };
}
