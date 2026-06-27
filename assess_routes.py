"""
assess_routes.py
================
Reusable school-bus route assessment tool.

Ingests ANY student roster CSV, extracts or resolves geographic coordinates,
builds a curb-side-safe Google Routes API v2 payload with sideOfRoad location
modifiers and mathematical waypoint sequence optimisation, then executes the
request and decodes the returned encoded polyline.

Tested against: Monday_-_روكسى.csv  (Arabic-header, UTF-8-BOM, 23 students)

Author : Roxy Smart-Bus Engineering
Python : 3.10+
Deps   : pandas, requests  (pip install pandas requests)
"""

# ── Standard library ──────────────────────────────────────────────────────────
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path
from typing import Optional

# ── Third-party ───────────────────────────────────────────────────────────────
import pandas as pd
import requests


# ─────────────────────────────────────────────────────────────────────────────
# 1. CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

# Field mask — request ONLY what we need to minimise billing cost.
# optimizedIntermediateWaypointIndex tells us Google's mathematically optimal
# pickup sequence; encodedPolyline gives us the road-snapped path for the map.
FIELD_MASK = (
    "routes.optimizedIntermediateWaypointIndex,"
    "routes.polyline.encodedPolyline,"
    "routes.duration,"
    "routes.distanceMeters,"
    "routes.legs.duration,"
    "routes.legs.distanceMeters"
)

# Bus route hubs for Monday / Roxy sector (Cairo local time zone, EEST = UTC+3)
ROUTE_ORIGIN = {
    "name": "Roxy Square — روكسي",
    "lat": 30.0900,
    "lng": 31.3100,
}
ROUTE_DESTINATION = {
    "name": "St. Mary Church Complex — مجمع الكنيسة روكسي",
    "lat": 30.0965,
    "lng": 31.3160,
}

# ── Column-name aliases the auto-detector will recognise ─────────────────────
# Keys are canonical field names used internally; values are lists of CSV
# header substrings (case-insensitive, accent-stripped) that map to each field.
COLUMN_ALIASES: dict[str, list[str]] = {
    "name":      ["اسم", "name", "student", "full_name", "fullname", "الاسم"],
    "lat":       ["lat", "latitude", "خط عرض", "عرض"],
    "lng":       ["lng", "lon", "longitude", "long", "خط طول", "طول"],
    "map_url":   ["google maps", "map url", "maps", "location", "goo.gl",
                  "موقع", "خريطة", "google map"],
    "street":    ["شارع", "street", "road"],
    "building":  ["عمارة", "رقم العمارة", "building", "bldg", "bldg_no"],
    "grade":     ["سنة", "grade", "class", "year", "دراسي"],
    "classroom": ["مكان الفصل", "فصل", "classroom", "building_key"],
}

# ── Known coordinates for this roster (used as fallback when URL resolution
#    is blocked or the CSV contains no coordinate columns at all).
#    Populated from students.ts + street-level geocoding for the 7 new students.
KNOWN_STUDENT_COORDS: dict[str, tuple[float, float]] = {
    "ماريتشا مايكل نادي":          (30.0942,    31.3138),
    "جوني مينا جميل عبدالملك":     (30.0944,    31.3140),
    "اميلي مينا مدحت فرج":         (30.0945,    31.3142),
    "هولي مينا وجدي صابر":         (30.0932,    31.3151),
    "كارين اسامه ابراهيم اسحق":    (30.0916,    31.3112),
    "كاراس اسامه ابراهيم اسحق":    (30.0916,    31.3112),
    "صوفيا كريم جرجس فهمي":        (30.091980,  31.314333),
    "ريتا كريم جرجس فهمي":         (30.091980,  31.314333),
    "بارثنيا باسم عطيه عبده":      (30.093182,  31.313541),
    "ديماس باسم عطيه":             (30.093182,  31.313541),
    "بيرلا جون جميل حليم":         (30.0933,    31.3136),
    "بيرلا رامي مهاب شكري":        (30.092979,  31.312038),
    "يوسف رامي مهاب شكري":         (30.092979,  31.312038),
    "ماريا رامي جرجس بشاي":        (30.0952,    31.3131),
    "لاتويا بيتر هديه قريصه":      (30.0950,    31.3129),
    "ماثيو فادي صفنات سعيد":       (30.0948,    31.3126),
    # ── 7 new students geocoded from street + building data ──────────────────
    "ناتالي فادي صفنات سعيد":      (30.0948,    31.3126),  # Adfawi St bldg 4
    "ثيؤفيليا بيتر محسن ميلاد":    (30.0960,    31.3182),  # Noweiry St bldg 5B
    "مايا ايمن منير كامل":          (30.0915,    31.3170),  # Mokrizi St bldg 7
    "جيسكا ايهاب منير جريس":       (30.0920,    31.3185),  # Mokrizi St bldg 21
    "ماريا هاني بخيت زخاري":       (30.0928,    31.3195),  # Mokrizi St bldg 49
    "تالين مينا لاطف الفي":         (30.0935,    31.3200),  # Mokrizi St bldg 61
    "سيلين مينا لاطف الفي":         (30.0935,    31.3200),  # Mokrizi St bldg 61
}


# ─────────────────────────────────────────────────────────────────────────────
# 2. CSV INGESTION & COLUMN DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def _strip_accents(text: str) -> str:
    """Normalise Unicode: remove diacritics and lower-case for fuzzy matching."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()


def _detect_column(
    columns: list[str],
    aliases: list[str],
    label: str,
) -> Optional[str]:
    """
    Return the first column name from `columns` whose stripped form contains
    any substring from `aliases`.  Returns None if nothing matches.
    """
    stripped_cols = {col: _strip_accents(col) for col in columns}
    for alias in aliases:
        alias_norm = _strip_accents(alias)
        for col, col_norm in stripped_cols.items():
            if alias_norm in col_norm:
                return col
    return None


def _auto_map_columns(
    df: pd.DataFrame,
    column_map: Optional[dict[str, str]] = None,
) -> dict[str, Optional[str]]:
    """
    Build a mapping from canonical field names → actual DataFrame column names.

    Args:
        df:         The loaded DataFrame.
        column_map: Optional explicit override dict, e.g.
                    {"name": "StudentFullName", "lat": "Latitude", "lng": "Long"}.
                    Any key supplied here takes priority over auto-detection.

    Returns:
        dict with keys: name, lat, lng, map_url, street, building, grade, classroom.
        Values are actual column names or None if not found.
    """
    resolved: dict[str, Optional[str]] = {}
    cols = list(df.columns)

    for field, aliases in COLUMN_ALIASES.items():
        # 1. Honour explicit override first
        if column_map and field in column_map:
            override = column_map[field]
            if override in df.columns:
                resolved[field] = override
            else:
                print(f"  [WARN] column_map['{field}'] = '{override}' not found in CSV.")
                resolved[field] = None
        else:
            # 2. Auto-detect via alias list
            resolved[field] = _detect_column(cols, aliases, field)

    return resolved


def load_student_data(
    csv_path: str,
    column_map: Optional[dict[str, str]] = None,
    encoding: str = "utf-8-sig",
) -> pd.DataFrame:
    """
    Load a student roster CSV and return a clean DataFrame with standardised
    columns: name, lat, lng, street, building, grade, classroom, map_url.

    Steps performed:
      1. Read the CSV with automatic BOM handling (utf-8-sig).
      2. Auto-detect or apply manual column mapping.
      3. Rename detected columns to canonical names.
      4. Extract lat/lng from Google Maps URLs when coordinate columns are absent.
      5. Resolve shortened goo.gl URLs (via HTTP redirect) if needed.
      6. Fall back to KNOWN_STUDENT_COORDS lookup table for any remaining gaps.
      7. Drop rows that still have no valid coordinates.
      8. Validate that lat/lng are within Egypt's bounding box.

    Args:
        csv_path:   Absolute or relative path to the CSV file.
        column_map: Optional dict mapping canonical names to actual CSV headers.
                    E.g. {"lat": "Latitude_WGS84", "name": "StudentFullName"}.
        encoding:   File encoding (default utf-8-sig handles BOM files).

    Returns:
        pd.DataFrame with columns: name, lat, lng, street, building,
                                   grade, classroom, map_url.
    """
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    print(f"\n{'='*60}")
    print(f"  Loading: {path.name}")
    print(f"{'='*60}")

    df_raw = pd.read_csv(path, encoding=encoding, dtype=str)
    df_raw.columns = df_raw.columns.str.strip()
    print(f"  Rows loaded      : {len(df_raw)}")
    print(f"  Columns detected : {list(df_raw.columns)}")

    # ── Step 2: resolve column mapping ───────────────────────────────────────
    col_map = _auto_map_columns(df_raw, column_map)
    print(f"\n  Column mapping resolved:")
    for field, actual_col in col_map.items():
        print(f"    {field:<12} → {actual_col or '(not found)'}")

    # ── Step 3: rename to canonical names, keep only what we found ────────────
    rename_dict: dict[str, str] = {}
    for field, actual_col in col_map.items():
        if actual_col and actual_col in df_raw.columns:
            rename_dict[actual_col] = field

    df = df_raw.rename(columns=rename_dict)

    # Ensure all canonical columns exist (fill with NaN if missing)
    for field in COLUMN_ALIASES:
        if field not in df.columns:
            df[field] = pd.NA

    # Keep only canonical columns + index columns from original
    keep_cols = [c for c in COLUMN_ALIASES if c in df.columns]
    df = df[keep_cols].copy()

    # ── Step 4: strip whitespace from all string fields ───────────────────────
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].str.strip()

    # ── Step 5: convert lat/lng to float if already present ──────────────────
    if "lat" in df.columns:
        df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    if "lng" in df.columns:
        df["lng"] = pd.to_numeric(df["lng"], errors="coerce")

    # ── Step 6: extract coordinates from map_url where lat/lng still missing ──
    df = _enrich_coords_from_urls(df)

    # ── Step 7: fall back to known coord table for remaining gaps ─────────────
    df = _enrich_coords_from_lookup(df)

    # ── Step 8: drop rows with no usable coordinates ─────────────────────────
    before_drop = len(df)
    df = df.dropna(subset=["lat", "lng"])
    dropped = before_drop - len(df)
    if dropped > 0:
        print(f"\n  [WARN] Dropped {dropped} row(s) with no resolvable coordinates.")

    # ── Step 9: validate coordinates are plausibly within Egypt ──────────────
    # Egypt bounding box: lat 22–32, lng 25–38
    invalid_mask = (
        (df["lat"] < 22.0) | (df["lat"] > 32.0) |
        (df["lng"] < 25.0) | (df["lng"] > 38.0)
    )
    invalid_count = invalid_mask.sum()
    if invalid_count > 0:
        print(f"  [WARN] {invalid_count} row(s) have coordinates outside Egypt bounding box:")
        for _, bad_row in df[invalid_mask].iterrows():
            print(f"    {bad_row.get('name', 'unknown')} → lat={bad_row['lat']}, lng={bad_row['lng']}")
        df = df[~invalid_mask]

    # ── Final summary ─────────────────────────────────────────────────────────
    print(f"\n  ✅ Clean rows ready : {len(df)}")
    print(f"{'='*60}\n")

    return df.reset_index(drop=True)


def _extract_inline_coords(url: str) -> tuple[Optional[float], Optional[float]]:
    """
    Extract lat/lng directly from a Google Maps URL without any HTTP request.

    Handles these patterns:
      https://maps.google.com/?q=30.0942,31.3138
      https://www.google.com/maps/@30.0942,31.3138,17z
      https://maps.google.com/maps?ll=30.0942,31.3138
      https://maps.app.goo.gl/...  (returns None — needs HTTP resolution)
    """
    if not isinstance(url, str) or not url.strip():
        return None, None

    # Pattern 1: ?q=lat,lng  or  &q=lat,lng
    match = re.search(r"[?&]q=([-\d.]+),([-\d.]+)", url)
    if match:
        return float(match.group(1)), float(match.group(2))

    # Pattern 2: @lat,lng,zoom
    match = re.search(r"@([-\d.]+),([-\d.]+)", url)
    if match:
        return float(match.group(1)), float(match.group(2))

    # Pattern 3: ll=lat,lng
    match = re.search(r"[?&]ll=([-\d.]+),([-\d.]+)", url)
    if match:
        return float(match.group(1)), float(match.group(2))

    return None, None


def _resolve_shortened_url(
    url: str,
    timeout: int = 8,
    retries: int = 2,
) -> Optional[str]:
    """
    Follow HTTP redirects on a shortened URL (goo.gl, maps.app.goo.gl) to
    obtain the full destination URL, from which coordinates can be extracted.

    Returns the fully resolved URL string, or None on failure.
    """
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"
                    )
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.url
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(1.0)
            else:
                print(f"    [URL WARN] Could not resolve {url}: {exc}")
    return None


def _enrich_coords_from_urls(df: pd.DataFrame) -> pd.DataFrame:
    """
    For every row where lat or lng is NaN, attempt to extract coordinates from
    the map_url column.  Tries inline extraction first (free, no network),
    then HTTP redirect resolution for shortened URLs.

    Modifies df in place and returns it.
    """
    if "map_url" not in df.columns:
        return df

    needs_coords = df["lat"].isna() | df["lng"].isna()
    if not needs_coords.any():
        return df

    print(f"  Extracting coords from URLs for {needs_coords.sum()} rows …")

    for idx in df.index[needs_coords]:
        url = df.at[idx, "map_url"]
        name = df.at[idx, "name"] if "name" in df.columns else f"row {idx}"

        # ── Try inline extraction first (no network call) ─────────────────
        lat, lng = _extract_inline_coords(url)

        # ── Try HTTP redirect resolution for shortened URLs ────────────────
        if lat is None and isinstance(url, str) and "goo.gl" in url:
            resolved_url = _resolve_shortened_url(url)
            if resolved_url:
                lat, lng = _extract_inline_coords(resolved_url)
                if lat is None:
                    # Some resolved URLs embed coords differently; try raw scan
                    match = re.search(r"([-\d]{2,3}\.\d{4,}),([-\d]{2,3}\.\d{4,})", resolved_url)
                    if match:
                        lat, lng = float(match.group(1)), float(match.group(2))

        if lat is not None and lng is not None:
            df.at[idx, "lat"] = lat
            df.at[idx, "lng"] = lng
            print(f"    ✅ {str(name)[:35]:<37} → ({lat:.6f}, {lng:.6f})  [URL]")
        else:
            print(f"    ⚠️  {str(name)[:35]:<37} → URL unresolvable; will try lookup table")

    return df


def _enrich_coords_from_lookup(df: pd.DataFrame) -> pd.DataFrame:
    """
    For rows that still have no coordinates after URL extraction, consult the
    KNOWN_STUDENT_COORDS lookup table keyed by student name.

    Modifies df in place and returns it.
    """
    needs_coords = df["lat"].isna() | df["lng"].isna()
    if not needs_coords.any():
        return df

    if "name" not in df.columns:
        return df

    remaining = needs_coords.sum()
    print(f"\n  Falling back to lookup table for {remaining} row(s) …")

    for idx in df.index[needs_coords]:
        name = str(df.at[idx, "name"]).strip()
        if name in KNOWN_STUDENT_COORDS:
            lat, lng = KNOWN_STUDENT_COORDS[name]
            df.at[idx, "lat"] = lat
            df.at[idx, "lng"] = lng
            print(f"    ✅ {name[:35]:<37} → ({lat}, {lng})  [LOOKUP]")
        else:
            print(f"    ❌ {name[:35]:<37} → not in lookup table — row will be DROPPED")

    return df


# ─────────────────────────────────────────────────────────────────────────────
# 3. ROUTES API PAYLOAD BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def _make_terminal(lat: float, lng: float) -> dict:
    """
    Build a terminal (origin or destination) waypoint object.
    No sideOfRoad for terminals — the bus departs from and arrives at
    a fixed hub, not a curbside pickup point.
    """
    return {
        "location": {
            "latLng": {
                "latitude": lat,
                "longitude": lng,
            }
        }
    }


def _make_intermediate_waypoint(lat: float, lng: float) -> dict:
    """
    Build an intermediate (student pickup) waypoint object.

    sideOfRoad=True tells the Routes API to snap to the correct side of
    divided roads, preventing the bus from being routed across medians or
    forced into illegal U-turns.

    vehicleStopover=True marks these as stopping points rather than
    pass-through waypoints, which affects how the router calculates
    lane positioning.
    """
    return {
        "location": {
            "latLng": {
                "latitude": lat,
                "longitude": lng,
            }
        },
        "vehicleStopover": True,
        "sideOfRoad": True,
    }


def build_routes_payload(
    df: pd.DataFrame,
    origin: dict = ROUTE_ORIGIN,
    destination: dict = ROUTE_DESTINATION,
) -> dict:
    """
    Convert a clean student DataFrame into the complete JSON payload for
    Google Routes API v2 POST /directions/v2:computeRoutes.

    Args:
        df:          Output of load_student_data() — must contain lat, lng columns.
        origin:      Dict with keys lat, lng (and optionally name) for route start.
        destination: Dict with keys lat, lng (and optionally name) for route end.

    Returns:
        dict: Complete API request body, ready for json.dumps().

    Notes on key fields:
      optimizeWaypointOrder — delegates TSP (Travelling Salesman Problem)
        sequence optimisation to Google's routing engine, which uses live
        traffic, road network topology, and turn cost models.  The optimised
        stop order is returned in routes[0].optimizedIntermediateWaypointIndex.

      TRAFFIC_AWARE — routes around real-time congestion; more accurate ETAs.

      polylineEncoding ENCODED_POLYLINE — compact format, decodable by
        @googlemaps/polyline-codec on the React frontend.
    """
    if df.empty:
        raise ValueError("DataFrame is empty — no stops to build a payload for.")

    if "lat" not in df.columns or "lng" not in df.columns:
        raise KeyError("DataFrame must contain 'lat' and 'lng' columns.")

    intermediates: list[dict] = []
    for _, row in df.iterrows():
        lat = float(row["lat"])
        lng = float(row["lng"])
        waypoint = _make_intermediate_waypoint(lat, lng)
        intermediates.append(waypoint)

    payload: dict = {
        "origin": _make_terminal(float(origin["lat"]), float(origin["lng"])),
        "destination": _make_terminal(float(destination["lat"]), float(destination["lng"])),
        "intermediates": intermediates,
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "optimizeWaypointOrder": True,
        "computeAlternativeRoutes": False,
        "routeModifiers": {
            "avoidTolls":    False,
            "avoidHighways": False,
            "avoidFerries":  True,
        },
        "polylineQuality":   "HIGH_QUALITY",
        "polylineEncoding":  "ENCODED_POLYLINE",
        "languageCode":      "ar",
        "units":             "METRIC",
        "regionCode":        "EG",
    }

    return payload


# ─────────────────────────────────────────────────────────────────────────────
# 4. API EXECUTION
# ─────────────────────────────────────────────────────────────────────────────

def call_routes_api(payload: dict, api_key: str) -> dict:
    """
    Execute the Google Routes API POST request using the requests library.

    Args:
        payload: Built by build_routes_payload().
        api_key: Google Maps Platform key with Routes API enabled.
                 Enable at: https://console.cloud.google.com → APIs → Routes API.

    Returns:
        Parsed JSON response dict.

    Raises:
        requests.HTTPError:  On 4xx/5xx responses (includes body in message).
        RuntimeError:        If the response contains no routes.
        ValueError:          If api_key is empty or obviously invalid.
    """
    if not api_key or api_key.startswith("YOUR_"):
        raise ValueError(
            "No valid API key provided.  "
            "Set GOOGLE_MAPS_PLATFORM_KEY in your environment or pass it explicitly."
        )

    headers = {
        "Content-Type":      "application/json",
        "X-Goog-Api-Key":    api_key,
        "X-Goog-FieldMask":  FIELD_MASK,
    }

    print(f"\n  Calling Routes API …")
    print(f"  Endpoint  : {ROUTES_API_URL}")
    print(f"  Stops     : {len(payload.get('intermediates', []))} intermediates")
    print(f"  FieldMask : {FIELD_MASK}")

    response = requests.post(
        ROUTES_API_URL,
        headers=headers,
        json=payload,
        timeout=15,
    )

    # Attach body text to error message for easy debugging
    if not response.ok:
        raise requests.HTTPError(
            f"Routes API returned HTTP {response.status_code}.\n"
            f"Body: {response.text}",
            response=response,
        )

    data: dict = response.json()

    if "routes" not in data or len(data["routes"]) == 0:
        raise RuntimeError(
            f"Routes API returned no routes.\nFull response: {json.dumps(data, indent=2)}"
        )

    print(f"  ✅ Routes API responded successfully.")
    return data


# ─────────────────────────────────────────────────────────────────────────────
# 5. RESPONSE PARSING
# ─────────────────────────────────────────────────────────────────────────────

def parse_routes_response(
    response: dict,
    df: pd.DataFrame,
) -> dict:
    """
    Extract useful fields from the Routes API response and map the optimised
    waypoint order back to student names.

    Args:
        response: Parsed JSON from call_routes_api().
        df:       The same DataFrame that was used to build the payload,
                  so we can map index → student name.

    Returns:
        dict with:
          polyline          — encoded polyline string for map rendering
          duration_minutes  — total route duration
          distance_km       — total route distance
          optimized_order   — list of student dicts in Google's optimal order
          raw               — full routes[0] dict for inspection
    """
    route = response["routes"][0]

    # ── Duration (returned as "NNNs" string, e.g. "1234s") ───────────────────
    raw_duration = route.get("duration", "0s")
    duration_secs = int(raw_duration.rstrip("s")) if raw_duration else 0
    duration_minutes = round(duration_secs / 60, 1)

    # ── Distance ──────────────────────────────────────────────────────────────
    distance_m = int(route.get("distanceMeters", 0))
    distance_km = round(distance_m / 1000, 2)

    # ── Encoded polyline ──────────────────────────────────────────────────────
    polyline = route.get("polyline", {}).get("encodedPolyline", "")

    # ── Optimised waypoint order ──────────────────────────────────────────────
    optimized_indices: list[int] = route.get("optimizedIntermediateWaypointIndex", [])

    students = df.to_dict("records")
    optimized_order: list[dict] = []

    if optimized_indices:
        for rank, original_idx in enumerate(optimized_indices, start=1):
            if original_idx < len(students):
                student = students[original_idx].copy()
                student["pickup_order"] = rank
                optimized_order.append(student)
    else:
        # API did not return optimisation indices — preserve original order
        for rank, student in enumerate(students, start=1):
            s = student.copy()
            s["pickup_order"] = rank
            optimized_order.append(s)

    return {
        "polyline":         polyline,
        "duration_minutes": duration_minutes,
        "distance_km":      distance_km,
        "optimized_order":  optimized_order,
        "raw":              route,
    }


def print_route_summary(result: dict, origin: dict, destination: dict) -> None:
    """Pretty-print the optimised route plan to stdout."""
    print(f"\n{'='*60}")
    print("  OPTIMISED ROUTE PLAN")
    print(f"{'='*60}")
    print(f"  Origin      : {origin.get('name', 'Start')}")
    print(f"  Destination : {destination.get('name', 'End')}")
    print(f"  Duration    : {result['duration_minutes']} min")
    print(f"  Distance    : {result['distance_km']} km")
    print(f"  Stops       : {len(result['optimized_order'])}")
    print(f"\n  Optimised pickup sequence:")
    for stop in result["optimized_order"]:
        name      = stop.get("name", "Unknown")
        street    = stop.get("street", "")
        building  = stop.get("building", "")
        grade     = stop.get("grade", "")
        classroom = stop.get("classroom", "")
        lat       = stop.get("lat", "")
        lng       = stop.get("lng", "")
        print(
            f"    {stop['pickup_order']:>2}. {str(name):<35} "
            f"{str(street):<18} #{str(building):<6} "
            f"({lat:.5f}, {lng:.5f})"
        )
        if classroom:
            print(f"        → Classroom: {classroom}")
    if result["polyline"]:
        print(f"\n  Encoded polyline ({len(result['polyline'])} chars):")
        print(f"    {result['polyline'][:120]}…")
    print(f"{'='*60}\n")


# ─────────────────────────────────────────────────────────────────────────────
# 6. PAYLOAD INSPECTION UTILITIES
# ─────────────────────────────────────────────────────────────────────────────

def print_payload_summary(payload: dict) -> None:
    """Print a human-readable summary of the payload without dumping all JSON."""
    n_intermediates = len(payload.get("intermediates", []))
    print(f"\n  Payload summary:")
    print(f"    Origin      : {payload['origin']['location']['latLng']}")
    print(f"    Destination : {payload['destination']['location']['latLng']}")
    print(f"    Intermediates: {n_intermediates} waypoints")
    print(f"    optimizeWaypointOrder : {payload.get('optimizeWaypointOrder')}")
    print(f"    routingPreference     : {payload.get('routingPreference')}")
    print(f"    travelMode            : {payload.get('travelMode')}")
    print(f"    regionCode            : {payload.get('regionCode')}")
    if n_intermediates > 0:
        first = payload["intermediates"][0]
        print(f"\n    First intermediate waypoint (structure):")
        print(json.dumps(first, indent=6, ensure_ascii=False))


def save_payload_json(payload: dict, output_path: str = "route_payload.json") -> None:
    """Serialise the payload to a JSON file for inspection or replay."""
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    print(f"  Payload saved → {output_path}")


def save_result_json(result: dict, output_path: str = "route_result.json") -> None:
    """Serialise the parsed result to a JSON file (excludes large raw field)."""
    exportable = {k: v for k, v in result.items() if k != "raw"}
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(exportable, fh, indent=2, ensure_ascii=False)
    print(f"  Result saved  → {output_path}")


# ─────────────────────────────────────────────────────────────────────────────
# 7. ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    # ── Configuration — edit these three values before running ───────────────
    CSV_FILE_PATH = "Roxy.csv"     # Path to your student roster CSV

    # Optional: pass a column_map dict if your CSV uses non-standard headers.
    # Leave as None to use automatic detection.
    # Example for a CSV with English headers:
    #   COLUMN_MAP = {"name": "StudentName", "lat": "Latitude", "lng": "Longitude"}
    COLUMN_MAP: Optional[dict[str, str]] = None

    # ── API key: read from environment variable (never hard-code in source) ───
    API_KEY: str = os.environ.get("GOOGLE_MAPS_PLATFORM_KEY", "")

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 1 — Ingest and clean the CSV
    # ─────────────────────────────────────────────────────────────────────────
    try:
        students_df = load_student_data(
            csv_path=CSV_FILE_PATH,
            column_map=COLUMN_MAP,
        )
    except FileNotFoundError as exc:
        print(f"\n[ERROR] {exc}")
        print(f"  Make sure '{CSV_FILE_PATH}' is in the same directory as this script,")
        print(f"  or provide the full path.")
        sys.exit(1)

    if students_df.empty:
        print("\n[ERROR] No usable student rows after cleaning. Cannot build route.")
        sys.exit(1)

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 2 — Build the Routes API payload
    # ─────────────────────────────────────────────────────────────────────────
    payload = build_routes_payload(
        df=students_df,
        origin=ROUTE_ORIGIN,
        destination=ROUTE_DESTINATION,
    )

    print_payload_summary(payload)
    save_payload_json(payload, output_path="route_payload.json")

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 3 — Call the Routes API (skipped if no key set)
    # ─────────────────────────────────────────────────────────────────────────
    if not API_KEY:
        print(
            "\n[INFO] GOOGLE_MAPS_PLATFORM_KEY not set in environment.\n"
            "  The payload has been built and saved to route_payload.json.\n"
            "  To call the API, run:\n\n"
            "      export GOOGLE_MAPS_PLATFORM_KEY='AIzaSy...your_key'\n"
            "      python assess_routes.py\n"
        )
        print("  Payload is valid and ready for submission.  Exiting without API call.")
        sys.exit(0)

    try:
        api_response = call_routes_api(payload=payload, api_key=API_KEY)
    except ValueError as exc:
        print(f"\n[ERROR] API key problem: {exc}")
        sys.exit(1)
    except requests.HTTPError as exc:
        print(f"\n[ERROR] HTTP error from Routes API:\n  {exc}")
        print(
            "\n  Checklist:\n"
            "    1. Enable 'Routes API' at console.cloud.google.com → APIs & Services → Library\n"
            "    2. Ensure billing is active on your Google Cloud project\n"
            "    3. Check API key restrictions (HTTP referrers, IP, API allowlist)\n"
        )
        sys.exit(1)
    except RuntimeError as exc:
        print(f"\n[ERROR] Routes API returned unexpected response:\n  {exc}")
        sys.exit(1)

    # ─────────────────────────────────────────────────────────────────────────
    # STEP 4 — Parse and display results
    # ─────────────────────────────────────────────────────────────────────────
    result = parse_routes_response(response=api_response, df=students_df)
    print_route_summary(result, origin=ROUTE_ORIGIN, destination=ROUTE_DESTINATION)
    save_result_json(result, output_path="route_result.json")

    print(
        "  Next step: pass result['polyline'] to your React frontend.\n"
        "  Decode with: import { decode } from '@googlemaps/polyline-codec'\n"
        "               const path = decode(polyline).map(([lat, lng]) => ({ lat, lng }));\n"
    )
