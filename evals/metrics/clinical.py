import re
from dataclasses import dataclass, field

from evals.dataset import EvalQuestion
from evals.pipeline import PipelineResult

# Numbers with optional clinical units — used to check answer faithfulness to GT numerics
_NUM_RE = re.compile(r"\b\d+(?:\.\d+)?(?:\s*(?:mg|mL|weeks?|months?|%|hrs?|days?|years?|doses?))?\b", re.IGNORECASE)


@dataclass
class ClinicalReport:
    citation_present_rate: float  # % of answers that have at least one [N] citation
    avg_citations_per_answer: float
    source_coverage_rate: float  # % of questions where expected_source_keywords appear in retrieved guideline titles
    answer_length_avg_words: int
    empty_answer_rate: float
    numeric_accuracy_rate: float  # fraction of ground-truth numbers that appear in the answer
    retrieval_diversity_avg: float  # avg distinct guideline titles / n_reranked (1.0 = max diversity)
    by_difficulty: dict  # {1: {metric: val, "n": int}, 2: ..., 3: ...}
    n: int


def _numeric_accuracy(answer: str, ground_truth: str) -> float | None:
    """Fraction of GT numeric tokens that appear verbatim in the answer. None if GT has no numbers."""
    nums = _NUM_RE.findall(ground_truth)
    nums = [n.strip() for n in nums if n.strip()]
    if not nums:
        return None
    hits = sum(1 for n in nums if n.lower() in answer.lower())
    return hits / len(nums)


def _retrieval_diversity(reranked_chunks: list) -> float:
    """Fraction of distinct guideline titles in the reranked set (0–1)."""
    if not reranked_chunks:
        return 0.0
    titles = {getattr(c, "guideline_title", "") for c in reranked_chunks if c is not None}
    return len(titles) / len(reranked_chunks)


def compute_clinical(
    results: list[PipelineResult], questions: list[EvalQuestion]
) -> ClinicalReport:
    ok = [r for r in results if r.error is None]
    n = len(ok)
    if n == 0:
        return ClinicalReport(0, 0, 0, 0, 1.0, 0.0, 0.0, {}, 0)

    citation_counts = [len(re.findall(r"\[\d+\]", r.answer)) for r in ok]
    has_citation = sum(1 for c in citation_counts if c > 0)

    # Source coverage: check if expected keywords appear in retrieved guideline titles
    covered = 0
    q_map = {q.question: q for q in questions}
    for r in ok:
        q = q_map.get(r.question)
        if q is None:
            continue
        titles = " ".join((c.guideline_title or "").lower() for c in r.retrieved_chunks)
        if any(kw.lower() in titles for kw in q.expected_source_keywords):
            covered += 1

    word_counts = [len(r.answer.split()) for r in ok]
    empty = sum(1 for r in ok if len(r.answer.strip()) < 20)

    # Numeric accuracy
    num_scores = []
    for r in ok:
        q = q_map.get(r.question)
        if q and q.ground_truth:
            score = _numeric_accuracy(r.answer, q.ground_truth)
            if score is not None:
                num_scores.append(score)
    numeric_accuracy_rate = round(sum(num_scores) / len(num_scores), 3) if num_scores else 0.0

    # Retrieval diversity
    diversity_scores = [_retrieval_diversity(r.reranked_chunks) for r in ok]
    retrieval_diversity_avg = round(sum(diversity_scores) / len(diversity_scores), 3) if diversity_scores else 0.0

    # Difficulty stratification
    by_difficulty: dict = {}
    for diff in (1, 2, 3):
        bucket_results = [r for r in ok if (q_map.get(r.question) and q_map[r.question].difficulty == diff)]
        if not bucket_results:
            continue
        b_citations = [len(re.findall(r"\[\d+\]", r.answer)) for r in bucket_results]
        b_covered = sum(
            1 for r in bucket_results
            if (q := q_map.get(r.question)) and any(
                kw.lower() in " ".join((c.guideline_title or "").lower() for c in r.retrieved_chunks)
                for kw in q.expected_source_keywords
            )
        )
        b_num_scores = []
        for r in bucket_results:
            q = q_map.get(r.question)
            if q and q.ground_truth:
                s = _numeric_accuracy(r.answer, q.ground_truth)
                if s is not None:
                    b_num_scores.append(s)
        by_difficulty[diff] = {
            "citation_present_rate": round(sum(1 for c in b_citations if c > 0) / len(bucket_results), 3),
            "source_coverage_rate": round(b_covered / len(bucket_results), 3),
            "numeric_accuracy_rate": round(sum(b_num_scores) / len(b_num_scores), 3) if b_num_scores else 0.0,
            "n": len(bucket_results),
        }

    return ClinicalReport(
        citation_present_rate=round(has_citation / n, 3),
        avg_citations_per_answer=round(sum(citation_counts) / n, 2),
        source_coverage_rate=round(covered / n, 3),
        answer_length_avg_words=round(sum(word_counts) / n),
        empty_answer_rate=round(empty / n, 3),
        numeric_accuracy_rate=numeric_accuracy_rate,
        retrieval_diversity_avg=retrieval_diversity_avg,
        by_difficulty=by_difficulty,
        n=n,
    )
