import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Inicializa o SDK oficial da Google GenAI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/analyze-bpmn', async (req, res) => {
  const { bpmnXml, parsedSummary, userContext, analysisMode, fileName } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'Variável GEMINI_API_KEY não configurada no servidor (.env).'
    });
  }

  if (!bpmnXml || typeof bpmnXml !== 'string') {
    return res.status(400).json({
      error: 'Nenhum conteúdo de arquivo .bpmn foi enviado para análise.'
    });
  }

  // Configura cabeçalhos para streaming em tempo real (SSE)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const modeInstructions = {
    full: 'Realize um diagnóstico completo contemplando: (1) Resumo do Fluxo Atual (AS-IS), (2) Gargalos, Riscos e Retrabalhos Identificados, (3) Proposta de Otimização (TO-BE) com automação e controles, e (4) KPIs Recomendados com metas.',
    asis: 'Foque profundamente no diagnóstico AS-IS: mapeie as etapas, responsabilidades por raia/setor, pontos de falha, tarefas manuais, riscos operacionais e causas-raiz.',
    tobe: 'Foque no redesenho TO-BE: proponha regras de negócio, pontos de controle, gateways de decisão, integração sistêmica (ERP/APIs) e eliminação de gargalos.',
    kpis: 'Foque em governança e indicadores: defina KPIs específicos para este fluxo BPMN, fórmulas de cálculo, frequência de medição, responsáveis e metas.'
  };

  const systemInstruction = `
Você é um Consultor Sênior especialista em BPM (Business Process Management), notação BPMN 2.0 e Otimização de Processos Empresariais.
Sua tarefa é analisar arquivos XML BPMN enviados pelos usuários e fornecer diagnósticos técnicos, práticos e acionáveis em Português (Brasil).
Regras de resposta:
- Baseie-se estritamente nos elementos, raias (lanes), tarefas, eventos, gateways e fluxos presentes no arquivo BPMN e no contexto fornecido.
- Cite os nomes exatos das atividades, gateways e setores encontrados no diagrama.
- Estruture a resposta com títulos claros (##), listas objetivas e tabelas Markdown quando útil.
- Seja direto e evite introduções genéricas.
`.trim();

  const prompt = `
### DADOS DO ARQUIVO ANALISADO
- **Arquivo:** ${fileName || 'processo.bpmn'}
- **Foco da Análise:** ${modeInstructions[analysisMode] || modeInstructions.full}
- **Contexto Adicional do Usuário:** ${userContext?.trim() || 'Nenhum contexto extra informado. Analise com base na estrutura do diagrama BPMN.'}

### ELEMENTOS EXTRAÍDOS AUTOMATICAMENTE DO XML
${JSON.stringify(parsedSummary || {}, null, 2)}

### CONTEÚDO COMPLETO DO ARQUIVO BPMN (XML)
\`\`\`xml
${bpmnXml.slice(0, 120000)}
\`\`\`
`.trim();

  try {
    const responseStream = await ai.models.generateContentStream({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.35
      }
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Erro na API Gemini:', error);
    res.write(
      `data: ${JSON.stringify({
        error: error.message || 'Falha ao processar o diagrama no modelo Gemini Flash.'
      })}\n\n`
    );
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Servidor NovaTech BPMN + Gemini Flash rodando em http://localhost:${PORT}`);
});