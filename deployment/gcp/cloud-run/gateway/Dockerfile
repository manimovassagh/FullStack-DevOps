# The gateway: routes /api/* to the backend and everything else to the frontend.
# nginx renders the template at start-up (envsubst), so the same image works for any BACKEND_URL / BACKEND_HOST / FRONTEND_URL / FRONTEND_HOST.
FROM nginx:1.30-alpine
RUN apk upgrade --no-cache
COPY default.conf.template /etc/nginx/templates/default.conf.template
# Only these four variables are substituted; nginx's own $variables stay as they are.
ENV NGINX_ENVSUBST_FILTER=^(BACKEND|FRONTEND)_(URL|HOST)$
