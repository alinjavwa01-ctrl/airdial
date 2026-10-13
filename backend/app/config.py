import os
from dataclasses import dataclass, field

MODES = ("best", "fast")


def _list(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


def _mode_models() -> dict[tuple[str, str], str]:
    """MODEL_<MODE>_<PROVIDER>, e.g. MODEL_BEST_ANTHROPIC=claude-opus-5-5."""
    defaults = {("anthropic", "best"): "claude-opus-5-5", ("anthropic", "fast"): "claude-sonnet-5-5"}
    out = dict(defaults)
    for provider in ("anthropic", "openai"):
        for mode in MODES:
            v = os.getenv(f"MODEL_{mode.upper()}_{provider.upper()}")
            if v is not None:
                out[(provider, mode)] = v.strip()
    return {k: v for k, v in out.items() if v}


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./airdial_agent.db"))
    # Failover order. A provider is used only if it has a key and a model for the mode.
    providers: list[str] = field(default_factory=lambda: _list("AIRDIAL_PROVIDERS", "anthropic,openai"))
    mode_models: dict[tuple[str, str], str] = field(default_factory=_mode_models)
    mode_effort: dict[str, str] = field(
        default_factory=lambda: {"best": os.getenv("EFFORT_BEST", "medium"), "fast": os.getenv("EFFORT_FAST", "low")}
    )
    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", ""))
    openai_api_key: str = field(default_factory=lambda: os.getenv("OPENAI_API_KEY", ""))
    openai_base_url: str = field(default_factory=lambda: os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"))
    max_tokens: int = field(default_factory=lambda: int(os.getenv("AIRDIAL_MAX_TOKENS", "16000")))
    monthly_cost_cap_usd: float = field(default_factory=lambda: float(os.getenv("AIRDIAL_MONTHLY_COST_CAP_USD", "0")))
    # Supabase Auth: customer sessions are verified against this project.
    supabase_url: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", ""))
    supabase_jwt_secret: str = field(default_factory=lambda: os.getenv("SUPABASE_JWT_SECRET", ""))
    # "token:user_id" pairs for internal testing.
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
