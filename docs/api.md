# API

| Export | What it does |
|---|---|
| `saasServer` | Fastify 5 plugin |
| `createMemoryBroker` | In-memory `NotificationBroker` |
| `PortError` | Status and code a port wants the client to see |
| `createDodoAdapter` | From `@mockmarlin/saas-server/billing/dodo`. Closes over the webhook secret |
| `createStripeAdapter` | From `@mockmarlin/saas-server/billing/stripe` |
| `createPaddleAdapter` | From `@mockmarlin/saas-server/billing/paddle` |

Each adapter also exports the matching `allow*Redirect` check.
