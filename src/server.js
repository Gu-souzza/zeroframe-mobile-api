import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirBanco } from './banco.js';
import { buscarProdutos, categorias, filtrosCatalogo, limite, normalizar, produtoPorId, produtos } from './catalogo.js';
import { criarContas } from './contas.js';
import { rotasLoja } from './loja.js';
import { cep, ErroHttp, exigir, formatarCep } from './validacao.js';

const PREFIXO = '/api/v1';
const LIMITE_CORPO = 64 * 1024;
const METODOS_COM_CORPO = ['POST', 'PUT', 'PATCH'];

function responder(resposta, status, corpo) {
  resposta.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  resposta.end(JSON.stringify(corpo));
}

async function lerCorpo(requisicao) {
  exigir(Number(requisicao.headers['content-length'] ?? 0) <= LIMITE_CORPO,
    413, 'O corpo da requisição excede 64 KiB.');
  const partes = [];
  let tamanho = 0;
  for await (const parte of requisicao.iterator({ destroyOnReturn: false })) {
    tamanho += parte.length;
    exigir(tamanho <= LIMITE_CORPO, 413, 'O corpo da requisição excede 64 KiB.');
    partes.push(parte);
  }
  if (!tamanho) return {};
  exigir(requisicao.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json',
    415, 'Envie o corpo em application/json.');
  let corpo;
  try {
    corpo = JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErroHttp(400, 'JSON inválido.');
  }
  exigir(corpo && typeof corpo === 'object' && !Array.isArray(corpo), 400, 'Envie um objeto JSON.');
  return corpo;
}

async function buscarCep(id, consultar) {
  const digitos = cep(id);
  let dados;
  try {
    const resposta = await consultar(`https://viacep.com.br/ws/${digitos}/json/`, { signal: AbortSignal.timeout(5000) });
    if (!resposta.ok) throw new Error('ViaCEP indisponível');
    dados = await resposta.json();
    if (!dados || typeof dados.uf !== 'string' && !dados.erro) throw new Error('Resposta inválida');
  } catch {
    throw new ErroHttp(502, 'Consulta de CEP indisponível. Preencha o endereço manualmente.');
  }
  exigir(!dados.erro, 404, 'CEP não encontrado. Preencha o endereço manualmente.');
  return {
    rua: dados.logradouro ?? '', bairro: dados.bairro ?? '',
    cidade: dados.localidade ?? '', uf: dados.uf, cep: formatarCep(digitos),
  };
}

function criarRotas(contas, consultarCep) {
  return [
    ['GET', '/health', () => ({ status: 'ok' })],
    ['GET', '/categorias', () => categorias],
    ['GET', '/produtos/filtros', filtrosCatalogo],
    ['GET', '/produtos/busca', ({ query }) => buscarProdutos(query)],
    ['GET', '/produtos/recomendados', ({ query }) => produtos.slice(0, limite(query))],
    ['GET', '/produtos', ({ query }) => {
      const filtro = query.get('marca') ?? query.get('secao');
      const marca = filtro === 'zero-frame' ? 'Zero Frame' : filtro;
      const lista = !marca || marca === 'recomendados'
        ? produtos : produtos.filter((produto) => normalizar(produto.marca) === normalizar(marca));
      return lista.slice(0, limite(query, filtro ? 8 : 100));
    }],
    ['GET', '/produtos/:id/recomendados', ({ id, query }) => {
      produtoPorId(id);
      return produtos.filter((produto) => produto.id !== id).slice(0, limite(query));
    }],
    ['GET', '/produtos/:id', ({ id }) => produtoPorId(id)],
    ['GET', '/cep/:id', ({ id }) => buscarCep(id, consultarCep)],
    ['POST', '/auth/registro', ({ corpo }) => contas.registrar(corpo), 201],
    ['POST', '/auth/login', ({ corpo }) => contas.entrar(corpo)],
    ['POST', '/auth/logout', ({ token }) => contas.sair(token)],
    ['GET', '/usuarios/me', ({ token }) => contas.perfil(token)],
    ['PATCH', '/usuarios/me', ({ token, corpo }) => contas.atualizarPerfil(token, corpo)],
    ['POST', '/usuarios/me/email', ({ token, corpo }) => contas.alterarEmail(token, corpo)],
    ['POST', '/usuarios/me/senha', ({ token, corpo }) => contas.alterarSenha(token, corpo)],
    ['DELETE', '/usuarios/me', ({ token }) => contas.excluir(token)],
    ...rotasLoja(contas),
  ].map(([metodo, caminho, executar, status = 200]) => ({
    metodo, caminho, executar, status, padrao: new RegExp(`^${caminho.replace(':id', '([^/]+)')}$`),
  }));
}

export function criarServidor({
  banco = process.env.DB_PATH ?? resolve('data', 'zeroframe.sqlite'),
  origens = (process.env.CORS_ORIGINS ?? '').split(',').map((origem) => origem.trim()).filter(Boolean),
  consultarCep = fetch,
} = {}) {
  const conexao = abrirBanco(banco);
  const rotas = criarRotas(criarContas(conexao), consultarCep);
  const servidor = createServer(async (requisicao, resposta) => {
    try {
      const { pathname, searchParams: query } = new URL(requisicao.url, 'http://localhost');
      exigir(pathname.startsWith(`${PREFIXO}/`), 404, 'Rota não encontrada.');
      const caminho = pathname.slice(PREFIXO.length);
      const compativeis = rotas.filter((rota) => rota.padrao.test(caminho));
      const exatas = compativeis.filter((rota) => rota.caminho === caminho);
      const candidatas = exatas.length ? exatas : compativeis;
      exigir(candidatas.length, 404, 'Rota não encontrada.');

      resposta.setHeader('Vary', 'Origin');
      const origem = requisicao.headers.origin;
      if (origens.includes(origem)) resposta.setHeader('Access-Control-Allow-Origin', origem);
      const metodos = candidatas.map(({ metodo }) => metodo);
      if (requisicao.method === 'OPTIONS') {
        exigir(origens.includes(origem), 403, 'Origem não autorizada.');
        resposta.setHeader('Access-Control-Allow-Methods', metodos.join(', '));
        resposta.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
        resposta.writeHead(204).end();
        return;
      }

      const rota = candidatas.find(({ metodo }) => metodo === requisicao.method);
      if (!rota) {
        resposta.setHeader('Allow', metodos.join(', '));
        throw new ErroHttp(405, 'Método não permitido.');
      }
      const [, segmento] = rota.padrao.exec(caminho);
      let id;
      try {
        id = segmento === undefined ? undefined : decodeURIComponent(segmento);
      } catch {
        throw new ErroHttp(400, 'Identificador inválido.');
      }
      const headers = requisicao.headers;
      const token = /^Bearer ([\w-]{43})$/i.exec(headers.authorization ?? '')?.[1];
      const corpo = METODOS_COM_CORPO.includes(rota.metodo) ? await lerCorpo(requisicao) : {};
      const resultado = await rota.executar({ id, query, token, corpo, headers });
      responder(resposta, rota.status, resultado);
    } catch (erro) {
      requisicao.resume();
      if (erro instanceof ErroHttp) responder(resposta, erro.status, { mensagem: erro.message });
      else {
        console.error(erro);
        responder(resposta, 500, { mensagem: 'Erro interno do servidor.' });
      }
    }
  });
  servidor.once('close', () => conexao.close());
  return servidor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3000);
  const servidor = criarServidor();
  servidor.listen(port, host, () => {
    console.log(`Zero Frame API em http://${host}:${servidor.address().port}${PREFIXO}`);
  });
}
