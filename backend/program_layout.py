"""Replace one stored program exercise. No model call and no new week."""


class SwapError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail


class _SwapMiss(Exception):
    pass


class _SwapDuplicate(Exception):
    pass


def swap_day_exercise(day: dict, from_slug: str, replacement_slug: str, replacement_name: str) -> dict:
    """Copy a day with one exercise replaced. Sets, reps, rest, and load stay."""
    if from_slug == replacement_slug:
        present = any(row.get("exercise_slug") == from_slug for row in day.get("exercises") or [])
        if present:
            return day
        raise _SwapMiss()
    rows = []
    found = False
    for row in day.get("exercises") or []:
        slug = row.get("exercise_slug")
        if slug == replacement_slug:
            raise _SwapDuplicate()
        if slug == from_slug and not found:
            found = True
            copied = dict(row)
            copied["exercise_slug"] = replacement_slug
            copied["name"] = replacement_name
            rows.append(copied)
            continue
        rows.append(dict(row))
    if not found:
        raise _SwapMiss()
    updated = dict(day)
    updated["exercises"] = rows
    return updated


def apply_program_swap(
    prog: dict,
    week_index: int,
    day_index: int,
    from_slug: str,
    replacement_slug: str,
    replacement_name: str,
) -> dict:
    """Replace one slug on the stored day and on a matching adjustment."""
    weeks = (prog.get("program") or {}).get("weeks") or []
    week = next((item for item in weeks if item.get("week_index") == week_index), None)
    if week is None:
        raise SwapError(404, "Week not found in program")
    days = week.get("days") or []
    day = next((item for item in days if item.get("day_index") == day_index), None)
    if day is None:
        raise SwapError(404, "Day not found in program")

    def _swap(target: dict) -> dict:
        try:
            return swap_day_exercise(target, from_slug, replacement_slug, replacement_name)
        except _SwapDuplicate as exc:
            raise SwapError(409, "That exercise is already on this day") from exc

    new_day = None
    try:
        new_day = _swap(day)
    except _SwapMiss:
        new_day = None

    adjusted_out = None
    next_adjustments = []
    for record in prog.get("adjustments") or []:
        current = record.get("adjusted_day") if isinstance(record, dict) else None
        same_day = (
            isinstance(record, dict)
            and record.get("week_index") == week_index
            and record.get("day_index") == day_index
            and isinstance(current, dict)
        )
        if not same_day:
            next_adjustments.append(record)
            continue
        try:
            updated = _swap(current)
        except _SwapMiss:
            next_adjustments.append(record)
            continue
        if updated is not current:
            copied = dict(record)
            copied["adjusted_day"] = updated
            next_adjustments.append(copied)
            adjusted_out = updated
        else:
            next_adjustments.append(record)
            adjusted_out = current

    if new_day is None and adjusted_out is None:
        raise SwapError(404, "Exercise is not on this day")
    if new_day is not None and new_day is not day:
        week["days"] = [new_day if item.get("day_index") == day_index else item for item in days]
    if adjusted_out is not None:
        prog["adjustments"] = next_adjustments
    return {"day": new_day or day, "adjusted_day": adjusted_out}
