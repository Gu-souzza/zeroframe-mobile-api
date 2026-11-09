import dados from './catalogo.json' with { type: 'json' };
import { exigir } from './validacao.js';

export const { produtos, categorias } = dados;
const produtosPorId = new Map(produtos.map((produto) => [produto.id, produto]));

export function produtoPorId(id) {
  const produto = produtosPorId.get(id);
  exigir(produto, 404, 'Produto não encontrado.');
  return produto;
}

export function normalizar(valor) {
  return valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function limite(query, padrao = 8) {
  const valor = query.get('limite');
  if (valor === null) return padrao;
  exigir(/^\d+$/.test(valor) && Number(valor) <= 100, 400, 'Use um limite entre 0 e 100.');
  return Number(valor);
}

const faixas = [
  { id: 'ate-100', rotulo: 'Até R$100', min: 0, max: 100 },
  { id: '100-500', rotulo: 'R$100 a R$500', min: 100, max: 500 },
  { id: 'acima-500', rotulo: 'Acima de R$500', min: 500, max: Infinity },
];

function opcoes(valores) {
  return [...new Set(valores)].map((valor) => ({ valor, rotulo: valor }));
}

export function filtrosCatalogo() {
  return {
    faixasPreco: faixas.map(({ id, rotulo }) => ({ valor: id, rotulo })),
    generos: [
      { valor: 'masculino', rotulo: 'Masculino' },
      { valor: 'feminino', rotulo: 'Feminino' },
      { valor: 'unissex', rotulo: 'Unissex' },
    ],
    categorias: categorias.map(({ id, nome }) => ({ valor: id, rotulo: nome })),
    tamanhos: opcoes(produtos.flatMap((produto) => produto.tamanhos)),
    cores: opcoes(produtos.flatMap((produto) => produto.cores).sort()),
    marcas: opcoes(produtos.map((produto) => produto.marca)),
  };
}

function valores(query, nome) {
  return query.getAll(nome).flatMap((valor) => valor.split(',')).map(normalizar).filter(Boolean);
}

function contem(filtro, candidatos) {
  return filtro.length === 0 || candidatos.some((valor) => filtro.includes(normalizar(valor)));
}

function precoLimite(query, nome, padrao) {
  const valor = query.get(nome);
  if (valor === null) return padrao;
  const preco = Number(valor);
  exigir(valor.trim() && Number.isFinite(preco) && preco >= 0, 400, 'Faixa de preço inválida.');
  return preco;
}

export function buscarProdutos(query) {
  const palavras = normalizar(query.get('q') ?? '').split(/\s+/).filter(Boolean)
    .map((palavra) => palavra.length > 3 && palavra.endsWith('s') ? palavra.slice(0, -1) : palavra);
  const min = precoLimite(query, 'precoMin', 0);
  const max = precoLimite(query, 'precoMax', Infinity);
  exigir(min <= max, 400, 'O preço mínimo deve ser menor ou igual ao máximo.');
  const faixasSelecionadas = valores(query, 'faixaPreco');
  const generos = valores(query, 'genero');
  const categoriasFiltro = valores(query, 'categoria');
  const tamanhos = valores(query, 'tamanho');
  const cores = valores(query, 'cor');
  const marcas = valores(query, 'marca');
  return produtos.filter((produto) => {
    const descricao = normalizar(`${produto.nome} ${produto.categoria} ${produto.categoriaId} ${produto.marca}`);
    return palavras.every((palavra) => descricao.includes(palavra)) &&
      produto.preco >= min && produto.preco <= max &&
      (!faixasSelecionadas.length || faixas.some((faixa) => faixasSelecionadas.includes(faixa.id) &&
        produto.preco >= faixa.min && produto.preco <= faixa.max)) &&
      (produto.genero === 'unissex' || contem(generos, [produto.genero])) &&
      contem(categoriasFiltro, [produto.categoriaId]) &&
      contem(tamanhos, produto.tamanhos) && contem(cores, produto.cores) &&
      contem(marcas, [produto.marca]);
  }).slice(0, limite(query, 100));
}
