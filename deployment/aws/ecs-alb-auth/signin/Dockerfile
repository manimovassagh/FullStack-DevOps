# This stage's frontend: the shared frontend/ image plus signin.js (the Sign in button and the "sign in before a
# change" step). The app's code is unchanged; the script is added to index.html at build time.
ARG BASE
FROM ${BASE}
COPY signin.js /usr/share/nginx/html/signin.js
RUN sed -i 's#</head>#<script src="/signin.js" defer></script></head>#' /usr/share/nginx/html/index.html \
 && grep -q 'signin.js' /usr/share/nginx/html/index.html
