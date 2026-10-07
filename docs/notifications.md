# Notifications

`GET {basePath}/notifications/stream` writes `text/event-stream`. Each item is an event named `notification`. A removal is `notification.removed`. The event id is the notification id. The browser sends it back as `Last-Event-ID`.

`subscribe` receives an `AbortSignal` that aborts when the socket closes. The default memory broker keeps the latest 100 items per subject.
