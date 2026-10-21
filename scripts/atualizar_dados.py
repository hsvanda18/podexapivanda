"""Atualiza os dados do site (web/dados/*.js).

Uso:  python scripts/atualizar_dados.py            (baixa tudo de novo)
      python scripts/atualizar_dados.py --rapido   (reaproveita o download em scripts/.cache)

Fontes: PokeAPI (GraphQL) e PokemonTCG/pokemon-tcg-data.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / "scripts" / ".cache"
DADOS = RAIZ / "web" / "dados"

# tipos: slug da PokeAPI, nome em português e cor (na ordem de exibição)
TIPOS = [
    ('normal', 'Normal', '#A8A878'),
    ('fire', 'Fogo', '#F08030'),
    ('water', 'Água', '#6890F0'),
    ('grass', 'Planta', '#78C850'),
    ('electric', 'Elétrico', '#F8D030'),
    ('ice', 'Gelo', '#98D8D8'),
    ('fighting', 'Lutador', '#C03028'),
    ('poison', 'Venenoso', '#A040A0'),
    ('ground', 'Terrestre', '#E0C068'),
    ('flying', 'Voador', '#A890F0'),
    ('psychic', 'Psíquico', '#F85888'),
    ('bug', 'Inseto', '#A8B820'),
    ('rock', 'Pedra', '#B8A038'),
    ('ghost', 'Fantasma', '#705898'),
    ('dragon', 'Dragão', '#7038F8'),
    ('dark', 'Sombrio', '#705848'),
    ('steel', 'Aço', '#B8B8D0'),
    ('fairy', 'Fada', '#EE99AC'),
]

# golpes da Arena: 4 por tipo (forte/médio, físico F / especial E) + prioridade. Precisao 0 = nunca erra.
GOLPES = [
    ['normal', 'F', 'forte', 'Pancada Corporal', 85, 100, 0],
    ['normal', 'E', 'forte', 'Voz Cortante', 90, 100, 0],
    ['normal', 'F', 'medio', 'Cabeçada', 70, 100, 0],
    ['normal', 'E', 'medio', 'Meteoro', 60, 0, 0],
    ['normal', 'F', 'prio', 'Ataque Rápido', 40, 100, 1],
    ['fire', 'F', 'forte', 'Investida de Chamas', 120, 100, 0],
    ['fire', 'E', 'forte', 'Lança-chamas', 90, 100, 0],
    ['fire', 'F', 'medio', 'Presas de Fogo', 65, 95, 0],
    ['fire', 'E', 'medio', 'Rajada de Fogo', 110, 85, 0],
    ['water', 'F', 'forte', 'Cachoeira', 80, 100, 0],
    ['water', 'E', 'forte', 'Hidro Bomba', 110, 80, 0],
    ['water', 'F', 'medio', 'Rabo Aquático', 90, 90, 0],
    ['water', 'E', 'medio', 'Surfar', 90, 100, 0],
    ['water', 'F', 'prio', 'Aqua Jato', 40, 100, 1],
    ['grass', 'F', 'forte', 'Lâmina de Folha', 90, 100, 0],
    ['grass', 'E', 'forte', 'Bola de Energia', 90, 100, 0],
    ['grass', 'F', 'medio', 'Folha Navalha', 55, 95, 0],
    ['grass', 'E', 'medio', 'Raio Solar', 120, 100, 0],
    ['electric', 'F', 'forte', 'Carga Selvagem', 90, 100, 0],
    ['electric', 'E', 'forte', 'Choque do Trovão', 90, 100, 0],
    ['electric', 'F', 'medio', 'Soco do Trovão', 75, 100, 0],
    ['electric', 'E', 'medio', 'Trovão', 110, 70, 0],
    ['ice', 'F', 'forte', 'Queda de Gelo', 85, 90, 0],
    ['ice', 'E', 'forte', 'Raio de Gelo', 90, 100, 0],
    ['ice', 'F', 'medio', 'Soco de Gelo', 75, 100, 0],
    ['ice', 'E', 'medio', 'Nevasca', 110, 70, 0],
    ['ice', 'F', 'prio', 'Caco de Gelo', 40, 100, 1],
    ['fighting', 'F', 'forte', 'Combate Corpo a Corpo', 120, 100, 0],
    ['fighting', 'E', 'forte', 'Esfera de Aura', 80, 0, 0],
    ['fighting', 'F', 'medio', 'Quebra-Telha', 75, 100, 0],
    ['fighting', 'E', 'medio', 'Explosão Focalizada', 120, 70, 0],
    ['fighting', 'F', 'prio', 'Soco Projétil Vácuo', 40, 100, 1],
    ['poison', 'F', 'forte', 'Lixo Tóxico', 120, 80, 0],
    ['poison', 'E', 'forte', 'Bomba de Lodo', 90, 100, 0],
    ['poison', 'F', 'medio', 'Golpe Venenoso', 80, 100, 0],
    ['poison', 'E', 'medio', 'Onda de Lodo', 95, 100, 0],
    ['ground', 'F', 'forte', 'Terremoto', 100, 100, 0],
    ['ground', 'E', 'forte', 'Poder da Terra', 90, 100, 0],
    ['ground', 'F', 'medio', 'Tremor', 60, 100, 0],
    ['ground', 'E', 'medio', 'Tiro de Lama', 55, 95, 0],
    ['flying', 'F', 'forte', 'Pássaro Bravo', 120, 100, 0],
    ['flying', 'E', 'forte', 'Vendaval', 110, 70, 0],
    ['flying', 'F', 'medio', 'Ataque de Asa', 60, 100, 0],
    ['flying', 'E', 'medio', 'Golpe de Ar', 75, 95, 0],
    ['psychic', 'F', 'forte', 'Cabeçada Zen', 80, 90, 0],
    ['psychic', 'E', 'forte', 'Psíquico', 90, 100, 0],
    ['psychic', 'F', 'medio', 'Corte Psíquico', 70, 100, 0],
    ['psychic', 'E', 'medio', 'Choque Psíquico', 80, 100, 0],
    ['bug', 'F', 'forte', 'Tesoura X', 80, 100, 0],
    ['bug', 'E', 'forte', 'Zumbido', 90, 100, 0],
    ['bug', 'F', 'medio', 'Ida e Volta', 70, 100, 0],
    ['bug', 'E', 'medio', 'Raio Sinal', 75, 100, 0],
    ['rock', 'F', 'forte', 'Gume de Pedra', 100, 80, 0],
    ['rock', 'E', 'forte', 'Gema Poderosa', 80, 100, 0],
    ['rock', 'F', 'medio', 'Deslize de Pedras', 75, 90, 0],
    ['rock', 'E', 'medio', 'Poder Ancestral', 60, 100, 0],
    ['ghost', 'F', 'forte', 'Garra Sombria', 70, 100, 0],
    ['ghost', 'E', 'forte', 'Bola Sombria', 80, 100, 0],
    ['ghost', 'F', 'medio', 'Soco Sombrio', 60, 0, 0],
    ['ghost', 'E', 'medio', 'Maldição', 65, 100, 0],
    ['ghost', 'F', 'prio', 'Furtividade Sombria', 40, 100, 1],
    ['dragon', 'F', 'forte', 'Ultraje', 120, 100, 0],
    ['dragon', 'E', 'forte', 'Pulso do Dragão', 85, 100, 0],
    ['dragon', 'F', 'medio', 'Garra de Dragão', 80, 100, 0],
    ['dragon', 'E', 'medio', 'Meteoro do Dragão', 130, 90, 0],
    ['dark', 'F', 'forte', 'Mastigada', 80, 100, 0],
    ['dark', 'E', 'forte', 'Pulso Sombrio', 80, 100, 0],
    ['dark', 'F', 'medio', 'Golpe Baixo', 70, 100, 0],
    ['dark', 'E', 'medio', 'Rosnado', 55, 95, 0],
    ['dark', 'F', 'prio', 'Soco Surpresa', 70, 100, 1],
    ['steel', 'F', 'forte', 'Cabeça de Ferro', 80, 100, 0],
    ['steel', 'E', 'forte', 'Canhão de Luz', 80, 100, 0],
    ['steel', 'F', 'medio', 'Garra de Metal', 50, 95, 0],
    ['steel', 'E', 'medio', 'Raio de Aço', 140, 95, 0],
    ['steel', 'F', 'prio', 'Soco Projétil', 40, 100, 1],
    ['fairy', 'F', 'forte', 'Brincadeira Bruta', 90, 90, 0],
    ['fairy', 'E', 'forte', 'Explosão Lunar', 95, 100, 0],
    ['fairy', 'F', 'medio', 'Quebra Espírito', 75, 100, 0],
    ['fairy', 'E', 'medio', 'Brilho Deslumbrante', 80, 100, 0],
]

GRAPHQL = "https://beta.pokeapi.co/graphql/v1beta"
TCG = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/"

# mesma consulta de PokeRaw.m
CONSULTA = (
    "{ p: pokemon_v2_pokemon(order_by:{id:asc}) { id name height weight is_default pokemon_species_id "
    "pokemon_v2_pokemonstats { base_stat stat_id } pokemon_v2_pokemontypes { slot type_id } "
    "pokemon_v2_pokemonforms(limit:1) { form_name is_mega } } "
    "s: pokemon_v2_pokemonspecies(order_by:{id:asc}) { id name generation_id evolution_chain_id evolves_from_species_id is_legendary is_mythical "
    "pokemon_v2_pokemonevolutions(limit:1) { min_level evolution_trigger_id } "
    "n: pokemon_v2_pokemonspeciesnames(where:{language_id:{_eq:9}}) { name genus } "
    "d: pokemon_v2_pokemonspeciesflavortexts(limit:1, order_by:{version_id:desc}, where:{language_id:{_eq:9}}) { flavor_text } } "
    "t: pokemon_v2_type(where:{id:{_lt:19}}) { id name } "
    "e: pokemon_v2_typeefficacy { damage_type_id target_type_id damage_factor } "
    "g: pokemon_v2_generation { id pokemon_v2_region { name } } }"
)

RANKING = ["Mega Hyper Rare", "Hyper Rare", "Special Illustration Rare", "Rare Rainbow", "Rare Secret",
           "Shiny Ultra Rare", "Ultra Rare", "Illustration Rare", "Rare Ultra", "Rare Shiny GX", "Rare Shiny", "Shiny Rare",
           "Rare Holo Star", "Rare Shining", "Amazing Rare", "Radiant Rare", "Rare Prism Star", "Rare Holo VMAX",
           "Holo Rare VMAX", "Rare Holo VSTAR", "Holo Rare VSTAR", "Rare Holo V", "Holo Rare V", "Rare Holo GX",
           "Rare Holo EX", "Rare Holo ex", "Double Rare", "LEGEND", "Rare BREAK", "Rare Prime", "Rare Holo LV.X",
           "Trainer Gallery Rare Holo", "Classic Collection", "Pikachu Rare", "MEGA_ATTACK_RARE", "Futuristic Rare",
           "Black White Rare", "Rare Holo", "Promo", "Rare", "Uncommon", "Common"]
TRADUCAO_RAR = {"Common": "Comum", "Uncommon": "Incomum", "Rare": "Rara", "Rare Holo": "Rara Holo"}

# ---------- download ----------
def baixar(url, dados=None, tentativas=4):
    req = urllib.request.Request(url, data=dados, headers={"Content-Type": "application/json", "User-Agent": "pokedex-web"})
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError:
            raise
        except OSError:
            if i == tentativas - 1:
                raise
            time.sleep(2 * (i + 1))


def com_cache(nome, func):
    arq = CACHE / nome
    if "--rapido" in sys.argv and arq.exists():
        return json.loads(arq.read_text(encoding="utf-8"))
    dados = func()
    CACHE.mkdir(exist_ok=True)
    arq.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    return dados


def poke_raw():
    return baixar(GRAPHQL, json.dumps({"query": CONSULTA}).encode())["data"]


def cartas_raw():
    colecoes = baixar(TCG + "sets/en.json")

    def ler(s):
        try:
            return s["id"], baixar(TCG + f"cards/en/{s['id']}.json")
        except Exception as e:  # coleção sem arquivo: ignora (como o try/otherwise do M)
            print("  sem cartas:", s["id"], e)
            return s["id"], []
    with ThreadPoolExecutor(6) as ex:
        cartas = dict(ex.map(ler, colecoes))
    return {"sets": colecoes, "cards": cartas}


# ---------- transformação (espelha as consultas M) ----------
def proper(t):
    return " ".join(w[:1].upper() + w[1:].lower() for w in t.split(" "))


def limpar(t):
    return " ".join(x for x in re.split(r"[\n\r\f]", t) if x) if t else None


def montar_pokemon(raw):
    trad = {slug: (nome, cor, i + 1) for i, (slug, nome, cor) in enumerate(TIPOS)}
    tipo_id = {t["id"]: t["name"] for t in raw["t"]}
    regioes = {g["id"]: g["pokemon_v2_region"]["name"] for g in raw["g"]}

    esp = {}
    for r in raw["s"]:
        n = r["n"][0] if r["n"] else None
        evo = r["pokemon_v2_pokemonevolutions"]
        esp[r["id"]] = dict(
            slug=r["name"], nome=n["name"] if n else proper(r["name"]), cat=n["genus"] if n else None,
            desc=limpar(r["d"][0]["flavor_text"]) if r["d"] else None, gen=r["generation_id"],
            chain=r["evolution_chain_id"], pai=r["evolves_from_species_id"],
            nivel=evo[0]["min_level"] if evo else None, lend=r["is_legendary"], mit=r["is_mythical"])

    def estagio(i):
        pai = esp[i]["pai"]
        return 1 if pai is None or pai not in esp else 1 + estagio(pai)
    for i, e in esp.items():
        e["est"] = estagio(i)
    max_cadeia = {}
    for e in esp.values():
        max_cadeia[e["chain"]] = max(max_cadeia.get(e["chain"], 0), e["est"])

    out = []
    for r in raw["p"]:
        e = esp.get(r["pokemon_species_id"])
        if not e:
            continue
        ts = sorted(r["pokemon_v2_pokemontypes"], key=lambda x: x["slot"])
        t1 = tipo_id[ts[0]["type_id"]]
        t2 = tipo_id[ts[1]["type_id"]] if len(ts) > 1 else ""
        st = {s["stat_id"]: s["base_stat"] for s in r["pokemon_v2_pokemonstats"]}
        fm = r["pokemon_v2_pokemonforms"]
        forma_slug = fm[0]["form_name"] if fm else ""
        sufixo = r["name"][len(e["slug"]) + 1:] if r["name"].startswith(e["slug"] + "-") else forma_slug
        if (r["is_default"] and not forma_slug) or not sufixo:
            forma = "Base"
        else:
            forma = proper(sufixo.replace("-", " ")).replace("Gmax", "Gigantamax")
        tag = next((t for t in ("Mega", "Gigantamax", "Alola", "Galar", "Hisui", "Paldea") if forma.startswith(t)), "Base")
        out.append(dict(
            id=r["id"], esp=r["pokemon_species_id"], padrao=r["is_default"], t1=t1, t2=t2,
            stats=[st.get(k) for k in range(1, 7)], nome=e["nome"] if forma == "Base" else f"{e['nome']} {forma}",
            nomeEsp=e["nome"], forma=forma, tag=tag, alt=r["height"] / 10, peso=r["weight"] / 10,
            cat=e["cat"], desc=e["desc"], gen=e["gen"], chain=e["chain"], est=e["est"],
            ests=max_cadeia[e["chain"]], nivel=e["nivel"], lend=e["lend"], mit=e["mit"],
            regiao=proper(regioes.get(e["gen"], "")), ordem=r["pokemon_species_id"] * 100000 + r["id"], pai=e["pai"] or 0))
    out.sort(key=lambda p: p["ordem"])

    ef = {}
    for x in raw["e"]:
        f = x["damage_factor"] / 100
        if f != 1:
            ef[f"{tipo_id[x['damage_type_id']]}>{tipo_id[x['target_type_id']]}"] = f
    gp = GOLPES
    tp = {slug: [nome, cor] for slug, (nome, cor, _) in sorted(trad.items(), key=lambda kv: kv[1][2])}

    # window.ARENA_DADOS: base de todas as páginas (lida por web/js/comum.js)
    arena = {
        "v": len(out) * 1000 + len(gp),
        "pk": [[p["id"], p["nome"], p["esp"], p["t1"], p["t2"]] + [s or 1 for s in p["stats"]]
               + [1 if p["padrao"] else 0, p["gen"] or 0, 1 if (p["lend"] or p["mit"]) else 0, p["pai"]] for p in out],
        "ef": ef, "gp": gp, "tp": tp,
    }
    # window.DEX_DADOS: colunas extras da Pokédex, por id
    dex = {p["id"]: [p["nomeEsp"], p["forma"], p["tag"], p["alt"], p["peso"], p["cat"], p["desc"], p["chain"],
                     p["est"], p["ests"], p["nivel"], "Mítico" if p["mit"] else "Lendário" if p["lend"] else "Comum",
                     f"{p['regiao']} - Gen {p['gen']}", p["ordem"]] for p in out}
    return arena, dex


def montar_cartas(raw):
    colecoes = [s for s in raw["sets"]]
    idx_col = {s["id"]: i for i, s in enumerate(colecoes)}
    rar_lista, rar_idx = [], {}
    linhas = []
    for s in colecoes:
        for c in raw["cards"].get(s["id"], []):
            if c.get("supertype") != "Pokémon" or "nationalPokedexNumbers" not in c:
                continue
            img = (c.get("images") or {}).get("small")
            if not img:
                continue
            rar = c.get("rarity") or "Sem raridade"
            if rar not in rar_idx:
                rar_idx[rar] = len(rar_lista)
                rar_lista.append(rar)
            n = c["name"]
            tag = ("Mega" if n.startswith(("M ", "Mega ")) else "Gigantamax" if "VMAX" in n else "Alola" if "Alolan" in n
                   else "Galar" if "Galarian" in n else "Hisui" if "Hisuian" in n else "Paldea" if "Paldean" in n else "Base")
            padrao = f"https://images.pokemontcg.io/{s['id']}/{c['number']}.png"
            ordem = RANKING.index(rar) + 1 if rar in RANKING else 99
            linhas.append((ordem, s["releaseDate"], c["id"],
                           [idx_col[s["id"]], c["number"], rar_idx[rar], tag, c["nationalPokedexNumbers"],
                            0 if img == padrao else img]))
    # ordem da galeria: raridade, lançamento mais novo, id
    linhas.sort(key=lambda x: x[2])
    linhas.sort(key=lambda x: x[1], reverse=True)
    linhas.sort(key=lambda x: x[0])
    return {
        "s": [[s["id"], s["name"], s["releaseDate"][:4]] for s in colecoes],
        "r": [TRADUCAO_RAR.get(r, r.replace("_", " ")) for r in rar_lista],
        "c": [x[3] for x in linhas],
    }


# ---------- golpes reais (Arena) ----------
CONSULTA_GOLPES = (
    "{ m: pokemon_v2_move(where:{_or:[{power:{_gt:0}},{move_damage_class_id:{_eq:1}}]}) { id name power accuracy priority pp move_damage_class_id type_id move_target_id "
    "meta: pokemon_v2_movemeta { min_hits max_hits drain crit_rate stat_chance move_meta_category_id move_meta_ailment_id ailment_chance flinch_chance healing } "
    "sc: pokemon_v2_movemetastatchanges { change stat_id } "
    "n: pokemon_v2_movenames(where:{language_id:{_eq:9}}) { name } } "
    "p: pokemon_v2_pokemon(order_by:{id:asc}) { id ms: pokemon_v2_pokemonmoves(distinct_on: move_id) { move_id } } }"
)
# mecânicas que o motor da Arena não simula: carregar/recarregar, ficar fora um turno, desmaiar quem usa,
# falhar fora do 1º turno, depender do golpe do alvo ou de condições especiais
GOLPES_FORA = {
    "explosion", "self-destruct", "misty-explosion", "mind-blown", "steel-beam", "chloroblast",
    "hyper-beam", "giga-impact", "blast-burn", "hydro-cannon", "frenzy-plant", "rock-wrecker", "roar-of-time",
    "prismatic-laser", "eternabeam", "meteor-assault", "solar-beam", "solar-blade", "sky-attack", "razor-wind",
    "skull-bash", "meteor-beam", "electro-shot", "freeze-shock", "ice-burn", "dig", "fly", "dive", "bounce",
    "phantom-force", "shadow-force", "sky-drop", "focus-punch", "future-sight", "doom-desire", "last-resort",
    "belch", "fake-out", "first-impression", "dream-eater", "synchronoise", "burn-up", "double-shock",
    "shell-trap", "spit-up", "snore", "steel-roller", "ice-spinner", "rising-voltage", "expanding-force",
    "misty-terrain", "upper-hand", "thunderclap", "hyperspace-fury", "hyperspace-hole", "fling", "natural-gift",
}


def golpes_raw():
    return baixar(GRAPHQL, json.dumps({"query": CONSULTA_GOLPES}).encode())["data"]


# efeitos que a PokeAPI não descreve nos metadados
EFEITOS_EXTRA = {"make-it-rain": ["u", 100, [["spa", -1]]]}
# golpes com regra própria na Arena: 'hp' perde força com o HP de quem usa; 'furia' prende 2-3 turnos
ESPECIAIS = {"eruption": "hp", "water-spout": "hp", "dragon-energy": "hp",
             "outrage": "furia", "thrash": "furia", "petal-dance": "furia", "raging-fury": "furia"}
STATS = {2: "atk", 3: "def", 4: "spa", 5: "spd", 6: "spe"}
# estados (move_meta_ailment_id): 1 paralisia, 2 sono, 3 congelamento, 4 queimadura, 5 veneno, 6 confusão
ESTADOS = {1: "par", 2: "slp", 3: "frz", 4: "brn", 5: "psn", 6: "conf"}
# estados que a PokeAPI não descreve (ou descreve como "aleatório")
ESTADOS_EXTRA = {"tri-attack": ["tri", 20], "dire-claw": ["dire", 50], "mortal-spin": ["psn", 100],
                 "poison-fang": ["tox", 50], "malignant-chain": ["tox", 50], "barb-barrage": ["psn", 50],
                 "infernal-parade": ["brn", 30], "wildbolt-storm": ["par", 20], "sandsear-storm": ["brn", 20],
                 "axe-kick": ["conf", 30], "matcha-gotcha": ["brn", 20]}
RECUO_EXTRA = {"triple-arrows": 30}


def estado_golpe(m, meta):
    if m["name"] in ESTADOS_EXTRA:
        return ESTADOS_EXTRA[m["name"]]
    e = ESTADOS.get(meta.get("move_meta_ailment_id") or 0)
    return [e, meta.get("ailment_chance") or 100] if e else 0


# ---------- golpes de estado e de reforço ----------
# alvos (move_target_id): no próprio (7 user, 4 users-field, 5 user-or-ally, 13 user-and-allies), no adversário (6, 8, 9, 10, 11), campo (12)
ALVO_PROPRIO = {4, 5, 7, 13}
ALVO_ADVERSARIO = {6, 8, 9, 10, 11}
CLIMA_GOLPE = {"sunny-day": "sol", "rain-dance": "chuva", "sandstorm": "areia", "snowscape": "neve", "hail": "neve",
               "electric-terrain": "t-eletrico", "grassy-terrain": "t-planta", "psychic-terrain": "t-psiquico", "misty-terrain": "t-nevoa"}
CURA_CLIMA = {"synthesis": "cura-sol", "moonlight": "cura-sol", "morning-sun": "cura-sol", "shore-up": "cura-areia"}
# mecânicas que a Arena não tem (custos de HP, trocas, armadilhas, aliados, condições especiais)
ESTADO_FORA = {"strength-sap", "fillet-away", "clangorous-soul", "venom-drench", "captivate", "flower-shield", "rototiller",
               "magnetic-flux", "gear-up", "wish", "heal-pulse", "floral-healing", "purify", "pollen-puff", "parting-shot",
               "memento", "healing-wish", "lunar-dance", "baton-pass", "shed-tail", "stuff-cheeks", "tar-shot", "octolock",
               "belly-drum", "curse", "acupressure", "aromatic-mist", "decorate", "coaching", "yawn", "power-shift",
               "swallow", "geomancy"}
# golpes recentes sem metadados na PokeAPI
EF_ESTADO_EXTRA = {"victory-dance": ["u", 100, [["atk", 1], ["def", 1], ["spe", 1]]], "tidy-up": ["u", 100, [["atk", 1], ["spe", 1]]],
                   "spicy-extract": ["a", 100, [["atk", 2], ["def", -2]]]}


def golpe_estado(m, meta, tipo):
    """golpe só de estado: categoria 'S', sem poder; devolve None se a Arena não o sabe usar"""
    nome, alvo = m["name"], m.get("move_target_id")
    if nome in ESTADO_FORA:
        return None
    esp = CLIMA_GOLPE.get(nome) or CURA_CLIMA.get(nome) or ("rest" if nome == "rest" else "")
    mud = [[STATS[x["stat_id"]], x["change"]] for x in (m.get("sc") or []) if x["stat_id"] in STATS]
    ef = 0
    if mud and (alvo in ALVO_PROPRIO or alvo in ALVO_ADVERSARIO):
        ef = ["u" if alvo in ALVO_PROPRIO else "a", 100, mud]
    ef = EF_ESTADO_EXTRA.get(nome, ef)
    st = 0
    e = "tox" if nome == "toxic" else ESTADOS.get(meta.get("move_meta_ailment_id") or 0)
    if e and alvo in ALVO_ADVERSARIO:
        st = [e, 100]
    cura = (meta.get("healing") or 0) if alvo in ALVO_PROPRIO else 0
    if not (ef or st or cura or esp):
        return None
    return [tipo, "S", 0, m["accuracy"] or 0, m["priority"] or 0, 1, 1, 0, 0, m.get("pp") or 10, ef, esp, st, 0, cura]


def montar_golpes(raw, poke):
    """window.GOLPES_DADOS: g = golpes [nome, tipo, F/E, poder, precisão (0 = nunca erra), prioridade,
    acertos mín, acertos máx, dreno % (negativo = recuo), crítico (0 normal, 1 alto, 2 garantido),
    PP, efeito nos atributos [quem ('u' quem usa, 'a' alvo), chance %, [[atributo, estágios]...]] ou 0, especial ('hp', 'furia' ou ''),
    estado no alvo [par|slp|frz|brn|psn|tox|conf|tri|dire, chance %] ou 0, chance % de fazer recuar, cura % do HP];
    golpes de estado têm categoria 'S' e poder 0 (especial: clima 'sol'..., terreno 't-eletrico'..., 'rest', 'cura-sol', 'cura-areia');
    a = id do pokémon -> índices em g (formas sem lista usam a da forma padrão, no JS)."""
    tipo_id = {t["id"]: t["name"] for t in poke["t"]}
    aprendidos = {}
    for p in raw["p"]:
        aprendidos[p["id"]] = {x["move_id"] for x in p["ms"]}
    usados = set().union(*aprendidos.values())
    golpes = []
    for m in raw["m"]:
        if m["id"] not in usados or m["name"] in GOLPES_FORA or m["type_id"] not in tipo_id or m["move_damage_class_id"] not in (1, 2, 3):
            continue
        meta = (m.get("meta") or [{}])[0] or {}
        nome = m["n"][0]["name"] if m["n"] else proper(m["name"].replace("-", " "))
        if m["move_damage_class_id"] == 1:
            ge = golpe_estado(m, meta, tipo_id[m["type_id"]])
            if ge:
                golpes.append((m["id"], [nome] + ge))
            continue
        crit = meta.get("crit_rate") or 0
        golpes.append((m["id"], [nome, tipo_id[m["type_id"]], "F" if m["move_damage_class_id"] == 2 else "E", m["power"],
                                 m["accuracy"] or 0, m["priority"] or 0, meta.get("min_hits") or 1, meta.get("max_hits") or 1,
                                 meta.get("drain") or 0, 2 if crit >= 3 else 1 if crit >= 1 else 0,
                                 m.get("pp") or 10, efeito_atributos(m, meta), ESPECIAIS.get(m["name"], ""),
                                 estado_golpe(m, meta), RECUO_EXTRA.get(m["name"], meta.get("flinch_chance") or 0), 0]))
    golpes.sort(key=lambda x: x[1][0])
    idx = {mid: i for i, (mid, _) in enumerate(golpes)}
    a = {}
    for pid, ms in aprendidos.items():
        lista = sorted(idx[x] for x in ms if x in idx)
        if lista:
            a[pid] = lista
    # antigos: a ordem dos golpes antes dos golpes de estado (times guardados com números são convertidos pelo nome)
    antigos = json.loads((RAIZ / "scripts" / "golpes_v1.json").read_text(encoding="utf-8"))
    return {"g": [g for _, g in golpes], "a": a, "antigos": antigos}


def efeito_atributos(m, meta):
    if m["name"] in EFEITOS_EXTRA:
        return EFEITOS_EXTRA[m["name"]]
    mud = [[STATS[x["stat_id"]], x["change"]] for x in (m.get("sc") or []) if x["stat_id"] in STATS]
    cat, chance = meta.get("move_meta_category_id"), meta.get("stat_chance") or 0
    if not mud or cat not in (6, 7):
        return 0
    return ["a" if cat == 6 else "u", chance or 100, mud]


# ---------- habilidades (Arena) ----------
CONSULTA_HAB = (
    "{ p: pokemon_v2_pokemon(order_by:{id:asc}) { id pa: pokemon_v2_pokemonabilities(order_by:{slot:asc}) { ability_id is_hidden } } "
    "h: pokemon_v2_ability { id name n: pokemon_v2_abilitynames(where:{language_id:{_eq:9}}) { name } } }"
)


def hab_raw():
    return baixar(GRAPHQL, json.dumps({"query": CONSULTA_HAB}).encode())["data"]


def montar_hab(raw):
    """window.HABILIDADES_DADOS: h = habilidades [chave, nome]; a = id do pokémon -> índices em h
    (por ordem de slot; a habilidade oculta vem como -(índice + 1))."""
    nomes = {h["id"]: (h["name"], h["n"][0]["name"] if h["n"] else proper(h["name"].replace("-", " "))) for h in raw["h"]}
    usadas = sorted({x["ability_id"] for p in raw["p"] for x in p["pa"] if x["ability_id"] in nomes}, key=lambda i: nomes[i][1])
    idx = {aid: i for i, aid in enumerate(usadas)}
    a = {}
    for p in raw["p"]:
        lista = [(-(idx[x["ability_id"]] + 1) if x["is_hidden"] else idx[x["ability_id"]]) for x in p["pa"] if x["ability_id"] in idx]
        if lista:
            a[p["id"]] = lista
    return {"h": [list(nomes[i]) for i in usadas], "a": a}


def gravar(nome, obj):
    DADOS.mkdir(parents=True, exist_ok=True)
    texto = f"window.{nome}=" + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (DADOS / f"{nome.split('_')[0].lower()}.js").write_text(texto, encoding="utf-8", newline="\n")


def main():
    print("PokeAPI...")
    poke = com_cache("pokeapi.json", poke_raw)
    arena, dex = montar_pokemon(poke)
    print(f"  {len(arena['pk'])} pokémon")
    print("Golpes...")
    golpes = montar_golpes(com_cache("golpes.json", golpes_raw), poke)
    print(f"  {len(golpes['g'])} golpes, {sum(len(x) for x in golpes['a'].values())} aprendizados")
    gravar("GOLPES_DADOS", golpes)
    print("Habilidades...")
    hab = montar_hab(com_cache("habilidades.json", hab_raw))
    print(f"  {len(hab['h'])} habilidades")
    gravar("HABILIDADES_DADOS", hab)
    print("Cartas TCG...")
    cartas = montar_cartas(com_cache("tcg.json", cartas_raw))
    print(f"  {len(cartas['c'])} cartas")
    gravar("ARENA_DADOS", arena)
    gravar("DEX_DADOS", dex)
    gravar("CARTAS", cartas)
    print("dados gravados em web/dados")


if __name__ == "__main__":
    main()
