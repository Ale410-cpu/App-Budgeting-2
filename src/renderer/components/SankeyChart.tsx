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
  reimbursesTransactionId?: string;
};

export type BudgetSubcategory = {
  id: string;
  name: string;
  limit?: number;
  note?: string;
};

export type BudgetCategory = {
  id: string;
  name: string;
  limit?: number;
  color?: string;
  note?: string;
  subcategories?: BudgetSubcategory[];
};

export interface SankeyChartProps {
  transactions: Transaction[];
  budgetCategories?: BudgetCategory[];
  formatEuro: (val: number) => string;
}

interface SankeyNode {
  id: string;
  label: string;
  value: number;
  color: string;
  column: 0 | 1 | 2;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface SankeyLink {
  sourceId: string;
  targetId: string;
  value: number;
  color: string;
  sourceY0?: number;
  sourceY1?: number;
  targetY0?: number;
  targetY1?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Spesa alimentare': '#10b981',
  'Alimentari': '#10b981',
  'Supermercato': '#10b981',
  'Trasporti': '#0ea5e9',
  'Auto & Carburante': '#0ea5e9',
  'Casa': '#f59e0b',
  'Utenze': '#f59e0b',
  'Affitto': '#f59e0b',
  'Salute': '#ec4899',
  'Ristoranti': '#8b5cf6',
  'Bar & Ristoranti': '#8b5cf6',
  'Tempo libero': '#a855f7',
  'Shopping': '#ec4899',
  'Abbonamenti': '#6366f1',
  'Viaggi': '#14b8a6',
  'Istruzione': '#06b6d4',
  'Investimenti': '#3b82f6',
  'PAC': '#3b82f6',
  'Risparmio': '#34d399',
  'Altro': '#94a3b8',
};

const DEFAULT_CATEGORY_COLOR = '#64748b';

export type Rule503020Bucket = 'needs' | 'wants' | 'savings';
export type Rule503020Mapping = Record<string, Rule503020Bucket>;

export function isTransferCategory(category?: string, subcategory?: string): boolean {
  if (!category && !subcategory) return false;
  const cat = (category || '').trim().toLowerCase();
  const sub = (subcategory || '').trim().toLowerCase();
  const keywords = ['trasferimento', 'trasferimenti', 'giroconto', 'giroconti', 'transfer', 'transfers'];
  return keywords.some((kw) => cat.includes(kw) || sub.includes(kw));
}

const STORAGE_KEY_503020 = 'budget-ledger-50-30-20-rules-v2';

export const DEFAULT_503020_RULES: Record<string, Rule503020Bucket> = {
  // Necessità (50%)
  'casa': 'needs',
  'affitto': 'needs',
  'mutuo': 'needs',
  'utenze': 'needs',
  'bollette': 'needs',
  'spesa alimentare': 'needs',
  'alimentari': 'needs',
  'supermercato': 'needs',
  'salute': 'needs',
  'farmacia': 'needs',
  'medico': 'needs',
  'trasporti': 'needs',
  'auto & carburante': 'needs',
  'assicurazioni': 'needs',
  'tasse': 'needs',
  'condominio': 'needs',
  'istruzione': 'needs',

  // Svago & Variabili / Desideri (30%)
  'ristoranti': 'wants',
  'bar & ristoranti': 'wants',
  'tempo libero': 'wants',
  'svago': 'wants',
  'shopping': 'wants',
  'abbonamenti': 'wants',
  'viaggi': 'wants',
  'sport': 'wants',
  'hobby': 'wants',
  'regali': 'wants',
  'altro': 'wants',

  // Risparmio & Investimenti (20%)
  'risparmio': 'savings',
  'investimenti': 'savings',
  'pac': 'savings',
  'fondo pensione': 'savings',
  'fondo emergenza': 'savings',
  'cripto': 'savings',
};

export function getCategoryBucket(categoryName: string, userMappings: Rule503020Mapping): Rule503020Bucket {
  const norm = (categoryName || '').trim().toLowerCase();
  if (userMappings[norm]) {
    return userMappings[norm];
  }
  for (const [key, b] of Object.entries(userMappings)) {
    if (!key.includes('::') && (norm === key.toLowerCase() || norm.includes(key.toLowerCase()) || key.toLowerCase().includes(norm))) {
      return b;
    }
  }
  if (DEFAULT_503020_RULES[norm]) {
    return DEFAULT_503020_RULES[norm];
  }
  // Heuristic keywords
  if (/(affitto|mutuo|bollett|utenz|spesa|alimentar|supermercat|salute|farmac|medic|trasport|assicuraz|tass|condomini|luce|gas|acqua|internet)/.test(norm)) {
    return 'needs';
  }
  if (/(risparmi|investiment|pac|fondo|cripto|crypto|pensione|etf)/.test(norm)) {
    return 'savings';
  }
  return 'wants';
}

export function getSubcategoryBucket(
  categoryName: string,
  subcategoryName: string,
  userMappings: Rule503020Mapping
): { bucket: Rule503020Bucket; isInherited: boolean } {
  const catNorm = (categoryName || '').trim().toLowerCase();
  const subNorm = (subcategoryName || '').trim().toLowerCase();
  const key = `${catNorm}::${subNorm}`;
  if (userMappings[key]) {
    return { bucket: userMappings[key], isInherited: false };
  }
  if (subNorm && userMappings[`sub::${subNorm}`]) {
    return { bucket: userMappings[`sub::${subNorm}`], isInherited: false };
  }
  // Inherit from category
  const parentBucket = getCategoryBucket(categoryName, userMappings);
  return { bucket: parentBucket, isInherited: true };
}

export function getTransactionBucket(
  categoryName: string,
  subcategoryName: string,
  userMappings: Rule503020Mapping
): Rule503020Bucket {
  if (subcategoryName) {
    const subRes = getSubcategoryBucket(categoryName, subcategoryName, userMappings);
    if (!subRes.isInherited) {
      return subRes.bucket;
    }
  }
  return getCategoryBucket(categoryName, userMappings);
}

export const SankeyChart: React.FC<SankeyChartProps> = ({ transactions, budgetCategories = [], formatEuro }) => {
  const [userMappings, setUserMappings] = useState<Rule503020Mapping>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_503020);
      if (saved) return JSON.parse(saved);
    } catch {}
    return { ...DEFAULT_503020_RULES };
  });

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [configSearch, setConfigSearch] = useState('');
  const [configFilterBucket, setConfigFilterBucket] = useState<'all' | 'needs' | 'wants' | 'savings' | 'overridden'>('all');
  const [customCatInput, setCustomCatInput] = useState('');
  const [customCatBucket, setCustomCatBucket] = useState<Rule503020Bucket>('needs');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  const toggleCategoryExpand = (catIdOrName: string) => {
    setExpandedCats((prev) => ({
      ...prev,
      [catIdOrName]: prev[catIdOrName] === undefined ? false : !prev[catIdOrName],
    }));
  };

  const handleUpdateCategoryBucket = (categoryName: string, bucket: Rule503020Bucket) => {
    const norm = categoryName.trim().toLowerCase();
    setUserMappings((prev) => {
      const next = { ...prev, [norm]: bucket };
      try {
        localStorage.setItem(STORAGE_KEY_503020, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleUpdateSubcategoryBucket = (
    categoryName: string,
    subcategoryName: string,
    bucket: Rule503020Bucket | 'inherit'
  ) => {
    const key = `${categoryName.trim().toLowerCase()}::${subcategoryName.trim().toLowerCase()}`;
    setUserMappings((prev) => {
      const next = { ...prev };
      if (bucket === 'inherit') {
        delete next[key];
      } else {
        next[key] = bucket;
      }
      try {
        localStorage.setItem(STORAGE_KEY_503020, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleResetToDefaults = () => {
    setUserMappings({ ...DEFAULT_503020_RULES });
    try {
      localStorage.setItem(STORAGE_KEY_503020, JSON.stringify(DEFAULT_503020_RULES));
    } catch {}
  };

  const handleAddCustomCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCatInput.trim()) return;
    handleUpdateCategoryBucket(customCatInput.trim(), customCatBucket);
    setCustomCatInput('');
  };

  const [hoveredLink, setHoveredLink] = useState<{
    sourceName: string;
    targetName: string;
    value: number;
    percent: number;
  } | null>(null);

  const [hoveredNode, setHoveredNode] = useState<{
    label: string;
    value: number;
    percent: number;
  } | null>(null);

  const {
    totalIncome,
    totalExpense,
    netSavings,
    nodes,
    links,
    needsVal,
    wantsVal,
    savingsExpensesVal,
    totalSavingsVal,
    allDiscoveredCategories
  } = useMemo(() => {
    // 1. Calculate incomes
    let incomeSum = 0;
    const incomeSourcesMap = new Map<string, number>();

    // 2. Calculate expenses by category and track 50/30/20 buckets per transaction
    let expenseSum = 0;
    const expenseCategoriesMap = new Map<string, number>();
    const categoryBucketBreakdown = new Map<string, { needs: number; wants: number; savings: number }>();

    let needs = 0;
    let wants = 0;
    let savingsExpenses = 0;

    for (const tx of transactions) {
      if (isTransferCategory(tx.category, tx.subcategory)) {
        continue; // I trasferimenti patrimoniali interni non sono spese/entrate e preservano il patrimonio
      }
      if (tx.kind === 'income') {
        const amt = Math.abs(tx.amount);
        incomeSum += amt;
        const sourceLabel = tx.reimbursesTransactionId
          ? 'Rimborsi Ricevuti'
          : (tx.category?.trim() || 'Entrate / Stipendio');
        incomeSourcesMap.set(sourceLabel, (incomeSourcesMap.get(sourceLabel) || 0) + amt);
      } else if (tx.kind === 'expense') {
        const amt = Math.abs(tx.amount);
        expenseSum += amt;
        const cat = tx.category?.trim() || 'Altro';
        const sub = tx.subcategory?.trim() || '';
        expenseCategoriesMap.set(cat, (expenseCategoriesMap.get(cat) || 0) + amt);

        const bucket = getTransactionBucket(cat, sub, userMappings);
        if (bucket === 'needs') {
          needs += amt;
        } else if (bucket === 'savings') {
          savingsExpenses += amt;
        } else {
          wants += amt;
        }

        const breakdown = categoryBucketBreakdown.get(cat) || { needs: 0, wants: 0, savings: 0 };
        breakdown[bucket] += amt;
        categoryBucketBreakdown.set(cat, breakdown);
      }
    }

    if (incomeSum === 0 && expenseSum > 0) {
      incomeSum = expenseSum;
      incomeSourcesMap.set('Spese Riconosciute', expenseSum);
    }

    // Unspent cashflow (income not consumed by expenses)
    const unspentFlow = Math.max(0, incomeSum - expenseSum);
    // Total savings under 50/30/20 rule = money put into savings/investment categories + unspent flow
    const totalSavings = savingsExpenses + unspentFlow;

    // Build Sankey Nodes
    const nodeList: SankeyNode[] = [];
    const linkList: SankeyLink[] = [];

    // Col 0: Income sources
    const incomeEntries = Array.from(incomeSourcesMap.entries()).sort((a, b) => b[1] - a[1]);
    incomeEntries.forEach(([source, amt], idx) => {
      nodeList.push({
        id: `inc-${idx}`,
        label: source,
        value: amt,
        color: '#10b981',
        column: 0,
      });
    });

    // Col 1: Macro-buckets based on user's 50/30/20 assignment
    if (needs > 0) {
      nodeList.push({
        id: 'macro-needs',
        label: 'Necessità (50%)',
        value: needs,
        color: '#f59e0b',
        column: 1,
      });
    }

    if (wants > 0) {
      nodeList.push({
        id: 'macro-wants',
        label: 'Svago & Desideri (30%)',
        value: wants,
        color: '#8b5cf6',
        column: 1,
      });
    }

    if (totalSavings > 0) {
      nodeList.push({
        id: 'macro-savings',
        label: 'Risparmio & Investimenti (20%)',
        value: totalSavings,
        color: '#34d399',
        column: 1,
      });
    }

    // Col 2: Destination Categories
    const expenseEntries = Array.from(expenseCategoriesMap.entries()).sort((a, b) => b[1] - a[1]);
    expenseEntries.forEach(([cat, amt], idx) => {
      const col = CATEGORY_COLORS[cat] || DEFAULT_CATEGORY_COLOR;
      nodeList.push({
        id: `dest-${idx}`,
        label: cat,
        value: amt,
        color: col,
        column: 2,
      });
    });

    if (unspentFlow > 0) {
      nodeList.push({
        id: 'dest-unspent-savings',
        label: 'Risparmio Netto Non Speso',
        value: unspentFlow,
        color: '#34d399',
        column: 2,
      });
    }

    // Build Links:
    // Link from Income sources to Macro-buckets proportionally
    const totalMacro = needs + wants + totalSavings;
    if (totalMacro > 0) {
      incomeEntries.forEach(([_, incAmt], iIdx) => {
        const incId = `inc-${iIdx}`;
        if (needs > 0) {
          const val = (incAmt * needs) / totalMacro;
          linkList.push({
            sourceId: incId,
            targetId: 'macro-needs',
            value: val,
            color: '#f59e0b',
          });
        }
        if (wants > 0) {
          const val = (incAmt * wants) / totalMacro;
          linkList.push({
            sourceId: incId,
            targetId: 'macro-wants',
            value: val,
            color: '#8b5cf6',
          });
        }
        if (totalSavings > 0) {
          const val = (incAmt * totalSavings) / totalMacro;
          linkList.push({
            sourceId: incId,
            targetId: 'macro-savings',
            value: val,
            color: '#34d399',
          });
        }
      });
    }

    // Link from Macro-buckets to individual categories based on exact subcategory/category breakdown!
    expenseEntries.forEach(([cat, _amt], cIdx) => {
      const destId = `dest-${cIdx}`;
      const breakdown = categoryBucketBreakdown.get(cat) || { needs: 0, wants: 0, savings: 0 };
      const col = CATEGORY_COLORS[cat] || DEFAULT_CATEGORY_COLOR;
      if (breakdown.needs > 0) {
        linkList.push({
          sourceId: 'macro-needs',
          targetId: destId,
          value: breakdown.needs,
          color: col,
        });
      }
      if (breakdown.wants > 0) {
        linkList.push({
          sourceId: 'macro-wants',
          targetId: destId,
          value: breakdown.wants,
          color: col,
        });
      }
      if (breakdown.savings > 0) {
        linkList.push({
          sourceId: 'macro-savings',
          targetId: destId,
          value: breakdown.savings,
          color: col,
        });
      }
    });

    if (unspentFlow > 0) {
      linkList.push({
        sourceId: 'macro-savings',
        targetId: 'dest-unspent-savings',
        value: unspentFlow,
        color: '#34d399',
      });
    }

    // Collect all discovered categories for configuration UI (excluding transfers)
    const discovered = new Set<string>();
    budgetCategories.forEach((bc) => {
      if (bc.name && !isTransferCategory(bc.name)) discovered.add(bc.name);
    });
    expenseCategoriesMap.forEach((_, cat) => {
      if (!isTransferCategory(cat)) discovered.add(cat);
    });
    Object.keys(DEFAULT_503020_RULES).forEach((cat) => {
      if (!isTransferCategory(cat)) discovered.add(cat);
    });
    Object.keys(userMappings).forEach((cat) => {
      if (!cat.includes('::') && !cat.startsWith('sub::') && !isTransferCategory(cat)) discovered.add(cat);
    });

    return {
      totalIncome: incomeSum,
      totalExpense: expenseSum,
      netSavings: unspentFlow,
      nodes: nodeList,
      links: linkList,
      needsVal: needs,
      wantsVal: wants,
      savingsExpensesVal: savingsExpenses,
      totalSavingsVal: totalSavings,
      allDiscoveredCategories: Array.from(discovered),
    };
  }, [transactions, budgetCategories, userMappings]);

  // SVG Geometry Layout
  const chartHeight = Math.max(460, nodes.length * 28);
  const chartWidth = 920;
  const colX = [40, 420, 800];
  const nodeWidth = 18;
  const paddingBetweenNodes = 16;
  const topPadding = 30;
  const bottomPadding = 30;
  const usableHeight = chartHeight - topPadding - bottomPadding;

  const layout = useMemo(() => {
    if (nodes.length === 0 || totalIncome <= 0) return null;

    // Group nodes by column
    const colNodes: Record<number, SankeyNode[]> = { 0: [], 1: [], 2: [] };
    nodes.forEach((n) => colNodes[n.column].push(n));

    // Calculate layout for each column
    [0, 1, 2].forEach((colIdx) => {
      const list = colNodes[colIdx];
      const sumVal = list.reduce((acc, n) => acc + n.value, 0) || 1;
      const totalPadding = Math.max(0, (list.length - 1) * paddingBetweenNodes);
      const heightForBars = Math.max(80, usableHeight - totalPadding);

      let currentY = topPadding;
      list.forEach((n) => {
        const h = Math.max(14, (n.value / sumVal) * heightForBars);
        n.x = colX[colIdx];
        n.y = currentY;
        n.width = nodeWidth;
        n.height = h;
        currentY += h + paddingBetweenNodes;
      });
    });

    // Now calculate link source/target y offsets
    const sourceCurrentOffset: Record<string, number> = {};
    const targetCurrentOffset: Record<string, number> = {};

    const nodeMap = new Map<string, SankeyNode>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    const computedLinks = links.map((link) => {
      const sourceNode = nodeMap.get(link.sourceId);
      const targetNode = nodeMap.get(link.targetId);

      if (!sourceNode || !targetNode) return null;

      const sourceVal = sourceNode.value || 1;
      const targetVal = targetNode.value || 1;

      const linkHeightSource = (link.value / sourceVal) * (sourceNode.height || 0);
      const linkHeightTarget = (link.value / targetVal) * (targetNode.height || 0);

      const srcOff = sourceCurrentOffset[link.sourceId] || 0;
      const tgtOff = targetCurrentOffset[link.targetId] || 0;

      const sY0 = (sourceNode.y || 0) + srcOff;
      const sY1 = sY0 + linkHeightSource;
      sourceCurrentOffset[link.sourceId] = srcOff + linkHeightSource;

      const tY0 = (targetNode.y || 0) + tgtOff;
      const tY1 = tY0 + linkHeightTarget;
      targetCurrentOffset[link.targetId] = tgtOff + linkHeightTarget;

      return {
        ...link,
        sourceY0: sY0,
        sourceY1: sY1,
        targetY0: tY0,
        targetY1: tY1,
        sourceNode,
        targetNode,
      };
    }).filter(Boolean);

    return {
      nodes,
      computedLinks,
    };
  }, [nodes, links, totalIncome, usableHeight, chartHeight]);

  if (!layout || nodes.length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
        Nessuna transazione registrata nel periodo selezionato per generare il diagramma di flusso.
      </div>
    );
  }

  // 50/30/20 Rule Metrics based on user customization
  const needsPct = totalIncome > 0 ? (needsVal / totalIncome) * 100 : 0;
  const wantsPct = totalIncome > 0 ? (wantsVal / totalIncome) * 100 : 0;
  const savingsPct = totalIncome > 0 ? (totalSavingsVal / totalIncome) * 100 : 0;

  // Filtered categories for configuration modal
  const filteredCategoriesForConfig = allDiscoveredCategories
    .filter((cat) => cat.toLowerCase().includes(configSearch.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 50-30-20 Section Container */}
      <div
        style={{
          padding: '18px',
          borderRadius: '16px',
          background: 'var(--panel-card-bg)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1rem' }}>⚖️</span>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text)' }}>Regola del 50/30/20 Personalizzabile</strong>
            </div>
            <p style={{ margin: '3px 0 0 0', fontSize: '0.76rem', color: 'var(--muted)' }}>
              Monitora la ripartizione del tuo reddito tra bisogni primari, desideri e accantonamenti. Puoi decidere tu quali categorie contano come necessità o risparmio!
            </p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setIsConfigOpen(true)}
            style={{
              fontSize: '0.8rem',
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ⚙️ Personalizza Classificazione
          </button>
        </div>

        {/* 3 Metric Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
          }}
        >
          {/* Card 1: Necessità */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                🏠 Necessità (Target: 50%)
              </span>
              <span style={{ fontSize: '0.82rem', color: '#f59e0b', fontWeight: 700 }}>
                {needsPct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: '6px', borderRadius: '3px', background: 'var(--overlay-medium)', marginTop: '8px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, needsPct)}%`, height: '100%', background: '#f59e0b', borderRadius: '3px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '8px' }}>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text)' }}>
                {formatEuro(needsVal)}
              </strong>
              <span style={{ fontSize: '0.72rem', color: needsPct <= 50 ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                {needsPct <= 50 ? `✓ In target (-${(50 - needsPct).toFixed(1)}%)` : `+${(needsPct - 50).toFixed(1)}% eccedenza`}
              </span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '4px' }}>
              Spese primarie e fisse classificate da te
            </div>
          </div>

          {/* Card 2: Svago */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                🎉 Svago & Desideri (Target: 30%)
              </span>
              <span style={{ fontSize: '0.82rem', color: '#8b5cf6', fontWeight: 700 }}>
                {wantsPct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: '6px', borderRadius: '3px', background: 'var(--overlay-medium)', marginTop: '8px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, wantsPct)}%`, height: '100%', background: '#8b5cf6', borderRadius: '3px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '8px' }}>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text)' }}>
                {formatEuro(wantsVal)}
              </strong>
              <span style={{ fontSize: '0.72rem', color: wantsPct <= 30 ? '#10b981' : '#fb7185', fontWeight: 600 }}>
                {wantsPct <= 30 ? `✓ In target (-${(30 - wantsPct).toFixed(1)}%)` : `+${(wantsPct - 30).toFixed(1)}% eccedenza`}
              </span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '4px' }}>
              Spese discrezionali e stile di vita
            </div>
          </div>

          {/* Card 3: Risparmio */}
          <div style={{ padding: '14px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                💰 Risparmio & Investimenti (Target: 20%)
              </span>
              <span style={{ fontSize: '0.82rem', color: '#34d399', fontWeight: 700 }}>
                {savingsPct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: '6px', borderRadius: '3px', background: 'var(--overlay-medium)', marginTop: '8px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, savingsPct)}%`, height: '100%', background: '#34d399', borderRadius: '3px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '8px' }}>
              <strong style={{ fontSize: '0.95rem', color: '#34d399' }}>
                {formatEuro(totalSavingsVal)}
              </strong>
              <span style={{ fontSize: '0.72rem', color: savingsPct >= 20 ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                {savingsPct >= 20 ? `✓ Target superato (+${(savingsPct - 20).toFixed(1)}%)` : `-${(20 - savingsPct).toFixed(1)}% al target`}
              </span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '4px' }}>
              {savingsExpensesVal > 0
                ? `${formatEuro(netSavings)} non spesi + ${formatEuro(savingsExpensesVal)} in PAC/investimenti`
                : 'Flusso netto positivo non speso'}
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Customize 50/30/20 Categories */}
      {isConfigOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
          onClick={() => setIsConfigOpen(false)}
        >
          <div
            style={{
              background: 'var(--panel-card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '680px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>
                  Personalizza Regola 50/30/20
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
                  Decidi tu per ogni categoria se intendi Necessità (50%), Svago (30%) o Risparmio/Investimenti (20%).
                </p>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsConfigOpen(false)}
                style={{ padding: '6px 12px', fontSize: '1rem', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {/* Modal Guide & Add Category Form */}
            <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', background: 'var(--overlay-subtle)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', fontSize: '0.74rem' }}>
                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', color: '#f59e0b' }}>
                  <strong>🏠 Necessità (50%)</strong>: Affitto, mutuo, alimentari, bollette, salute, trasporti.
                </div>
                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.25)', color: '#8b5cf6' }}>
                  <strong>🎉 Svago (30%)</strong>: Ristoranti, uscite, shopping, viaggi, hobby, abbonamenti.
                </div>
                <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.25)', color: '#34d399' }}>
                  <strong>💰 Risparmio (20%)</strong>: PAC, investimenti, fondi pensione, accantonamenti.
                </div>
              </div>

              {/* Add custom category inline */}
              <form onSubmit={handleAddCustomCategory} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Aggiungi una nuova categoria (es. Palestra, Spese Mediche...)"
                  value={customCatInput}
                  onChange={(e) => setCustomCatInput(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                  }}
                />
                <select
                  value={customCatBucket}
                  onChange={(e) => setCustomCatBucket(e.target.value as Rule503020Bucket)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.8rem',
                  }}
                >
                  <option value="needs">🏠 Necessità</option>
                  <option value="wants">🎉 Svago</option>
                  <option value="savings">💰 Risparmio</option>
                </select>
                <button type="submit" className="pill pill-primary" style={{ padding: '6px 14px', fontSize: '0.8rem' }}>
                  + Aggiungi
                </button>
              </form>

              {/* Filter search & Quick Filter Pills */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Cerca tra categorie o sottocategorie..."
                    value={configSearch}
                    onChange={(e) => setConfigSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--input-bg)',
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                    }}
                  />
                  {configSearch && (
                    <button
                      type="button"
                      className="pill"
                      onClick={() => setConfigSearch('')}
                      style={{ fontSize: '0.75rem', padding: '6px 10px' }}
                    >
                      Pulisci
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setConfigFilterBucket('all')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: configFilterBucket === 'all' ? 'var(--accent)' : 'var(--border)',
                      background: configFilterBucket === 'all' ? 'var(--accent)' : 'transparent',
                      color: configFilterBucket === 'all' ? 'var(--pill-primary-text)' : 'var(--muted)',
                    }}
                  >
                    Tutte
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigFilterBucket('needs')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: configFilterBucket === 'needs' ? '#f59e0b' : 'var(--border)',
                      background: configFilterBucket === 'needs' ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                      color: configFilterBucket === 'needs' ? '#f59e0b' : 'var(--muted)',
                    }}
                  >
                    🏠 Necessità
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigFilterBucket('wants')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: configFilterBucket === 'wants' ? '#8b5cf6' : 'var(--border)',
                      background: configFilterBucket === 'wants' ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                      color: configFilterBucket === 'wants' ? '#8b5cf6' : 'var(--muted)',
                    }}
                  >
                    🎉 Svago
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigFilterBucket('savings')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: configFilterBucket === 'savings' ? '#34d399' : 'var(--border)',
                      background: configFilterBucket === 'savings' ? 'rgba(52, 211, 153, 0.2)' : 'transparent',
                      color: configFilterBucket === 'savings' ? '#34d399' : 'var(--muted)',
                    }}
                  >
                    💰 Risparmio
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigFilterBucket('overridden')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: configFilterBucket === 'overridden' ? '#38bdf8' : 'var(--border)',
                      background: configFilterBucket === 'overridden' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                      color: configFilterBucket === 'overridden' ? '#38bdf8' : 'var(--muted)',
                    }}
                  >
                    🔧 Sottocategorie Personalizzate
                  </button>
                </div>
              </div>
            </div>

            {/* Category & Subcategory List strictly reflecting the Budget Page */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {budgetCategories.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Categorie & Sottocategorie dal Budget ({budgetCategories.length})
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                      Le sottocategorie ereditano la categoria a meno di override specifico
                    </span>
                  </div>

                  {budgetCategories
                    .filter((cat) => {
                      const searchLower = configSearch.toLowerCase();
                      const matchCat = cat.name.toLowerCase().includes(searchLower);
                      const matchSub = (cat.subcategories || []).some((s) => s.name.toLowerCase().includes(searchLower));
                      if (searchLower && !matchCat && !matchSub) return false;

                      const catBucket = getCategoryBucket(cat.name, userMappings);
                      const hasSubOverrides = (cat.subcategories || []).some((s) => {
                        const key = `${cat.name.toLowerCase()}::${s.name.toLowerCase()}`;
                        return userMappings[key] !== undefined;
                      });

                      if (configFilterBucket === 'overridden') return hasSubOverrides;
                      if (configFilterBucket !== 'all') {
                        const matchCatBucket = catBucket === configFilterBucket;
                        const matchSubBucket = (cat.subcategories || []).some((s) => {
                          const subBucket = getSubcategoryBucket(cat.name, s.name, userMappings).bucket;
                          return subBucket === configFilterBucket;
                        });
                        return matchCatBucket || matchSubBucket;
                      }
                      return true;
                    })
                    .map((cat) => {
                      const catBucket = getCategoryBucket(cat.name, userMappings);
                      const isExpanded = expandedCats[cat.id || cat.name] !== false; // Default expanded
                      const subs = cat.subcategories || [];

                      return (
                        <div
                          key={cat.id || cat.name}
                          style={{
                            borderRadius: '12px',
                            background: 'var(--overlay-subtle)',
                            border: '1px solid var(--border)',
                            overflow: 'hidden',
                          }}
                        >
                          {/* Parent Category Header */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 14px',
                              background: 'rgba(255, 255, 255, 0.02)',
                              borderBottom: subs.length > 0 && isExpanded ? '1px solid var(--border)' : 'none',
                              gap: '12px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              {subs.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleCategoryExpand(cat.id || cat.name)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--muted)',
                                    cursor: 'pointer',
                                    padding: '2px 4px',
                                    fontSize: '0.8rem',
                                    lineHeight: 1,
                                  }}
                                  title={isExpanded ? 'Comprimi sottocategorie' : 'Espandi sottocategorie'}
                                >
                                  {isExpanded ? '▼' : '▶'}
                                </button>
                              )}
                              <span
                                style={{
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '50%',
                                  backgroundColor: cat.color || CATEGORY_COLORS[cat.name] || DEFAULT_CATEGORY_COLOR,
                                  display: 'inline-block',
                                }}
                              />
                              <div>
                                <strong style={{ fontSize: '0.9rem', color: 'var(--text)' }}>
                                  {cat.name}
                                </strong>
                                {subs.length > 0 && (
                                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)', marginLeft: '8px' }}>
                                    ({subs.length} sottocategori{subs.length === 1 ? 'a' : 'e'})
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Bucket selector for Parent Category */}
                            {isTransferCategory(cat.name) ? (
                              <span
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  color: '#38bdf8',
                                  border: '1px solid rgba(56, 189, 248, 0.3)',
                                }}
                              >
                                🔄 Spostamento Patrimoniale (Escluso dai flussi)
                              </span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCategoryBucket(cat.name, 'needs')}
                                  style={{
                                    padding: '5px 11px',
                                    borderRadius: '6px',
                                    fontSize: '0.75rem',
                                    fontWeight: 650,
                                    cursor: 'pointer',
                                    border: '1px solid',
                                    borderColor: catBucket === 'needs' ? '#f59e0b' : 'var(--border)',
                                    background: catBucket === 'needs' ? 'rgba(245, 158, 11, 0.22)' : 'transparent',
                                    color: catBucket === 'needs' ? '#f59e0b' : 'var(--muted)',
                                  }}
                                >
                                  🏠 Necessità
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCategoryBucket(cat.name, 'wants')}
                                  style={{
                                    padding: '5px 11px',
                                    borderRadius: '6px',
                                    fontSize: '0.75rem',
                                    fontWeight: 650,
                                    cursor: 'pointer',
                                    border: '1px solid',
                                    borderColor: catBucket === 'wants' ? '#8b5cf6' : 'var(--border)',
                                    background: catBucket === 'wants' ? 'rgba(139, 92, 246, 0.22)' : 'transparent',
                                    color: catBucket === 'wants' ? '#8b5cf6' : 'var(--muted)',
                                  }}
                                >
                                  🎉 Svago
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCategoryBucket(cat.name, 'savings')}
                                  style={{
                                    padding: '5px 11px',
                                    borderRadius: '6px',
                                    fontSize: '0.75rem',
                                    fontWeight: 650,
                                    cursor: 'pointer',
                                    border: '1px solid',
                                    borderColor: catBucket === 'savings' ? '#34d399' : 'var(--border)',
                                    background: catBucket === 'savings' ? 'rgba(52, 211, 153, 0.22)' : 'transparent',
                                    color: catBucket === 'savings' ? '#34d399' : 'var(--muted)',
                                  }}
                                >
                                  💰 Risparmio
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Subcategories list */}
                          {subs.length > 0 && isExpanded && (
                            <div style={{ display: 'flex', flexDirection: 'column', background: 'rgba(0, 0, 0, 0.15)', padding: '6px 12px 6px 36px', gap: '6px' }}>
                              {subs.map((sub) => {
                                const subInfo = getSubcategoryBucket(cat.name, sub.name, userMappings);
                                const isOverridden = !subInfo.isInherited;

                                return (
                                  <div
                                    key={sub.id || sub.name}
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      padding: '6px 10px',
                                      borderRadius: '8px',
                                      background: isOverridden ? 'rgba(56, 189, 248, 0.05)' : 'transparent',
                                      border: isOverridden ? '1px dashed rgba(56, 189, 248, 0.25)' : '1px solid transparent',
                                      gap: '10px',
                                      flexWrap: 'wrap',
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>↳</span>
                                      <span style={{ fontSize: '0.82rem', fontWeight: 550, color: 'var(--text)' }}>
                                        {sub.name}
                                      </span>
                                      {isOverridden ? (
                                        <span style={{ fontSize: '0.68rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                          Personalizzata
                                        </span>
                                      ) : (
                                        <span style={{ fontSize: '0.68rem', color: 'var(--muted)', background: 'rgba(255, 255, 255, 0.05)', padding: '1px 6px', borderRadius: '4px' }}>
                                          Eredita ({catBucket === 'needs' ? 'Necessità' : catBucket === 'savings' ? 'Risparmio' : 'Svago'})
                                        </span>
                                      )}
                                    </div>

                                    {/* Subcategory Bucket Overrides */}
                                    {isTransferCategory(cat.name, sub.name) ? (
                                      <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontStyle: 'italic', padding: '2px 8px' }}>
                                        Spostamento patrimoniale
                                      </span>
                                    ) : (
                                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                        {isOverridden && (
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateSubcategoryBucket(cat.name, sub.name, 'inherit')}
                                            style={{
                                              padding: '3px 8px',
                                              borderRadius: '5px',
                                              fontSize: '0.68rem',
                                              cursor: 'pointer',
                                              border: '1px solid var(--border)',
                                              background: 'transparent',
                                              color: 'var(--muted)',
                                            }}
                                            title="Reimposta e fai ereditare dalla categoria padre"
                                          >
                                            ↺ Eredita
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateSubcategoryBucket(cat.name, sub.name, 'needs')}
                                          style={{
                                            padding: '3px 8px',
                                            borderRadius: '5px',
                                            fontSize: '0.68rem',
                                            fontWeight: subInfo.bucket === 'needs' ? 650 : 500,
                                            cursor: 'pointer',
                                            border: '1px solid',
                                            borderColor: subInfo.bucket === 'needs' ? '#f59e0b' : 'var(--border)',
                                            background: subInfo.bucket === 'needs' ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                                            color: subInfo.bucket === 'needs' ? '#f59e0b' : 'var(--muted)',
                                            opacity: !isOverridden && subInfo.bucket === 'needs' ? 0.8 : 1,
                                          }}
                                        >
                                          🏠 Nec
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateSubcategoryBucket(cat.name, sub.name, 'wants')}
                                          style={{
                                            padding: '3px 8px',
                                            borderRadius: '5px',
                                            fontSize: '0.68rem',
                                            fontWeight: subInfo.bucket === 'wants' ? 650 : 500,
                                            cursor: 'pointer',
                                            border: '1px solid',
                                            borderColor: subInfo.bucket === 'wants' ? '#8b5cf6' : 'var(--border)',
                                            background: subInfo.bucket === 'wants' ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                                            color: subInfo.bucket === 'wants' ? '#8b5cf6' : 'var(--muted)',
                                            opacity: !isOverridden && subInfo.bucket === 'wants' ? 0.8 : 1,
                                          }}
                                        >
                                          🎉 Sva
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateSubcategoryBucket(cat.name, sub.name, 'savings')}
                                          style={{
                                            padding: '3px 8px',
                                            borderRadius: '5px',
                                            fontSize: '0.68rem',
                                            fontWeight: subInfo.bucket === 'savings' ? 650 : 500,
                                            cursor: 'pointer',
                                            border: '1px solid',
                                            borderColor: subInfo.bucket === 'savings' ? '#34d399' : 'var(--border)',
                                            background: subInfo.bucket === 'savings' ? 'rgba(52, 211, 153, 0.2)' : 'transparent',
                                            color: subInfo.bucket === 'savings' ? '#34d399' : 'var(--muted)',
                                            opacity: !isOverridden && subInfo.bucket === 'savings' ? 0.8 : 1,
                                          }}
                                        >
                                          💰 Risp
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Other discovered categories (from imported or historical transactions) */}
              {(() => {
                const otherCategories = allDiscoveredCategories
                  .filter((c) => !budgetCategories.some((bc) => bc.name.toLowerCase() === c.toLowerCase()))
                  .filter((c) => c.toLowerCase().includes(configSearch.toLowerCase()))
                  .filter((c) => {
                    if (configFilterBucket === 'all') return true;
                    if (configFilterBucket === 'overridden') return false;
                    return getCategoryBucket(c, userMappings) === configFilterBucket;
                  })
                  .sort((a, b) => a.localeCompare(b));

                if (otherCategories.length === 0) return null;

                return (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Altre Categorie Rilevate nelle Transazioni ({otherCategories.length})
                    </span>
                    {otherCategories.map((cat) => {
                      const currentBucket = getCategoryBucket(cat, userMappings);
                      return (
                        <div
                          key={cat}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            borderRadius: '10px',
                            background: 'var(--overlay-subtle)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>
                            {cat}
                          </span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => handleUpdateCategoryBucket(cat, 'needs')}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: '1px solid',
                                borderColor: currentBucket === 'needs' ? '#f59e0b' : 'var(--border)',
                                background: currentBucket === 'needs' ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                                color: currentBucket === 'needs' ? '#f59e0b' : 'var(--muted)',
                              }}
                            >
                              🏠 Necessità
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateCategoryBucket(cat, 'wants')}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: '1px solid',
                                borderColor: currentBucket === 'wants' ? '#8b5cf6' : 'var(--border)',
                                background: currentBucket === 'wants' ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                                color: currentBucket === 'wants' ? '#8b5cf6' : 'var(--muted)',
                              }}
                            >
                              🎉 Svago
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateCategoryBucket(cat, 'savings')}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: '1px solid',
                                borderColor: currentBucket === 'savings' ? '#34d399' : 'var(--border)',
                                background: currentBucket === 'savings' ? 'rgba(52, 211, 153, 0.2)' : 'transparent',
                                color: currentBucket === 'savings' ? '#34d399' : 'var(--muted)',
                              }}
                            >
                              💰 Risparmio
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--overlay-subtle)' }}>
              <button
                type="button"
                className="text-button"
                onClick={handleResetToDefaults}
                style={{ fontSize: '0.78rem', color: 'var(--muted)' }}
              >
                Ripristina regole predefinite
              </button>
              <button
                type="button"
                className="pill pill-primary"
                onClick={() => setIsConfigOpen(false)}
                style={{ padding: '6px 18px', fontSize: '0.82rem' }}
              >
                Salva & Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SVG Sankey Chart Container */}
      <div
        style={{
          position: 'relative',
          padding: '20px 10px',
          borderRadius: '16px',
          background: 'var(--panel-card-bg)',
          border: '1px solid var(--border)',
          overflowX: 'auto',
        }}
      >
        {/* Column Headers */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '0 40px 12px 40px',
            fontSize: '0.74rem',
            color: 'var(--muted)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <span>1. Sorgenti Entrate ({formatEuro(totalIncome)})</span>
          <span>2. Macro-Allocazione</span>
          <span>3. Categorie & Destinazioni</span>
        </div>

        <svg
          width="100%"
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          style={{ overflow: 'visible', display: 'block' }}
        >
          <defs>
            {layout.computedLinks.map((link: any, idx: number) => {
              const gradId = `link-grad-${idx}`;
              return (
                <linearGradient key={gradId} id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={link.sourceNode?.color || '#10b981'} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={link.targetNode?.color || '#3b82f6'} stopOpacity={0.4} />
                </linearGradient>
              );
            })}
          </defs>

          {/* Links */}
          {layout.computedLinks.map((link: any, idx: number) => {
            const x0 = (link.sourceNode?.x || 0) + (link.sourceNode?.width || 0);
            const x1 = link.targetNode?.x || 0;
            const y0 = link.sourceY0;
            const y1 = link.targetY0;
            const y0b = link.sourceY1;
            const y1b = link.targetY1;
            const midX = (x0 + x1) / 2;

            const pathData = `
              M ${x0} ${y0}
              C ${midX} ${y0}, ${midX} ${y1}, ${x1} ${y1}
              L ${x1} ${y1b}
              C ${midX} ${y1b}, ${midX} ${y0b}, ${x0} ${y0b}
              Z
            `;

            const isHovered =
              hoveredLink &&
              hoveredLink.sourceName === link.sourceNode?.label &&
              hoveredLink.targetName === link.targetNode?.label;

            return (
              <path
                key={`link-${idx}`}
                d={pathData}
                fill={`url(#link-grad-${idx})`}
                opacity={isHovered ? 0.85 : 0.45}
                style={{
                  transition: 'opacity 0.2s ease, fill 0.2s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={() => {
                  setHoveredLink({
                    sourceName: link.sourceNode?.label || '',
                    targetName: link.targetNode?.label || '',
                    value: link.value,
                    percent: totalIncome > 0 ? (link.value / totalIncome) * 100 : 0,
                  });
                }}
                onMouseLeave={() => setHoveredLink(null)}
              />
            );
          })}

          {/* Nodes */}
          {layout.nodes.map((node) => {
            const isHovered = hoveredNode?.label === node.label;
            const isCol0 = node.column === 0;
            const isCol2 = node.column === 2;

            return (
              <g
                key={node.id}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => {
                  setHoveredNode({
                    label: node.label,
                    value: node.value,
                    percent: totalIncome > 0 ? (node.value / totalIncome) * 100 : 0,
                  });
                }}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Node Bar */}
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={4}
                  fill={node.color}
                  stroke={isHovered ? '#fff' : 'rgba(255,255,255,0.1)'}
                  strokeWidth={isHovered ? 2 : 1}
                  style={{ transition: 'all 0.2s ease' }}
                />

                {/* Node Text Label */}
                <text
                  x={isCol0 ? (node.x || 0) - 8 : isCol2 ? (node.x || 0) + (node.width || 0) + 8 : (node.x || 0) + (node.width || 0) / 2}
                  y={(node.y || 0) + (node.height || 0) / 2}
                  textAnchor={isCol0 ? 'end' : isCol2 ? 'start' : 'middle'}
                  dominantBaseline="middle"
                  fill="var(--text)"
                  fontSize="0.74rem"
                  fontWeight={600}
                  style={{ pointerEvents: 'none' }}
                >
                  {node.label}
                  <tspan
                    x={isCol0 ? (node.x || 0) - 8 : isCol2 ? (node.x || 0) + (node.width || 0) + 8 : (node.x || 0) + (node.width || 0) / 2}
                    dy="1.2em"
                    fontSize="0.68rem"
                    fill="var(--muted)"
                    fontWeight={500}
                  >
                    {formatEuro(node.value)} ({totalIncome > 0 ? ((node.value / totalIncome) * 100).toFixed(1) : 0}%)
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover Floating Details Card */}
        {hoveredLink && (
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '8px 16px',
              background: 'var(--panel-strong)',
              borderRadius: '10px',
              border: '1px solid var(--accent)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <span style={{ color: 'var(--muted)' }}>
              {hoveredLink.sourceName} ➔ {hoveredLink.targetName}:
            </span>
            <strong style={{ color: '#38bdf8' }}>{formatEuro(hoveredLink.value)}</strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              ({hoveredLink.percent.toFixed(1)}% del totale entrate)
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
