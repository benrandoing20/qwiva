from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase
    supabase_url: str
    supabase_service_key: str
    supabase_jwt_secret: str

    # NVIDIA Inference Hub (used for both embeddings and LLM)
    nvidia_api_key: str
    nvidia_api_base: str = "https://inference-api.nvidia.com/v1/"
    embedding_model: str = "azure/openai/text-embedding-3-small"
    litellm_model: str = "openai/aws/anthropic/bedrock-claude-sonnet-4-6"

    # Reranker
    rerank_model: str = "nvidia/nvidia/llama-3.2-nv-rerankqa-1b-v2"
    rerank_base_url: str = "https://inference-api.nvidia.com/v1/rerank"

    # Langfuse observability (optional — tracing disabled if keys not set)
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"

    # Deployment
    frontend_url: str = "http://localhost:3000"

    # Search tuning
    retrieval_top_k: int = 20
    rerank_top_n: int = 5
    rrf_k: int = 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
