import os
from dataclasses import dataclass, field


def _list(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./airdial_agent.db"))
    allowed_models: list[str] = field(
        default_factory=lambda: _list("AIRDIAL_ALLOWED_MODELS", "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5")
    )
    max_tokens: int = field(default_factory=lambda: int(os.getenv("AIRDIAL_MAX_TOKENS", "32000")))
    monthly_cost_cap_usd: float = field(default_factory=lambda: float(os.getenv("AIRDIAL_MONTHLY_COST_CAP_USD", "0")))
    # "token:user_id" pairs. Beta-only; swap for Supabase Auth JWTs.
    tokens: dict[str, str] = field(
        default_factory=lambda: dict(p.split(":", 1) for p in _list("AIRDIAL_TOKENS") if ":" in p)
    )
    whatsapp_token: str = field(default_factory=lambda: os.getenv("WHATSAPP_TOKEN", ""))
    whatsapp_phone_number_id: str = field(default_factory=lambda: os.getenv("WHATSAPP_PHONE_NUMBER_ID", ""))
    whatsapp_verify_token: str = field(default_factory=lambda: os.getenv("WHATSAPP_VERIFY_TOKEN", ""))
    whatsapp_graph_version: str = field(default_factory=lambda: os.getenv("WHATSAPP_GRAPH_VERSION", "v21.0"))
    whatsapp_followup_template: str = field(default_factory=lambda: os.getenv("WHATSAPP_FOLLOWUP_TEMPLATE", ""))
    whatsapp_template_lang: str = field(default_factory=lambda: os.getenv("WHATSAPP_TEMPLATE_LANG", "en"))


settings = Settings()
