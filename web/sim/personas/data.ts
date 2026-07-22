/**
 * Shared Alex Quinn persona content (session-prompt 45, task 2: "Alex Quinn
 * data only"), condensed from `profile.example/` for use inside the chat
 * loop's scripted user turns. Every persona answers with content grounded
 * in this same underlying person — only the delivery style differs.
 */

// Fix D (session 58): a shared literal so every persona's "name" topic
// answer (classifyQuestion.ts) grounds in the same underlying person.
export const ALEX_QUINN_NAME = "Alex Quinn" as const;

export const ALEX_QUINN_ANCHOR = {
  current_title: "Staff Software Engineer, Platform",
  current_company: "Northwind Software",
  years_in_role: "5 years",
} as const;

export const ALEX_QUINN_RESUME_MARKDOWN = `# Alex Quinn — Resume

**Email:** alex.quinn@example.com
**Location:** Denver, CO

## Summary
Backend/platform engineer (~8 years) specializing in distributed systems and developer-facing infrastructure.

## Experience
### Northwind Software — Staff Software Engineer, Platform (2021–Present)
- Rebuilt the notification pipeline on Kafka, cutting p99 latency from ~4s to ~300ms at 20k events/sec.
- Built an internal service-scaffolding platform adopted by 14 teams.
- Owned the multi-region PostgreSQL migration for the core API.

### Brightwave Analytics — Senior Backend Engineer (2018–2021)
- Built the ingestion/feature pipeline (Airflow + Kafka + S3) serving ~200 features at <50ms.
- Implemented the gRPC API gateway and auth layer.

## Skills
Go, Python, TypeScript, PostgreSQL, Redis, Kafka, Kubernetes, Docker, Terraform, AWS.

## Education
B.S. Computer Science, University of Colorado Boulder.
`;
