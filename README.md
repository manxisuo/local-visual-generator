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
  - `OpenVINO/LCM_Dreamshaper_v7-int8-ov` (default, fast)
  - `OpenVINO/stable-diffusion-v1-5-int8-ov` (optional, slower / more steps)

## Measured benchmarks (CPU, LCM)

| Resolution | Steps | Approx. time |
|---|---|---|
| 128×128 | 2 | ~1.96 s |
| 192×192 | 2 | ~3.94 s |
| 256×256 | 4 | ~5–7 s |
| 384×384 | 2 | ~11 s |
| 512×512 | 2 | ~21 s |

Model load: ~7.2 s

SD 1.5 uses more steps at the same resolutions and is noticeably slower on CPU.

## Requirements

- Python 3.11 (managed by `uv` via `requires-python`)
- [uv](https://github.com/astral-sh/uv)
- ~2GB+ disk per model
- Enough RAM for the INT8 diffusion pipeline (both models can stay cached after first use)

## Install

```bash
uv sync
```

## Download model

Do this once per model. The app will **not** auto-download on startup.

```bash
uv run python scripts/download_model.py --model lcm
uv run python scripts/download_model.py --model sd15
# or: uv run python scripts/download_model.py --model all
```

If the target folder already looks complete, the script skips.
It only writes into that subdirectory and does not touch sibling folders under `models/`.
Use `--force` only to re-download the selected model.

Model paths:

```text
models/LCM_Dreamshaper_v7-int8-ov
models/stable-diffusion-v1-5-int8-ov
```

## Start

```bash
uv run python app.py
```

Open:

```text
http://127.0.0.1:7860
```

## Models

| Id | Folder | Notes |
|---|---|---|
| `lcm` | `LCM_Dreamshaper_v7-int8-ov` | Default · few steps · low latency |
| `sd15` | `stable-diffusion-v1-5-int8-ov` | Classic SD · more steps · slower on CPU |

Startup loads only the default model (`lcm`). The other model is loaded on first use and then cached in memory. Generation remains serial.

## Presets

### Quality (resolution shared; steps depend on model)

| Preset | Size | LCM steps | SD 1.5 steps |
|---|---|---|---|
| `instant` | 128×128 | 2 | 8 |
| `balanced` | 256×256 | 4 | 16 |
| `quality` | 384×384 | 2 | 20 |

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
    {"id": "lcm", "available": true, "loaded": true},
    {"id": "sd15", "available": true, "loaded": false}
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
  "steps": 4,
  "seed": 42
}
```

`model` is optional (default `lcm`). Use `"sd15"` for Stable Diffusion 1.5.

`steps` is optional. Omit it to use the preset default for that model. When set, it must be an integer from 1 to 500. The web UI starts from the preset default and lets you change it.

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
source/
  generator.py                  # OpenVINO pipeline + serial generate lock
  presets.py                    # quality presets + prompt templates
  server.py                     # stdlib HTTP server + API
web/
  index.html
  style.css
  app.js
models/                         # model files (gitignored)
outputs/                        # generated images (gitignored)
scripts/download_model.py
```

## Current limitations

- CPU only (GPU compile path not used)
- One generation at a time (global lock)
- Low-detail LCM INT8 output — not a high-quality art pipeline
- No auth, no database, no plugin system
- Logo/icon = visual concepts, not production brand assets
- Model must be downloaded manually before first run
