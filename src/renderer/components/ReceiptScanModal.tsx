import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, ClipboardPaste, Receipt, ScanLine, X } from 'lucide-react';
import { parseReceiptText, type ReceiptScanResult } from '../utils/receiptParser';

/** Dati che il modulo consegna ad App.tsx per creare la transazione. */
export interface ReceiptDraft {
  date: string;
  merchant: string;
  amount: number;
  category: string;
  account: string;
  note: string;
}

interface ReceiptScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (draft: ReceiptDraft) => void;
  accountOptions: string[];
  categoryOptions: string[];
}

type ScanPhase = 'idle' | 'scanning' | 'review' | 'error';

const emptyDraft = (): ReceiptDraft => ({
  date: new Date().toISOString().slice(0, 10),
  merchant: '',
  amount: 0,
  category: 'Altro',
  account: '',
  note: '',
});

/**
 * Riconoscimento scontrini.
 *
 * L'OCR e' nativo (Apple Vision su macOS e iOS): il bridge espone
 * `scanReceipt()` che restituisce il testo riconosciuto. Il parsing e' fatto
 * qui, in TypeScript, cosi' funziona identico su tutte le piattaforme.
 */
export const ReceiptScanModal: React.FC<ReceiptScanModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  accountOptions,
  categoryOptions,
}) => {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scan, setScan] = useState<ReceiptScanResult | null>(null);
  const [draft, setDraft] = useState<ReceiptDraft>(emptyDraft);
  const [manualText, setManualText] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const nativeAvailable = useMemo(
    () => typeof window !== 'undefined' && typeof window.budgetApp?.scanReceipt === 'function',
    []
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setErrorMessage(null);
    setScan(null);
    setDraft(emptyDraft());
    setManualText('');
    setShowManualInput(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  /** Applica il risultato del parsing ai campi modificabili. */
  const applyScan = useCallback((result: ReceiptScanResult) => {
    setScan(result);
    setDraft({
      date: result.date,
      merchant: result.merchant,
      amount: result.amount,
      category: result.category || 'Altro',
      account: accountOptions[0] || 'Conto principale',
      note: result.paymentMethod ? `Pagato con ${result.paymentMethod}` : '',
    });
    setPhase('review');
  }, [accountOptions]);

  const startScan = useCallback(async () => {
    if (!nativeAvailable) {
      setShowManualInput(true);
      setErrorMessage(
        'La scansione automatica è disponibile solo nelle app native (macOS e iOS). Incolla il testo dello scontrino per procedere.'
      );
      return;
    }

    setPhase('scanning');
    setErrorMessage(null);

    try {
      const result = await window.budgetApp!.scanReceipt!();
      if (!result) {
        setPhase('idle');
        return;
      }
      if (result.canceled) {
        setPhase('idle');
        return;
      }
      if (!result.success) {
        setPhase('error');
        setErrorMessage(result.error || 'Riconoscimento non riuscito.');
        return;
      }
      const parsed = parseReceiptText(result.text || '');
      if (!parsed.ok) {
        setPhase('error');
        setErrorMessage(
          parsed.warnings[0] || 'Non sono riuscito a individuare il totale dello scontrino. Riprova con una foto più nitida.'
        );
        setScan(parsed);
        return;
      }
      applyScan(parsed);
    } catch (error: any) {
      setPhase('error');
      setErrorMessage(error?.message || 'Riconoscimento non riuscito.');
    }
  }, [nativeAvailable, applyScan]);

  const handleManualParse = useCallback(() => {
    const parsed = parseReceiptText(manualText);
    if (!parsed.ok) {
      setPhase('error');
      setErrorMessage(parsed.warnings[0] || 'Nel testo non c\'è un totale riconoscibile.');
      setScan(parsed);
      return;
    }
    setErrorMessage(null);
    applyScan(parsed);
  }, [manualText, applyScan]);

  const handleConfirm = useCallback(() => {
    const merchant = draft.merchant.trim();
    const amount = Number(draft.amount);

    if (!merchant) {
      setErrorMessage('Indica l\'esercente.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMessage('L\'importo deve essere maggiore di zero.');
      return;
    }

    onConfirm({
      date: draft.date,
      merchant,
      amount,
      category: draft.category.trim() || 'Altro',
      account: draft.account.trim() || accountOptions[0] || 'Conto principale',
      note: draft.note.trim(),
    });
    reset();
    onClose();
  }, [draft, accountOptions, onConfirm, reset, onClose]);

  if (!isOpen) return null;

  const confidencePercent = scan ? Math.round(scan.confidence * 100) : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--scrim)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          reset();
          onClose();
        }
      }}
    >
      <div
        style={{
          background: 'var(--panel-strong)',
          border: '1px solid var(--border)',
          borderRadius: '24px',
          padding: '28px',
          width: '100%',
          maxWidth: phase === 'review' ? '680px' : '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          color: 'var(--text)',
        }}
        role="dialog"
        aria-modal="true"
      >
        {/* Intestazione */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--info)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 700,
              }}
            >
              Riconoscimento automatico
            </span>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '4px 0 0 0', color: 'var(--text)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Receipt size={22} aria-hidden="true" />
                Scansiona uno scontrino
              </span>
            </h2>
            <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: 'var(--muted)', lineHeight: '1.45' }}>
              Inquadra lo scontrino: l'app legge il testo, riconosce esercente, data e totale, e precompila la
              transazione. Resta sempre la tua conferma finale.
            </p>
          </div>
          <button
            type="button"
            className="pill"
            onClick={() => {
              reset();
              onClose();
            }}
            aria-label="Chiudi"
            style={{ padding: '6px 10px', cursor: 'pointer', flexShrink: 0 }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Stato: scansione in corso */}
        {phase === 'scanning' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              padding: '36px 20px',
              background: 'var(--overlay-subtle)',
              border: '1px solid var(--border)',
              borderRadius: '18px',
            }}
          >
            <Camera size={40} aria-hidden="true" style={{ color: 'var(--accent)' }} />
            <strong style={{ fontSize: '0.95rem' }}>Lettura dello scontrino in corso…</strong>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center' }}>
              La riconoscimento del testo avviene sul dispositivo: nessun dato lascia il dispositivo.
            </span>
          </div>
        )}

        {/* Stato: iniziale */}
        {phase === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button
              type="button"
              className="pill pill-primary"
              onClick={startScan}
              style={{
                padding: '14px 20px',
                fontSize: '0.95rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <ScanLine size={18} aria-hidden="true" />
              {nativeAvailable ? 'Scansiona con la fotocamera' : 'Riconosci da testo'}
            </button>

            {!nativeAvailable && (
              <button
                type="button"
                className="pill"
                onClick={() => setShowManualInput((current) => !current)}
                style={{ padding: '10px 16px', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                <ClipboardPaste size={16} aria-hidden="true" />
                Incolla il testo dello scontrino
              </button>
            )}
          </div>
        )}

        {/* Stato: inserimento manuale del testo */}
        {showManualInput && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className="form-field">
              <span>Testo dello scontrino</span>
              <textarea
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                placeholder={'CONAD\nVia Roma 45\n12/10/2026\n...'}
                rows={7}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </label>
            <button
              type="button"
              className="pill pill-primary"
              onClick={handleManualParse}
              disabled={!manualText.trim()}
              style={{ padding: '10px 18px', cursor: 'pointer', alignSelf: 'flex-start' }}
            >
              Riconosci i dati
            </button>
          </div>
        )}

        {/* Stato: errore */}
        {phase === 'error' && errorMessage && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger-border)',
              color: 'var(--danger)',
              fontSize: '0.85rem',
              lineHeight: '1.45',
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Stato: revisione dei dati riconosciuti */}
        {phase === 'review' && scan && (
          <>
            {/* Riepilogo */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'center',
                padding: '12px 14px',
                background: 'var(--overlay-subtle)',
                border: '1px solid var(--border)',
                borderRadius: '14px',
              }}
            >
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: confidencePercent >= 70 ? 'var(--success-soft)' : 'var(--warning-soft)',
                  color: confidencePercent >= 70 ? 'var(--success)' : 'var(--warning)',
                  border: `1px solid ${confidencePercent >= 70 ? 'var(--success-border)' : 'var(--warning-border)'}`,
                }}
              >
                Affidabilità {confidencePercent}%
              </span>
              {scan.subtotal !== null && (
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Imponibile €{scan.subtotal.toFixed(2)}</span>
              )}
              {scan.taxAmount !== null && (
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>IVA €{scan.taxAmount.toFixed(2)}</span>
              )}
              {scan.paymentMethod && (
                <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Pagamento: {scan.paymentMethod}</span>
              )}
            </div>

            {scan.warnings.length > 0 && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'var(--warning-soft)',
                  border: '1px solid var(--warning-border)',
                  color: 'var(--warning)',
                  fontSize: '0.8rem',
                  lineHeight: '1.4',
                }}
              >
                {scan.warnings.join(' ')}
              </div>
            )}

            {/* Campi modificabili */}
            <div className="form-grid">
              <label className="form-field">
                <span>Data</span>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Importo (€)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={draft.amount || ''}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, amount: Number(event.target.value.replace(',', '.')) || 0 }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Esercente</span>
                <input
                  value={draft.merchant}
                  onChange={(event) => setDraft((current) => ({ ...current, merchant: event.target.value }))}
                  placeholder="Nome esercente"
                />
              </label>
              <label className="form-field">
                <span>Categoria</span>
                <input
                  value={draft.category}
                  list="receipt-category-options"
                  onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                  placeholder="Categoria budget"
                />
              </label>
              <label className="form-field">
                <span>Conto</span>
                <input
                  value={draft.account}
                  list="receipt-account-options"
                  onChange={(event) => setDraft((current) => ({ ...current, account: event.target.value }))}
                  placeholder="Conto"
                />
              </label>
              <label className="form-field">
                <span>Nota</span>
                <input
                  value={draft.note}
                  onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Nota (facoltativa)"
                />
              </label>
            </div>

            <datalist id="receipt-category-options">
              {categoryOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <datalist id="receipt-account-options">
              {accountOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>

            {/* Righe riconosciute */}
            {scan.items.length > 0 && (
              <details>
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: 'var(--text)',
                    marginBottom: '8px',
                  }}
                >
                  {scan.items.length} {scan.items.length === 1 ? 'riga riconosciuta' : 'righe riconosciute'}
                </summary>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    background: 'var(--overlay-subtle)',
                    maxHeight: '220px',
                    overflowY: 'auto',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <tbody>
                      {scan.items.map((item, index) => (
                        <tr key={`${item.description}-${index}`} style={{ borderBottom: '1px solid var(--divider)' }}>
                          <td style={{ padding: '6px 10px', color: 'var(--text)' }}>
                            {item.quantity ? `${item.quantity} × ` : ''}
                            {item.description}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            €{item.amount.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* Testo riconosciuto dall'OCR (diagnostica) */}
            {scan.rawText && (
              <details>
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: 'var(--muted)',
                  }}
                >
                  Testo riconosciuto dall'OCR
                </summary>
                <pre
                  style={{
                    marginTop: '8px',
                    maxHeight: '180px',
                    overflow: 'auto',
                    padding: '10px',
                    borderRadius: '10px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    fontSize: '0.72rem',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {scan.rawText}
                </pre>
              </details>
            )}

            {/* Azioni */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pill"
                onClick={() => {
                  setPhase('idle');
                  setErrorMessage(null);
                }}
                style={{ padding: '10px 18px', cursor: 'pointer' }}
              >
                Scansiona un altro
              </button>
              <button
                type="button"
                className="pill pill-primary"
                onClick={handleConfirm}
                style={{
                  padding: '10px 24px',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  background: 'linear-gradient(135deg, var(--info), var(--chart-6))',
                  boxShadow: 'var(--shadow-accent)',
                }}
              >
                Aggiungi transazione
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReceiptScanModal;
