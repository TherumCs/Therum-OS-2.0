import { logger } from './logger.js';
import type { HookPoint } from '../schemas/extension.schema.js';

export type HookHandler = (ctx: unknown) => unknown | Promise<unknown>;

interface Registered {
  extensionId: string;
  handler: HookHandler;
}

type FailureListener = (extensionId: string, hook: string, err: unknown) => void;

class HookBus {
  private hooks = new Map<string, Registered[]>();
  private onFailure: FailureListener | null = null;

  setFailureListener(fn: FailureListener): void {
    this.onFailure = fn;
  }

  register(extensionId: string, hook: HookPoint, handler: HookHandler): void {
    const list = this.hooks.get(hook) ?? [];
    list.push({ extensionId, handler });
    this.hooks.set(hook, list);
  }

  unregisterExtension(extensionId: string): void {
    for (const [hook, list] of this.hooks) {
      this.hooks.set(
        hook,
        list.filter((r) => r.extensionId !== extensionId),
      );
    }
  }

  // Extensions don't fail silently OR take down the main op: a throwing handler
  // is caught, logged, and reported (→ marked unhealthy); the op continues.
  async run(hook: HookPoint, ctx: unknown): Promise<void> {
    for (const r of this.hooks.get(hook) ?? []) {
      try {
        await r.handler(ctx);
      } catch (err) {
        logger.error({ err, extensionId: r.extensionId, hook }, 'extension hook failed');
        this.onFailure?.(r.extensionId, hook, err);
      }
    }
  }

  countFor(extensionId: string): number {
    let n = 0;
    for (const list of this.hooks.values()) n += list.filter((r) => r.extensionId === extensionId).length;
    return n;
  }
}

export const hookBus = new HookBus();
