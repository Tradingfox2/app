# Exercise icons

Programmatic thumbnails for every exercise, day type and equipment kind. No AI generation: a figure is posed from ~55 movement templates, gets an equipment overlay, and its primary muscles are drawn in the accent colour (secondary lighter).

```
pip install cairosvg pillow   # only for --export / --sheet
python3 tools/exercise-icons/gen.py --module frontend/src/components/exercises/exercise-icons-generated.ts
```

- `exercises.json`: slug, name, category, equipment, muscles (snapshot of the exercise library).
- `overrides.json`: per-slug `{pattern, equipment, low}` fixes.
- Output `mapping.csv` lists the pattern/equipment chosen for each slug and a low-confidence flag.
- `--export` also writes SVG + 96/192px PNG + WebP into `out/` (git-ignored); `--sheet` writes a review sheet.
