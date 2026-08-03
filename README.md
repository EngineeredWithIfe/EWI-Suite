# EWI Suite — Public Web

The public, static build of the **EWI Suite** — Engineered With Ife.
Six products run fully live in any browser; the rest are local-first apps
that do real work on your own machine and link to a one-command start page.

## What's live in the browser

Cosmos · Matrix · Forge · Cut · Grid · Stat — 100% client-side, no server.

## Deploy to GitHub Pages (engineeredwithife)

```bash
# 1. From this folder (ewi-suite-web), initialise the repo
cd "ewi-suite-web"
git init -b main
git add -A
git commit -m "EWI Suite public web"

# 2. Create the repo on github.com/engineeredwithife (name it e.g. ewi-suite)
#    then point this folder at it:
git remote add origin https://github.com/engineeredwithife/ewi-suite.git
git push -u origin main

# 3. On GitHub: Settings -> Pages -> Build and deployment
#    Source: "Deploy from a branch"  ·  Branch: main  ·  Folder: / (root)  ·  Save
```

Your site goes live at:

    https://engineeredwithife.github.io/ewi-suite/

(Every internal link is site-relative, so the exact repo name doesn't matter —
rename it and the whole suite still resolves.)

### Optional: custom domain
Add a one-line file named `CNAME` containing your domain (e.g. `ewi.dev`),
push, then set the same domain under Settings -> Pages -> Custom domain.

## Rebuild
This folder is generated. To regenerate after editing any product:

```bash
python3 ../_build_site.py
```

EWI — Engineered With Ife · “Ife” [Yoruba] = “Love” [English]
