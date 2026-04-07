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


async def run_deepeval(
    results: list[PipelineResult],
    questions: list[EvalQuestion],
    config: EvalConfig,
) -> DeepEvalReport:
    try:
        import litellm
        from deepeval import evaluate
        from deepeval.metrics import (
            AnswerRelevancyMetric,
            ContextualPrecisionMetric,
            ContextualRecallMetric,
            HallucinationMetric,
        )
        from deepeval.models import DeepEvalBaseLLM
        from deepeval.test_case import LLMTestCase
    except ImportError as e:
        print(f"[deepeval] missing dependency: {e}. Run: uv pip install -e '.[eval]'")
        return DeepEvalReport(0, 0, 0, 0, 0)

    class _LiteLLMJudge(DeepEvalBaseLLM):
        """DeepEvalBaseLLM subclass that routes through LiteLLM → NVIDIA hub."""

        def __init__(self, model: str, api_key: str, api_base: str):
            import asyncio
            self._model = model
            self._api_key = api_key
            self._api_base = api_base
            self._sem = asyncio.Semaphore(3)  # cap concurrent NVIDIA hub judge calls
            super().__init__(model)

        def get_model_name(self) -> str:
            return self._model

        def load_model(self):
            return self

        def generate(self, prompt: str, schema=None, **_):
            import json, re

            resp = litellm.completion(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                api_key=self._api_key,
                api_base=self._api_base,
            )
            text = resp.choices[0].message.content
            if schema is None:
                return text
            # Non-native model path: return schema instance directly (no tuple).
            # Use raw_decode so trailing text/newlines after the JSON don't crash.
            try:
                clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
                obj, _ = json.JSONDecoder().raw_decode(clean.strip())
                return schema(**obj)
            except Exception as exc:
                raise TypeError(str(exc)) from exc

        async def a_generate(self, prompt: str, schema=None, **_):
            import asyncio, json, re

            for attempt in range(4):
                try:
                    async with self._sem:
                        resp = await litellm.acompletion(
                            model=self._model,
                            messages=[{"role": "user", "content": prompt}],
                            api_key=self._api_key,
                            api_base=self._api_base,
                        )
                    break
                except litellm.RateLimitError:
                    if attempt == 3:
                        raise
                    await asyncio.sleep(15 * (attempt + 1))

            text = resp.choices[0].message.content
            if schema is None:
                return text
            # Non-native model path: return schema instance directly (no tuple).
            # Use raw_decode so trailing text/newlines after the JSON don't crash.
            try:
                clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
                obj, _ = json.JSONDecoder().raw_decode(clean.strip())
                return schema(**obj)
            except Exception as exc:
                raise TypeError(str(exc)) from exc

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
                context=r.contexts,           # required by HallucinationMetric
                retrieval_context=r.contexts,  # required by ContextualPrecision/Recall
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

    eval_result = evaluate(
        test_cases, metrics, run_async=True, print_results=False, show_indicator=False
    )

    # Collect scores from EvaluationResult.test_results[*].metrics_data
    scores: dict[str, list[float]] = {
        "Hallucination": [],
        "Answer Relevancy": [],
        "Contextual Precision": [],
        "Contextual Recall": [],
    }
    for tr in eval_result.test_results:
        if not tr.metrics_data:
            continue
        for md in tr.metrics_data:
            if md.name in scores and md.score is not None:
                scores[md.name].append(md.score)

    def avg(lst: list[float]) -> float:
        return round(sum(lst) / len(lst), 4) if lst else 0.0

    return DeepEvalReport(
        hallucination_score=avg(scores["Hallucination"]),
        answer_relevancy_score=avg(scores["Answer Relevancy"]),
        contextual_precision_score=avg(scores["Contextual Precision"]),
        contextual_recall_score=avg(scores["Contextual Recall"]),
        n_evaluated=len(test_cases),
    )
