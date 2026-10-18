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

    # URL pública de la app (para enlaces en correos, ej. https://lab.midominio.com)
    APP_URL: str = ""

    # Correo saliente (SMTP)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""            # remitente; si se omite se usa SMTP_USER
    SMTP_FROM_NAME: str = ""       # nombre visible; si se omite, el del laboratorio
    SMTP_SSL: bool = False         # True para puerto 465 (SSL directo); False usa STARTTLS

    # Zona horaria de las clínicas: define qué es "hoy" en la agenda y los horarios de disponibilidad
    ZONA_HORARIA: str = "America/Mexico_City"

    # Portal del paciente
    PORTAL_TOKEN_DAYS: int = 30


settings = Settings()
