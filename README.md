# Shape History Viewer

Visualizador de histórico de shapes GTFS com diff de coordenadas.

---

## Backend (FastAPI + BigQuery)

### Estrutura
```
shape-history-api/
├── main.py
├── requirements.txt
└── Dockerfile
```

### Rodar localmente
```bash
pip install -r requirements.txt

# Autenticar no GCP
gcloud auth application-default login

uvicorn main:app --reload --port 8080
```

### Endpoints

| Método | Endpoint | Parâmetros | Descrição |
|--------|----------|------------|-----------|
| GET | `/routes` | `search=348` | Busca linhas por route_short_name |
| GET | `/trips` | `route_id=xxx` | Lista trips vigentes de uma rota |
| GET | `/shapes/history` | `route_short_name=348` | Retorna shape vigente + histórico |
| GET | `/shapes/compare` | `shape_a`, `version_a`, `shape_b`, `version_b` | Diff de coordenadas entre dois shapes |
| GET | `/health` | — | Health check |

### Deploy no Cloud Run
```bash
gcloud builds submit --tag gcr.io/ro-areatecnica-monitoramentov2/shape-history-api

gcloud run deploy shape-history-api \
  --image gcr.io/ro-areatecnica-monitoramentov2/shape-history-api \
  --platform managed \
  --region southamerica-east1 \
  --allow-unauthenticated \
  --service-account <SA_COM_PERMISSAO_BIGQUERY>
```

A service account precisa da role `roles/bigquery.dataViewer` nos datasets:
- `monitoramento_hist`
- `gtfs`
- `shape_linhas`

---

## Frontend (Angular + Leaflet)

### Dependências
```bash
npm install leaflet @types/leaflet
```

### environment.ts
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8080'  // trocar pela URL do Cloud Run em prod
};
```

### Adicionar ao angular.json (assets + styles)
```json
"styles": [
  "node_modules/leaflet/dist/leaflet.css"
],
"assets": [
  { "glob": "**/*", "input": "node_modules/leaflet/dist/images", "output": "assets/leaflet" }
]
```

### Corrigir ícones do Leaflet no Angular
No `app.component.ts` ou no próprio componente:
```typescript
import * as L from 'leaflet';

const iconDefault = L.icon({
  iconUrl: 'assets/leaflet/marker-icon.png',
  shadowUrl: 'assets/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = iconDefault;
```

### Registrar no app.module.ts (ou routes)
```typescript
import { ShapeHistoryComponent } from './shape-history/shape-history.component';
// standalone component — importar diretamente nas routes ou no AppModule
```

---

## Fluxo de dados

```
Usuário digita "348"
  → GET /routes?search=348
  → Usuário seleciona a linha
  → GET /shapes/history?route_short_name=348
  → Retorna: { vigente: ShapeVersion, historico: ShapeVersion[] }
  → Mapa renderiza shape vigente (azul)
  → Usuário seleciona versão anterior para comparar
  → GET /shapes/compare?shape_a=...&version_a=...&shape_b=...&version_b=...
  → Retorna: diff { added, removed, unchanged }
  → Mapa renderiza shape anterior (vermelho tracejado) + marcadores de diff
```

## Lógica de versões

- **Vigente**: `feed_end_date IS NULL`
- **Histórico**: `feed_end_date IS NOT NULL`, ordenado por `feed_start_date DESC`
- **Filtro ônibus**: join com `gtfs.routes` filtrando `agency_id IN ("22005","22002","22004","22003")`
- **Join shapes↔trips**: via `feed_version` + `feed_start_date`
