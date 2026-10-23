# Multi-stage Dockerfile for ChromaVault
# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies with lockfile
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source code
COPY . .

# Run test suite & build production bundle
RUN npm run test
RUN npm run build

# Stage 2: Production runtime stage
FROM nginx:alpine-slim AS runner

# Copy custom Nginx configuration with range request support
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 3000;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    # Enable byte-range requests for CCAP remote streaming
    add_header Accept-Ranges bytes;

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Static assets cache configuration
    location ~* \.(?:css|js|svg|png|jpg|webp|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
EOF

# Copy static assets from build stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
