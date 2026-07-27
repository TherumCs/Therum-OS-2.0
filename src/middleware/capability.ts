import type { FastifyReply, FastifyRequest } from 'fastify';
import { capabilityService } from '../services/capability.service.js';

// Makes the Pure/Unlocked capability toggle REAL: when a capability is off,
// its API surface is off too — not just hidden in Studio. Register as a
// preHandler on every route the capability owns.
export function requireCapability(id: string) {
  return async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!(await capabilityService.isEnabled(id))) {
      reply.status(403).send({
        error: { code: 'capability_disabled', message: `The "${id}" capability is disabled. Enable it in Studio.`, field: 'capability' },
      });
    }
  };
}
