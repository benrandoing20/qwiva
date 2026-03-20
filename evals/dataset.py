import json
import pathlib
from dataclasses import dataclass


@dataclass
class EvalQuestion:
    id: str
    question: str
    ground_truth: str  # reference answer for RAGAS context_recall
    expected_source_keywords: list[str]  # guideline title keywords that should appear in retrieved chunks
    tags: list[str]  # e.g. ["malaria", "treatment", "adult"]
    difficulty: int  # 1-3


def load_dataset(path: str = "evals/datasets/clinical_questions.json") -> list[EvalQuestion]:
    data = json.loads(pathlib.Path(path).read_text())
    return [EvalQuestion(**q) for q in data]
