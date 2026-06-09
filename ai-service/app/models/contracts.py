"""
Contract B: Gateway → AI Service request models.

Contract C (outbound SSE) event shapes emitted by this service:

  data: {"type": "token",   "content": "<text chunk>"}   — incremental assistant text
  data: {"type": "sources", "content": ["doc1.pdf", ...]} — (optional) source filenames
  data: {"type": "done"}                                  — stream complete
  data: {"type": "error",   "content": "<message>"}       — stream failed

The "sources" event is emitted only when ENABLE_CITATIONS=true in the environment
and at least one Knowledge Base chunk was retrieved from ChromaDB. It is always
sent immediately BEFORE the "done" event so consumers can finalise citations atomically.
The Gateway forwards all Contract C bytes verbatim to the widget.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ContextMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatStreamRequest(BaseModel):
    conversation_id: str = Field(..., description="Maps to gateway sessionId")
    query: str
    context_history: list[ContextMessage] = Field(default_factory=list)
