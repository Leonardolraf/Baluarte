"""Gera o icone e as imagens de marca do instalador a partir do escudo canonico do Baluarte.

Rodada uma vez e os resultados (baluarte.ico, wizard-grande.bmp, wizard-pequeno.bmp) ficam
versionados ao lado deste arquivo, para o empacotar.ps1 nao depender de Python. So rode de novo
se o escudo mudar.

    python agente/instalador-windows/recursos/gerar-imagens.py

A geometria vem de baluarte-frontend/public/baluarte.svg (melhoria #25: escudo com ameias
partido em dois azuis, com o check de "verificado"). Nao ha rasterizador de SVG nesta maquina,
entao o path e convertido a mao: as retas viram pontos e as duas curvas quadraticas de Bezier da
base sao amostradas. Desenha em 16x e reduz, que e o antisserrilhado.

Mudou o baluarte.svg, mude o PATH e o CHECK aqui -- nao ha teste que pegue a diferenca.
"""

from pathlib import Path

from PIL import Image, ImageDraw

# --- Escudo, no sistema de coordenadas do viewBox 0 0 64 64 do SVG ------------------------
# d="M12,10 L20,10 L20,15 L28,15 L28,10 L36,10 L36,15 L44,15 L44,10 L52,10 L52,15 L51,30
#    Q48.5,43 32,53 Q15.5,43 13,30 L12,15 Z"
RETAS = [(12, 10), (20, 10), (20, 15), (28, 15), (28, 10), (36, 10),
         (36, 15), (44, 15), (44, 10), (52, 10), (52, 15), (51, 30)]
QUADRATICAS = [((51, 30), (48.5, 43), (32, 53)), ((32, 53), (15.5, 43), (13, 30))]
FECHAMENTO = [(13, 30), (12, 15)]

CHECK = [(24, 33), (30, 39), (42, 27)]
CHECK_ESPESSURA = 4.5

AZUL_ESCURO = (30, 64, 175)    # #1e40af, metade esquerda
AZUL_CLARO = (59, 130, 246)    # #3b82f6, metade direita (clip x >= 32)
TINTA = (11, 18, 32)           # #0B1220, o tile do favicon e o cabecalho do prototipo
BRANCO = (255, 255, 255)

LADO = 64        # o viewBox
RAIO_TILE = 14   # o rx do rect do favicon
AMOSTRAS = 48    # pontos por curva quadratica
SUPER = 16       # fator de supersampling


def _quadratica(p0, p1, p2, n=AMOSTRAS):
    """Pontos de uma Bezier quadratica: B(t) = (1-t)^2.P0 + 2(1-t)t.P1 + t^2.P2."""
    saida = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        saida.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    return saida


def contorno_escudo():
    pontos = list(RETAS)
    for p0, p1, p2 in QUADRATICAS:
        pontos.extend(_quadratica(p0, p1, p2))
    pontos.extend(FECHAMENTO)
    return pontos


def desenhar_escudo(lado_px, margem=0.0):
    """Escudo em RGBA, com fundo transparente, num quadrado de lado_px.

    margem e em unidades do viewBox (0..64) e encolhe o escudo para dentro.
    """
    grande = lado_px * SUPER
    escala = (grande - 2 * margem * SUPER) / LADO

    def pos(p):
        return (p[0] * escala + margem * SUPER, p[1] * escala + margem * SUPER)

    img = Image.new("RGBA", (grande, grande), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    contorno = [pos(p) for p in contorno_escudo()]
    d.polygon(contorno, fill=AZUL_ESCURO + (255,))

    # A metade direita: o mesmo escudo em azul claro, colado so onde x >= 32 do viewBox.
    direita = Image.new("RGBA", (grande, grande), (0, 0, 0, 0))
    ImageDraw.Draw(direita).polygon(contorno, fill=AZUL_CLARO + (255,))
    mascara = Image.new("L", (grande, grande), 0)
    corte = pos((32, 0))[0]
    ImageDraw.Draw(mascara).rectangle([corte, 0, grande, grande], fill=255)
    img.paste(direita, (0, 0), mascara)

    # O check: linha grossa com ponta e junta arredondadas (o SVG usa round cap e round join).
    check = [pos(p) for p in CHECK]
    espessura = max(1, round(CHECK_ESPESSURA * escala))
    d = ImageDraw.Draw(img)
    d.line(check, fill=BRANCO + (255,), width=espessura, joint="curve")
    r = espessura / 2
    for x, y in (check[0], check[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=BRANCO + (255,))

    return img.resize((lado_px, lado_px), Image.LANCZOS)


def com_tile(lado_px):
    """Escudo sobre o tile escuro arredondado, como no favicon: legivel a 16 px."""
    grande = lado_px * SUPER
    fundo = Image.new("RGBA", (grande, grande), (0, 0, 0, 0))
    raio = RAIO_TILE * grande / LADO
    ImageDraw.Draw(fundo).rounded_rectangle([0, 0, grande - 1, grande - 1], radius=raio,
                                            fill=TINTA + (255,))
    fundo = fundo.resize((lado_px, lado_px), Image.LANCZOS)
    fundo.alpha_composite(desenhar_escudo(lado_px))
    return fundo


def banner(largura, altura):
    """Fundo na tinta escura (o cabecalho do prototipo) com o escudo no terco de cima."""
    img = Image.new("RGB", (largura, altura), TINTA)
    lado = int(largura * 0.52)
    escudo = desenhar_escudo(lado)
    img.paste(escudo, ((largura - lado) // 2, int(altura * 0.17)), escudo)
    return img


def principal():
    aqui = Path(__file__).resolve().parent

    # Icone do instalador: os tamanhos que o Windows pede, do 16 da barra ao 256 do Explorer.
    tamanhos = [16, 24, 32, 48, 64, 128, 256]
    quadros = [com_tile(t) for t in tamanhos]
    quadros[-1].save(aqui / "baluarte.ico", format="ICO",
                     sizes=[(t, t) for t in tamanhos], append_images=quadros[:-1])

    # Inno Setup: BMP de 24 bits. WizardImageFile e 164x314; WizardSmallImageFile, 55x55.
    banner(164, 314).save(aqui / "wizard-grande.bmp", format="BMP")
    com_tile(55).convert("RGB").save(aqui / "wizard-pequeno.bmp", format="BMP")

    for nome in ("baluarte.ico", "wizard-grande.bmp", "wizard-pequeno.bmp"):
        caminho = aqui / nome
        print(f"{nome}: {caminho.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    principal()
