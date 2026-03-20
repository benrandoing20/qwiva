"""
Qwiva RAG Eval Harness

Usage:
    python -m evals.run_evals
    python -m evals.run_evals --n 5 --skip-ragas --skip-deepeval
    python -m evals.run_evals --skip-pipeline --report evals/reports/20260319T123822Z.json

Options:
    --n N              Run only first N questions
    --skip-pipeline    Skip question execution; reload results from --report JSON
    --skip-ragas       Skip RAGAS model-based metrics
    --skip-deepeval    Skip DeepEval metrics
    --report PATH      Existing report JSON to reload when using --skip-pipeline
    --dataset PATH     Path to questions JSON (default: evals/datasets/clinical_questions.json)
"""

import argparse
import asyncio
import json

from evals.config import EvalConfig
from evals.dataset import load_dataset
from evals.metrics.clinical import compute_clinical
from evals.metrics.latency import compute_latency
from evals.pipeline import PipelineResult, run_question
from evals.report import save_report


def _load_pipeline_results_from_report(report_path: str, questions) -> list[PipelineResult]:
    """Reconstruct PipelineResult stubs from a saved report JSON for re-running judges only."""
    import pathlib

    data = json.loads(pathlib.Path(report_path).read_text())
    q_map = {q.question: q for q in questions}
    results = []
    for pq in data["per_question"]:
        q = q_map.get(pq["question"])
        results.append(
            PipelineResult(
                question=pq["question"],
                retrieved_chunks=[],
                reranked_chunks=[None] * pq["n_reranked"],
                answer=pq.get("answer_preview", ""),
                citations=[None] * pq["n_citations"],
                contexts=[],
                embed_ms=pq["latency_ms"]["embed"],
                retrieval_ms=pq["latency_ms"]["retrieval"],
                rerank_ms=pq["latency_ms"]["rerank"],
                ttft_ms=pq["latency_ms"]["ttft"],
                total_ms=pq["latency_ms"]["total"],
                error=pq.get("error"),
            )
        )
    return results


async def main(args: argparse.Namespace) -> None:
    config = EvalConfig(
        n_questions=args.n,
        run_ragas=not args.skip_ragas,
        run_deepeval=not args.skip_deepeval,
    )

    questions = load_dataset(args.dataset)
    if config.n_questions:
        questions = questions[: config.n_questions]

    if args.skip_pipeline:
        if not args.report:
            raise SystemExit("--skip-pipeline requires --report <path>")
        print(f"[eval] Skipping pipeline — reloading results from {args.report}")
        pipeline_results = _load_pipeline_results_from_report(args.report, questions)
    else:
        print(f"[eval] Running {len(questions)} questions...")
        print(
            f"[eval] RAGAS={'on' if config.run_ragas else 'off'} "
            f"| DeepEval={'on' if config.run_deepeval else 'off'}\n"
        )
        pipeline_results = []
        for i, q in enumerate(questions, 1):
            print(f"  [{i}/{len(questions)}] {q.question[:70]}...", end=" ", flush=True)
            result = await run_question(q.question)
            pipeline_results.append(result)
            status = f"ERROR {result.error[:40]}" if result.error else f"OK {result.total_ms:.0f}ms"
            print(status)

    # Compute metrics
    latency = compute_latency(pipeline_results)
    clinical = compute_clinical(pipeline_results, questions)

    ragas_report = None
    if config.run_ragas:
        print("\n[eval] Running RAGAS metrics (this calls the judge LLM per question)...")
        from evals.metrics.ragas_runner import run_ragas

        ragas_report = await run_ragas(pipeline_results, questions, config)

    deepeval_report = None
    if config.run_deepeval:
        print("\n[eval] Running DeepEval metrics...")
        from evals.metrics.deepeval_runner import run_deepeval

        deepeval_report = await run_deepeval(pipeline_results, questions, config)

    # Print summary
    print(f"\n{'=' * 60}")
    print("LATENCY (ms)")
    print(f"  Embed:      p50={latency.embed_p50}  p95={latency.embed_p95}")
    print(f"  Retrieval:  p50={latency.retrieval_p50}  p95={latency.retrieval_p95}")
    print(f"  Rerank:     p50={latency.rerank_p50}  p95={latency.rerank_p95}")
    print(f"  TTFT:       p50={latency.ttft_p50}  p95={latency.ttft_p95}")
    print(f"  Total:      p50={latency.total_p50}  p95={latency.total_p95}")
    print("\nCLINICAL QUALITY")
    print(f"  Citation present:  {clinical.citation_present_rate * 100:.1f}%")
    print(f"  Source coverage:   {clinical.source_coverage_rate * 100:.1f}%")
    print(f"  Avg answer words:  {clinical.answer_length_avg_words}")
    if ragas_report and ragas_report.n_evaluated > 0:
        print("\nRAGAS")
        print(f"  Faithfulness:      {ragas_report.faithfulness}")
        print(f"  Answer relevancy:  {ragas_report.answer_relevancy}")
        print(f"  Context precision: {ragas_report.context_precision}")
        print(f"  Context recall:    {ragas_report.context_recall}")
    if deepeval_report and deepeval_report.n_evaluated > 0:
        print("\nDEEPEVAL")
        print(f"  Hallucination:     {deepeval_report.hallucination_score}")
        print(f"  Answer relevancy:  {deepeval_report.answer_relevancy_score}")

    save_report(pipeline_results, latency, clinical, ragas_report, deepeval_report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=None)
    parser.add_argument("--skip-pipeline", action="store_true")
    parser.add_argument("--skip-ragas", action="store_true")
    parser.add_argument("--skip-deepeval", action="store_true")
    parser.add_argument("--report", default=None, help="Existing report JSON (required with --skip-pipeline)")
    parser.add_argument("--dataset", default="evals/datasets/clinical_questions.json")
    args = parser.parse_args()
    asyncio.run(main(args))
