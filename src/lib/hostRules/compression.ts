import type { Rule } from './types.js';
import { num, str } from './types.js';

// Compression rules check what the server ACTUALLY returned, not what a config
// file claims. That distinction is the reason this pack exists: nginx can say
// `gzip on` and still send a proxied response uncompressed, which is exactly
// what happened on this stack until `gzip_proxied any` was added.

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|rss|xhtml))/;

export const compressionRules: Rule[] = [
  {
    id: 'cmp.html-uncompressed',
    axis: 'compression',
    // Deployed-only BY ARCHITECTURE, not by convenience: compression on this
    // stack is nginx's job on purpose — @fastify/compress was tried and
    // reverted after it served every page as 0 bytes. There is no proxy in
    // front of the local dev server, so an uncompressed response here is
    // expected and flagging it would be noise on every scan.
    scope: 'deployed',
    probes: ['http-response'],
    evaluate: (d) => {
      const h = d['http-response']!['html'] as Record<string, unknown>;
      const enc = str(h['contentEncoding']);
      const type = str(h['contentType']);
      const bytes = num(h['bytes']);
      if (enc) return null;
      if (!COMPRESSIBLE.test(type)) return null;
      // Below ~1 KB the header costs more than the saving; nginx's own
      // gzip_min_length defaults to 20 but 1024 is the practical threshold.
      if (bytes < 1024) return null;
      return {
        id: 'cmp.html-uncompressed',
        axis: 'compression',
        severity: bytes > 100_000 ? 'high' : 'medium',
        title: 'HTML is served uncompressed',
        detail: `GET / returned ${bytes.toLocaleString()} bytes of ${type} with no Content-Encoding.`,
        why:
          'Text compresses roughly 4-5x. This is the single cheapest performance win available, and it costs one ' +
          'line of config — but the request must be made with Accept-Encoding, which this probe did send, so the ' +
          'server genuinely is not compressing.',
        fix:
          'In the nginx server block:\n\n' +
          '  gzip on;\n' +
          '  gzip_proxied any;\n' +
          '  gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;\n' +
          '  gzip_min_length 1024;\n\n' +
          'gzip_proxied any is the line people miss — without it nginx will not compress a response it proxied ' +
          'from an upstream, which is every page here.',
      };
    },
  },
  {
    id: 'cmp.no-brotli',
    axis: 'compression',
    scope: 'deployed',
    probes: ['http-response'],
    evaluate: (d) => {
      const h = d['http-response']!['html'] as Record<string, unknown>;
      const enc = str(h['contentEncoding']);
      // Only worth raising once gzip works — otherwise the gzip rule is the
      // one to act on first.
      if (enc !== 'gzip') return null;
      return {
        id: 'cmp.no-brotli',
        axis: 'compression',
        severity: 'low',
        title: 'Brotli not in use',
        detail: 'Response used gzip; the request advertised br support.',
        why: 'Brotli is typically 15-20% smaller than gzip on text at comparable CPU cost for static content.',
        fix: 'Install libnginx-mod-brotli, then: brotli on; brotli_types <same list as gzip_types>; — keep gzip enabled as the fallback.',
      };
    },
  },
  {
    id: 'cmp.no-cache-headers',
    axis: 'compression',
    // Same reason as cmp.html-uncompressed — cache headers are set at the
    // proxy, which is not in the local request path.
    scope: 'deployed',
    probes: ['http-response'],
    evaluate: (d) => {
      const h = d['http-response']!['html'] as Record<string, unknown>;
      if (h['cacheControl'] || h['etag']) return null;
      return {
        id: 'cmp.no-cache-headers',
        axis: 'compression',
        severity: 'medium',
        title: 'No caching headers on the HTML response',
        detail: 'GET / returned neither Cache-Control nor ETag.',
        why:
          'With no validator and no directive, every client and proxy re-fetches the full document each time and ' +
          'cannot use a conditional request.',
        fix:
          'HTML should stay revalidated rather than cached hard:\n\n' +
          '  add_header Cache-Control "public, max-age=0, must-revalidate";\n\n' +
          'Hashed static assets are the opposite — immutable and a long max-age.',
      };
    },
  },
  {
    id: 'cmp.html-weight',
    axis: 'compression',
    scope: 'any',
    probes: ['http-response'],
    evaluate: (d) => {
      const h = d['http-response']!['html'] as Record<string, unknown>;
      const bytes = num(h['bytes']);
      const enc = str(h['contentEncoding']);
      // Only meaningful once compression is on; an uncompressed page is
      // already covered by cmp.html-uncompressed and would double-report.
      if (!enc) return null;
      if (bytes < 150_000) return null;
      return {
        id: 'cmp.html-weight',
        axis: 'compression',
        severity: 'medium',
        title: 'HTML document is large even after compression',
        detail: `GET / returned ${bytes.toLocaleString()} compressed bytes.`,
        why:
          'A heavy document delays first paint regardless of connection speed, because parsing cannot start until ' +
          'enough of it has arrived. Usually it means inlined CSS or markup that should be a component.',
        fix: 'Check for a large inlined stylesheet in the document head — on this stack the ported chrome CSS is ~1.1 MB and belongs in an external, cached file.',
      };
    },
  },
];
