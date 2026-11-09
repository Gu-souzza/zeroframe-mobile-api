# 🛒 Zero Frame Mobile — API

Este repositório guarda o **protótipo independente** da API do Zero Frame Mobile, feito com **Node.js 24** e **SQLite** para demonstrar o aplicativo.

Para usar a mesma conta e recuperar o carrinho e os pedidos do desktop no app, use a API ASP.NET Core com SQL Server do projeto desktop. A branch de integração contém as alterações e o passo a passo para apontar os dois clientes para a mesma base. [API compartilhada e instruções](https://github.com/Gu-souzza/sistema-academico-pim-3/tree/codex/api-compartilhada#usar-a-mesma-api-no-desktop-e-no-mobile)

O SQLite deste protótipo guarda somente os dados que foram criados nele. As instruções abaixo servem para executar essa versão de demonstração.

[Interface mobile em React Native e Expo](https://github.com/murilokkj/zeroframe-mobile-interface)

---

## 📌 Funcionalidades

| Módulo | O que a API faz |
| --- | --- |
| Catálogo | Lista produtos, categorias e recomendados. Busca por texto e aplica filtros de preço, gênero, marca, tamanho e cor. |
| Conta | Registra usuários, autentica com token, gerencia perfil e permite alterar e-mail e senha. |
| Endereços | Salva endereços de entrega, mantém um endereço principal e consulta CEP pelo ViaCEP. |
| Carrinho e favoritos | Persiste itens, quantidades e produtos favoritos por conta. |
| Pedidos | Calcula valores no servidor, registra compras simuladas e exibe o histórico por usuário. |
| Suporte | Registra mensagens no banco e gera um protocolo. |

O ambiente de demonstração usa frete grátis e pedidos com status `concluido`. O pagamento, a cotação de frete, os cupons, a recuperação de senha por e-mail e o encaminhamento de mensagens para uma equipe de suporte ficam fora desta versão.

## 🗂️ Estrutura do repositório

| Caminho | Conteúdo |
| --- | --- |
| `src/server.js` | Rotas HTTP, leitura de JSON, CORS e consulta de CEP |
| `src/contas.js`, `src/banco.js` | Autenticação, sessões e persistência SQLite |
| `src/catalogo.js`, `src/catalogo.json` | Catálogo de demonstração, busca e filtros |
| `src/loja.js`, `src/validacao.js` | Regras da loja e validações de entrada |
| `test/` | Testes HTTP e de persistência |
| `docs/api.md` | Contrato das rotas e exemplos |

## ⚙️ Como executar no Windows

Instale o Node.js 24 ou superior e execute no PowerShell:

```powershell
git clone https://github.com/Gu-souzza/zeroframe-mobile-api.git
cd zeroframe-mobile-api
node src/server.js
```

A API inicia sem dependências externas. Na primeira execução, ela cria o banco local em `data/zeroframe.sqlite`. A pasta `data/` fica fora do Git e deve permanecer local, pois pode conter contas, endereços e pedidos.

Em outro terminal, verifique a saúde da API e consulte o catálogo:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/produtos?marca=zero-frame'
```

| Variável | Padrão | Uso |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface em que o servidor escuta |
| `PORT` | `3000` | Porta HTTP |
| `DB_PATH` | `data/zeroframe.sqlite` | Arquivo SQLite. Use `:memory:` para um banco temporário. |
| `CORS_ORIGINS` | vazio | Origens do navegador permitidas, separadas por vírgula e sem barra final |

## 📱 Como conectar ao app

1. Para testar em um celular na mesma rede, execute `$env:HOST = '0.0.0.0'` antes de `node src/server.js`. Encontre o IPv4 do computador com `ipconfig`.
2. No `.env` do app, configure `EXPO_PUBLIC_API_URL=http://IP_DO_COMPUTADOR:3000/api/v1`. No Expo Web, configure `CORS_ORIGINS` com a origem exibida pelo Expo.
3. Substitua os mocks em `src/services/` e nos contextos de carrinho e favoritos do app pelas chamadas descritas na [referência da API](docs/api.md). Nas rotas de conta, envie o token em `Authorization: Bearer <token>`.

As fotos do catálogo usam URLs das imagens de demonstração do repositório mobile. A versão do app no GitHub ainda usa os mocks até que sua camada de serviços seja conectada.

## 🧪 Testes

```powershell
node --test
```

Os testes usam uma porta temporária e um banco isolado para verificar o fluxo de compra, a autorização por conta e a persistência.
