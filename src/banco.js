import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const banco = new DatabaseSync(caminho);
  banco.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS contas (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      senha_hash TEXT,
      dados TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY,
      conta_id TEXT NOT NULL REFERENCES contas(id),
      expira_em INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessoes_conta ON sessoes(conta_id);
  `);
  return banco;
}

export function transacao(banco, executar) {
  banco.exec('BEGIN IMMEDIATE');
  try {
    const resultado = executar();
    banco.exec('COMMIT');
    return resultado;
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  }
}
