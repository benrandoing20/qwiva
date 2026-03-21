from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase
    supabase_url: str
    supabase_service_key: str
    supabase_jwt_secret: str

    # NVIDIA Inference Hub (embeddings, reranker, fast classify model)
    nvidia_api_key: str
    nvidia_api_base: str = "https://inference-api.nvidia.com/v1/"
    embedding_model: str = "azure/openai/text-embedding-3-small"

    # Main generation model — defaults to NVIDIA-routed Bedrock Sonnet.
    # Set to "anthropic/claude-sonnet-4-6" + ANTHROPIC_API_KEY to enable prompt caching.
    litellm_model: str = "openai/aws/anthropic/bedrock-claude-sonnet-4-6"
    anthropic_api_key: str = ""  # required only when litellm_model uses anthropic/ prefix

    # Routing classifier — use a small fast model to keep classify latency low.
    # Defaults to llama-3.1-8b on NVIDIA NIM (~200ms vs ~1100ms for Sonnet).
    classify_model: str = "openai/meta/llama-3.1-8b-instruct"

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

    # Deployment
    frontend_url: str = "http://localhost:3000"

    # Search tuning
    retrieval_top_k: int = 12
    rerank_top_n: int = 5
    rrf_k: int = 60
    dense_weight: float = 0.6   # must sum to 1.0 with sparse_weight
    sparse_weight: float = 0.4


@lru_cache
def get_settings() -> Settings:
    return Settings()
