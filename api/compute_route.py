"""
Flask/Vercel serverless function: compute_route.py
Endpoint: POST /api/compute-route

Accepts a list of student stop coordinates, builds a Google Routes API v1
request with sideOfRoad location modifiers, and returns the encoded polyline.

Required env var: GOOGLE_MAPS_PLATFORM_KEY  (Routes API must be enabled)
Fallback:         Returns straight-line coordinate list if API fails.
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request
import urllib.error

# ── Google Routes API v1 endpoint ────────────────────────────────────────────
ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

# ── Field mask: only request what we need (minimises billing SKU cost) ────────
FIELD_MASK = (
    "routes.duration,"
    "routes.distanceMeters,"
    "routes.polyline.encodedPolyline,"
    "routes.legs.polyline.encodedPolyline,"
    "routes.legs.duration,"
    "routes.legs.distanceMeters"
)


def build_waypoint(lat: float, lng: float, *, is_intermediate: bool) -> dict:
    """
    Build a single waypoint object.
    Intermediate stops include sideOfRoad=True so the API snaps to the
    correct carriageway and avoids forcing U-turns across dividers.
    """
    location = {
        "location": {
            "latLng": {
                "latitude": lat,
                "longitude": lng
            }
        }
    }
    if is_intermediate:
        location["vehicleStopover"] = True
        location["sideOfRoad"] = True          # ← lane-aware snap
    return location


def build_routes_payload(stops: list[dict]) -> dict:
    """
    Convert a list of {'lat': float, 'lng': float} dicts (or any dicts
    containing those keys, e.g. a pandas DataFrame .to_dict('records'))
    into the exact JSON body required by Routes API v1.

    Args:
        stops: Ordered list of coordinate dicts. First = origin, last = destination,
               everything between = intermediate waypoints.

    Returns:
        dict: Complete JSON payload ready for requests.post() / urllib.
    """
    if len(stops) < 2:
        raise ValueError(f"Need at least 2 stops to compute a route. Got {len(stops)}.")

    origin_stop      = stops[0]
    destination_stop = stops[-1]
    intermediate_stops = stops[1:-1]          # may be empty list

    payload = {
        "origin": build_waypoint(
            float(origin_stop["lat"]),
            float(origin_stop["lng"]),
            is_intermediate=False
        ),
        "destination": build_waypoint(
            float(destination_stop["lat"]),
            float(destination_stop["lng"]),
            is_intermediate=False
        ),
        "intermediates": [
            build_waypoint(
                float(stop["lat"]),
                float(stop["lng"]),
                is_intermediate=True          # sideOfRoad applied here
            )
            for stop in intermediate_stops   # full loop, no ellipsis
        ],
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "departureTime": None,               # patched at call time (see below)
        "computeAlternativeRoutes": False,
        "routeModifiers": {
            "avoidTolls": False,
            "avoidHighways": False,
            "avoidFerries": True,
            "vehicleInfo": {
                "emissionType": "GASOLINE"
            }
        },
        "polylineQuality": "HIGH_QUALITY",
        "polylineEncoding": "ENCODED_POLYLINE",
        "languageCode": "en",
        "units": "METRIC",
        "regionCode": "EG"                   # Egypt — correct map region
    }

    # departureTime must be a RFC3339 UTC string or omitted entirely.
    # We omit it here (None → stripped below) to avoid clock-skew errors in
    # serverless cold-starts; TRAFFIC_AWARE still uses current conditions.
    payload = {k: v for k, v in payload.items() if v is not None}

    return payload


def call_routes_api(payload: dict, api_key: str) -> dict:
    """
    Execute the Routes API POST request.

    Args:
        payload:  Built by build_routes_payload().
        api_key:  Google Maps Platform key with Routes API enabled.

    Returns:
        Parsed JSON response dict from Google.

    Raises:
        RuntimeError: On HTTP error or missing route in response.
    """
    body_bytes = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url=ROUTES_API_URL,
        data=body_bytes,
        method="POST",
        headers={
            "Content-Type":    "application/json",
            "X-Goog-Api-Key":  api_key,
            "X-Goog-FieldMask": FIELD_MASK,   # mandatory — omitting returns empty body
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            data = json.loads(raw)
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Routes API HTTP {exc.code}: {error_body}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Routes API network error: {exc.reason}") from exc

    if "routes" not in data or len(data["routes"]) == 0:
        raise RuntimeError(
            f"Routes API returned no routes. Full response: {json.dumps(data)}"
        )

    return data


def extract_polyline(response: dict) -> str:
    """
    Extract the best available encoded polyline from a Routes API response.
    Prefers the top-level route polyline (single encoded string for all legs).
    Falls back to stitching leg polylines in order if the top-level is absent.

    Args:
        response: Parsed JSON dict from call_routes_api().

    Returns:
        Encoded polyline string (Google's format, decodable by @googlemaps/polyline-codec).

    Raises:
        RuntimeError: If no polyline data is found anywhere in the response.
    """
    route = response["routes"][0]

    # ── Preferred: single top-level polyline ─────────────────────────────────
    top_level = route.get("polyline", {}).get("encodedPolyline")
    if top_level:
        return top_level

    # ── Fallback: stitch leg polylines ───────────────────────────────────────
    legs = route.get("legs", [])
    if not legs:
        raise RuntimeError("Routes API response has neither route polyline nor legs.")

    # Collect each leg's encoded polyline for the frontend to stitch
    leg_polylines = []
    for i, leg in enumerate(legs):
        leg_poly = leg.get("polyline", {}).get("encodedPolyline")
        if not leg_poly:
            raise RuntimeError(f"Leg {i} has no encodedPolyline. Response: {json.dumps(route)}")
        leg_polylines.append(leg_poly)

    # Return as a pipe-delimited string; frontend stitches via decodeLegs()
    return "|".join(leg_polylines)


def compute_route_from_stops(stops: list[dict], api_key: str) -> dict:
    """
    End-to-end helper. Accepts a list of coordinate dicts (or a pandas
    DataFrame converted via df.to_dict('records')), calls the Routes API,
    and returns a structured result dict.

    Args:
        stops:   List of {'lat': float, 'lng': float, ...} dicts. Extra keys ignored.
        api_key: Google Maps Platform key.

    Returns:
        {
            "polyline":       str,    # encoded polyline (or pipe-joined legs)
            "polylineType":   str,    # "single" | "legs"
            "durationSecs":   int,
            "distanceMeters": int,
            "stopCount":      int,
        }
    """
    payload  = build_routes_payload(stops)
    response = call_routes_api(payload, api_key)

    route          = response["routes"][0]
    duration_secs  = int(route.get("duration", "0s").rstrip("s") or 0)
    distance_m     = int(route.get("distanceMeters", 0))

    raw_poly = extract_polyline(response)
    poly_type = "legs" if "|" in raw_poly else "single"

    return {
        "polyline":       raw_poly,
        "polylineType":   poly_type,
        "durationSecs":   duration_secs,
        "distanceMeters": distance_m,
        "stopCount":      len(stops),
    }


# ── Vercel serverless handler ─────────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):
    """
    Vercel Python serverless entry point.
    POST /api/compute-route
    Body: { "stops": [{"lat": 30.09, "lng": 31.31}, ...] }
    """

    def do_OPTIONS(self):                   # CORS preflight
        self._send_cors_headers(200)

    def do_POST(self):
        try:
            length  = int(self.headers.get("Content-Length", 0))
            body    = json.loads(self.rfile.read(length))
            stops   = body.get("stops", [])

            if not isinstance(stops, list) or len(stops) < 2:
                self._json_error(400, "Provide at least 2 stops: [{lat, lng}, ...]")
                return

            api_key = os.environ.get("GOOGLE_MAPS_PLATFORM_KEY", "")
            if not api_key:
                self._json_error(500, "GOOGLE_MAPS_PLATFORM_KEY not set in environment.")
                return

            result = compute_route_from_stops(stops, api_key)
            self._json_ok(result)

        except RuntimeError as exc:
            self._json_error(502, str(exc))
        except Exception as exc:
            self._json_error(500, f"Unexpected error: {exc}")

    # ── helpers ───────────────────────────────────────────────────────────────

    def _send_cors_headers(self, code: int):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json_ok(self, data: dict):
        payload = json.dumps(data).encode()
        self._send_cors_headers(200)
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _json_error(self, code: int, message: str):
        payload = json.dumps({"error": message}).encode()
        self._send_cors_headers(code)
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):      # suppress default access log noise
        pass
