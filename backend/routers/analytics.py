"""Authenticated analytics ingest and the staff rollup.

Clients may post events they are allowed to name. They may not choose the
actor, the role, the source, or the timestamp. Reading the rollup requires
the `analytics.read` staff permission.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

import analytics
import ratelimit
import staff
from server import current_user

router = APIRouter()


def _session_id(value: str | None) -> str | None:
    if value is None:
        return None
    if not analytics.SESSION_RE.fullmatch(value):
        raise ValueError("session_id must be 8–64 letters, digits, _ or -")
    return value


def _event_id(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise ValueError("event_id must be a UUID") from exc


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: analytics.EventName
    props: dict[str, Any] = Field(default_factory=dict)
    session_id: str | None = None
    event_id: str | None = None

    @field_validator("props")
    @classmethod
    def props_are_an_object(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("props must be an object")
        return value

    @field_validator("session_id")
    @classmethod
    def session(cls, value: str | None) -> str | None:
        return _session_id(value)

    @field_validator("event_id")
    @classmethod
    def event_uuid(cls, value: str | None) -> str | None:
        return _event_id(value)


class EventsIn(BaseModel):
    """One event, or a batch of up to 25. Not both shapes at once."""

    model_config = ConfigDict(extra="forbid")

    events: list[EventIn] | None = Field(default=None, min_length=1, max_length=25)
    name: analytics.EventName | None = None
    props: dict[str, Any] = Field(default_factory=dict)
    session_id: str | None = None
    event_id: str | None = None

    @field_validator("session_id")
    @classmethod
    def session(cls, value: str | None) -> str | None:
        return _session_id(value)

    @field_validator("event_id")
    @classmethod
    def event_uuid(cls, value: str | None) -> str | None:
        return _event_id(value)

    @model_validator(mode="after")
    def one_shape(self):
        if self.events is not None and self.name is not None:
            raise ValueError("Send a batch or one event, not both")
        if self.events is None:
            if self.name is None:
                raise ValueError("An event name is required")
            self.events = [EventIn(
                name=self.name,
                props=self.props,
                session_id=self.session_id,
                event_id=self.event_id,
            )]
        return self


@router.post("/events")
async def ingest(body: EventsIn, user: dict = Depends(current_user)):
    await ratelimit.hit("analytics", user["id"])
    accepted = 0
    duplicates = 0
    role = analytics.product_role(user)
    for event in body.events or []:
        outcome = await analytics.record(
            name=event.name,
            actor_id=user["id"],
            source="client",
            role=role,
            session_id=event.session_id,
            props=event.props,
            event_id=event.event_id,
        )
        if outcome == "accepted":
            accepted += 1
        else:
            duplicates += 1
    return {"accepted": accepted, "duplicates": duplicates}


@router.get("/admin/analytics")
async def event_counts(user: dict = Depends(staff.require("analytics.read"))):
    # Repeated inside the body so a direct call (the test style) cannot skip
    # the dependency. HTTP requests are checked twice; both must agree.
    if "analytics.read" not in staff.permissions_for(user):
        raise HTTPException(403, "Staff permission required")
    # One row per actor per 15 minutes (`staff.ANALYTICS_VIEW_WINDOW`), not one per open.
    await staff.audit_view(
        user, "analytics.viewed", target_type="analytics", target_id="product_events",
    )
    return await analytics.counts()
