# Billing

Pass `billing` to register snapshot, checkout, portal, cancel, resume, keep, sync, and the webhook.

The webhook route reads the raw body. When the path contains `:merchant`, that segment selects `adapters[merchant]`. When it does not, set `merchant` to the adapter key. `applyEvent` receives the normalized event. The vendor payload stays inside the adapter.

Checkout accepts `{ planId, currency? }` and forwards `idempotency-key`.
