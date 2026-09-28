# Design Notes

Durable design context for Local Visual Generator.
Read this before changing architecture, dependencies, or inference behavior.

## Product goal

This is a **local, low-latency, low-detail** image concept tool — not a high-quality art studio.

Optimize for:

- Fully offline after models are downloaded
- CPU-first inference on modest PCs
- Short time-to-image (seconds, not minutes)
- Flat / minimalist / large color-block visuals
- Small dependency surface
- Simple HTTP API usable by other local programs

Do **not** optimize for:

- Photorealism
- Maximum fidelity
- Cloud APIs
- Plugin marketplaces
- Multi-user SaaS features

Primary use cases: flat illustration, simple anime, icon concept, logo concept, landscape concept, free prompt.
Logo/icon modes produce **visual concepts**, not production SVG brand assets.

## Validated tech route (do not reopen casually)

Already validated on the target machine. Prefer extending this path over replacing it.

| Layer | Choice |
|---|---|
| Runtime | Python 3.11 (`requires-python = ">=3.11,<3.12"`), managed with `uv` |
| Inference | OpenVINO + OpenVINO GenAI `Text2ImagePipeline` |
| Device | **CPU only** by default |
| Imaging | Pillow |
| HTTP | stdlib `http.server.ThreadingHTTPServer` + `BaseHTTPRequestHandler` |
| UI | Static HTML / CSS / Vanilla JS served by the same process |
| Packaging | `pyproject.toml` + local package `source` |

### Explicit non-goals / do not introduce without strong reason

- FastAPI / Flask / Django
- React / Vue / Node.js frontend toolchain
- PyTorch / CUDA / ComfyUI
- Databases, ORMs, user accounts, auth systems
- Auto-download of multi-GB models on `app.py` startup
- Complex plugin frameworks or heavy abstraction layers

## Why CPU-first

On the test hardware (Intel Iris Xe + OpenVINO GenAI diffusion pipeline), **GPU model compile was abnormally slow** (tens of minutes, incomplete in practice). CPU load and generate work normally.

This is a measured result on that machine, not a claim about all Intel GPUs. Do not switch the default device to GPU unless compile + generate are re-validated end-to-end.

## Architecture

```text
app.py
  -> ImageGenerator.load(default model)
  -> ThreadingHTTPServer

POST /api/generate
  -> validate JSON
  -> ImageGenerator.generate(...)   # global lock
  -> save PNG under outputs/
  -> return JSON + /outputs/<file>
```

Module responsibilities:

| File | Responsibility |
|---|---|
| `app.py` | Thin entrypoint only |
| `generator.py` | Pipeline lifecycle, model cache, serial `generate()` |
| `presets.py` | Models, quality presets, visual-type prompt templates |
| `server.py` | HTTP routes, static files, JSON API, path-safety |
| `web/*` | Browser UI |
| `scripts/download_model.py` | Manual model download into `models/<dir>` only |

Keep the structure **small and clear**. Avoid stuffing everything into one giant `app.py`, and avoid inventing unused layers.

## Model lifecycle

1. Startup loads **only the default model** (`lcm`).
2. Pipelines are **cached in process memory** after first load.
3. Switching to another installed model (e.g. `sd15`) loads it on first use, then reuses the cached pipeline.
4. **Never** construct a new `Text2ImagePipeline` for every HTTP request.

Generation is always under one `threading.Lock`:

- Workload is CPU-bound diffusion
- Parallel jobs mostly fight for CPU/RAM and increase latency
- `ThreadingHTTPServer` may accept concurrent connections, but `generate()` must stay serial

## Models

Configured in `presets.py` (`MODELS`):

| Id | Directory | Role |
|---|---|---|
| `lcm` | `models/LCM_Dreamshaper_v7-int8-ov` | Default, few steps, low latency |
| `sd15` | `models/stable-diffusion-v1-5-int8-ov` | Optional, more steps, slower on CPU |

Resolution presets are shared; **steps are per-model** because LCM and classic SD need different step counts.
Quality presets still supply default size + steps; the UI/API can override size from a whitelist and steps within 1–500.

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
- UI is a single simple page: prompt, model, type, quality, size, steps, seed, generate, result meta

## Change guidelines for future sessions

Before adding a feature, ask:

1. Does it improve local latency, simplicity, or API usefulness?
2. Can it be done without new major dependencies?
3. Does it preserve one-load / serial-generate semantics?

Good follow-ups (when needed): negative prompt, guidance scale exposure, output history list, CLI client, optional unload of unused cached models to save RAM.

Avoid unless explicitly requested: GPU default flip, cloud backends, auth, DB, frontend frameworks, ComfyUI integration, large refactors for abstraction.
