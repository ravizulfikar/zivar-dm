"""Regenerates every icon from docs/assets/logo.svg.

Needs Pillow and a Chromium-based browser (Microsoft Edge or Chrome) to rasterize the SVG:
    python scripts/create-app-icon.py "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"""
import subprocess, sys, tempfile, pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
browser = sys.argv[1] if len(sys.argv) > 1 else 'msedge'
work = pathlib.Path(tempfile.mkdtemp())
page, big = work / 'logo.html', work / 'logo1024.png'
page.write_text(f'<!doctype html><meta charset=utf-8><style>html,body{{margin:0;background:transparent}}img{{width:1024px;height:1024px;display:block}}</style><img src="{(root / "docs/assets/logo.svg").as_uri()}">')
subprocess.run([browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
                '--window-size=1024,1024', f'--screenshot={big}', page.as_uri()], check=True)
src = Image.open(big).convert('RGBA')
assets = root / 'desktop/assets'
src.resize((512, 512), Image.LANCZOS).save(assets / 'app.png')
src.save(assets / 'app-1024.png')
src.save(assets / 'app.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
src.save(assets / 'app.icns')
src.resize((256, 256), Image.LANCZOS).save(root / 'docs/assets/logo.png')
for n in (16, 32, 48, 128):
    src.resize((n, n), Image.LANCZOS).save(root / f'extension/icon-{n}.png')
print('Icons written.')
