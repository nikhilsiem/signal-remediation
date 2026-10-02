# Pub/Sub settings (created by infra/setup-gcp.sh)

| Piece | Setting |
| --- | --- |
| Log sink `zoo-errors` | `resource.type="cloud_run_revision" AND resource.labels.service_name="zoo-shop" AND severity>=ERROR` |
| Topic | `zoo-alerts` |
| Push subscription `zoo-alerts-push` | endpoint `<FIXPROOF_API_URL>/webhooks/gcp`, auth on, SA `zoo-pubsub-push@<project>`, audience = endpoint |
| Alert policy `zoo-shop 5xx ratio` | 5xx ratio on `run.googleapis.com/request_count` > 5% for 2 min, channel Pub/Sub `zoo-alerts` |
