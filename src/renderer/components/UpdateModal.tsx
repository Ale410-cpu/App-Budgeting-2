import React from 'react';
import type { UpdateCheckResult, UpdateProgress } from '../global';
import { APP_VERSION } from '../../version';

interface UpdateModalProps {
  isOpen: boolean;
  updateInfo: UpdateCheckResult | null;
  status: 'prompt' | 'downloading' | 'installing' | 'completed' | 'error';
  progress: UpdateProgress;
  errorMessage: string | null;
  successMessage?: string | null;
  onConfirmInstall: () => void;
  onRemindLater: () => void;
  onSkipVersion: () => void;
  onOpenReleaseUrl: () => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes)) return 'N/D';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  updateInfo,
  status,
  progress,
  errorMessage,
  successMessage,
  onConfirmInstall,
  onRemindLater,
  onSkipVersion,
  onOpenReleaseUrl,
}) => {
  if (!isOpen || !updateInfo) return null;

  const currentVer = updateInfo.currentVersion ? `v${updateInfo.currentVersion.replace(/^v/i, '')}` : `v${APP_VERSION}`;
  const newVer = updateInfo.latestVersion ? `v${updateInfo.latestVersion.replace(/^v/i, '')}` : updateInfo.tagName || 'Nuova';
  const asset = updateInfo.asset;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.78)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <div
        style={{
          background: 'var(--panel-strong, #0f172a)',
          border: '1px solid var(--border, rgba(148, 163, 184, 0.2))',
          borderRadius: '24px',
          padding: '28px',
          width: '100%',
          maxWidth: '560px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          color: 'var(--text, #f8fafc)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        {/* Header con icona e titoli */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.6rem',
              boxShadow: '0 8px 16px -4px rgba(14, 165, 233, 0.4)',
              flexShrink: 0,
            }}
          >
            🚀
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                  color: '#38bdf8',
                }}
              >
                Aggiornamento Disponibile
              </span>
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: '100px',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  fontWeight: 600,
                }}
              >
                GitHub Release
              </span>
            </div>
            <h3
              id="update-dialog-title"
              style={{
                fontSize: '1.35rem',
                fontWeight: 700,
                margin: '4px 0 0',
                color: 'var(--text, #f8fafc)',
                lineHeight: 1.25,
              }}
            >
              Nuova versione di BudgetingApp
            </h3>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '6px',
                fontSize: '0.85rem',
                color: 'var(--muted, #94a3b8)',
              }}
            >
              <span style={{ textDecoration: 'line-through', opacity: 0.85 }}>{currentVer}</span>
              <span style={{ color: '#38bdf8', fontWeight: 700 }}>➔ {newVer}</span>
              {updateInfo.publishedAt && (
                <span style={{ opacity: 0.6 }}>
                  • {new Date(updateInfo.publishedAt).toLocaleDateString('it-IT')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stato del download o note di rilascio */}
        {status === 'prompt' && (
          <>
            <div
              style={{
                background: 'var(--overlay-subtle, rgba(255, 255, 255, 0.03))',
                border: '1px solid var(--border, rgba(148, 163, 184, 0.15))',
                borderRadius: '16px',
                padding: '16px',
                maxHeight: '180px',
                overflowY: 'auto',
                fontSize: '0.85rem',
                lineHeight: 1.55,
                color: 'var(--text, #cbd5e1)',
              }}
            >
              <p
                style={{
                  margin: '0 0 8px',
                  fontWeight: 600,
                  color: 'var(--accent, #38bdf8)',
                  fontSize: '0.8rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Novità & Note di rilascio:
              </p>
              <div style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
                {updateInfo.releaseNotes || 'Nessuna nota aggiuntiva fornita.'}
              </div>
            </div>

            {asset && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  background: 'rgba(56, 189, 248, 0.06)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  fontSize: '0.82rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  <span style={{ fontSize: '1.1rem' }}>📦</span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      color: 'var(--text, #f1f5f9)',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={asset.name}
                  >
                    {asset.name}
                  </span>
                </div>
                <span style={{ color: 'var(--muted, #94a3b8)', fontWeight: 600, flexShrink: 0 }}>
                  {formatBytes(asset.size)}
                </span>
              </div>
            )}

            <div
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: '12px',
                padding: '12px 14px',
                fontSize: '0.82rem',
                color: '#34d399',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>🛡️</span>
              <span>
                I tuoi dati personali, transazioni e patrimonio verranno conservati intatti e
                ripristinati automaticamente all'avvio.
              </span>
            </div>

            <p style={{ margin: '0', fontSize: '0.88rem', fontWeight: 600, color: 'var(--text, #f8fafc)' }}>
              Vuoi scaricare e installare questo aggiornamento adesso?
            </p>
          </>
        )}

        {/* Stato download in corso */}
        {status === 'downloading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text, #f8fafc)' }}>
                Download dell'aggiornamento in corso...
              </span>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#38bdf8' }}>
                {progress.percent || 0}%
              </span>
            </div>

            {/* Barra di avanzamento */}
            <div
              style={{
                width: '100%',
                height: '10px',
                borderRadius: '100px',
                background: 'var(--input-bg, rgba(255, 255, 255, 0.08))',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, progress.percent || 0))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #0ea5e9, #38bdf8)',
                  borderRadius: '100px',
                  transition: 'width 0.2s ease',
                  boxShadow: '0 0 12px rgba(56, 189, 248, 0.6)',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.78rem',
                color: 'var(--muted, #94a3b8)',
              }}
            >
              <span>{formatBytes(progress.transferred)} scaricati</span>
              <span>{formatBytes(progress.total || asset?.size)} totali</span>
            </div>

            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted, #94a3b8)', textAlign: 'center' }}>
              Non chiudere l'applicazione. L'installatore verrà avviato non appena il download sarà
              completato.
            </p>
          </div>
        )}

        {/* Stato installazione in corso */}
        {status === 'installing' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>⚙️</div>
            <h4 style={{ margin: '0 0 6px', fontSize: '1.1rem', color: 'var(--text, #f8fafc)' }}>
              Sostituzione automatica dell'applicazione in corso...
            </h4>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted, #94a3b8)', lineHeight: 1.5 }}>
              Estrazione del pacchetto, aggiornamento nella cartella Applicazioni e rimozione blocchi Gatekeeper. L'app si riavvierà da sola tra pochi secondi.
            </p>
          </div>
        )}

        {/* Stato completato */}
        {status === 'completed' && (
          <div style={{ textAlign: 'center', padding: '14px 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🎉</div>
            <h4 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: '#10b981' }}>
              Aggiornamento installato con successo!
            </h4>
            <p style={{ margin: '0 0 14px', fontSize: '0.88rem', color: 'var(--text, #cbd5e1)', lineHeight: 1.5 }}>
              {successMessage ||
                'La nuova versione è stata installata al posto della precedente e si sta riavviando automaticamente.'}
            </p>
          </div>
        )}

        {/* Stato errore */}
        {status === 'error' && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '14px',
              padding: '14px',
              fontSize: '0.85rem',
              color: '#f87171',
            }}
          >
            <p style={{ margin: '0 0 6px', fontWeight: 700 }}>⚠️ Si è verificato un errore:</p>
            <p style={{ margin: 0 }}>{errorMessage || 'Impossibile completare l\'aggiornamento.'}</p>
          </div>
        )}

        {/* Bottoni di azione */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            marginTop: '8px',
            flexWrap: 'wrap',
          }}
        >
          {status === 'prompt' && (
            <>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={onRemindLater}
                  className="pill"
                  style={{
                    padding: '9px 16px',
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                  }}
                >
                  Più tardi
                </button>
                <button
                  type="button"
                  onClick={onSkipVersion}
                  className="pill"
                  style={{
                    padding: '9px 14px',
                    fontSize: '0.82rem',
                    color: 'var(--muted, #94a3b8)',
                    cursor: 'pointer',
                  }}
                  title="Non notificare più per questa specifica versione"
                >
                  Salta questa versione
                </button>
              </div>

              <button
                type="button"
                onClick={onConfirmInstall}
                className="pill pill-primary"
                style={{
                  padding: '9px 22px',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                  color: '#ffffff',
                  boxShadow: '0 4px 12px rgba(14, 165, 233, 0.35)',
                }}
              >
                Installa ora ✨
              </button>
            </>
          )}

          {status === 'downloading' && (
            <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onRemindLater}
                className="pill"
                style={{ padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer' }}
              >
                Nascondi finestra (continua in background)
              </button>
            </div>
          )}

          {(status === 'completed' || status === 'error') && (
            <div
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                onClick={onOpenReleaseUrl}
                className="pill"
                style={{ padding: '9px 16px', fontSize: '0.82rem', cursor: 'pointer' }}
              >
                Apri release su GitHub ↗
              </button>
              <button
                type="button"
                onClick={onRemindLater}
                className="pill pill-primary"
                style={{ padding: '9px 20px', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Chiudi
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
