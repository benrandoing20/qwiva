import re
from dataclasses import dataclass

from evals.dataset import EvalQuestion
from evals.pipeline import PipelineResult


@dataclass
class ClinicalReport:
    citation_present_rate: float  # % of answers that have at least one [N] citation
    avg_citations_per_answer: float
    source_coverage_rate: float  # % of questions where expected_source_keywords appear in retrieved guideline titles
    answer_length_avg_words: int
    empty_answer_rate: float
    n: int


def compute_clinical(
    results: list[PipelineResult], questions: list[EvalQuestion]
) -> ClinicalReport:
    ok = [r for r in results if r.error is None]
    n = len(ok)
    if n == 0:
        return ClinicalReport(0, 0, 0, 0, 1.0, 0)

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

    return ClinicalReport(
        citation_present_rate=round(has_citation / n, 3),
        avg_citations_per_answer=round(sum(citation_counts) / n, 2),
        source_coverage_rate=round(covered / n, 3),
        answer_length_avg_words=round(sum(word_counts) / n),
        empty_answer_rate=round(empty / n, 3),
        n=n,
    )
