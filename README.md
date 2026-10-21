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
- **Arena**: batalhas 1x1 ou Time de 3 com troca, fórmula de dano oficial (STAB, tipos, crítico), IA, modo automático e simulação de 1.000 batalhas. Regras de equilíbrio:
  - **Níveis equilibrados**: cada Pokémon luta num nível calibrado por simulação (`web/dados/niveis.js`), para todos ganharem perto de 50% (Caterpie nível 100, Charizard 53, Mewtwo 45), já com natures, habilidades automáticas, clima e terrenos: 96% dos Pokémon ficam entre 41% e 61% de vitórias. Recalibrar: `__arenaApi.calibrar()` na consola da Arena.
  - **Golpes com custo**: estágios de atributos (Overheat baixa o Atq. Esp., Close Combat as defesas, Crunch pode baixar a Defesa do alvo...), **PP** limitado (sem PP sobra o Struggle), Eruption/Water Spout perdem força com o HP e Outrage/Thrash prendem 2-3 turnos.
  - **Natures**: as 25 dos jogos (+10% num atributo, −10% noutro, nunca no HP). No editor (✎ Editar → Nature e habilidade) aparecem numa tabela "linha sobe / coluna desce", com cor conforme o perfil do Pokémon: 🟢 benéfica (sobe algo útil e baixa o que ele não usa), ⚪ neutra e 🔴 prejudicial (baixa o ataque que ele usa ou a Velocidade). A escolha automática dá a melhor benéfica (Adamant/Jolly para físicos, Modest/Timid para especiais).
  - **Habilidades**: cada Pokémon tem as suas da PokeAPI (`web/dados/habilidades.js`, incluindo a oculta) e escolhe-se uma no editor; a automática é a mais útil. 170 têm efeito na Arena: aumentos de dano (Huge Power, Technician, Adaptability, Tough Claws...), imunidades (Levitate, Flash Fire, Volt Absorb, Wonder Guard...), redução de dano (Multiscale, Thick Fat, Fur Coat...), ao entrar (Intimidate, Download, Intrepid Sword), ao ser atingido (Rough Skin, Stamina, Justified...), ao derrubar (Moxie, Beast Boost), fim de turno (Speed Boost, Moody), Sturdy, Disguise, Mold Breaker, Regenerator, Pressure, Truant e Slow Start. As que dependem de estados (queimadura, veneno...) aparecem como "sem efeito". A Mega ganha a habilidade da forma Mega; ao evoluir fica com a habilidade na mesma posição. O dano de habilidades (Rough Skin, Liquid Ooze...) nunca derruba, deixa no mínimo 1 HP.
  - **Clima**: Drought (sol), Drizzle (chuva), Sand Stream (areia), Snow Warning (neve), Orichalcum Pulse e Sand Spit mudam o clima por 5 turnos (aparece no campo, com contador). Sol: Fogo ×1,5 e Água ×0,5; chuva: o contrário, e Thunder/Hurricane nunca falham; areia: fere 1/16 por turno quem não é Pedra, Terra ou Aço, e a Pedra ganha Def. Esp. ×1,5; neve: Gelo com Defesa ×1,5 e Blizzard nunca falha. Weather Ball muda de tipo. Habilidades que dependem do clima: Swift Swim, Chlorophyll, Sand Rush, Slush Rush, Solar Power, Sand Force, Sand Veil, Snow Cloak, Rain Dish, Ice Body, Dry Skin, Flower Gift, Protosynthesis e Overcoat; Cloud Nine e Air Lock anulam o clima. O dano do clima também nunca derruba.
  - **Terrenos**: Electric Surge e Hadron Engine (Elétrico), Grassy Surge e Seed Sower (Planta), Psychic Surge (Psíquico) e Misty Surge (Névoa) criam um terreno por 5 turnos, que só afeta quem está no chão (não Voador nem Levitate). Elétrico: golpes Elétrico ×1,3; Planta: golpes de Planta ×1,3, cura 1/16 por turno e Earthquake/Bulldoze a metade; Psíquico: golpes Psíquico ×1,3 e protege dos golpes com prioridade; Névoa: golpes de Dragão recebidos a metade. Terrain Pulse muda de tipo, Grassy Glide ganha prioridade e Psyblade fica ×1,5 no Elétrico. Habilidades que dependem do terreno: Quark Drive, Surge Surfer, Grass Pelt e Mimicry. Clima e terreno podem estar ativos ao mesmo tempo.
  - **Mega Evolução e Gigantamax só com item**: um Pokémon por time leva a Pedra Mega ou o Fator Gigantamax (💎/🔴 no cartão); Gigantamax com HP ×1,5 e golpes Max com o poder dos jogos. As formas Mega/Gigantamax deixam de poder ser escolhidas diretamente.
  - **Evolução em batalha**: ao derrubar um adversário, o Pokémon evolui para o próximo estágio (nível a meio caminho entre o atual e o equilibrado da evolução).
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
