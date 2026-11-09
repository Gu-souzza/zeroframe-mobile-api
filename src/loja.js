import { randomUUID } from 'node:crypto';
import { normalizar, produtoPorId } from './catalogo.js';
import { endereco, exigir, texto } from './validacao.js';

const ok = { ok: true };
const MAX_QUANTIDADE = 10;
const centavos = (valor) => Math.round(valor * 100);

function porId(lista, id, mensagem) {
  const item = lista.find((valor) => valor.id === id);
  exigir(item, 404, mensagem);
  return item;
}

function quantidade(valor) {
  exigir(Number.isInteger(valor) && valor >= 1 && valor <= MAX_QUANTIDADE,
    400, `Informe uma quantidade entre 1 e ${MAX_QUANTIDADE}.`);
  return valor;
}

function itemCompra(dados) {
  exigir(dados && typeof dados === 'object' && !Array.isArray(dados), 400, 'Item inválido.');
  const produto = produtoPorId(texto(dados.produtoId, 'o ID do produto'));
  const tamanho = texto(dados.tamanho, 'o tamanho');
  exigir(produto.tamanhos.includes(tamanho), 400, 'Tamanho indisponível para este produto.');
  return { id: `${produto.id}-${tamanho}`, produto, tamanho, quantidade: quantidade(dados.quantidade) };
}

function exibirItem({ id, produto, tamanho, quantidade }) {
  const { nome, imagem, preco, precoOriginal } = produto;
  return { id, produtoId: produto.id, nome, imagem, tamanho, quantidade, preco, precoOriginal, selecionado: true };
}

function itensCompra(corpo, minimo) {
  exigir(Array.isArray(corpo.itens) && corpo.itens.length >= minimo && corpo.itens.length <= 100,
    400, `Envie de ${minimo} a 100 itens.`);
  const itens = corpo.itens.map(itemCompra);
  exigir(new Set(itens.map((item) => item.id)).size === itens.length, 400, 'Envie cada produto e tamanho uma vez.');
  return itens;
}

function resumo(itens) {
  const totalItens = itens.reduce((soma, { produto, quantidade }) =>
    soma + centavos(produto.precoOriginal ?? produto.preco) * quantidade, 0);
  const subtotal = itens.reduce((soma, { produto, quantidade }) =>
    soma + centavos(produto.preco) * quantidade, 0);
  return {
    quantidadeSelecionada: itens.reduce((soma, item) => soma + item.quantidade, 0),
    totalItens: totalItens / 100,
    desconto: (totalItens - subtotal) / 100,
    subtotal: subtotal / 100,
    envio: 0,
    total: subtotal / 100,
  };
}

function garantirPrincipal(lista) {
  if (lista.length && !lista.some((item) => item.principal)) lista[0].principal = true;
}

function salvarEndereco(dados, corpo, id) {
  const salvo = { ...endereco(corpo), id: id ?? randomUUID() };
  if (id) {
    porId(dados.enderecos, id, 'Endereço não encontrado.');
    dados.enderecos = dados.enderecos.map((item) => item.id === id ? salvo : item);
  } else {
    dados.enderecos.push(salvo);
  }
  if (salvo.principal) tornarPrincipal(dados, salvo.id);
  garantirPrincipal(dados.enderecos);
  return salvo;
}

function tornarPrincipal(dados, id) {
  porId(dados.enderecos, id, 'Endereço não encontrado.');
  for (const item of dados.enderecos) item.principal = item.id === id;
}

function carrinho(dados) {
  return dados.carrinho.map((item) => exibirItem(itemCompra(item)));
}

function adicionarItem(dados, corpo) {
  const item = itemCompra(corpo);
  const existente = dados.carrinho.find(({ id }) => id === item.id);
  const salvo = {
    id: item.id, produtoId: item.produto.id, tamanho: item.tamanho,
    quantidade: Math.min(MAX_QUANTIDADE, (existente?.quantidade ?? 0) + item.quantidade),
  };
  if (existente) Object.assign(existente, salvo);
  else dados.carrinho.push(salvo);
  return exibirItem(itemCompra(salvo));
}

function criarPedido(dados, corpo, chave) {
  const itens = itensCompra(corpo, 1);
  const assinatura = JSON.stringify([corpo.enderecoId ?? null, itens.map(({ id, quantidade }) => [id, quantidade])]);
  if (chave) {
    const anterior = dados.pedidos.find((registro) => registro.chave === chave);
    if (anterior) {
      exigir(anterior.assinatura === assinatura, 409, 'Esta chave já foi usada com outro pedido.');
      return anterior.pedido;
    }
  }
  const destino = corpo.enderecoId === undefined
    ? dados.enderecos.find((item) => item.principal)
    : porId(dados.enderecos, texto(corpo.enderecoId, 'o ID do endereço'), 'Endereço não encontrado.');
  const agora = new Date().toISOString();
  const pedido = {
    id: randomUUID(),
    numero: `#${String(dados.pedidos.length + 1).padStart(4, '0')}`,
    status: 'concluido',
    criadoEm: agora,
    finalizadoEm: agora,
    etapas: { recebido: agora },
    itens: itens.map(({ produto, tamanho, quantidade }) => ({
      produtoId: produto.id, nome: produto.nome, imagem: produto.imagem, tamanho, quantidade,
      precoUnitario: produto.preco, precoOriginalUnitario: produto.precoOriginal,
    })),
    envio: 0,
    total: resumo(itens).total,
  };
  if (destino) {
    const { id, principal, ...enderecoEntrega } = destino;
    pedido.enderecoEntrega = enderecoEntrega;
  }
  dados.pedidos.unshift({ pedido, chave, assinatura: chave ? assinatura : undefined });
  const comprados = new Map(itens.map((item) => [item.id, item.quantidade]));
  for (const item of dados.carrinho) item.quantidade -= comprados.get(item.id) ?? 0;
  dados.carrinho = dados.carrinho.filter((item) => item.quantidade > 0);
  return pedido;
}

const gruposPedidos = new Map([
  ['em-andamento', ['pendente', 'preparando', 'saiu_para_entrega']],
  ['entregues', ['entregue', 'concluido']],
  ['cancelados', ['cancelado']],
]);

const categoriasSuporte = ['pedido', 'produto', 'entrega', 'pagamento', 'conta', 'outro'];

export function rotasLoja(contas) {
  const ler = (acao) => (ctx) => contas.consultar(ctx.token, (dados) => acao(dados, ctx));
  const gravar = (acao) => (ctx) => contas.atualizar(ctx.token, (dados) => acao(dados, ctx));
  const enderecoPorId = (dados, id) => porId(dados.enderecos, id, 'Endereço não encontrado.');
  const pedidoPorId = (dados, id) => porId(dados.pedidos.map(({ pedido }) => pedido), id, 'Pedido não encontrado.');
  const prefixo = '/usuarios/me';

  return [
    ['GET', `${prefixo}/enderecos`, ler((dados) =>
      dados.enderecos.sort((a, b) => Number(b.principal) - Number(a.principal)))],
    ['POST', `${prefixo}/enderecos`, gravar((dados, { corpo }) => salvarEndereco(dados, corpo)), 201],
    ['GET', `${prefixo}/enderecos/:id`, ler((dados, { id }) => enderecoPorId(dados, id))],
    ['PUT', `${prefixo}/enderecos/:id`, gravar((dados, { corpo, id }) => salvarEndereco(dados, corpo, id))],
    ['PATCH', `${prefixo}/enderecos/:id`, gravar((dados, { corpo, id }) => {
      exigir(corpo.principal === true, 400, 'Envie principal como verdadeiro.');
      tornarPrincipal(dados, id);
      return enderecoPorId(dados, id);
    })],
    ['DELETE', `${prefixo}/enderecos/:id`, gravar((dados, { id }) => {
      enderecoPorId(dados, id);
      dados.enderecos = dados.enderecos.filter((item) => item.id !== id);
      garantirPrincipal(dados.enderecos);
      return ok;
    })],
    ['GET', `${prefixo}/buscas-recentes`, ler((dados) => dados.buscas)],
    ['POST', `${prefixo}/buscas-recentes`, gravar((dados, { corpo }) => {
      const termo = texto(corpo.termo, 'o termo');
      dados.buscas = [termo, ...dados.buscas.filter((item) => normalizar(item) !== normalizar(termo))].slice(0, 5);
      return dados.buscas;
    })],
    ['DELETE', `${prefixo}/buscas-recentes`, gravar((dados, { query }) => {
      const termo = normalizar(texto(query.get('termo'), 'o termo'));
      dados.buscas = dados.buscas.filter((item) => normalizar(item) !== termo);
      return dados.buscas;
    })],
    ['GET', '/favoritos', ler((dados) => dados.favoritos)],
    ['POST', '/favoritos', gravar((dados, { corpo }) => {
      const produto = produtoPorId(texto(corpo.produtoId, 'o ID do produto'));
      if (!dados.favoritos.includes(produto.id)) dados.favoritos.push(produto.id);
      return dados.favoritos;
    })],
    ['DELETE', '/favoritos/:id', gravar((dados, { id }) => {
      dados.favoritos = dados.favoritos.filter((item) => item !== id);
      return dados.favoritos;
    })],
    ['GET', '/carrinho', ler(carrinho)],
    ['POST', '/carrinho/itens', gravar((dados, { corpo }) => adicionarItem(dados, corpo)), 201],
    ['PATCH', '/carrinho/itens/:id', gravar((dados, { corpo, id }) => {
      const item = porId(dados.carrinho, id, 'Item do carrinho não encontrado.');
      item.quantidade = quantidade(corpo.quantidade);
      return exibirItem(itemCompra(item));
    })],
    ['DELETE', '/carrinho/itens/:id', gravar((dados, { id }) => {
      dados.carrinho = dados.carrinho.filter((item) => item.id !== id);
      return ok;
    })],
    ['DELETE', '/carrinho', gravar((dados) => {
      dados.carrinho = [];
      return ok;
    })],
    ['POST', '/carrinho/resumo', ler((dados, { corpo }) => resumo(itensCompra(corpo, 0)))],
    ['GET', '/pedidos', ler((dados, { query }) => {
      const status = query.get('status');
      const selecionados = gruposPedidos.get(status) ?? [status];
      const pedidos = dados.pedidos.map(({ pedido }) => pedido);
      return status && status !== 'todos' ? pedidos.filter((pedido) => selecionados.includes(pedido.status)) : pedidos;
    })],
    ['GET', '/pedidos/:id', ler((dados, { id }) => pedidoPorId(dados, id))],
    ['POST', '/pedidos', gravar((dados, { corpo, headers }) => {
      const valor = headers['idempotency-key'];
      const chave = valor === undefined ? undefined : texto(valor, 'a chave de idempotência');
      return criarPedido(dados, corpo, chave);
    }), 201],
    ['POST', '/suporte/mensagens', gravar((dados, { corpo }) => {
      exigir(categoriasSuporte.includes(corpo.categoria), 400, 'Categoria de suporte inválida.');
      if (corpo.pedidoId !== undefined) pedidoPorId(dados, texto(corpo.pedidoId, 'o ID do pedido'));
      const protocolo = randomUUID();
      dados.mensagens.push({
        protocolo, categoria: corpo.categoria, assunto: texto(corpo.assunto, 'o assunto'),
        mensagem: texto(corpo.mensagem, 'a mensagem', 5000), pedidoId: corpo.pedidoId, criadoEm: new Date().toISOString(),
      });
      return { protocolo };
    }), 201],
  ];
}
