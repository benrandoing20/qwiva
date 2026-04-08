from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase
    supabase_url: str
    supabase_service_key: str
    supabase_jwt_secret: str

    # NVIDIA Inference Hub — kept for reranker only (direct GPU call, no routing overhead)
    nvidia_api_key: str
    nvidia_api_base: str = "https://inference-api.nvidia.com/v1/"

    # Embeddings — NVIDIA hub hosts text-embedding-3-small directly (no routing overhead)
    openai_api_key: str = ""  # set to use OpenAI direct instead
    embedding_model: str = "azure/openai/text-embedding-3-small"

    # Main generation — Anthropic direct removes NVIDIA→Bedrock overhead (~300ms TTFT)
    # and enables prompt caching. Switch between haiku (fast) and sonnet (quality).
    litellm_model: str = "anthropic/claude-sonnet-4-6"
    anthropic_api_key: str = ""

    # Routing + suggestions — Groq LPU inference (~50–150ms, vs ~1100ms on NVIDIA→Bedrock)
    # groq/llama-3.3-70b-versatile is fast and accurate enough for binary classify
    classify_model: str = "groq/llama-3.3-70b-versatile"
    groq_api_key: str = ""

    # Reranker
    rerank_model: str = "nvidia/nvidia/llama-3.2-nv-rerankqa-1b-v2"
    rerank_base_url: str = "https://inference-api.nvidia.com/v1/rerank"

    # Langfuse observability (optional — tracing disabled if keys not set)
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"

    # Qdrant vector store
    qdrant_url: str = ""
    qdrant_api_key: str = ""
    qdrant_collection: str = "qwiva_docs"

    # Corpus tables — set these to match your Supabase table names.
    # guideline_chunk_table: your colleague's new rich guideline table.
    # drug_chunk_table: the drug label sections table linked to drug_manifest.
    #   Override via GUIDELINE_CHUNK_TABLE / DRUG_CHUNK_TABLE env vars.
    guideline_chunk_table: str = "guideline_chunks"
    drug_chunk_table: str = "drug_label_chunks"  # confirm exact name with colleague
    legacy_chunk_table: str = "documents_v2"      # deprecated; used during migration window

    # Feature flags
    enable_drug_retrieval: bool = True    # include drug label chunks in FTS + Qdrant search
    enable_version_filter: bool = True    # restrict Qdrant search to is_current_version=True

    # Deployment
    frontend_url: str = "http://localhost:3000"

    # Search tuning
    retrieval_top_k: int = 12
    rerank_top_n: int = 5
    rrf_k: int = 60
    dense_weight: float = 0.6   # must sum to 1.0 with sparse_weight
    sparse_weight: float = 0.4

    @model_validator(mode="after")
    def _weights_sum_to_one(self) -> "Settings":
        total = round(self.dense_weight + self.sparse_weight, 10)
        if total != 1.0:
            raise ValueError(
                f"dense_weight + sparse_weight must equal 1.0, got {total}"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
