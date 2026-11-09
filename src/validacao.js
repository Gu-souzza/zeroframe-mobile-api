export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function exigir(condicao, status, mensagem) {
  if (!condicao) throw new ErroHttp(status, mensagem);
}

export function texto(valor, campo, maximo = 120) {
  exigir(typeof valor === 'string' && valor.trim() && valor.trim().length <= maximo,
    400, `Informe ${campo} com até ${maximo} caracteres.`);
  return valor.trim();
}

export function email(valor) {
  const limpo = texto(valor, 'o e-mail', 254).toLowerCase();
  exigir(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo), 400, 'E-mail inválido.');
  return limpo;
}

export function senha(valor) {
  exigir(typeof valor === 'string' && valor.length >= 6 && valor.length <= 128,
    400, 'A senha deve ter entre 6 e 128 caracteres.');
  return valor;
}

export function perfil(dados) {
  const nome = texto(dados.nome, 'o nome').replace(/\s+/g, ' ');
  exigir(/^[\p{L}' -]+$/u.test(nome) && nome.split(' ').length >= 2 &&
    nome.split(' ').every((parte) => parte.length >= 2 && /\p{L}/u.test(parte)),
  400, 'Informe nome e sobrenome.');
  const digitos = texto(dados.telefone, 'o telefone', 25).replace(/\D/g, '');
  exigir(/^\d{10}$|^\d{2}9\d{8}$/.test(digitos) && Number(digitos.slice(0, 2)) >= 11,
    400, 'Informe um telefone válido com DDD.');
  const telefone = `(${digitos.slice(0, 2)}) ${digitos.slice(2, -4)}-${digitos.slice(-4)}`;
  return { nome, telefone };
}

export function cep(valor) {
  const limpo = texto(valor, 'o CEP', 9);
  exigir(/^\d{5}-?\d{3}$/.test(limpo), 400, 'O CEP deve ter 8 dígitos.');
  return limpo.replace('-', '');
}

export function formatarCep(digitos) {
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

const ESTADOS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export function endereco(dados) {
  const uf = texto(dados.uf, 'a UF', 2).toUpperCase();
  exigir(ESTADOS.includes(uf), 400, 'UF inválida.');
  exigir(dados.principal === undefined || typeof dados.principal === 'boolean',
    400, 'O campo principal deve ser verdadeiro ou falso.');
  return {
    rua: texto(dados.rua, 'a rua'),
    numero: texto(dados.numero, 'o número', 20),
    complemento: dados.complemento === undefined || dados.complemento === ''
      ? undefined : texto(dados.complemento, 'o complemento'),
    bairro: texto(dados.bairro, 'o bairro'),
    cidade: texto(dados.cidade, 'a cidade'),
    uf,
    cep: formatarCep(cep(dados.cep)),
    principal: dados.principal ?? false,
  };
}
