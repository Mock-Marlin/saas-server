# Setup

Register `saasServer` on the same Fastify instance that owns cookies and your user lookup. `basePath` is required and must be the parent app's API prefix.

`resolveSession` returns the user or `null`. The plugin does not read a cookie itself.

Services other than the session echo stay off until you pass their port object. `services.session: false` skips the echo route too.
