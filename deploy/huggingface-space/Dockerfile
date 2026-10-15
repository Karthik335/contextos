# Hugging Face Space for ContextOS.
# The Space only holds this file and README.md: the app is built from the GitHub repo.
# To update the Space after pushing to GitHub: Space → Settings → "Factory rebuild"
# (a factory rebuild builds from scratch, so it clones the newest code).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/Karthik335/contextos.git /app
WORKDIR /app

RUN npm install --include=dev --no-audit --no-fund \
 && npm run build \
 && chown -R 1000:1000 /app

# Hugging Face runs the container as user 1000 and sends traffic to port 7860.
USER 1000
ENV HOME=/app PORT=7860 NODE_ENV=production
EXPOSE 7860
CMD ["npm", "start"]
