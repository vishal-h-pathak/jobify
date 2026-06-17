<!--
  article-digest.md — EXAMPLE persona (Alex Quinn). A curated set of
  "claim → evidence" proof points the tailor + cover-letter prompts pull from,
  PLUS an explicit list of which metrics you are confident about versus which
  you must NOT invent. This is your guardrail against an LLM fabricating
  impressive-sounding numbers. Keep the numbers here consistent with cv.md.

  Everything below is fictional — replace with your own proof points.
-->

# Alex Quinn — Article Digest (Proof Points + Metrics)

## The narrative through-line

Web backend → distributed systems → developer platforms. The thread is
making other engineers faster and systems more reliable: each role moved
one layer closer to the platform other teams build on.

## Northwind Software (2021–Present)

- **Rebuilt the notification pipeline on Kafka**, cutting p99 latency from
  ~4s to ~300ms at 20k events/sec. Cite when the JD mentions streaming,
  latency, or high-throughput systems.
- **Built an internal service-scaffolding platform** adopted by 14 teams;
  new-service setup dropped from days to under an hour. Cite for
  developer-experience / internal-tooling / platform roles.
- **Led a zero-downtime multi-region PostgreSQL migration** with a
  read-replica routing layer. Cite for data-infrastructure or reliability
  roles.
- **Reduced on-call page volume ~40%** over two quarters via reliability
  fixes and SLOs. Cite when the JD emphasizes operations / on-call.

## Brightwave Analytics (2018–2021)

- **Built the ingestion + feature pipeline** (Airflow + Kafka + S3) serving
  ~200 features at <50ms. Cite for data-platform / ML-infra roles.
- **Implemented the gRPC API gateway + auth layer.** Cite for API-design or
  platform roles.
- **Extracted the billing service from the monolith**, improving deploy
  frequency and isolating an incident source. Cite for migration / service
  decomposition work.

## Personal projects

- **opensource-rate-limiter** — a documented Go rate-limiting library (~600
  stars). Cite for open-source, library-design, or Go roles.
- **homelab-k8s** — a personal Kubernetes + Terraform sandbox. Cite for
  hands-on infra enthusiasm.

## Metrics we are confident about

- ~8 years total backend/platform experience.
- Notification pipeline: ~4s → ~300ms p99 at 20k events/sec.
- Service-scaffolding platform: adopted by 14 teams.
- Feature pipeline: ~200 features served at <50ms.
- ~40% on-call page reduction over two quarters.
- opensource-rate-limiter: ~600 GitHub stars.

## Metrics we DO NOT have (do not invent)

- Cost-savings dollar figures, revenue impact, or team-size-managed numbers
  unless they appear above. Do not invent uptime percentages, request volumes,
  or accuracy/throughput deltas not listed here or in cv.md. If a tailoring
  prompt shows an illustrative number, it is illustrative only — never claim
  a specific metric that is not in this file or cv.md.
