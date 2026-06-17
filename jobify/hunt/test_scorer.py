from dotenv import load_dotenv
load_dotenv()
from scorer import score_job

result = score_job(
    title="Staff Platform Engineer",
    company="Acme",
    location="Remote",
    description=(
        "We are building the developer platform that the rest of engineering "
        "builds on: internal service scaffolding, CI/CD defaults, and "
        "observability baked in. This role owns high-throughput services "
        "end-to-end — design, ship, on-call — across a multi-region "
        "Kubernetes + Kafka + PostgreSQL stack. Experience with distributed "
        "systems, platform/infra ownership, and SLO-driven reliability "
        "required."
    ),
)
print(result)
