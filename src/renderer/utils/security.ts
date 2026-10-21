/**
 * Security & Anti-Tampering Protections
 * Defends against prototype pollution (CVE / GHSA-4r6h-8v6p-xvw6) and untrusted data manipulation.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Checks if a property key is dangerous (could cause prototype pollution)
 */
export function isDangerousKey(key: any): boolean {
  if (typeof key !== 'string') return false;
  const normalized = key.trim().toLowerCase();
  return DANGEROUS_KEYS.has(normalized);
}

/**
 * Initializes runtime defenses against Prototype Pollution by preventing
 * assignment or modification of sensitive keys on Object.prototype.
 */
export function initPrototypePollutionDefense(): void {
  try {
    if (typeof Object.prototype === 'object') {
      // Prevent overwriting __proto__
      Object.defineProperty(Object.prototype, '__proto__', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: Object.prototype,
      });
    }
  } catch {
    // If environment already locked, ignore
  }
}

/**
 * Safely assigns a key-value pair to a target object, ignoring dangerous keys.
 */
export function safeAssign(target: Record<string, any>, key: string, value: any): void {
  if (!target || typeof target !== 'object') return;
  if (isDangerousKey(key)) return;
  target[key] = value;
}

/**
 * Recursively sanitizes any JavaScript object or array parsed from untrusted sources
 * (Excel, CSV, JSON files) removing any prototype-polluting keys.
 */
export function sanitizeParsedObject<T>(input: T): T {
  if (!input || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeParsedObject(item)) as unknown as T;
  }

  const cleanObject = Object.create(null) as Record<string, any>;
  for (const [key, value] of Object.entries(input as Record<string, any>)) {
    if (isDangerousKey(key)) {
      continue;
    }
    cleanObject[key] = sanitizeParsedObject(value);
  }

  return cleanObject as T;
}
