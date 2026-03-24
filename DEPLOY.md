# Secure Deployment of Cortex in Production

The safest pattern for your setup is:

* **nginx stays on ports 80/443**
* **your Next.js app runs as a normal user on `127.0.0.1:8001`**
* **PM2 also runs as that normal user, not root**

That is the normal production shape for a self-hosted Next app behind a reverse proxy. Next.js recommends putting a reverse proxy such as nginx in front of the app, and the `next start` CLI defaults to listening on `0.0.0.0`, so you should override that and bind it to `127.0.0.1` explicitly. PM2’s docs also say it’s a general rule not to run Node as root. ([Next.js][1])

One important warning first: **do these steps on a fresh rebuilt VPS, not on the compromised one.** On a compromised server, you cannot trust the existing files, startup scripts, or secrets.

## Step 1: create a dedicated app user

I’ll assume Ubuntu/Debian and call the user `cortex`.

```bash
sudo adduser --disabled-password --gecos "" cortex
```

You do **not** need to add this user to `sudo`.

## Step 2: put the app somewhere outside `/root`

A non-root user cannot safely run code from `/root`, and in your case you should deploy a **fresh copy from Git or a clean backup**, not reuse the old compromised files.

```bash
sudo mkdir -p /srv/cortex
sudo chown cortex:cortex /srv/cortex
sudo chmod 755 /srv/cortex
```

Then deploy your clean app code into `/srv/cortex`.

If you use Git:

```bash
sudo -iu cortex
cd /srv
git clone <your-repo-url> cortex
cd /srv/cortex
```

If you upload files manually, upload them into `/srv/cortex` and then:

```bash
sudo chown -R cortex:cortex /srv/cortex
```

You would need to do this if you scp with root user.

## Step 3: install dependencies as that user

Stay logged in as the `cortex` user:

```bash
sudo -iu cortex
cd /srv/cortex
node -v
npm -v
npm ci
npm run build
```

If `node` and `npm` are not available for that user, install Node for that user first, then come back to these commands.

## Step 4: store environment variables safely

Next.js supports `.env*` files and loads them into `process.env`, while PM2 also supports `env` and `env_production` blocks in its ecosystem file. ([Next.js][2])

For a simple setup, create a file readable only by `cortex`:

```bash
cd /srv/cortex/project-cortex
nano .env.production
chmod 600 .env.production
```

Put your real secrets there.

## Step 5: create a PM2 ecosystem file

Create `/srv/cortex/project-cortex/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: "cortex",
      cwd: "/srv/cortex/project-cortex",
      script: "node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 8001",
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "8001"
      }
    }
  ]
}
```

Why this matters:

* `next start` supports `--hostname` and `--port`
* its default hostname is `0.0.0.0`
* binding to `127.0.0.1` means only nginx on the same server can reach it, not the public internet ([Next.js][3])

## Step 6: start the app with PM2 as the non-root user

Still as `cortex`:

```bash
cd /srv/cortex
npx pm2 start ecosystem.config.js
npx pm2 status
```

If `pm2` is already installed for that user, you can use `pm2` instead of `npx pm2`.

PM2 keeps logs under the user’s home directory in `$HOME/.pm2/logs`. ([PM2][4])

To see logs:

```bash
npx pm2 logs cortex --lines 100
```

## Step 7: make PM2 start automatically at boot

PM2 can generate a startup script and restore saved apps after reboot with `pm2 startup` and `pm2 save`. The docs say to run `pm2 startup` first as the user, then copy and run the root command PM2 prints, and finally run `pm2 save`. PM2 also supports running the startup service for a specific user with `-u <user> --hp <home-path>`. ([PM2][5])

As `cortex`:

```bash
npx pm2 startup
```

PM2 will print a command that looks like this:

```bash
sudo su -c "env PATH=... pm2 startup systemd -u cortex --hp /home/cortex"
```

Copy and run the command PM2 prints.

Then, back as `cortex`:

```bash
npx pm2 save
```

You can later inspect the boot service with:

```bash
systemctl status pm2-cortex
journalctl -u pm2-cortex
```

That `pm2-<USER>` naming matches PM2’s docs. ([PM2][5])

## Step 8: point nginx to localhost only

Your nginx should proxy to the app on `127.0.0.1:8001`, not to `0.0.0.0:8001`. nginx’s proxy module supports this pattern directly. ([Nginx][6])

Example server block:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Step 9: verify that it is no longer running as root

Run:

```bash
ps -o user,pid,cmd -C node
ss -tulpn | grep 8001
curl -I http://127.0.0.1:8001
```

What you want to see:

* the process owner is `cortex`, not `root`
* the app is listening on `127.0.0.1:8001` only
* nginx still serves the public site

## Step 10: keep root out of PM2

On the new server, do **not** start PM2 with `sudo pm2 ...`.

Use:

```bash
sudo -iu cortex
pm2 status
pm2 restart cortex
pm2 logs cortex
```

Not:

```bash
sudo pm2 status
sudo pm2 restart cortex
```

Running `sudo pm2` creates a separate root-owned PM2 environment, which is exactly what you want to avoid.

Two final tips:

* Since nginx is handling 80/443, your app does **not** need root privileges to bind low ports. PM2’s docs mention `authbind` for low ports, but in your setup you should just keep the app on 8001 behind nginx. ([PM2][7])
* Do the same thing for your FastAPI app: separate unprivileged user, bind to `127.0.0.1`, reverse proxy through nginx.

Paste your current `package.json` `scripts` section and I’ll rewrite the exact `ecosystem.config.js` for your app.

[1]: https://nextjs.org/docs/app/guides/self-hosting?utm_source=chatgpt.com "Guides: Self-Hosting"
[2]: https://nextjs.org/docs/pages/guides/environment-variables?utm_source=chatgpt.com "Guides: Environment Variables"
[3]: https://nextjs.org/docs/pages/api-reference/cli/next?utm_source=chatgpt.com "next CLI"
[4]: https://pm2.keymetrics.io/docs/usage/log-management/ "PM2 - Logs"
[5]: https://pm2.keymetrics.io/docs/usage/startup/ "PM2 - Startup Script"
[6]: https://nginx.org/en/docs/http/ngx_http_proxy_module.html "Module ngx_http_proxy_module"
[7]: https://pm2.keymetrics.io/docs/usage/specifics/ "PM2 - Specifics"
