import React, { useState, useRef } from 'react';
import {
  smartParseAnyFile,
  type SmartParseResult,
  type ParsedTransaction,
} from '../utils/smartFileParser';

interface ImportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmImport: (
    transactions: ParsedTransaction[],
    assets?: any[],
    assetTransactions?: any[],
    destinationAccount?: string
  ) => void;
  existingAccounts: string[];
}

export const ImportDataModal: React.FC<ImportDataModalProps> = ({
  isOpen,
  onClose,
  onConfirmImport,
  existingAccounts,
}) => {
  const [importPreset, setImportPreset] = useState<'smart' | 'template' | 'raiffeisen' | 'nexi'>('smart');
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<SmartParseResult | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [selectedTargetAccount, setSelectedTargetAccount] = useState<string>('auto');
  const [customNewAccount, setCustomNewAccount] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelected = async (file: File) => {
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      setErrorMessage('Il file selezionato supera la dimensione massima di 50 MB.');
      return;
    }

    setIsParsing(true);
    setErrorMessage(null);
    setCurrentFile(file);

    try {
      const result = await smartParseAnyFile(file, importPreset, 'Conto Principale');

      if (result.transactions.length === 0 && (!result.assets || result.assets.length === 0)) {
        let msg = 'Nessun dato valido (transazioni o asset) rilevato nel file.';
        if (result.warnings && result.warnings.length > 0) {
          msg = result.warnings.join(' ');
        }
        setErrorMessage(msg);
        setParseResult(null);
      } else {
        setParseResult(result);
        setSelectedTargetAccount('auto');
      }
    } catch (err: any) {
      console.error('Errore durante il parsing del file:', err);
      setErrorMessage(`Impossibile leggere il file: ${err?.message || 'errore imprevisto'}. Verifica che il file non sia corrotto.`);
      setParseResult(null);
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleConfirm = () => {
    if (!parseResult) return;

    let finalTxs = [...parseResult.transactions];

    // Se l'utente ha scelto di sovrascrivere il conto di destinazione
    let targetAccountName: string | undefined = undefined;
    if (selectedTargetAccount === 'custom' && customNewAccount.trim()) {
      targetAccountName = customNewAccount.trim();
    } else if (selectedTargetAccount !== 'auto') {
      targetAccountName = selectedTargetAccount;
    }

    if (targetAccountName) {
      finalTxs = finalTxs.map((tx) => ({
        ...tx,
        account: targetAccountName!,
      }));
    }

    onConfirmImport(finalTxs, parseResult.assets, parseResult.assetTransactions, targetAccountName);
    handleResetModal();
  };

  const handleResetModal = () => {
    setParseResult(null);
    setCurrentFile(null);
    setErrorMessage(null);
    setIsParsing(false);
    setSelectedTargetAccount('auto');
    setCustomNewAccount('');
    onClose();
  };

  const getFileIcon = (fileName?: string) => {
    if (!fileName) return '📁';
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'numbers') return '🍎';
    if (ext === 'pdf') return '📄';
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return '📊';
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return '📝';
    return '📁';
  };

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
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleResetModal();
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
          maxWidth: parseResult ? '720px' : '580px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          color: 'var(--text)',
          transition: 'max-width 0.2s ease',
        }}
        role="dialog"
        aria-modal="true"
      >
        {/* Hidden input element */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.numbers,.pdf,application/pdf,application/vnd.apple.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />

        {/* FASE 1: Selezione formato e Caricamento File */}
        {!parseResult && !isParsing && (
          <>
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
                Importazione Intelligente Multiformato
              </span>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '4px 0 0 0', color: 'var(--text)' }}>
                Importa Transazioni ed Estratti Conto
              </h2>
              <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: 'var(--muted)', lineHeight: '1.45' }}>
                Carica fogli di calcolo Excel, fogli Apple Numbers, estratti conto PDF o file CSV. Il motore riconosce automaticamente la struttura delle colonne e gli importi anche se non sono nel formato standard.
              </p>
            </div>

            {/* Modalità / Profilo di importazione */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)' }}>
                Modalità di lettura:
              </span>

              {/* Opzione 1: Riconoscimento Intelligente (Predefinito) */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: '14px',
                  border: `1px solid ${importPreset === 'smart' ? 'var(--info)' : 'var(--border)'}`,
                  background: importPreset === 'smart' ? 'var(--info-soft)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setImportPreset('smart')}
              >
                <input
                  type="radio"
                  name="importPreset"
                  checked={importPreset === 'smart'}
                  onChange={() => setImportPreset('smart')}
                  style={{ marginTop: '3px', accentColor: 'var(--info)' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text)' }}>
                      ⚡ Riconoscimento Intelligente & Flessibile
                    </span>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'var(--info)',
                        color: 'var(--on-solid)',
                      }}
                    >
                      CONSIGLIATO
                    </span>
                  </div>
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '2px', lineHeight: 1.4 }}>
                    Riconosce automaticamente intestazioni, colonne, date e importi in qualsiasi ordine o lingua. Supporta Apple Numbers (.numbers), PDF, Excel e CSV.
                  </span>
                </div>
              </label>

              {/* Opzione 2: Template Standard */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  border: `1px solid ${importPreset === 'template' ? 'var(--info)' : 'var(--border)'}`,
                  background: importPreset === 'template' ? 'var(--info-soft)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setImportPreset('template')}
              >
                <input
                  type="radio"
                  name="importPreset"
                  checked={importPreset === 'template'}
                  onChange={() => setImportPreset('template')}
                  style={{ marginTop: '3px', accentColor: 'var(--info)' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>
                    Template Standard Excel / CSV
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Colonne standard: Data, Tipo, Conto, Beneficiario, Categoria, Prelievo, Deposito.
                  </span>
                </div>
              </label>

              {/* Opzione 3: Raiffeisen */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  border: `1px solid ${importPreset === 'raiffeisen' ? 'var(--info)' : 'var(--border)'}`,
                  background: importPreset === 'raiffeisen' ? 'var(--info-soft)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setImportPreset('raiffeisen')}
              >
                <input
                  type="radio"
                  name="importPreset"
                  checked={importPreset === 'raiffeisen'}
                  onChange={() => setImportPreset('raiffeisen')}
                  style={{ marginTop: '3px', accentColor: 'var(--info)' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>
                    Raiffeisen Cassa Rurale
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Estratto conto con colonne: Valuta beneficiario, Dare, Avere, Descrizione.
                  </span>
                </div>
              </label>

              {/* Opzione 4: Nexi */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  border: `1px solid ${importPreset === 'nexi' ? 'var(--info)' : 'var(--border)'}`,
                  background: importPreset === 'nexi' ? 'var(--info-soft)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setImportPreset('nexi')}
              >
                <input
                  type="radio"
                  name="importPreset"
                  checked={importPreset === 'nexi'}
                  onChange={() => setImportPreset('nexi')}
                  style={{ marginTop: '3px', accentColor: 'var(--info)' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>
                    Estratto Conto Nexi
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Lista movimenti carta con: Data, Categorie, Descrizione, Importo.
                  </span>
                </div>
              </label>
            </div>

            {/* Drag & Drop Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--info)' : 'var(--border-strong)'}`,
                background: isDragging ? 'var(--info-soft)' : 'var(--overlay-subtle)',
                borderRadius: '18px',
                padding: '24px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <div style={{ fontSize: '2.2rem' }}>📂</div>
              <div>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>
                  Trascina qui il file oppure clicca per sfogliare
                </span>
                <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
                  Formati supportati: Excel, Apple Numbers, PDF estratti conto, CSV
                </p>
              </div>

              {/* Badge dei formati supportati */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '4px' }}>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--success-soft)', color: 'var(--success)', fontWeight: 600 }}>
                  📊 Excel (.xlsx, .xls)
                </span>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--warning-soft)', color: 'var(--warning)', fontWeight: 600 }}>
                  🍎 Apple Numbers (.numbers)
                </span>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--danger-soft)', color: 'var(--danger)', fontWeight: 600 }}>
                  📄 PDF Bancario (.pdf)
                </span>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--info-soft)', color: 'var(--info)', fontWeight: 600 }}>
                  📝 CSV (.csv, .tsv)
                </span>
              </div>
            </div>

            {errorMessage && (
              <div
                style={{
                  background: 'var(--danger-soft)',
                  border: '1px solid var(--danger-border)',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  fontSize: '0.82rem',
                  color: 'var(--danger)',
                }}
              >
                ⚠️ {errorMessage}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="pill"
                onClick={handleResetModal}
                style={{ padding: '10px 20px', cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="button"
                className="pill pill-primary"
                onClick={() => fileInputRef.current?.click()}
                style={{ padding: '10px 24px', cursor: 'pointer', fontWeight: 700 }}
              >
                Seleziona file dal computer ↗
              </button>
            </div>
          </>
        )}

        {/* STATO: Parsing in corso */}
        {isParsing && (
          <div style={{ textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '3rem', animation: 'spin 1.5s infinite linear' }}>⏳</div>
            <div>
              <h3 style={{ margin: '0 0 6px', fontSize: '1.25rem', color: 'var(--text)' }}>
                Analisi intelligente del file in corso...
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
                Rilevamento automatico di intestazioni, date, causali ed importi.
              </p>
            </div>
          </div>
        )}

        {/* FASE 2: Anteprima & Conferma Importazione */}
        {parseResult && !isParsing && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '14px',
                    background: 'var(--info-soft)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                  }}
                >
                  {getFileIcon(currentFile?.name)}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)' }}>
                      Anteprima Importazione
                    </h3>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '100px',
                        background: 'var(--success)',
                        color: 'var(--on-solid)',
                      }}
                    >
                      {parseResult.transactions.length} movimenti trovati
                    </span>
                  </div>
                  <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    File: <strong style={{ color: 'var(--text)' }}>{currentFile?.name}</strong> • {parseResult.detectedFormatName}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="pill"
                onClick={() => {
                  setParseResult(null);
                  setCurrentFile(null);
                }}
                style={{ fontSize: '0.78rem', padding: '6px 12px', cursor: 'pointer' }}
              >
                Cambia file
              </button>
            </div>

            {/* Configurazione Conto di destinazione */}
            <div
              style={{
                background: 'var(--overlay-subtle)',
                border: '1px solid var(--border)',
                borderRadius: '14px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)' }}>
                  Assegna le transazioni al conto:
                </span>
                <select
                  value={selectedTargetAccount}
                  onChange={(e) => setSelectedTargetAccount(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                  }}
                >
                  <option value="auto">Mantieni conto rilevato dal file (predefinito)</option>
                  {existingAccounts.map((acc) => (
                    <option key={acc} value={acc}>
                      {acc}
                    </option>
                  ))}
                  <option value="custom">+ Nuovo conto personalizzato...</option>
                </select>
              </div>

              {selectedTargetAccount === 'custom' && (
                <input
                  type="text"
                  placeholder="Nome del nuovo conto (es. Revolut, Carta Amex, ecc.)"
                  value={customNewAccount}
                  onChange={(e) => setCustomNewAccount(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-strong)',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    fontSize: '0.84rem',
                  }}
                />
              )}
            </div>

            {/* Tabella di Anteprima dei primi 5 movimenti */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
                  Primi movimenti rilevati (Anteprima):
                </span>
                {parseResult.transactions.length > 5 && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Mostrati 5 di {parseResult.transactions.length}
                  </span>
                )}
              </div>

              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  background: 'var(--overlay-subtle)',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--overlay-medium)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 12px', color: 'var(--muted)', fontWeight: 600 }}>Data</th>
                      <th style={{ padding: '8px 12px', color: 'var(--muted)', fontWeight: 600 }}>Descrizione</th>
                      <th style={{ padding: '8px 12px', color: 'var(--muted)', fontWeight: 600 }}>Categoria Stima</th>
                      <th style={{ padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, textAlign: 'right' }}>Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.transactions.slice(0, 5).map((tx, idx) => {
                      const isIncome = tx.amount > 0 || tx.kind === 'income';
                      return (
                        <tr
                          key={tx.id || idx}
                          style={{
                            borderBottom: idx < 4 ? '1px solid var(--divider)' : 'none',
                          }}
                        >
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                            {tx.date}
                          </td>
                          <td
                            style={{
                              padding: '8px 12px',
                              maxWidth: '240px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--text)',
                              fontWeight: 500,
                            }}
                            title={tx.merchant}
                          >
                            {tx.merchant}
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '100px',
                                background: 'var(--overlay-strong)',
                                fontSize: '0.74rem',
                              }}
                            >
                              {tx.category || 'Altro'}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: '8px 12px',
                              textAlign: 'right',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              color: isIncome ? 'var(--chart-positive)' : 'var(--chart-negative)',
                            }}
                          >
                            {isIncome ? '+' : '-'}€{Math.abs(tx.amount).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Note asset o info aggiuntive */}
            {parseResult.assets && parseResult.assets.length > 0 && (
              <div
                style={{
                  background: 'var(--info-soft)',
                  border: '1px solid var(--info-border)',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  fontSize: '0.8rem',
                  color: 'var(--info)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>📈</span>
                <span>
                  Nel file sono stati rilevati anche <strong>{parseResult.assets.length} asset</strong> che verranno sincronizzati nel tuo portafoglio.
                </span>
              </div>
            )}

            {/* Azioni Conferma */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pill"
                onClick={handleResetModal}
                style={{ padding: '10px 18px', cursor: 'pointer' }}
              >
                Annulla
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
                Conferma e Importa ({parseResult.transactions.length}) ✨
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
