import pytest

from app.config import Settings, ensure_private_url


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8000",
        "http://model:8000",
        "http://10.10.0.5:8000",
        "https://inference.internal",
        "http://translator.default.svc.cluster.local:8000",
    ],
)
def test_private_inference_urls_are_accepted(url: str) -> None:
    ensure_private_url(url)


def test_public_inference_url_is_rejected_by_default() -> None:
    with pytest.raises(ValueError, match="private host"):
        ensure_private_url("https://public-model.example.com")


def test_short_production_api_key_is_rejected() -> None:
    settings = Settings(environment="production", api_key="short")
    with pytest.raises(ValueError, match="at least 32"):
        settings.validate()
