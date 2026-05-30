# Infraestructura (Fase 6)

- `docker-compose.yml` (raíz): entorno de desarrollo — PostgreSQL + Redis (+ ClickHouse en Fase 3).
- `infra/k8s/`: manifiestos de Kubernetes para producción (deployments por servicio,
  CronJobs para scrapers, RDS PostgreSQL, ClickHouse gestionado).
- Despliegue objetivo: AWS.

Por crear en la Fase 6.
