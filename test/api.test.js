import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { criarServidor } from '../src/server.js';

async function iniciar(opcoes) {
  const servidor = criarServidor(opcoes);
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const base = `http://127.0.0.1:${servidor.address().port}/api/v1`;

  return {
    async chamar(caminho, status, { metodo = 'GET', corpo, token, headers = {} } = {}) {
      const resposta = await fetch(base + caminho, {
        method: metodo,
        headers: {
          ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: JSON.stringify(corpo),
      });
      const dados = resposta.status === 204 ? null : await resposta.json();
      assert.equal(resposta.status, status, JSON.stringify(dados));
      return { dados, headers: resposta.headers };
    },
    async fechar() {
      const fechou = once(servidor, 'close');
      servidor.close();
      await fechou;
    },
  };
}

const cliente = {
  nome: 'Cliente Exemplo',
  email: 'cliente@example.com',
  telefone: '11987654321',
  senha: 'teste123',
};
const item = { produtoId: '2', tamanho: 'M', quantidade: 2 };

test('expõe o catálogo, valida métodos e adapta a resposta do ViaCEP', async (t) => {
  const origem = 'http://localhost:8081';
  const api = await iniciar({
    banco: ':memory:',
    origens: [origem],
    consultarCep: async (url) => {
      assert.equal(url, 'https://viacep.com.br/ws/01001000/json/');
      return Response.json({ logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' });
    },
  });
  t.after(api.fechar);
  assert.deepEqual((await api.chamar('/health', 200)).dados, { status: 'ok' });
  assert.equal((await api.chamar('/health', 405, { metodo: 'POST' })).headers.get('allow'), 'GET');
  assert.equal((await api.chamar('/produtos/busca?q=CAL%C3%87ADOS&precoMax=1050', 200)).dados[0].id, '7');
  assert.equal((await api.chamar('/produtos?marca=zero-frame', 200)).dados.length, 2);
  assert.equal((await api.chamar('/categorias', 200)).dados.length, 6);
  assert.equal((await api.chamar('/produtos/ausente', 404)).dados.mensagem, 'Produto não encontrado.');
  assert.equal((await api.chamar('/cep/01001-000', 200)).dados.cidade, 'São Paulo');
  await api.chamar('/cep/123', 400);
  const preflight = await api.chamar('/usuarios/me', 204, { metodo: 'OPTIONS', headers: { Origin: origem } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), origem);
  await api.chamar('/usuarios/me', 403, { metodo: 'OPTIONS', headers: { Origin: 'https://example.com' } });
});

test('persiste o checkout sem duplicação e separa dados por conta', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'zeroframe-'));
  const banco = join(pasta, 'teste.sqlite');
  let api = await iniciar({ banco });
  try {
    const { dados: sessao } = await api.chamar('/auth/registro', 201, { metodo: 'POST', corpo: cliente });
    const { token } = sessao;
    assert.equal(sessao.usuario.email, cliente.email);
    assert.equal(sessao.usuario.senha, undefined);
    await api.chamar('/auth/registro', 409, { metodo: 'POST', corpo: cliente });
    await api.chamar('/usuarios/me', 401);
    const login = await api.chamar('/auth/login', 200, { metodo: 'POST', corpo: cliente });
    const { dados: outro } = await api.chamar('/auth/registro', 201, {
      metodo: 'POST', corpo: { ...cliente, email: 'outro@example.com' },
    });

    const { dados: destino } = await api.chamar('/usuarios/me/enderecos', 201, {
      metodo: 'POST', token,
      corpo: { rua: 'Praça da Sé', numero: '10', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP', cep: '01001000' },
    });
    assert.equal(destino.principal, true);
    await api.chamar(`/usuarios/me/enderecos/${destino.id}`, 404, { token: outro.token });
    await api.chamar('/favoritos', 200, { metodo: 'POST', token, corpo: { produtoId: '2' } });
    assert.deepEqual((await api.chamar('/favoritos', 200, { token: outro.token })).dados, []);
    await api.chamar('/carrinho/itens', 400, { metodo: 'POST', token, corpo: { ...item, tamanho: '42' } });
    await api.chamar('/carrinho/itens', 201, { metodo: 'POST', token, corpo: { ...item, quantidade: 3 } });
    const vazio = await api.chamar('/carrinho/resumo', 200, { metodo: 'POST', token, corpo: { itens: [] } });
    assert.equal(vazio.dados.total, 0);
    const compra = {
      metodo: 'POST', token, corpo: { itens: [{ ...item, precoUnitario: 1 }] },
      headers: { 'Idempotency-Key': 'compra-teste' },
    };
    const [primeiro, repetido] = await Promise.all([
      api.chamar('/pedidos', 201, compra),
      api.chamar('/pedidos', 201, compra),
    ]);
    const pedido = primeiro.dados;
    assert.deepEqual(repetido.dados, pedido);
    assert.equal(pedido.total, 180);
    assert.equal(pedido.enderecoEntrega.rua, destino.rua);
    assert.equal((await api.chamar('/carrinho', 200, { token })).dados[0].quantidade, 1);
    await api.chamar(`/pedidos/${pedido.id}`, 404, { token: outro.token });
    await api.chamar('/pedidos', 409, { ...compra, corpo: { itens: [{ ...item, quantidade: 1 }] } });

    await api.fechar();
    api = await iniciar({ banco });
    assert.deepEqual((await api.chamar('/pedidos?status=entregues', 200, { token })).dados, [pedido]);
    assert.deepEqual((await api.chamar('/favoritos', 200, { token })).dados, ['2']);
    await api.chamar('/usuarios/me/senha', 200, {
      metodo: 'POST', token, corpo: { senhaAtual: cliente.senha, novaSenha: 'novasenha123' },
    });
    await api.chamar('/usuarios/me', 401, { token: login.dados.token });
    await api.chamar('/auth/login', 401, { metodo: 'POST', corpo: cliente });
    await api.chamar('/usuarios/me', 200, { metodo: 'DELETE', token });
    await api.chamar('/usuarios/me', 401, { token });
    await api.chamar('/auth/registro', 201, { metodo: 'POST', corpo: cliente });
  } finally {
    await api.fechar();
    await Promise.all([banco, `${banco}-shm`, `${banco}-wal`].map((arquivo) => rm(arquivo, { force: true })));
    await rmdir(pasta);
  }
});
