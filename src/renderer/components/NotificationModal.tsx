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
  getNativeNotificationCapability,
  loadNotificationSettings,
  saveNotificationSettings,
  loadNotificationHistory,
  clearNotificationHistory,
  requestAppNotificationPermission,
  sendAppNotification,
  sendTestTransactionReminder,
  AppNotification,
  NotificationSettings,
  NativeNotificationCapability,
  NotificationChannel,
} from '../utils/notificationService';
import { APP_VERSION } from '../../version';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'light' | 'dark';
}

/**
 * Human readable summary of where the notification was delivered.
 * On macOS the destination is the system Notification Center, never the app window.
 */
function describeDelivery(channel: NotificationChannel | undefined, deliveredToSystem?: boolean): string {
  if (deliveredToSystem && channel === 'native') {
    return 'Notifica di sistema inviata: è comparsa nel Centro Notifiche di macOS (icona in alto a destra).';
  }
  if (deliveredToSystem && channel === 'applescript') {
    return 'Notifica di sistema inviata: è comparsa nel Centro Notifiche di macOS (canale compatibile, l\'app non è firmata).';
  }
  if (deliveredToSystem) {
    return 'Notifica inviata al sistema operativo.';
  }
  return 'Il sistema non ha potuto mostrare la notifica: verifica in Impostazioni di sistema → Notifiche che BudgetingMacApp sia consentito.';
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  theme,
}) => {
  const [supportStatus, setSupportStatus] = useState(getNotificationSupportStatus());
  const [capability, setCapability] = useState<NativeNotificationCapability | null>(null);
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
      getNativeNotificationCapability().then(setCapability);
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
        title: 'Test notifica — Registro Budget',
        body: `Le notifiche funzionano su ${supportStatus.platformLabel}! Riceverai avvisi su budget, promemoria e scadenze.`,
        category: 'system',
      });

      if (res.success) {
        setFeedbackMessage(describeDelivery(res.channel, res.deliveredToSystem));
        setHistory(loadNotificationHistory());
      } else {
        setFeedbackMessage(`${res.error || 'Invio notifica non riuscito.'}`);
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
        setFeedbackMessage(describeDelivery(res.channel, res.deliveredToSystem));
        setHistory(loadNotificationHistory());
      } else {
        setFeedbackMessage(`${res.error || 'Invio promemoria non riuscito.'}`);
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
        backgroundColor: 'var(--scrim)',
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
          backgroundColor: 'var(--panel-strong)',
          background: 'var(--panel-strong)',
          border: '1px solid var(--border-strong)',
          borderRadius: '22px',
          width: '100%',
          maxWidth: '700px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          color: 'var(--text)',
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
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-soft)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, var(--info), var(--chart-6))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--on-solid)',
                boxShadow: 'var(--shadow-accent)',
                flexShrink: 0,
              }}
            >
              <BellRing size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)' }}>
                  Centro Notifiche
                </h3>
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontWeight: 600,
                    background: isGranted ? 'var(--success-soft)' : 'var(--warning-soft)',
                    color: isGranted ? 'var(--success)' : 'var(--warning)',
                    border: `1px solid ${isGranted ? 'var(--success-border)' : 'var(--warning-border)'}`,
                  }}
                >
                  {supportStatus.platformLabel}
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.82rem', color: 'var(--muted)' }}>
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
              background: 'var(--overlay-medium)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text)',
              cursor: 'pointer',
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
              flexShrink: 0,
              boxShadow: isLight ? 'var(--shadow-xs)' : 'none',
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
            borderBottom: '1px solid var(--border)',
            gap: '8px',
            background: 'var(--bg-soft)',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === 'settings' ? '2px solid var(--info)' : '2px solid transparent',
              color: activeTab === 'settings' ? 'var(--info)' : 'var(--muted)',
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
              borderBottom: activeTab === 'guide' ? '2px solid var(--info)' : '2px solid transparent',
              color: activeTab === 'guide' ? 'var(--info)' : 'var(--muted)',
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
              borderBottom: activeTab === 'history' ? '2px solid var(--info)' : '2px solid transparent',
              color: activeTab === 'history' ? 'var(--info)' : 'var(--muted)',
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
            background: 'transparent',
          }}
        >
          {/* Feedback Banner */}
          {feedbackMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'var(--info-soft)',
                border: '1px solid var(--info-border)',
                color: 'var(--info)',
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
                    ? 'var(--success-soft)'
                    : isDenied
                    ? 'var(--danger-soft)'
                    : 'var(--warning-soft)',
                  border: `1px solid ${
                    isGranted
                      ? 'var(--success-border)'
                      : isDenied
                      ? 'var(--danger-border)'
                      : 'var(--warning-border)'
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
                    <CheckCircle2 size={24} color="var(--success)" />
                  ) : isDenied ? (
                    <AlertTriangle size={24} color="var(--danger)" />
                  ) : (
                    <BellRing size={24} color="var(--warning)" />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text)' }}>
                      {isGranted
                        ? 'Notifiche Attive e Autorizzate'
                        : isDenied
                        ? 'Notifiche Bloccate a livello di Sistema'
                        : 'Autorizzazione Notifiche Richiesta'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '2px' }}>
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
                      background: 'var(--info)',
                      color: 'var(--on-solid)',
                      fontWeight: 700,
                      border: 'none',
                      borderRadius: '10px',
                      padding: '8px 16px',
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: 'var(--shadow-accent)',
                    }}
                  >
                    <ShieldCheck size={16} /> Richiedi Autorizzazione
                  </button>
                )}
              </div>

              {/* Preferences Toggles */}
              <div
                style={{
                  background: 'var(--bg-soft)',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Preferenze di Ricezione
                </div>

                {/* Master switch */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text)' }}>Abilita Notifiche Generali</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Interruttore generale per tutti gli avvisi dell'app</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSetting('enabled')}
                    style={{
                      background: settings.enabled ? 'var(--info)' : 'var(--input-bg)',
                      color: settings.enabled ? 'var(--on-solid)' : 'var(--muted)',
                      border: `1px solid ${settings.enabled ? 'var(--info)' : 'var(--border-strong)'}`,
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

                <div style={{ height: '1px', background: 'var(--border)' }} />

                {/* Periodic transaction reminder switch & interval */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={16} color="var(--info)" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text)' }}>
                          Promemoria Aggiornamento Transazioni
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                          Ricorda periodicamente di registrare gli ultimi scontrini, uscite o bonifici
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleSetting('transactionReminderEnabled')}
                      style={{
                        background: settings.transactionReminderEnabled ? 'var(--success)' : 'var(--input-bg)',
                        color: settings.transactionReminderEnabled ? 'var(--on-solid)' : 'var(--muted)',
                        border: `1px solid ${settings.transactionReminderEnabled ? 'var(--success-strong)' : 'var(--border-strong)'}`,
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
                        background: 'var(--overlay-medium)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ fontSize: '0.76rem', color: 'var(--text)', fontWeight: 600 }}>
                        Frequenza del promemoria:
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select
                          value={settings.transactionReminderIntervalHours || 24}
                          onChange={(e) => handleChangeInterval(parseInt(e.target.value, 10))}
                          style={{
                            background: 'var(--input-bg)',
                            color: 'var(--text)',
                            border: '1px solid var(--border-strong)',
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
                            background: 'var(--input-bg)',
                            color: 'var(--info)',
                            border: '1px solid var(--border-strong)',
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

                <div style={{ height: '1px', background: 'var(--border)' }} />

                {/* Budget Alert toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <DollarSign size={16} color="var(--warning)" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text)' }}>Avvisi Superamento Budget</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>Notifica quando una categoria raggiunge l'80% o il 100% del limite</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSetting('budgetAlerts')}
                    style={{
                      background: settings.budgetAlerts ? 'var(--success)' : 'var(--input-bg)',
                      color: settings.budgetAlerts ? 'var(--on-solid)' : 'var(--muted)',
                      border: `1px solid ${settings.budgetAlerts ? 'var(--success-strong)' : 'var(--border-strong)'}`,
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

                <div style={{ height: '1px', background: 'var(--border)' }} />

                {/* Recurring Reminders toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={16} color="var(--info)" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text)' }}>Promemoria Scadenze &amp; Ricorrenti</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>Avviso il giorno della scadenza di abbonamenti e uscite periodiche</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSetting('recurringReminders')}
                    style={{
                      background: settings.recurringReminders ? 'var(--success)' : 'var(--input-bg)',
                      color: settings.recurringReminders ? 'var(--on-solid)' : 'var(--muted)',
                      border: `1px solid ${settings.recurringReminders ? 'var(--success-strong)' : 'var(--border-strong)'}`,
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

                <div style={{ height: '1px', background: 'var(--border)' }} />

                {/* Sound chime toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {settings.soundEnabled ? <Volume2 size={16} color="var(--chart-3)" /> : <VolumeX size={16} color="var(--muted)" />}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text)' }}>Suono Notifica Discreto</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>Tono discreto ad ogni arrivo dell'avviso</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSetting('soundEnabled')}
                    style={{
                      background: settings.soundEnabled ? 'var(--chart-3)' : 'var(--input-bg)',
                      color: settings.soundEnabled ? 'var(--on-solid)' : 'var(--muted)',
                      border: `1px solid ${settings.soundEnabled ? 'var(--chart-3)' : 'var(--border-strong)'}`,
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
                  background: 'var(--info-soft)',
                  border: '1px solid var(--info-border)',
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
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>Verifica Immediata Notifiche</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    Invia subito un avviso di prova su {supportStatus.platformLabel} per testare il canale di sistema
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSendTestNotification}
                  disabled={isTesting}
                  style={{
                    background: 'linear-gradient(135deg, var(--info), var(--chart-6))',
                    color: 'var(--on-solid)',
                    fontWeight: 700,
                    border: 'none',
                    borderRadius: '10px',
                    padding: '9px 18px',
                    fontSize: '0.84rem',
                    cursor: isTesting ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: 'var(--shadow-accent)',
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
                  background: 'var(--bg-soft)',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  padding: '18px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Laptop size={20} color="var(--info)" />
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>
                    Come funzionano le notifiche su macOS
                  </span>
                </div>
                <div style={{ fontSize: '0.84rem', lineHeight: 1.6, color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ margin: 0 }}>
                    • <strong>Notifiche di sistema</strong>: gli avvisi arrivano sul Mac, nel Centro Notifiche (icona in alto a destra), con suono di sistema e badge dell'app. Cliccando si apre la finestra dell'app.
                  </p>
                  <p style={{ margin: 0 }}>
                    • <strong>Niente banner dentro l'app</strong>: l'app non duplica le notifiche in sovrapposizione, perché sono già arrivate al sistema.
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
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                  Ultime {history.length} notifiche registrate:
                </span>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--danger)',
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
                    color: 'var(--muted)',
                    fontSize: '0.85rem',
                    background: 'var(--bg-soft)',
                    borderRadius: '12px',
                    border: '1px dashed var(--border-strong)',
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
                        background: 'var(--bg-soft)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text)' }}>{item.title}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                          {new Date(item.timestamp).toLocaleString('it-IT', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>{item.body}</p>
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
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-soft)',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
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
