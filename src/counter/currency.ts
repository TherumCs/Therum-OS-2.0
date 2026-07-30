import { ValidationError } from '../lib/errors.js';

// Counter — currency.
//
// The gap this closes: currency was the literal string 'USD' hardcoded in
// cart.service, and money was formatted with a hardcoded 'en-US' locale. A UK
// or EU store could not sell in its own currency at all.
//
// SCOPE, deliberately: ONE store currency, configurable. Not multi-currency.
//
// Multi-currency display (show the same product in GBP and USD) is a much
// larger decision than a formatting helper: it changes what a stored price
// MEANS, requires an FX rate recorded on every order for accounting, and
// forces a rounding policy per currency. Doing half of it — converting at
// display time with a live rate and no stored rate — produces orders whose
// totals cannot be reconciled later. So this does the part that is
// unambiguously right, and leaves the rest as an explicit decision.

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  /** Minor units per major unit. Not always 100 — see JPY. */
  minorUnits: number;
  /** Default locale for formatting, overridable in settings. */
  locale: string;
}

// The set a store can pick from. Zero-decimal currencies are the trap here:
// JPY has no minor unit, so ¥1000 is 1000 — not 100000 — and treating it like
// cents overcharges by 100×.
export const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2, locale: 'en-US' },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', minorUnits: 2, locale: 'en-GB' },
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2, locale: 'en-IE' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$', minorUnits: 2, locale: 'en-CA' },
  { code: 'AUD', name: 'Australian Dollar', symbol: '$', minorUnits: 2, locale: 'en-AU' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: '$', minorUnits: 2, locale: 'en-NZ' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', minorUnits: 2, locale: 'de-CH' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', minorUnits: 2, locale: 'sv-SE' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', minorUnits: 2, locale: 'nb-NO' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', minorUnits: 2, locale: 'da-DK' },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', minorUnits: 2, locale: 'pl-PL' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnits: 0, locale: 'ja-JP' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: '$', minorUnits: 2, locale: 'en-SG' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: '$', minorUnits: 2, locale: 'en-HK' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', minorUnits: 2, locale: 'en-ZA' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', minorUnits: 2, locale: 'pt-BR' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', minorUnits: 2, locale: 'es-MX' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', minorUnits: 2, locale: 'en-IN' },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** Single source of truth for "which currency codes are legal" — zod schemas
 *  derive from this rather than repeating the list. */
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [string, ...string[]];

export function currencyInfo(code: string): CurrencyInfo {
  const found = BY_CODE.get(code.toUpperCase());
  if (!found) throw new ValidationError(`${code} is not a currency this store supports.`, 'currency');
  return found;
}

export function isSupported(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}

/**
 * Formats a MINOR-UNIT integer for display.
 *
 * Takes minor units because that is how every price in this schema is stored;
 * accepting a major-unit float here would invite exactly the 100× error this
 * codebase already avoids everywhere else.
 */
export function formatMoney(minor: number, code: string, locale?: string): string {
  const info = currencyInfo(code);
  const major = info.minorUnits === 0 ? minor : minor / 10 ** info.minorUnits;
  return new Intl.NumberFormat(locale ?? info.locale, {
    style: 'currency',
    currency: info.code,
    minimumFractionDigits: info.minorUnits,
    maximumFractionDigits: info.minorUnits,
  }).format(major);
}

/** Major units -> minor. The only sanctioned way to convert an entered price. */
export function toMinor(major: number, code: string): number {
  const info = currencyInfo(code);
  return Math.round(major * 10 ** info.minorUnits);
}

/** Minor -> major, for editing a stored price in a form. */
export function toMajor(minor: number, code: string): number {
  const info = currencyInfo(code);
  return info.minorUnits === 0 ? minor : minor / 10 ** info.minorUnits;
}
