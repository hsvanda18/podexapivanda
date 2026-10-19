"""Gera a versão web (site estático) do relatório na pasta web/.

Uso:  python _staging/build_web.py            (baixa os dados e monta o site)
      python _staging/build_web.py --rapido   (reaproveita os dados já baixados em _staging/cache)

Mesmas fontes do Power BI: PokeAPI (GraphQL) e PokemonTCG/pokemon-tcg-data.
Os dados viram web/dados/*.js; as páginas reaproveitam _staging/js/*.
"""
import json
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
STAGING = RAIZ / "_staging"
JS_DIR = STAGING / "js"
M_DIR = STAGING / "m"
CACHE = STAGING / "cache"
WEB = RAIZ / "web"

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

# páginas: (arquivo, título, js/css da página)
PAGINAS = [("index", "Pokédex", "dex"), ("arena", "Arena", "arena"), ("tipos", "Tipos", "tipos"),
           ("quiz", "Quiz", "quiz"), ("safari", "Safari", "safari")]


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


def tipos():
    m = (M_DIR / "Tipos.m").read_text(encoding="utf-8")
    return re.findall(r'\{"([a-z]+)", "([^"]+)", "(#[0-9A-Fa-f]{6})", (\d+)\}', m)


def golpes():
    m = (M_DIR / "Golpes.m").read_text(encoding="utf-8")
    return [[t, c, p, n, int(pw), int(ac), int(pr)] for t, c, p, n, pw, ac, pr in
            re.findall(r'\{"(\w+)", "(\w)", "(\w+)", "([^"]+)", (\d+), (\d+), (\d+)\}', m)]


def montar_pokemon(raw):
    trad = {slug: (nome, cor, int(o)) for slug, nome, cor, o in tipos()}
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
    gp = golpes()
    tp = {slug: [nome, cor] for slug, (nome, cor, _) in sorted(trad.items(), key=lambda kv: kv[1][2])}

    # window.ARENA_DADOS: mesmo formato da medida [JS Dados]
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


# ---------- site ----------
PAGINA = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titulo} · Pokédex BI</title>
<link rel="stylesheet" href="css/comum.css">
<link rel="stylesheet" href="css/{arq}.css">
<link rel="stylesheet" href="css/web.css">
</head>
<body>
<div id="htmlContent"><div class="htmlViewerEntry"><div id="app-raiz"></div></div></div>
{nav}
{scripts}
</body>
</html>
"""


def nav_html(atual):
    itens = "".join(
        f"<a href='{arq}.html'{' class=\"on\"' if arq == atual else ''}>{titulo}</a>" for arq, titulo, _ in PAGINAS)
    return f"<nav id='pk-nav'>{itens}</nav>"


def gravar(caminho: Path, texto: str):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(texto, encoding="utf-8", newline="\n")


def main():
    print("PokeAPI...")
    arena, dex = montar_pokemon(com_cache("pokeapi.json", poke_raw))
    print(f"  {len(arena['pk'])} pokémon")
    print("Cartas TCG...")
    cartas = montar_cartas(com_cache("tcg.json", cartas_raw))
    print(f"  {len(cartas['c'])} cartas")

    js = lambda nome, obj: f"window.{nome}=" + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n"
    gravar(WEB / "dados" / "arena.js", js("ARENA_DADOS", arena))
    gravar(WEB / "dados" / "dex.js", js("DEX_DADOS", dex))
    gravar(WEB / "dados" / "cartas.js", js("CARTAS", cartas))

    for f in JS_DIR.iterdir():
        if f.suffix in (".js", ".css") and not f.name.startswith("teste"):
            destino = WEB / ("js" if f.suffix == ".js" else "css") / f.name
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, destino)

    for arq, titulo, pag in PAGINAS:
        extras = ["dados/dex.js", "dados/cartas.js"] if pag == "dex" else []
        scripts = "\n".join(f"<script src='{s}'></script>" for s in
                            ["dados/arena.js"] + extras + ["js/comum.js", f"js/{pag}.js", "js/web.js"])
        gravar(WEB / f"{arq}.html", PAGINA.format(titulo=titulo, arq=pag, nav=nav_html(arq), scripts=scripts))
    print("site gravado em", WEB.relative_to(RAIZ))


if __name__ == "__main__":
    main()
