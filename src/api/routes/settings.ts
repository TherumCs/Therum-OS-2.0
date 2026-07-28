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
  SeoDefaultsInput,
  ImportSettingsInput,
  OnboardingInput,
  SiteSettingsInput,
} from '../../schemas/settings.schema.js';
import { applyBackupSchedule } from '../../lib/backupSchedule.js';
import { settingsService } from '../../services/settings.service.js';
import { authEventService } from '../../services/authEvent.service.js';
import { backupService } from '../../services/backup.service.js';
import { meService } from '../../services/me.service.js';
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

  app.get('/settings/editor-defaults', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getEditorDefaults());
  });
  app.patch('/settings/editor-defaults', { preHandler: [app.authenticate, requireSettingsWrite] }, async (req, reply) => {
    reply.send(await settingsService.setEditorDefaults(EditorDefaultsInput.parse(req.body)));
  });

  app.get('/settings/uploads', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await settingsService.getUploads());
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

  app.get('/settings/activity', { preHandler: app.authenticate }, async (_req, reply) => {
    const [events, total] = await Promise.all([authEventService.recent(50), authEventService.count()]);
    reply.send({ events, total });
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
