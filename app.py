"""Local Visual Generator — entry point."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from local_visual_generator.generator import ImageGenerator
from local_visual_generator.server import AppContext, run_server


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    logger = logging.getLogger("app")

    project_root = Path(__file__).resolve().parent

    generator = ImageGenerator(project_root=project_root)
    try:
        generator.load()
    except FileNotFoundError as exc:
        logger.error("%s", exc)
        return 1
    except Exception:
        logger.exception("Failed to load model")
        return 1

    ctx = AppContext(project_root=project_root, generator=generator)
    run_server(ctx, host="127.0.0.1", port=7860)
    return 0


if __name__ == "__main__":
    sys.exit(main())
