#!/bin/bash
set -e

PROJECT="ro-areatecnica-monitoramentov2"
REGION="southamerica-east1"
SA_NAME="shape-history-reader"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
FUNCTION_NAME="shape-history"

echo ">>> Configurando projeto"
gcloud config set project $PROJECT

echo ">>> Criando Service Account"
gcloud iam service-accounts create $SA_NAME \
  --display-name="Shape History - Leitura BigQuery" \
  --project=$PROJECT

echo ">>> Concedendo permissão de leitura no BigQuery"
# Leitura de dados
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/bigquery.dataViewer"

# Permissão para executar jobs (rodar queries)
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/bigquery.jobUser"

echo ">>> Fazendo deploy da Cloud Function"
gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --runtime=python311 \
  --region=$REGION \
  --source=. \
  --entry-point=shape_history \
  --trigger-http \
  --allow-unauthenticated \
  --service-account=$SA_EMAIL \
  --memory=512MB \
  --timeout=60s \
  --set-env-vars GOOGLE_CLOUD_PROJECT=$PROJECT

echo ""
echo ">>> Deploy concluído!"
echo ">>> URL da função:"
gcloud functions describe $FUNCTION_NAME \
  --region=$REGION \
  --gen2 \
  --format="value(serviceConfig.uri)"
