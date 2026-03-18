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
    """Run RAGAS metrics using the NVIDIA-backed LLM as judge."""
    try:
        from datasets import Dataset
        from langchain_community.chat_models import ChatLiteLLM
        from langchain_openai import OpenAIEmbeddings
        from ragas import evaluate
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from ragas.llms import LangchainLLMWrapper
        from ragas.metrics import (
            answer_relevancy,
            context_precision,
            context_recall,
            faithfulness,
        )
    except ImportError as e:
        print(
            f"[ragas] missing dependency: {e}. "
            "Run: pip install ragas langchain-community langchain-openai"
        )
        return RagasReport(0, 0, 0, 0, 0)

    ok = [r for r in results if r.error is None and r.answer]
    q_map = {q.question: q for q in questions}

    rows = []
    for r in ok:
        q = q_map.get(r.question)
        if q is None or not r.contexts:
            continue
        rows.append(
            {
                "question": r.question,
                "answer": r.answer,
                "contexts": r.contexts,
                "ground_truth": q.ground_truth,
            }
        )

    if not rows:
        return RagasReport(0, 0, 0, 0, 0)

    dataset = Dataset.from_list(rows)

    # Configure judge LLM -> NVIDIA hub via LiteLLM
    judge_llm = LangchainLLMWrapper(
        ChatLiteLLM(
            model=config.judge_model,
            api_base=config.judge_api_base,
            api_key=config.judge_api_key,
        )
    )
    # Configure embeddings -> NVIDIA hub
    embeddings = LangchainEmbeddingsWrapper(
        OpenAIEmbeddings(
            model="azure/openai/text-embedding-3-small",
            openai_api_key=config.judge_api_key,
            openai_api_base=config.judge_api_base,
        )
    )

    metrics = [faithfulness, answer_relevancy, context_precision, context_recall]
    for m in metrics:
        m.llm = judge_llm
    answer_relevancy.embeddings = embeddings

    result = evaluate(dataset, metrics=metrics)
    df = result.to_pandas()

    def safe_mean(col):
        return round(float(df[col].dropna().mean()), 4) if col in df.columns else 0.0

    return RagasReport(
        faithfulness=safe_mean("faithfulness"),
        answer_relevancy=safe_mean("answer_relevancy"),
        context_precision=safe_mean("context_precision"),
        context_recall=safe_mean("context_recall"),
        n_evaluated=len(rows),
    )
