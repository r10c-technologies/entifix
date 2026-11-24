# entifix's documentation instance (entifix ADR 0031 §3): the exported site
# under /docs and the controls' Storybook under /ui, one origin, served by the
# same dependency-free script the e2e drives. Static files and one Node
# process — no install step, so nothing in the image resolves a dependency.
#
# Built from examples/docs after `nx build @entifix/example-docs`:
#   docker build -t entifix/docs:local examples/docs
FROM node:26.4.0-slim@sha256:a1d9d671994fc2d26e297ac56b4b1522a8bc7fa71c43b14cd1b1fe6c5116f7dc

WORKDIR /srv
COPY serve.mjs ./
COPY out ./out
COPY ui ./ui

# A numeric user, so a runtime that refuses root can verify it without
# reading /etc/passwd. Cloud Run passes PORT; 8080 is its default.
USER 1000:1000
ENV PORT=8080
EXPOSE 8080
CMD ["node", "serve.mjs"]
