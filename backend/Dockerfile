FROM python:3.12-slim

# Dependencias de sistema para WeasyPrint
RUN apt-get update && apt-get install -y \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libffi-dev \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Directorios de almacenamiento para PDFs y uploads
RUN mkdir -p /app/storage/cotizaciones /app/storage/pedidos

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
