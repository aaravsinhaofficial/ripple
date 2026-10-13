FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt && useradd --uid 10001 --create-home ripple
COPY server /app/server
RUN mkdir -p /app/data && chown ripple:ripple /app/data
USER ripple
EXPOSE 8000
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
