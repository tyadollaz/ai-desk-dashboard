# Hosting guide: VPS or Raspberry Pi

A decision guide and how-to for running this private, single-user dashboard on a small VPS or on a Raspberry Pi, for an owner in Singapore. The step-by-step VPS runbook is [SERVER-SETUP.md](SERVER-SETUP.md); this guide links to it rather than repeating it.

Prices below are "approximate, checked 21 Nov 2026 — confirm before buying". Anything marked UNVERIFIED has not been confirmed from an official source.

## How the app runs (read this first)

- The app is one Docker container (Node plus SQLite on a volume). It needs an always-on machine. Static or serverless hosts (GitHub Pages, Vercel) cannot run it.
- The same container runs on both options. CI builds and smoke-tests the image on amd64 (typical VPS) and arm64 (Raspberry Pi 4/5 with a 64-bit OS); see `.github/workflows/ci.yml`. For the latest result, see the Actions tab.
- One origin rule. The app accepts changes (login, refresh, settings) only from the exact URL in `APP_ORIGIN`, and the Google OAuth redirect URI must match that URL too. Every device (desk screen, phone, laptop) must therefore open the dashboard at the same URL. Plan the URL before you pick a host.
- In production `APP_ORIGIN` must be https, except `localhost`, `127.0.0.1` or `[::1]` over http. https also turns on Secure cookies.
- Google OAuth redirect URIs must be https on a public-suffix hostname, except `http://localhost` (Google docs, see Sources).

## 1. Quick decision

| | VPS | Raspberry Pi |
|---|---|---|
| Cost | about US$6-9 per month, optional domain about US$10/yr | about US$200-215 once, about S$22/yr power |
| Reachable from anywhere | Yes, public https URL | Only with a tunnel (Tailscale, Cloudflare) |
| Desk display | Needs a separate device showing the URL | Built in (kiosk browser on the Pi) |
| Setup effort | Moderate, one runbook | Higher: OS, Docker, tunnel, kiosk |
| Uptime and power | Provider datacentre | Your home power and Wi-Fi |
| Maintenance | OS updates, Docker updates | Same, plus SD card or SSD health |
| Data location | Provider's Singapore datacentre | Your home |

Rules of thumb:

- Choose a VPS if you want it reachable everywhere now with the least fuss.
- Choose a Pi if the desk display is the main use and you are fine with Tailscale on your phone.
- Both: start on a VPS, migrate to a Pi later (about 1 hour, section 4).

## 2. Option A: VPS

Requirements: 1 vCPU, 1 GB RAM, about 10-25 GB disk, a public IPv4 address, and a Singapore region. The upstream APIs (LTA, data.gov.sg) are in Singapore; a Europe or US server adds roughly 150-250 ms per hop (an estimate).

Providers (approximate monthly USD, checked 21 Nov 2026 — confirm before buying):

| Provider and plan | Spec | Price | Notes |
|---|---|---|---|
| DigitalOcean, SGP1 | 1 GiB / 1 vCPU / 25 GiB, 1,000 GiB transfer | $6/mo, IPv4 included | Backups +20% (weekly) or +30% (daily); snapshots $0.06/GB. Good default. |
| AWS Lightsail, Singapore | 1 GB / 2 vCPU / 40 GB, 2 TB | $7 with IPv4 | $5 plan is IPv6-only: avoid. Snapshots $0.05/GB. Singapore availability on the plan page not explicitly confirmed (UNVERIFIED). |
| Hetzner Cloud, Singapore (SIN, since Aug 2024) | CPX02, 1 vCPU / 1 GB / 20 GB | EUR 7.99/mo excl. VAT (about US$9) | Only 0.5 TB traffic in SIN, x86 only. Backups from about EUR 1.10/mo. |
| Vultr, Akamai Linode | 1 GB plans | about $5-6/mo | Singapore pricing not confirmed from official pages (UNVERIFIED). |

Free tiers, not recommended:

- Oracle Always Free: a Singapore region exists but must be your home region. ARM A1 instances are reclaimed if idle (CPU, network and memory under 20% over 7 days), which a tiny dashboard would hit. Capacity errors are common.
- Google Cloud free e2-micro: US regions only, so high latency.

Domain: needed for https.

- A cheap .com, about US$10.44/yr at Cloudflare Registrar at cost (confirm the live price). A .sg domain needs Singapore presence and SingPass verification.
- A free DuckDNS subdomain works with Caddy, but it is donation-run with no SLA or status page, and breakages are occasionally reported.

Then follow [SERVER-SETUP.md](SERVER-SETUP.md) from step 1. Your `APP_ORIGIN` is `https://<host>`.

## 3. Option B: Raspberry Pi desk display

### Parts

Approximate USD list prices; reseller markup, shipping and GST are extra.

| Part | Price | Notes |
|---|---|---|
| Raspberry Pi 5, 4 GB | about $110 (UNVERIFIED) | Prices rose repeatedly in 2026 due to memory costs. The 2 GB model is $77.50 official since 1 Oct 2026: workable but tight with a Chromium kiosk plus Docker. 8 GB and up is unnecessary. |
| Official 27 W USB-C power supply (5.1 V / 5 A) | about $12 | Required; weaker supplies cause problems. |
| Active Cooler, or official case with fan | about $5 / about $10 | |
| Storage | about $10-15 | High-endurance A2 microSD, 32-64 GB. Or M.2 HAT+ (about $12) plus a small NVMe SSD for better write endurance. |
| Display | see below | Raspberry Pi Touch Display 2, or any HDMI monitor. |

Touch Display 2 options: 5" $40, 7" $60 (both 720x1280 portrait panels, which become 1280x720 when rotated to landscape), 10" $80 (1200x1920, becomes 1920x1200, Pi 5 only).

Total is about $200-215 with the 7" display.

Layout note: the dashboard is browser-tested at 1440x900, 1024x600 and 390x844. 1280x720 sits between these and should work, but it has not been tested yet.

Where to buy: use the country filter on https://www.raspberrypi.com/resellers/. RS Components SG and element14 SG sell Pi; confirm they are listed as approved resellers.

Power cost: a Pi 5 idles at about 3-4 W and the display uses about 2-4 W (estimates). That is about 70 kWh/yr, roughly S$22/yr at the Q4 2026 SP tariff (about S$0.31/kWh including GST).

### Remote access options

| Option | What it does | Trade-offs |
|---|---|---|
| (a) Tailscale Serve (recommended) | Free Personal plan. HTTPS at `https://<pi-name>.<tailnet>.ts.net` inside your private tailnet. | No open ports. The phone needs the Tailscale app. |
| (b) Tailscale Funnel | Same hostname, public to the internet. | Ports 443, 8443 and 10000 only; bandwidth limits. The app's own login is then the only protection. |
| (c) Cloudflare Tunnel | Free. Works from any device without an app. | Needs a domain on Cloudflare DNS. Optionally put Cloudflare Access in front. Quick tunnels are for testing only. |
| (d) Port-forward 80/443 plus DuckDNS plus Caddy | Same setup as the VPS runbook, on your home connection. | Exposes your home IP. Often impossible behind CGNAT; MyRepublic and ViewQwest reportedly use CGNAT by default (anecdotal). Check by comparing your router's WAN IP with a "what is my IP" site. |
| (e) LAN or kiosk only, `APP_ORIGIN=http://localhost:3000` | Simplest. Google connects from the Pi's own browser. | The phone cannot use it. |

UNVERIFIED: whether Google accepts `*.ts.net` redirect URIs. `ts.net` is expected to be on the Public Suffix List, but test it before relying on it. If Google rejects it, fall back to option (c) with a domain.

### Setup, Tailscale Serve route

1. Flash Raspberry Pi OS (64-bit) with Raspberry Pi Imager. Set the hostname, user, SSH key and Wi-Fi in the Imager settings.
2. Update: `sudo apt update && sudo apt full-upgrade -y`, then reboot.
3. Install Docker Engine using the official Debian instructions: https://docs.docker.com/engine/install/debian/ . Docker's Raspberry Pi OS page covers 32-bit only (Engine v28 was the last release to support 32-bit), so do not use it. Then add yourself to the docker group, log out and back in, and verify (same commands as SERVER-SETUP.md step 3):
   ```
   sudo usermod -aG docker $USER
   docker --version
   docker compose version
   ```
4. Install Tailscale with the official script from https://tailscale.com/download/linux , then:
   ```
   sudo tailscale up
   ```
5. In the Tailscale admin console, enable MagicDNS and HTTPS certificates.
6. Get the code (same as SERVER-SETUP.md step 4):
   ```
   git clone https://github.com/tyadollaz/ai-desk-dashboard.git
   cd ai-desk-dashboard
   ```
7. Create `.env` as in SERVER-SETUP.md step 5 (`cp .env.example .env`, `chmod 600 .env`, generate secrets with `openssl rand -base64 32`, set the password hash with the same `docker compose ... run --rm --no-deps -T app node -e ...` command). Use these values:
   ```
   NODE_ENV=production
   APP_ORIGIN=https://<pi-name>.<tailnet>.ts.net
   GOOGLE_REDIRECT_URI=https://<pi-name>.<tailnet>.ts.net/api/google/callback
   TRUST_PROXY=true
   DATABASE_PATH=/data/dashboard.db
   HOST=0.0.0.0
   DEMO_MODE=false
   DOMAIN=<pi-name>.<tailnet>.ts.net
   ```
   Caddy is not needed because Tailscale terminates https, so `DOMAIN` is not used by anything that runs. Set it anyway: the compose file declares `DOMAIN: ${DOMAIN:?set DOMAIN in .env}` on the `caddy` service, and Compose resolves that when it reads the file, which would normally happen even if you only start `app` (not run to confirm; see report). The ts.net name is a harmless value.
8. Start only the app service:
   ```
   docker compose -f deploy/docker-compose.yml --env-file .env up -d --build app
   ```
   The first build on a Pi takes several minutes. Check with `docker compose -f deploy/docker-compose.yml ps` and `curl -I http://127.0.0.1:3000/api/health`.
9. Publish it on your tailnet over https:
   ```
   sudo tailscale serve --bg 3000
   tailscale serve status
   ```
   This should map `https://<pi-name>.<tailnet>.ts.net` to `127.0.0.1:3000`. The `--bg 3000` form is from memory of the current CLI and was not checked against the docs (UNVERIFIED); check https://tailscale.com/kb/1242/tailscale-serve if it errors.
10. Add `https://<pi-name>.<tailnet>.ts.net/api/google/callback` as an Authorized redirect URI in Google Cloud (SERVER-SETUP.md step 6).
11. On your phone, install Tailscale, sign in to the same tailnet, and open the same URL. Log in, add your bus stop, pick the weather area and connect Google Calendar.

Backups, updates and troubleshooting work as in SERVER-SETUP.md steps 8-10. Run the same `deploy/backup.sh` and `deploy/restore.sh` commands from the repository root. Note that the update command in step 9 of that runbook starts every service; on the Pi add `app` at the end, as in step 8 above.

### Kiosk

Community guides, not official; check on a fresh install.

1. Enable desktop autologin with `sudo raspi-config` (System Options, then Boot / Auto Login, then Desktop Autologin).
2. Add this line to `~/.config/labwc/autostart` (create the file if needed):
   ```
   chromium --kiosk --ozone-platform=wayland --noerrdialogs --disable-session-crashed-bubble https://<pi-name>.<tailnet>.ts.net
   ```
   The current OS binary is `chromium`.
3. The kiosk must use the same ts.net URL (one-origin rule). This works because the Pi itself is on the tailnet.

Screen schedule, per Raspberry Pi docs: switch the display off and on from cron with
`WAYLAND_DISPLAY=wayland-1 wlr-randr --output <name> --off` and `--on`. Run `wlr-randr` to see the output name; a DSI display's name differs from `HDMI-A-1`. Screen blanking is set in `raspi-config`.

### Reliability

- Use a high-endurance card or NVMe.
- Run `deploy/backup.sh` nightly (cron line in SERVER-SETUP.md step 8) and copy the files off the Pi.
- Keep `TOKEN_ENCRYPTION_KEY` in a password manager, not next to the backups.
- A small UPS is optional; the Singapore grid is very reliable.
- SQLite already runs in WAL mode.

## 4. Migrating VPS to Pi later

1. On the VPS, from the repository root: `deploy/backup.sh`.
2. Copy the backup file to the Pi, for example `scp deploy@<vps-ip>:ai-desk-dashboard/backups/dashboard-<timestamp>.db .` from your own computer, then to the Pi. Also copy the same `TOKEN_ENCRYPTION_KEY` from your password manager. Without it you can still log in but must reconnect Google.
3. On the Pi, set up as in section 3 steps 1-7, putting the same `TOKEN_ENCRYPTION_KEY` in `.env`.
4. Build the app so the volume exists, then restore: `docker compose -f deploy/docker-compose.yml --env-file .env up -d --build app`, then `deploy/restore.sh backups/dashboard-<timestamp>.db`.
5. Set the new `APP_ORIGIN` and `GOOGLE_REDIRECT_URI` in `.env`, and add the new redirect URI in Google Cloud. Recreate the app with the `up -d app` command above.
6. Run `sudo tailscale serve --bg 3000`, open the new URL, log in and check the calendar.
7. Once it works, shut down the VPS and delete its disk and snapshots.

Going the other way (Pi to VPS) is the same steps in reverse.

## 5. Cost summary

| Option | Cost |
|---|---|
| VPS | about US$6-9/mo, plus optional domain about US$10/yr |
| Raspberry Pi | about US$200-215 once, plus about S$22/yr power |
| Free tiers | not recommended |

## Sources

- https://www.digitalocean.com/pricing/droplets
- https://aws.amazon.com/lightsail/pricing/
- https://www.hetzner.com/cloud/regular-performance
- https://docs.hetzner.com/cloud/general/locations/
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://docs.cloud.google.com/free/docs/free-cloud-features
- https://www.cloudflare.com/products/registrar/
- https://www.duckdns.org/faqs.jsp
- https://www.raspberrypi.com/products/raspberry-pi-5/
- https://www.raspberrypi.com/news/price-increases-for-2gb-raspberry-pi-4-and-raspberry-pi-5/
- https://www.raspberrypi.com/products/27w-power-supply/
- https://www.raspberrypi.com/products/m2-hat-plus/
- https://www.raspberrypi.com/products/touch-display-2/
- https://www.raspberrypi.com/resellers/
- https://docs.docker.com/engine/install/raspberry-pi-os/
- https://www.raspberrypi.com/documentation/computers/configuration.html
- https://tailscale.com/kb/1242/tailscale-serve
- https://tailscale.com/kb/1223/funnel
- https://tailscale.com/pricing
- https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://www.spgroup.com.sg/our-services/utilities/tariff-information
