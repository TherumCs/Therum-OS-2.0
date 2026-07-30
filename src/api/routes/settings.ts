import type { FastifyInstance } from 'fastify';
import {
  AppearanceInput,
  AdminDockInput,
  LoginBrandingInput,
  PerformanceInput,
  EditorDefaultsInput,
  UploadsInput,
  NotificationsInput,
  BackupSettingsInput,
  PaymentsSettingsInput,
  StealthSettingsInput,
  SecuritySettingsInput,
  MaintenanceSettingsInput,
  SeoDefaultsInput,
  ImportSettingsInput,
  OnboardingInput,
  SiteSettingsInput,
  CounterSettingsInput,
  CommerceSettingsInput,
} from '../../schemas/settings.schema.js';
import { applyBackupSchedule } from '../../lib/backupSchedule.js';
import { settingsService } from '../../services/settings.service.js';
import { authEventService } from '../../services/authEvent.service.js';
import { backupService } from '../../services/backup.service.js';
import { meService } from '../../services/me.service.js';
import { twoFactorService } from '../../services/twoFactor.service.js';
import { notificationService } from '../../services/notification.service.js';
import { requireBundle } from '../../middleware/bundle.js';

// Every mutating route in this file (PATCH domains, backup-run, the test
// notification, import) requires 'manage-settings' — the single bundle
// this entire route group maps to. GET routes stay ungated (see bundle.ts's
// own comment: read access isn't bundle-restricted per-route).
const requireSettingsWrite = requireBundle('manage-settings');

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // Site identity + Base Theme wiring (homepage assignment). Reads are
  // authenticated; the public frontend reads via settingsService directly.
  app.get('/settings/site', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getSite());
  });
  app.patch('/settings/site', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setSite(SiteSettingsInput.parse(req.body)));
  });

  app.get('/settings/appearance', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getAppearance());
  });

  // Public (no auth) — the login screen needs colorMode before a session
  // exists. Appearance has no sensitive fields, so exposing the read is safe.
  app.get('/settings/appearance/public', async (_req, reply) => {
    reply.send(await settingsService.getAppearance());
  });

  app.patch('/settings/appearance', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setAppearance(AppearanceInput.parse(req.body)));
  });

  // No dedicated settings-page UI yet (see settings.schema.ts's comment on
  // SeoDefaultsInput) — real read/write endpoints regardless, same as every
  // other settings domain, so there's something for a future form to call.
  app.get('/settings/seo-defaults', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getSeoDefaults());
  });

  app.patch('/settings/seo-defaults', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setSeoDefaults(SeoDefaultsInput.parse(req.body)));
  });

  app.get('/settings/admin-dock', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getAdminDock());
  });
  app.patch('/settings/admin-dock', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setAdminDock(AdminDockInput.parse(req.body)));
  });

  app.get('/settings/login-branding', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getLoginBranding());
  });
  // Public — the login screen itself needs its own branding before a session exists.
  app.get('/settings/login-branding/public', async (_req, reply) => {
    reply.send(await settingsService.getLoginBranding());
  });
  app.patch('/settings/login-branding', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setLoginBranding(LoginBrandingInput.parse(req.body)));
  });

  app.get('/settings/performance', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getPerformance());
  });
  app.patch('/settings/performance', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setPerformance(PerformanceInput.parse(req.body)));
  });

  // Commerce — the store's economics, as opposed to Counter's presentation.
  // Never had an HTTP surface at all, so currency and the margin floor were
  // both editable only by writing to the settings table directly.
  app.get('/settings/commerce', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getCommerce());
  });
  app.patch('/settings/commerce', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setCommerce(CommerceSettingsInput.parse(req.body)));
  });

  // Counter's storefront presentation. The GET is PUBLIC because the shop
  // pages are public and read it to render themselves — it holds layout
  // choices, no credentials and nothing about the merchant.
  app.get('/settings/counter', async (_req, reply) => {
    reply.send(await settingsService.getCounter());
  });
  app.patch('/settings/counter', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setCounter(CounterSettingsInput.parse(req.body)));
  });

  app.get('/settings/editor-defaults', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getEditorDefaults());
  });
  app.patch('/settings/editor-defaults', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setEditorDefaults(EditorDefaultsInput.parse(req.body)));
  });

  app.get('/settings/uploads', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getUploads());
  });

  // Counter — payment client config. Publishable keys and the Apple Pay
  // domain-association file: all values designed to be PUBLIC, so they live
  // here rather than in the Nexus vault (which holds only real secrets).
  // Stealth — what the stack tells strangers about itself.
  app.get('/settings/stealth', { preHandler: [app.authenticate] }, async (_req, reply) => {
    reply.send(await settingsService.getStealth());
  });

  app.patch('/settings/stealth', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setStealth(StealthSettingsInput.parse(req.body)));
  });

  // Security — real controls, plus the blast radius of turning them on.
  app.get('/settings/security', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const [security, readiness] = await Promise.all([
      settingsService.getSecurity(),
      twoFactorService.enforcementReadiness(),
    ]);
    reply.send({ ...security, readiness });
  });

  app.patch('/settings/security', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setSecurity(SecuritySettingsInput.parse(req.body)));
  });

  // Maintenance / coming soon — the public site's on-off switch.
  app.get('/settings/maintenance', { preHandler: [app.authenticate] }, async (_req, reply) => {
    reply.send(await settingsService.getMaintenance());
  });

  app.patch('/settings/maintenance', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setMaintenance(MaintenanceSettingsInput.parse(req.body)));
  });

  app.get('/settings/payments', { preHandler: [app.authenticate] }, async (_req, reply) => {
    reply.send(await settingsService.getPayments());
  });

  app.patch('/settings/payments', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setPayments(PaymentsSettingsInput.parse(req.body)));
  });
  app.patch('/settings/uploads', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setUploads(UploadsInput.parse(req.body)));
  });

  app.get('/settings/notifications', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getNotifications());
  });
  app.patch('/settings/notifications', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setNotifications(NotificationsInput.parse(req.body)));
  });

  app.get('/settings/backup', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getBackupSettings());
  });
  app.patch('/settings/backup', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    const saved = await settingsService.setBackupSettings(BackupSettingsInput.parse(req.body));
    // Re-arm immediately rather than at the worker's next boot: changing the
    // frequency and then seeing nothing happen for a day is indistinguishable
    // from the setting being broken (which, until this release, it was).
    await applyBackupSchedule().catch((err: unknown) => req.log.error({ err }, 'backup reschedule failed'));
    reply.send(saved);
  });

  // The post-setup wizard's own step/completed state — read on every
  // dashboard load (to decide whether to show the "finish setup" banner)
  // and on every /onboarding visit (to resume at the right step).
  app.get('/settings/onboarding', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getOnboarding());
  });
  app.patch('/settings/onboarding', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setOnboarding(OnboardingInput.parse(req.body)));
  });

  app.post('/settings/notifications/test', { preHandler: [app.authenticate, requireSettingsWrite] }, async (_req, reply) => {
    reply.send(await notificationService.sendTest());
  });

  app.get('/settings/activity', { preHandler: app.authenticate }, async (req, reply) => {
    // `scope` omitted means everything, so an existing caller (and the old
    // Activity page) keeps behaving exactly as before.
    const raw = (req.query as { scope?: string }).scope;
    const scope = raw === 'admin' || raw === 'customer' ? raw : undefined;
    const [events, total, adminTotal, customerTotal, failures] = await Promise.all([
      authEventService.recent(50, scope),
      authEventService.count(scope),
      authEventService.count('admin'),
      authEventService.count('customer'),
      authEventService.failureCounts(60),
    ]);
    reply.send({ events, total, counts: { admin: adminTotal, customer: customerTotal }, failures });
  });

  app.get('/settings/backup/files', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await backupService.list());
  });
  app.post('/settings/backup/run', { preHandler: [app.authenticate, requireSettingsWrite] }, async (_req, reply) => {
    try {
      const result = await backupService.runNow();
      // Fire-and-forget — a broken SMTP/Slack config must never turn a
      // successful backup into a failed request (see notification.service.ts).
      void notificationService.notifyBackupComplete(result.file, result.sizeBytes);
      reply.send(result);
    } catch (e) {
      reply.code(422).send({ error: { message: e instanceof Error ? e.message : 'Backup failed.' } });
    }
  });

  // Quick Controls' Advanced-tab export/import — site-wide Appearance (all
  // 36 fields, themes-shelf excluded — that group was never built) plus this
  // user's own Behavior fields. Import reuses AppearanceInput.parse()'s
  // default Zod "strip unknown keys" behavior as the allow-list for
  // Appearance; meService.importBehavior does the equivalent by hand for
  // Behavior since it isn't a Zod-schema boundary at that layer.
  app.get('/settings/export', { preHandler: app.authenticate }, async (req, reply) => {
    const [appearance, behavior] = await Promise.all([settingsService.getAppearance(), meService.exportBehavior(req.user.sub)]);
    reply.send({ appearance, behavior });
  });

  app.post('/settings/import', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    const input = ImportSettingsInput.parse(req.body);
    const result: { appearance?: unknown; behavior?: unknown } = {};
    if (input.appearance) result.appearance = await settingsService.setAppearance(AppearanceInput.parse(input.appearance));
    if (input.behavior) result.behavior = await meService.importBehavior(req.user.sub, input.behavior);
    reply.send(result);
  });
}
