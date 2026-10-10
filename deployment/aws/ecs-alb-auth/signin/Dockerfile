# This stage's frontend: the shared frontend/ image plus
# - signin.js: the Sign in button and the "sign in before a change" step, added to index.html;
# - nginx.conf + signin.css + signin-theme.js: the hosted login served under the app's address with its look.
# The app's code is unchanged.
ARG BASE
FROM ${BASE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY signin.js signin.css signin-theme.js /usr/share/nginx/html/
RUN cd /usr/share/nginx/html \
 && sed -i 's#</head>#<script src="/signin.js" defer></script></head>#' index.html \
 && grep -q 'signin.js' index.html \
 && cp assets/fraunces-latin-wght-normal-*.woff2 signin-fraunces.woff2 \
 && cp assets/geist-latin-wght-normal-*.woff2 signin-geist.woff2 \
 && nginx -t
