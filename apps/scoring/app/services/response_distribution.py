"""Sebaran jawaban per jenis soal (perluasan analisis pengecoh klasik).

Rujukan yang dipakai:

* Pengecoh *berfungsi* bila dipilih oleh minimal 5% peserta; di bawah itu dianggap
  tidak berfungsi (Haladyna & Downing, 1993; Haladyna, 2004).
* Daya beda per opsi = proporsi kelompok atas dikurangi kelompok bawah (27%, Kelley 1939)
  yang memilih opsi itu. Kunci seharusnya positif dan pengecoh negatif; kunci negatif
  menandakan kemungkinan salah kunci, pengecoh positif menandakan opsi yang ambigu.
* Untuk soal berbentuk lain, prinsip yang sama diterapkan pada satuan yang dinilai:
  tiap pernyataan (B/S, Kategorisasi, Menjodohkan), tiap posisi (Urutan), dan
  jawaban yang paling sering muncul (Isian) untuk menemukan miskonsepsi umum.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from ..schemas.analytics import DetailedAnswerInput, DetailedOptionInput, DetailedQuestionInput, ResponseChoice, ResponseGroup
from .answer_parser import coerce_bool, normalize_short_answer, parse_mcq_complex_answer
from .grading import _unique_strings

NONFUNCTIONAL_PERCENT = 5.0
ATTRACTS_UPPER_D = 0.1
MIN_GROUP_SIZE = 3
FREE_TOP_RESPONSES = 8


def _strip_html(text: str | None) -> str:
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        clean = clean.replace(entity, char)
    return clean.strip()


def _raw_answer(answer: DetailedAnswerInput) -> Any:
    return answer.essay_answer if answer.essay_answer not in (None, "") else answer.selected_option_id


def _mapping(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _list(raw: Any) -> list:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except Exception:
            return [raw]
        return parsed if isinstance(parsed, list) else [parsed]
    return []


def _short_inputs(raw: Any) -> list:
    """Isian dibaca seperti ``grading.py``: JSON array, string JSON, atau teks polos."""
    if isinstance(raw, list):
        return raw
    parsed = None
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = None
    if parsed is None:
        return [raw] if raw else []
    return parsed if isinstance(parsed, list) else [parsed] if isinstance(parsed, str) else []


def _texts(value: Any) -> list[str]:
    values = value if isinstance(value, list) else [value]
    return [str(v) for v in values if v is not None and str(v).strip() != ""]


@dataclass
class _Choice:
    value: str
    text: str = ""
    is_key: bool = False
    students: list[str] = field(default_factory=list)
    attempts: set[str] = field(default_factory=set)


@dataclass
class _Group:
    id: str
    kind: str
    label: str = ""
    text: str = ""
    choices: dict[str, _Choice] = field(default_factory=dict)
    empty: int = 0
    correct: int = 0

    def choice(self, key: str, value: str, text: str = "", is_key: bool = False) -> _Choice:
        if key not in self.choices:
            self.choices[key] = _Choice(value=value, text=text, is_key=is_key)
        return self.choices[key]

    def pick(self, key: str, value: str, name: str, attempt: str, text: str = "", is_key: bool = False) -> None:
        choice = self.choice(key, value, text, is_key)
        choice.students.append(name)
        choice.attempts.add(attempt)


@dataclass
class _Context:
    respondents: int
    upper: set[str]
    lower: set[str]

    def finish(self, group: _Group, *, free: bool = False) -> ResponseGroup:
        total = self.respondents
        enough = len(self.upper) >= MIN_GROUP_SIZE and len(self.lower) >= MIN_GROUP_SIZE
        choices = list(group.choices.values())
        if free:
            # Isian: tampilkan semua jawaban benar dan jawaban salah yang paling sering; sisanya digabung.
            wrong = sorted((c for c in choices if not c.is_key), key=lambda c: (-len(c.students), c.value.lower()))
            keys = [c for c in choices if c.is_key]
            rest = wrong[FREE_TOP_RESPONSES:]
            choices = sorted(keys, key=lambda c: -len(c.students)) + wrong[:FREE_TOP_RESPONSES]
            if rest:
                other = _Choice(value="Jawaban lain", text=f"{len(rest)} variasi jawaban lain")
                for c in rest:
                    other.students.extend(c.students)
                    other.attempts |= c.attempts
                choices.append(other)
        result: list[ResponseChoice] = []
        for c in choices:
            pct = len(c.students) / total * 100 if total else 0.0
            d = (len(c.attempts & self.upper) / len(self.upper) - len(c.attempts & self.lower) / len(self.lower)) if enough else None
            flags: list[str] = []
            if not free and not c.is_key and pct < NONFUNCTIONAL_PERCENT:
                flags.append("nonfunctional")
            if d is not None and not c.is_key and d >= ATTRACTS_UPPER_D:
                flags.append("attracts_upper")
            if d is not None and c.is_key and d < 0:
                flags.append("key_negative")
            result.append(ResponseChoice(
                value=c.value, text=c.text[:160], is_key=c.is_key, count=len(c.students), percentage=round(pct, 1),
                discrimination=round(d, 2) if d is not None else None, flags=flags,
                students=sorted(c.students, key=str.lower),
            ))
        return ResponseGroup(
            id=group.id, kind=group.kind, label=group.label, text=group.text[:200],
            correct_percentage=round(group.correct / total * 100, 1) if total else 0.0,
            empty=group.empty, choices=result,
        )


def _ordering_key(question: DetailedQuestionInput, options: list[DetailedOptionInput]) -> list[str]:
    correct = (question.metadata or {}).get("correct_order") or []
    return [str(c) for c in correct] if correct else [o.id for o in options]


def build_response_distribution(
    question: DetailedQuestionInput,
    options: list[DetailedOptionInput],
    letters: dict[str, str],
    answers: list[DetailedAnswerInput],
    names: dict[str, str],
    upper: set[str],
    lower: set[str],
) -> list[ResponseGroup]:
    """Sebaran jawaban sebuah soal. ``options`` sudah terurut dan ``letters`` memetakan id → huruf."""
    q_type = (question.type or "mcq").lower()
    ctx = _Context(respondents=len(answers), upper=upper, lower=lower)
    text_of = {o.id: _strip_html(o.option_text) for o in options}

    if q_type in ("mcq", "mcq_complex"):
        group = _Group(id=question.id, kind="single" if q_type == "mcq" else "multi")
        for o in options:
            group.choice(o.id, letters.get(o.id, "-"), text_of[o.id], bool(o.is_correct))
        keys = {o.id for o in options if o.is_correct}
        for a in answers:
            name = names.get(a.attempt_id, "Tanpa Nama")
            picked = [str(a.selected_option_id)] if q_type == "mcq" and a.selected_option_id else (
                parse_mcq_complex_answer(_raw_answer(a)) if q_type == "mcq_complex" else [])
            fully_correct = bool(keys) and _unique_strings(picked) and set(picked) == keys
            picked = [p for p in dict.fromkeys(picked) if p in group.choices]
            if not picked:
                group.empty += 1
            for option_id in picked:
                group.pick(option_id, letters.get(option_id, "-"), name, a.attempt_id)
            if fully_correct:
                group.correct += 1
        return [ctx.finish(group)]

    if q_type == "true_false":
        groups = []
        for o in options:
            group = _Group(id=o.id, kind="statement", label=letters.get(o.id, "-"), text=text_of[o.id])
            key = bool(o.is_correct)
            group.choice("true", "Benar", is_key=key)
            group.choice("false", "Salah", is_key=not key)
            for a in answers:
                value = coerce_bool(_mapping(_raw_answer(a)).get(o.id))
                if value is None:
                    group.empty += 1
                    continue
                group.pick("true" if value else "false", "Benar" if value else "Salah", names.get(a.attempt_id, "Tanpa Nama"), a.attempt_id)
                group.correct += value == key
            groups.append(ctx.finish(group))
        return groups

    if q_type in ("categorization", "matching"):
        plural, single = ("category_names", "category_name") if q_type == "categorization" else ("match_texts", "match_text")
        all_keys: list[str] = []
        for o in options:
            meta = o.metadata or {}
            for k in _texts(meta.get(plural) or meta.get(single)):
                if k not in all_keys:
                    all_keys.append(k)
        groups = []
        for o in options:
            meta = o.metadata or {}
            key = set(_texts(meta.get(plural) or meta.get(single)))
            group = _Group(id=o.id, kind="statement", label=letters.get(o.id, "-"), text=text_of[o.id])
            for k in all_keys:
                group.choice(k, _strip_html(k), is_key=k in key)
            for a in answers:
                raw_chosen = _mapping(_raw_answer(a)).get(o.id)
                chosen = _texts(raw_chosen)
                if not chosen:
                    group.empty += 1
                    continue
                for c in dict.fromkeys(chosen):
                    group.pick(c, _strip_html(c), names.get(a.attempt_id, "Tanpa Nama"), a.attempt_id, is_key=c in key)
                group.correct += bool(key) and _unique_strings(raw_chosen) and set(raw_chosen) == key
            groups.append(ctx.finish(group))
        return groups

    if q_type == "ordering":
        correct = _ordering_key(question, options)
        groups = []
        for index, key_id in enumerate(correct):
            group = _Group(id=f"{question.id}:{index}", kind="position", label=str(index + 1), text=f"Urutan ke-{index + 1}")
            for o in options:
                group.choice(o.id, letters.get(o.id, "-"), text_of[o.id], o.id == key_id)
            for a in answers:
                order = [str(x) for x in _list(_raw_answer(a))]
                placed = order[index] if index < len(order) else None
                if placed not in group.choices:
                    group.empty += 1
                    continue
                group.pick(placed, letters.get(placed, "-"), names.get(a.attempt_id, "Tanpa Nama"), a.attempt_id)
                group.correct += placed == key_id
            groups.append(ctx.finish(group))
        return groups

    if q_type == "short_answer":
        blanks = (question.metadata or {}).get("blanks") or []
        count = max(len(blanks), 1)
        groups = []
        for index in range(count):
            blank = blanks[index] if index < len(blanks) else {}
            accepted = {normalize_short_answer(v) for v in [blank.get("answer"), *(blank.get("variations") or [])] if v}
            group = _Group(id=f"{question.id}:{index}", kind="free", label=str(index + 1) if count > 1 else "",
                           text=f"Isian ke-{index + 1}" if count > 1 else "")
            for a in answers:
                inputs = _short_inputs(_raw_answer(a))
                value = inputs[index] if index < len(inputs) else None
                normalized = normalize_short_answer(value if isinstance(value, str) else (str(value) if value is not None else None))
                if not normalized:
                    group.empty += 1
                    continue
                is_key = normalized in accepted if accepted else bool(a.is_correct)
                group.pick(normalized, str(value).strip(), names.get(a.attempt_id, "Tanpa Nama"), a.attempt_id, is_key=is_key)
                group.correct += is_key
            groups.append(ctx.finish(group, free=True))
        return groups

    return []
