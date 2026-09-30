# MAX Device, TV and Realtime Infrastructure

MAX TV is a client of the shared MAX AI Ecosystem backend. It does not have a separate account system, memory system, subscription system, or AI brain.

## Device lifecycle

1. Authenticate with MAX Auth.
2. Call `POST /api/v1/devices/register`.
3. Store the returned device/session identifiers securely on the device.
4. Send periodic heartbeats to `POST /api/v1/devices/:id/heartbeat`.
5. Use `GET /api/v1/devices` for account device management.
6. Revoke devices with `POST /api/v1/devices/:id/revoke`.

TV clients can use the dedicated convenience endpoints:

- `POST /api/v1/tv/device/register`
- `GET /api/v1/tv/device/config`
- `POST /api/v1/tv/device/:id/commands`

## Realtime events

MAX events are account-scoped and persisted in PostgreSQL.

Supported event types include:

- announcement
- broadcast
- security alert
- command
- media action
- notification
- automation event
- device/account/subscription changes

Clients can consume events through:

- `GET /api/v1/events`
- `GET /api/v1/events/stream`

The stream uses Server-Sent Events so TV clients can maintain a lightweight server-driven event channel. The event service is generic and can later be backed by a dedicated broker without changing client event semantics.

## MAX Home

Home-facing event endpoints:

- `POST /api/v1/home/events/announcements`
- `POST /api/v1/home/events/broadcasts`
- `POST /api/v1/home/events/security`

MAX Home remains the automation authority. MAX TV is an endpoint and presentation surface.

## Cross-device media

- `GET /api/v1/media/continue`
- `POST /api/v1/media/continue`
- `POST /api/v1/media/send`

Media state is account-scoped, allowing a phone, TV, web client, or future MAX device to continue the same content state.

## Screen Vision

`POST /api/v1/vision` accepts an explicitly supplied image and prompt. It does not continuously upload the TV screen.

The request is authenticated and limited to 10 MB per image. The configured MAX AI provider performs the visual interpretation.

## Profiles

`GET /api/v1/profiles` and the profile mutation endpoints provide account-linked profiles for shared devices. Profiles are not TV-only accounts.

## Security model

Every device is tied to the authenticated MAX account. Device commands validate ownership and revocation status server-side. Realtime events are isolated to the authenticated account.

Production deployments should also configure rate limiting and, when a persistent broker is introduced, use that broker for fan-out across multiple backend instances.
