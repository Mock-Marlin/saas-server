# Configuration

| Option | Role |
|---|---|
| `basePath` | Required URL prefix from the parent app |
| `resolveSession` | Returns the signed-in user or `null` |
| `serverBuild` | Value of `x-saas-server-build` on every response |
| `subjectId` | Notification broker key. Defaults to `user.id` |
| `services` | `false` skips a service. An object overrides relative paths |
| `billing` | Snapshot, checkout, portal, cancel, resume, keep, sync, webhook |
| `notifications` | Broker with `publish`, `subscribe`, `list`, `markSeen`, `remove` |
| `sessions` | List and revoke devices |
| `uploads` | Prepare a grant and complete it |
| `operations` | Start a job and load it |

`createMemoryBroker()` is an in-memory notification broker for one Node process. Replace it when you run more than one process.

Throw `PortError` from a port to choose the HTTP status. Any other throw becomes a 500 envelope.
