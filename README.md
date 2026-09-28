# Local Visual Generator

A CPU-first local visual generator optimized for fast, low-detail images.

**Stack:** LCM (Dreamshaper v7 INT8) · OpenVINO GenAI · CPU-first

Fully offline after the model is downloaded. Built for flat illustration, simple anime, icon/logo concepts, and landscapes — not high-fidelity photorealism.

For architecture, constraints, and the validated tech route, see [DESIGN.md](DESIGN.md).

## Why LCM + OpenVINO + CPU-first

| Choice | Why |
|---|---|
| **LCM** | Few-step diffusion → seconds-to-image on modest hardware |
| **OpenVINO GenAI** | Official INT8 pipeline (`Text2ImagePipeline`), small local runtime |
| **CPU-first** | Default and supported path; no GPU required |

On the test machine (Intel Iris Xe), GPU model compile was extremely slow (tens of minutes, incomplete). The CPU path loads and generates normally. That is a measured result on that hardware, not a claim about all Intel GPUs.

## Test hardware

- Intel Core i5-13500H
- 32 GB RAM
- Intel Iris Xe Graphics
- Windows 11
- Python 3.11
- OpenVINO + OpenVINO GenAI
- Models:
  - `OpenVINO/LCM_Dreamshaper_v7-int8-ov`

## Measured benchmarks (CPU, LCM)

| Resolution | Steps | Approx. time |
|---|---|---|
| 128×128 | 2 | ~1.96 s |
| 192×192 | 2 | ~3.94 s |
| 256×256 | 4 | ~5–7 s |
| 384×384 | 2 | ~11 s |
| 512×512 | 2 | ~21 s |

Model load: ~7.2 s

## Requirements

- Python 3.11 (managed by `uv` via `requires-python`)
- [uv](https://github.com/astral-sh/uv)
- ~2GB+ disk for the model
- Enough RAM for the INT8 diffusion pipeline

## Install

```bash
uv sync
```

## Download model

Do this once. The app will **not** auto-download on startup.

```bash
uv run python scripts/download_model.py
```

If the target folder already looks complete, the script skips.
It only writes into that subdirectory and does not touch sibling folders under `models/`.
Use `--force` only to re-download.

Model path:

```text
models/LCM_Dreamshaper_v7-int8-ov
```

## Start

```bash
uv run python app.py
```

Open on this machine:

```text
http://127.0.0.1:7860
```

Or from another device on the same network, use this PC's LAN IP, for example:

```text
http://192.168.x.x:7860
```

The server listens on `0.0.0.0:7860` (all interfaces). Windows Firewall may ask to allow Python the first time.

## Model

| Id | Folder | Notes |
|---|---|---|
| `lcm` | `LCM_Dreamshaper_v7-int8-ov` | LCM Dreamshaper · few steps · low latency |

## Presets

### Mode (default size + steps; both can be overridden in Advanced)

| Mode id | UI label | Default size | Steps |
|---|---|---|---|
| `instant` | Fast | 128×128 | 2 |
| `balanced` | Balanced | 256×256 | 4 |
| `quality` | Quality | 384×384 | 2 |
| `render` | Render | 1024×1024 | 4 |

### Size options

Square: `128×128`, `192×192`, `256×256`, `384×384`, `512×512`, `768×768`, `1024×1024`

Landscape / portrait: `384×256`, `256×384`, `512×384`, `384×512`, `1024×768`, `768×1024`

Larger sizes (especially 768+) are much slower on CPU; use them for testing.

### Visual types

`illustration`, `anime`, `icon`, `logo`, `landscape`, `free`

Types (except `free`) append a short style suffix (composition + visual language).
Presets are kept brief for LCM few-step runs; Icon/Logo emphasize symbol semantics,
Landscape emphasizes spatial layers. Logo/icon modes are **concept** generators, not precise SVG tools.

**Logo-friendly subjects:** animal, bird, rocket, tree, mountain, leaf, star, abstract object.

**Less suitable for Logo:** running person, complex scene, house beside a lake, multiple objects, action-heavy prompts.

Prefer a single simple noun or emblem idea; Logo will not reliably turn busy scenes into brand marks.

### Prompt tips

Prefer short, concrete prompts:

```text
a rocket
a black crow
a small house beside a lake
```

Avoid unnecessary punctuation, list markers, or overly long descriptions when using low-step LCM presets.

## API

### `GET /api/status`

```json
{
  "ready": true,
  "model": "LCM Dreamshaper v7 INT8",
  "model_id": "lcm",
  "device": "CPU",
  "models": [
    {"id": "lcm", "available": true, "loaded": true}
  ]
}
```

### `POST /api/generate`

Request:

```json
{
  "prompt": "a small house beside a lake",
  "type": "illustration",
  "preset": "balanced",
  "model": "lcm",
  "width": 256,
  "height": 256,
  "steps": 4,
  "seed": 42
}
```

`model` is optional (default `lcm`).

`steps` is optional. Omit it to use the preset default. When set, it must be an integer from 1 to 50. The web UI starts from the preset default and lets you change it.

`width` / `height` are optional and must be provided together. Omit them to use the preset default size. When set, the pair must be one of the allowed size options above.

Response:

```json
{
  "success": true,
  "elapsed": 5.42,
  "width": 256,
  "height": 256,
  "steps": 4,
  "seed": 42,
  "model": "lcm",
  "image": "/outputs/....png"
}
```

### `GET /api/gallery`

Lists images under `outputs/` (newest first). Optional query: `offset` (default 0), `limit` (default 24, max 100).

Each item includes `id`, `image` URL, `created_at`, prompt/style/mode fields when a sidecar JSON exists, and `has_metadata`. Images without JSON still appear; unknown fields are `null`. Corrupt sidecars are skipped per image.

New generations also write a same-name `.json` sidecar next to the PNG (`schema_version: 1`) with `input_prompt`, `final_prompt`, `type`, `preset`, `seed`, size, model, device, and elapsed time.

### `POST /api/gallery/delete`

Deletes one image under `outputs/` and its sidecar JSON (if present).

```json
{ "id": "lcm_20260929-011457_4steps_6c8f2269.png" }
```

`id` must be a safe basename ending in an allowed image extension. Path traversal is rejected. Response includes `deleted` filenames.

### `GET /outputs/<filename>`

Serves a generated PNG. Path traversal is rejected.

## Project structure

```text
app.py                          # entry point
local_visual_generator/
  generator.py                  # OpenVINO pipeline + serial generate lock
  history.py                    # PNG sidecar metadata + gallery listing
  presets.py                    # quality presets + prompt templates
  server.py                     # stdlib HTTP server + API
web/
  index.html
  style.css
  app.js
models/                         # model files (gitignored)
outputs/                        # generated images (gitignored)
logs/                           # generation log (gitignored)
scripts/download_model.py
```

## Current limitations

- LCM + OpenVINO + CPU-first only (no alternate model family; GPU not the supported path)
- One generation at a time (global lock)
- Low-detail LCM INT8 output — not a high-quality art pipeline
- No auth, no database, no plugin system
- Logo/icon = visual concepts, not production brand assets
- Model must be downloaded manually before first run
