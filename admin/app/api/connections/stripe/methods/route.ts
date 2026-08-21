import { proxyToBackend } from '../../../../../lib/api';

// The Stripe payment-methods panel (StripeMethods.tsx) reads its full state —
// configs, pinned/suggested, and the drift report — from here.
export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/connections/stripe/methods');
}
