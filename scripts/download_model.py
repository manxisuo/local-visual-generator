"""Download OpenVINO text-to-image models into models/<dir>.

Only writes into the chosen model subdirectory. Never deletes or touches
sibling model directories. Skips download when the target already looks complete.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

from source.presets import (
    DEFAULT_MODEL,
    MODELS,
    model_available_on_disk,
)


def _download_one(project_root: Path, model_id: str, force: bool) -> int:
    spec = MODELS[model_id]
    models_root = project_root / "models"
    target = models_root / spec.dir_name
    models_root.mkdir(parents=True, exist_ok=True)

    if model_available_on_disk(project_root, model_id) and not force:
        print(f"[{model_id}] already present at: {target}")
        print("Skipping. Pass --force to re-download into this folder only.")
        return 0

    target.mkdir(parents=True, exist_ok=True)
    print(f"[{model_id}] Downloading {spec.hf_repo_id}")
    print(f"[{model_id}] Destination: {target}")
    print("Only this directory will be written. Sibling models/ folders are left alone.")
    print("This may take a while (~2GB+)...")

    snapshot_download(
        repo_id=spec.hf_repo_id,
        local_dir=str(target),
    )

    if not model_available_on_disk(project_root, model_id):
        print(f"[{model_id}] Download finished but model still looks incomplete.", file=sys.stderr)
        return 1

    print(f"[{model_id}] Done: {target}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Download OpenVINO GenAI models")
    parser.add_argument(
        "--model",
        choices=[*MODELS.keys(), "all"],
        default=DEFAULT_MODEL,
        help=f"Model id to download (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download even if the target directory already looks complete",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    model_ids = list(MODELS.keys()) if args.model == "all" else [args.model]

    print("Sibling directories under models/ are never modified by this script.")
    rc = 0
    for model_id in model_ids:
        result = _download_one(project_root, model_id, args.force)
        if result != 0:
            rc = result

    if rc == 0:
        print("Start the app with: uv run python app.py")
    return rc


if __name__ == "__main__":
    sys.exit(main())
