# Live box configuration (sidemoney.co) — exact copies, 2026-09-16

These are byte-for-byte copies of what is deployed on the VPS. `deploy/nginx.conf`
is the generic template; these are what actually runs.

| File | Lives at (box) |
|---|---|
| `sidemoney.nginx.conf` | `/etc/nginx/sites-enabled/sidemoney` — public vhost: storefront/API proxy to the Node cluster, `/tos-admin` to the Next admin, WooPayments/Jetpack paths carved out to the internal engine |
| `sm-engine-internal.nginx.conf` | `/etc/nginx/sites-enabled/sm-engine-internal` — headless WordPress on 127.0.0.1:8088 serving only the WooPayments engine (`/var/www/pay`) |
| `pay-mu-plugins/sm-appliance.php` | `/var/www/pay/wp-content/mu-plugins/sm-appliance.php` — the bridge that turns that WordPress into a payment appliance for Counter (intent create/confirm, no chrome). Source of truth for edits; also mirrored at `Local Sites/therum-os/woopay-build/` |

Not in git (binary / data): `/var/www/sidemoney-static` (42 MB of ported theme assets
incl. `/wp-content/uploads/2026/03/full-sig-black.png`, the email + popup logo),
`/home/therum/therum/uploads`, `.env` files, database. Backups cover those.

Changing any of these: edit here first, copy to the box, `sudo nginx -t && sudo systemctl reload nginx`.
