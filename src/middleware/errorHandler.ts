import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';

// One place that turns any thrown error into the standard { error: {...} } shape.
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ error: err.toShape() });
      return;
    }

    if (err instanceof ZodError) {
      const first = err.issues[0];
      reply.status(422).send({
        error: {
          code: 'validation_error',
          message: first?.message ?? 'Invalid input',
          field: first?.path.join('.') || undefined,
          details: err.issues,
        },
      });
      return;
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        const target = err.meta?.target;
        reply.status(409).send({
          error: { code: 'conflict', message: 'A record with this value already exists.', field: Array.isArray(target) ? target.join(', ') : undefined },
        });
        return;
      }
      if (err.code === 'P2025') {
        reply.status(404).send({ error: { code: 'not_found', message: 'Record not found.' } });
        return;
      }
    }

    // Fastify's own validation / 4xx with a statusCode we trust.
    const e = err as { statusCode?: unknown; code?: unknown; message?: unknown };
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      reply.status(e.statusCode).send({
        error: {
          code: typeof e.code === 'string' ? e.code : 'bad_request',
          message: typeof e.message === 'string' ? e.message : 'Bad request',
        },
      });
      return;
    }

    req.log.error({ err }, 'unhandled error');
    reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });
}
