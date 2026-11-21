# Server setup runbook

This puts the real (live) dashboard on one always-on Ubuntu 24.04 server with automatic HTTPS. Commands marked "on the server" run over SSH; the rest run on your own computer.

What you need:

- One always-on machine: a VPS from any provider or a home machine. 1 vCPU, 1 GB RAM and about 10 GB of disk are plenty.
- A public IPv4 address, with ports 80 and 443 reachable from the internet (on a home network, forward them on the router).
- A hostname that points at it (step 1).

## 1. Domain

HTTPS needs a real hostname. Google OAuth also requires an https redirect URI on a public host (http is only accepted for localhost). Pick one:

- A domain you own: create an `A` record for a name such as `desk.example.com` pointing to the server's public IPv4 address.
- A free dynamic-DNS subdomain (for example from DuckDNS): create a subdomain and point it at the server's IPv4 address. If your home IP changes, set up the provider's update client.

Check that DNS has propagated before starting the stack: `dig +short desk.example.com` should print the server IP. Below, `<host>` means this hostname.

## 2. Server prep

Log in as root (or the provider's default user), then on the server:

```
adduser deploy
usermod -aG sudo deploy
```

Copy your SSH key to the new user. From your own computer (create a key first with `ssh-keygen -t ed25519` if you have none):

```
ssh-copy-id deploy@<server-ip>
```

Open a second terminal and confirm `ssh deploy@<server-ip>` works and `sudo -v` succeeds. Only then disable password logins, on the server:

```
sudo nano /etc/ssh/sshd_config.d/99-hardening.conf
```

with the contents:

```
PasswordAuthentication no
PermitRootLogin no
```

```
sudo systemctl restart ssh
```

Keep your existing session open and test a new login before closing it. Then the firewall and automatic security updates:

```
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo apt update && sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Note: Docker publishes container ports by editing iptables directly, which bypasses ufw. This setup is safe because the app port is bound to 127.0.0.1 only (see Security notes); do not add other published ports casually.

## 3. Install Docker Engine and the Compose plugin

Follow the official guide for Ubuntu, using the "apt repository" method: https://docs.docker.com/engine/install/ubuntu/ . It installs `docker-ce` and `docker-compose-plugin`. Then let your user run Docker (log out and back in afterwards):

```
sudo usermod -aG docker $USER
```

Verify: `docker --version` and `docker compose version`.

## 4. Get the code

On the server:

```
git clone https://github.com/tyadollaz/ai-desk-dashboard.git
cd ai-desk-dashboard
```

All later commands run from this repository root.

## 5. Create `.env`

```
cp .env.example .env
chmod 600 .env
nano .env
```

Set these production values:

```
NODE_ENV=production
APP_ORIGIN=https://<host>
DOMAIN=<host>
DATABASE_PATH=/data/dashboard.db
TRUST_PROXY=true
HOST=0.0.0.0
DEMO_MODE=false
```

`APP_ORIGIN` must be exactly the URL you type in the browser, with no trailing path.

Do not copy your laptop's `.env` wholesale over an insecure channel. If you reuse provider keys (LTA, Canvas, Google client, Garmin, Anthropic), copy those values one at a time, either by typing them in or with `scp` from your own computer, for example `scp some-file deploy@<server-ip>:` of a file holding a single value. Never paste them into chat, email or a public repo.

### Generate the secrets on the server

The image has no `npm` scripts, but it does have Node. Run these on the server and paste the output into `.env`:

```
openssl rand -base64 32   # use for SESSION_SECRET
openssl rand -base64 32   # use for TOKEN_ENCRYPTION_KEY
```

The server has its own `TOKEN_ENCRYPTION_KEY`, so tokens stored by your laptop copy cannot be read here. You must connect Google again on the server (step 7).

### Set the password hash

`scripts/hash-password.ts` is not in the runtime image, but `@node-rs/argon2` is. Build the image first, then hash inside it. The password is read with a hidden prompt and never appears in shell history:

```
docker compose -f deploy/docker-compose.yml --env-file .env build app
read -rs -p "Password: " PW; echo
printf '%s' "$PW" | docker compose -f deploy/docker-compose.yml --env-file .env run --rm --no-deps -T app node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',async()=>{
const {hash}=require('@node-rs/argon2');
console.log(await hash(s,{memoryCost:19456,timeCost:2,parallelism:1}));});"
unset PW
```

If `.env` still has the placeholder secrets the app is not started by this command (`run` only executes the hash), so that is fine. Copy the printed `$argon2id$...` line into `.env` wrapped in single quotes:

```
OWNER_PASSWORD_HASH='$argon2id$v=19$m=19456,t=2,p=1$....$....'
```

Single quotes matter because the hash contains `$`. Confirm `chmod 600 .env` is still in effect: `ls -l .env`.

Use a long, unique password. It is the only thing protecting the dashboard.

## 6. Google OAuth

In Google Cloud Console, open the existing OAuth client (Web application) and add this Authorized redirect URI:

```
https://<host>/api/google/callback
```

In `.env` set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and:

```
GOOGLE_REDIRECT_URI=https://<host>/api/google/callback
```

It must match the console entry exactly. Keeping the old localhost redirect URI registered as well is fine.

## 7. Start

```
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

`--env-file .env` is needed so Compose can read `DOMAIN` for Caddy; the app container reads the same file through `env_file`.

Check:

```
docker compose -f deploy/docker-compose.yml ps
curl -I https://<host>/api/health
```

Both services should be running (the app shows `healthy` after a short while) and curl should return `HTTP/2 200`. The first request may take several seconds while Caddy obtains the certificate.

Then in the browser: open `https://<host>`, log in, open Settings, add your bus stop (5 digits), pick the weather area, and click Connect Google Calendar.

## 8. Backups

`deploy/backup.sh [output-dir]` writes a consistent copy of the database to `backups/dashboard-<UTC timestamp>.db` (mode 600). Run it from the repository root. Try it once by hand:

```
deploy/backup.sh
ls -l backups
```

Nightly at 03:30, keeping 14 days. Edit the crontab with `crontab -e`:

```
30 3 * * * cd /home/deploy/ai-desk-dashboard && deploy/backup.sh >> backups/cron.log 2>&1 && find backups -name 'dashboard-*.db' -mtime +14 -delete
```

Adjust the path if your user or directory differs.

Copy backups off the server regularly (a backup on the same disk does not survive disk loss). For example, from your own computer:

```
rsync -av deploy@<server-ip>:ai-desk-dashboard/backups/ ~/desk-backups/
```

`TOKEN_ENCRYPTION_KEY` is not in the backup. Store it in a password manager, never next to the database backups. A restored database only works with the key it was written with; without it you can still log in but must connect Google again.

Restore (from the repository root):

```
deploy/restore.sh backups/dashboard-<timestamp>.db
docker compose -f deploy/docker-compose.yml logs app
```

This stops the app, replaces `/data/dashboard.db` in the volume and starts the app again. Make sure `.env` still holds the matching `TOKEN_ENCRYPTION_KEY`. Test a restore once before you need it.

## 9. Updates

```
cd ~/ai-desk-dashboard
git pull
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
docker image prune -f
```

Take a backup first if the update touches storage. Check `docker compose -f deploy/docker-compose.yml ps` afterwards.

## 10. Troubleshooting

- Login fails with 403: `APP_ORIGIN` does not exactly match the URL in the browser (scheme, host, no trailing slash). Fix `.env`, then `docker compose -f deploy/docker-compose.yml --env-file .env up -d` to recreate the app.
- Browser shows a certificate error or Caddy cannot get a certificate: DNS does not point at this server yet, or ports 80/443 are blocked (cloud firewall, router, `ufw status`). Read `docker compose -f deploy/docker-compose.yml logs caddy`. Let's Encrypt rate-limits repeated failures, so fix the cause before retrying many times.
- Google shows `redirect_uri_mismatch`: the URI in Google Cloud and `GOOGLE_REDIRECT_URI` differ, or one is still the localhost one. They must be identical, `https://<host>/api/google/callback`.
- Google needs reconnecting every week: this is Google's behaviour while the OAuth consent screen is in Testing status; see the README.
- The app container keeps exiting or restarting: run `docker compose -f deploy/docker-compose.yml logs app`. Config errors are explicit (missing `SESSION_SECRET`, bad `OWNER_PASSWORD_HASH`, `APP_ORIGIN` not https, and so on). A hash that lost its single quotes is the most common cause.
- `docker compose` warns that `DOMAIN` is not set: you left out `--env-file .env`.

## 11. Security notes

- The app port is published as `127.0.0.1:3000` only, so it is not reachable from the internet. Only Caddy (ports 80 and 443) is exposed.
- Keep `.env` at mode 600 and out of git. Never commit it or paste it anywhere.
- Keep the server patched (unattended-upgrades) and SSH key-only.
- A public demo must be a separate deployment with its own database and `DEMO_MODE=true`. Never reuse this one for it.
