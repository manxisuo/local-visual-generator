# Design Notes

Durable design context for Local Visual Generator.
Read this before changing architecture, dependencies, or inference behavior.

## Positioning

> A CPU-first local visual generator optimized for fast, low-detail images.

**Formal stack (do not treat as interchangeable):**

| Pillar | Choice |
|---|---|
| Model | **LCM** — `OpenVINO/LCM_Dreamshaper_v7-int8-ov` (`lcm`) |
| Inference | **OpenVINO** + OpenVINO GenAI `Text2ImagePipeline` |
| Device | **CPU-first** — CPU is the default and supported path |

This product is defined by that trio. Changing model family, inference backend, or default device is an architectural decision, not a casual tweak.

## Product goal

Local, low-latency, low-detail image concepts — not a high-quality art studio.

Optimize for:

- Fully offline after the LCM model is downloaded
- CPU-first inference on modest PCs
- Short time-to-image via LCM few-step diffusion (seconds, not minutes)
- Flat / minimalist / large color-block visuals
- Small dependency surface (OpenVINO GenAI + Pillow + stdlib HTTP)
- Simple HTTP API usable by other local programs

Do **not** optimize for:

- Photorealism
- Maximum fidelity
- Cloud APIs
- Plugin marketplaces
- Multi-user SaaS features

Primary use cases: flat illustration, simple anime, icon concept, logo concept, landscape concept, free prompt.
Logo/icon modes produce **visual concepts**, not production SVG brand assets.
Logo works best with a single simple subject; action scenes and multi-object prompts are a poor fit — prefer product guidance over further prompt stacking.

## Validated tech route (do not reopen casually)

Already validated on the target machine. Prefer extending this path over replacing it.

| Layer | Choice |
|---|---|
| Runtime | Python 3.11 (`requires-python = ">=3.11,<3.12"`), managed with `uv` |
| Model | LCM Dreamshaper v7 INT8 (`lcm`) only |
| Inference | OpenVINO + OpenVINO GenAI `Text2ImagePipeline` |
| Device | **CPU-first** (CPU default; GPU not the supported path) |
| Imaging | Pillow |
| HTTP | stdlib `http.server.ThreadingHTTPServer` + `BaseHTTPRequestHandler` |
| UI | Static HTML / CSS / Vanilla JS served by the same process |
| Packaging | `pyproject.toml` + local package `local_visual_generator` |

### Explicit non-goals / do not introduce without strong reason

- FastAPI / Flask / Django
- React / Vue / Node.js frontend toolchain
- PyTorch / CUDA / ComfyUI
- Databases, ORMs, user accounts, auth systems
- Auto-download of multi-GB models on `app.py` startup
- Complex plugin frameworks or heavy abstraction layers

## Why LCM + OpenVINO + CPU-first

- **LCM:** few inference steps → acceptable latency for low-detail concepts on CPU
- **OpenVINO GenAI:** ready INT8 OV model + `Text2ImagePipeline`; avoids a PyTorch/CUDA stack
- **CPU-first:** on the test hardware (Intel Iris Xe), **GPU model compile was abnormally slow** (tens of minutes, incomplete in practice). CPU load and generate work normally

That GPU result is measured on that machine, not a claim about all Intel GPUs. Do not switch the default device to GPU unless compile + generate are re-validated end-to-end. Do not add alternate model families (e.g. SD 1.5) without an explicit product decision.

## Architecture

```text
app.py
  -> ImageGenerator.load(default model)
  -> ThreadingHTTPServer

POST /api/generate
  -> validate JSON
  -> ImageGenerator.generate(...)   # global lock
  -> save PNG + JSON sidecar under outputs/
  -> return JSON + /outputs/<file>

GET /api/gallery
  -> scan outputs/ (safe basenames only)
  -> return newest-first page of image + metadata summaries
```

Module responsibilities:

| File | Responsibility |
|---|---|
| `app.py` | Thin entrypoint only |
| `generator.py` | Pipeline lifecycle, model cache, serial `generate()` |
| `history.py` | Output sidecar metadata + gallery listing |
| `presets.py` | Models, quality presets, visual-type prompt templates |
| `server.py` | HTTP routes, static files, JSON API, path-safety |
| `web/*` | Browser UI |
| `scripts/download_model.py` | Manual model download into `models/<dir>` only |

Keep the structure **small and clear**. Avoid stuffing everything into one giant `app.py`, and avoid inventing unused layers.

## Model lifecycle

1. Startup loads the LCM model (`lcm`).
2. The pipeline is **cached in process memory** after first load.
3. **Never** construct a new `Text2ImagePipeline` for every HTTP request.

Generation is always under one `threading.Lock`:

- Workload is CPU-bound diffusion
- Parallel jobs mostly fight for CPU/RAM and increase latency
- `ThreadingHTTPServer` may accept concurrent connections, but `generate()` must stay serial

## Model

Configured in `presets.py` (`MODELS`):

| Id | Directory | Role |
|---|---|---|
| `lcm` | `models/LCM_Dreamshaper_v7-int8-ov` | LCM Dreamshaper, few steps, low latency |

Quality presets supply default size + steps; the UI/API can override size from a whitelist and steps within 1–50.

Seed uses OpenVINO GenAI `rng_seed=...`. The API/UI must return the **actual seed used** so results can be reproduced.

## Download / models directory safety

- Models are gitignored; only `models/.gitkeep` is tracked.
- `scripts/download_model.py` must write **only** into `models/<chosen-dir>`.
- It must **not** delete, move, or rewrite sibling model folders.
- If a model already looks complete, skip unless `--force`.
- App startup must fail clearly when the requested model is missing, with download instructions.

## API / UI constraints

- JSON UTF-8
- Empty prompt → 400
- Invalid `type` / `preset` / `model` / `seed` / `steps` / `width`+`height` → 400
- `steps` is optional (1–500). Omit it to use the model’s quality-preset default
- `width`/`height` are optional (must be a pair from `SIZE_OPTIONS`). Omit them to use the quality-preset size
- `/outputs/<filename>` must reject path traversal
- UI primary path: prompt, style, mode, generate — size / steps / seed live under collapsed Advanced
- While Advanced is collapsed, Mode owns size/steps (switching Mode always rewrites them). While Advanced is open, Mode is disabled and size/steps are authoritative; collapsing Advanced resets size/steps to the current Mode defaults

## Change guidelines for future sessions

Before adding a feature, ask:

1. Does it improve local latency, simplicity, or API usefulness?
2. Can it be done without new major dependencies?
3. Does it preserve one-load / serial-generate semantics?

Good follow-ups (when needed): negative prompt, guidance scale exposure, gallery thumbnails/cache, CLI client.

Avoid unless explicitly requested: non-LCM model families, GPU default flip, cloud backends, auth, DB, frontend frameworks, ComfyUI / PyTorch stacks, large refactors for abstraction.
