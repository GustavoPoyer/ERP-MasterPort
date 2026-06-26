import json
import re
from typing import Any

from pydantic import BaseModel, Field, field_validator

_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,79}$")


class AutomationTextFieldSchema(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    type: str = "text"
    label: str = Field(min_length=1, max_length=160)
    placeholder: str = Field(default="", max_length=240)
    required: bool = False
    default_value: str = Field(default="", max_length=500)

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        if value != "text":
            raise ValueError("type deve ser 'text'.")
        return value

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        key = value.strip().lower()
        if not _KEY_PATTERN.match(key):
            raise ValueError("Chave inválida. Use letras minúsculas, números e _. Comece com letra.")
        return key


class AutomationFileFieldSchema(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    type: str = "file"
    label: str = Field(min_length=1, max_length=160)
    required: bool = True
    multiple: bool = False
    accept: str = Field(default="", max_length=120)

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        if value != "file":
            raise ValueError("type deve ser 'file'.")
        return value

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        key = value.strip().lower()
        if not _KEY_PATTERN.match(key):
            raise ValueError("Chave inválida. Use letras minúsculas, números e _. Comece com letra.")
        return key


def _parse_field(raw: dict[str, Any]) -> AutomationTextFieldSchema | AutomationFileFieldSchema:
    field_type = (raw.get("type") or "text").strip().lower()
    if field_type == "file":
        return AutomationFileFieldSchema.model_validate(raw)
    return AutomationTextFieldSchema.model_validate(raw)


def normalize_input_schema(fields: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not fields:
        return []
    parsed: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in fields:
        if not isinstance(item, dict):
            raise ValueError("Cada campo do formulário deve ser um objeto.")
        field = _parse_field(item)
        if field.key in seen:
            raise ValueError(f"Chave duplicada no formulário: {field.key}")
        seen.add(field.key)
        parsed.append(field.model_dump())
    return parsed


def dump_input_schema(fields: list[dict[str, Any]] | None) -> str:
    normalized = normalize_input_schema(fields or [])
    return json.dumps(normalized, ensure_ascii=False)


def load_input_schema(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    try:
        return normalize_input_schema(data)
    except ValueError:
        return []


def validate_run_against_schema(
    schema: list[dict[str, Any]],
    parameters: dict[str, Any],
    files_by_slot: dict[str, list[str]],
) -> None:
    for field in schema:
        field_type = field.get("type")
        key = field.get("key", "")
        label = field.get("label") or key
        required = bool(field.get("required"))

        if field_type == "text":
            value = parameters.get(key)
            text = "" if value is None else str(value).strip()
            if required and not text:
                raise ValueError(f"Preencha o campo «{label}».")
            continue

        if field_type == "file":
            names = files_by_slot.get(key) or []
            if required and not names:
                raise ValueError(f"Anexe um arquivo em «{label}».")
            if not field.get("multiple") and len(names) > 1:
                raise ValueError(f"«{label}» aceita apenas um arquivo.")
            continue
