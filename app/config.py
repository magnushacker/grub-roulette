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


settings = Settings()
