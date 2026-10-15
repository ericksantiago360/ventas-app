from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # App
    APP_NAME: str = "Ventas App"
    DEBUG: bool = False

    # MongoDB
    MONGODB_URL: str = "mongodb://mongo:27017"
    MONGODB_DB: str = "ventas"

    # JWT
    SECRET_KEY: str = "dev-secret-key-cambia-en-produccion"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 horas

    # Almacenamiento (PDFs, uploads)
    STORAGE_PATH: str = "/app/storage"


settings = Settings()
