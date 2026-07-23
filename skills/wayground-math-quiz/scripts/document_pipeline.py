#!/usr/bin/env python3
"""Document rendering and crop helpers for wayground-math-quiz.

The Node CLI is the public entrypoint. This helper keeps PDF rendering and
image operations in a small, dependency-light Python process.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from typing import Any

try:
    from PIL import Image, ImageChops, ImageOps
except ImportError as exc:  # pragma: no cover - reported by doctor in normal use
    raise SystemExit("Pillow is required. Install it with: python -m pip install Pillow") from exc


SCHEMA_VERSION = "1.0.0"


class PipelineError(RuntimeError):
    pass


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as exc:
        raise PipelineError(f"File not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise PipelineError(f"Invalid JSON in {path}: {exc}") from exc


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def find_executable(explicit: str | None, names: list[str]) -> str | None:
    if explicit:
        candidate = Path(explicit).expanduser()
        if candidate.exists():
            return str(candidate.resolve())
        located = shutil.which(explicit)
        if located:
            return located
        return None
    for name in names:
        located = shutil.which(name)
        if located:
            return located
    return None


def resolve_pdftoppm(explicit: str | None) -> str | None:
    """Prefer the real executable when a managed runtime exposes a .cmd shim."""

    located = find_executable(explicit, ["pdftoppm"])
    if not located or os.name != "nt":
        return located
    located_path = Path(located).resolve()
    if located_path.suffix.lower() not in {".cmd", ".bat"}:
        return str(located_path)
    for parent in [located_path.parent, *located_path.parents]:
        candidates = [
            parent / "Library" / "bin" / "pdftoppm.exe",
            parent / "native" / "poppler" / "Library" / "bin" / "pdftoppm.exe",
        ]
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate.resolve())
    return str(located_path)


def run_process(command: list[str], label: str) -> subprocess.CompletedProcess[str]:
    executable = Path(command[0])
    is_batch = os.name == "nt" and executable.suffix.lower() in {".cmd", ".bat"}
    try:
        if is_batch:
            result = subprocess.run(
                subprocess.list2cmdline(command),
                shell=True,
                text=True,
                capture_output=True,
                check=False,
            )
        else:
            result = subprocess.run(
                command,
                text=True,
                capture_output=True,
                check=False,
            )
    except OSError as exc:
        raise PipelineError(f"Unable to run {label}: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise PipelineError(
            f"{label} failed with exit code {result.returncode}"
            + (f": {detail}" if detail else "")
        )
    return result


def ensure_inside(root: Path, candidate: Path) -> Path:
    root_resolved = root.resolve()
    candidate_resolved = candidate.resolve()
    try:
        candidate_resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise PipelineError(f"Output escapes the job directory: {candidate}") from exc
    return candidate_resolved


def convert_word_to_pdf(
    source: Path,
    destination: Path,
    word_helper: Path,
    office_command: str | None,
) -> str:
    soffice = find_executable(office_command, ["soffice", "libreoffice"])
    if soffice:
        with tempfile.TemporaryDirectory(prefix="wayground-office-") as temp_name:
            temp_dir = Path(temp_name)
            run_process(
                [
                    soffice,
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(temp_dir),
                    str(source),
                ],
                "LibreOffice conversion",
            )
            generated = temp_dir / f"{source.stem}.pdf"
            if not generated.exists():
                candidates = list(temp_dir.glob("*.pdf"))
                if len(candidates) == 1:
                    generated = candidates[0]
                else:
                    raise PipelineError("LibreOffice did not produce the expected PDF")
            shutil.copy2(generated, destination)
        return "libreoffice"

    if os.name == "nt":
        powershell = find_executable(None, ["pwsh", "powershell"])
        if not powershell:
            raise PipelineError("PowerShell was not found for Microsoft Word conversion")
        if not word_helper.exists():
            raise PipelineError(f"Word conversion helper not found: {word_helper}")
        run_process(
            [
                powershell,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(word_helper),
                "-InputPath",
                str(source),
                "-OutputPath",
                str(destination),
            ],
            "Microsoft Word conversion",
        )
        if not destination.exists():
            raise PipelineError("Microsoft Word did not produce the expected PDF")
        return "microsoft-word"

    raise PipelineError(
        "DOC/DOCX conversion needs LibreOffice, or Microsoft Word on Windows"
    )


def normalize_to_pdf(
    source: Path,
    destination: Path,
    word_helper: Path,
    office_command: str | None,
) -> str:
    extension = source.suffix.lower()
    if extension == ".pdf":
        if source.resolve() != destination.resolve():
            shutil.copy2(source, destination)
        return "source-pdf"
    if extension in {".doc", ".docx"}:
        return convert_word_to_pdf(source, destination, word_helper, office_command)
    raise PipelineError("Input must be PDF, DOC, or DOCX")


def render_pdf(
    source_pdf: Path,
    pages_dir: Path,
    dpi: int,
    pdftoppm_command: str | None,
) -> list[dict[str, Any]]:
    executable = resolve_pdftoppm(pdftoppm_command)
    if not executable:
        raise PipelineError("pdftoppm was not found. Install Poppler or pass --pdftoppm.")

    pages_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".render-", dir=str(pages_dir.parent)) as temp_name:
        temp_dir = Path(temp_name)
        prefix = temp_dir / "page"
        run_process(
            [
                executable,
                "-png",
                "-r",
                str(dpi),
                str(source_pdf),
                str(prefix),
            ],
            "PDF page rendering",
        )
        rendered = sorted(
            temp_dir.glob("page-*.png"),
            key=lambda path: int(path.stem.rsplit("-", 1)[1]),
        )
        if not rendered:
            raise PipelineError("pdftoppm produced no page images")

        pages: list[dict[str, Any]] = []
        for index, generated in enumerate(rendered, start=1):
            destination = pages_dir / f"page-{index:03d}.png"
            shutil.copy2(generated, destination)
            with Image.open(destination) as image:
                width, height = image.size
            pages.append(
                {
                    "page": index,
                    "image": destination.relative_to(pages_dir.parent).as_posix(),
                    "width": width,
                    "height": height,
                    "sha256": sha256_file(destination),
                }
            )
    return pages


def ingest(args: argparse.Namespace) -> dict[str, Any]:
    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        raise PipelineError(f"Input file not found: {source}")
    job = Path(args.out).expanduser().resolve()
    normalized_dir = job / "normalized"
    pages_dir = job / "pages"
    normalized_pdf = normalized_dir / "source.pdf"
    manifest_path = job / "source.json"

    generated_targets = [normalized_pdf, manifest_path, *pages_dir.glob("page-*.png")]
    existing = [path for path in generated_targets if path.exists()]
    if existing and not args.force:
        raise PipelineError(
            f"Generated output already exists ({existing[0]}). Use --force to replace it."
        )
    if args.force:
        for path in generated_targets:
            if path.is_file():
                path.unlink()

    normalized_dir.mkdir(parents=True, exist_ok=True)
    pages_dir.mkdir(parents=True, exist_ok=True)
    backend = normalize_to_pdf(
        source,
        normalized_pdf,
        Path(args.word_helper).expanduser().resolve(),
        args.office,
    )
    pages = render_pdf(normalized_pdf, pages_dir, args.dpi, args.pdftoppm)
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "id": "source",
        "originalInput": str(source),
        "originalName": source.name,
        "originalSha256": sha256_file(source),
        "normalizedPdf": normalized_pdf.relative_to(job).as_posix(),
        "normalizedPdfSha256": sha256_file(normalized_pdf),
        "conversionBackend": backend,
        "dpi": args.dpi,
        "pageCount": len(pages),
        "pages": pages,
    }
    write_json(manifest_path, manifest)
    return manifest


def bbox_to_pixels(
    bbox: dict[str, Any],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    try:
        unit = bbox.get("unit", "ratio")
        x = float(bbox["x"])
        y = float(bbox["y"])
        box_width = float(bbox["width"])
        box_height = float(bbox["height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise PipelineError(f"Invalid bbox: {bbox}") from exc

    if unit == "ratio":
        values = [x, y, box_width, box_height]
        if any(value < 0 or value > 1 for value in values):
            raise PipelineError(f"Ratio bbox values must be between 0 and 1: {bbox}")
        left = round(x * width)
        top = round(y * height)
        right = round((x + box_width) * width)
        bottom = round((y + box_height) * height)
    elif unit == "pixel":
        left = round(x)
        top = round(y)
        right = round(x + box_width)
        bottom = round(y + box_height)
    else:
        raise PipelineError(f"Unsupported bbox unit: {unit}")

    left = max(0, min(width, left))
    top = max(0, min(height, top))
    right = max(0, min(width, right))
    bottom = max(0, min(height, bottom))
    if right <= left or bottom <= top:
        raise PipelineError(f"Crop bbox has no area after clamping: {bbox}")
    return left, top, right, bottom


def trim_white_space(image: Image.Image, threshold: int = 245) -> Image.Image:
    rgb = image.convert("RGB")
    background = Image.new("RGB", rgb.size, (255, 255, 255))
    difference = ImageChops.difference(rgb, background).convert("L")
    mask = difference.point(lambda pixel: 255 if pixel > (255 - threshold) else 0)
    content_bbox = mask.getbbox()
    return rgb.crop(content_bbox) if content_bbox else rgb


def crop_questions(args: argparse.Namespace) -> dict[str, Any]:
    job = Path(args.job).expanduser().resolve()
    plan_path = Path(args.plan).expanduser().resolve() if args.plan else job / "crop-plan.json"
    plan = read_json(plan_path)
    manifest_relative = plan.get("sourceManifest", "source.json")
    manifest_path = ensure_inside(job, job / manifest_relative)
    manifest = read_json(manifest_path)
    pages = {int(item["page"]): item for item in manifest.get("pages", [])}
    crops = plan.get("crops")
    if not isinstance(crops, list) or not crops:
        raise PipelineError("crop-plan.json must contain at least one crop")

    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, crop in enumerate(crops, start=1):
        crop_id = str(crop.get("id", f"q{index:03d}")).strip()
        if not crop_id:
            raise PipelineError(f"Crop #{index} has an empty id")
        if crop_id in seen_ids:
            raise PipelineError(f"Duplicate crop id: {crop_id}")
        seen_ids.add(crop_id)

        try:
            page_number = int(crop["page"])
        except (KeyError, TypeError, ValueError) as exc:
            raise PipelineError(f"Crop {crop_id} has an invalid page") from exc
        page = pages.get(page_number)
        if not page:
            raise PipelineError(f"Crop {crop_id} references missing page {page_number}")
        page_image = ensure_inside(job, job / page["image"])
        if not page_image.is_file():
            raise PipelineError(f"Rendered page image not found: {page_image}")

        output_relative = crop.get("output", f"assets/{crop_id}.png")
        output_path = ensure_inside(job, job / output_relative)
        if output_path.exists() and not args.force:
            raise PipelineError(
                f"Crop output already exists ({output_path}). Use --force to replace it."
            )
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with Image.open(page_image) as source_image:
            source_image = ImageOps.exif_transpose(source_image).convert("RGB")
            pixel_bbox = bbox_to_pixels(crop.get("bbox", {}), *source_image.size)
            result_image = source_image.crop(pixel_bbox)
            if crop.get("trimWhitespace", False):
                result_image = trim_white_space(result_image)
            padding = int(crop.get("padding", 0))
            if padding < 0 or padding > 500:
                raise PipelineError(f"Crop {crop_id} has invalid padding: {padding}")
            if padding:
                result_image = ImageOps.expand(
                    result_image,
                    border=padding,
                    fill=(255, 255, 255),
                )
            suffix = output_path.suffix.lower()
            if suffix in {".jpg", ".jpeg"}:
                result_image.save(output_path, quality=95, optimize=True)
            elif suffix == ".webp":
                result_image.save(output_path, quality=95, method=6)
            else:
                if suffix != ".png":
                    output_path = output_path.with_suffix(".png")
                    output_relative = output_path.relative_to(job).as_posix()
                result_image.save(output_path, optimize=True)
            output_width, output_height = result_image.size

        results.append(
            {
                "id": crop_id,
                "page": page_number,
                "sourceImage": page_image.relative_to(job).as_posix(),
                "sourceBbox": crop.get("bbox", {}),
                "pixelBbox": {
                    "left": pixel_bbox[0],
                    "top": pixel_bbox[1],
                    "right": pixel_bbox[2],
                    "bottom": pixel_bbox[3],
                },
                "output": output_path.relative_to(job).as_posix(),
                "width": output_width,
                "height": output_height,
                "sha256": sha256_file(output_path),
                "metadata": {
                    key: value
                    for key, value in crop.items()
                    if key not in {"bbox", "page", "output"}
                },
            }
        )

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceManifest": manifest_path.relative_to(job).as_posix(),
        "plan": plan_path.relative_to(job).as_posix()
        if plan_path.is_relative_to(job)
        else str(plan_path),
        "count": len(results),
        "crops": results,
    }
    report_path = job / "crop-results.json"
    write_json(report_path, report)
    return report


def doctor(args: argparse.Namespace) -> dict[str, Any]:
    pdftoppm = resolve_pdftoppm(args.pdftoppm)
    office = find_executable(args.office, ["soffice", "libreoffice"])
    powershell = find_executable(None, ["pwsh", "powershell"])
    word_helper = Path(args.word_helper).expanduser().resolve()
    word_possible = os.name == "nt" and powershell is not None and word_helper.is_file()
    result = {
        "python": {
            "ok": True,
            "version": platform.python_version(),
            "executable": sys.executable,
        },
        "pillow": {
            "ok": True,
            "version": getattr(Image, "__version__", "unknown"),
        },
        "pdftoppm": {
            "ok": pdftoppm is not None,
            "path": pdftoppm or "",
        },
        "wordConversion": {
            "ok": office is not None or word_possible,
            "libreOffice": office or "",
            "microsoftWordFallbackAvailable": word_possible,
            "powerShell": powershell or "",
        },
    }
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Wayground document pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor_parser = subparsers.add_parser("doctor")
    doctor_parser.add_argument("--pdftoppm")
    doctor_parser.add_argument("--office")
    doctor_parser.add_argument("--word-helper", required=True)

    ingest_parser = subparsers.add_parser("ingest")
    ingest_parser.add_argument("--input", required=True)
    ingest_parser.add_argument("--out", required=True)
    ingest_parser.add_argument("--dpi", type=int, default=220)
    ingest_parser.add_argument("--pdftoppm")
    ingest_parser.add_argument("--office")
    ingest_parser.add_argument("--word-helper", required=True)
    ingest_parser.add_argument("--force", action="store_true")

    crop_parser = subparsers.add_parser("crop")
    crop_parser.add_argument("--job", required=True)
    crop_parser.add_argument("--plan")
    crop_parser.add_argument("--force", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "doctor":
            result = doctor(args)
        elif args.command == "ingest":
            if args.dpi < 72 or args.dpi > 600:
                raise PipelineError("--dpi must be between 72 and 600")
            result = ingest(args)
        elif args.command == "crop":
            result = crop_questions(args)
        else:  # pragma: no cover
            parser.error(f"Unknown command: {args.command}")
            return 2
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except PipelineError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
