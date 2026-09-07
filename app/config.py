from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    secret_key: str = "dev-insecure-secret-key"
    google_places_api_key: str = ""
    google_maps_js_api_key: str = ""
    yelp_api_key: str = ""
    database_url: str = "sqlite:///./lunch.db"
    default_radius_m: int = 1500
    exclude_days: int = 7


settings = Settings()
