FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir yt-dlp==2026.08.19

WORKDIR /app
COPY app.py /app/app.py

EXPOSE 8080
CMD ["python", "/app/app.py"]
