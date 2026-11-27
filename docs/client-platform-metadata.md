# MAX client platform metadata

Authenticated conversation endpoints attach a `clientPlatform` object to user and assistant message metadata:

```json
{
  "platform": "desktop",
  "version": "0.1.0"
}
```

## Explicit request headers

- `X-MAX-Client-Platform: web | desktop | android | ios`
- `X-MAX-Client-Version: <short version string>`

The backend also accepts `mobile` for clients that cannot distinguish Android from iOS.

## Legacy client inference

Existing clients that do not send the platform header are classified from their User-Agent:

- Dart / `dart:io` clients are recorded as `mobile`.
- Browser User-Agents are recorded as `web`.
- Unrecognized clients are recorded as `unknown`.

This preserves the current mobile app without requiring a change to the production MAX Chat repository. New clients should always send the explicit platform header.

## Message coverage

Platform metadata is recorded on:
- user and assistant messages created by normal conversation endpoints;
- streamed conversation responses;
- messages created or updated by batch message recording.

The AI orchestration context also receives the platform label so MAX can understand which client surface is in use.

**Security:** platform metadata is client-reported telemetry. It must never be used as authentication, authorization, entitlement or identity proof.
