"""Contract B: Gateway -> AI Service request models."""

from typing import Literal

from pydantic import BaseModel, Field


class ContextMessage(BaseModel):
    role: Literal["user", "reviewer", "assistant"]
    content: str


class ChatStreamRequest(BaseModel):
    conversation_id: str = Field(..., description="Maps to gateway sessionId")
    role: Literal["user", "reviewer"]
    query: str
    context_history: list[ContextMessage] = Field(default_factory=list)
