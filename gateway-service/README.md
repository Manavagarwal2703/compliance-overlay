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

> **Prisma 7 note:** Unlike Prisma 6 and earlier, the connection URL is configured in `prisma.config.ts` (not in `schema.prisma`). Next.js reads `.env.local` automatically, so `DATABASE_URL` is available to both the Next.js routes and the Prisma config at runtime.

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

CORS preflight handler. Responds `204 No Content` with `Access-Control-Allow-Origin: *` for development.

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
Access-Control-Allow-Origin: *
```

**Error responses:**

| Status | Cause |
|--------|-------|
| `400` | Missing or malformed JSON body |
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
| `role` | `role` |
| `message` | `query` |
| — | `context_history` (empty array; history hydration TBD) |

Contract C chunks are **not transformed** — forwarded byte-for-byte.

---

## Persistence Schema

### `Session` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `String` | `@id` | Client-generated session identifier |
| `userId` | `String` | indexed | User identifier from widget attribute |
| `role` | `String` | | `"user"` or `"reviewer"` |
| `title` | `String` | | First 30 chars of first message + `"..."` |
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
    │   ├── prisma.ts          # Singleton PrismaClient (hot-reload safe)
    │   └── db/
    │       └── schema.ts      # [DEPRECATED] — tombstone, do not import
    └── app/
        ├── layout.tsx
        ├── page.tsx
        └── api/
            └── chat/
                ├── route.ts              # POST /api/chat — stream proxy
                └── history/
                    ├── route.ts          # GET /api/chat/history?userId=
                    └── [sessionId]/
                        └── route.ts     # GET /api/chat/history/:sessionId
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
