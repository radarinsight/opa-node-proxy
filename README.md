# opa-node-proxy

Proxy Node para integração com a Opa Suite, incluindo ajustes de CORS para consumo por aplicações no Lovable.

## Configuração rápida

1. Instale dependências:

```bash
npm install
```

2. Crie o arquivo `.env`:

```env
OPA_BASE_URL=https://SEU_DOMINIO_OPA
OPA_TOKEN=SEU_TOKEN_OPA
PORT=3001
OPA_ATTENDANT_ENDPOINTS=/api/v1/atendente,/api/v1/operador,/api/v1/usuario
ALLOWED_ORIGINS=*
```

3. Suba o proxy:

```bash
npm start
```

## Retorno de configuração para acesso da IA via Lovable

- O proxy permite acesso contínuo por padrão (`ALLOWED_ORIGINS=*`) para reduzir interrupções.
- Se quiser restringir, use por exemplo:
  `ALLOWED_ORIGINS=https://lovable.dev,https://*.lovable.app,http://localhost:3000,http://localhost:5173`
- O preflight (`OPTIONS`) aceita cabeçalhos dinâmicos solicitados pelo browser e responde `204`.
- Cabeçalhos padrão suportados: `Content-Type`, `Authorization`, `X-API-Key`, `X-Requested-With`.
