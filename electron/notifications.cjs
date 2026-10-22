/**
 * Native macOS notification dispatcher.
 *
 * Why this module exists
 * ----------------------
 * On recent macOS versions (26/27) the UserNotifications framework refuses to
 * authorize applications that are not signed with a valid Developer ID:
 *
 *   [com.apple.UserNotifications:Connections] Requested authorization
 *     [ didGrant: 0 hasError: 1 ]
 *
 * That is the exact reason notifications produced by `new Notification(...)`
 * never reached Notification Center for the unsigned builds of this app.
 *
 * Delivery strategy (first one that succeeds wins)
 *   1. `native`  — Electron's Notification API (UNUserNotificationCenter).
 *      Preferred: it is the only channel that supports a click action and
 *      that the system attributes to the app bundle. Works as soon as the
 *      build is signed (see `npm run package:mac:signed`).
 *   2. `applescript` — posts the notification through `osascript`, which is
 *      signed by Apple and therefore always authorized. The notification is
 *      attributed to the responsible process (our app), so it behaves like a
 *      regular system notification and clicking it brings the app forward.
 *   3. `none`    — nothing could be delivered; the caller falls back to the
 *      web/service-worker channel.
 *
 * The channel actually used is returned to the renderer so the UI can tell
 * the user where the notification went.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_BUNDLE_ID = 'com.budgeting.macapp';
const APP_DISPLAY_NAME = 'BudgetingMacApp';
const OSASCRIPT = '/usr/bin/osascript';

/** AppleScript that reads title/body from argv — no string interpolation, no injection. */
const OSA_SCRIPT = [
  'on run argv',
  'set theTitle to item 1 of argv',
  'set theBody to item 2 of argv',
  'if (count of argv) is greater than 2 then',
  'set silentMode to item 3 of argv',
  'else',
  'set silentMode to "false"',
  'end if',
  'if silentMode is "true" then',
  'display notification theBody with title theTitle sound name ""',
  'else',
  'display notification theBody with title theTitle',
  'end if',
  'end run',
].join('\n');

/** tag -> Notification, so a repeated alert replaces the previous one. */
const liveNotifications = new Map();

function resolveIconPath(explicitIcon) {
  const candidates = [
    explicitIcon,
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'public', 'icon-192.png'),
    path.join(__dirname, '..', 'public', 'icon.png'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Delivers a notification through `osascript`.
 * Resolves true when macOS accepted the notification.
 */
function deliverViaAppleScript({ title, body, silent }) {
  return new Promise((resolve) => {
    const args = ['-e', OSA_SCRIPT, title || APP_DISPLAY_NAME, body || '', silent ? 'true' : 'false'];
    execFile(OSASCRIPT, args, { timeout: 8000 }, (err) => {
      if (err) {
        console.warn('[native-notification] osascript fallback failed:', err.message);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

/**
 * Delivers a notification through Electron's Notification API.
 * Resolves false when the system refuses the authorization (unsigned builds).
 */
function deliverViaElectron(Notification, { title, body, silent, tag, iconPath, onClick }) {
  return new Promise((resolve) => {
    let settled = false;
    let notification;

    const finish = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, reason });
    };

    const timer = setTimeout(() => finish(false, 'timeout'), 4000);

    try {
      notification = new Notification({
        title: title || APP_DISPLAY_NAME,
        body: body || '',
        icon: iconPath,
        silent: Boolean(silent),
        urgency: 'normal',
        timeoutType: 'default',
      });

      notification.on('show', () => finish(true));
      notification.on('failed', (_event, error) => {
        finish(false, (error && error.message) || 'system refused the notification');
      });
      notification.on('click', () => {
        if (typeof onClick === 'function') {
          try {
            onClick();
          } catch {
            /* ignore */
          }
        }
      });
      notification.on('close', () => {
        if (tag) liveNotifications.delete(tag);
      });

      if (tag) {
        const previous = liveNotifications.get(tag);
        if (previous && typeof previous.close === 'function') {
          try {
            previous.close();
          } catch {
            /* ignore */
          }
        }
        liveNotifications.set(tag, notification);
      }

      notification.show();
    } catch (err) {
      finish(false, err && err.message ? err.message : String(err));
    }
  });
}

/**
 * Shows a macOS system notification.
 *
 * @returns {Promise<{ delivered: boolean, channel: 'native'|'applescript'|'none', reason?: string }>}
 */
async function showNativeNotification(Notification, payload = {}) {
  const { title, body, silent, tag, icon, onClick } = payload;
  const iconPath = resolveIconPath(icon);

  if (Notification && typeof Notification.isSupported === 'function' && Notification.isSupported()) {
    const result = await deliverViaElectron(Notification, {
      title,
      body,
      silent,
      tag,
      iconPath,
      onClick,
    });
    if (result.ok) {
      return { delivered: true, channel: 'native' };
    }
    // The system denied the authorization (unsigned build on recent macOS):
    // fall back to the Apple-signed helper so the notification still arrives.
    console.warn('[native-notification] native channel unavailable:', result.reason);
    const delivered = await deliverViaAppleScript({ title, body, silent });
    if (delivered) {
      return { delivered: true, channel: 'applescript', reason: result.reason };
    }
    return { delivered: false, channel: 'none', reason: result.reason };
  }

  const delivered = await deliverViaAppleScript({ title, body, silent });
  return delivered
    ? { delivered: true, channel: 'applescript' }
    : { delivered: false, channel: 'none', reason: 'Notification API unavailable' };
}

/**
 * Probes which channel will be used, without posting a notification.
 */
async function probeNativeNotification(Notification) {
  if (Notification && typeof Notification.isSupported === 'function' && Notification.isSupported()) {
    return { supported: true, channel: 'native', bundleId: APP_BUNDLE_ID };
  }
  return { supported: true, channel: 'applescript', bundleId: APP_BUNDLE_ID };
}

module.exports = {
  APP_BUNDLE_ID,
  APP_DISPLAY_NAME,
  showNativeNotification,
  probeNativeNotification,
  deliverViaAppleScript,
};
