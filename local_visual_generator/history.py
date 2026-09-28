"""Gallery history: PNG sidecar metadata and outputs/ listing."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
IMAGE_SUFFIXES = frozenset({".png"})
_SAFE_OUTPUT_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
DEFAULT_PAGE_LIMIT = 24
MAX_PAGE_LIMIT = 100


def is_safe_output_name(name: str) -> bool:
    return bool(name) and bool(_SAFE_OUTPUT_NAME.match(name)) and ".." not in name


def resolve_output_file(outputs_dir: Path, name: str) -> Path | None:
    """Resolve a basename under outputs_dir, or None if unsafe / outside."""
    if not is_safe_output_name(name):
        return None
    file_path = (outputs_dir / name).resolve()
    try:
        file_path.relative_to(outputs_dir.resolve())
    except ValueError:
        return None
    return file_path


def write_sidecar_metadata(image_path: Path, metadata: dict[str, Any]) -> None:
    """Write JSON next to a successfully saved PNG (temp file + replace)."""
    json_path = image_path.with_suffix(".json")
    tmp_path = image_path.with_suffix(".json.tmp")
    payload = json.dumps(metadata, ensure_ascii=False, indent=2) + "\n"
    try:
        tmp_path.write_text(payload, encoding="utf-8")
        tmp_path.replace(json_path)
    except OSError:
        logger.exception("Failed to write sidecar metadata for %s", image_path.name)
        try:
            if tmp_path.is_file():
                tmp_path.unlink()
        except OSError:
            pass
        raise


def build_generation_metadata(
    *,
    image_file: str,
    input_prompt: str,
    visual_type: str,
    preset: str,
    final_prompt: str,
    seed: int,
    steps: int,
    width: int,
    height: int,
    model: str,
    device: str,
    elapsed_seconds: float,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    when = created_at or datetime.now().astimezone()
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return {
        "schema_version": SCHEMA_VERSION,
        "created_at": when.isoformat(timespec="seconds"),
        "image_file": image_file,
        "input_prompt": input_prompt,
        "type": visual_type,
        "preset": preset,
        "final_prompt": final_prompt,
        "seed": seed,
        "steps": steps,
        "width": width,
        "height": height,
        "model": model,
        "device": device,
        "elapsed_seconds": elapsed_seconds,
    }


def _parse_created_at(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _read_sidecar(json_path: Path) -> dict[str, Any] | None:
    try:
        raw = json_path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.warning("Skipping corrupt sidecar %s: %s", json_path.name, exc)
        return None
    if not isinstance(data, dict):
        logger.warning("Skipping non-object sidecar %s", json_path.name)
        return None
    return data


def _prompt_summary(text: str, limit: int = 80) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def _item_from_image(image_path: Path) -> dict[str, Any]:
    name = image_path.name
    mtime = datetime.fromtimestamp(image_path.stat().st_mtime).astimezone()
    item: dict[str, Any] = {
        "id": name,
        "image": f"/outputs/{name}",
        "created_at": mtime.isoformat(timespec="seconds"),
        "has_metadata": False,
        "input_prompt": None,
        "prompt_summary": None,
        "type": None,
        "preset": None,
        "final_prompt": None,
        "seed": None,
        "steps": None,
        "width": None,
        "height": None,
        "model": None,
        "device": None,
        "elapsed_seconds": None,
    }

    sidecar = _read_sidecar(image_path.with_suffix(".json"))
    if sidecar is None:
        return item

    created = _parse_created_at(sidecar.get("created_at"))
    if created is not None:
        item["created_at"] = created.isoformat(timespec="seconds")

    item["has_metadata"] = True

    def _str_field(key: str) -> str | None:
        value = sidecar.get(key)
        if isinstance(value, str) and value.strip():
            return value
        return None

    def _int_field(key: str) -> int | None:
        value = sidecar.get(key)
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return None

    def _float_field(key: str) -> float | None:
        value = sidecar.get(key)
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        return None

    input_prompt = _str_field("input_prompt")
    item["input_prompt"] = input_prompt
    item["prompt_summary"] = _prompt_summary(input_prompt) if input_prompt else None
    item["type"] = _str_field("type")
    item["preset"] = _str_field("preset")
    item["final_prompt"] = _str_field("final_prompt")
    item["seed"] = _int_field("seed")
    item["steps"] = _int_field("steps")
    item["width"] = _int_field("width")
    item["height"] = _int_field("height")
    item["model"] = _str_field("model")
    item["device"] = _str_field("device")
    item["elapsed_seconds"] = _float_field("elapsed_seconds")
    return item


def list_gallery(
    outputs_dir: Path,
    *,
    offset: int = 0,
    limit: int = DEFAULT_PAGE_LIMIT,
) -> dict[str, Any]:
    """Scan outputs/ for images; newest first. Missing/corrupt JSON is OK."""
    if offset < 0:
        raise ValueError("offset must be >= 0")
    if limit < 1 or limit > MAX_PAGE_LIMIT:
        raise ValueError(f"limit must be between 1 and {MAX_PAGE_LIMIT}")

    root = outputs_dir.resolve()
    if not root.is_dir():
        return {
            "items": [],
            "total": 0,
            "offset": offset,
            "limit": limit,
            "has_more": False,
        }

    images: list[Path] = []
    for path in root.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        if not is_safe_output_name(path.name):
            continue
        images.append(path)

    items = [_item_from_image(path) for path in images]
    items.sort(key=lambda row: row["created_at"], reverse=True)

    total = len(items)
    page = items[offset : offset + limit]
    return {
        "items": page,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(page) < total,
    }
