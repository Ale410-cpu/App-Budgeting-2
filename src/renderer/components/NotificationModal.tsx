import React, { useState, useEffect } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  AlertTriangle,
  Laptop,
  Volume2,
  VolumeX,
  Calendar,
  DollarSign,
  Trash2,
  Send,
  ShieldCheck,
  X,
  Info,
  Clock,
  Sparkles,
} from 'lucide-react';
import {
  getNotificationSupportStatus,
  loadNotificationSettings,
  saveNotificationSettings,
  loadNotificationHistory,
  clearNotificationHistory,
  requestAppNotificationPermission,
  sendAppNotification,
  sendTestTransactionReminder,
  AppNotification,
  NotificationSettings,
} from '../utils/notificationService';
import { APP_VERSION } from '../../version';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'light' | 'dark';
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  theme,
}) => {
  const [supportStatus, setSupportStatus] = useState(getNotificationSupportStatus());
  const [settings, setSettings] = useState<NotificationSettings>(loadNotificationSettings());
  const [history, setHistory] = useState<AppNotification[]>([]);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isTestingReminder, setIsTestingReminder] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'history' | 'guide'>('settings');

  // Determine if light theme is active either from prop or document element class
  const isLight =
    theme === 'light' ||
    (typeof document !== 'undefined' && document.documentElement.classList.contains('light-theme'));

  useEffect(() => {
    if (isOpen) {
      setSupportStatus(getNotificationSupportStatus());
      setSettings(loadNotificationSettings());
      setHistory(loadNotificationHistory());
      setFeedbackMessage('');
    }
  }, [isOpen]);

  // Handle ESC key to close modal reliably
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRequestPermission = async () => {
    const res = await requestAppNotificationPermission();
    setSupportStatus(getNotificationSupportStatus());
    setFeedbackMessage(res.message || (res.granted ? 'Autorizzazione concessa!' : 'Permesso non concesso.'));
  };

  const handleToggleSetting = (key: keyof NotificationSettings) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    saveNotificationSettings(next);
    setFeedbackMessage('Impostazioni notifiche salvate.');
  };

  const handleChangeInterval = (hours: number) => {
    const next = { ...settings, transactionReminderIntervalHours: hours };
    setSettings(next);
    saveNotificationSettings(next);
    setFeedbackMessage(`Frequenza promemoria impostata a: ogni ${hours === 24 ? 'giorno (24h)' : `${hours} ore`}.`);
  };

  const handleSendTestNotification = async () => {
    setIsTesting(true);
    setFeedbackMessage('');
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const permRes = await requestAppNotificationPermission();
        setSupportStatus(getNotificationSupportStatus());
      }

      const res = await sendAppNotification({
        title: '🔔 Test Notifica - Registro Budget',
        body: `Le notifiche funzionano su ${supportStatus.platformLabel}! Riceverai avvisi su budget, promemoria e scadenze.`,
        category: 'system',
      });

      if (res.success) {
        if (res.deliveredToSystem) {
          setFeedbackMessage('✅ Notifica inviata! Banner visibile a schermo e nel Centro Notifiche di sistema.');
        } else {
          setFeedbackMessage('✅ Notifica generata! È visibile come banner a schermo (per il Centro Notifiche di sistema, attiva l\'autorizzazione in alto).');
        }
        setHistory(loadNotificationHistory());
      } else {
        setFeedbackMessage(`⚠️ ${res.error || 'Invio notifica non riuscito.'}`);
      }
    } catch (err: any) {
      setFeedbackMessage(`Errore invio notifica: ${err?.message || err}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSendTestReminder = async () => {
    setIsTestingReminder(true);
    setFeedbackMessage('');
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await requestAppNotificationPermission();
        setSupportStatus(getNotificationSupportStatus());
      }

      const res = await sendTestTransactionReminder();
      if (res.success) {
        setFeedbackMessage('✅ Promemoria inviato! Controlla il banner a schermo e il Centro Notifiche.');
        setHistory(loadNotificationHistory());
      } else {
        setFeedbackMessage(`⚠️ ${res.error || 'Invio promemoria non riuscito.'}`);
      }
    } catch (err: any) {
      setFeedbackMessage(`Errore invio promemoria: ${err?.message || err}`);
    } finally {
      setIsTestingReminder(false);
    }
  };

  const handleClearHistory = () => {
    clearNotificationHistory();
    setHistory([]);
    setFeedbackMessage('Cronologia notifiche svuotata.');
  };

  const isGranted = supportStatus.permission === 'granted';
  const isDenied = supportStatus.permission === 'denied';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Centro Notifiche"
    >
      <div
        className={`notification-modal-card ${isLight ? 'notification-modal-card-light' : ''}`}
        style={{
          backgroundColor: isLight ? '#ffffff' : 'var(--panel-strong, #0f172a)',
          background: isLight ? '#ffffff' : 'var(--panel-strong, #0f172a)',
          border: isLight
            ? '1px solid rgba(148, 163, 184, 0.35)'
            : '1px solid var(--border, rgba(148, 163, 184, 0.25))',
          borderRadius: '22px',
          width: '100%',
          maxWidth: '700px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: isLight
            ? '0 25px 60px -15px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(148, 163, 184, 0.2)'
            : '0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--border)',
          color: isLight ? '#0f172a' : 'var(--text, #0f172a)',
          overflow: 'hidden',
          animation: 'fadeInScale 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="notification-modal-header"
          style={{
            padding: '18px 24px',
            borderBottom: isLight
              ? '1px solid rgba(148, 163, 184, 0.25)'
              : '1px solid var(--border, rgba(148, 163, 184, 0.2))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: isLight ? '#f8fafc' : 'var(--overlay-subtle, rgba(0, 0, 0, 0.02))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)',
                flexShrink: 0,
              }}
            >
              <BellRing size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: isLight ? '#0f172a' : 'var(--text)' }}>
                  Centro Notifiche
                </h3>
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontWeight: 600,
                    background: isGranted ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                    color: isGranted ? '#16a34a' : '#d97706',
                    border: `1px solid ${isGranted ? 'rgba(34, 197, 94, 0.35)' : 'rgba(234, 179, 8, 0.35)'}`,
                  }}
                >
                  {supportStatus.platformLabel}
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: isLight ? '#475569' : 'var(--muted)' }}>
                Avvisi per superamento budget, spese ricorrenti e promemoria transazioni (macOS)
              </p>
            </div>
          </div>

          {/* Functional X Close Button with high visibility in both light & dark themes */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            aria-label="Chiudi finestra notifiche"
            title="Chiudi (Esc)"
            style={{
              background: isLight ? '#ffffff' : 'var(--overlay-medium, rgba(148, 163, 184, 0.15))',
              border: isLight
                ? '1px solid rgba(148, 163, 184, 0.4)'
                : '1px solid var(--border, rgba(148, 163, 184, 0.25))',
              color: isLight ? '#0f172a' : 'var(--text, #0f172a)',
              cursor: 'pointer',
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
              flexShrink: 0,
              boxShadow: isLight ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          className="notification-modal-tabs"
          style={{
            display: 'flex',
            padding: '8px 24px 0',
            borderBottom: isLight
              ? '1px solid rgba(148, 163, 184, 0.25)'
              : '1px solid var(--border, rgba(148, 163, 184, 0.2))',
            gap: '8px',
            background: isLight ? '#f8fafc' : 'var(--overlay-subtle, rgba(0, 0, 0, 0.01))',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'settings' ? '2px solid #0ea5e9' : '2px solid transparent',
              color: activeTab === 'settings' ? '#0ea5e9' : isLight ? '#475569' : 'var(--muted)',
              fontWeight: activeTab === 'settings' ? 700 : 500,
              fontSize: '0.86rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'color 0.15s ease',
            }}
          >
            <Bell size={15} /> Impostazioni &amp; Test
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'guide' ? '2px solid #0ea5e9' : '2px solid transparent',
              color: activeTab === 'guide' ? '#0ea5e9' : isLight ? '#475569' : 'var(--muted)',
              fontWeight: activeTab === 'guide' ? 700 : 500,
              fontSize: '0.86rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'color 0.15s ease',
            }}
          >
            <Info size={15} /> Guida macOS
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'history' ? '2px solid #0ea5e9' : '2px solid transparent',
              color: activeTab === 'history' ? '#0ea5e9' : isLight ? '#475569' : 'var(--muted)',
              fontWeight: activeTab === 'history' ? 700 : 500,
              fontSize: '0.86rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'color 0.15s ease',
            }}
          >
            <Calendar size={15} /> Cronologia ({history.length})
          </button>
        </div>

        {/* Content Body */}
        <div
          className="notification-modal-body"
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            background: isLight ? '#ffffff' : 'transparent',
          }}
        >
          {/* Feedback Banner */}
          {feedbackMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: isLight ? 'rgba(14, 165, 233, 0.12)' : 'rgba(14, 165, 233, 0.12)',
                border: '1px solid rgba(14, 165, 233, 0.35)',
                color: '#0284c7',
                fontSize: '0.84rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Info size={16} />
              <span>{feedbackMessage}</span>
            </div>
          )}

          {activeTab === 'settings' && (
            <>
              {/* Permission Status Box */}
              <div
                style={{
                  background: isGranted
                    ? isLight ? 'rgba(34, 197, 94, 0.12)' : 'rgba(34, 197, 94, 0.08)'
                    : isDenied
                    ? isLight ? 'rgba(239, 68, 68, 0.12)' : 'rgba(239, 68, 68, 0.08)'
                    : isLight ? 'rgba(234, 179, 8, 0.12)' : 'rgba(234, 179, 8, 0.08)',
                  border: `1px solid ${
                    isGranted
                      ? 'rgba(34, 197, 94, 0.35)'
                      : isDenied
                      ? 'rgba(239, 68, 68, 0.35)'
                      : 'rgba(234, 179, 8, 0.35)'
                  }`,
                  borderRadius: '14px',
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {isGranted ? (
                    <CheckCircle2 size={24} color="#16a34a" />
                  ) : isDenied ? (
                    <AlertTriangle size={24} color="#dc2626" />
                  ) : (
                    <BellRing size={24} color="#d97706" />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: isLight ? '#0f172a' : 'var(--text)' }}>
                      {isGranted
                        ? 'Notifiche Attive e Autorizzate'
                        : isDenied
                        ? 'Notifiche Bloccate a livello di Sistema'
                        : 'Autorizzazione Notifiche Richiesta'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: isLight ? '#475569' : 'var(--muted)', marginTop: '2px' }}>
                      {isGranted
                        ? `Le notifiche sono pronte per la ricezione (${supportStatus.platformLabel}).`
                        : isDenied
                        ? 'Per riattivarle, consenti le notifiche nelle impostazioni di sistema o del browser.'
                        : 'Consenti all\'applicazione di inviarti notifiche per ricevere promemoria e avvisi.'}
                    </div>
                  </div>
                </div>

                {!isGranted && !isDenied && (
                  <button
                    type="button"
                    onClick={handleRequestPermission}
                    style={{
                      background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
                      color: '#ffffff',
                      fontWeight: 700,
                      border: 'none',
                      borderRadius: '10px',
                      padding: '8px 16px',
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 2px 8px rgba(14, 165, 233, 0.3)',
                    }}
                  >
                    <ShieldCheck size={16} /> Richiedi Autorizzazione
                  </button>
                )}
              </div>

              {/* Preferences Toggles */}
              <div
                style={{
                  background: isLight ? '#f8fafc' : 'var(--overlay-subtle, rgba(0, 0, 0, 0.02))',
                  border: isLight
                    ? '1px solid rgba(148, 163, 184, 0.28)'
                    : '1px solid var(--border, rgba(148, 163, 184, 0.2))',
                  borderRadius: '14px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div style={{ fontSize: '0.84rem', fontWeight: 700, color: isLight ? '#334155' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Preferenze di Ricezione
                </div>

                {/* Master switch */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: isLight ? '#0f172a' : 'var(--text)' }}>Abilita Notifiche Generali</div>
                    <div style={{ fontSize: '0.75rem', color: isLight ? '#475569' : 'var(--muted)' }}>Interruttore generale per tutti gli avvisi dell'app</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSetting('enabled')}
                    style={{
                      background: settings.enabled ? '#0ea5e9' : isLight ? '#ffffff' : 'var(--input-bg)',
                      color: settings.enabled ? '#ffffff' : isLight ? '#475569' : 'var(--muted)',
                      border: `1px solid ${settings.enabled ? '#0284c7' : isLight ? 'rgba(148, 163, 184, 0.35)' : 'var(--border)'}`,
                      borderRadius: '20px',
                      padding: '4px 14px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {settings.enabled ? 'Attivo' : 'Spento'}
                  </button>
                </div>

                <div style={{ height: '1px', background: isLight ? 'rgba(148, 163, 184, 0.2)' : 'var(--border)' }} />

                {/* Periodic transaction reminder switch & interval */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={16} color="#0284c7" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.86rem', color: isLight ? '#0f172a' : 'var(--text)' }}>
                          Promemoria Aggiornamento Transazioni
                        </div>
                        <div style={{ fontSize: '0.74rem', color: isLight ? '#475569' : 'var(--muted)' }}>
                          Ricorda periodicamente di registrare gli ultimi scontrini, uscite o bonifici
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleSetting('transactionReminderEnabled')}
                      style={{
                        background: settings.transactionReminderEnabled ? '#10b981' : isLight ? '#ffffff' : 'var(--input-bg)',
                        color: settings.transactionReminderEnabled ? '#ffffff' : isLight ? '#475569' : 'var(--muted)',
                        border: `1px solid ${settings.transactionReminderEnabled ? '#059669' : isLight ? 'rgba(148, 163, 184, 0.35)' : 'var(--border)'}`,
                        borderRadius: '20px',
                        padding: '4px 12px',
                        fontSize: '0.76rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {settings.transactionReminderEnabled ? 'Sì' : 'No'}
                    </button>
                  </div>

                  {settings.transactionReminderEnabled && (
                    <div
                      style={{
                        marginLeft: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '8px',
                        padding: '8px 12px',
                        borderRadius: '10px',
                        background: isLight ? '#f1f5f9' : 'var(--overlay-medium, rgba(148, 163, 184, 0.1))',
                        border: isLight ? '1px solid rgba(148, 163, 184, 0.28)' : '1px solid var(--border)',
                      }}
                    >
                      <span style={{ fontSize: '0.76rem', color: isLight ? '#0f172a' : 'var(--text)', fontWeight: 600 }}>
                        Frequenza del promemoria:
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                          value={settings.transactionReminderIntervalHours || 24}
                          onChange={(e) => handleChangeInterval(parseInt(e.target.value, 10))}
                          style={{
                            background: isLight ? '#ffffff' : 'var(--input-bg, #ffffff)',
                            color: isLight ? '#0f172a' : 'var(--text, #0f172a)',
                            border: isLight ? '1px solid rgba(148, 163, 184, 0.35)' : '1px solid var(--border)',
                            borderRadius: '8px',
                            padding: '4px 8px',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <option value={12}>Ogni 12 ore</option>
                          <option value={24}>Ogni 24 ore (1 volta al giorno)</option>
                          <option value={48}>Ogni 2 giorni</option>
                          <option value={72}>Ogni 3 giorni</option>
                          <option value={168}>Ogni settimana (7 giorni)</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleSendTestReminder}
                          disabled={isTestingReminder}
                          title="Invia subito una notifica di promemoria transazioni per testarla"
                          style={{
                            background: isLight ? '#ffffff' : 'var(--input-bg)',
                            color: '#0284c7',
                            border: isLight ? '1px solid rgba(148, 163, 184, 0.35)' : '1px solid var(--border)',
                            borderRadius: '8px',
                            padding: '4px 8px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            cursor: isTestingReminder ? 'wait' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Sparkles size={12} /> {isTestingReminder ? 'Invio...' : 'Testa'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ height: '1px', background: isLight ? 'rgba(148, 163, 184, 0.2)' : 'var(--border)' }} />

                {/* Budget Alert toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <DollarSign size={16} color="#d97706" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.86rem', color: isLight ? '#0f172a' : 'var(--text)' }}>Avvisi Superamento Budget</div>
                      <div style={{ fontSize: '0.74rem', color: isLight ? '#475569' : 'var(--muted)' }}>Notifica quando una categoria raggiunge l'80% o il 100% del limite</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSetting('budgetAlerts')}
                    style={{
                      background: settings.budgetAlerts ? '#10b981' : isLight ? '#ffffff' : 'var(--input-bg)',
                      color: settings.budgetAlerts ? '#ffffff' : isLight ? '#475569' : 'var(--muted)',
                      border: `1px solid ${settings.budgetAlerts ? '#059669' : isLight ? 'rgba(148, 163, 184, 0.35)' : 'var(--border)'}`,
                      borderRadius: '20px',
                      padding: '4px 12px',
                      fontSize: '0.76rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {settings.budgetAlerts ? 'Sì' : 'No'}
                  </button>
                </div>

                <div style={{ height: '1px', background: isLight ? 'rgba(148, 163, 184, 0.2)' : 'var(--border)' }} />

                {/* Recurring Reminders toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={16} color="#0ea5e9" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.86rem', color: isLight ? '#0f172a' : 'var(--text)' }}>Promemoria Scadenze &amp; Ricorrenti</div>
                      <div style={{ fontSize: '0.74rem', color: isLight ? '#475569' : 'var(--muted)' }}>Avviso il giorno della scadenza di abbonamenti e uscite periodiche</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSetting('recurringReminders')}
                    style={{
                      background: settings.recurringReminders ? '#10b981' : isLight ? '#ffffff' : 'var(--input-bg)',
                      color: settings.recurringReminders ? '#ffffff' : isLight ? '#475569' : 'var(--muted)',
                      border: `1px solid ${settings.recurringReminders ? '#059669' : isLight ? 'rgba(148, 163, 184, 0.35)' : 'var(--border)'}`,
                      borderRadius: '20px',
                      padding: '4px 12px',
                      fontSize: '0.76rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {settings.recurringReminders ? 'Sì' : 'No'}
                  </button>
                </div>

                <div style={{ height: '1px', background: isLight ? 'rgba(148, 163, 184, 0.2)' : 'var(--border)' }} />

                {/* Sound chime toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {settings.soundEnabled ? <Volume2 size={16} color="#8b5cf6" /> : <VolumeX size={16} color={isLight ? '#64748b' : 'var(--muted)'} />}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.86rem', color: isLight ? '#0f172a' : 'var(--text)' }}>Suono Notifica Discreto</div>
                      <div style={{ fontSize: '0.74rem', color: isLight ? '#475569' : 'var(--muted)' }}>Tono discreto ad ogni arrivo dell'avviso</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSetting('soundEnabled')}
                    style={{
                      background: settings.soundEnabled ? '#8b5cf6' : isLight ? '#ffffff' : 'var(--input-bg)',
                      color: settings.soundEnabled ? '#ffffff' : isLight ? '#475569' : 'var(--muted)',
                      border: `1px solid ${settings.soundEnabled ? '#7c3aed' : isLight ? 'rgba(148, 163, 184, 0.35)' : 'var(--border)'}`,
                      borderRadius: '20px',
                      padding: '4px 12px',
                      fontSize: '0.76rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {settings.soundEnabled ? 'Attivo' : 'Muto'}
                  </button>
                </div>
              </div>

              {/* Test Button Card */}
              <div
                style={{
                  background: isLight
                    ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.12))'
                    : 'linear-gradient(135deg, rgba(14, 165, 233, 0.08), rgba(99, 102, 241, 0.08))',
                  border: isLight
                    ? '1px solid rgba(14, 165, 233, 0.35)'
                    : '1px solid rgba(14, 165, 233, 0.25)',
                  borderRadius: '14px',
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: isLight ? '#0f172a' : 'var(--text)' }}>Verifica Immediata Notifiche</div>
                  <div style={{ fontSize: '0.78rem', color: isLight ? '#475569' : 'var(--muted)' }}>
                    Invia subito un avviso di prova su {supportStatus.platformLabel} per testare banner e suono
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSendTestNotification}
                  disabled={isTesting}
                  style={{
                    background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                    color: '#ffffff',
                    fontWeight: 700,
                    border: 'none',
                    borderRadius: '10px',
                    padding: '9px 18px',
                    fontSize: '0.84rem',
                    cursor: isTesting ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)',
                  }}
                >
                  <Send size={15} /> {isTesting ? 'Invio in corso...' : 'Invia Notifica di Prova'}
                </button>
              </div>
            </>
          )}

          {activeTab === 'guide' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  background: isLight ? '#f8fafc' : 'var(--overlay-subtle, rgba(0, 0, 0, 0.02))',
                  border: isLight
                    ? '1px solid rgba(148, 163, 184, 0.28)'
                    : '1px solid var(--border, rgba(148, 163, 184, 0.2))',
                  borderRadius: '14px',
                  padding: '18px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Laptop size={20} color="#0ea5e9" />
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: isLight ? '#0f172a' : 'var(--text)' }}>
                    Come funzionano le notifiche su macOS
                  </span>
                </div>
                <div style={{ fontSize: '0.84rem', lineHeight: 1.6, color: isLight ? '#1e293b' : 'var(--text)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ margin: 0 }}>
                    • <strong>App Desktop nativa macOS</strong>: Le notifiche compaiono in alto a destra nel Centro Notifiche di macOS con suono di sistema e badge dell'applicazione.
                  </p>
                  <p style={{ margin: 0 }}>
                    • <strong>Safari / Chrome su Mac</strong>: Quando richiesto, premi "Consenti" per abilitare la ricezione dei banner.
                  </p>
                  <p style={{ margin: 0 }}>
                    • <strong>Se non ricevi le notifiche</strong>: Apri <em>Impostazioni di Sistema &gt; Notifiche &gt; BudgetingMacApp</em> e assicurati che siano consentiti banner e suoni.
                  </p>
                  <p style={{ margin: 0 }}>
                    • <strong>Promemoria spese</strong>: L'applicazione verificherà a ogni intervallo scelto se hai registrato movimenti recenti, inviando un promemoria per aiutarti a tenere il bilancio aggiornato.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', color: isLight ? '#475569' : 'var(--muted)' }}>
                  Ultime {history.length} notifiche registrate:
                </span>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#dc2626',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Trash2 size={13} /> Svuota cronologia
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div
                  style={{
                    padding: '32px 16px',
                    textAlign: 'center',
                    color: isLight ? '#64748b' : 'var(--muted)',
                    fontSize: '0.85rem',
                    background: isLight ? '#f8fafc' : 'var(--overlay-subtle, rgba(0, 0, 0, 0.02))',
                    borderRadius: '12px',
                    border: isLight ? '1px dashed rgba(148, 163, 184, 0.35)' : '1px dashed var(--border, rgba(148, 163, 184, 0.2))',
                  }}
                >
                  Nessuna notifica ricevuta di recente. Tocca "Invia Notifica di Prova" per testare!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {history.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '10px',
                        background: isLight ? '#f8fafc' : 'var(--overlay-subtle, rgba(0, 0, 0, 0.02))',
                        border: isLight ? '1px solid rgba(148, 163, 184, 0.25)' : '1px solid var(--border, rgba(148, 163, 184, 0.15))',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.86rem', color: isLight ? '#0f172a' : 'var(--text)' }}>{item.title}</span>
                        <span style={{ fontSize: '0.72rem', color: isLight ? '#64748b' : 'var(--muted)' }}>
                          {new Date(item.timestamp).toLocaleString('it-IT', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: isLight ? '#475569' : 'var(--muted)' }}>{item.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="notification-modal-footer"
          style={{
            padding: '14px 24px',
            borderTop: isLight
              ? '1px solid rgba(148, 163, 184, 0.25)'
              : '1px solid var(--border, rgba(148, 163, 184, 0.2))',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: isLight ? '#f8fafc' : 'var(--overlay-subtle, rgba(0, 0, 0, 0.02))',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: isLight ? '#64748b' : 'var(--muted)' }}>
            Versione {APP_VERSION} • Notifiche per macOS (Desktop e Web)
          </div>
          <button
            type="button"
            className="pill"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            style={{
              padding: '6px 18px',
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
};
