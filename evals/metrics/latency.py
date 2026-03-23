import statistics
from dataclasses import dataclass

from evals.pipeline import PipelineResult


@dataclass
class LatencyReport:
    classify_p50: float
    classify_p95: float
    embed_p50: float
    embed_p95: float
    retrieval_p50: float
    retrieval_p95: float
    rerank_p50: float
    rerank_p95: float
    ttft_p50: float
    ttft_p95: float
    total_p50: float
    total_p95: float
    n: int


def compute_latency(results: list[PipelineResult]) -> LatencyReport:
    ok = [r for r in results if r.error is None]

    def p(vals, pct):
        return (
            round(statistics.quantiles(vals, n=100)[pct - 1], 1)
            if len(vals) >= 2
            else (vals[0] if vals else 0.0)
        )

    return LatencyReport(
        classify_p50=p([r.classify_ms for r in ok], 50),
        classify_p95=p([r.classify_ms for r in ok], 95),
        embed_p50=p([r.embed_ms for r in ok], 50),
        embed_p95=p([r.embed_ms for r in ok], 95),
        retrieval_p50=p([r.retrieval_ms for r in ok], 50),
        retrieval_p95=p([r.retrieval_ms for r in ok], 95),
        rerank_p50=p([r.rerank_ms for r in ok], 50),
        rerank_p95=p([r.rerank_ms for r in ok], 95),
        ttft_p50=p([r.ttft_ms for r in ok], 50),
        ttft_p95=p([r.ttft_ms for r in ok], 95),
        total_p50=p([r.total_ms for r in ok], 50),
        total_p95=p([r.total_ms for r in ok], 95),
        n=len(ok),
    )
