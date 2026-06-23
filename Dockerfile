FROM node:20-slim

WORKDIR /app

# ffmpeg/ffprobe for on-the-fly transcoding (PATH fallback if the npm static
# binaries fail to download during install).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
RUN cd server && npm install

COPY client/package*.json ./client/
RUN cd client && npm install

COPY . .

RUN cd client && npm run build

EXPOSE 3000

CMD ["node", "server/index.js"]
