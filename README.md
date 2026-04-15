# 🗺️ Shape History Viewer — Rio Ônibus

Visualizador de histórico de shapes GTFS com diff de coordenadas.
> Ferramenta interna desenvolvida para a **Rio Ônibus** — federação das empresas de ônibus do Rio de Janeiro — para rastreamento e auditoria histórica de shapes GTFS, com comparação visual de rotas e diff de coordenadas geográficas.

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Angular](https://img.shields.io/badge/Angular-17-DD0031?logo=angular&logoColor=white)](https://angular.io/)
[![BigQuery](https://img.shields.io/badge/BigQuery-GCP-4285F4?logo=google-cloud&logoColor=white)](https://cloud.google.com/bigquery)
[![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?logo=github-actions&logoColor=white)](https://github.com/features/actions)

---

## 📌 Sobre o Projeto

O **Shape History Viewer** é um sistema full-stack desenvolvido para a operadora de transporte Rio Ônibus, com o objetivo de **monitorar, versionar e comparar shapes GTFS** (General Transit Feed Specification) de linhas de ônibus ao longo do tempo.

A ferramenta consome dados históricos armazenados no **Google BigQuery** (dataset `rj-smtr` / `ro-areatecnica`) via uma **REST API JSON** construída em **FastAPI**, e exibe as rotas em um mapa interativo com **diff visual de coordenadas** — destacando pontos adicionados e removidos entre versões.

### Funcionalidades

- 🔍 Busca de linhas por número ou código
- 🗺️ Visualização do shape vigente em mapa interativo (Leaflet)
- 📅 Navegação por versões históricas da rota
- 🔴🟢 Diff geoespacial: coordenadas adicionadas (verde) vs removidas (vermelho)
- ⚡ Cache em memória no backend para reduzir chamadas ao BigQuery
- 🐳 Totalmente containerizado com Docker e Docker Compose
- 🔄 Pipeline de CI/CD com GitHub Actions

---

## Backend (FastAPI + BigQuery)
## 🏗️ Arquitetura

```
┌─────────────────────────┐         ┌────────────────────────────────┐         ┌────────────────────────────┐
│   Angular 17 + Leaflet  │  JSON   │   FastAPI (Python 3.11)        │   SQL   │   Google BigQuery (GCP)    │
│   SPA · localhost:4200  │ ──────▶ │   REST API · localhost:8080    │ ──────▶ │   dataset: rj-smtr         │
│   TypeScript · SCSS     │◀──────  │   + cache em memória           │◀──────  │   projeto: ro-areatecnica  │
└─────────────────────────┘  HTTP   └────────────────────────────────┘         └────────────────────────────┘
         ▲                                        ▲
         │                                        │
    Leaflet Maps                        google-cloud-bigquery
    (GeoJSON layers)                    SDK (Python)
```

### Fluxo de dados

### Estrutura
```
Usuário digita linha
        │
        ▼
Angular chama GET /shapes/{linha}
        │
        ▼
FastAPI verifica cache em memória
        │
  ┌─────┴─────┐
HIT          MISS
  │             │
  │             ▼
  │     Query SQL no BigQuery
  │     (dataset rj-smtr)
  │             │
  └──────┬──────┘
         │
         ▼
  Retorna JSON com array
  de coordenadas (lat/lng)
         │
         ▼
Angular renderiza no Leaflet
+ destaca diff de versões
```

---

## 🛠️ Stack Tecnológica

| Camada | Tecnologia | Detalhes |
|--------|-----------|----------|
| **Frontend** | Angular 17 + TypeScript | SPA com componentes standalone, lazy loading, reactive forms |
| **Mapas** | Leaflet.js | Renderização de GeoJSON, layers de diff (adições/remoções) |
| **Backend** | Python 3.11 + FastAPI | REST API assíncrona com Uvicorn, cache em memória, tipagem com Pydantic |
| **Banco de Dados** | Google BigQuery (GCP) | Queries SQL em datasets GTFS históricos — `rj-smtr` / `ro-areatecnica` |
| **Autenticação GCP** | Service Account + JSON Key | `gcp-key.json` com credenciais de acesso ao BigQuery |
| **Containerização** | Docker + Docker Compose | Multi-stage build, imagens separadas para frontend e backend |
| **CI/CD** | GitHub Actions | Pipeline automático de build e deploy via `.github/deploy/ci-cd.yaml` |
| **Formato de dados** | JSON / GeoJSON | Comunicação via REST API JSON; shapes em coordenadas geográficas |

---

## 📂 Estrutura do Projeto

```
historico-shapes/
├── .github/
│   └── deploy/
│       └── ci-cd.yaml              # Pipeline CI/CD — GitHub Actions
│
├── backend/
│   └── app/
│       ├── main.py                 # Aplicação FastAPI — endpoints REST, cache, queries BigQuery
│       ├── Dockerfile              # Imagem Python — build containerizado
│       ├── requirements.txt        # Dependências Python (fastapi, uvicorn, google-cloud-bigquery...)
│       ├── .env                    # Variáveis de ambiente — NÃO versionado
│       ├── gcp-key.json            # Service Account GCP — NÃO versionado
│       └── .dockerignore
│
├── frontend/
│   └── src/
│       └── app/
│           ├── services/
│           │   └── shape-history.service.ts    # HTTP client — chamadas à REST API JSON
│           ├── shape-history/
│           │   ├── shape-history.component.ts  # Lógica de diff e renderização Leaflet
│           │   ├── shape-history.component.html
│           │   └── shape-history.component.scss
│           ├── app.component.ts
│           ├── app.config.ts
│           ├── app.routes.ts
│           └── environments/
│               ├── environment.ts              # Dev — aponta para localhost:8080
│               └── environment.prod.ts         # Prod — URL da API em produção (GCP)
│   ├── angular.json
│   ├── Dockerfile                  # Imagem Angular — build containerizado
│   ├── package.json
│   └── tsconfig.json
│
├── deploy.sh                       # Script de deploy manual
└── .gitignore
```

---

## 🚀 Como Executar

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) e Docker Compose
- Conta GCP com acesso ao BigQuery (`rj-smtr`)
- Arquivo `gcp-key.json` com as credenciais do Service Account

### 🐳 Com Docker (recomendado)

```bash
# Clonar o repositório
git clone https://github.com/seu-usuario/historico-shapes.git
cd historico-shapes

# Subir todos os serviços
docker compose up --build
```

| Serviço | URL |
|---------|-----|
| Frontend (Angular) | http://localhost:4200 |
| Backend (FastAPI) | http://localhost:8080 |
| Docs da API (Swagger) | http://localhost:8080/docs |

### 💻 Sem Docker (desenvolvimento local)

#### Backend

### Rodar localmente
```bash
cd backend

# Instalar dependências Python
pip install -r requirements.txt

# Autenticar no GCP
# Opção 1 — Autenticar via gcloud (ADC)
gcloud auth application-default login

uvicorn main:app --reload --port 8080
# Opção 2 — Usar service account JSON
export GOOGLE_APPLICATION_CREDENTIALS=app/gcp-key.json

# Iniciar o servidor FastAPI
uvicorn app.main:app --reload --port 8080
```

#### Frontend

```bash
cd frontend

# Instalar dependências Node
npm install
npm install leaflet @types/leaflet

# Iniciar em modo de desenvolvimento
ng serve
# Acesse: http://localhost:4200
```

---

## ⚙️ Variáveis de Ambiente

Crie o arquivo `backend/app/.env` com as seguintes variáveis:

```env
# Google Cloud Platform
GCP_PROJECT_ID=rj-smtr
BIGQUERY_DATASET=ro-areatecnica
GOOGLE_APPLICATION_CREDENTIALS=gcp-key.json

# API
API_PORT=8080
CACHE_TTL_SECONDS=300
```

> ⚠️ **Nunca versione** `gcp-key.json` ou `.env`. Ambos estão no `.gitignore`.

---

## 🔌 Endpoints da API

A API REST expõe dados em formato **JSON** consumido pelo frontend Angular.

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/shapes/{linha}` | Retorna o shape vigente da linha (GeoJSON) |
| `GET` | `/shapes/{linha}/historico` | Lista todas as versões históricas |
| `GET` | `/shapes/{linha}/diff?v1={data1}&v2={data2}` | Diff de coordenadas entre duas versões |
| `GET` | `/health` | Health check do serviço |

**Exemplo de resposta JSON:**

```json
{
  "linha": "485",
  "versao": "2024-03-15",
  "coordenadas": [
    { "lat": -22.9068, "lng": -43.1729, "status": "mantido" },
    { "lat": -22.9075, "lng": -43.1740, "status": "adicionado" },
    { "lat": -22.9082, "lng": -43.1755, "status": "removido" }
  ],
  "total_pontos": 312,
  "fonte": "BigQuery · rj-smtr.ro-areatecnica"
}
```

---

## 🔄 CI/CD — GitHub Actions

O pipeline está configurado em `.github/deploy/ci-cd.yaml` e executa automaticamente:

```
Push → main
      │
      ├── Build imagem Docker (backend)
      ├── Build imagem Docker (frontend)
      ├── Autenticação na GCP (Service Account JSON)
      └── Deploy no ambiente de produção
```

Para deploy manual:

```bash
./deploy.sh
```

---

## 📦 Dependências

### Backend (Python)

```
fastapi                  # Framework REST API assíncrono
uvicorn                  # ASGI server de alta performance
google-cloud-bigquery    # SDK oficial GCP para queries no BigQuery
pydantic                 # Validação de dados e tipagem (integrado ao FastAPI)
python-dotenv            # Carregamento de variáveis de ambiente
```

### Frontend (Node / Angular)

```
@angular/core            # Framework SPA
@angular/common/http     # HTTP Client para consumo da REST API JSON
leaflet                  # Mapas interativos e renderização GeoJSON
@types/leaflet           # Tipagem TypeScript para Leaflet
```

---

## 🔑 Palavras-chave

`REST API` · `JSON` · `GCP` · `Google Cloud Platform` · `BigQuery` · `FastAPI` · `Python` · `Angular` · `TypeScript` · `Docker` · `Docker Compose` · `CI/CD` · `GitHub Actions` · `Leaflet` · `GeoJSON` · `GTFS` · `Geoespacial` · `Service Account` · `Microservices` · `Containerização` · `Cache` · `Pydantic` · `Uvicorn` · `SPA` · `Full-Stack` · `Data Engineering` · `Cloud` · `API Integration`

---

## 🏢 Contexto

Projeto desenvolvido para a **Rio Ônibus** — entidade que representa as empresas operadoras do sistema de transporte por ônibus do município do Rio de Janeiro. Os dados são gerenciados pelo dataset público `rj-smtr` hospedado no **Google BigQuery (GCP)**.

---

#Dependencias
npm install leaflet @types/leaflet

## 📄 Licença

Projeto de uso interno desenvolvido para Rio Ônibus. Todos os direitos reservados.
