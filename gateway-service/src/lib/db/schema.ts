/**
 * Mock SQLite persistence layer.
 * In production, swap this module for real sqlite3 / Drizzle / Prisma
 * without changing the HTTP contract surface.
 */

export type StoredMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
};

const messageStore: StoredMessage[] = [];

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function saveMessage(
  id: string,
  sessionId: string,
  role: string,
  content: string
): Promise<StoredMessage> {
  const record: StoredMessage = {
    id: id || generateId(),
    sessionId,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
  messageStore.push(record);
  return record;
}

export async function getMessagesBySession(
  sessionId: string
): Promise<StoredMessage[]> {
  return messageStore.filter((m) => m.sessionId === sessionId);
}

export async function getAllMessages(): Promise<StoredMessage[]> {
  return [...messageStore];
}
