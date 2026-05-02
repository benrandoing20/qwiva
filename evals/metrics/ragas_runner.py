from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from evals.config import EvalConfig
    from evals.dataset import EvalQuestion
    from evals.pipeline import PipelineResult


@dataclass
class RagasReport:
    faithfulness: float
    answer_relevancy: float
    context_precision: float
    context_recall: float
    n_evaluated: int


async def run_ragas(
    results: list[PipelineResult],
    questions: list[EvalQuestion],
    config: EvalConfig,
) -> RagasReport:
    """Run RAGAS 0.4+ metrics using the NVIDIA-backed LLM as judge."""
    try:
        from langchain_openai import ChatOpenAI, OpenAIEmbeddings
        from ragas import EvaluationDataset, evaluate
        from ragas.dataset_schema import SingleTurnSample
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from ragas.llms import LangchainLLMWrapper
        from ragas.metrics import (
            AnswerRelevancy,
            ContextPrecision,
            ContextRecall,
            Faithfulness,
        )
    except ImportError as e:
        print(
            f"[ragas] missing dependency: {e}. "
            "Run: uv pip install -e '.[eval]'"
        )
        return RagasReport(float("nan"), float("nan"), float("nan"), float("nan"), 0)

    ok = [r for r in results if r.error is None and r.answer]
    q_map = {q.question: q for q in questions}

    samples = []
    for r in ok:
        q = q_map.get(r.question)
        if q is None or not r.contexts:
            continue
        samples.append(
            SingleTurnSample(
                user_input=r.question,
                response=r.answer,
                retrieved_contexts=r.contexts,
                reference=q.ground_truth,
            )
        )

    if not samples:
        return RagasReport(float("nan"), float("nan"), float("nan"), float("nan"), 0)

    dataset = EvaluationDataset(samples=samples)

    from backend.config import get_settings as _get_settings
    _s = _get_settings()

    # Strip LiteLLM routing prefix (e.g. "groq/") — ChatOpenAI sends the bare model name.
    model_name = config.judge_model.split("/", 1)[-1]
    base_url = config.judge_api_base.rstrip("/")

    judge_llm = LangchainLLMWrapper(
        ChatOpenAI(
            model=model_name,
            api_key=config.judge_api_key,
            base_url=base_url,
        )
    )
    # Embeddings use OpenAI direct (text-embedding-3-small) — separate from the judge LLM.
    embeddings = LangchainEmbeddingsWrapper(
        OpenAIEmbeddings(
            model="text-embedding-3-small",
            openai_api_key=_s.openai_api_key,
        )
    )

    metrics = [
        Faithfulness(llm=judge_llm),
        AnswerRelevancy(llm=judge_llm, embeddings=embeddings),
        ContextPrecision(llm=judge_llm),
        ContextRecall(llm=judge_llm),
    ]

    result = evaluate(dataset, metrics=metrics)
    df = result.to_pandas()

    def safe_mean(col: str) -> float:
        return round(float(df[col].dropna().mean()), 4) if col in df.columns else float("nan")

    return RagasReport(
        faithfulness=safe_mean("faithfulness"),
        answer_relevancy=safe_mean("answer_relevancy"),
        context_precision=safe_mean("context_precision"),
        context_recall=safe_mean("context_recall"),
        n_evaluated=len(samples),
    )
