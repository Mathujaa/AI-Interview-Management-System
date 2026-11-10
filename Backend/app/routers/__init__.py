# routers/__init__.py
"""Package initializer for API routers.
Exposes router modules so they can be imported and their routers registered.
"""

from . import (
    auth,
    candidates,
    interviews,
    feedback,
    dashboard,
    prediction,
    report,
)

__all__ = [
    "auth",
    "candidates",
    "interviews",
    "feedback",
    "dashboard",
    "prediction",
    "report",
]
