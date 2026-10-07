# Network

`onRequest` copies `x-request-id` onto the response, or generates one. `serverBuild` sets `x-saas-server-build`.

`idempotency-key` is read on checkout, portal, cancel, resume, keep, upload prepare, upload complete, and operation start. The plugin passes it to the port and does not store it.
