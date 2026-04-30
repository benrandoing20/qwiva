FROM python:3.11-slim

# Minimal system deps — no tesseract, no OpenCV, no libgl
# Mistral OCR API handles all OCR server-side
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY pipeline.py .
COPY stage1_metadata.py .
COPY stage2_extract.py .
COPY stage3_chunk.py .
COPY stage4_embed_insert.py .

RUN mkdir -p checkpoints/pdf

CMD ["python", "pipeline.py"]
