"""
Standalone ingestion script — populates the local ChromaDB vector store.

Usage (from the ai-service/ directory, with the venv active):
    python -m app.ingest

What it does:
  1. Reads all .pdf and .txt files from the `data/` directory.
  2. Chunks them with RecursiveCharacterTextSplitter (size=1000, overlap=200).
  3. Embeds them using the same provider logic as the main app:
       - USE_AZURE=false (default) → local FastEmbed (BAAI/bge-small-en-v1.5, free, no API key)
       - USE_AZURE=true            → AzureOpenAIEmbeddings (AZURE_OPENAI_EMBEDDING_DEPLOYMENT)
  4. Persists the Chroma collection to the CHROMA_PERSIST_DIR directory.

Prerequisites:
  - Activate the virtual environment first: .venv\\Scripts\\Activate.ps1
  - Ensure your .env is configured (GROQ_API_KEY or Azure vars).
  - Place your compliance PDF/TXT documents in ai-service/data/.

Run this script once before starting the server, and re-run whenever documents change.
"""

from __future__ import annotations

import os
import sys
import logging
from pathlib import Path

# ---------------------------------------------------------------------------
# Bootstrap: load .env BEFORE any other app imports so env vars are available.
# ---------------------------------------------------------------------------
from dotenv import load_dotenv

# Resolve paths relative to the ai-service/ root (one level above this file's
# directory, which is ai-service/app/).
_SERVICE_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_SERVICE_ROOT / ".env")

# ---------------------------------------------------------------------------
# Now import LangChain and ChromaDB — they pick up env vars set above.
# ---------------------------------------------------------------------------
import chromadb
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ingest")

# ---------------------------------------------------------------------------
# Constants (overridable via .env)
# ---------------------------------------------------------------------------
DATA_DIR = _SERVICE_ROOT / os.getenv("INGEST_DATA_DIR", "data")
CHROMA_PERSIST_DIR = _SERVICE_ROOT / os.getenv("CHROMA_PERSIST_DIR", "chroma_db")
COLLECTION_NAME = "compliance_kb"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


# ---------------------------------------------------------------------------
# Embedding factory — mirrors llm_factory.py's USE_AZURE pattern.
# ---------------------------------------------------------------------------

def _use_azure() -> bool:
    return os.getenv("USE_AZURE", "").strip().lower() in ("1", "true", "yes")


def _get_embedding_function():
    """
    Return a LangChain-compatible embedding model.

    - Groq path (USE_AZURE=false): FastEmbedEmbeddings — fully local, free,
      powered by onnxruntime (already in requirements.txt). Downloads the
      BAAI/bge-small-en-v1.5 model (~40 MB) on first call; cached afterwards.
    - Azure path (USE_AZURE=true): AzureOpenAIEmbeddings using
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT.
    """
    if _use_azure():
        from langchain_openai import AzureOpenAIEmbeddings
        logger.info("Embedding provider: AzureOpenAIEmbeddings")
        return AzureOpenAIEmbeddings(
            azure_deployment=os.getenv(
                "AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-large"
            ),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
        )
    else:
        from langchain_community.embeddings import FastEmbedEmbeddings
        logger.info("Embedding provider: FastEmbedEmbeddings (local, BAAI/bge-small-en-v1.5)")
        return FastEmbedEmbeddings(model_name="BAAI/bge-small-en-v1.5")


# ---------------------------------------------------------------------------
# Document loading helpers
# ---------------------------------------------------------------------------

def _load_documents(data_dir: Path) -> list[Document]:
    """Walk data_dir and load all supported files into LangChain Documents."""
    if not data_dir.exists():
        logger.warning(
            f"Data directory '{data_dir}' does not exist. Creating it. "
            "Place your PDF/TXT compliance documents there and re-run."
        )
        data_dir.mkdir(parents=True, exist_ok=True)
        return []

    docs: list[Document] = []
    supported = {".pdf": PyPDFLoader, ".txt": TextLoader}

    files = sorted(data_dir.rglob("*"))
    for fp in files:
        if fp.suffix.lower() not in supported:
            continue
        loader_cls = supported[fp.suffix.lower()]
        try:
            loader = loader_cls(str(fp))
            loaded = loader.load()
            # Normalise the source metadata to the basename so it matches the
            # value surfaced in the SSE sources event.
            for doc in loaded:
                doc.metadata["source"] = fp.name
            docs.extend(loaded)
            logger.info(f"  Loaded '{fp.name}' ({len(loaded)} page(s)/chunk(s))")
        except Exception as exc:
            logger.error(f"  Failed to load '{fp.name}': {exc}")

    return docs


# ---------------------------------------------------------------------------
# Main ingestion routine
# ---------------------------------------------------------------------------

def ingest() -> None:
    logger.info("=== ABB Compliance KB Ingestion ===")
    logger.info(f"Data directory : {DATA_DIR}")
    logger.info(f"ChromaDB path  : {CHROMA_PERSIST_DIR}")
    logger.info(f"Collection     : {COLLECTION_NAME}")

    # 1. Load documents
    logger.info("Step 1/4 — Loading documents...")
    raw_docs = _load_documents(DATA_DIR)
    if not raw_docs:
        logger.warning(
            "No documents found. Add .pdf or .txt files to the data/ directory "
            "and re-run this script."
        )
        sys.exit(0)
    logger.info(f"  Total pages/docs loaded: {len(raw_docs)}")

    # 2. Chunk
    logger.info("Step 2/4 — Splitting into chunks...")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        add_start_index=True,
    )
    chunks = splitter.split_documents(raw_docs)
    logger.info(f"  Total chunks produced: {len(chunks)}")

    # 3. Embed
    logger.info("Step 3/4 — Building embedding model...")
    embeddings = _get_embedding_function()

    # 4. Persist to ChromaDB
    logger.info("Step 4/4 — Persisting to ChromaDB...")
    CHROMA_PERSIST_DIR.mkdir(parents=True, exist_ok=True)

    client = chromadb.PersistentClient(path=str(CHROMA_PERSIST_DIR))

    # Delete existing collection so re-runs are idempotent.
    try:
        client.delete_collection(COLLECTION_NAME)
        logger.info(f"  Deleted existing collection '{COLLECTION_NAME}'.")
    except Exception:
        pass  # Collection didn't exist yet — that's fine.

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    # Batch embed and upsert
    batch_size = 100
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        texts = [c.page_content for c in batch]
        metadatas = [c.metadata for c in batch]
        ids = [f"chunk_{i + j}" for j in range(len(batch))]

        vectors = embeddings.embed_documents(texts)

        collection.add(
            ids=ids,
            documents=texts,
            embeddings=vectors,
            metadatas=metadatas,
        )
        logger.info(
            f"  Upserted batch {i // batch_size + 1} "
            f"({len(batch)} chunks, total so far: {i + len(batch)})"
        )

    logger.info("")
    logger.info(
        f"✓ Ingestion complete — {len(chunks)} chunks from "
        f"{len({c.metadata.get('source', '?') for c in chunks})} source file(s) "
        f"stored in '{CHROMA_PERSIST_DIR}'."
    )


if __name__ == "__main__":
    ingest()
