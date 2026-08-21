import type { FastifyRequest } from 'fastify';
import { customerAuth } from './customerAuth.js';
import { UnauthorizedError } from '../lib/errors.js';

// Reading the storefront customer's session, in one place.
//
// This lived inside counter.ts as a private helper until the cart routes
// needed it too (a signed-in shopper's order has to bind to their account).
// Two copies of "how do we know who this is" is exactly the kind of drift that
// ends with one of them trusting something it shouldn't.
//
// Two transports, both bearer-equivalent: an Authorization header for fetch
// callers, and the `th_customer` cookie so a server-rendered page knows the
// shopper without JavaScript having run first.

export function customerTokenFrom(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = /(?:^|;\s*)th_customer=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  return cookie ? decodeURIComponent(cookie) : null;
}

/** The signed-in customer, or null. Never throws — for optional-auth routes. */
export async function resolveCustomer(req: FastifyRequest) {
  const token = customerTokenFrom(req);
  if (!token) return null;
  return customerAuth.resolveSession(token).catch(() => null);
}

/** The signed-in customer, or 401. */
export async function requireCustomer(req: FastifyRequest) {
  const customer = await resolveCustomer(req);
  if (!customer) throw new UnauthorizedError('Sign in to continue.');
  return customer;
}
