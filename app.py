from __future__ import annotations

import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from ddgs import DDGS
from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / "data"
CACHE_FILE = CACHE_DIR / "search-cache.json"
RESULT_LIMIT = 10
REQUEST_TIMEOUT = 4
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/135.0 Safari/537.36"
)

app = Flask(__name__, template_folder="templates", static_folder="static")
cache_lock = threading.Lock()


def build_content_security_policy() -> str:
    directives = {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "https:", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
    }
    return "; ".join(
        f"{directive} {' '.join(sources)}" for directive, sources in directives.items()
    )


def build_meta_content_security_policy() -> str:
    directives = {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "https:", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
    }
    return "; ".join(
        f"{directive} {' '.join(sources)}" for directive, sources in directives.items()
    )


def ensure_cache_file() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not CACHE_FILE.exists():
        CACHE_FILE.write_text("{}", encoding="utf-8")


def load_cache() -> dict:
    ensure_cache_file()
    with cache_lock:
        try:
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}


def save_cache(cache: dict) -> None:
    ensure_cache_file()
    with cache_lock:
        CACHE_FILE.write_text(
            json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def normalize_query(query: str) -> str:
    return " ".join(query.strip().lower().split())


def absolute_url(base_url: str, candidate: str | None) -> str | None:
    if not candidate:
        return None

    candidate = candidate.strip()
    if not candidate:
        return None

    if candidate.startswith("data:"):
        return None

    return urljoin(base_url, candidate)


def extract_preview_image(page_url: str) -> str | None:
    try:
        response = requests.get(
            page_url,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
    except requests.RequestException:
        return None

    content_type = response.headers.get("content-type", "")
    if "text/html" not in content_type:
        return None

    soup = BeautifulSoup(response.text, "html.parser")

    selectors = [
        ("meta", {"property": "og:image"}, "content"),
        ("meta", {"name": "twitter:image"}, "content"),
        ("meta", {"property": "twitter:image"}, "content"),
        ("link", {"rel": "image_src"}, "href"),
    ]

    for tag_name, attrs, field in selectors:
        tag = soup.find(tag_name, attrs=attrs)
        if tag:
            return absolute_url(page_url, tag.get(field))

    for img in soup.find_all("img"):
        src = absolute_url(page_url, img.get("src"))
        if src:
            return src

    return None


def build_result_item(raw_result: dict) -> dict:
    url = raw_result.get("href") or raw_result.get("url") or ""
    hostname = urlparse(url).netloc

    return {
        "title": raw_result.get("title") or hostname or "Sin titulo",
        "url": url,
        "snippet": raw_result.get("body") or raw_result.get("snippet") or "",
        "source": hostname,
        "image": None,
    }


def search_web(query: str) -> list[dict]:
    with DDGS() as ddgs:
        raw_results = ddgs.text(query, region="wt-wt", safesearch="moderate", max_results=RESULT_LIMIT)

    results = []
    for raw_result in raw_results:
        item = build_result_item(raw_result)
        if item["url"]:
            results.append(item)

    with ThreadPoolExecutor(max_workers=5) as executor:
        images = list(
            executor.map(
                lambda item: extract_preview_image(item["url"]) if item["url"] else None,
                results,
            )
        )

    for item, image in zip(results, images):
        item["image"] = image

    return results


@app.get("/")
def index():
    return render_template("index.html", meta_csp=build_meta_content_security_policy())


@app.after_request
def apply_security_headers(response):
    response.headers["Content-Security-Policy"] = build_content_security_policy()
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


@app.get("/api/search")
def api_search():
    query = request.args.get("q", "")
    normalized_query = normalize_query(query)

    if not normalized_query:
        return jsonify({"error": "Debes escribir una busqueda."}), 400

    cache = load_cache()
    cached = cache.get(normalized_query)
    if cached:
        return jsonify(cached)

    results = search_web(query)
    payload = {
        "query": query,
        "count": len(results),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "results": results,
    }
    cache[normalized_query] = payload
    save_cache(cache)
    return jsonify(payload)


@app.get("/api/recent-searches")
def api_recent_searches():
    limit = request.args.get("limit", default=5, type=int)
    limit = max(1, min(limit, 20))

    cache = load_cache()
    recent_searches = sorted(
        cache.values(),
        key=lambda item: item.get("fetchedAt", ""),
        reverse=True,
    )[:limit]

    payload = []
    for item in recent_searches:
        payload.append(
            {
                "query": item.get("query", ""),
                "count": item.get("count", 0),
                "fetchedAt": item.get("fetchedAt", ""),
            }
        )

    return jsonify({"items": payload})


@app.post("/api/recent-searches/clear")
def api_clear_recent_searches():
    save_cache({})
    return jsonify({"message": "Historial borrado."})


@app.delete("/api/recent-searches/item")
def api_delete_recent_search_item():
    query = request.args.get("q", "")
    normalized_query = normalize_query(query)

    if not normalized_query:
        return jsonify({"error": "Debes indicar la busqueda a borrar."}), 400

    cache = load_cache()
    if normalized_query not in cache:
        return jsonify({"error": "La busqueda indicada no existe en el historial."}), 404

    del cache[normalized_query]
    save_cache(cache)
    return jsonify({"message": "Busqueda eliminada del historial."})


if __name__ == "__main__":
    ensure_cache_file()
    debug_enabled = os.getenv("FLASK_DEBUG", "0") == "1"
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))

    if debug_enabled:
        app.run(debug=True, host=host, port=port)
    else:
        from waitress import serve

        serve(app, host=host, port=port)