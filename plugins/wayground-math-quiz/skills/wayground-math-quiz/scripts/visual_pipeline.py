#!/usr/bin/env python3
"""Deterministic visual-question compositor and validator."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


VISUAL_SCHEMA_VERSION = "1.0.0"
ALLOWED_MODES = {"deterministic", "source-crop", "ai-composite"}
ALLOWED_LAYERS = {
    "rect",
    "line",
    "circle",
    "ellipse",
    "polygon",
    "image",
    "text",
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as error:
        raise ValueError(f"File not found: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON {path}: {error}") from error


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_resolve(root: Path, candidate: str) -> Path:
    if not isinstance(candidate, str) or not candidate.strip():
        raise ValueError("Asset path must be a non-empty string")
    path = Path(candidate)
    if path.is_absolute():
        raise ValueError(f"Asset path must be relative: {candidate}")
    root = root.resolve()
    target = (root / path).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError(f"Asset path escapes the visual job: {candidate}") from error
    return target


def rgba(value: Any, default: str = "#000000") -> tuple[int, int, int, int]:
    if value in (None, ""):
        value = default
    try:
        return ImageColor.getcolor(str(value), "RGBA")
    except ValueError as error:
        raise ValueError(f"Invalid color: {value}") from error


def font_candidates(weight: str) -> list[Path]:
    bold = str(weight).lower() in {"bold", "600", "700", "800", "900"}
    system = platform.system().lower()
    if system == "windows":
        names = ["msjhbd.ttc", "msjh.ttc", "arialbd.ttf", "arial.ttf"]
        if not bold:
            names = ["msjh.ttc", "msjhbd.ttc", "arial.ttf", "arialbd.ttf"]
        return [Path(os.environ.get("WINDIR", "C:\\Windows")) / "Fonts" / name for name in names]
    if system == "darwin":
        return [
            Path("/System/Library/Fonts/PingFang.ttc"),
            Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        ]
    names = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    return [Path(name) for name in names]


def load_font(spec_dir: Path, layer: dict[str, Any]) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    size = max(8, int(layer.get("fontSize", 42)))
    explicit = layer.get("font")
    candidates: list[Path] = []
    if explicit:
        candidates.append(safe_resolve(spec_dir, str(explicit)))
    candidates.extend(font_candidates(str(layer.get("weight", "regular"))))
    for candidate in candidates:
        if candidate.exists():
            try:
                return ImageFont.truetype(str(candidate), size=size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: Any, max_width: int) -> str:
    if max_width <= 0:
        return text
    output: list[str] = []
    for paragraph in str(text).splitlines() or [""]:
        current = ""
        for character in paragraph:
            candidate = current + character
            left, _, right, _ = draw.textbbox((0, 0), candidate, font=font)
            if current and right - left > max_width:
                output.append(current)
                current = character
            else:
                current = candidate
        output.append(current)
    return "\n".join(output)


def fit_image(image: Image.Image, width: int, height: int, fit: str) -> Image.Image:
    target = (max(1, width), max(1, height))
    if fit == "stretch":
        return image.resize(target, Image.Resampling.LANCZOS)
    if fit == "contain":
        contained = ImageOps.contain(image, target, Image.Resampling.LANCZOS)
        result = Image.new("RGBA", target, (0, 0, 0, 0))
        result.alpha_composite(
            contained.convert("RGBA"),
            ((target[0] - contained.width) // 2, (target[1] - contained.height) // 2),
        )
        return result
    return ImageOps.fit(
        image,
        target,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    ).convert("RGBA")


def draw_arrow_head(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    color: tuple[int, int, int, int],
    width: int,
) -> None:
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    length = max(12, width * 4)
    spread = math.pi / 7
    points = [
        end,
        (
            end[0] - length * math.cos(angle - spread),
            end[1] - length * math.sin(angle - spread),
        ),
        (
            end[0] - length * math.cos(angle + spread),
            end[1] - length * math.sin(angle + spread),
        ),
    ]
    draw.polygon(points, fill=color)


def render_layer(
    canvas: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec_dir: Path,
    layer: dict[str, Any],
    used_assets: list[dict[str, str]],
) -> None:
    layer_type = str(layer.get("type", ""))
    fill = rgba(layer.get("fill"), "#000000")
    stroke = rgba(layer.get("stroke"), "#000000")
    width = max(1, int(layer.get("strokeWidth", 3)))

    if layer_type == "rect":
        box = (
            float(layer.get("x", 0)),
            float(layer.get("y", 0)),
            float(layer.get("x", 0)) + float(layer.get("width", 0)),
            float(layer.get("y", 0)) + float(layer.get("height", 0)),
        )
        radius = max(0, int(layer.get("radius", 0)))
        draw.rounded_rectangle(
            box,
            radius=radius,
            fill=fill,
            outline=stroke if layer.get("stroke") else None,
            width=width,
        )
        return

    if layer_type == "line":
        start = (float(layer.get("x1", 0)), float(layer.get("y1", 0)))
        end = (float(layer.get("x2", 0)), float(layer.get("y2", 0)))
        draw.line([start, end], fill=stroke, width=width)
        if layer.get("arrowStart"):
            draw_arrow_head(draw, end, start, stroke, width)
        if layer.get("arrowEnd"):
            draw_arrow_head(draw, start, end, stroke, width)
        return

    if layer_type in {"circle", "ellipse"}:
        if layer_type == "circle":
            x = float(layer.get("x", 0))
            y = float(layer.get("y", 0))
            radius = float(layer.get("radius", 0))
            box = (x - radius, y - radius, x + radius, y + radius)
        else:
            box = (
                float(layer.get("x", 0)),
                float(layer.get("y", 0)),
                float(layer.get("x", 0)) + float(layer.get("width", 0)),
                float(layer.get("y", 0)) + float(layer.get("height", 0)),
            )
        draw.ellipse(
            box,
            fill=fill if layer.get("fill") else None,
            outline=stroke if layer.get("stroke") else None,
            width=width,
        )
        return

    if layer_type == "polygon":
        points = [
            (float(point[0]), float(point[1]))
            for point in layer.get("points", [])
            if isinstance(point, list) and len(point) == 2
        ]
        draw.polygon(
            points,
            fill=fill if layer.get("fill") else None,
            outline=stroke if layer.get("stroke") else None,
        )
        if layer.get("stroke") and width > 1 and len(points) >= 2:
            draw.line(points + [points[0]], fill=stroke, width=width, joint="curve")
        return

    if layer_type == "image":
        path = safe_resolve(spec_dir, str(layer.get("path", "")))
        if not path.exists():
            raise ValueError(f"Image layer asset not found: {path}")
        source = Image.open(path).convert("RGBA")
        rendered = fit_image(
            source,
            int(layer.get("width", source.width)),
            int(layer.get("height", source.height)),
            str(layer.get("fit", "cover")),
        )
        opacity = max(0.0, min(1.0, float(layer.get("opacity", 1))))
        if opacity < 1:
            alpha = rendered.getchannel("A").point(lambda value: int(value * opacity))
            rendered.putalpha(alpha)
        canvas.alpha_composite(
            rendered,
            (int(layer.get("x", 0)), int(layer.get("y", 0))),
        )
        used_assets.append(
            {
                "path": path.relative_to(spec_dir).as_posix(),
                "sha256": sha256_file(path),
            }
        )
        return

    if layer_type == "text":
        font = load_font(spec_dir, layer)
        text = wrap_text(
            draw,
            str(layer.get("text", "")),
            font,
            int(layer.get("maxWidth", 0)),
        )
        spacing = int(layer.get("lineSpacing", max(4, int(layer.get("fontSize", 42) * 0.2))))
        left, top, right, bottom = draw.multiline_textbbox(
            (0, 0),
            text,
            font=font,
            spacing=spacing,
            stroke_width=int(layer.get("textStrokeWidth", 0)),
        )
        text_width = right - left
        text_height = bottom - top
        x = float(layer.get("x", 0))
        y = float(layer.get("y", 0))
        anchor = str(layer.get("anchor", "left"))
        valign = str(layer.get("valign", "top"))
        if anchor == "center":
            x -= text_width / 2
        elif anchor == "right":
            x -= text_width
        if valign == "middle":
            y -= text_height / 2
        elif valign == "bottom":
            y -= text_height
        padding = int(layer.get("padding", 0))
        if layer.get("background"):
            draw.rounded_rectangle(
                (
                    x - padding,
                    y - padding,
                    x + text_width + padding,
                    y + text_height + padding,
                ),
                radius=int(layer.get("backgroundRadius", 10)),
                fill=rgba(layer.get("background"), "#ffffff"),
            )
        draw.multiline_text(
            (x, y),
            text,
            font=font,
            fill=fill,
            spacing=spacing,
            align={"left": "left", "center": "center", "right": "right"}.get(anchor, "left"),
            stroke_width=int(layer.get("textStrokeWidth", 0)),
            stroke_fill=rgba(layer.get("textStroke"), "#ffffff"),
        )
        return

    raise ValueError(f"Unsupported layer type: {layer_type}")


def collect_number_values(layer: dict[str, Any]) -> list[float]:
    keys = {
        "x",
        "y",
        "width",
        "height",
        "x1",
        "y1",
        "x2",
        "y2",
        "radius",
    }
    values = []
    for key in keys:
        if key in layer:
            try:
                values.append(float(layer[key]))
            except (TypeError, ValueError):
                pass
    for point in layer.get("points", []):
        if isinstance(point, list) and len(point) == 2:
            try:
                values.extend([float(point[0]), float(point[1])])
            except (TypeError, ValueError):
                pass
    return values


def validate_spec(spec: dict[str, Any], spec_path: Path, image_path: Path | None, strict: bool) -> dict[str, Any]:
    issues: list[dict[str, str]] = []

    def add(severity: str, code: str, path: str, message: str) -> None:
        issues.append(
            {"severity": severity, "code": code, "path": path, "message": message}
        )

    if spec.get("schemaVersion") != VISUAL_SCHEMA_VERSION:
        add(
            "error",
            "schema-version",
            "$.schemaVersion",
            f"Expected {VISUAL_SCHEMA_VERSION}",
        )
    for key in ["id", "title", "alt"]:
        if not isinstance(spec.get(key), str) or not spec[key].strip():
            add("error", "required-string", f"$.{key}", f"{key} is required")
    if spec.get("mode") not in ALLOWED_MODES:
        add("error", "mode", "$.mode", f"mode must be one of {sorted(ALLOWED_MODES)}")

    canvas = spec.get("canvas", {})
    width = canvas.get("width")
    height = canvas.get("height")
    if not isinstance(width, int) or not 640 <= width <= 3840:
        add("error", "canvas-width", "$.canvas.width", "width must be 640–3840")
    if not isinstance(height, int) or not 480 <= height <= 3840:
        add("error", "canvas-height", "$.canvas.height", "height must be 480–3840")

    answer = spec.get("answer", {})
    option_ids = answer.get("optionIds")
    correct = answer.get("correctOptionId")
    if not isinstance(option_ids, list) or len(option_ids) < 2:
        add("error", "answer-options", "$.answer.optionIds", "At least two option IDs are required")
    elif correct not in option_ids:
        add("error", "answer-correct", "$.answer.correctOptionId", "Correct option must exist")
    if answer.get("unique") is not True:
        add(
            "error" if strict else "warning",
            "unique-answer",
            "$.answer.unique",
            "Confirm that the visual has exactly one correct answer",
        )

    layers = spec.get("layers")
    if not isinstance(layers, list) or not layers:
        add("error", "layers", "$.layers", "At least one visual layer is required")
    else:
        for index, layer in enumerate(layers):
            path = f"$.layers[{index}]"
            if not isinstance(layer, dict):
                add("error", "layer", path, "Layer must be an object")
                continue
            if layer.get("type") not in ALLOWED_LAYERS:
                add("error", "layer-type", f"{path}.type", "Unsupported layer type")
            if layer.get("type") == "image":
                try:
                    asset = safe_resolve(spec_path.parent, str(layer.get("path", "")))
                    if not asset.exists() or not asset.is_file():
                        add("error", "missing-asset", f"{path}.path", f"Asset not found: {asset}")
                except ValueError as error:
                    add("error", "asset-path", f"{path}.path", str(error))
            if width and height:
                values = collect_number_values(layer)
                if any(value < -max(width, height) or value > max(width, height) * 2 for value in values):
                    add("warning", "layer-bounds", path, "Layer coordinates are far outside the canvas")

    if spec.get("mode") == "ai-composite":
        provenance = spec.get("provenance", {})
        if not str(provenance.get("provider", "")).strip():
            add("error", "ai-provider", "$.provenance.provider", "AI provider is required")
        if not str(provenance.get("prompt", "")).strip():
            add("error", "ai-prompt", "$.provenance.prompt", "Final prompt is required")
        locked_facts = spec.get("lockedFacts")
        if not isinstance(locked_facts, list) or not locked_facts:
            add("error", "locked-facts", "$.lockedFacts", "AI composites require locked facts")
        else:
            for index, fact in enumerate(locked_facts):
                if fact.get("renderedBy") not in {"overlay", "source"}:
                    add(
                        "error",
                        "ai-math-fact",
                        f"$.lockedFacts[{index}].renderedBy",
                        "Math facts must be rendered by overlay or source, never by AI",
                    )

    review = spec.get("review", {})
    for key in ["mathChecked", "visualChecked", "ambiguityChecked"]:
        if review.get(key) is not True:
            add(
                "error" if strict else "warning",
                "review",
                f"$.review.{key}",
                f"{key} must be confirmed before strict validation",
            )

    if image_path:
        if not image_path.exists():
            add("error", "output-image", "$image", f"Image not found: {image_path}")
        else:
            try:
                with Image.open(image_path) as image:
                    if width and height and image.size != (width, height):
                        add(
                            "error",
                            "image-size",
                            "$image",
                            f"Expected {width}x{height}, received {image.width}x{image.height}",
                        )
            except OSError as error:
                add("error", "image-open", "$image", f"Unable to open image: {error}")

    errors = [issue for issue in issues if issue["severity"] == "error"]
    warnings = [issue for issue in issues if issue["severity"] == "warning"]
    return {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "valid": not errors,
        "strict": strict,
        "spec": str(spec_path),
        "image": str(image_path) if image_path else "",
        "errorCount": len(errors),
        "warningCount": len(warnings),
        "issues": issues,
    }


def compose(spec_path: Path, output: Path, force: bool) -> dict[str, Any]:
    if output.exists() and not force:
        raise ValueError(f"Output already exists: {output}. Use --force to replace it.")
    spec = read_json(spec_path)
    report = validate_spec(spec, spec_path, None, strict=False)
    if not report["valid"]:
        raise ValueError("Visual spec contains validation errors")
    canvas_spec = spec["canvas"]
    canvas = Image.new(
        "RGBA",
        (int(canvas_spec["width"]), int(canvas_spec["height"])),
        rgba(canvas_spec.get("background"), "#ffffff"),
    )
    draw = ImageDraw.Draw(canvas)
    used_assets: list[dict[str, str]] = []
    for layer in spec["layers"]:
        render_layer(canvas, draw, spec_path.parent, layer, used_assets)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, "PNG", optimize=True)
    return {
        "ok": True,
        "spec": str(spec_path),
        "output": str(output),
        "width": canvas.width,
        "height": canvas.height,
        "specSha256": sha256_file(spec_path),
        "outputSha256": sha256_file(output),
        "usedAssets": used_assets,
    }


def command_compose(args: argparse.Namespace) -> dict[str, Any]:
    return compose(Path(args.spec).resolve(), Path(args.out).resolve(), args.force)


def command_validate(args: argparse.Namespace) -> dict[str, Any]:
    spec_path = Path(args.spec).resolve()
    image_path = Path(args.image).resolve() if args.image else None
    report = validate_spec(read_json(spec_path), spec_path, image_path, args.strict)
    if args.report:
        report_path = Path(args.report).resolve()
        portable_report = dict(report)
        portable_report["spec"] = spec_path.name
        portable_report["image"] = image_path.name if image_path else ""
        write_json(report_path, portable_report)
    if not report["valid"]:
        raise RuntimeError("Visual validation failed")
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    compose_parser = subparsers.add_parser("compose")
    compose_parser.add_argument("--spec", required=True)
    compose_parser.add_argument("--out", required=True)
    compose_parser.add_argument("--force", action="store_true")
    compose_parser.set_defaults(func=command_compose)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--spec", required=True)
    validate_parser.add_argument("--image")
    validate_parser.add_argument("--strict", action="store_true")
    validate_parser.add_argument("--report")
    validate_parser.set_defaults(func=command_validate)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.func(args)
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        return 0
    except (ValueError, RuntimeError, OSError) as error:
        sys.stderr.write(f"ERROR: {error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
