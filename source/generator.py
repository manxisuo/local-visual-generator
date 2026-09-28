"""OpenVINO GenAI Text2ImagePipeline wrapper — multi-model, serial generate."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image

from source.presets import (
    DEFAULT_DEVICE,
    DEFAULT_MODEL,
    STEPS_MAX,
    STEPS_MIN,
    QualityPreset,
    build_prompt,
    get_model_spec,
    get_quality_preset,
    list_available_models,
    model_available_on_disk,
    model_dir,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GenerateResult:
    image_path: Path
    relative_url: str
    width: int
    height: int
    steps: int
    seed: int
    elapsed: float
    prompt_used: str
    model: str


class ImageGenerator:
    """Owns Text2ImagePipeline instances (lazy, cached) and serializes generate()."""

    def __init__(
        self,
        project_root: Path,
        device: str = DEFAULT_DEVICE,
        default_model: str = DEFAULT_MODEL,
    ) -> None:
        self.project_root = project_root.resolve()
        self.outputs_dir = (self.project_root / "outputs").resolve()
        self.device = device
        self.default_model = get_model_spec(default_model).id
        self._pipelines: dict[str, Any] = {}
        self._active_model: str | None = None
        self._lock = threading.Lock()
        self._ready = False

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def model_name(self) -> str:
        if self._active_model is None:
            return get_model_spec(self.default_model).display_name
        return get_model_spec(self._active_model).display_name

    @property
    def active_model_id(self) -> str:
        return self._active_model or self.default_model

    def status_payload(self) -> dict[str, object]:
        models = list_available_models(self.project_root)
        for item in models:
            item["loaded"] = item["id"] in self._pipelines
        return {
            "ready": self._ready,
            "model": self.model_name,
            "model_id": self.active_model_id,
            "device": self.device,
            "models": models,
            "loaded_models": sorted(self._pipelines.keys()),
        }

    def load(self, model_id: str | None = None) -> None:
        """Load the default (or given) model. Required before serving."""
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        target = get_model_spec(model_id or self.default_model).id
        with self._lock:
            self._ensure_pipeline_locked(target)
            self._active_model = target
            self._ready = True

    def generate(
        self,
        prompt: str,
        visual_type: str,
        preset: str | QualityPreset,
        seed: int,
        model: str | None = None,
        steps: int | None = None,
    ) -> GenerateResult:
        if not self._ready:
            raise RuntimeError("Generator is not ready. Call load() first.")

        model_id = get_model_spec(model or self.default_model).id
        if isinstance(preset, QualityPreset):
            quality = preset
        else:
            quality = get_quality_preset(preset, model_id)
        if steps is not None:
            quality = replace(quality, steps=_validate_steps(steps))
        full_prompt = build_prompt(prompt, visual_type)

        with self._lock:
            return self._generate_locked(full_prompt, quality, seed, model_id)

    def _ensure_pipeline_locked(self, model_id: str) -> Any:
        if model_id in self._pipelines:
            return self._pipelines[model_id]

        if not model_available_on_disk(self.project_root, model_id):
            spec = get_model_spec(model_id)
            path = model_dir(self.project_root, model_id)
            raise FileNotFoundError(
                f"Model '{model_id}' not found at: {path}\n"
                f"Download it first:\n"
                f"  uv run python scripts/download_model.py --model {model_id}"
            )

        path = model_dir(self.project_root, model_id)
        logger.info(
            "Loading Text2ImagePipeline model=%s path=%s device=%s",
            model_id,
            path,
            self.device,
        )
        t0 = time.perf_counter()
        import openvino_genai as ov_genai

        pipeline = ov_genai.Text2ImagePipeline(str(path), self.device)
        elapsed = time.perf_counter() - t0
        self._pipelines[model_id] = pipeline
        logger.info("Model '%s' loaded in %.2fs", model_id, elapsed)
        return pipeline

    def _generate_locked(
        self,
        full_prompt: str,
        quality: QualityPreset,
        seed: int,
        model_id: str,
    ) -> GenerateResult:
        pipeline = self._ensure_pipeline_locked(model_id)
        self._active_model = model_id

        logger.info(
            "Generating model=%s %dx%d steps=%d seed=%d prompt=%r",
            model_id,
            quality.width,
            quality.height,
            quality.steps,
            seed,
            full_prompt[:120],
        )

        t0 = time.perf_counter()
        result = pipeline.generate(
            full_prompt,
            width=quality.width,
            height=quality.height,
            num_inference_steps=quality.steps,
            num_images_per_prompt=1,
            rng_seed=seed,
        )
        elapsed = time.perf_counter() - t0

        image = self._tensor_to_pil(result, quality.width, quality.height)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        filename = (
            f"{model_id}_{stamp}_{quality.steps}steps_{uuid.uuid4().hex[:8]}.png"
        )
        out_path = self.outputs_dir / filename
        image.save(out_path, format="PNG")

        logger.info("Saved %s model=%s (%.2fs)", out_path.name, model_id, elapsed)

        return GenerateResult(
            image_path=out_path,
            relative_url=f"/outputs/{filename}",
            width=quality.width,
            height=quality.height,
            steps=quality.steps,
            seed=seed,
            elapsed=round(elapsed, 2),
            prompt_used=full_prompt,
            model=model_id,
        )

    @staticmethod
    def _tensor_to_pil(result: object, width: int, height: int) -> Image.Image:
        """Convert OpenVINO GenAI ov.Tensor output to a PIL Image."""
        import numpy as np

        arr = np.array(getattr(result, "data", result))

        if arr.ndim == 4:
            arr = arr[0]
        if arr.ndim == 3 and arr.shape[0] in (1, 3) and arr.shape[-1] not in (1, 3):
            arr = arr.transpose(1, 2, 0)

        if arr.dtype != np.uint8:
            if arr.max() <= 1.0:
                arr = (arr * 255.0).clip(0, 255).astype(np.uint8)
            else:
                arr = arr.clip(0, 255).astype(np.uint8)

        if arr.shape[0] != height or arr.shape[1] != width:
            logger.debug("Unexpected image shape %s (expected %dx%d)", arr.shape, height, width)

        return Image.fromarray(arr)


def _validate_steps(steps: int) -> int:
    if isinstance(steps, bool) or not isinstance(steps, int):
        raise ValueError("steps must be an integer")
    if steps < STEPS_MIN or steps > STEPS_MAX:
        raise ValueError(f"steps must be between {STEPS_MIN} and {STEPS_MAX}")
    return steps
