import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { hookBus, type HookHandler } from '../lib/hooks.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import type { RegisterExtensionInput, UpdateExtensionInput, HookPoint } from '../schemas/extension.schema.js';

// In-process providers: core/built-in extensions register a factory by name.
// Enabling the extension wires its hooks into the bus. (Third-party JS package
// loading + true VM sandboxing is a Phase 6 hardening — declared, not faked.)
type Register = (hook: HookPoint, handler: HookHandler) => void;
export type Provider = (register: Register, config: Record<string, unknown>) => void;

const providers = new Map<string, Provider>();
export function registerProvider(name: string, provider: Provider): void {
  providers.set(name, provider);
}

export const extensionService = {
  async list() {
    const rows = await db.extension.findMany({ orderBy: { name: 'asc' } });
    return rows.map((e) => ({ ...e, activeHooks: hookBus.countFor(e.id) }));
  },

  async get(id: string) {
    const ext = await db.extension.findUnique({ where: { id } });
    if (!ext) throw new NotFoundError('Extension not found', 'id');
    return ext;
  },

  async register(input: RegisterExtensionInput) {
    const clash = await db.extension.findUnique({ where: { name: input.name }, select: { id: true } });
    if (clash) throw new ConflictError('An extension with this name is already registered.', 'name');
    const ext = await db.extension.create({
      data: {
        name: input.name,
        version: input.version,
        manifest: input.manifest as unknown as Prisma.InputJsonValue,
        config: input.config as Prisma.InputJsonValue,
        enabled: input.enabled,
        health: 'ok',
      },
    });
    if (ext.enabled) this.wire(ext.id, ext.name, ext.config);
    return ext;
  },

  async update(id: string, input: UpdateExtensionInput) {
    await this.get(id);
    const ext = await db.extension.update({
      where: { id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.enabled === true ? { health: 'ok' } : {}),
      },
    });
    hookBus.unregisterExtension(id); // always re-wire from a clean slate
    if (ext.enabled) this.wire(ext.id, ext.name, ext.config);
    return ext;
  },

  async remove(id: string) {
    await this.get(id);
    hookBus.unregisterExtension(id);
    await db.extension.delete({ where: { id } });
    return { id, deleted: true as const };
  },

  wire(id: string, name: string, config: Prisma.JsonValue): void {
    const provider = providers.get(name);
    if (!provider) return; // manifest-only extension (no in-process code) — allowed
    const cfg = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
    provider((hook, handler) => hookBus.register(id, hook, handler), cfg);
  },

  // On boot: mark-unhealthy on hook failure, then wire every enabled extension.
  async bootWire(): Promise<void> {
    hookBus.setFailureListener((extensionId) => {
      void db.extension.update({ where: { id: extensionId }, data: { health: 'unhealthy' } }).catch(() => undefined);
    });
    const enabled = await db.extension.findMany({ where: { enabled: true } });
    for (const e of enabled) this.wire(e.id, e.name, e.config);
  },
};
