import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { transacao } from './banco.js';
import { email, exigir, perfil, senha } from './validacao.js';

const derivar = promisify(scrypt);
const DURACAO_SESSAO = 7 * 24 * 60 * 60 * 1000;
const digest = (token) => createHash('sha256').update(token).digest('hex');

async function hashSenha(valor) {
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${(await derivar(valor, sal, 64)).toString('hex')}`;
}

async function verificarSenha(valor, hash) {
  const [sal, chave] = hash?.split(':') ?? ['0'.repeat(32), '0'.repeat(128)];
  const derivada = await derivar(valor, sal, 64);
  return Boolean(hash) && timingSafeEqual(derivada, Buffer.from(chave, 'hex'));
}

function usuario(conta, dados = JSON.parse(conta.dados)) {
  return { id: conta.id, email: conta.email, nome: dados.nome, telefone: dados.telefone };
}

export function criarContas(banco) {
  const porEmail = banco.prepare('SELECT * FROM contas WHERE email = ?');
  const porSessao = banco.prepare(`
    SELECT contas.* FROM sessoes JOIN contas ON contas.id = sessoes.conta_id
    WHERE token_hash = ? AND expira_em > ? AND email IS NOT NULL
  `);
  const salvar = banco.prepare('UPDATE contas SET dados = ? WHERE id = ?');
  const apagarSessoes = banco.prepare('DELETE FROM sessoes WHERE conta_id = ?');

  function autenticar(token) {
    exigir(token, 401, 'Sua sessão expirou. Entre novamente.');
    const conta = porSessao.get(digest(token), Date.now());
    exigir(conta, 401, 'Sua sessão expirou. Entre novamente.');
    return conta;
  }

  function emitirSessao(conta) {
    const token = randomBytes(32).toString('base64url');
    banco.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Date.now());
    banco.prepare('INSERT INTO sessoes VALUES (?, ?, ?)').run(digest(token), conta.id, Date.now() + DURACAO_SESSAO);
    return { usuario: usuario(conta), token };
  }

  function emailDisponivel(endereco, id) {
    const existente = porEmail.get(endereco);
    exigir(!existente || existente.id === id, 409, 'Este e-mail já está cadastrado.');
  }

  function consultar(token, consultarDados) {
    const conta = autenticar(token);
    return consultarDados(JSON.parse(conta.dados), conta);
  }

  function atualizar(token, alterarDados) {
    return transacao(banco, () => consultar(token, (dados, conta) => {
      const resultado = alterarDados(dados, conta);
      salvar.run(JSON.stringify(dados), conta.id);
      return resultado;
    }));
  }

  async function comSenha(token, valor, executar) {
    const conta = autenticar(token);
    exigir(await verificarSenha(senha(valor), conta.senha_hash), 401, 'Senha incorreta.');
    return transacao(banco, () => {
      const atual = autenticar(token);
      exigir(atual.senha_hash === conta.senha_hash, 401, 'Sua sessão expirou. Entre novamente.');
      return executar(atual);
    });
  }

  return {
    consultar,
    atualizar,
    async registrar(dados) {
      const endereco = email(dados.email);
      const campos = perfil(dados);
      emailDisponivel(endereco);
      const hash = await hashSenha(senha(dados.senha));
      const conta = {
        id: randomUUID(),
        email: endereco,
        dados: JSON.stringify({
          ...campos, enderecos: [], favoritos: [], carrinho: [], pedidos: [], buscas: [], mensagens: [],
        }),
      };
      return transacao(banco, () => {
        emailDisponivel(endereco);
        banco.prepare('INSERT INTO contas VALUES (?, ?, ?, ?)').run(conta.id, endereco, hash, conta.dados);
        return emitirSessao(conta);
      });
    },
    async entrar(dados) {
      const endereco = email(dados.email);
      const conta = porEmail.get(endereco);
      exigir(await verificarSenha(senha(dados.senha), conta?.senha_hash), 401, 'E-mail ou senha incorretos.');
      return transacao(banco, () => {
        const atual = porEmail.get(endereco);
        exigir(atual?.id === conta.id && atual.senha_hash === conta.senha_hash,
          401, 'E-mail ou senha incorretos.');
        return emitirSessao(atual);
      });
    },
    sair(token) {
      if (token) banco.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(digest(token));
      return { ok: true };
    },
    perfil(token) {
      return consultar(token, (dados, conta) => usuario(conta, dados));
    },
    atualizarPerfil(token, corpo) {
      return atualizar(token, (dados, conta) => {
        Object.assign(dados, perfil(corpo));
        return usuario(conta, dados);
      });
    },
    alterarEmail(token, corpo) {
      const endereco = email(corpo.novoEmail);
      return comSenha(token, corpo.senha, (conta) => {
        emailDisponivel(endereco, conta.id);
        banco.prepare('UPDATE contas SET email = ? WHERE id = ?').run(endereco, conta.id);
        return usuario({ ...conta, email: endereco });
      });
    },
    async alterarSenha(token, corpo) {
      autenticar(token);
      const novoHash = await hashSenha(senha(corpo.novaSenha));
      return comSenha(token, corpo.senhaAtual, (conta) => {
        banco.prepare('UPDATE contas SET senha_hash = ? WHERE id = ?').run(novoHash, conta.id);
        banco.prepare('DELETE FROM sessoes WHERE conta_id = ? AND token_hash <> ?').run(conta.id, digest(token));
        return { ok: true };
      });
    },
    excluir(token) {
      return transacao(banco, () => consultar(token, (dados, conta) => {
        const pedidos = dados.pedidos.map(({ pedido: { enderecoEntrega, ...pedido } }) => pedido);
        banco.prepare('UPDATE contas SET email = NULL, senha_hash = NULL, dados = ? WHERE id = ?')
          .run(JSON.stringify({ pedidos }), conta.id);
        apagarSessoes.run(conta.id);
        return { ok: true };
      }));
    },
  };
}
