"""Minimal ThreadingHTTPServer for UI + JSON API."""

from __future__ import annotations

import json
import logging
import mimetypes
import random
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from source.generator import ImageGenerator
from source.presets import (
    DEFAULT_MODEL,
    DEFAULT_PRESET,
    DEFAULT_VISUAL_TYPE,
    MODELS,
    QUALITY_PRESETS,
    SEED_MAX,
    SEED_MIN,
    SIZE_OPTIONS,
    STEPS_MAX,
    STEPS_MIN,
    VISUAL_TYPE_TEMPLATES,
    get_model_spec,
    get_quality_preset,
    get_visual_type_suffix,
    resolve_size,
)

logger = logging.getLogger(__name__)

_SAFE_OUTPUT_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


class AppContext:
    def __init__(self, project_root: Path, generator: ImageGenerator) -> None:
        self.project_root = project_root.resolve()
        self.web_dir = (self.project_root / "web").resolve()
        self.outputs_dir = (self.project_root / "outputs").resolve()
        self.generator = generator


def create_handler(ctx: AppContext) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: object) -> None:
            logger.info("%s - %s", self.address_string(), fmt % args)

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = unquote(parsed.path)

            if path == "/" or path == "/index.html":
                self._serve_file(ctx.web_dir / "index.html", "text/html; charset=utf-8")
                return
            if path == "/style.css":
                self._serve_file(ctx.web_dir / "style.css", "text/css; charset=utf-8")
                return
            if path == "/app.js":
                self._serve_file(
                    ctx.web_dir / "app.js",
                    "application/javascript; charset=utf-8",
                )
                return
            if path == "/api/status":
                payload = ctx.generator.status_payload()
                payload["presets"] = list(QUALITY_PRESETS.keys())
                payload["types"] = list(VISUAL_TYPE_TEMPLATES.keys())
                payload["sizes"] = [
                    {"id": f"{w}x{h}", "width": w, "height": h} for w, h in SIZE_OPTIONS
                ]
                payload["preset_sizes"] = {
                    name: {"width": preset.width, "height": preset.height}
                    for name, preset in QUALITY_PRESETS.items()
                }
                payload["steps_min"] = STEPS_MIN
                payload["steps_max"] = STEPS_MAX
                self._json_response(HTTPStatus.OK, payload)
                return
            if path.startswith("/outputs/"):
                self._serve_output(path[len("/outputs/") :])
                return

            self._json_response(HTTPStatus.NOT_FOUND, {"error": "Not found"})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = unquote(parsed.path)

            if path == "/api/generate":
                self._handle_generate()
                return

            self._json_response(HTTPStatus.NOT_FOUND, {"error": "Not found"})

        def _handle_generate(self) -> None:
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._json_response(HTTPStatus.BAD_REQUEST, {"success": False, "error": str(exc)})
                return

            prompt = body.get("prompt", "")
            if not isinstance(prompt, str) or not prompt.strip():
                self._json_response(
                    HTTPStatus.BAD_REQUEST,
                    {"success": False, "error": "prompt is required and must be non-empty"},
                )
                return

            visual_type = body.get("type", DEFAULT_VISUAL_TYPE)
            preset_name = body.get("preset", DEFAULT_PRESET)
            model_name = body.get("model", DEFAULT_MODEL)

            try:
                if not isinstance(visual_type, str):
                    raise ValueError("type must be a string")
                get_visual_type_suffix(visual_type)

                if not isinstance(preset_name, str):
                    raise ValueError("preset must be a string")

                if not isinstance(model_name, str):
                    raise ValueError("model must be a string")
                model_id = get_model_spec(model_name).id
                get_quality_preset(preset_name, model_id)

                seed = _parse_seed(body.get("seed"))
                steps = _parse_steps(body.get("steps"))
                size = _parse_size(body.get("width"), body.get("height"))
            except ValueError as exc:
                self._json_response(
                    HTTPStatus.BAD_REQUEST,
                    {"success": False, "error": str(exc)},
                )
                return

            try:
                result = ctx.generator.generate(
                    prompt=prompt,
                    visual_type=visual_type,
                    preset=preset_name,
                    seed=seed,
                    model=model_id,
                    steps=steps,
                    width=None if size is None else size[0],
                    height=None if size is None else size[1],
                )
            except FileNotFoundError as exc:
                self._json_response(
                    HTTPStatus.BAD_REQUEST,
                    {"success": False, "error": str(exc)},
                )
                return
            except Exception as exc:
                logger.exception("Generation failed")
                self._json_response(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"success": False, "error": str(exc)},
                )
                return

            self._json_response(
                HTTPStatus.OK,
                {
                    "success": True,
                    "elapsed": result.elapsed,
                    "width": result.width,
                    "height": result.height,
                    "steps": result.steps,
                    "seed": result.seed,
                    "model": result.model,
                    "image": result.relative_url,
                },
            )

        def _serve_output(self, filename: str) -> None:
            name = filename.strip("/")
            if not name or not _SAFE_OUTPUT_NAME.match(name) or ".." in name:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": "Invalid filename"})
                return

            file_path = (ctx.outputs_dir / name).resolve()
            try:
                file_path.relative_to(ctx.outputs_dir)
            except ValueError:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": "Invalid path"})
                return

            if not file_path.is_file():
                self._json_response(HTTPStatus.NOT_FOUND, {"error": "File not found"})
                return

            content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
            self._serve_file(file_path, content_type)

        def _serve_file(self, path: Path, content_type: str) -> None:
            if not path.is_file():
                self._json_response(HTTPStatus.NOT_FOUND, {"error": "File not found"})
                return
            data = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _read_json_body(self) -> dict[str, Any]:
            length_hdr = self.headers.get("Content-Length")
            if not length_hdr:
                raise ValueError("Content-Length required")
            try:
                length = int(length_hdr)
            except ValueError as exc:
                raise ValueError("Invalid Content-Length") from exc
            if length < 0 or length > 1_000_000:
                raise ValueError("Request body too large")
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("Invalid JSON body") from exc
            if not isinstance(data, dict):
                raise ValueError("JSON body must be an object")
            return data

        def _json_response(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def _parse_size(width: object, height: object) -> tuple[int, int] | None:
    """Return None to keep the quality preset's default resolution."""
    if width is None and height is None:
        return None
    if width is None or height is None:
        raise ValueError("width and height must be provided together")
    return resolve_size(_parse_positive_int(width, "width"), _parse_positive_int(height, "height"))


def _parse_positive_int(value: object, field: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be an integer")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError(f"{field} must be an integer")
        value = int(value)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            raise ValueError(f"{field} must be an integer")
        try:
            value = int(value)
        except ValueError as exc:
            raise ValueError(f"{field} must be an integer") from exc
    if not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    if value <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return value


def _parse_steps(value: object) -> int | None:
    """Return None to keep the quality preset's default step count."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("steps must be an integer")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError("steps must be an integer")
        value = int(value)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        try:
            value = int(value)
        except ValueError as exc:
            raise ValueError("steps must be an integer") from exc
    if not isinstance(value, int):
        raise ValueError("steps must be an integer")
    if value < STEPS_MIN or value > STEPS_MAX:
        raise ValueError(f"steps must be between {STEPS_MIN} and {STEPS_MAX}")
    return value


def _parse_seed(value: object) -> int:
    if value is None or value == "":
        return random.randint(SEED_MIN, SEED_MAX)
    if isinstance(value, bool):
        raise ValueError("seed must be an integer")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError("seed must be an integer")
        value = int(value)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return random.randint(SEED_MIN, SEED_MAX)
        try:
            value = int(value)
        except ValueError as exc:
            raise ValueError("seed must be an integer") from exc
    if not isinstance(value, int):
        raise ValueError("seed must be an integer")
    if value < SEED_MIN or value > SEED_MAX:
        raise ValueError(f"seed must be between {SEED_MIN} and {SEED_MAX}")
    return value


def run_server(ctx: AppContext, host: str = "127.0.0.1", port: int = 7860) -> None:
    handler = create_handler(ctx)
    server = ThreadingHTTPServer((host, port), handler)
    logger.info("Serving on http://%s:%d", host, port)
    logger.info("Available models: %s", ", ".join(MODELS.keys()))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        server.server_close()
