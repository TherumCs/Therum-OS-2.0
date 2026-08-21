import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DashboardLayoutInput, SidebarLayoutInput, MediaViewInput, BehaviorInput, CustomCssInput } from '../../schemas/settings.schema.js';
import { meService } from '../../services/me.service.js';

const DesktopModeInput = z.object({ enabled: z.boolean() });

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.get(req.user.sub));
  });

  app.patch('/me/dashboard-layout', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.setDashboardLayout(req.user.sub, DashboardLayoutInput.parse(req.body)));
  });

  app.post('/me/dashboard-layout/reset', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.resetDashboardLayout(req.user.sub));
  });

  app.patch('/me/sidebar-layout', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.setSidebarLayout(req.user.sub, SidebarLayoutInput.parse(req.body)));
  });

  app.post('/me/sidebar-layout/reset', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.resetSidebarLayout(req.user.sub));
  });

  app.patch('/me/desktop-mode', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.setDesktopMode(req.user.sub, DesktopModeInput.parse(req.body).enabled));
  });

  app.patch('/me/media-view', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.setMediaView(req.user.sub, MediaViewInput.parse(req.body)));
  });

  app.patch('/me/behavior', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.setBehavior(req.user.sub, BehaviorInput.parse(req.body)));
  });

  app.patch('/me/custom-css', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await meService.setCustomCss(req.user.sub, CustomCssInput.parse(req.body).css));
  });
}
