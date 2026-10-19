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
            regiao=proper(regioes.get(e["gen"], "")), ordem=r["pokemon_species_id"] * 100000 + r["id"]))
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
               + [1 if p["padrao"] else 0, p["gen"] or 0, 1 if (p["lend"] or p["mit"]) else 0] for p in out],
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


def gravar(nome, obj):
    DADOS.mkdir(parents=True, exist_ok=True)
    texto = f"window.{nome}=" + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (DADOS / f"{nome.split('_')[0].lower()}.js").write_text(texto, encoding="utf-8", newline="\n")


def main():
    print("PokeAPI...")
    arena, dex = montar_pokemon(com_cache("pokeapi.json", poke_raw))
    print(f"  {len(arena['pk'])} pokémon")
    print("Cartas TCG...")
    cartas = montar_cartas(com_cache("tcg.json", cartas_raw))
    print(f"  {len(cartas['c'])} cartas")
    gravar("ARENA_DADOS", arena)
    gravar("DEX_DADOS", dex)
    gravar("CARTAS", cartas)
    print("dados gravados em web/dados")


if __name__ == "__main__":
    main()
