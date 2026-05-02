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
            # Groq is OpenAI-compatible (works with ChatOpenAI in RAGAS),
            # already in the stack, and much cheaper than Anthropic for eval judging.
            self.judge_model = s.classify_model  # groq/llama-3.3-70b-versatile
        if self.judge_api_key is None:
            self.judge_api_key = s.groq_api_key
        if self.judge_api_base is None:
            self.judge_api_base = "https://api.groq.com/openai/v1"
