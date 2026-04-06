require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const OPA_BASE_URL = process.env.OPA_BASE_URL;
const OPA_TOKEN = process.env.OPA_TOKEN;
const PORT = process.env.PORT || 3001;
const OPA_ATTENDANT_ENDPOINTS = (
  process.env.OPA_ATTENDANT_ENDPOINTS ||
  '/api/v1/atendente,/api/v1/operador,/api/v1/usuario'
)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function extractText(mensagem) {
  if (!mensagem) return '';
  if (typeof mensagem === 'string') return mensagem.trim();

  const titulo = typeof mensagem.titulo === 'string' ? mensagem.titulo.trim() : '';
  let opcoes = '';

  if (Array.isArray(mensagem.opcoes)) {
    const textos = mensagem.opcoes
      .map((item) => (item && typeof item.texto === 'string' ? item.texto.trim() : ''))
      .filter(Boolean);

    if (textos.length) {
      opcoes = `Opções: ${textos.join('; ')}`;
    }
  }

  return [titulo, opcoes].filter(Boolean).join(' | ');
}

function classifyAuthor(message) {
  if (message.id_user) return 'Cliente';
  if (message.id_atend) return 'Atendente';
  return 'Sistema';
}

function formatTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function isLikelyTechnicalAttendantId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value.trim());
}

function normalizeTextFromMessage(mensagem) {
  return extractText(mensagem);
}

function transformMessagesToConversation(messages) {
  const sorted = [...messages].sort((a, b) => {
    return new Date(a.data || '').getTime() - new Date(b.data || '').getTime();
  });

  return sorted
    .map((message) => {
      const text = normalizeTextFromMessage(message.mensagem);
      if (!text) return null;

      const timestamp = formatTimestamp(message.data);
      const author = classifyAuthor(message);

      return {
        timestamp,
        author,
        text,
      };
    })
    .filter(Boolean);
}

function transformMessages(messages) {
  return transformMessagesToConversation(messages)
    .map((message) => {
      const timestamp = message.timestamp || '??';
      return `[${timestamp}] ${message.author}: ${message.text}`;
    })
    .join('\n');
}

async function opaGetWithBody(url, body) {
  const response = await axios({
    url,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${OPA_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    data: body,
  });

  return response.data;
}

function normalizeAttendantRow(row) {
  if (!row || typeof row !== 'object') return null;

  const idCandidates = [
    row._id,
    row.id,
    row.id_atendente,
    row.id_operador,
    row.id_usuario,
    row.codigo,
  ];
  const nameCandidates = [
    row.nome,
    row.name,
    row.nome_completo,
    row.nomeCompleto,
    row.apelido,
    row.username,
    row.usuario,
    row.login,
    row.email,
  ];

  const id = idCandidates.find((value) => typeof value === 'string' && value.trim());
  const name = nameCandidates.find((value) => typeof value === 'string' && value.trim());

  if (!id || !name) return null;
  return { id: id.trim(), name: name.trim() };
}

async function fetchAttendantDirectory() {
  const errors = [];

  for (const endpoint of OPA_ATTENDANT_ENDPOINTS) {
    try {
      const data = await opaGetWithBody(`${OPA_BASE_URL}${endpoint}`, {
        options: { limit: 1000 },
      });
      const rows = Array.isArray(data?.data) ? data.data : [];
      const normalized = rows.map(normalizeAttendantRow).filter(Boolean);

      if (normalized.length) {
        return {
          endpoint,
          attendantsMap: new Map(normalized.map((item) => [item.id, item.name])),
          count: normalized.length,
        };
      }

      errors.push({
        endpoint,
        reason: 'empty_or_unrecognized_payload',
      });
    } catch (error) {
      errors.push({
        endpoint,
        reason: error?.response?.status
          ? `http_${error.response.status}`
          : error?.message || 'request_failed',
      });
    }
  }

  return {
    endpoint: null,
    attendantsMap: new Map(),
    count: 0,
    errors,
  };
}

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Proxy da Opa está no ar.' });
});

app.post('/opa', async (req, res) => {
  try {
    const { action } = req.body || {};

    if (action === 'list') {
      const body = {
        filter: {
          status: req.body.status || 'F',
          ...(req.body.dataInicio ? { dataInicialAbertura: req.body.dataInicio } : {}),
          ...(req.body.dataFim ? { dataFinalAbertura: req.body.dataFim } : {}),
        },
        options: {
          limit: req.body.limite || 100,
        },
      };

      const [data, directory] = await Promise.all([
        opaGetWithBody(`${OPA_BASE_URL}/api/v1/atendimento`, body),
        fetchAttendantDirectory(),
      ]);
      const attendances = Array.isArray(data?.data) ? data.data : [];

      const list = attendances.map((item) => ({
        id_atendente: item.id_atendente || null,
        id: item._id,
        protocolo: item.protocolo || item._id,
        cliente: item.id_cliente || null,
        atendente:
          (item.id_atendente && directory.attendantsMap.get(item.id_atendente)) ||
          item.atendente_nome ||
          null,
        atendente_raw: item.id_atendente || item.atendente_nome || null,
        atendente_is_technical_id: isLikelyTechnicalAttendantId(item.id_atendente || ''),
        status: item.status || null,
        data_inicio: item.date || null,
        data_fim: item.fim || null,
        canal: item.canal || null,
        setor: item.setor || null,
      }));

      return res.json({
        attendances: list,
        total: list.length,
        attendantsLookup: {
          endpoint: directory.endpoint,
          totalResolved: directory.count,
          unresolvedCount: list.filter((item) => !item.atendente && item.id_atendente).length,
          errors: directory.errors || [],
        },
      });
    }

    if (action === 'messages') {
      if (!req.body.attendanceId) {
        return res.status(400).json({ error: 'attendanceId é obrigatório.' });
      }

      const body = {
        filter: {
          id_rota: req.body.attendanceId,
        },
        options: {
          limit: 100,
        },
      };

      const data = await opaGetWithBody(`${OPA_BASE_URL}/api/v1/atendimento/mensagem`, body);
      const rawMessages = Array.isArray(data?.data) ? data.data : [];
      const structuredText = transformMessages(rawMessages);
      const structuredConversation = transformMessagesToConversation(rawMessages);

      return res.json({
        attendanceId: req.body.attendanceId,
        totalMessages: rawMessages.length,
        structuredText,
        rawText: structuredText,
        structuredConversation,
        rawMessages,
      });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });
  } catch (error) {
    const message = error?.response?.data || error?.message || 'Erro desconhecido';

    return res.status(500).json({
      error: typeof message === 'string' ? message : JSON.stringify(message),
    });
  }
});

app.listen(PORT, () => {
  console.log(`OPA proxy rodando na porta ${PORT}`);
});
