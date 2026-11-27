# MAX client platform metadata

Authenticated conversation requests may identify the MAX client that originated them.

## Request headers

- `X-MAX-Client-Platform`: one of `web`, `desktop`, `android`, or `ios`.
- `X-MAX-Client-Version`: optional client version, maximum 32 characters.

The backend normalizes the platform against this allowlist. Missing headers default to `web` to preserve the existing MAX Webchat behaviour. Unsupported values are recorded as `unknown`.

## Processing

For both `POST /api/v1/conversations/:id/messages` and `POST /api/v1/conversations/:id/messages/stream`, the backend:

1. Adds client-reported platform information to the user message metadata.
2. Adds the platform context to the MAX orchestration system context.
3. Adds the same client platform metadata to the assistant response metadata.

The metadata is descriptive telemetry only. It is supplied by the client and MUST NOT be used for authentication, authorization, entitlement checks, or security decisions. The authenticated MAX Auth access token remains the source of user identity.

## Desktop request example

```http
POST /api/v1/conversations/{conversationId}/messages/stream
Authorization: Bearer <MAX_AUTH_ACCESS_TOKEN>
X-MAX-Client-Platform: desktop
X-MAX-Client-Version: 0.1.0
Accept: text/event-stream
Content-Type: application/json
```
