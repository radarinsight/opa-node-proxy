require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const OPA_BASE_URL = process.env.OPA_BASE_URL;
const OPA_TOKEN = process.env.OPA_TOKEN;
const PORT = process.env.PORT || 3001;

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

function transformMessages(messages) {
  const sorted = [...messages].sort((a, b) => {
    return new Date(a.data || '').getTime() - new Date(b.data || '').getTime();
  });

  return sorted
    .map((message) => {
      const text = extractText(message.mensagem);
      if (!text) return null;

      const timestamp = message.data
        ? new Date(message.data).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : '??';

      return `[${timestamp}] ${classifyAuthor(message)}: ${text}`;
    })
    .filter(Boolean)
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

      const data = await opaGetWithBody(`${OPA_BASE_URL}/api/v1/atendimento`, body);
      const attendances = Array.isArray(data?.data) ? data.data : [];

      const list = attendances.map((item) => ({
        id: item._id,
        protocolo: item.protocolo || item._id,
        cliente: item.id_cliente || null,
        atendente: item.id_atendente || null,
        status: item.status || null,
        data_inicio: item.date || null,
        data_fim: item.fim || null,
        canal: item.canal || null,
        setor: item.setor || null,
      }));

      return res.json({
        attendances: list,
        total: list.length,
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

      return res.json({
        attendanceId: req.body.attendanceId,
        totalMessages: rawMessages.length,
        structuredText,
        rawMessages,
      });
    }

    return res.status(400).json({ error: `Ação inválida: ${action}` });
  } catch (error) {
    const message =
      error?.response?.data ||
      error?.message ||
      'Erro desconhecido';

    return res.status(500).json({
      error: typeof message === 'string' ? message : JSON.stringify(message),
    });
  }
});

app.listen(PORT, () => {
  console.log(`OPA proxy rodando na porta ${PORT}`);
});
