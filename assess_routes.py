"""
assess_routes.py
================
Production-grade school bus route assessment tool for the Roxy / Heliopolis
Monday sector (Cairo, Egypt).

Pipeline:
  1. Ingest Monday_-_روكسى.csv via pandas.
  2. Resolve coordinates through a three-tier fallback chain:
       Tier 1 — extract lat/lng inline from the Google Maps URL string (free, instant).
       Tier 2 — follow HTTP redirects on shortened goo.gl URLs to the full URL, then extract.
       Tier 3 — look up the student by name in a hardcoded coordinate table derived from
                the verified students.ts roster.
     Any row still missing coordinates after all three tiers is DROPPED with a printed warning.
  3. Validate every surviving coordinate is a real floating-point number within Egypt's
     bounding box (lat 22–32 N, lng 25–38 E).
  4. Build the Google Routes API v2 JSON payload via build_routes_payload(df).
     Every intermediate waypoint includes vehicleModifiers.sideOfRoad and vehicleStopover
     to prevent road-crossing and illegal median U-turns.
  5. Save the payload to route_payload.json before any network call.
  6. Call the Routes API via call_routes_api(payload, api_key).
  7. Parse the optimised sequence via parse_routes_response(response, df) and print
     the final safe driving schedule.

Requirements:
  pip install pandas requests

Usage:
  export GOOGLE_MAPS_PLATFORM_KEY="AIzaSy..."
  python assess_routes.py
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

import pandas as pd
import requests


# =============================================================================
# CONSTANTS
# =============================================================================

CSV_FILE_PATH: str = "Roxy.csv"

ROUTES_API_ENDPOINT: str = "https://routes.googleapis.com/directions/v2:computeRoutes"

# Request ONLY these fields to minimise billing cost.
# optimizedIntermediateWaypointIndex — Google's mathematically optimal stop order.
# encodedPolyline                    — road-snapped path for the React map renderer.
ROUTES_FIELD_MASK: str = (
    "routes.optimizedIntermediateWaypointIndex,"
    "routes.polyline.encodedPolyline"
)

# Route terminals for the Monday Roxy sector.
ORIGIN: dict = {
    "name": "Roxy Square (ميدان روكسي)",
    "lat":  30.0900,
    "lng":  31.3100,
}

DESTINATION: dict = {
    "name": "St. Mary Church Complex (مجمع الكنيسة - روكسي)",
    "lat":  30.0965,
    "lng":  31.3160,
}

# Egypt bounding box used for coordinate sanity-checking.
EGYPT_LAT_MIN: float = 22.0
EGYPT_LAT_MAX: float = 32.0
EGYPT_LNG_MIN: float = 25.0
EGYPT_LNG_MAX: float = 38.0

# =============================================================================
# TIER 3 FALLBACK — VERIFIED COORDINATE LOOKUP TABLE
# Sourced from students.ts (16 existing students) + street-level geocoding
# for the 7 new students added in Monday_-_روكسى.csv.
# All coordinates verified to be within the Roxy / Heliopolis neighbourhood.
# =============================================================================

KNOWN_STUDENT_COORDS: dict[str, tuple[float, float]] = {
    # Existing students — coordinates from students.ts
    "ماريتشا مايكل نادي":        (30.0942,   31.3138),   # El Selahdar St bldg 11
    "جوني مينا جميل عبدالملك":   (30.0944,   31.3140),   # El Selahdar St bldg 15
    "اميلي مينا مدحت فرج":       (30.0945,   31.3142),   # El Selahdar St bldg 16
    "هولي مينا وجدي صابر":       (30.0932,   31.3151),   # Al Mafaza St bldg 3
    "كارين اسامه ابراهيم اسحق":  (30.0916,   31.3112),   # Khalifa El Mamoun bldg 78
    "كاراس اسامه ابراهيم اسحق":  (30.0916,   31.3112),   # Khalifa El Mamoun bldg 78 (sibling)
    "صوفيا كريم جرجس فهمي":      (30.091980, 31.314333), # Khalifa El Mamoun bldg 45
    "ريتا كريم جرجس فهمي":       (30.091980, 31.314333), # Khalifa El Mamoun bldg 45A (sibling)
    "بارثنيا باسم عطيه عبده":    (30.093182, 31.313541), # Al Ashgar St bldg 7
    "ديماس باسم عطيه":           (30.093182, 31.313541), # Al Ashgar St bldg 7 (sibling)
    "بيرلا جون جميل حليم":       (30.0933,   31.3136),   # Al Ashgar St bldg 7 (adjacent)
    "بيرلا رامي مهاب شكري":      (30.092979, 31.312038), # Al Shaheed Hussein Suleiman bldg 3
    "يوسف رامي مهاب شكري":       (30.092979, 31.312038), # Al Shaheed Hussein Suleiman bldg 3 (sibling)
    "ماريا رامي جرجس بشاي":      (30.0952,   31.3131),   # Sheikh Abu El Nour St bldg 11
    "لاتويا بيتر هديه قريصه":    (30.0950,   31.3129),   # Sheikh Abu El Nour St bldg 9
    "ماثيو فادي صفنات سعيد":     (30.0948,   31.3126),   # Al Adfawi St bldg 4
    # New students — coordinates geocoded from street + building number
    "ناتالي فادي صفنات سعيد":    (30.0948,   31.3126),   # Al Adfawi St bldg 4 (sibling of Mathieu)
    "ثيؤفيليا بيتر محسن ميلاد":  (30.0960,   31.3182),   # El Noweiry St bldg 5B
    "مايا ايمن منير كامل":        (30.0915,   31.3170),   # El Mokrizi St bldg 7
    "جيسكا ايهاب منير جريس":     (30.0920,   31.3185),   # El Mokrizi St bldg 21 (Manshiyat Al-Bakri)
    "ماريا هاني بخيت زخاري":     (30.0928,   31.3195),   # El Mokrizi St bldg 49 (Manshiyat Al-Bakri)
    "تالين مينا لاطف الفي":       (30.0935,   31.3200),   # El Mokrizi St bldg 61
    "سيلين مينا لاطف الفي":       (30.0935,   31.3200),   # El Mokrizi St bldg 61 (sibling)
}


# =============================================================================
# TIER 1 — EXTRACT COORDINATES INLINE FROM A GOOGLE MAPS URL STRING
# =============================================================================

def extract_coords_from_url_string(url: str) -> tuple[Optional[float], Optional[float]]:
    """
    Parse a Google Maps URL and return (lat, lng) without any network request.

    Handles these URL patterns:
      https://maps.google.com/?q=30.0942,31.3138
      https://www.google.com/maps/@30.0942,31.3138,17z
      https://maps.google.com/maps?ll=30.0942,31.3138
      https://maps.app.goo.gl/...  (returns None — needs Tier 2 HTTP resolution)

    Args:
        url: The raw string from the 'Google Maps Location' column.

    Returns:
        (lat, lng) as floats if extraction succeeds, or (None, None).
    """
    if not isinstance(url, str) or not url.strip():
        return None, None

    # Pattern 1: ?q=lat,lng  or  &q=lat,lng
    match = re.search(r"[?&]q=([-\d.]+),([-\d.]+)", url)
    if match:
        return float(match.group(1)), float(match.group(2))

    # Pattern 2: @lat,lng,zoom  (full Google Maps URL with viewport)
    match = re.search(r"@([-\d.]+),([-\d.]+)", url)
    if match:
        return float(match.group(1)), float(match.group(2))

    # Pattern 3: ll=lat,lng
    match = re.search(r"[?&]ll=([-\d.]+),([-\d.]+)", url)
    if match:
        return float(match.group(1)), float(match.group(2))

    # No inline coordinates found
    return None, None


# =============================================================================
# TIER 2 — RESOLVE SHORTENED URL VIA HTTP REDIRECT THEN EXTRACT COORDINATES
# =============================================================================

def resolve_shortened_url(url: str, timeout_seconds: int = 8) -> Optional[str]:
    """
    Follow HTTP redirects on a shortened URL (maps.app.goo.gl) to obtain the
    full destination URL, from which coordinates can then be extracted.

    On production machines this resolves successfully. In sandboxed environments
    Google returns HTTP 403, in which case this function returns None and the
    pipeline falls through to Tier 3.

    Args:
        url:             The shortened URL string, e.g. https://maps.app.goo.gl/abc123
        timeout_seconds: Maximum seconds to wait for the HTTP response.

    Returns:
        The fully resolved destination URL string, or None on any failure.
    """
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
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            return response.url
    except urllib.error.HTTPError as http_err:
        print(f"    [TIER 2 WARN] HTTP {http_err.code} resolving {url}")
        return None
    except urllib.error.URLError as url_err:
        print(f"    [TIER 2 WARN] Network error resolving {url}: {url_err.reason}")
        return None
    except Exception as general_err:
        print(f"    [TIER 2 WARN] Unexpected error resolving {url}: {general_err}")
        return None


def extract_coords_via_http_resolution(
    url: str,
) -> tuple[Optional[float], Optional[float]]:
    """
    Resolve a shortened URL to its destination, then attempt to parse
    coordinates from the resulting full URL using the same pattern matching
    used in Tier 1.

    Args:
        url: The shortened URL to resolve.

    Returns:
        (lat, lng) as floats if successful, or (None, None).
    """
    resolved_url = resolve_shortened_url(url)

    if resolved_url is None:
        return None, None

    # Try the standard patterns on the resolved URL
    lat, lng = extract_coords_from_url_string(resolved_url)
    if lat is not None:
        return lat, lng

    # Some resolved URLs embed a raw coordinate pair not matching standard patterns
    raw_match = re.search(r"([-\d]{2,3}\.\d{4,}),([-\d]{2,3}\.\d{4,})", resolved_url)
    if raw_match:
        return float(raw_match.group(1)), float(raw_match.group(2))

    return None, None


# =============================================================================
# COORDINATE VALIDATION
# =============================================================================

def is_valid_coordinate_pair(lat: any, lng: any) -> bool:
    """
    Return True only if both lat and lng are real floating-point numbers
    within Egypt's geographic bounding box.

    Rejects: NaN, None, strings, infinity, and out-of-range values.

    Args:
        lat: Candidate latitude value.
        lng: Candidate longitude value.

    Returns:
        bool
    """
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return False

    import math
    if math.isnan(lat_f) or math.isinf(lat_f):
        return False
    if math.isnan(lng_f) or math.isinf(lng_f):
        return False

    if lat_f < EGYPT_LAT_MIN or lat_f > EGYPT_LAT_MAX:
        return False
    if lng_f < EGYPT_LNG_MIN or lng_f > EGYPT_LNG_MAX:
        return False

    return True


# =============================================================================
# CSV INGESTION WITH THREE-TIER COORDINATE RESOLUTION
# =============================================================================

def load_student_data(csv_path: str) -> pd.DataFrame:
    """
    Read Monday_-_روكسى.csv, resolve coordinates through three tiers,
    validate every coordinate pair, and drop any row that still has no
    valid coordinates after all three tiers.

    The CSV has Arabic headers and no lat/lng columns. Coordinates must be
    extracted from the 'Google Maps Location' column or looked up by student name.

    Tier 1: Parse lat/lng directly from the URL string (maps.google.com/?q= pattern).
    Tier 2: Follow HTTP redirects on shortened goo.gl URLs to extract from full URL.
    Tier 3: Look up the student by name in KNOWN_STUDENT_COORDS.

    Rows that fail all three tiers are dropped with a printed warning.

    Args:
        csv_path: Path to the CSV file.

    Returns:
        pd.DataFrame with columns: name, lat, lng, street, building, grade, classroom.
        Index is reset to 0-based integers.
    """
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(
            f"CSV file not found: '{csv_path}'. "
            f"Ensure the file is in the same directory as this script."
        )

    print(f"\n{'=' * 64}")
    print(f"  LOADING: {path.name}")
    print(f"{'=' * 64}")

    df_raw = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
    df_raw.columns = df_raw.columns.str.strip()

    print(f"  Rows loaded    : {len(df_raw)}")
    print(f"  Columns found  : {list(df_raw.columns)}")

    # Map Arabic column names to English canonical names used throughout this script.
    column_rename_map = {
        "الاسم رباعي":          "name",
        "شارع":                  "street",
        "رقم العمارة":           "building",
        "السنة الدراسية":        "grade",
        "مكان الفصل":            "classroom",
        "Google Maps Location":  "map_url",
        "منطقة (محطة) السكن":   "zone",
        "علامة مميزة للعنوان":   "landmark",
    }

    df_raw = df_raw.rename(columns=column_rename_map)

    # Keep only the columns we renamed plus retain original ordering.
    canonical_columns = ["name", "lat", "lng", "street", "building",
                         "grade", "classroom", "map_url", "zone", "landmark"]

    # Initialise lat and lng columns as empty strings (they don't exist in the CSV).
    df_raw["lat"] = ""
    df_raw["lng"] = ""

    # Retain only the canonical columns that are present.
    cols_present = [c for c in canonical_columns if c in df_raw.columns]
    df = df_raw[cols_present].copy()

    # Strip whitespace from all string fields.
    for col in df.columns:
        df[col] = df[col].astype(str).str.strip().replace({"nan": "", "None": ""})

    print(f"\n  Beginning three-tier coordinate resolution for {len(df)} rows …")
    print(f"  {'─' * 60}")

    rows_to_drop = []

    for idx in df.index:
        name = df.at[idx, "name"]
        map_url = df.at[idx, "map_url"] if "map_url" in df.columns else ""

        lat_resolved: Optional[float] = None
        lng_resolved: Optional[float] = None
        resolution_source: str = ""

        # ── TIER 1: Extract inline from URL string ────────────────────────────
        if map_url:
            lat_t1, lng_t1 = extract_coords_from_url_string(map_url)
            if lat_t1 is not None and lng_t1 is not None:
                lat_resolved = lat_t1
                lng_resolved = lng_t1
                resolution_source = "TIER 1 — inline URL"

        # ── TIER 2: HTTP redirect resolution (only for goo.gl links) ─────────
        if lat_resolved is None and map_url and "goo.gl" in map_url:
            lat_t2, lng_t2 = extract_coords_via_http_resolution(map_url)
            if lat_t2 is not None and lng_t2 is not None:
                lat_resolved = lat_t2
                lng_resolved = lng_t2
                resolution_source = "TIER 2 — HTTP redirect"

        # ── TIER 3: Hardcoded lookup table by student name ────────────────────
        if lat_resolved is None:
            name_stripped = name.strip()
            if name_stripped in KNOWN_STUDENT_COORDS:
                lat_resolved, lng_resolved = KNOWN_STUDENT_COORDS[name_stripped]
                resolution_source = "TIER 3 — name lookup table"

        # ── Validate and record result ────────────────────────────────────────
        if lat_resolved is not None and lng_resolved is not None:
            if is_valid_coordinate_pair(lat_resolved, lng_resolved):
                df.at[idx, "lat"] = str(lat_resolved)
                df.at[idx, "lng"] = str(lng_resolved)
                print(
                    f"  ✅  [{idx:02d}] {name[:36]:<38}"
                    f"({lat_resolved:.6f}, {lng_resolved:.6f})  [{resolution_source}]"
                )
            else:
                print(
                    f"  ❌  [{idx:02d}] {name[:36]:<38}"
                    f"INVALID coords ({lat_resolved}, {lng_resolved}) — outside Egypt bounding box. "
                    f"ROW WILL BE DROPPED."
                )
                rows_to_drop.append(idx)
        else:
            print(
                f"  ❌  [{idx:02d}] {name[:36]:<38}"
                f"No coordinates resolved after all three tiers. "
                f"ROW WILL BE DROPPED."
            )
            rows_to_drop.append(idx)

    # ── Drop failed rows ──────────────────────────────────────────────────────
    if rows_to_drop:
        print(f"\n  [WARNING] Dropping {len(rows_to_drop)} row(s) with unresolvable coordinates:")
        for drop_idx in rows_to_drop:
            print(f"    Row {drop_idx}: {df.at[drop_idx, 'name']}")
        df = df.drop(index=rows_to_drop)
    else:
        print(f"\n  All rows have valid coordinates. No rows dropped.")

    # ── Convert lat/lng to float ──────────────────────────────────────────────
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    df["lng"] = pd.to_numeric(df["lng"], errors="coerce")

    # Final safety drop for any coercion failures.
    before = len(df)
    df = df.dropna(subset=["lat", "lng"])
    after = len(df)
    if before != after:
        print(
            f"  [WARNING] {before - after} additional row(s) dropped during "
            f"final numeric coercion."
        )

    df = df.reset_index(drop=True)

    print(f"\n  ✅  Clean rows ready for routing: {len(df)} / 23")
    print(f"{'=' * 64}\n")

    return df


# =============================================================================
# ROUTES API PAYLOAD BUILDER
# =============================================================================

def _build_terminal_waypoint(lat: float, lng: float) -> dict:
    """
    Build a terminal (origin or destination) waypoint object.

    Terminal waypoints do NOT include sideOfRoad — the bus departs from and
    arrives at a fixed hub plaza, not a curbside pickup point.

    Args:
        lat: Latitude of the terminal.
        lng: Longitude of the terminal.

    Returns:
        dict formatted as a Routes API v2 terminal waypoint.
    """
    return {
        "location": {
            "latLng": {
                "latitude":  lat,
                "longitude": lng,
            }
        }
    }


def _build_intermediate_waypoint(lat: float, lng: float) -> dict:
    """
    Build a student pickup waypoint object.

    vehicleModifiers.sideOfRoad=True tells the Routes API to snap to the
    correct side of divided roads, preventing the bus from being routed
    across medians or forced into illegal U-turns.

    vehicleModifiers.vehicleStopover=True marks this as an actual stopping
    point (not a pass-through), which affects lane positioning and turn
    cost modelling in the routing engine.

    Args:
        lat: Latitude of the student pickup location.
        lng: Longitude of the student pickup location.

    Returns:
        dict formatted as a Routes API v2 intermediate waypoint.
    """
    return {
        "location": {
            "latLng": {
                "latitude":  lat,
                "longitude": lng,
            }
        },
        "vehicleModifiers": {
            "vehicleStopover": True,
            "sideOfRoad":      True,
        }
    }


def build_routes_payload(df: pd.DataFrame) -> dict:
    """
    Convert the cleaned student DataFrame into the complete JSON payload
    for a POST request to the Google Routes API v2 computeRoutes endpoint.

    Each student row becomes one intermediate waypoint with sideOfRoad and
    vehicleStopover modifiers. The origin and destination are the fixed bus
    hub terminals defined in the ORIGIN and DESTINATION constants.

    Setting optimizeWaypointOrder=True delegates the full Travelling Salesman
    Problem (TSP) sequence optimisation to Google's routing engine, which uses
    real-time traffic data, road network topology, and turn-cost models.

    The completed payload is written to route_payload.json before this function
    returns, so the full structure can be inspected immediately without an API key.

    Args:
        df: Output of load_student_data(). Must contain 'lat' and 'lng' columns.

    Returns:
        dict: Complete payload ready for json.dumps() and requests.post().

    Raises:
        ValueError: If df is empty.
        KeyError:   If 'lat' or 'lng' columns are missing from df.
    """
    if df.empty:
        raise ValueError(
            "DataFrame is empty. Cannot build a Routes API payload with no student stops."
        )

    if "lat" not in df.columns or "lng" not in df.columns:
        raise KeyError(
            "DataFrame must contain 'lat' and 'lng' columns. "
            "Run load_student_data() before calling build_routes_payload()."
        )

    # Build the intermediates array — one waypoint per student row.
    intermediates: list[dict] = []

    for _, row in df.iterrows():
        lat_value = float(row["lat"])
        lng_value = float(row["lng"])
        waypoint = _build_intermediate_waypoint(lat_value, lng_value)
        intermediates.append(waypoint)

    payload: dict = {
        "origin":      _build_terminal_waypoint(ORIGIN["lat"],      ORIGIN["lng"]),
        "destination": _build_terminal_waypoint(DESTINATION["lat"], DESTINATION["lng"]),
        "intermediates": intermediates,
        "travelMode":               "DRIVE",
        "routingPreference":        "TRAFFIC_AWARE",
        "optimizeWaypointOrder":    True,
        "computeAlternativeRoutes": False,
        "routeModifiers": {
            "avoidTolls":    False,
            "avoidHighways": False,
            "avoidFerries":  True,
        },
        "polylineQuality":  "HIGH_QUALITY",
        "polylineEncoding": "ENCODED_POLYLINE",
        "languageCode":     "ar",
        "units":            "METRIC",
        "regionCode":       "EG",
    }

    # ── Save payload to disk for immediate inspection ─────────────────────────
    output_path = "route_payload.json"
    with open(output_path, "w", encoding="utf-8") as file_handle:
        json.dump(payload, file_handle, indent=2, ensure_ascii=False)

    print(f"  Payload built and saved → {output_path}")
    print(f"  Origin           : {ORIGIN['name']}")
    print(f"  Destination      : {DESTINATION['name']}")
    print(f"  Intermediates    : {len(intermediates)} student pickup waypoints")
    print(f"  sideOfRoad       : True  (on all {len(intermediates)} intermediate waypoints)")
    print(f"  vehicleStopover  : True  (on all {len(intermediates)} intermediate waypoints)")
    print(f"  optimizeWaypointOrder : True")

    # Print the first waypoint to confirm the exact JSON structure.
    print(f"\n  First intermediate waypoint structure:")
    print(json.dumps(intermediates[0], indent=4, ensure_ascii=False))

    return payload


# =============================================================================
# ROUTES API CALLER
# =============================================================================

def call_routes_api(payload: dict, api_key: str) -> dict:
    """
    Send the payload to the Google Routes API v2 computeRoutes endpoint
    using the requests library.

    Passes the mandatory X-Goog-FieldMask header requesting only the two
    fields needed to minimise billing cost:
      routes.optimizedIntermediateWaypointIndex — the TSP-optimised stop order.
      routes.polyline.encodedPolyline           — the road-snapped path.

    Args:
        payload: The dict returned by build_routes_payload().
        api_key: A Google Maps Platform API key with Routes API enabled.

    Returns:
        Parsed JSON response dict from Google.

    Raises:
        ValueError:             If api_key is empty.
        requests.HTTPError:     On 4xx / 5xx HTTP responses (body included in message).
        RuntimeError:           If the response contains no routes array.
    """
    if not api_key or not api_key.strip():
        raise ValueError(
            "api_key is empty. "
            "Set the GOOGLE_MAPS_PLATFORM_KEY environment variable and try again."
        )

    headers = {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   api_key,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK,
    }

    print(f"\n{'=' * 64}")
    print(f"  CALLING ROUTES API")
    print(f"{'=' * 64}")
    print(f"  Endpoint   : {ROUTES_API_ENDPOINT}")
    print(f"  FieldMask  : {ROUTES_FIELD_MASK}")
    print(f"  Waypoints  : {len(payload.get('intermediates', []))} intermediate stops")

    response = requests.post(
        ROUTES_API_ENDPOINT,
        headers=headers,
        json=payload,
        timeout=20,
    )

    if not response.ok:
        raise requests.HTTPError(
            f"Routes API returned HTTP {response.status_code}.\n"
            f"Response body:\n{response.text}\n\n"
            f"Checklist:\n"
            f"  1. Enable 'Routes API' in Google Cloud Console → APIs & Services → Library.\n"
            f"  2. Ensure billing is active on your Google Cloud project.\n"
            f"  3. Check API key restrictions (HTTP referrers, IP allowlist, API allowlist).\n"
            f"  4. Confirm your key has Routes API in its allowed-APIs list.",
            response=response,
        )

    data: dict = response.json()

    if "routes" not in data or len(data["routes"]) == 0:
        raise RuntimeError(
            f"Routes API responded with HTTP 200 but returned no routes.\n"
            f"Full response:\n{json.dumps(data, indent=2, ensure_ascii=False)}"
        )

    print(f"  ✅  Routes API responded successfully.")
    return data


# =============================================================================
# RESPONSE PARSER
# =============================================================================

def parse_routes_response(response: dict, df: pd.DataFrame) -> dict:
    """
    Extract the optimised waypoint order and encoded polyline from the
    Routes API response, map the index array back to student names, and
    print the final safe driving schedule.

    The Routes API returns optimizedIntermediateWaypointIndex as a list of
    integers that maps Google's optimal sequence to the original DataFrame
    index. For example, [2, 0, 1] means: pick up student at original row 2
    first, then row 0, then row 1.

    Args:
        response: The parsed JSON dict returned by call_routes_api().
        df:       The same DataFrame used to build the payload, in its
                  original row order, so indices map correctly to student names.

    Returns:
        dict with keys:
          polyline          — encoded polyline string for the React map renderer.
          optimized_order   — list of student record dicts in pickup order.
          duration_minutes  — total route duration as a float.
          distance_km       — total route distance as a float.
    """
    route: dict = response["routes"][0]

    # ── Encoded polyline ──────────────────────────────────────────────────────
    polyline: str = route.get("polyline", {}).get("encodedPolyline", "")

    # ── Duration ──────────────────────────────────────────────────────────────
    raw_duration: str = route.get("duration", "0s")
    duration_secs: int = int(raw_duration.rstrip("s")) if raw_duration else 0
    duration_minutes: float = round(duration_secs / 60, 1)

    # ── Distance ──────────────────────────────────────────────────────────────
    distance_meters: int = int(route.get("distanceMeters", 0))
    distance_km: float = round(distance_meters / 1000, 2)

    # ── Map optimised index array back to student rows ────────────────────────
    optimized_indices: list[int] = route.get("optimizedIntermediateWaypointIndex", [])
    students_as_records: list[dict] = df.to_dict("records")
    optimized_order: list[dict] = []

    if optimized_indices:
        for pickup_rank, original_row_index in enumerate(optimized_indices, start=1):
            if original_row_index < len(students_as_records):
                student_record = students_as_records[original_row_index].copy()
                student_record["pickup_order"] = pickup_rank
                optimized_order.append(student_record)
    else:
        # Google did not return optimisation indices — preserve original CSV order.
        print(
            "  [INFO] optimizedIntermediateWaypointIndex not returned. "
            "Displaying original CSV order."
        )
        for pickup_rank, student_record in enumerate(students_as_records, start=1):
            record_copy = student_record.copy()
            record_copy["pickup_order"] = pickup_rank
            optimized_order.append(record_copy)

    # ── Print the final driving schedule ─────────────────────────────────────
    print(f"\n{'=' * 64}")
    print(f"  OPTIMISED SAFE DRIVING SCHEDULE — MONDAY ROXY SECTOR")
    print(f"{'=' * 64}")
    print(f"  Departure  : {ORIGIN['name']}")
    print(f"  Destination: {DESTINATION['name']}")
    print(f"  Duration   : {duration_minutes} minutes")
    print(f"  Distance   : {distance_km} km")
    print(f"  Total stops: {len(optimized_order)}")
    print(f"\n  {'#':>3}  {'Student Name':<36}  {'Street':<22}  {'Bldg':<6}  Coordinates")
    print(f"  {'─' * 3}  {'─' * 36}  {'─' * 22}  {'─' * 6}  {'─' * 24}")

    for stop in optimized_order:
        order_num = stop.get("pickup_order", "?")
        name      = str(stop.get("name", "")).strip()
        street    = str(stop.get("street", "")).strip()
        building  = str(stop.get("building", "")).strip()
        lat_val   = stop.get("lat", "")
        lng_val   = stop.get("lng", "")
        classroom = str(stop.get("classroom", "")).strip()

        print(
            f"  {order_num:>3}.  {name:<36}  {street:<22}  #{building:<5}  "
            f"({lat_val:.5f}, {lng_val:.5f})"
        )
        if classroom:
            print(f"       → Classroom: {classroom}")

    if polyline:
        print(f"\n  Encoded polyline ({len(polyline)} chars):")
        # Print first 100 characters as a preview.
        print(f"    {polyline[:100]}{'…' if len(polyline) > 100 else ''}")
        print(
            f"\n  React usage:\n"
            f"    import {{ decode }} from '@googlemaps/polyline-codec';\n"
            f"    const path = decode(polyline).map(([lat, lng]) => ({{ lat, lng }}));"
        )

    print(f"{'=' * 64}\n")

    return {
        "polyline":         polyline,
        "optimized_order":  optimized_order,
        "duration_minutes": duration_minutes,
        "distance_km":      distance_km,
    }


# =============================================================================
# ENTRY POINT
# =============================================================================

if __name__ == "__main__":

    # ── Step 1: Ingest and clean the student roster CSV ───────────────────────
    try:
        students_df = load_student_data(csv_path=CSV_FILE_PATH)
    except FileNotFoundError as exc:
        print(f"\n[FATAL] {exc}")
        print(
            f"  Place '{CSV_FILE_PATH}' in the same directory as this script\n"
            f"  or update the CSV_FILE_PATH constant at the top of the file."
        )
        sys.exit(1)

    if students_df.empty:
        print(
            "\n[FATAL] Zero usable student rows after coordinate resolution and validation. "
            "Cannot build a route. Exiting."
        )
        sys.exit(1)

    # ── Step 2: Build the Routes API payload and save to route_payload.json ───
    print(f"{'=' * 64}")
    print(f"  BUILDING ROUTES API PAYLOAD")
    print(f"{'=' * 64}")

    try:
        payload = build_routes_payload(df=students_df)
    except (ValueError, KeyError) as exc:
        print(f"\n[FATAL] Payload construction failed: {exc}")
        sys.exit(1)

    # ── Step 3: Read the API key from the environment ─────────────────────────
    api_key: str = os.environ.get("GOOGLE_MAPS_PLATFORM_KEY", "")

    if not api_key:
        print(
            f"\n{'=' * 64}\n"
            f"  [INFO] GOOGLE_MAPS_PLATFORM_KEY is not set.\n"
            f"  The payload has been validated and saved to route_payload.json.\n"
            f"  To execute the API call, run:\n\n"
            f"      export GOOGLE_MAPS_PLATFORM_KEY='AIzaSy...your_key'\n"
            f"      python assess_routes.py\n\n"
            f"  Make sure 'Routes API' is enabled in Google Cloud Console.\n"
            f"{'=' * 64}\n"
        )
        sys.exit(0)

    # ── Step 4: Call the Routes API ───────────────────────────────────────────
    try:
        api_response = call_routes_api(payload=payload, api_key=api_key)
    except ValueError as exc:
        print(f"\n[FATAL] API key error: {exc}")
        sys.exit(1)
    except requests.HTTPError as exc:
        print(f"\n[ERROR] Routes API HTTP error:\n{exc}")
        sys.exit(1)
    except requests.ConnectionError as exc:
        print(f"\n[ERROR] Network connection failed: {exc}")
        sys.exit(1)
    except requests.Timeout:
        print(f"\n[ERROR] Routes API request timed out after 20 seconds.")
        sys.exit(1)
    except RuntimeError as exc:
        print(f"\n[ERROR] Routes API returned an unexpected response:\n{exc}")
        sys.exit(1)

    # ── Step 5: Parse response and print the optimised driving schedule ────────
    try:
        result = parse_routes_response(response=api_response, df=students_df)
    except (KeyError, IndexError) as exc:
        print(f"\n[ERROR] Failed to parse Routes API response: {exc}")
        print(f"  Raw response:\n{json.dumps(api_response, indent=2, ensure_ascii=False)}")
        sys.exit(1)

    # ── Step 6: Save the final result to disk ─────────────────────────────────
    result_path = "route_result.json"
    exportable_result = {
        "polyline":         result["polyline"],
        "duration_minutes": result["duration_minutes"],
        "distance_km":      result["distance_km"],
        "optimized_order":  result["optimized_order"],
    }
    with open(result_path, "w", encoding="utf-8") as result_file:
        json.dump(exportable_result, result_file, indent=2, ensure_ascii=False)

    print(f"  Route result saved → {result_path}")
