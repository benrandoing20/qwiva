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

    # Embeddings — must match the model used during ingestion (pdf-pipeline + pmc_oa_ingest)
    # Both ingestion pipelines use text-embedding-3-large at dimensions=1536 (Matryoshka).
    # Using a different model here produces incompatible vectors → garbage vector search results.
    openai_api_key: str = ""  # required for text-embedding-3-large (OpenAI direct)
    embedding_model: str = "text-embedding-3-large"
    embedding_dimensions: int = 1536  # Matryoshka truncation — matches ingestion pipelines

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

    # Corpus tables
    # cpg_chunk_table: NICE and other clinical practice guidelines (re-ingested, with embeddings)
    # guideline_chunk_table: PubMed articles — systematic reviews, RCTs, trials, research articles
    # drug_chunk_table: drug prescribing information (FDA SPL / EMC)
    # legacy_chunk_table: original documents_v2 — FTS fallback only, retired after migration
    cpg_chunk_table: str = "clinical_practice_guideline_chunks"
    guideline_chunk_table: str = "guideline_chunks"
    drug_chunk_table: str = "drug_label_chunks"
    legacy_chunk_table: str = "documents_v2"

    # Feature flags
    enable_drug_retrieval: bool = True    # include drug label chunks in FTS + Qdrant search
    enable_version_filter: bool = False   # only enable after migration adds is_current_version to Qdrant payload

    # Deployment
    frontend_url: str = "http://localhost:3000"

    # Search tuning
    retrieval_top_k: int = 25
    rerank_top_n: int = 7
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
