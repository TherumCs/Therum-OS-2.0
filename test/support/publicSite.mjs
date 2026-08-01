// Make the public site visible before a test asks it for a page.
//
// The maintenance gate runs before every public route, so an operator who left
// the site in coming-soon mode hands every storefront test the launch page
// instead of the page it asked for. The assertions then fail on content — "the
// member is shown their own price" — and read as a pricing bug, which is a
// long way from the truth.
//
// That is not hypothetical: it happened the day the coming-soon page was built.
// Fifteen tests across five files failed because a settings row on a dev
// machine said the shop was not open yet.
//
// Tests own their preconditions. This is one.
import { settingsService } from '../../dist/services/settings.service.js';

export async function ensureSiteVisible() {
  await settingsService.setMaintenance({ mode: 'off' }).catch(() => {});
}
