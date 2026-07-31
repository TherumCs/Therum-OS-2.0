import { z } from 'zod';
import { contentService } from '../services/content.service.js';
import { NotFoundError } from './errors.js';
import { env } from './env.js';
import { importQueue } from './queue.js';

// Section 08 of the inventory specs 8 tools; 5 of them (rebuild_site,
// list/apply brand presets, derive/review/apply design tokens) name 2.0
// subsystems that don't exist yet (no public build pipeline, no theme-store,
// no token-mining pipeline). Exposing them would mean tools/list advertises
// 8 tools where 5 always error — worse for an agent caller than a small,
// honest, fully-working set. Only the 2 that map to real 2.0 capability are
// registered; the rest join this list as their underlying feature lands.
const ADMIN_BASE_PATH = '/tos-admin'; // must match admin/lib/session.ts's BASE_PATH

function adminOrigin(): string {
  return env.CORS_ORIGINS.split(',')[0]?.trim() ?? 'http://localhost:3100';
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  // Write tools mutate site state — the MCP route requires a 'write'-scoped
  // API token (or a real session) before dispatching them.
  write?: boolean;
  handler: (args: unknown) => Promise<McpToolResult>;
}

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
function fail(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const GetPreviewUrlInput = z.object({ contentId: z.string().min(1) });

export const mcpTools: McpTool[] = [
  {
    name: 'get_preview_url',
    description: 'Get the admin preview URL for a content item (page, post, or case study) by id.',
    inputSchema: {
      type: 'object',
      properties: { contentId: { type: 'string', description: 'The content item id.' } },
      required: ['contentId'],
    },
    async handler(args) {
      let input: z.infer<typeof GetPreviewUrlInput>;
      try {
        input = GetPreviewUrlInput.parse(args);
      } catch {
        return fail('Invalid arguments: expected { contentId: string }.');
      }
      try {
        const item = await contentService.get(input.contentId);
        return ok({ url: `${adminOrigin()}${ADMIN_BASE_PATH}/preview/${item.id}`, title: item.title, status: item.status });
      } catch (e) {
        if (e instanceof NotFoundError) return fail(`No content found with id "${input.contentId}".`);
        throw e;
      }
    },
  },
  {
    name: 'check_queue_status',
    description: 'Get job counts (waiting/active/completed/failed/delayed) for every background job queue.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const counts = await importQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      return ok({ queues: [{ name: 'import', counts }] });
    },
  },
];


// ── Site-operations tools (2026-07-25, Bam: "connection to the site for you
// to chat and do stuff with MCP is the way"). Read tools cover the surfaces
// an assistant needs to see; create_draft is the one write — deliberately
// draft-only (a human publishes), and gated on write scope by the route.

const ListContentInput = z.object({
  type: z.enum(['page', 'post', 'case_study']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
const CreateDraftInput = z.object({
  type: z.enum(['page', 'post', 'case_study']).default('post'),
  title: z.string().min(1).max(240),
  bodyHtml: z.string().max(200_000),
  excerpt: z.string().max(500).optional(),
});
const SalesReportInput = z.object({ days: z.number().int().min(1).max(365).default(30) });
const ListOrdersInput = z.object({ limit: z.number().int().min(1).max(50).default(20) });

mcpTools.push(
  {
    name: 'list_content',
    description: 'List site content (pages, posts, case studies) with type/status filters. Returns id, title, slug, type, status, updatedAt.',
    inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['page', 'post', 'case_study'] }, status: { type: 'string', enum: ['draft', 'published', 'archived'] }, limit: { type: 'number' } } },
    async handler(args) {
      const parsed = ListContentInput.safeParse(args ?? {});
      if (!parsed.success) return fail(parsed.error.message);
      const { contentService } = await import('../services/content.service.js');
      const res = await contentService.list({ type: parsed.data.type, status: parsed.data.status, limit: parsed.data.limit } as never);
      return ok(res.items.map((i: { id: string; title: string; slug: string; type: string; status: string; updatedAt: Date }) => ({ id: i.id, title: i.title, slug: i.slug, type: i.type, status: i.status, updatedAt: i.updatedAt })));
    },
  },
  {
    name: 'create_draft',
    description: 'Create a DRAFT content item (page, post, or case study) with an HTML body. Drafts only — publishing stays human.',
    write: true,
    inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['page', 'post', 'case_study'] }, title: { type: 'string' }, bodyHtml: { type: 'string' }, excerpt: { type: 'string' } }, required: ['title', 'bodyHtml'] },
    async handler(args) {
      const parsed = CreateDraftInput.safeParse(args ?? {});
      if (!parsed.success) return fail(parsed.error.message);
      const { contentService } = await import('../services/content.service.js');
      const item = await contentService.create({ type: parsed.data.type, title: parsed.data.title, body: parsed.data.bodyHtml, bodyFormat: 'html', status: 'draft', excerpt: parsed.data.excerpt } as never);
      return ok({ id: item.id, slug: item.slug, status: item.status, adminUrl: `/tos-admin/${parsed.data.type === 'post' ? 'posts' : parsed.data.type === 'page' ? 'pages' : 'case-studies'}` });
    },
  },
  {
    name: 'sales_report',
    description: 'Sales summary for the last N days: order count, gross/refunded/net (minor units), discounts, average order, top products, daily buckets. Paid orders only.',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } } },
    async handler(args) {
      const parsed = SalesReportInput.safeParse(args ?? {});
      if (!parsed.success) return fail(parsed.error.message);
      const { salesReportService } = await import('../services/commerceEmail.service.js');
      return ok(await salesReportService.summary(parsed.data.days));
    },
  },
  {
    name: 'list_orders',
    description: 'List recent orders: number, status, total (minor units), currency, createdAt. Access tokens are never included.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    async handler(args) {
      const parsed = ListOrdersInput.safeParse(args ?? {});
      if (!parsed.success) return fail(parsed.error.message);
      const { db } = await import('./db.js');
      const orders = await db.order.findMany({ orderBy: { createdAt: 'desc' }, take: parsed.data.limit, select: { number: true, status: true, total: true, currency: true, createdAt: true } });
      return ok(orders);
    },
  },
  {
    name: 'connections_status',
    description: 'Nexus connection health: every connected provider with category, last-test result, and connected date. Credentials are never included.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const { db } = await import('./db.js');
      const rows = await db.connection.findMany({ select: { provider: true, category: true, status: true, connectedAt: true, lastTestedAt: true, lastTestOk: true } });
      return ok(rows);
    },
  },
);

// ── Scoped editing + host advisor ─────────────────────────────────────
// Bricks and CSS only — see scopedFiles.service.ts for why those roots and
// nothing else. Reads are open within that scope; writing is a two-step
// propose -> apply, and `apply` takes a proposal id rather than content, so a
// human has always seen the exact diff that lands.
//
// These are registered here rather than behind a separate agent API on
// purpose: the dashboard agent and Claude Code running locally then drive the
// same tools, with one implementation and one set of guarantees.
const ListFilesInput = z.object({ root: z.string().optional() });
const ReadFileInput = z.object({ root: z.string().min(1), path: z.string().min(1) });
const ProposeEditInput = z.object({ root: z.string().min(1), path: z.string().min(1), content: z.string() });
const ApplyEditInput = z.object({ proposalId: z.string().min(1) });

mcpTools.push(
  {
    name: 'list_editable_files',
    description:
      'List the files this workspace allows editing: Bricks addons and the site chrome CSS. Nothing outside those roots is reachable.',
    inputSchema: { type: 'object', properties: { root: { type: 'string', enum: ['bricks', 'chrome-css'] } } },
    async handler(args) {
      const { root } = ListFilesInput.parse(args ?? {});
      const { scopedFilesService } = await import('../services/scopedFiles.service.js');
      try {
        return ok({ roots: scopedFilesService.roots(), files: await scopedFilesService.list(root) });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: 'read_editable_file',
    description: 'Read one file from an editable root. Paths are relative to that root.',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', enum: ['bricks', 'chrome-css'] }, path: { type: 'string' } },
      required: ['root', 'path'],
    },
    async handler(args) {
      const { root, path } = ReadFileInput.parse(args);
      const { scopedFilesService } = await import('../services/scopedFiles.service.js');
      try {
        return ok({ root, path, content: await scopedFilesService.read(root, path) });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: 'propose_edit',
    description:
      'Propose replacing a file with new content. Writes NOTHING: returns a unified diff and a proposalId for a human to review. Send the FULL new file content, not a patch.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', enum: ['bricks', 'chrome-css'] },
        path: { type: 'string' },
        content: { type: 'string', description: 'The complete new file contents.' },
      },
      required: ['root', 'path', 'content'],
    },
    async handler(args) {
      const { root, path, content } = ProposeEditInput.parse(args);
      const { editProposalService } = await import('../services/editProposal.service.js');
      try {
        const p = await editProposalService.proposeFile(root, path, content);
        return ok({ proposalId: p.id, label: p.label, diff: p.diff, stats: p.stats, warnings: p.warnings });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    // The only write tool here, and it cannot write arbitrary content: it
    // applies a proposal whose diff a human already saw. It re-reads the file
    // first and refuses if it moved underneath the proposal.
    name: 'apply_edit',
    description:
      'Apply a previously proposed edit by id, after a human approved the diff. Commits the change where the file is tracked in git.',
    write: true,
    inputSchema: { type: 'object', properties: { proposalId: { type: 'string' } }, required: ['proposalId'] },
    async handler(args) {
      const { proposalId } = ApplyEditInput.parse(args);
      const { editProposalService } = await import('../services/editProposal.service.js');
      try {
        return ok(await editProposalService.apply(proposalId));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: 'host_scan',
    description:
      'Scan this host for security, compression and performance issues. Read-only; every finding carries a fix, and checks that could not run are reported rather than counted as passing.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const { hostAdvisorService } = await import('../services/hostAdvisor.service.js');
      const scan = await hostAdvisorService.scan();
      return ok({ host: scan.host, counts: scan.counts, findings: scan.findings, skippedCount: scan.skipped.length });
    },
  },
);

export function findTool(name: string): McpTool | undefined {
  return mcpTools.find((t) => t.name === name);
}
