# shared settings; sourced by the other scripts
export PROJECT="${GCP_PROJECT:-fixproof-zoo-sandbox}"
export REGION="${GCP_REGION:-us-central1}"
export REPO="zoo"
export IMAGE_BASE="$REGION-docker.pkg.dev/$PROJECT/$REPO/zoo"
export TOPIC="zoo-alerts"
export G="--project=$PROJECT"
PROJECT_NUMBER() { gcloud projects describe "$PROJECT" --format='value(projectNumber)'; }
sa() { echo "$1@$PROJECT.iam.gserviceaccount.com"; }
