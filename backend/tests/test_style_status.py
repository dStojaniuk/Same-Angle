import json

import pytest
from fastapi.routing import APIRoute

from same_angle import api


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
    result = handler()
    assert json.loads(result.body) == {"configured": configured}
    assert result.headers["cache-control"] == "no-store"
