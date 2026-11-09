# Referência da API

A URL base local é `http://127.0.0.1:3000/api/v1`. Todas as rotas abaixo são relativas a essa URL. Envie objetos JSON com `Content-Type: application/json`. Rotas privadas exigem `Authorization: Bearer <token>`. Os tokens têm validade de sete dias.

## Catálogo e CEP

| Método e caminho | Entrada | Resposta |
| --- | --- | --- |
| `GET /health` | — | `{ "status": "ok" }` |
| `GET /produtos` | `marca` ou `secao`, `limite` | Lista de produtos |
| `GET /produtos/recomendados` | `limite` | Lista de produtos |
| `GET /produtos/:id` | ID do produto | Produto |
| `GET /produtos/:id/recomendados` | `limite` | Lista que exclui o produto informado |
| `GET /produtos/busca` | `q`, `genero`, `categoria`, `tamanho`, `cor`, `marca`, `faixaPreco`, `precoMin`, `precoMax`, `limite` | Lista de produtos |
| `GET /produtos/filtros` | — | Opções por grupo em listas de `{ valor, rotulo }` |
| `GET /categorias` | — | Lista de `{ id, nome, imagem }` |
| `GET /cep/:cep` | CEP com oito dígitos, com hífen opcional | `{ rua, bairro, cidade, uf, cep }` |

Use `marca=zero-frame` ou `marca=multimarcas` para as seções da home. Na busca, valores do mesmo grupo podem ser separados por vírgula ou enviados como parâmetros repetidos. Os grupos são combinados entre si. As faixas pré-definidas são `ate-100`, `100-500` e `acima-500`. A busca ignora acentos e maiúsculas. `limite` aceita inteiros entre 0 e 100.

Cada produto contém `id`, `nome`, `categoria`, `categoriaId`, `marca`, `genero`, `preco`, `parcelas`, `nota`, `tamanhos`, `cores` e `imagem`. Promoções podem incluir `precoOriginal` e produtos com galeria incluem `imagens`. Cada imagem tem o formato `{ uri }`. Os preços são números em reais.

## Conta e sessão

| Método e caminho | Acesso | Corpo | Resposta |
| --- | --- | --- | --- |
| `POST /auth/registro` | Público | `{ nome, email, telefone, senha }` | 201 com `{ usuario, token }` |
| `POST /auth/login` | Público | `{ email, senha }` | `{ usuario, token }` |
| `POST /auth/logout` | Token da sessão a encerrar | — | `{ ok: true }` |
| `GET /usuarios/me` | Privado | — | Usuário |
| `PATCH /usuarios/me` | Privado | `{ nome, telefone }` | Usuário atualizado |
| `POST /usuarios/me/email` | Privado | `{ novoEmail, senha }` | Usuário atualizado |
| `POST /usuarios/me/senha` | Privado | `{ senhaAtual, novaSenha }` | `{ ok: true }` |
| `DELETE /usuarios/me` | Privado | — | `{ ok: true }` |

O usuário público tem `id`, `nome`, `email` e `telefone`. A troca de senha encerra as outras sessões da conta. A exclusão encerra todas as sessões e desvincula os dados de contato e entrega do histórico mantido no banco.

## Endereços, favoritos e buscas recentes

Todas as rotas desta seção são privadas.

| Método e caminho | Entrada | Resposta |
| --- | --- | --- |
| `GET /usuarios/me/enderecos` | — | Lista de endereços com o principal primeiro |
| `POST /usuarios/me/enderecos` | Dados do endereço | 201 com endereço salvo |
| `GET /usuarios/me/enderecos/:id` | ID do endereço | Endereço |
| `PUT /usuarios/me/enderecos/:id` | Dados completos do endereço | Endereço atualizado |
| `PATCH /usuarios/me/enderecos/:id` | `{ "principal": true }` | Novo endereço principal |
| `DELETE /usuarios/me/enderecos/:id` | ID do endereço | `{ ok: true }` |
| `GET /favoritos` | — | Lista de IDs de produtos |
| `POST /favoritos` | `{ produtoId }` | Lista atualizada de IDs |
| `DELETE /favoritos/:produtoId` | ID do produto | Lista atualizada de IDs |
| `GET /usuarios/me/buscas-recentes` | — | Até cinco termos, do mais recente ao mais antigo |
| `POST /usuarios/me/buscas-recentes` | `{ termo }` | Lista atualizada |
| `DELETE /usuarios/me/buscas-recentes?termo=...` | Termo a remover na URL | Lista atualizada |

Envie `rua`, `numero`, `bairro`, `cidade`, `uf` e `cep` para salvar um endereço. `complemento` e `principal` são opcionais. O primeiro endereço se torna principal automaticamente. Ao excluir o principal, o próximo endereço da lista assume.

## Carrinho, pedidos e suporte

Todas as rotas desta seção são privadas. Um item de entrada tem `{ produtoId, tamanho, quantidade }`. O limite é de dez unidades por produto e tamanho.

| Método e caminho | Entrada | Resposta |
| --- | --- | --- |
| `GET /carrinho` | — | Lista de itens do usuário |
| `POST /carrinho/itens` | Item de entrada | 201 com item salvo e quantidade acumulada |
| `PATCH /carrinho/itens/:id` | `{ quantidade }` | Item atualizado |
| `DELETE /carrinho/itens/:id` | ID do item | `{ ok: true }` |
| `DELETE /carrinho` | — | `{ ok: true }` |
| `POST /carrinho/resumo` | `{ itens: [...] }` | `{ quantidadeSelecionada, totalItens, desconto, subtotal, envio, total }` |
| `GET /pedidos` | Query opcional `status` | Lista de pedidos do mais recente ao mais antigo |
| `GET /pedidos/:id` | ID do pedido | Pedido |
| `POST /pedidos` | `{ itens: [...], enderecoId? }` e header opcional `Idempotency-Key` | 201 com pedido |
| `POST /suporte/mensagens` | `{ categoria, assunto, mensagem, pedidoId? }` | 201 com `{ protocolo }` |

O carrinho devolve `id`, `produtoId`, `nome`, `imagem`, `tamanho`, `quantidade`, `preco` e `selecionado`, além de `precoOriginal` em promoções. A seleção pode ser mantida no app.

Cada pedido inclui `id`, `numero`, `status`, `criadoEm`, `finalizadoEm`, `etapas`, `itens`, `envio` e `total`. O endereço é copiado do `enderecoId` informado ou do endereço principal, quando existir. Ao concluir o pedido, a API retira as quantidades compradas do carrinho na mesma transação. Reenvie a mesma chave de idempotência e o mesmo corpo para recuperar um pedido após falha de rede. Para filtrar, envie um status como `concluido` ou um grupo como `em-andamento`, `entregues` ou `cancelados`.

As categorias de suporte são `pedido`, `produto`, `entrega`, `pagamento`, `conta` e `outro`.

## Exemplo no PowerShell

```powershell
$api = 'http://127.0.0.1:3000/api/v1'
$cadastro = @{
  nome = 'Cliente Exemplo'
  email = 'cliente@example.com'
  telefone = '11987654321'
  senha = 'Exemplo123'
} | ConvertTo-Json

$sessao = Invoke-RestMethod "$api/auth/registro" -Method Post -ContentType 'application/json' -Body $cadastro
$headers = @{ Authorization = "Bearer $($sessao.token)" }
$headers['Idempotency-Key'] = [guid]::NewGuid().ToString()
$pedido = @{ itens = @(@{ produtoId = '2'; tamanho = 'M'; quantidade = 1 }) } | ConvertTo-Json -Depth 4
Invoke-RestMethod "$api/pedidos" -Method Post -Headers $headers -ContentType 'application/json' -Body $pedido
```

## Erros

Erros usam o formato `{ "mensagem": "Texto para exibir no app" }`. A API devolve `400` para entradas inválidas, `401` para credenciais ou sessão inválidas, `404` para recursos ausentes, `405` para método inválido e `409` para conflitos como e-mail duplicado. Requisições com mais de 64 KiB recebem `413` e corpos com formato diferente de JSON recebem `415`. Uma falha na consulta externa de CEP retorna `502`.
