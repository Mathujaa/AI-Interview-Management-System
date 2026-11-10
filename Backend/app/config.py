from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # MongoDB Atlas settings
    MONGODB_URI: str = ""
    MONGODB_DATABASE: str = "ai_interview_db"

    # Security & Authentication settings
    JWT_SECRET_KEY: str = "change_this_secret"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # LLM / GenAI settings
    GEMINI_API_KEY: str = ""
    LLM_API_URL: str = ""

settings = Settings()
