FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install uv

# Copy dependency manifest first for layer caching
COPY pyproject.toml .

# Install production dependencies (no dev extras)
RUN uv pip install --system --no-cache -e .

# Copy application code
COPY backend/ ./backend/

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
