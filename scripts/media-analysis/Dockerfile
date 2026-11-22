FROM node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0

# A separate Linux toolchain; no changes to Windows application-control policy.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg procps python3 ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
RUN npm install --prefix /opt/rea rea-agents@6.10.1 --ignore-scripts --no-audit --no-fund
ENV VIDEO_TOOL_FFMPEG_PATH=/usr/bin/ffmpeg
WORKDIR /work
