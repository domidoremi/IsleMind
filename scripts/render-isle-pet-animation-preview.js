const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const petDir = path.join(root, 'assets', 'pets', 'isle')
const outDir = path.join(root, 'test-evidence', 'qa', 'pet-state-preview')
const petJsonPath = path.join(petDir, 'pet.json')
const planPath = path.join(petDir, 'extended-animation-plan.json')
const outPath = path.join(outDir, 'isle-pet-animation-preview.html')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function titleCase(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (value) => value.toUpperCase())
}

function resolveAnimation(pet, animationName) {
  const atlases = Object.fromEntries(pet.atlases.map((atlas) => [atlas.id, atlas]))
  const requested = pet.animations[animationName]
  const preferredAtlas = atlases[requested.atlasId]
  if (preferredAtlas?.available) {
    return {
      requestedAnimation: animationName,
      renderedAnimation: animationName,
      requested,
      rendered: requested,
      atlas: preferredAtlas,
      usingFallback: false,
    }
  }

  const fallbackAnimation = requested.fallbackAnimation ?? 'idle'
  const fallback = pet.animations[fallbackAnimation] ?? pet.animations.idle
  const fallbackAtlas = atlases[fallback.atlasId] ?? atlases.core
  if (fallbackAtlas?.available) {
    return {
      requestedAnimation: animationName,
      renderedAnimation: fallbackAnimation,
      requested,
      rendered: fallback,
      atlas: fallbackAtlas,
      usingFallback: true,
    }
  }

  return {
    requestedAnimation: animationName,
    renderedAnimation: 'idle',
    requested,
    rendered: pet.animations.idle,
    atlas: atlases.core,
    usingFallback: true,
  }
}

function collectPlanRows(plan) {
  const rows = new Map()
  for (const atlas of plan.atlasSpecs ?? []) {
    for (const row of atlas.rows ?? []) {
      rows.set(row.animation, {
        atlasId: atlas.atlasId,
        motionBrief: row.motionBrief,
        outputPath: atlas.outputPath,
      })
    }
  }
  return rows
}

function buildPreviewData(pet, plan) {
  const plannedRows = collectPlanRows(plan)
  return Object.keys(pet.animations).map((name) => {
    const resolved = resolveAnimation(pet, name)
    const planRow = plannedRows.get(name)
    return {
      name,
      label: titleCase(name),
      requestedAtlasId: resolved.requested.atlasId,
      requestedRow: resolved.requested.row,
      renderedAnimation: resolved.renderedAnimation,
      renderedAtlasId: resolved.atlas.id,
      renderedRow: resolved.rendered.row,
      frames: resolved.rendered.frames,
      fps: resolved.rendered.fps,
      requestedFrames: resolved.requested.frames,
      requestedFps: resolved.requested.fps,
      usingFallback: resolved.usingFallback,
      fallbackAnimation: resolved.requested.fallbackAnimation ?? null,
      motionBrief: planRow?.motionBrief ?? 'Core animation from the existing Isle spritesheet.',
      plannedOutputPath: planRow?.outputPath ?? resolved.atlas.spritesheetPath,
    }
  })
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildHtml(pet, plan, states) {
  const relativeSpritePath = '../../../assets/pets/isle/spritesheet.webp'
  const pendingAtlases = pet.atlases.filter((atlas) => !atlas.available).map((atlas) => atlas.id)
  const availableAtlases = pet.atlases.filter((atlas) => atlas.available).map((atlas) => atlas.id)
  const dataJson = JSON.stringify({
    generatedAt: new Date().toISOString(),
    petId: pet.id,
    displayName: pet.displayName,
    cellWidth: pet.cellWidth,
    cellHeight: pet.cellHeight,
    columns: pet.columns,
    coreRows: pet.atlases.find((atlas) => atlas.id === 'core')?.rows ?? 9,
    relativeSpritePath,
    availableAtlases,
    pendingAtlases,
    states,
  })

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(pet.displayName)} Pet Animation Preview</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7f9;
      --panel: #ffffff;
      --ink: #26303a;
      --muted: #607080;
      --line: #d6dee6;
      --blue: #1c609b;
      --orange: #a95f1a;
      --green: #237451;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--ink);
      background: var(--bg);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      gap: 10px;
      padding: 18px 18px 14px;
      background: rgba(244, 247, 249, 0.94);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(10px);
    }
    h1 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0;
    }
    .summary, .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      padding: 5px 9px;
    }
    button {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--ink);
      font: inherit;
      padding: 6px 10px;
      cursor: pointer;
    }
    button[aria-pressed="true"] {
      border-color: var(--blue);
      color: var(--blue);
    }
    main {
      width: min(1180px, 100%);
      margin: 0 auto;
      padding: 18px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(206px, 1fr));
      gap: 12px;
    }
    .card {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
    }
    .spriteWrap {
      display: grid;
      place-items: center;
      min-height: 154px;
      border-radius: 7px;
      background:
        linear-gradient(45deg, #edf2f6 25%, transparent 25%),
        linear-gradient(-45deg, #edf2f6 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #edf2f6 75%),
        linear-gradient(-45deg, transparent 75%, #edf2f6 75%);
      background-size: 22px 22px;
      background-position: 0 0, 0 11px, 11px -11px, -11px 0;
    }
    .sprite {
      width: 134px;
      height: 145px;
      image-rendering: pixelated;
      background-repeat: no-repeat;
    }
    .name {
      margin: 10px 0 3px;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.25;
    }
    .meta {
      display: grid;
      gap: 3px;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.35;
    }
    .fallback { color: var(--orange); }
    .core { color: var(--blue); }
    .ready { color: var(--green); }
    .brief {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <header>
    <h1>${htmlEscape(pet.displayName)} pet animation preview</h1>
    <div class="summary" id="summary"></div>
    <div class="controls">
      <button type="button" id="togglePlay">Pause</button>
      <button type="button" id="showAll" aria-pressed="true">All states</button>
      <button type="button" id="showFallbacks">Fallbacks only</button>
      <button type="button" id="showCore">Core only</button>
    </div>
  </header>
  <main>
    <section class="grid" id="grid" aria-label="Pet animation states"></section>
  </main>
  <script>
    const preview = ${dataJson};
    const scale = 134 / preview.cellWidth;
    const spriteWidth = preview.cellWidth * scale;
    const spriteHeight = preview.cellHeight * scale;
    const sheetWidth = preview.columns * spriteWidth;
    const sheetHeight = preview.coreRows * spriteHeight;
    let playing = true;
    let filter = 'all';
    let tick = 0;

    const summary = document.getElementById('summary');
    const grid = document.getElementById('grid');
    const togglePlay = document.getElementById('togglePlay');
    const buttons = {
      all: document.getElementById('showAll'),
      fallbacks: document.getElementById('showFallbacks'),
      core: document.getElementById('showCore'),
    };

    summary.innerHTML = [
      '<span class="pill">' + preview.states.length + ' states</span>',
      '<span class="pill">available: ' + preview.availableAtlases.join(', ') + '</span>',
      '<span class="pill">pending: ' + preview.pendingAtlases.join(', ') + '</span>',
      '<span class="pill">generated: ' + new Date(preview.generatedAt).toLocaleString() + '</span>',
    ].join('');

    function createCard(state) {
      const card = document.createElement('article');
      card.className = 'card';
      card.dataset.name = state.name;
      card.dataset.fallback = String(state.usingFallback);
      const sprite = document.createElement('div');
      sprite.className = 'sprite';
      sprite.style.width = spriteWidth + 'px';
      sprite.style.height = spriteHeight + 'px';
      sprite.style.backgroundImage = 'url("' + preview.relativeSpritePath + '")';
      sprite.style.backgroundSize = sheetWidth + 'px ' + sheetHeight + 'px';
      sprite.dataset.row = String(state.renderedRow);
      sprite.dataset.frames = String(state.frames);
      sprite.dataset.fps = String(state.fps);

      const wrap = document.createElement('div');
      wrap.className = 'spriteWrap';
      wrap.appendChild(sprite);

      const title = document.createElement('div');
      title.className = 'name';
      title.textContent = state.label;

      const meta = document.createElement('div');
      meta.className = 'meta';
      const fallbackLine = state.usingFallback
        ? '<span class="fallback">showing fallback: ' + state.renderedAnimation + '</span>'
        : '<span class="core">showing core atlas</span>';
      meta.innerHTML = [
        '<span>' + state.name + '</span>',
        '<span>requested: ' + state.requestedAtlasId + ' row ' + state.requestedRow + ' | ' + state.requestedFrames + ' frames @ ' + state.requestedFps + ' fps</span>',
        '<span>rendered: ' + state.renderedAtlasId + ' row ' + state.renderedRow + ' | ' + state.frames + ' frames @ ' + state.fps + ' fps</span>',
        fallbackLine,
      ].join('');

      const brief = document.createElement('div');
      brief.className = 'brief';
      brief.textContent = state.motionBrief;

      card.append(wrap, title, meta, brief);
      return card;
    }

    function renderCards() {
      grid.innerHTML = '';
      for (const state of preview.states) {
        const card = createCard(state);
        const hidden =
          (filter === 'fallbacks' && !state.usingFallback) ||
          (filter === 'core' && state.usingFallback);
        if (hidden) card.classList.add('hidden');
        grid.appendChild(card);
      }
      paintSprites();
    }

    function paintSprites() {
      for (const sprite of document.querySelectorAll('.sprite')) {
        const frames = Number(sprite.dataset.frames);
        const fps = Number(sprite.dataset.fps);
        const row = Number(sprite.dataset.row);
        const frame = Math.floor(tick * Math.max(1, fps) / 8) % Math.max(1, frames);
        sprite.style.backgroundPosition = (-frame * spriteWidth) + 'px ' + (-row * spriteHeight) + 'px';
      }
    }

    function setFilter(nextFilter) {
      filter = nextFilter;
      buttons.all.setAttribute('aria-pressed', String(filter === 'all'));
      buttons.fallbacks.setAttribute('aria-pressed', String(filter === 'fallbacks'));
      buttons.core.setAttribute('aria-pressed', String(filter === 'core'));
      renderCards();
    }

    togglePlay.addEventListener('click', () => {
      playing = !playing;
      togglePlay.textContent = playing ? 'Pause' : 'Play';
    });
    buttons.all.addEventListener('click', () => setFilter('all'));
    buttons.fallbacks.addEventListener('click', () => setFilter('fallbacks'));
    buttons.core.addEventListener('click', () => setFilter('core'));

    renderCards();
    setInterval(() => {
      if (!playing) return;
      tick += 1;
      paintSprites();
    }, 125);
  </script>
</body>
</html>
`
}

function main() {
  const pet = readJson(petJsonPath)
  const plan = readJson(planPath)
  const states = buildPreviewData(pet, plan)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, buildHtml(pet, plan, states), 'utf8')
  console.log(`Wrote ${outPath}`)
  console.log(`Preview states: ${states.length}`)
  console.log(`Fallback states: ${states.filter((state) => state.usingFallback).length}`)
}

main()
