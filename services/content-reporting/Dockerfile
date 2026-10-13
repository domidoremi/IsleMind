FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
RUN mkdir /data && chown node:node /data && chmod 700 /data
COPY --chown=node:node server.cjs store.cjs manage.cjs ./
USER node
ENV HOST=0.0.0.0 PORT=8787 REPORT_DB_PATH=/data/reports.sqlite NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.cjs"]
