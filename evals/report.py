import json
import pathlib
from dataclasses import asdict
from datetime import UTC, datetime


def save_report(
    eval_results,
    latency,
    clinical,
    ragas=None,
    deepeval=None,
    output_dir: str = "evals/reports",
) -> str:
    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "run_id": run_id,
        "n_questions": len(eval_results),
        "n_errors": sum(1 for r in eval_results if r.error),
        "metrics": {
            "latency_ms": asdict(latency),
            "clinical": asdict(clinical),
            "ragas": asdict(ragas) if ragas else None,
            "deepeval": asdict(deepeval) if deepeval else None,
        },
        "per_question": [
            {
                "question": r.question,
                "answer_preview": r.answer[:200] + "..."
                if len(r.answer) > 200
                else r.answer,
                "answer": r.answer,
                "n_retrieved": len(r.retrieved_chunks),
                "n_reranked": len(r.reranked_chunks),
                "n_citations": len(r.citations),
                "latency_ms": {
                    "classify": round(r.classify_ms, 1),
                    "embed": round(r.embed_ms, 1),
                    "retrieval": round(r.retrieval_ms, 1),
                    "rerank": round(r.rerank_ms, 1),
                    "ttft": round(r.ttft_ms, 1),
                    "total": round(r.total_ms, 1),
                },
                "error": r.error,
            }
            for r in eval_results
        ],
    }

    out = pathlib.Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / f"{run_id}.json"
    json_path.write_text(json.dumps(report, indent=2))

    # Markdown summary
    md = _render_markdown(report)
    (out / f"{run_id}.md").write_text(md)

    print(f"\n[eval] Report written to {json_path}")
    return str(json_path)


def _render_markdown(report: dict) -> str:
    m = report["metrics"]
    lat = m["latency_ms"]
    cli = m["clinical"]
    rag = m.get("ragas") or {}
    de = m.get("deepeval") or {}

    lines = [
        f"# Qwiva Eval Report — {report['run_id']}",
        f"\n**Questions:** {report['n_questions']} | **Errors:** {report['n_errors']}",
        "\n## Latency (ms)",
        "| Stage | p50 | p95 |",
        "|---|---|---|",
        f"| Routing (classify) | {lat['classify_p50']} | {lat['classify_p95']} |",
        f"| Embed | {lat['embed_p50']} | {lat['embed_p95']} |",
        f"| Retrieval | {lat['retrieval_p50']} | {lat['retrieval_p95']} |",
        f"| Rerank | {lat['rerank_p50']} | {lat['rerank_p95']} |",
        f"| Time to first token | {lat['ttft_p50']} | {lat['ttft_p95']} |",
        f"| Total | {lat['total_p50']} | {lat['total_p95']} |",
        "\n## Clinical Quality",
        f"- Citation present rate: **{cli['citation_present_rate'] * 100:.1f}%**",
        f"- Avg citations per answer: **{cli['avg_citations_per_answer']}**",
        f"- Source coverage rate: **{cli['source_coverage_rate'] * 100:.1f}%**",
        f"- Avg answer length: **{cli['answer_length_avg_words']} words**",
        f"- Empty answer rate: **{cli['empty_answer_rate'] * 100:.1f}%**",
    ]

    if rag.get("n_evaluated", 0) > 0:
        lines += [
            "\n## RAGAS",
            f"- Faithfulness: **{rag['faithfulness']}** _(higher = less hallucination)_",
            f"- Answer relevancy: **{rag['answer_relevancy']}**",
            f"- Context precision: **{rag['context_precision']}**",
            f"- Context recall: **{rag['context_recall']}**",
        ]

    if de.get("n_evaluated", 0) > 0:
        lines += [
            "\n## DeepEval",
            f"- Hallucination score: **{de['hallucination_score']}** _(lower is better)_",
            f"- Answer relevancy: **{de['answer_relevancy_score']}**",
            f"- Contextual precision: **{de['contextual_precision_score']}**",
            f"- Contextual recall: **{de['contextual_recall_score']}**",
        ]

    return "\n".join(lines)
