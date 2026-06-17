<!--
  cv.md — EXAMPLE persona (Alex Quinn). The master CV: the single source of
  truth for your resume CONTENT. The tailor may *select* and *reorder* from
  this when generating a tailored resume, but it never invents experience that
  isn't here. Keep it complete and factual; the article-digest.md proof-point
  list and the LaTeX resume template should stay consistent with the numbers
  here (the `cv_sync_check.py` drift detector compares them).

  This is markdown, read verbatim into LLM prompts. Everything below is
  fictional — replace it with your real history.
-->

# Alex Quinn — Master CV

**Email:** alex.quinn@example.com
**Phone:** +1-555-0142
**Location:** Denver, CO
**LinkedIn:** linkedin.com/in/alexquinn-example
**GitHub:** github.com/alexquinn-example
**Website:** alexquinn.example.dev

## Summary

Backend/platform engineer (~8 years) specializing in distributed systems and
developer-facing infrastructure. Owns services end-to-end and builds the
tooling other teams rely on.

## Technical Skills

- **Languages:** Go, Python, TypeScript, SQL
- **Systems:** distributed systems, microservices, event-driven architecture,
  gRPC/REST API design
- **Data:** PostgreSQL, Redis, Kafka, Airflow, ETL pipelines
- **Infra:** Kubernetes, Docker, Terraform, AWS (EC2, S3, RDS, Lambda), GCP
- **Observability:** Prometheus, Grafana, OpenTelemetry
- **Tooling:** GitHub Actions CI/CD, infrastructure-as-code, Linux

## Experience

### Northwind Software — Staff Software Engineer, Platform
*Remote (Denver, CO) · March 2021 – Present*

- Led the rebuild of the company's notification delivery pipeline on Kafka,
  cutting end-to-end p99 latency from ~4s to ~300ms at a sustained 20k
  events/sec.
- Designed and shipped an internal service-scaffolding platform (templated
  service + CI + observability defaults) adopted by 14 teams, reducing new-
  service setup from days to under an hour.
- Owned the multi-region PostgreSQL migration for the core API, including
  zero-downtime cutover and a read-replica routing layer.
- Established SLOs and on-call runbooks for the platform team; reduced
  page volume ~40% over two quarters through targeted reliability fixes.

### Brightwave Analytics — Senior Backend Engineer
*San Francisco, CA · June 2018 – February 2021*

- Built the ingestion and feature pipeline (Airflow + Kafka + S3) feeding the
  analytics product, serving ~200 features to downstream services at <50ms.
- Implemented the gRPC API gateway and authentication layer for the
  customer-facing platform.
- Migrated a monolith's billing module into an independently deployable
  service, improving deploy frequency and isolating a recurring incident
  source.

### Cedar Apps — Software Engineer
*San Francisco, CA · July 2015 – May 2018*

- Full-stack development on a B2B SaaS product (Python/Django backend,
  React frontend).
- Built the company's first CI pipeline and containerized the dev
  environment, cutting onboarding time for new engineers.

## Education

**University of Colorado Boulder** — B.S. Computer Science (2011–2015)

## Selected Projects

- **opensource-rate-limiter** — a small, well-documented Go token-bucket
  rate-limiting library; ~600 GitHub stars.
- **homelab-k8s** — a personal Kubernetes cluster running home-automation
  services, used as a sandbox for Terraform and observability experiments.
