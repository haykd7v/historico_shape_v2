# Shape History Viewer

Visualizador de histórico de shapes GTFS com diff de coordenadas.

---

## Backend (FastAPI + BigQuery)

### Estrutura



### Rodar localmente
```bash
pip install -r requirements.txt

# Autenticar no GCP
gcloud auth application-default login

uvicorn main:app --reload --port 8080

#Dependencias

npm install leaflet @types/leaflet