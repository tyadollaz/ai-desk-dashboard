import type { FastifyInstance } from 'fastify';

// Stubs: another agent implements the Google OAuth flow here.
export async function registerGoogleRoutes(app: FastifyInstance): Promise<void> {
  const notImplemented = async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) =>
    reply.code(501).send({ error: { code: 'needs_setup', message: 'Google connection is not implemented yet' } });
  app.get('/api/google/connect', notImplemented);
  app.get('/api/google/callback', notImplemented);
}
