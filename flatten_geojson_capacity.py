#!/usr/bin/env python3
"""
Flatten capacity slots in a GeoJSON file by copying each capacity entry
into a separate top-level property on every feature.

Example: "00:00-01:00": 37 -> "capacity_0000_0100": 37
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, Tuple


TIME_SLOT_PATTERN = re.compile(r"^(\d{2}):(\d{2})-(\d{2}):(\d{2})$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Flatten capacity slots in a GeoJSON FeatureCollection."
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Path to the GeoJSON file to process.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Where to write the flattened file (defaults to in-place).",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="Indentation level for the output JSON.",
    )
    return parser.parse_args()


def slot_to_key(slot: str) -> Tuple[str, str]:
    """
    Convert a capacity slot string into a flattened property key and return
    the key along with the slot without separators for logging.
    """
    match = TIME_SLOT_PATTERN.match(slot)
    if not match:
        raise ValueError(f"Invalid time slot format: {slot!r}")

    start = f"{match.group(1)}{match.group(2)}"
    end = f"{match.group(3)}{match.group(4)}"
    return f"capacity_{start}_{end}", f"{start}-{end}"


def flatten_feature(feature: Dict[str, Any]) -> int:
    """
    Flatten the capacity map for a single feature.
    Returns the number of keys added.
    """
    props = feature.get("properties")
    if not isinstance(props, dict):
        return 0

    capacity = props.get("capacity")
    if not isinstance(capacity, dict):
        return 0

    added = 0
    for slot, value in capacity.items():
        try:
            flat_key, _ = slot_to_key(slot)
        except ValueError:
            # Skip unexpected formats to avoid breaking the file.
            continue
        props[flat_key] = value
        added += 1
    return added


def flatten_geojson(data: Dict[str, Any]) -> int:
    """
    Apply flattening to all features in a GeoJSON FeatureCollection.
    Returns the total number of properties added.
    """
    if data.get("type") != "FeatureCollection":
        raise ValueError("GeoJSON root must be a FeatureCollection.")

    features = data.get("features")
    if not isinstance(features, list):
        raise ValueError("FeatureCollection must contain a 'features' array.")

    total_added = 0
    for feature in features:
        total_added += flatten_feature(feature)
    return total_added


def main() -> None:
    args = parse_args()
    input_path: Path = args.input
    output_path: Path = args.output or input_path

    with input_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    total_added = flatten_geojson(data)

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=args.indent, ensure_ascii=True)
        f.write("\n")

    print(
        f"Flattened capacities written to {output_path}. "
        f"Added {total_added} flattened keys."
    )


if __name__ == "__main__":
    main()
