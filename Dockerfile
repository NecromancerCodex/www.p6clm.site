# ================================================================
# PMIS X + CLM — Frontend Dev Dockerfile
# 개발 환경: volume mount + HMR. 프로덕션은 별도 Dockerfile.prod 필요
# ================================================================

FROM node:22-alpine

# 비-root 사용자 (node 이미지 기본 제공)
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

COPY . .

USER node

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5173 || exit 1

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
