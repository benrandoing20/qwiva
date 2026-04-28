FROM python:3.11-slim

# System deps for pymupdf (PDF parsing) and lxml
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libxml2-dev \
    libxslt-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy pipeline code
COPY . .

# Non-root user for security
RUN useradd -m -u 1000 pipeline && chown -R pipeline:pipeline /app
USER pipeline

# Default command — Railway overrides this via the service start command
CMD ["python", "run_pipeline.py", "--source", "all"]
