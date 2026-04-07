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
        f"- Numeric accuracy rate: **{cli.get('numeric_accuracy_rate', 0) * 100:.1f}%**",
        f"- Retrieval diversity: **{cli.get('retrieval_diversity_avg', 0):.3f}**",
    ]

    by_diff = cli.get("by_difficulty") or {}
    if by_diff:
        lines += [
            "\n## Clinical Quality by Difficulty",
            "| Difficulty | n | Citation % | Source Coverage % | Numeric Accuracy % |",
            "|---|---|---|---|---|",
        ]
        labels = {1: "Easy", 2: "Medium", 3: "Hard"}
        for d in sorted(by_diff):
            b = by_diff[d]
            lines.append(
                f"| {labels.get(d, d)} | {b['n']} "
                f"| {b['citation_present_rate'] * 100:.1f}% "
                f"| {b['source_coverage_rate'] * 100:.1f}% "
                f"| {b['numeric_accuracy_rate'] * 100:.1f}% |"
            )

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


def compare_reports(path_a: str, path_b: str) -> None:
    """Print a delta table between two eval reports."""
    a = json.loads(pathlib.Path(path_a).read_text())
    b = json.loads(pathlib.Path(path_b).read_text())

    print(f"\nComparing reports:")
    print(f"  A: {a['run_id']} ({a['n_questions']}q, {a['n_errors']} errors)")
    print(f"  B: {b['run_id']} ({b['n_questions']}q, {b['n_errors']} errors)")
    print()

    # Metrics where lower is better (latency, hallucination, empty answers)
    lower_is_better = {
        "embed_p50", "embed_p95", "retrieval_p50", "retrieval_p95",
        "rerank_p50", "rerank_p95", "ttft_p50", "ttft_p95",
        "total_p50", "total_p95", "classify_p50", "classify_p95",
        "empty_answer_rate", "hallucination_score",
    }

    rows = []

    def _collect(section_key: str, label_prefix: str, d: dict) -> None:
        ma = (a["metrics"].get(section_key) or {})
        mb = (b["metrics"].get(section_key) or {})
        for k, va in ma.items():
            if not isinstance(va, (int, float)):
                continue
            vb = mb.get(k)
            if vb is None or not isinstance(vb, (int, float)):
                continue
            delta = vb - va
            lib = k in lower_is_better
            if abs(delta) < 1e-6:
                arrow = "  "
            elif (delta < 0) == lib:
                arrow = "↑"  # improvement
            else:
                arrow = "↓"  # regression
            rows.append((f"{label_prefix}.{k}", va, vb, delta, arrow))

    _collect("latency_ms", "latency", {})
    _collect("clinical", "clinical", {})
    _collect("ragas", "ragas", {})
    _collect("deepeval", "deepeval", {})

    col_w = max(len(r[0]) for r in rows) + 2
    print(f"{'Metric':<{col_w}} {'A':>10} {'B':>10} {'Δ':>10}  Dir")
    print("-" * (col_w + 36))
    for name, va, vb, delta, arrow in rows:
        print(f"{name:<{col_w}} {va:>10.4g} {vb:>10.4g} {delta:>+10.4g}  {arrow}")
    print()
