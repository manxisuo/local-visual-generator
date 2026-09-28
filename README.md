# Local Visual Generator

Lightweight, fully local AI image generator for low-power PCs.

It targets fast, low-detail visuals (flat illustration, simple anime, icon/logo concepts, landscapes) using OpenVINO GenAI on **CPU**. It does not aim for high-fidelity photorealism.

For architecture, constraints, and the validated tech route, see [DESIGN.md](DESIGN.md).

## Why CPU-first

On the test machine (Intel Iris Xe + OpenVINO GenAI `Text2ImagePipeline`), GPU model compile was extremely slow (tens of minutes, incomplete). The CPU path loads and generates normally.

This is based on measured results on that hardware. It does not mean all Intel GPUs behave the same.

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

Open:

```text
http://127.0.0.1:7860
```

## Model

| Id | Folder | Notes |
|---|---|---|
| `lcm` | `LCM_Dreamshaper_v7-int8-ov` | LCM Dreamshaper · few steps · low latency |

## Presets

### Quality (default size + steps; both can be overridden)

| Preset | Default size | Steps |
|---|---|---|
| `instant` | 128×128 | 2 |
| `balanced` | 256×256 | 4 |
| `quality` | 384×384 | 2 |

### Size options

Square: `128×128`, `192×192`, `256×256`, `384×384`, `512×512`, `768×768`, `1024×1024`

Landscape / portrait: `384×256`, `256×384`, `512×384`, `384×512`, `1024×768`, `768×1024`

Larger sizes (especially 768+) are much slower on CPU; use them for testing.

### Visual types

`illustration`, `anime`, `icon`, `logo`, `landscape`, `free`

Types (except `free`) append a prompt template that favors large color blocks, flat style, and low detail. Logo/icon modes are **concept** generators, not precise SVG logo tools.

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

`steps` is optional. Omit it to use the preset default. When set, it must be an integer from 1 to 500. The web UI starts from the preset default and lets you change it.

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

### `GET /outputs/<filename>`

Serves a generated PNG. Path traversal is rejected.

## Project structure

```text
app.py                          # entry point
local_visual_generator/
  generator.py                  # OpenVINO pipeline + serial generate lock
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

- CPU only (GPU compile path not used)
- One generation at a time (global lock)
- Low-detail LCM INT8 output — not a high-quality art pipeline
- No auth, no database, no plugin system
- Logo/icon = visual concepts, not production brand assets
- Model must be downloaded manually before first run
