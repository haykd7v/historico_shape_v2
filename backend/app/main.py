# ============================================================
# 🔹 IMPORTS E CONFIGURAÇÃO INICIAL
# ============================================================
# Aqui ficam:
# - imports do FastAPI
# - configuração de CORS
# - configuração de logging
# - setup do cliente BigQuery
#
# Essa parte é responsável por inicializar toda a aplicação.
# ============================================================

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.cloud import bigquery
from google.oauth2 import service_account
import json
import time
import logging
import os

# ============================================================
# 🔹 CONFIGURAÇÕES DE BANCO (BIGQUERY)
# ============================================================
# Define:
# - projeto
# - tabelas utilizadas
# - filtros de agência
#
# Qualquer mudança de fonte de dados começa aqui.
# ============================================================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Shape History API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

credentials = service_account.Credentials.from_service_account_file(
    os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "gcp-key.json")
)

client = bigquery.Client(
    credentials=credentials,
    project="ro-areatecnica-monitoramentov2"
)

PROJECT = "ro-areatecnica-monitoramentov2"
TRIPS_TABLE = f"`{PROJECT}.monitoramento_hist.gtfs_trips`"
ROUTES_TABLE = f"`{PROJECT}.gtfs.routes`"
SHAPES_TABLE = "`rj-smtr.planejamento.shapes_geom`"

AGENCY_IDS = ("22005", "22002", "22004", "22003")
AGENCY_FILTER = ", ".join(f'"{a}"' for a in AGENCY_IDS)

# ============================================================
# 🔹 CACHE EM MEMÓRIA
# ============================================================
# Cache simples para evitar consultas repetidas no BigQuery.
#
# Regras:
# - TTL de 10 minutos
# - chave baseada no route_short_name
#
# OBS:
# Não é persistente (reiniciar API limpa o cache)
# ============================================================

_cache: dict = {}
CACHE_TTL = 600  # segundos

# Shapes com menos pontos que este threshold são considerados stub/inválidos
MIN_COORDS_VALID = 10


def cache_get(key: str):
    """Retorna item do cache se ainda estiver válido."""
    entry = _cache.get(key)
    if not entry:
        return None

    if time.time() - entry["ts"] > CACHE_TTL:
        del _cache[key]
        return None

    return entry["data"]


def cache_set(key: str, data):
    """Salva item no cache em memória."""
    _cache[key] = {"ts": time.time(), "data": data}


def parse_geojson_field(value) -> dict | None:
    # ============================================================
# 🔹 HELPERS DE CONVERSÃO GEOJSON
# ============================================================
# Funções responsáveis por:
# - interpretar GeoJSON vindo do BigQuery
# - converter para formato Leaflet ([lat, lon])
#
# IMPORTANTE:
# - GeoJSON vem como [lon, lat]
# - Leaflet usa [lat, lon]
# ============================================================
    """
    Normaliza campo GeoJSON vindo do BigQuery.

    Pode chegar como:
      - dict
      - string JSON
      - None
    """
    if value is None:
        return None

    if isinstance(value, dict):
        return value

    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def geojson_point_to_latlon(value) -> list[float] | None:
    """
    Extrai [lat, lon] de um GeoJSON Point.
    GeoJSON vem como [lon, lat], então aqui invertemos.
    """
    geom = parse_geojson_field(value)
    if not geom:
        return None

    coords = geom.get("coordinates")
    if coords and len(coords) >= 2:
        return [coords[1], coords[0]]  # lon,lat -> lat,lon

    return None


def geojson_lines_to_latlon_list(value) -> list[list[float]]:
    """
    Converte GeoJSON LineString ou MultiLineString em uma lista achatada
    de coordenadas no formato Leaflet: [lat, lon].

    Casos suportados:
      - LineString
      - MultiLineString

    Retorno:
      [
        [lat, lon],
        [lat, lon],
        ...
      ]
    """
    geom = parse_geojson_field(value)
    if not geom:
        return []

    geom_type = geom.get("type")
    coords = geom.get("coordinates", [])

    # Caso 1: LineString -> [[lon, lat], [lon, lat], ...]
    if geom_type == "LineString":
        return [
            [pt[1], pt[0]]
            for pt in coords
            if isinstance(pt, list) and len(pt) >= 2
        ]

    # Caso 2: MultiLineString -> [[[lon, lat], ...], [[lon, lat], ...], ...]
    if geom_type == "MultiLineString":
        flattened: list[list[float]] = []
        for segment in coords:
            if not isinstance(segment, list):
                continue
            for pt in segment:
                if isinstance(pt, list) and len(pt) >= 2:
                    flattened.append([pt[1], pt[0]])
        return flattened

    return []
# ============================================================
# 🔹 ENDPOINT PRINCIPAL
# ============================================================
# Rota:
#   GET /shapes/history
#
# Responsável por:
# - buscar shapes da linha
# - aplicar deduplicação
# - selecionar melhores versões
# - preparar payload para frontend
#
# IMPORTANTE:
# Toda lógica de negócio está aqui (principalmente no SQL)
# ============================================================

@app.get("/shapes/history")
def get_shapes_history(
    route_short_name: str = Query(..., min_length=1, description="Número da linha ex: 348")
):
    """
    Retorna histórico de shapes de uma linha.

    Regras principais:
      1. Filtra a linha em rotas
      2. Busca trips e junta com shapes_geom
      3. Calcula quantidade de pontos da geometria
      4. Detecta se existe shape válido por direção
      5. Se existir shape válido numa direção, descarta os stubs daquela direção
      6. Escolhe o melhor shape por (direction_id, service_id)
      7. Converte a geometria para coordenadas compatíveis com Leaflet
    """
    route_short_name = route_short_name.strip().upper()
    cache_key = f"history_{route_short_name}"

    cached = cache_get(cache_key)
    if cached:
        logger.info(f"Cache HIT para {route_short_name}")
        return JSONResponse(content=cached)

    logger.info(f"Cache MISS — consultando BigQuery para {route_short_name}")
    t0 = time.time()

# ============================================================
# 🔹 QUERY PRINCIPAL (BIGQUERY)
# ============================================================
# Estrutura da query:
#
# 1. rotas → filtra linha
# 2. trips_base → base de trips
# 3. trips_with_geom → junta com geometria
# 4. ranked → deduplicação + ranking
#
# Regras importantes:
# - prioriza shapes com mais pontos
# - prioriza shapes vigentes
# - remove stubs quando existe shape válido
#
# OBS:
# Alterações de lógica devem ser feitas aqui
# ============================================================

    sql = f"""
    WITH rotas AS (
      /*
        Filtra primeiro a tabela de rotas.
        Isso reduz o volume do join com gtfs_trips.
      */
      SELECT DISTINCT
        route_id,
        route_short_name,
        route_long_name,
        agency_id
      FROM {ROUTES_TABLE}
      WHERE agency_id IN ({AGENCY_FILTER})
        AND route_short_name = @route_short_name
    ),

    trips_dedup AS (
      /*
        Deduplica trips por (shape_id, direction_id, feed_start_date, feed_end_date).
        Agrega service_ids como lista — não duplica por serviço.
        Mantém vigente prioritário e data mais recente.
      */
      SELECT
        t.shape_id,
        CAST(t.direction_id AS STRING)                   AS direction_id,
        t.feed_start_date,
        t.feed_end_date,
        STRING_AGG(DISTINCT t.service_id ORDER BY t.service_id) AS service_ids,
        r.route_short_name,
        r.route_long_name,
        r.agency_id
      FROM {TRIPS_TABLE} t
      INNER JOIN rotas r ON t.route_id = r.route_id
      WHERE t.shape_id IS NOT NULL
        AND CAST(t.direction_id AS STRING) IN ('0', '1')
      GROUP BY
        t.shape_id,
        CAST(t.direction_id AS STRING),
        t.feed_start_date,
        t.feed_end_date,
        r.route_short_name,
        r.route_long_name,
        r.agency_id
    ),

    shapes_best AS (
      /*
        Para cada shape_id, pega a geometria com MAIS pontos.
        Isso resolve o caso de shape_id duplicado na shapes_geom
        com versões stub e versões completas.
      */
      SELECT
        shape_id,
        ST_NUMPOINTS(shape)    AS geom_points,
        ST_ASGEOJSON(shape)    AS geometry_geojson,
        ST_ASGEOJSON(start_pt) AS start_pt_geojson,
        ST_ASGEOJSON(end_pt)   AS end_pt_geojson,
        ROW_NUMBER() OVER (
          PARTITION BY shape_id
          ORDER BY ST_NUMPOINTS(shape) DESC
        ) AS rn_geom
      FROM {SHAPES_TABLE}
    ),

    trips_with_geom AS (
      SELECT
        t.shape_id,
        t.direction_id,
        t.feed_start_date,
        t.feed_end_date,
        t.service_ids,
        t.route_short_name,
        t.route_long_name,
        t.agency_id,
        s.geom_points,
        s.geometry_geojson,
        s.start_pt_geojson,
        s.end_pt_geojson
      FROM trips_dedup t
      INNER JOIN shapes_best s
        ON t.shape_id = s.shape_id AND s.rn_geom = 1
    ),

    ranked AS (
      /*
        Ranking final por (direction_id):
        - shape válido primeiro (>= min_coords pontos)
        - vigente primeiro
        - mais pontos
        - feed_start_date mais recente
      */
      SELECT
        *,
        MAX(CASE WHEN geom_points >= @min_coords THEN 1 ELSE 0 END)
          OVER (PARTITION BY direction_id) AS has_valid_in_direction,
        ROW_NUMBER() OVER (
          PARTITION BY direction_id, shape_id
          ORDER BY
            CASE WHEN geom_points >= @min_coords THEN 1 ELSE 0 END DESC,
            CASE WHEN feed_end_date IS NULL THEN 1 ELSE 0 END DESC,
            geom_points DESC,
            feed_start_date DESC
        ) AS rn
      FROM trips_with_geom
    )

    SELECT
      shape_id,
      direction_id,
      feed_start_date,
      feed_end_date,
      service_ids,
      route_short_name,
      route_long_name,
      agency_id,
      geom_points,
      geometry_geojson,
      start_pt_geojson,
      end_pt_geojson
    FROM ranked
    WHERE rn = 1
      AND (
        has_valid_in_direction = 0
        OR geom_points >= @min_coords
      )
    ORDER BY
      direction_id,
      CASE WHEN feed_end_date IS NULL THEN 0 ELSE 1 END,
      feed_start_date DESC,
      geom_points DESC
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("route_short_name", "STRING", route_short_name),
            bigquery.ScalarQueryParameter("min_coords", "INT64", MIN_COORDS_VALID),
        ]
    )

    try:
        rows = list(client.query(sql, job_config=job_config).result())
    except Exception as e:
        logger.error(f"BigQuery error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    logger.info(f"[SQL final] Linha {route_short_name} retornou {len(rows)} shapes após ranking")
    logger.info(f"BigQuery retornou {len(rows)} linhas em {time.time() - t0:.2f}s")

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Nenhum shape encontrado para a linha {route_short_name}. "
                f"Verifique se a linha existe ou se há shapes na tabela shapes_geom."
            )
        )

    items = []
# ============================================================
# 🔹 TRANSFORMAÇÃO DOS DADOS (BACK → FRONT)
# ============================================================
# Converte dados do BigQuery para formato esperado pelo Angular.
#
# Aqui acontece:
# - conversão de coordenadas
# - cálculo de flags (vigente, stub)
# - normalização do payload
#
# IMPORTANTE:
# Qualquer alteração no formato do JSON deve ser feita aqui
# ============================================================

    for row in rows:
        r = dict(row)

        direction_id = str(r["direction_id"])
        coords = geojson_lines_to_latlon_list(r.get("geometry_geojson"))
        num_coords = len(coords)
        geom_points = r.get("geom_points") or 0

        logger.info(
            f"[DEBUG SHAPE] dir={direction_id} "
            f"shape={r.get('shape_id')} "
            f"service={r.get('service_id')} "
            f"geom_points={geom_points} "
            f"num_coords_render={num_coords} "
            f"start={r.get('feed_start_date')} "
            f"end={r.get('feed_end_date')}"
        )

        items.append({
            "shape_id": r["shape_id"],
            "direction_id": direction_id,
            "direction_label": "Ida" if direction_id == "0" else "Volta",
            "route_short_name": r["route_short_name"],
            "service_id": r.get("service_ids"),  # agregado como string separada por vírgula
            "route_long_name": r["route_long_name"],
            "agency_id": r["agency_id"],
            "feed_start_date": str(r["feed_start_date"]) if r["feed_start_date"] else None,
            "feed_end_date": str(r["feed_end_date"]) if r["feed_end_date"] else None,
            "vigente": r["feed_end_date"] is None,
            "coordinates": coords,
            "num_coords": num_coords,
            "geom_points": geom_points,
            "geom_warning": geom_points < MIN_COORDS_VALID,
            "start_pt": geojson_point_to_latlon(r.get("start_pt_geojson")),
            "end_pt": geojson_point_to_latlon(r.get("end_pt_geojson")),
        })

    # O SQL já devolve somente os melhores shapes por direção/serviço.
    items_dedup = items
# ============================================================
# 🔹 SEPARAÇÃO POR DIREÇÃO
# ============================================================
# direction_id:
# - "0" → Ida
# - "1" → Volta
#
# Frontend usa isso para renderizar abas separadas
# ============================================================

    ida = [i for i in items_dedup if i["direction_id"] == "0"]
    volta = [i for i in items_dedup if i["direction_id"] == "1"]

    logger.info(
        f"[Payload final] Linha {route_short_name} | "
        f"ida={len(ida)} | volta={len(volta)}"
    )

    payload = {
        "route_short_name": route_short_name,
        "total": len(items_dedup),
        "items": items_dedup,
        "ida": ida,
        "volta": volta,
    }

    cache_set(cache_key, payload)
    logger.info(f"Resposta montada em {time.time() - t0:.2f}s — {len(items_dedup)} shapes finais")
# ============================================================
# 🔹 RESPOSTA FINAL DA API
# ============================================================
# Estrutura retornada:
#
# {
#   route_short_name,
#   total,
#   items,
#   ida,
#   volta
# }
#
# Esse contrato é consumido diretamente pelo frontend.
# Qualquer mudança aqui impacta o Angular.
# ============================================================


    return JSONResponse(content=payload)


@app.get("/cache/clear")
def clear_cache():
    """Limpa o cache manualmente."""
    count = len(_cache)
    _cache.clear()
    return {"cleared": count}


@app.get("/health")
def health():
    """Endpoint simples de saúde da aplicação."""
    return {"status": "ok", "cache_entries": len(_cache)}