# OMP Desktop

An Electron and Web client for [Oh My Pi](https://github.com/can1357/oh-my-pi). It runs a private daemon on your machine and talks to `omp --mode rpc-ui` through OMP's native JSONL RPC protocol. Web clients can control a remote daemon through a self-hosted, end-to-end encrypted relay.

## Requirements

- Node.js from `.tool-versions`
- npm workspaces
- `omp >= 16.3.9` on `PATH`
- A configured OMP model provider

## Development

```bash
npm install
npm run dev:desktop
```

Development uses:

- daemon: `127.0.0.1:6770`
- renderer: an available Electron Metro port
- state: `.dev/omp-desktop-home`

The packaged app uses `~/.omp-desktop`. OMP keeps its own configuration, credentials, provider subscriptions, and sessions under `~/.omp`.

## Build

```bash
npm run build:desktop -- --dir
```

The macOS arm64 application is written to:

```text
packages/desktop/release/mac-arm64/OMP Desktop.app
```

## Self-hosted Web and relay

The default configuration enables the hosted Relay at `relay.paseo.sh:443` with TLS. Self-hosted deployments can replace that endpoint and do not otherwise depend on a hosted Paseo service.

### Build

```bash
npm install
npm run build:server
npm run build --workspace=@omp-desktop/cli
npm run build:web --workspace=@omp-desktop/app
```

The Web export is `packages/app/dist`. These commands build artifacts; they do not start the daemon.

### Cloudflare Pages

```bash
./deploy.sh
# or: npm run deploy:web
```

`deploy.sh` builds the Web export and runs `wrangler pages deploy` against project `omp-desktop` on branch `main`. Override with `CF_PAGES_PROJECT` / `CF_PAGES_BRANCH` if needed. SPA routes fall back through `packages/app/public/_redirects`. Pairing links should use the Pages origin as `app.baseUrl`.

Deploy the `paseo-relay` repository using its `deployment/self-hosted/compose.yaml`, `Caddyfile`, and `.env.example`. That deployment serves both your WSS relay and the Web export on your own domains, with automatic HTTPS and SPA route fallback. The relay machine does not need OMP or access to the daemon's private listening port.

### Configure the machine running OMP

Merge this configuration into `~/.omp-desktop/config.json`, retaining your other settings. Replace the example domains with those in the relay deployment:

```json
{
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:6770",
    "relay": {
      "enabled": true,
      "endpoint": "relay.example.com:443",
      "useTls": true
    }
  },
  "app": {
    "baseUrl": "https://omp.example.com"
  }
}
```

Start the backend, then obtain a pairing link in another terminal:

```bash
node packages/cli/bin/omp-desktop daemon start --foreground --no-web-ui
node packages/cli/bin/omp-desktop daemon pair --json
```

In the Web app, open **Settings → General → Relay server address**. It defaults to `wss://relay.paseo.sh:443`; replace it with `wss://relay.example.com` for a self-hosted deployment. Leave the setting empty only when the browser should use the relay address advertised by each pairing link. An already connected host can generate another link from **Settings → Host → Pair device**. Treat pairing links like passwords: anyone holding one can access that daemon. Legacy placeholder identities require re-pairing after upgrading.

The daemon initiates the outbound connection; do not expose port `6770` to the Internet. Keep `PASEO_APP_BASE_URL` / `app.baseUrl` pointed at your own Web deployment so generated links open the right client.

Environment overrides, useful when the daemon and browser reach different sides of a reverse proxy:

| Environment variable          | Config field                  | Purpose                                                         |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `PASEO_RELAY_ENABLED`         | `daemon.relay.enabled`        | Enable or disable Relay access                                  |
| `PASEO_RELAY_ENDPOINT`        | `daemon.relay.endpoint`       | Relay `host:port` dialed by the daemon                          |
| `PASEO_RELAY_USE_TLS`         | `daemon.relay.useTls`         | Outbound daemon TLS                                             |
| `PASEO_RELAY_PUBLIC_ENDPOINT` | `daemon.relay.publicEndpoint` | Browser-facing relay `host:port`; defaults to outbound endpoint |
| `PASEO_RELAY_PUBLIC_USE_TLS`  | `daemon.relay.publicUseTls`   | Browser-facing TLS; defaults to outbound TLS                    |
| `PASEO_APP_BASE_URL`          | `app.baseUrl`                 | Your Web origin in pairing links                                |

Use `true` / `false` for boolean overrides. Relay endpoints are authorities such as `relay.example.com:443`, without a scheme or `/ws` path. Public HTTPS Web deployments need WSS. Disabling TLS for a trusted local development relay does not disable E2EE.

The relay carries daemon WebSocket traffic, including workspace, agent, and terminal control. It does not tunnel arbitrary HTTP endpoints: file downloads and HTTP service previews still need their own reachable address.

## Workspace packages

- `packages/app` — Electron and Web renderer
- `packages/desktop` — Electron main process and packaging
- `packages/server` — local daemon and OMP adapter
- `packages/client` — daemon client
- `packages/protocol` — shared wire schemas
- `packages/relay` — shared E2EE relay transport
- `packages/cli` — `omp-desktop` CLI
- `packages/highlight` — code and diff highlighting

## Verification

```bash
npm run format
npm run lint
npm run typecheck
```

Run only targeted Vitest files; do not run the full test suite locally.

## License

AGPL-3.0-or-later. This project is derived from Paseo and retains its original Git history and license notices.
