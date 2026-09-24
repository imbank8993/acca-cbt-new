"""Synthetic reproduction only; success means the documented defect exists."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "apps/scoring"))
from app.schemas.grading import Question, QuestionOption
from app.services.grading import calculate_single_answer_score

mcq = Question(id="q", type="mcq_complex", score_default=10,
    bank_question_options=[QuestionOption(id="a", is_correct=True),
                           QuestionOption(id="b", is_correct=True)])
mcq_result = calculate_single_answer_score(mcq, '["a","a"]')
assert mcq_result.is_correct and mcq_result.score == 10
checklist = Question(id="q2", type="checklist", bank_question_options=[
    QuestionOption(id="a", weight=2, metadata={"dimension_id": "dimension-A"})])
checklist_result = calculate_single_answer_score(checklist, '["a","a","a"]')
assert checklist_result.dimension_scores["dimension-A"] == 6
results = [
    {"id": "BUG-16a", "reproduced": True, "evidence": "Keys a,b; answer a,a incorrectly receives 10/10."},
    {"id": "BUG-16b", "reproduced": True, "evidence": "One checklist option of weight 2 submitted three times receives dimension score 6."},
]
(Path(__file__).parent / "verification-scoring.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps(results, indent=2))
