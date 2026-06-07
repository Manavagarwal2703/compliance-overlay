# Gateway Service

Next.js 16 API orchestration layer: **multi-tenant session tracking**, **PostgreSQL persistence via Prisma 7**, and **zero-copy SSE stream proxying** between the widget client and the AI microservice. It imports nothing from the widget or AI service modules — only the shared HTTP contracts define the coupling surface.

---

## Role in the System

```mermaid
sequenceDiagram
  participant W as widget-client
  participant G as gateway-service
  participant DB as PostgreSQL
  participant A as ai-service

  W->>G: POST /api/chat (Contract A)
  G->>DB: prisma.session.upsert()
  G->>DB: prisma.message.create() [role: user]
  G->>A: POST /v1/chat/stream (Contract B)
  loop SSE passthrough
    A-->>G: Contract C chunk (raw bytes)
    G-->>W: same bytes (TransformStream)
  end
  G->>DB: prisma.message.create() [role: assistant, full text]
```

The gateway uses a `TransformStream` to forward raw SSE bytes to the widget **immediately** (zero buffering). In parallel, it accumulates the token payloads in memory. When the upstream stream ends, the `TransformStream.flush()` method persists the fully assembled assistant reply as a single `Message` row in Postgres.

---

## Tech Stack

| Package | Version |
|---------|---------|
| Next.js | 16.1.4 |
| React | 19.0.0 |
| TypeScript | 5.7+ |
| Prisma | 7.x |
| PostgreSQL | 16 |
| Runtime | Node.js (standard App Router — no Edge runtime) |

---

## Prerequisites

- Node.js 20+
- Docker Desktop (for local PostgreSQL)
- `ai-service` running on port **8000**

---

## Local PostgreSQL Setup (Docker)

Spin up PostgreSQL 16 in a Docker container with a single command:

```powershell
docker run --name gateway-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=gateway_db `
  -p 5432:5432 `
  -d postgres:16-alpine
```

Verify it is running:

```powershell
docker ps --filter name=gateway-postgres
```

Stop and remove the container when done:

```powershell
docker stop gateway-postgres
docker rm gateway-postgres
```

---

## Environment Variables

Create a `.env.local` file in the `gateway-service` directory:

```env
# PostgreSQL connection string (matches the Docker command above)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gateway_db"

# AI microservice endpoint (Contract B)
AI_SERVICE_URL="http://localhost:8000/v1/chat/stream"
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | **Required.** Full PostgreSQL connection string. Read by `prisma.config.ts`. |
| `AI_SERVICE_URL` | `http://localhost:8000/v1/chat/stream` | Contract B endpoint forwarded to the AI service. |
| `ENABLE_AI_MEMORY` | `true` | When `true`, fetches the last 5 conversation turns from Postgres and injects them into the Contract B `context_history` array. When `false`, always sends `context_history: []`. Does **not** affect the history API endpoints. |
| `REQUIRE_AUTH` | `true` | When `true`, every `POST /api/chat` must include a valid `Authorization: Bearer <JWT>` header. When `false`, skips JWT verification and trusts the `userId` in the JSON body (dev / bypass mode). |
| `JWT_SECRET` | — | **Required when `REQUIRE_AUTH=true`.** HS256 HMAC signing secret (32+ chars). Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`  |
| `ALLOWED_ORIGINS` | `""` (wildcard `*`) | Comma-separated list of origins permitted for CORS. When empty, falls back to `*` (dev only). Example: `"http://localhost:5173,https://client.example.com"`. |

> **Prisma 7 note:** Unlike Prisma 6 and earlier, the connection URL is configured in `prisma.config.ts` (not in `schema.prisma`). Next.js reads `.env.local` automatically, so `DATABASE_URL` is available to both the Next.js routes and the Prisma config at runtime.

---

## Authentication — `REQUIRE_AUTH`

The gateway implements an **optional JWT authentication layer** on `POST /api/chat`. The behaviour is controlled by the `REQUIRE_AUTH` environment variable.

### Modes

| `REQUIRE_AUTH` | Behaviour | When to use |
|---|---|---|
| `true` _(default)_ | `Authorization: Bearer <JWT>` header is **required** on every request. `userId` is extracted from the verified token — the body-supplied value is ignored. | All production environments |
| `false` | No token required. `userId` in the JSON body is trusted directly. | Local dev, `curl` smoke tests, integration testing |

> [!CAUTION]
> **Never** set `REQUIRE_AUTH=false` in production. Without JWT verification, any caller can impersonate any user by sending an arbitrary `userId` in the request body.

### How JWT verification works

The utility in `src/lib/auth.ts` uses Node.js's built-in `crypto` module — no third-party JWT package required.

- **Algorithm:** HS256 (HMAC-SHA256)
- **Secret:** read from `JWT_SECRET` env var
- **Claims checked:** `exp` (expiry, if present), `userId` or `sub` (user identity)
- **Timing-safe comparison:** uses `crypto.timingSafeEqual` to prevent timing attacks

### Bypassing auth for local testing (REQUIRE_AUTH=false)

Set these two variables in `gateway-service/.env` to enable bypass mode:

```env
REQUIRE_AUTH=false
# JWT_SECRET is not needed in bypass mode
```

Then test with `curl` without a token:

```powershell
curl -X POST http://localhost:3000/api/chat `
  -H "Content-Type: application/json" `
  -H "Accept: text/event-stream" `
  -N `
  -d '{"sessionId":"sess_smoke","userId":"usr_test","role":"reviewer","message":"Hello"}'
```

### Enabling auth for production (REQUIRE_AUTH=true)

1. Generate a secret:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Add to `gateway-service/.env`:
   ```env
   REQUIRE_AUTH=true
   JWT_SECRET="<your-generated-secret>"
   ```
3. Mint tokens in your auth provider using the same secret and HS256 algorithm. Include `userId` (or `sub`) as a claim.
4. Pass the token to the widget via the `auth-token` HTML attribute (see [widget-client/README.md](../widget-client/README.md)).

### Testing with a real token (curl)

```powershell
# Replace <TOKEN> with a valid HS256 JWT signed with JWT_SECRET
curl -X POST http://localhost:3000/api/chat `
  -H "Content-Type: application/json" `
  -H "Accept: text/event-stream" `
  -H "Authorization: Bearer <TOKEN>" `
  -N `
  -d '{"sessionId":"sess_smoke","role":"reviewer","message":"Hello"}'
```

> Note: in `REQUIRE_AUTH=true` mode you do **not** need to include `userId` in the body — it is extracted from the verified JWT.

### Auth step names in structured logs

| `step` | Triggered by |
|--------|--------------|
| `auth_verify` | JWT signature check failure or missing `userId`/`sub` claim (logged as `warn`) |

---

## CORS — `ALLOWED_ORIGINS`

The gateway dynamically computes the `Access-Control-Allow-Origin` response header based on the `ALLOWED_ORIGINS` environment variable.

| `ALLOWED_ORIGINS` value | CORS behaviour |
|---|---|
| Empty / unset | Wildcard `*` — all origins permitted (dev only) |
| `"http://localhost:5173"` | Only that origin is echoed back |
| `"http://localhost:5173,https://app.example.com"` | Either matching origin is echoed; non-matching origins get `"null"` |

When a specific (non-wildcard) origin is set, the gateway also returns `Access-Control-Allow-Credentials: true`, enabling browsers to send cookies alongside the `Authorization` header.

> [!WARNING]
> Leaving `ALLOWED_ORIGINS` empty (wildcard `*`) in production means any web page can call this API from a browser. Always set explicit origins in production.

---

## AI Memory — `ENABLE_AI_MEMORY`

The gateway implements an **opt-in memory layer** that injects prior conversation turns into the Contract B payload so the AI service can maintain context across messages.

### How it works

| `ENABLE_AI_MEMORY` | `context_history` in Contract B | History API (`GET /api/chat/history`) |
|---|---|---|
| `true` | Last 5 turns fetched from Postgres (≤10 messages) | **Always works** — reads directly from DB |
| `false` | Always `[]` — AI has no memory of prior turns | **Always works** — reads directly from DB |

> [!IMPORTANT]
> `ENABLE_AI_MEMORY` controls **only** the Contract B payload forwarded to the AI service.
> It has zero effect on the `GET /api/chat/history` and `GET /api/chat/history/:sessionId`
> endpoints. Those endpoints always query Postgres, so the UI sidebar continues to display
> all past sessions and messages regardless of this flag.

### Memory window

- **5 turns** = up to 10 messages (alternating user/assistant) are included.
- The current user message is sent as the `query` field and is **excluded** from
  `context_history` to avoid duplication.
- If the Prisma query for history fails, the gateway logs a `warn` and falls back
  to `context_history: []` — the request still proceeds normally.

### Example Contract B payload with memory enabled

```json
{
  "conversation_id": "sess_1748956800_abc123",
  "role": "reviewer",
  "query": "What did I ask about earlier?",
  "context_history": [
    { "role": "user",      "content": "Check Q2 compliance status." },
    { "role": "assistant", "content": "The Q2 status is fully compliant." },
    { "role": "user",      "content": "Which controls were reviewed?" },
    { "role": "assistant", "content": "Controls CC1–CC5 were reviewed." }
  ]
}
```

### Example Contract B payload with memory disabled

```json
{
  "conversation_id": "sess_1748956800_abc123",
  "role": "reviewer",
  "query": "What did I ask about earlier?",
  "context_history": []
}
```

---

## Prisma Setup

Run these commands **once** after cloning, and again whenever `prisma/schema.prisma` changes:

```powershell
# 1. Install Node.js dependencies (includes @prisma/client and prisma devDependency)
npm install

# 2. Generate the TypeScript Prisma Client from the schema
npx prisma generate

# 3. Push the schema to the database (creates/syncs tables without migration files)
npx prisma db push
```

| Command | When to run |
|---------|-------------|
| `npx prisma format` | Optional — formats `schema.prisma` consistently |
| `npx prisma generate` | After any change to `schema.prisma`, and on first install |
| `npx prisma db push` | After `generate`, to apply schema to the live database |
| `npx prisma migrate deploy` | Production — applies committed migration files |
| `npx prisma studio` | Opens the Prisma web GUI for your database |

---

## Install and Start

```powershell
cd gateway-service
npm install
npx prisma generate
npx prisma db push
npm run dev
```

API base URL: [http://localhost:3000](http://localhost:3000)

### Production Build

```powershell
npm run build
npm start
```

---

## API Reference

### `OPTIONS /api/chat`

CORS preflight handler. Responds `204 No Content`.

The `Access-Control-Allow-Origin` header is set to the requesting origin only if it appears in `ALLOWED_ORIGINS`. When `ALLOWED_ORIGINS` is empty, the wildcard `*` is used (dev only).

---

### `POST /api/chat`

The main stream proxy. Persists the user message, proxies the request to the AI service, pipes the SSE response back to the client, then persists the assembled assistant reply.

**Contract A request body:**

```json
{
  "sessionId": "sess_1748956800_abc123",
  "userId": "usr_abc123",
  "role": "reviewer",
  "message": "Check Q2 compliance status."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | **Yes** | Client-generated session identifier |
| `userId` | `string` | **Yes** | User identifier from the `user-id` HTML attribute |
| `role` | `"user"` \| `"reviewer"` | **Yes** | Active persona; forwarded to the AI service |
| `message` | `string` | **Yes** | The user's message text |

**Handler behaviour (in order):**

1. Validates all four required fields; returns `400` on failure.
2. `prisma.session.upsert({ where: { id: sessionId }, create: { id, userId, role, title }, update: { updatedAt } })` — creates the session on the first message, touches `updatedAt` on subsequent ones. Session `title` is derived as `message.slice(0, 30) + "..."`.
3. `prisma.message.create({ data: { id, sessionId, role: "user", content: message } })` — persists the incoming user message.
4. `fetch(AI_SERVICE_URL, { method: "POST", body: Contract B JSON })` — calls the AI service.
5. Creates a `TransformStream` and starts `pump()` (a fire-and-forget async function) that pipes raw bytes from the AI response to the client in real time.
6. Returns `new Response(readable, { headers: { "Content-Type": "text/event-stream", ... } })` immediately — the client starts receiving SSE tokens.
7. When the upstream reader signals `done`, `pump()` closes the writer, which triggers `TransformStream.flush()`.
8. Inside `flush()`: `prisma.message.create({ data: { role: "assistant", content: assembledText } })` — saves the full reply. Errors here are caught and logged non-fatally (the stream was already delivered).

**Response:** `200 OK` with `Content-Type: text/event-stream` (Contract C passthrough).

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
Access-Control-Allow-Origin: <origin>   ← echoes the request origin if in ALLOWED_ORIGINS, else "*" in dev
```

**Error responses:**

| Status | Cause |
|--------|-------|
| `400` | Missing or malformed JSON body |
| `401` | Missing `Authorization` header, or JWT verification failed (only when `REQUIRE_AUTH=true`) |
| `500` | Database error during session upsert or user message creation |
| `502` | AI service unreachable or returned a non-`2xx` response |

---

### `GET /api/chat/history?userId=<userId>`

Returns all `Session` records for the given user, ordered by most recently updated first.

**Request:**

```
GET /api/chat/history?userId=usr_abc123
```

**Response — `200 OK`:**

```json
{
  "sessions": [
    {
      "id": "sess_1748956800_abc123",
      "userId": "usr_abc123",
      "role": "reviewer",
      "title": "Check Q2 compliance stat...",
      "createdAt": "2026-06-03T10:30:00.000Z",
      "updatedAt": "2026-06-03T10:35:00.000Z"
    }
  ]
}
```

| Response field | Type | Description |
|---------------|------|-------------|
| `sessions` | `Session[]` | All sessions for the user, newest first |
| `sessions[].id` | `string` | Session identifier |
| `sessions[].userId` | `string` | The user who owns this session |
| `sessions[].role` | `string` | `"user"` or `"reviewer"` |
| `sessions[].title` | `string` | Auto-generated from the first message |
| `sessions[].createdAt` | ISO 8601 | Creation timestamp |
| `sessions[].updatedAt` | ISO 8601 | Last activity timestamp |

**Error responses:**

| Status | Cause |
|--------|-------|
| `400` | Missing or empty `userId` query parameter |
| `500` | Database error |

---

### `GET /api/chat/history/:sessionId`

Returns all `Message` records for a given session, ordered chronologically (oldest first).

**Request:**

```
GET /api/chat/history/sess_1748956800_abc123
```

**Response — `200 OK`:**

```json
{
  "sessionId": "sess_1748956800_abc123",
  "messages": [
    {
      "id": "msg_1748956800_abc1234",
      "sessionId": "sess_1748956800_abc123",
      "role": "user",
      "content": "Check Q2 compliance status.",
      "createdAt": "2026-06-03T10:30:00.000Z"
    },
    {
      "id": "msg_1748956805_xyz9876",
      "sessionId": "sess_1748956800_abc123",
      "role": "assistant",
      "content": "The Q2 compliance status is fully compliant across all reviewed controls.",
      "createdAt": "2026-06-03T10:30:05.000Z"
    }
  ]
}
```

| Response field | Type | Description |
|---------------|------|-------------|
| `sessionId` | `string` | Echoes the requested session ID |
| `messages` | `Message[]` | All messages in chronological order |
| `messages[].role` | `string` | `"user"` or `"assistant"` |
| `messages[].content` | `string` | Full message text |
| `messages[].createdAt` | ISO 8601 | Timestamp |

**Error responses:**

| Status | Cause |
|--------|-------|
| `404` | No session found with that ID |
| `500` | Database error |

---

### `PATCH /api/chat/history/:sessionId`

Updates the `title` of an existing session. Useful when the user renames a conversation in the UI.

**Request body:**

```json
{ "title": "New Session Name" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | **Yes** | The new display title for the session (must be non-empty) |

**Response — `200 OK`:**

```json
{
  "id": "sess_1748956800_abc123",
  "userId": "usr_abc123",
  "role": "user",
  "title": "New Session Name",
  "createdAt": "2026-06-03T10:30:00.000Z",
  "updatedAt": "2026-06-07T18:00:00.000Z"
}
```

**Error responses:**

| Status | Cause |
|--------|-------|
| `400` | Missing or empty `title` field in request body, or invalid JSON |
| `404` | No session found with that ID |
| `500` | Database error |

---

## TransformStream Proxy — Deep Dive

The streaming proxy in `src/app/api/chat/route.ts` satisfies two competing requirements simultaneously: **minimum latency** to the client and **complete persistence** of the AI reply.

```typescript
// Simplified illustration of the core pattern
const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
  flush: async () => {
    // Called after pump() closes the writer — stream fully delivered.
    if (assembledAssistantText.trim()) {
      await prisma.message.create({
        data: { id: generateId("msg"), sessionId, role: "assistant",
                content: assembledAssistantText.trim() }
      });
    }
  },
});

const writer = writable.getWriter();

const pump = async () => {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      await writer.write(value);              // ← bytes reach client NOW
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines to accumulate the full assistant reply
      for (const line of buffer.split("\n")) {
        const parsed = parseSseDataLine(line);
        if (parsed?.type === "token" && parsed.content) {
          assembledAssistantText += parsed.content;
        }
      }
    }
  } finally {
    await writer.close();  // ← triggers flush() above
  }
};

void pump();                               // fire-and-forget

return new Response(readable, { headers: SSE_HEADERS });
```

Key properties of this design:

- **Zero extra buffering** — bytes pass through the `TransformStream` untouched. The widget sees tokens as fast as the AI emits them.
- **Parallel accumulation** — the same bytes are decoded in the `pump()` loop to build the full reply string, without any blocking of the forward path.
- **Async-safe `flush()`** — declared `async`, the Prisma `await` inside it is fully awaited. Errors are caught with `try/catch` and logged non-fatally.
- **Node.js runtime** — `export const runtime = 'edge'` is deliberately absent. The standard Node.js runtime is required for `PrismaClient`.

---

## Contract Translation

| Contract A (widget) | Contract B (AI service) |
|---------------------|------------------------|
| `sessionId` | `conversation_id` |
| `userId` | _(not forwarded — gateway-only)_ |
| `role` | `role` — **hardcoded to `"user"`** (Contract B always receives `"user"`, regardless of the incoming widget role) |
| `message` | `query` |
| — | `context_history` (last 5 turns when `ENABLE_AI_MEMORY=true`, else `[]`) |

Contract C chunks are **not transformed** — forwarded byte-for-byte.

---

## Structured JSON Logging

All error and warning paths in `src/app/api/chat/route.ts` use the `logger` utility in `src/lib/logger.ts` instead of plain `console.error`. Every log line is a **strict JSON object** written to the appropriate Node.js stream, making it compatible with log-aggregation pipelines (Loki, Datadog, Splunk, etc.).

### Log shape

```json
{
  "timestamp": "2026-06-07T21:00:00.000Z",
  "level": "error",
  "step": "ai_fetch",
  "sessionId": "sess_1748956800_abc123",
  "error": "connect ECONNREFUSED 127.0.0.1:8000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO-8601 UTC | When the event occurred |
| `level` | `"info"` \| `"warn"` \| `"error"` | Severity |
| `step` | `string` | Coarse-grained step name (see table below) |
| `sessionId` | `string` | Active session ID (or `"unknown"`) |
| `error` | `string` | Stringified error message |
| _extra fields_ | `unknown` | Any additional key/value pairs (e.g. `aiDetail`) |

### Step names

| `step` | Triggered by |
|--------|--------------|
| `db_upsert` | Prisma session upsert or user message creation failure |
| `memory_fetch` | Prisma history query failure (warn level — request continues) |
| `ai_fetch` | `fetch()` to the AI service throws (network error) |
| `ai_response` | AI service returns a non-2xx status |
| `db_persist_assistant` | Prisma failure saving the assembled assistant reply (warn — stream already delivered) |
| `db_update_session_title` | Prisma failure updating the session title via `PATCH` |

---

## Persistence Schema

### `Session` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `String` | `@id` | Client-generated session identifier |
| `userId` | `String` | indexed | User identifier from widget attribute |
| `role` | `String` | | `"user"` or `"reviewer"` — stored for auditing; always sent as `"user"` to the AI service |
| `title` | `String?` | nullable | Display title. Auto-derived from the first 30 chars of the first message on session creation; can be overwritten via `PATCH /api/chat/history/:sessionId`. `NULL` until first message is saved. |
| `createdAt` | `DateTime` | `@default(now())` | Creation timestamp |
| `updatedAt` | `DateTime` | `@updatedAt` | Auto-updated on every write |

### `Message` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `String` | `@id` | Gateway-generated (`msg_<timestamp>_<random>`) |
| `sessionId` | `String` | FK → `Session.id`, cascade delete, indexed | Parent session |
| `role` | `String` | | `"user"` or `"assistant"` |
| `content` | `String` | | Full message text |
| `createdAt` | `DateTime` | `@default(now())` | Creation timestamp |

---

## Prisma Client Singleton

`src/lib/prisma.ts` uses the standard Next.js development pattern to avoid exhausting the PostgreSQL connection pool during hot-reloads:

```typescript
const globalForPrisma = globalThis as unknown as {
  __prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.__prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development"
    ? ["query", "error", "warn"] : ["error"] });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}
```

In development, the instance is pinned to `globalThis` and reused across hot-reloads. In production, a fresh client is created once per process start.

---

## Project Structure

```
gateway-service/
├── prisma/
│   └── schema.prisma          # Session + Message Prisma models
├── prisma.config.ts           # Prisma 7 config — maps DATABASE_URL to datasource
├── package.json
├── next.config.ts
└── src/
    ├── lib/
    │   ├── contracts.ts       # TypeScript types for Contracts A, B, C
    │   ├── logger.ts          # Structured JSON logging utility
    │   ├── prisma.ts          # Singleton PrismaClient (hot-reload safe)
    │   └── db/
    │       └── schema.ts      # [DEPRECATED] — tombstone, do not import
    └── app/
        ├── layout.tsx
        ├── page.tsx
        └── api/
            └── chat/
                ├── route.ts              # POST /api/chat — stream proxy + memory
                └── history/
                    ├── route.ts          # GET /api/chat/history?userId=
                    └── [sessionId]/
                        └── route.ts     # GET + PATCH /api/chat/history/:sessionId
```

---

## Testing Without the Widget

```powershell
# POST a chat message and watch the SSE stream
curl -X POST http://localhost:3000/api/chat `
  -H "Content-Type: application/json" `
  -H "Accept: text/event-stream" `
  -N `
  -d '{"sessionId":"sess_smoke","userId":"usr_test","role":"reviewer","message":"Hello, check compliance."}'

# Fetch all sessions for a user
curl "http://localhost:3000/api/chat/history?userId=usr_test"

# Fetch all messages for a specific session
curl "http://localhost:3000/api/chat/history/sess_smoke"
```

---

## Related Documentation

- [Root README](../README.md) — contracts, Master Boot Sequence, architecture
- [widget-client/README.md](../widget-client/README.md) — Contract A consumer
- [ai-service/README.md](../ai-service/README.md) — Contract B/C producer
