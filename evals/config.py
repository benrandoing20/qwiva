from dataclasses import dataclass

from backend.config import get_settings


@dataclass
class EvalConfig:
    n_questions: int = None  # None = run all
    run_ragas: bool = True
    run_deepeval: bool = True
    output_dir: str = "evals/reports"
    judge_model: str = None  # defaults to settings.litellm_model
    judge_api_key: str = None
    judge_api_base: str = None

    def __post_init__(self):
        s = get_settings()
        if self.judge_model is None:
            # Route judge through NVIDIA hub (OpenAI-compat) using existing NVIDIA_API_KEY.
            # "openai/" prefix tells LiteLLM to use the OpenAI-compatible endpoint.
            self.judge_model = "openai/aws/anthropic/bedrock-claude-opus-4-6"
        if self.judge_api_key is None:
            self.judge_api_key = s.nvidia_api_key
        if self.judge_api_base is None:
            self.judge_api_base = s.nvidia_api_base
