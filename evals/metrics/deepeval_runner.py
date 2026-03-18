from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from evals.config import EvalConfig
    from evals.dataset import EvalQuestion
    from evals.pipeline import PipelineResult


@dataclass
class DeepEvalReport:
    hallucination_score: float  # lower is better (0 = no hallucination)
    answer_relevancy_score: float  # higher is better
    contextual_precision_score: float
    contextual_recall_score: float
    n_evaluated: int


class _LiteLLMJudge:
    """Minimal DeepEvalBaseLLM wrapper around LiteLLM."""

    def __init__(self, model: str, api_key: str, api_base: str):
        self.model = model
        self.api_key = api_key
        self.api_base = api_base

    def get_model_name(self) -> str:
        return self.model

    def load_model(self):
        return self

    def generate(self, prompt: str) -> tuple[str, float]:
        import litellm

        resp = litellm.completion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            api_key=self.api_key,
            api_base=self.api_base,
        )
        return resp.choices[0].message.content, 0.0

    async def a_generate(self, prompt: str) -> tuple[str, float]:
        import litellm

        resp = await litellm.acompletion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            api_key=self.api_key,
            api_base=self.api_base,
        )
        return resp.choices[0].message.content, 0.0


async def run_deepeval(
    results: list[PipelineResult],
    questions: list[EvalQuestion],
    config: EvalConfig,
) -> DeepEvalReport:
    try:
        from deepeval import evaluate
        from deepeval.metrics import (
            AnswerRelevancyMetric,
            ContextualPrecisionMetric,
            ContextualRecallMetric,
            HallucinationMetric,
        )
        from deepeval.test_case import LLMTestCase
    except ImportError as e:
        print(f"[deepeval] missing dependency: {e}. Run: pip install deepeval")
        return DeepEvalReport(0, 0, 0, 0, 0)

    # Patch DeepEvalBaseLLM with our LiteLLM wrapper
    judge_llm = _LiteLLMJudge(config.judge_model, config.judge_api_key, config.judge_api_base)

    ok = [r for r in results if r.error is None and r.answer]
    q_map = {q.question: q for q in questions}

    test_cases = []
    for r in ok:
        q = q_map.get(r.question)
        if q is None or not r.contexts:
            continue
        test_cases.append(
            LLMTestCase(
                input=r.question,
                actual_output=r.answer,
                expected_output=q.ground_truth,
                retrieval_context=r.contexts,
            )
        )

    if not test_cases:
        return DeepEvalReport(0, 0, 0, 0, 0)

    metrics = [
        HallucinationMetric(model=judge_llm, threshold=0.5),
        AnswerRelevancyMetric(model=judge_llm, threshold=0.7),
        ContextualPrecisionMetric(model=judge_llm, threshold=0.7),
        ContextualRecallMetric(model=judge_llm, threshold=0.7),
    ]

    evaluate(test_cases, metrics, run_async=True, print_results=False)

    scores: dict[str, list[float]] = {
        "hallucination": [],
        "answerrelevancy": [],
        "contextualprecision": [],
        "contextualrecall": [],
    }
    for tc in test_cases:
        for m in tc.metrics:
            name = m.__class__.__name__.lower().replace("metric", "").strip("_")
            if name in scores:
                scores[name].append(m.score)

    def avg(lst):
        return round(sum(lst) / len(lst), 4) if lst else 0.0

    return DeepEvalReport(
        hallucination_score=avg(scores["hallucination"]),
        answer_relevancy_score=avg(scores["answerrelevancy"]),
        contextual_precision_score=avg(scores["contextualprecision"]),
        contextual_recall_score=avg(scores["contextualrecall"]),
        n_evaluated=len(test_cases),
    )
