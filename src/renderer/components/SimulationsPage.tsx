import React, { useState } from 'react';
import { FireCalculator } from './FireCalculator';
import { CompoundInterestCalculator } from './CompoundInterestCalculator';
import { MortgageCalculator } from './MortgageCalculator';

export type SimulationTab = 'composto' | 'fire' | 'mutui';

interface SimulationsPageProps {
  currentNetWorth: number;
  formatEuro: (val: number) => string;
}

const tabs: Array<{ id: SimulationTab; label: string; icon: string; description: string }> = [
  {
    id: 'composto',
    label: 'Interesse Composto',
    icon: '📈',
    description: 'Proietta la crescita del capitale con i versamenti periodici e il reinvestimento degli interessi.',
  },
  {
    id: 'fire',
    label: 'FIRE',
    icon: '🔥',
    description: 'Calcola il capitale necessario per l’indipendenza finanziaria, il tempo per raggiungerlo e la rendita passiva.',
  },
  {
    id: 'mutui',
    label: 'Mutui',
    icon: '🏠',
    description: 'Simula rata, piano di ammortamento e costo reale di un mutuo a tasso fisso.',
  },
];

/**
 * Pagina "Simulazioni": raccoglie i simulatori finanziari dell'app
 * (interesse composto, FIRE e mutui).
 */
export const SimulationsPage: React.FC<SimulationsPageProps> = ({ currentNetWorth, formatEuro }) => {
  const [activeTab, setActiveTab] = useState<SimulationTab>('composto');

  const activeTabConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <span style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 700 }}>
            Strumenti di pianificazione
          </span>
          <h2 style={{ margin: '2px 0 0', fontSize: '1.45rem', fontWeight: 700 }}>Simulazioni</h2>
          <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: 'var(--muted)', maxWidth: '620px' }}>
            {activeTabConfig.description}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', flexWrap: 'wrap' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 650,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: activeTab === tab.id ? 'var(--accent)' : 'transparent',
              color: activeTab === tab.id ? 'var(--pill-primary-text)' : 'var(--muted)',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'composto' && (
        <CompoundInterestCalculator formatEuro={formatEuro} currentNetWorth={currentNetWorth} />
      )}

      {activeTab === 'fire' && (
        <FireCalculator currentNetWorth={currentNetWorth} formatEuro={formatEuro} />
      )}

      {activeTab === 'mutui' && (
        <MortgageCalculator formatEuro={formatEuro} />
      )}
    </div>
  );
};
