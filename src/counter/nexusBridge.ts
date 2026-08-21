import { db } from '../lib/db.js';
import { ValidationError } from '../lib/errors.js';
import { connectionService } from '../services/connection.service.js';
import { findProvider, type ConnectionCategory } from '../lib/nexusCatalog.js';

// Counter ↔ Nexus.
//
// Ported from Counter 0.45's NexusBridge, and the doctrine comes with it:
//
//   Counter never asks the merchant for API keys. It pulls them from Nexus.
//
// Nexus owns the connector vault — every third-party credential Counter needs
// (POD providers, payment gateways, tax and shipping services) is stored,
// encrypted and tested there. Counter holds none of its own. That is the whole
// reason a merchant configures Printful once and every part of the system can
// use it, instead of pasting the same key into four settings screens.
//
// Payments already went through this door — connection.service's
// `credentialFor()` says so in its own comment. Fulfilment did not: shipments
// accepted any provider string at all, so `route(id, 'pintrful')` was a typo
// that silently produced a shipment routed to nothing. This closes that.

export interface ConnectedProvider {
  id: string;
  label: string;
  category: ConnectionCategory;
  status: string;
  lastTestOk: boolean | null;
}

export const nexusBridge = {
  /**
   * Providers the merchant has actually connected, optionally by category.
   * This is the list any Counter picker should render — offering a provider
   * with no credential just moves the failure to checkout.
   */
  async connected(category?: ConnectionCategory): Promise<ConnectedProvider[]> {
    const rows = await db.connection.findMany({
      where: category ? { category } : undefined,
      orderBy: { connectedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.provider,
      label: findProvider(r.provider)?.name ?? r.provider,
      category: r.category as ConnectionCategory,
      status: r.status,
      lastTestOk: r.lastTestOk,
    }));
  },

  /** Is this provider connected AND in the category Counter expects? */
  async isConnected(providerId: string, category?: ConnectionCategory): Promise<boolean> {
    const row = await db.connection.findUnique({ where: { provider: providerId } });
    if (!row) return false;
    return category ? row.category === category : true;
  },

  /**
   * Resolves a provider to its credential, or explains precisely why it can't.
   *
   * Throws rather than returning null: a caller about to hand work to a POD
   * partner needs to stop, not continue with an empty key and discover the
   * problem as a 401 from someone else's API.
   */
  async require(providerId: string, category: ConnectionCategory): Promise<{ id: string; credential: string }> {
    const known = findProvider(providerId);
    if (!known && !/^custom-[a-z0-9][a-z0-9-]{1,29}$/.test(providerId)) {
      throw new ValidationError(
        `"${providerId}" is not a provider Nexus knows about. Check the spelling, or add it as a custom connector.`,
        'provider',
      );
    }
    if (known && known.category !== category) {
      throw new ValidationError(
        `${known.name} is a ${known.category} provider — this needs a ${category} one.`,
        'provider',
      );
    }
    const credential = await connectionService.credentialFor(providerId);
    if (!credential) {
      throw new ValidationError(
        `${known?.name ?? providerId} isn't connected yet. Connect it under Nexus first — Counter keeps no keys of its own.`,
        'provider',
      );
    }
    return { id: providerId, credential };
  },

  /** Fulfilment providers, the list a shipment can legally be routed to. */
  async fulfillmentProviders(): Promise<ConnectedProvider[]> {
    return this.connected('fulfillment');
  },

  /** Payment gateways with a live credential. */
  async paymentProviders(): Promise<ConnectedProvider[]> {
    return this.connected('payments');
  },
};
