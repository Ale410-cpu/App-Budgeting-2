import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './fonts.css';
import './styles.css';
import { initPrototypePollutionDefense } from './utils/security';

// Initialize anti-tampering and prototype pollution defenses immediately
initPrototypePollutionDefense();

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('RootErrorBoundary caught error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetData = async () => {
    if (window.confirm('Vuoi davvero ripristinare la visualizzazione? I tuoi dati rimarranno comunque al sicuro sul disco nel file user-data.json.')) {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'var(--font-sans)',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '560px',
              width: '100%',
              backgroundColor: 'var(--panel-strong)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '32px',
              boxShadow: 'var(--shadow-lg)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: 'var(--danger-soft)',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                margin: '0 auto 16px',
              }}
            >
              ⚠️
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '8px' }}>
              Ripristino Registro Budget
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
              Si è verificato un errore durante il rendering della schermata. I tuoi dati su disco sono al sicuro.
            </p>
            {this.state.error?.message && (
              <pre
                style={{
                  backgroundColor: 'var(--bg)',
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.78rem',
                  color: 'var(--danger)',
                  textAlign: 'left',
                  overflowX: 'auto',
                  marginBottom: '20px',
                  border: '1px solid var(--danger-border)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--accent)',
                  color: 'var(--pill-primary-text)',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Ricarica Applicazione
              </button>
              <button
                type="button"
                onClick={this.handleResetData}
                style={{
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--panel-card-bg)',
                  color: 'var(--text)',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                Riavvia Sessione
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);

// Register Service Worker for offline capability
if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.log('SW registration note:', err?.message || err);
    });
  });
}

