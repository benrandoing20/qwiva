import asyncio
import uuid

from fastapi import Depends, HTTPException

from backend.auth import verify_token
from backend.db import get_db
from backend.models import (
    SurveyCreate,
    SurveyResponseCreate,
    UserProfile,
)
from backend.profiles import get_profile


async def require_admin(user: UserProfile = Depends(verify_token)) -> UserProfile:
    profile = await get_profile(user.user_id)
    if not profile or profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def create_survey(creator_id: str, body: SurveyCreate) -> dict:
    db = await get_db()

    survey_row = {
        "created_by": creator_id,
        "title": body.title,
        "description": body.description,
        "specialty_tags": body.specialty_tags,
        "status": body.status,
        "is_anonymous": body.is_anonymous,
        "estimated_minutes": body.estimated_minutes,
        "starts_at": body.starts_at,
        "ends_at": body.ends_at,
    }
    survey_result = await db.table("surveys").insert(survey_row).execute()
    survey = survey_result.data[0]
    survey_id = survey["id"]

    try:
        question_rows = []
        for q in body.questions:
            options_data = None
            if q.options:
                options_data = [
                    {"id": opt.id or str(uuid.uuid4()), "text": opt.text}
                    for opt in q.options
                ]
            question_rows.append({
                "survey_id": survey_id,
                "question_text": q.question_text,
                "question_type": q.question_type,
                "options": options_data,
                "scale_min": q.scale_min,
                "scale_max": q.scale_max,
                "scale_min_label": q.scale_min_label,
                "scale_max_label": q.scale_max_label,
                "is_required": q.is_required,
                "order_index": q.order_index,
            })
        if question_rows:
            await db.table("survey_questions").insert(question_rows).execute()
    except Exception:
        await db.table("surveys").delete().eq("id", survey_id).execute()
        raise

    return survey


async def list_surveys(user_id: str, status: str = "active") -> list[dict]:
    db = await get_db()
    result = await (
        db.table("surveys")
        .select("*")
        .eq("status", status)
        .order("created_at", desc=True)
        .execute()
    )
    surveys = result.data or []

    if surveys:
        ids = [s["id"] for s in surveys]
        resp_result = await (
            db.table("survey_responses")
            .select("survey_id")
            .eq("user_id", user_id)
            .in_("survey_id", ids)
            .execute()
        )
        responded_ids = {r["survey_id"] for r in (resp_result.data or [])}
        for s in surveys:
            s["has_responded"] = s["id"] in responded_ids

    return surveys


async def list_my_surveys(user_id: str) -> list[dict]:
    """For admins: all surveys created by this user regardless of status."""
    db = await get_db()
    result = await (
        db.table("surveys")
        .select("*")
        .eq("created_by", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    surveys = result.data or []
    for s in surveys:
        s["has_responded"] = False
    return surveys


async def get_survey_detail(survey_id: str, user_id: str) -> dict | None:
    db = await get_db()

    survey_result, questions_result, response_result = await asyncio.gather(
        db.table("surveys").select("*").eq("id", survey_id).maybe_single().execute(),
        db.table("survey_questions")
        .select("*")
        .eq("survey_id", survey_id)
        .order("order_index")
        .execute(),
        db.table("survey_responses")
        .select("id")
        .eq("survey_id", survey_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute(),
    )

    if not survey_result or not survey_result.data:
        return None

    survey = survey_result.data
    survey["questions"] = questions_result.data or []
    survey["has_responded"] = response_result is not None and response_result.data is not None
    return survey


async def submit_response(survey_id: str, user_id: str, body: SurveyResponseCreate) -> dict:
    db = await get_db()

    existing = await (
        db.table("survey_responses")
        .select("id")
        .eq("survey_id", survey_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        raise ValueError("Already responded")

    response_result = await (
        db.table("survey_responses")
        .insert({"survey_id": survey_id, "user_id": user_id})
        .execute()
    )
    response = response_result.data[0]
    response_id = response["id"]

    if body.answers:
        answer_rows = [
            {
                "response_id": response_id,
                "question_id": a.question_id,
                "answer_text": a.answer_text,
                "answer_options": a.answer_options,
            }
            for a in body.answers
        ]
        await db.table("survey_answers").insert(answer_rows).execute()

    return response


async def get_results(survey_id: str) -> dict | None:
    db = await get_db()

    survey_result, questions_result = await asyncio.gather(
        db.table("surveys")
        .select("id, title, status, response_count")
        .eq("id", survey_id)
        .maybe_single()
        .execute(),
        db.table("survey_questions")
        .select("*")
        .eq("survey_id", survey_id)
        .order("order_index")
        .execute(),
    )

    if not survey_result or not survey_result.data:
        return None

    survey = survey_result.data
    questions = questions_result.data or []

    response_ids_result = await (
        db.table("survey_responses")
        .select("id")
        .eq("survey_id", survey_id)
        .execute()
    )
    response_ids = [r["id"] for r in (response_ids_result.data or [])]

    all_answers: list[dict] = []
    if response_ids:
        answers_result = await (
            db.table("survey_answers")
            .select("question_id, answer_text, answer_options")
            .in_("response_id", response_ids)
            .execute()
        )
        all_answers = answers_result.data or []

    result_questions = []
    for q in questions:
        qid = q["id"]
        qtype = q["question_type"]
        q_answers = [a for a in all_answers if a["question_id"] == qid]
        total = len(q_answers)

        rq: dict = {
            "question_id": qid,
            "question_text": q["question_text"],
            "question_type": qtype,
            "total_responses": total,
        }

        if qtype in ("multiple_choice", "multi_select"):
            counts: dict[str, int] = {}
            for a in q_answers:
                for opt_id in (a.get("answer_options") or []):
                    counts[opt_id] = counts.get(opt_id, 0) + 1
            rq["option_counts"] = counts
        elif qtype == "scale":
            dist: dict[int, int] = {}
            total_val = 0
            count_val = 0
            for a in q_answers:
                try:
                    val = int(a.get("answer_text") or "")
                    dist[val] = dist.get(val, 0) + 1
                    total_val += val
                    count_val += 1
                except (ValueError, TypeError):
                    pass
            rq["scale_distribution"] = dist
            rq["average_scale"] = round(total_val / count_val, 2) if count_val else None
        elif qtype == "open_text":
            texts = [a["answer_text"] for a in q_answers if a.get("answer_text")]
            rq["open_text_responses"] = texts[:200]

        result_questions.append(rq)

    return {
        "survey_id": survey_id,
        "title": survey["title"],
        "status": survey["status"],
        "response_count": survey["response_count"],
        "questions": result_questions,
    }
