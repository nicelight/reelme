/** Private HTTP revalidation runs after the route checks current access and availability. */
import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export function matchesPrivateCache(request: FastifyRequest, reply: FastifyReply, etag: string, varyBy?: 'Authorization' | 'Cookie') {
  reply.header('Cache-Control', 'private, no-cache').header('ETag', etag);
  if (varyBy) {
    const vary = reply.getHeader('Vary');
    reply.header('Vary', vary ? `${vary}, ${varyBy}` : varyBy);
  }
  return request.headers['if-none-match']?.split(',').some(value => {
    const tag = value.trim().replace(/^W\//, '');
    return tag === etag || tag === '*';
  });
}

export function sendPrivateJson(request: FastifyRequest, reply: FastifyReply, value: unknown) {
  const body = JSON.stringify(value);
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
  if (matchesPrivateCache(request, reply, etag, 'Cookie')) return reply.code(304).send();
  return reply.type('application/json').send(body);
}
