# Pokédex Web

Pokédex interativa e animada que roda direto no navegador, sem instalar nada. Começou como um relatório Power BI e virou um site estático.

### ▶ [Abrir o site](https://hsvanda18.github.io/podexapivanda/)

5 páginas: **Pokédex · Arena · Tipos · Quiz · Safari**. A primeira carga leva alguns segundos (sprites e cartas vêm da internet).

## Destaques

- **Dados reais**: 1.302 Pokémon (formas incluídas) da [PokeAPI](https://pokeapi.co), com atributos, tipos, cadeias evolutivas e a tabela de eficácia de tipos.
- **17 mil cartas do Pokémon TCG** do repositório [pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data), casadas com a forma exibida (Mega, Gigantamax, regionais).
- **Fundo dinâmico por tipo**: bolhas (Água), brasas (Fogo), raios (Elétrico), folhas, neve, almas, ondas psíquicas... tudo em CSS.
- **Modos Normal / ✨ Shiny / 🃏 Cartas / ⚔ Golpes**, com galeria de cartas (prévia holográfica ao passar o mouse) e a lista dos golpes de ataque que aquela forma aprende, com filtros.
- **Fraquezas e vantagens**: dano recebido de cada tipo e os tipos em que os golpes do próprio tipo do Pokémon causam dano dobrado.
- **Evolução clicável** com animação (silhuetas alternando, raios e clarão) e **formas clicáveis** (Mega X/Y, Gigantamax...).
- **Arena**: batalhas 1x1 ou Time de 3 com troca, fórmula de dano oficial (nível 50, STAB, tipos, crítico), IA, Mega Evolução e Gigantamax, modo automático e simulação de 1.000 batalhas.
- **Golpes reais**: cada Pokémon só usa golpes de dano que aprende nos jogos (476 golpes da PokeAPI, nomes em inglês). Dá para escolher os 4 de cada um ou deixar a escolha automática. Funcionam vários acertos, dreno, recuo e crítico alto; golpes com mecânicas que o motor não simula (carregar/recarregar, Explosion, Fly...) ficam de fora.
- **Arena online (grátis, sem conta)**: no modo 🌐 Online, um jogador cria a sala e manda o link pelo WhatsApp; o outro abre e batalham em tempo real, cada um no seu aparelho. Salas e jogadas ficam no [Supabase](https://supabase.com) (login anónimo + tempo real), por isso dá para **minimizar a app ou perder a rede e voltar**: a batalha é reconstruída a partir das jogadas e continua.
- **Nada se perde ao minimizar**: Safari, Quiz, Pokédex e batalhas contra a IA guardam o estado no aparelho e voltam iguais se o celular fechar o separador.
- **Tipos**: roda de tipos com setas animadas, matriz 18×18, ranking das 171 combinações defensivas e calculadora de confronto.
- **Safari**: minijogo estilo GBA em canvas: ande pelo mato, encontre Pokémon selvagens e capture com Pokébolas (fórmula de captura da 3ª geração). Como na Zona Safari dos jogos, dá para atirar **Pedra/Lama** (captura 2× mais fácil, mas ele fica irritado e foge mais) ou **Isca** (ele fica a comer e foge menos, mas a captura fica 2× mais difícil).
- **Quiz "Quem é esse Pokémon?"**: silhueta, 4 opções ou digitar o nome, cronômetro, dicas, sequência e recorde.
- Link direto para um Pokémon: `index.html#25` abre o Pikachu.
- **App instalável e rápida (PWA)**: um Service Worker guarda o site e as imagens no aparelho; as imagens vêm do CDN jsDelivr e as cartas e golpes da Pokédex só são baixados quando abres esses modos. No celular dá para "Adicionar à tela inicial".
- **Funciona no celular**: a Pokédex vira uma página vertical (lista em tela cheia, setas ‹ › para passear, toque na carta para ampliar); Arena, Tipos, Quiz e Safari giram para a horizontal sozinhas, com direcional de toque no Safari.

## Estrutura

| Pasta | Conteúdo |
|-------|----------|
| `web/` | O site: uma página HTML por aba, `js/` e `css/` de cada página, `dados/` gerados |
| `web/js/comum.js` | Base compartilhada (dados, tipos, imagens, escala do palco 1280×720) |
| `web/js/online.js` | Arena online pelo Supabase (salas, jogadas, presença, retoma) |
| `web/js/config.js` | URL e chave pública do Supabase |
| `supabase/schema.sql` | Tabelas, funções e regras de segurança do Supabase |
| `scripts/atualizar_dados.py` | Baixa PokeAPI (Pokémon e golpes) + cartas TCG e grava `web/dados/*.js` |
| `.github/workflows/pages.yml` | Publica `web/` no GitHub Pages a cada push na `main` |

## Rodar localmente

```bash
python -m http.server 8765 -d web
```

Depois abra http://localhost:8765.

## Ligar o modo online (Supabase, grátis)

1. Cria um projeto em [supabase.com](https://supabase.com) (plano Free).
2. Em **Authentication → Sign In / Providers**, liga **Allow anonymous sign-ins**.
3. No **SQL Editor**, cola o conteúdo de `supabase/schema.sql` e corre.
4. Em **Settings → API**, copia a **Project URL** e a chave **anon public** para `web/js/config.js`.

A chave anon pode ficar pública: as regras (RLS) do `schema.sql` só deixam os dois jogadores de cada sala ver e mexer nela.

## Atualizar os dados

```bash
python scripts/atualizar_dados.py
```

Ao publicar código novo, mude a constante `VERSAO` em `web/sw.js` para os aparelhos trocarem a cache do site.

Use `--rapido` para reaproveitar o último download (fica em `scripts/.cache/`). Depois é só fazer commit e push: o site se atualiza sozinho.

---
Dados: PokeAPI e Pokémon TCG Data. Ícones de tipo: [partywhale/pokemon-type-icons](https://github.com/partywhale/pokemon-type-icons) (MIT). Pokémon e marcas relacionadas pertencem à Nintendo, Game Freak e The Pokémon Company; projeto sem fins comerciais.
