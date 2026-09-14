"""Shared Jinja2Templates instance so every router serves the same environment."""

import time

from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")

# Bumped on every process start (which reload=True triggers on every code
# change), so static assets get a fresh URL and browsers can't serve a
# stale cached copy of a CSS/JS file that's actually changed.
templates.env.globals["static_version"] = str(int(time.time()))
