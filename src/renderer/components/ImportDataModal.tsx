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
        backgroundColor: 'rgba(2, 8, 23, 0.78)',
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
          background: 'var(--panel-strong, #0f172a)',
          border: '1px solid var(--border, rgba(148, 163, 184, 0.2))',
          borderRadius: '24px',
          padding: '28px',
          width: '100%',
          maxWidth: parseResult ? '720px' : '580px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow, 0 25px 50px -12px rgba(0, 0, 0, 0.5))',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          color: 'var(--text, #f8fafc)',
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
                  color: '#38bdf8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  fontWeight: 700,
                }}
              >
                Importazione Intelligente Multiformato
              </span>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '4px 0 0 0', color: 'var(--text, #f8fafc)' }}>
                Importa Transazioni ed Estratti Conto
              </h2>
              <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: 'var(--muted, #94a3b8)', lineHeight: '1.45' }}>
                Carica fogli di calcolo Excel, fogli Apple Numbers, estratti conto PDF o file CSV. Il motore riconosce automaticamente la struttura delle colonne e gli importi anche se non sono nel formato standard.
              </p>
            </div>

            {/* Modalità / Profilo di importazione */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text, #f8fafc)' }}>
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
                  border: `1px solid ${importPreset === 'smart' ? '#0ea5e9' : 'var(--border, rgba(148, 163, 184, 0.2))'}`,
                  background: importPreset === 'smart' ? 'rgba(14, 165, 233, 0.08)' : 'transparent',
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
                  style={{ marginTop: '3px', accentColor: '#0ea5e9' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text, #f8fafc)' }}>
                      ⚡ Riconoscimento Intelligente & Flessibile
                    </span>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: '#0ea5e9',
                        color: '#fff',
                      }}
                    >
                      CONSIGLIATO
                    </span>
                  </div>
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted, #94a3b8)', marginTop: '2px', lineHeight: 1.4 }}>
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
                  border: `1px solid ${importPreset === 'template' ? '#0ea5e9' : 'var(--border, rgba(148, 163, 184, 0.2))'}`,
                  background: importPreset === 'template' ? 'rgba(14, 165, 233, 0.08)' : 'transparent',
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
                  style={{ marginTop: '3px', accentColor: '#0ea5e9' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text, #f8fafc)' }}>
                    Template Standard Excel / CSV
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted, #94a3b8)' }}>
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
                  border: `1px solid ${importPreset === 'raiffeisen' ? '#0ea5e9' : 'var(--border, rgba(148, 163, 184, 0.2))'}`,
                  background: importPreset === 'raiffeisen' ? 'rgba(14, 165, 233, 0.08)' : 'transparent',
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
                  style={{ marginTop: '3px', accentColor: '#0ea5e9' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text, #f8fafc)' }}>
                    Raiffeisen Cassa Rurale
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted, #94a3b8)' }}>
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
                  border: `1px solid ${importPreset === 'nexi' ? '#0ea5e9' : 'var(--border, rgba(148, 163, 184, 0.2))'}`,
                  background: importPreset === 'nexi' ? 'rgba(14, 165, 233, 0.08)' : 'transparent',
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
                  style={{ marginTop: '3px', accentColor: '#0ea5e9' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text, #f8fafc)' }}>
                    Estratto Conto Nexi
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted, #94a3b8)' }}>
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
                border: `2px dashed ${isDragging ? '#38bdf8' : 'var(--border, rgba(148, 163, 184, 0.3))'}`,
                background: isDragging ? 'rgba(56, 189, 248, 0.08)' : 'var(--overlay-subtle, rgba(255, 255, 255, 0.02))',
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
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text, #f8fafc)' }}>
                  Trascina qui il file oppure clicca per sfogliare
                </span>
                <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--muted, #94a3b8)' }}>
                  Formati supportati: Excel, Apple Numbers, PDF estratti conto, CSV
                </p>
              </div>

              {/* Badge dei formati supportati */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '4px' }}>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', fontWeight: 600 }}>
                  📊 Excel (.xlsx, .xls)
                </span>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(249, 115, 22, 0.15)', color: '#fb923c', fontWeight: 600 }}>
                  🍎 Apple Numbers (.numbers)
                </span>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', fontWeight: 600 }}>
                  📄 PDF Bancario (.pdf)
                </span>
                <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontWeight: 600 }}>
                  📝 CSV (.csv, .tsv)
                </span>
              </div>
            </div>

            {errorMessage && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  fontSize: '0.82rem',
                  color: '#f87171',
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
              <h3 style={{ margin: '0 0 6px', fontSize: '1.25rem', color: 'var(--text, #f8fafc)' }}>
                Analisi intelligente del file in corso...
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted, #94a3b8)' }}>
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
                    background: 'rgba(56, 189, 248, 0.15)',
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
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text, #f8fafc)' }}>
                      Anteprima Importazione
                    </h3>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '100px',
                        background: '#10b981',
                        color: '#fff',
                      }}
                    >
                      {parseResult.transactions.length} movimenti trovati
                    </span>
                  </div>
                  <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: 'var(--muted, #94a3b8)' }}>
                    File: <strong style={{ color: 'var(--text, #f8fafc)' }}>{currentFile?.name}</strong> • {parseResult.detectedFormatName}
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
                background: 'var(--overlay-subtle, rgba(255, 255, 255, 0.03))',
                border: '1px solid var(--border, rgba(148, 163, 184, 0.15))',
                borderRadius: '14px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text, #f8fafc)' }}>
                  Assegna le transazioni al conto:
                </span>
                <select
                  value={selectedTargetAccount}
                  onChange={(e) => setSelectedTargetAccount(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border, rgba(148, 163, 184, 0.3))',
                    background: 'var(--input-bg, #1e293b)',
                    color: 'var(--text, #f8fafc)',
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
                    border: '1px solid var(--border, rgba(148, 163, 184, 0.3))',
                    background: 'var(--input-bg, #1e293b)',
                    color: 'var(--text, #f8fafc)',
                    fontSize: '0.84rem',
                  }}
                />
              )}
            </div>

            {/* Tabella di Anteprima dei primi 5 movimenti */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted, #94a3b8)' }}>
                  Primi movimenti rilevati (Anteprima):
                </span>
                {parseResult.transactions.length > 5 && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted, #94a3b8)' }}>
                    Mostrati 5 di {parseResult.transactions.length}
                  </span>
                )}
              </div>

              <div
                style={{
                  border: '1px solid var(--border, rgba(148, 163, 184, 0.2))',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  background: 'var(--overlay-subtle, rgba(255, 255, 255, 0.02))',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255, 255, 255, 0.05)', textAlign: 'left', borderBottom: '1px solid var(--border, rgba(148, 163, 184, 0.15))' }}>
                      <th style={{ padding: '8px 12px', color: 'var(--muted, #94a3b8)', fontWeight: 600 }}>Data</th>
                      <th style={{ padding: '8px 12px', color: 'var(--muted, #94a3b8)', fontWeight: 600 }}>Descrizione</th>
                      <th style={{ padding: '8px 12px', color: 'var(--muted, #94a3b8)', fontWeight: 600 }}>Categoria Stima</th>
                      <th style={{ padding: '8px 12px', color: 'var(--muted, #94a3b8)', fontWeight: 600, textAlign: 'right' }}>Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.transactions.slice(0, 5).map((tx, idx) => {
                      const isIncome = tx.amount > 0 || tx.kind === 'income';
                      return (
                        <tr
                          key={tx.id || idx}
                          style={{
                            borderBottom: idx < 4 ? '1px solid var(--border, rgba(148, 163, 184, 0.08))' : 'none',
                          }}
                        >
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text, #f8fafc)' }}>
                            {tx.date}
                          </td>
                          <td
                            style={{
                              padding: '8px 12px',
                              maxWidth: '240px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--text, #f8fafc)',
                              fontWeight: 500,
                            }}
                            title={tx.merchant}
                          >
                            {tx.merchant}
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--muted, #94a3b8)' }}>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '100px',
                                background: 'rgba(255, 255, 255, 0.06)',
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
                              color: isIncome ? '#34d399' : '#f87171',
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
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  fontSize: '0.8rem',
                  color: '#38bdf8',
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
                  background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                  boxShadow: '0 4px 14px rgba(14, 165, 233, 0.35)',
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
