#!/usr/bin/env python3
"""Prepare and execute a spatial Google Maps scraper job through the local Web API.

Designed for GitHub Actions. Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


MAX_CENTERS = 250
EARTH_KM = 6371.0088


def request_json(url: str, *, method: str = "GET", payload=None, timeout=30):
    data = None
    headers = {
        "Accept": "application/json",
        "User-Agent": "xulytiengviet-google-maps-scraper-actions/1.0",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download(url: str, path: Path):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "xulytiengviet-google-maps-scraper-actions/1.0"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        path.write_bytes(resp.read())


def parse_google_point(text: str):
    text = (text or "").strip()
    if not text:
        return None

    m = re.search(r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)", text)
    if m:
        return {"lat": float(m.group(1)), "lon": float(m.group(2))}

    m = re.search(r"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)", text)
    if m:
        return {"lat": float(m.group(1)), "lon": float(m.group(2))}

    m = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*", text)
    if m:
        return {"lat": float(m.group(1)), "lon": float(m.group(2))}

    try:
        u = urllib.parse.urlparse(text)
        params = urllib.parse.parse_qs(u.query)
        for key in ("q", "query", "ll"):
            if key not in params:
                continue
            m = re.fullmatch(
                r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*",
                params[key][0],
            )
            if m:
                return {"lat": float(m.group(1)), "lon": float(m.group(2))}
    except ValueError:
        pass

    return None


def place_name(url: str) -> str:
    try:
        path = urllib.parse.urlparse(url).path
        parts = [p for p in path.split("/") if p]
        if "place" in parts:
            idx = parts.index("place")
            if idx + 1 < len(parts):
                return urllib.parse.unquote_plus(parts[idx + 1])
    except ValueError:
        pass
    return "Google Maps POI"


def valid_point(p):
    return (
        p
        and math.isfinite(p["lat"])
        and math.isfinite(p["lon"])
        and -90 <= p["lat"] <= 90
        and -180 <= p["lon"] <= 180
    )


def dedupe(points):
    seen = set()
    out = []
    for p in points:
        if not valid_point(p):
            continue
        key = (round(p["lat"], 6), round(p["lon"], 6))
        if key not in seen:
            seen.add(key)
            out.append({"lat": float(p["lat"]), "lon": float(p["lon"])})
    return out


def cap(points, n=MAX_CENTERS):
    if len(points) <= n:
        return points
    step = len(points) / n
    return [points[int(i * step)] for i in range(n)]


def haversine(a, b):
    r = math.pi / 180
    dlat = (b["lat"] - a["lat"]) * r
    dlon = (b["lon"] - a["lon"]) * r
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(a["lat"] * r)
        * math.cos(b["lat"] * r)
        * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def sample_line(points, spacing_km):
    points = dedupe(points)
    if len(points) < 2:
        return points
    spacing_km = max(0.25, float(spacing_km))
    out = [points[0]]
    for a, b in zip(points, points[1:]):
        steps = max(1, math.ceil(haversine(a, b) / spacing_km))
        for j in range(1, steps + 1):
            t = j / steps
            out.append(
                {
                    "lat": a["lat"] + (b["lat"] - a["lat"]) * t,
                    "lon": a["lon"] + (b["lon"] - a["lon"]) * t,
                }
            )
    return cap(dedupe(out))


def parse_route(text):
    text = (text or "").strip()
    if not text:
        return []

    try:
        obj = json.loads(text)
        geom = obj.get("geometry") if obj.get("type") == "Feature" else obj
        if geom and geom.get("type") == "LineString":
            return dedupe(
                [
                    {"lat": float(c[1]), "lon": float(c[0])}
                    for c in geom.get("coordinates", [])
                ]
            )
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    points = []
    for item in re.split(r"[\n;]+", text):
        p = parse_google_point(item)
        if p:
            points.append(p)
    return dedupe(points)


def point_in_ring(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        hit = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if hit:
            inside = not inside
        j = i
    return inside


def point_in_polygon(lon, lat, polygon):
    if not polygon or not point_in_ring(lon, lat, polygon[0]):
        return False
    return not any(point_in_ring(lon, lat, hole) for hole in polygon[1:])


def point_in_geometry(lon, lat, geom):
    if geom["type"] == "Polygon":
        return point_in_polygon(lon, lat, geom["coordinates"])
    if geom["type"] == "MultiPolygon":
        return any(point_in_polygon(lon, lat, p) for p in geom["coordinates"])
    return False


def geometry_bounds(geom):
    bounds = [float("inf"), float("inf"), float("-inf"), float("-inf")]

    def visit(node):
        if (
            isinstance(node, list)
            and len(node) >= 2
            and isinstance(node[0], (int, float))
        ):
            bounds[0] = min(bounds[0], node[0])
            bounds[1] = min(bounds[1], node[1])
            bounds[2] = max(bounds[2], node[0])
            bounds[3] = max(bounds[3], node[1])
            return
        if isinstance(node, list):
            for child in node:
                visit(child)

    visit(geom["coordinates"])
    return bounds


def sample_polygon(geom, spacing_km):
    b = geometry_bounds(geom)
    mid = (b[1] + b[3]) / 2
    dy = max(0.005, float(spacing_km) / 111.32)
    dx = dy / max(0.2, math.cos(mid * math.pi / 180))
    out = []

    y = b[1] + dy / 2
    while y <= b[3] and len(out) <= 1200:
        x = b[0] + dx / 2
        while x <= b[2] and len(out) <= 1200:
            if point_in_geometry(x, y, geom):
                out.append({"lat": y, "lon": x})
            x += dx
        y += dy

    if not out:
        out.append({"lat": (b[1] + b[3]) / 2, "lon": (b[0] + b[2]) / 2})
    return cap(out)


def boundary_centers(query, spacing_km):
    params = urllib.parse.urlencode(
        {
            "format": "geojson",
            "polygon_geojson": "1",
            "limit": "5",
            "countrycodes": "vn",
            "accept-language": "vi",
            "q": query,
        }
    )
    url = "https://nominatim.openstreetmap.org/search?" + params
    data = request_json(url)
    for feature in data.get("features", []):
        geom = feature.get("geometry")
        if geom and geom.get("type") in ("Polygon", "MultiPolygon"):
            return sample_polygon(geom, spacing_km), feature
    raise RuntimeError("Không tìm thấy polygon địa giới phù hợp.")


def split_keywords(raw):
    values = []
    for part in re.split(r"[\n;]+", raw or ""):
        part = part.strip()
        if part:
            values.append(part)
    return values


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://127.0.0.1:8080")
    p.add_argument("--mode", choices=["radius", "boundary", "route"], required=True)
    p.add_argument("--maps-url", default="")
    p.add_argument("--keywords", required=True)
    p.add_argument("--radius", type=int, default=5000)
    p.add_argument("--boundary-query", default="")
    p.add_argument("--boundary-spacing", type=float, default=5)
    p.add_argument("--route-input", default="")
    p.add_argument("--route-spacing", type=float, default=3)
    p.add_argument("--lang", default="vi")
    p.add_argument("--depth", type=int, default=10)
    p.add_argument("--zoom", type=int, default=15)
    p.add_argument("--max-time", type=int, default=900)
    p.add_argument("--email", action="store_true")
    p.add_argument("--fast-mode", action="store_true")
    p.add_argument("--out", default="action-output")
    args = p.parse_args()

    keywords = split_keywords(args.keywords)
    if not keywords:
        raise SystemExit("Cần ít nhất một từ khóa POI.")

    source = parse_google_point(args.maps_url)
    centers = []
    lat = ""
    lon = ""
    meta = {"mode": args.mode, "maps_url": args.maps_url, "keywords": keywords}

    if args.mode == "radius":
        if not valid_point(source):
            raise SystemExit("URL Google Maps không chứa tọa độ hợp lệ.")
        centers = [source]
        lat = str(source["lat"])
        lon = str(source["lon"])
        meta["source_point"] = source
    elif args.mode == "boundary":
        if not args.boundary_query.strip():
            raise SystemExit("Chế độ boundary cần boundary_query.")
        centers, feature = boundary_centers(
            args.boundary_query.strip(), args.boundary_spacing
        )
        meta["boundary"] = feature.get("properties", {})
    else:
        route = parse_route(args.route_input)
        if len(route) < 2:
            raise SystemExit("Chế độ route cần ít nhất 2 tọa độ.")
        centers = sample_line(route, args.route_spacing)
        meta["route_points"] = route

    payload = {
        "Name": place_name(args.maps_url) + " · " + ", ".join(keywords)[:80],
        "keywords": keywords,
        "centers": centers,
        "geo_mode": args.mode,
        "lang": args.lang,
        "zoom": args.zoom,
        "lat": lat,
        "lon": lon,
        "fast_mode": bool(args.fast_mode),
        "radius": args.radius,
        "depth": args.depth,
        "email": bool(args.email),
        "max_time": args.max_time,
        "proxies": [],
    }

    api = args.api.rstrip("/")
    created = request_json(api + "/api/v1/jobs", method="POST", payload=payload)
    job_id = created["id"]
    print("Created job:", job_id, flush=True)

    deadline = time.time() + max(args.max_time + 600, 900)
    status = "pending"
    while time.time() < deadline:
        job = request_json(api + "/api/v1/jobs/" + job_id)
        status = job.get("Status") or job.get("status") or ""
        print("Status:", status, flush=True)
        if status in ("ok", "failed"):
            break
        time.sleep(10)

    if status != "ok":
        raise SystemExit(f"Job kết thúc với trạng thái {status!r}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    download(api + f"/api/v1/jobs/{job_id}/export?format=csv", out / "results.csv")
    download(api + f"/api/v1/jobs/{job_id}/export?format=json", out / "results.json")
    download(
        api + f"/api/v1/jobs/{job_id}/export?format=geojson",
        out / "results.geojson",
    )

    meta.update(
        {
            "job_id": job_id,
            "status": status,
            "centers": centers,
            "radius_m": args.radius,
            "boundary_spacing_km": args.boundary_spacing,
            "route_spacing_km": args.route_spacing,
        }
    )
    (out / "request.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("Artifacts written to", out, flush=True)


if __name__ == "__main__":
    main()
