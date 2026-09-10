from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    secret_key: str = "dev-insecure-secret-key"
    google_places_api_key: str = ""
    google_maps_js_api_key: str = ""
    yelp_api_key: str = ""
    resend_api_key: str = ""
    email_from: str = ""
    app_base_url: str = "http://localhost:8000"
    # Off until a verified sending domain is set up in Resend. While off,
    # registration still collects an email but skips sending/blocking on it.
    require_email_verification: bool = False
    database_url: str = "sqlite:///./lunch.db"
    default_radius_m: int = 1500
    exclude_days: int = 7
    # Comma-separated emails that are auto-promoted to admin on register/login,
    # so there's a way to get an admin account without one already existing.
    admin_emails: str = ""
    # Power Automate (or any generic) webhook URL that POSTs a message into a
    # Microsoft Teams channel. Single global URL for now -- this is a beta,
    # gated to TEAMS_NOTIFY_EMAILS below, not yet a per-team admin setting.
    teams_webhook_url: str = ""
    # Comma-separated emails allowed to see/use the "Notify Teams" button,
    # same shape as ADMIN_EMAILS, while this feature is still being tried out.
    teams_notify_emails: str = ""

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    @property
    def teams_notify_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.teams_notify_emails.split(",") if e.strip()}


settings = Settings()
