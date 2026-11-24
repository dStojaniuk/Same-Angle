import json

import pytest
from fastapi import Request
from fastapi.routing import APIRoute

from same_angle import api


def status_request(
    site: str = "same-origin",
    host: str = "localhost:5173",
    client: str = "127.0.0.1",
) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "path": "/api/style-status",
            "headers": [(b"host", host.encode()), (b"sec-fetch-site", site.encode())],
            "client": (client, 50000),
        }
    )


@pytest.mark.parametrize(
    ("key", "configured"), [(None, False), ("  ", False), ("secret-test-only", True)]
)
def test_style_status_reports_configuration_without_exposing_a_key(
    monkeypatch: pytest.MonkeyPatch, key: str | None, configured: bool
) -> None:
    if key is None:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    else:
        monkeypatch.setenv("OPENAI_API_KEY", key)

    handler = next(
        (
            route.endpoint
            for route in api.app.routes
            if isinstance(route, APIRoute) and route.path == "/api/style-status"
        ),
        None,
    )
    assert handler is not None, (
        "A browser needs a way to check live generation before uploading a photo."
    )
    result = handler(status_request())
    assert json.loads(result.body) == {"configured": configured}
    assert result.headers["cache-control"] == "no-store"


def test_enabled_codex_reports_when_the_cli_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENABLE_CODEX_IMAGEGEN", "1")
    monkeypatch.setenv("PATH", "")

    assert (
        json.loads(bytes(api.style_status(status_request()).body))["codex"] == "missing"
    )


def test_style_status_probes_codex_only_for_same_origin_local_browser(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENABLE_CODEX_IMAGEGEN", "1")
    monkeypatch.setenv("PATH", "")

    for site, host, client, expected in [
        ("same-origin", "localhost:5173", "127.0.0.1", "missing"),
        ("same-site", "localhost:5173", "127.0.0.1", None),
        ("cross-site", "localhost:5173", "127.0.0.1", None),
        ("same-origin", "example.test", "127.0.0.1", None),
        ("same-origin", "localhost:5173", "192.0.2.1", None),
    ]:
        request = status_request(site, host, client)
        assert (
            json.loads(bytes(api.style_status(request).body)).get("codex") == expected
        )
