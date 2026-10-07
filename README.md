# @mockmarlin/saas-server

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Mock-Marlin/saas-server)](https://github.com/Mock-Marlin/saas-server)

Fastify plugin that mounts SaaS routes under the prefix your app already uses. The plugin calls ports you implement. It does not open a database.

Requires Node.js 24 or newer and Fastify 5.

## Install

```bash
npm install @mockmarlin/saas-server @mockmarlin/saas-contract fastify
```

## Minimal server

```ts
import Fastify from "fastify";
import { saasServer } from "@mockmarlin/saas-server";

const app = Fastify();
await app.register(saasServer, {
  basePath: "/api/v1",
  resolveSession: async (request) => {
    return request.headers["x-user"] === "ada" ? { id: "ada" } : null;
  },
  services: { billing: false, notifications: false, sessions: false, uploads: false, operations: false },
});
await app.listen({ port: 3000 });
```

`GET /api/v1/session` returns `{ "id": "ada" }`. A missing session returns the contract error envelope.

Pass a port object to turn a service on. Set `services.billing` to `false` to keep your own billing routes. A partial object only renames paths.

## What to read next

| Guide | What it covers |
|---|---|
| [docs/setup.md](docs/setup.md) | Register the plugin |
| [docs/configuration.md](docs/configuration.md) | Ports, path overrides, and the build header |
| [docs/api.md](docs/api.md) | Exports |
| [docs/billing.md](docs/billing.md) | Checkout, portal, and webhook adapters |
| [docs/notifications.md](docs/notifications.md) | The broker and the server-sent event stream |
| [docs/network.md](docs/network.md) | Request ids and idempotency keys |

## Contributing

Issues and pull requests: [github.com/Mock-Marlin/saas-server](https://github.com/Mock-Marlin/saas-server).

Use Node.js 24 or newer.

```bash
npm test
npm run lint
npm run build
```

`npm test` runs Vitest. `npm run lint` typechecks the source and the tests. `npm run build` emits `dist/` with declarations.

## License

[MIT](LICENSE) © 2026 MockMarlin
