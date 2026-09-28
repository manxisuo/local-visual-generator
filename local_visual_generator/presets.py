"""Generation presets, models, and visual-type prompt templates."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class QualityPreset:
    name: str
    width: int
    height: int
    steps: int
    description: str


@dataclass(frozen=True)
class ModelSpec:
    """One local OpenVINO text-to-image model."""

    id: str
    dir_name: str
    display_name: str
    hf_repo_id: str
    # Per quality-preset inference steps (resolution comes from QUALITY_PRESETS).
    steps_by_preset: dict[str, int]
    description: str


# Resolution / naming; steps come from the active model preset map.
QUALITY_PRESETS: dict[str, QualityPreset] = {
    "instant": QualityPreset(
        name="instant",
        width=128,
        height=128,
        steps=2,
        description="Fast composition preview",
    ),
    "balanced": QualityPreset(
        name="balanced",
        width=256,
        height=256,
        steps=4,
        description="Default balance of speed and detail",
    ),
    "quality": QualityPreset(
        name="quality",
        width=384,
        height=384,
        steps=2,
        description="Larger resolution, still low latency",
    ),
    "render": QualityPreset(
        name="render",
        width=1024,
        height=1024,
        steps=4,
        description="High-res render; much slower on CPU",
    ),
}

DEFAULT_PRESET = "balanced"

MODELS: dict[str, ModelSpec] = {
    "lcm": ModelSpec(
        id="lcm",
        dir_name="LCM_Dreamshaper_v7-int8-ov",
        display_name="LCM Dreamshaper v7 INT8",
        hf_repo_id="OpenVINO/LCM_Dreamshaper_v7-int8-ov",
        steps_by_preset={
            "instant": 2,
            "balanced": 4,
            "quality": 2,
            "render": 4,
        },
        description="Fast LCM - default for low latency",
    ),
}

DEFAULT_MODEL = "lcm"

# Prompt suffixes that steer toward low-detail, large-block visuals.
VISUAL_TYPE_TEMPLATES: dict[str, str] = {
    "illustration": (
        "minimalist flat illustration, "
        "large simple color blocks, "
        "clean silhouette, "
        "flat colors, "
        "limited color palette, "
        "very low detail, "
        "no texture, "
        "no text, "
        "simple composition"
    ),
    "anime": (
        "minimalist anime illustration, "
        "flat colors, "
        "large simple color blocks, "
        "clean silhouette, "
        "simple cel shading, "
        "limited color palette, "
        "low detail, "
        "no text"
    ),
    "icon": (
        "minimal app icon, "
        "abstract geometric symbol, "
        "flat vector style, "
        "large simple color shapes, "
        "clean silhouette, "
        "very low detail, "
        "no texture, "
        "no text, "
        "limited color palette, "
        "centered composition"
    ),
    "logo": (
        "minimal logo concept, "
        "abstract geometric mark, "
        "flat vector style, "
        "simple shapes, "
        "clean silhouette, "
        "limited color palette, "
        "very low detail, "
        "no texture, "
        "no text, "
        "centered composition, "
        "white or plain background"
    ),
    "landscape": (
        "minimalist landscape illustration, "
        "flat colors, "
        "large color blocks, "
        "simple geometric shapes, "
        "clean silhouettes, "
        "low detail, "
        "no text, "
        "limited color palette"
    ),
    "free": "",
}

DEFAULT_VISUAL_TYPE = "illustration"
DEFAULT_DEVICE = "CPU"

# Backward-compatible aliases used by download script / older references.
MODEL_DIR_NAME = MODELS[DEFAULT_MODEL].dir_name
MODEL_DISPLAY_NAME = MODELS[DEFAULT_MODEL].display_name
HF_MODEL_ID = MODELS[DEFAULT_MODEL].hf_repo_id

# OpenVINO GenAI seed is typically a non-negative int64-compatible value.
SEED_MIN = 0
SEED_MAX = 2**31 - 1

# Optional UI/API override. Preset defaults stay inside this range.
STEPS_MIN = 1
STEPS_MAX = 50

# Whitelisted sizes (multiples of 8; prefer multiples of 64 for UNet alignment).
SIZE_OPTIONS: tuple[tuple[int, int], ...] = (
    (128, 128),
    (192, 192),
    (256, 256),
    (384, 384),
    (512, 512),
    (768, 768),
    (1024, 1024),
    (384, 256),
    (256, 384),
    (512, 384),
    (384, 512),
    (1024, 768),
    (768, 1024),
)
SIZE_OPTION_SET = frozenset(SIZE_OPTIONS)


def get_model_spec(model_id: str) -> ModelSpec:
    key = model_id.strip().lower()
    if key not in MODELS:
        valid = ", ".join(MODELS)
        raise ValueError(f"Unknown model '{model_id}'. Valid: {valid}")
    return MODELS[key]


def model_dir(project_root: Path, model_id: str) -> Path:
    spec = get_model_spec(model_id)
    return (project_root / "models" / spec.dir_name).resolve()


def model_available_on_disk(project_root: Path, model_id: str) -> bool:
    path = model_dir(project_root, model_id)
    if not (path / "model_index.json").is_file():
        return False
    required = ("text_encoder", "unet", "tokenizer", "scheduler")
    if not all((path / name).is_dir() for name in required):
        return False
    # OpenVINO exports may use vae_decoder or a single vae folder.
    return (path / "vae_decoder").is_dir() or (path / "vae").is_dir()


def list_available_models(project_root: Path) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for spec in MODELS.values():
        items.append(
            {
                "id": spec.id,
                "name": spec.display_name,
                "dir": spec.dir_name,
                "available": model_available_on_disk(project_root, spec.id),
                "description": spec.description,
                "steps": dict(spec.steps_by_preset),
            }
        )
    return items


def get_quality_preset(name: str, model_id: str = DEFAULT_MODEL) -> QualityPreset:
    key = name.strip().lower()
    if key not in QUALITY_PRESETS:
        valid = ", ".join(QUALITY_PRESETS)
        raise ValueError(f"Unknown preset '{name}'. Valid: {valid}")
    base = QUALITY_PRESETS[key]
    spec = get_model_spec(model_id)
    if key not in spec.steps_by_preset:
        raise ValueError(f"Preset '{key}' has no step config for model '{spec.id}'")
    return QualityPreset(
        name=base.name,
        width=base.width,
        height=base.height,
        steps=spec.steps_by_preset[key],
        description=base.description,
    )


def resolve_size(width: int, height: int) -> tuple[int, int]:
    if (width, height) not in SIZE_OPTION_SET:
        valid = ", ".join(f"{w}×{h}" for w, h in SIZE_OPTIONS)
        raise ValueError(f"Unsupported size '{width}x{height}'. Valid: {valid}")
    return width, height


def get_visual_type_suffix(visual_type: str) -> str:
    key = visual_type.strip().lower()
    if key not in VISUAL_TYPE_TEMPLATES:
        valid = ", ".join(VISUAL_TYPE_TEMPLATES)
        raise ValueError(f"Unknown type '{visual_type}'. Valid: {valid}")
    return VISUAL_TYPE_TEMPLATES[key]


def build_prompt(user_prompt: str, visual_type: str) -> str:
    prompt = user_prompt.strip()
    suffix = get_visual_type_suffix(visual_type)
    if not suffix:
        return prompt
    return f"{prompt}, {suffix}"
