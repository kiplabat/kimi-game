# Nyota City

An open-world third-person action game made with [kimi/game](../../README.md) on three.js. Everything is made in code: the city, its people, cars, weapons, sounds and music. It runs offline, as a desktop app or inside KimiLM.

*Nyota* is Swahili for "star". The city, its brands and its gang are fictional.

## The game

- **The city:**
  - An 8 × 8 grid of blocks: glass towers, flats, shop rows, parks, a plaza, compounds, a parking garage, and the Kivuli gang's tower.
  - You can walk into the shops, the safehouse, the warehouses and the tower lobby.
  - The garage has a ramp up to a roof you can drive onto and jump off.
  - Traffic keeps left, as in Kenya.
- **Day and night:**
  - A 16-minute day with a moving sun and long shadows.
  - Lit windows, street lamps and headlights at night.
- **Getting around:** on foot, or by stealing any car, SUV, matatu (a minibus with painted livery) or boda-boda (motorbike taxi).
  - The handbrake drifts, ramps launch you, and crashes do damage.
  - A wrecked vehicle burns and explodes.
- **Weapons:**
  - Pistol, assault rifle, pump shotgun, a sniper with a 7× scope, a rocket launcher, and grenades.
  - Recoil, spread, head shots, tracers, impacts, bullet holes, and explosions with light, fire and smoke.
- **People:**
  - Civilians walk the sidewalks and run when shooting starts.
  - The Kivuli gang spots you by sight and sound. They take cover, peek and shoot, flank, throw grenades and fall back when hurt.
  - The police come when your heat rises (★ to ★★★★★) and also fight the gang.
- **Six missions:**
  1. Karibu Nyota
  2. Boda Ride
  3. The Warehouse
  4. High Ground (sniping from the garage roof)
  5. Convoy (armoured cars and rockets)
  6. Kivuli's Tower

  After the last one, free roam.
- **Saving:** at the safehouse locker, which also refills your ammo, health and armour.

### Controls

| Keyboard and mouse | Gamepad | |
|---|---|---|
| W A S D | left stick | move · drive |
| mouse | right stick | look · aim |
| left click | RT | shoot |
| right click | LT | aim (scope on the sniper) |
| Shift | L3 | sprint (steadies the scope) |
| Space | A | jump · handbrake |
| C | R3 | crouch |
| R | X | reload |
| 1–6, wheel, Q | d-pad | weapons |
| G | RB | throw a grenade |
| F | Y | get in or out · locker |
| Esc | Start | pause · settings |
| F3 | | engine report |

### Graphics

Quality is set automatically and adapts while you play. You can also choose it in Settings:

| Quality | What you get |
|---|---|
| Low | No shadows, FXAA, 0.75× resolution |
| Medium | Shadows, light bloom, FXAA |
| High | Soft 2048 shadows, 4× MSAA, bloom |
| Ultra | 4096 shadows, ambient occlusion (GTAO), longer view |

Every quality level also has:
- materials with reflections from the sky;
- facades and roads drawn by shaders;
- a stylised sky with drifting clouds;
- colour grading.

## Play it

- **Desktop:** download it from the releases of this repository (`nyota-city-v…`).
  - **Windows:** run `nyota-city-…-windows-x64-setup.exe`, or unzip the `.zip`.
  - **Linux:** run the `.AppImage`.
  - **KimiOS, Fedora Silverblue or anywhere without FUSE:** download the `.tar.gz` and `install-linux.sh`, then run:
    ```sh
    sh install-linux.sh nyota-city-0.1.0-linux-x64.tar.gz
    ```
    This puts the game in your apps menu. `sh install-linux.sh --remove` uninstalls it.
- **In a browser:** open `dist/play/nyota-city.html`. It is one file with nothing to install.
- **In KimiLM (2.39.0 and later):** Games → add the example **Nyota City**.

## Build

```sh
npm ci && npm run build            # at the repository root: engine, examples, dist/play/nyota-city.html
cd games/nyota-city/desktop
npm install && npm run dist        # the desktop app for this system (dist/)
npm start                          # or run it without packaging
```

The workflow **Nyota City desktop** builds Windows and Linux on GitHub and publishes a release. Run it from Actions, or push a tag `nyota-city-v<version>`.

`npm run build` also writes `games/nyota-city/build/kimilm/`. That is the KimiLM version, where `three` and `kimi/game` come from KimiLM's import map.

### Code

| File | What it does |
|---|---|
| `src/layout.js` | the city plan |
| `src/materials.js` | ground and facade shaders, canvas textures |
| `src/world.js` | buildings, interiors, props, colliders, surfaces, cover, the navigation grid (A*) |
| `src/sky.js` | sky, sun, moon, day and night, reflections |
| `src/render.js` | the post-processing chain by quality |
| `src/characters.js` | skinned people with procedural animation, weapon models |
| `src/weapons.js` | guns, projectiles, damage |
| `src/vehicles.js` | vehicles, driving, traffic |
| `src/npc.js` | civilians, gang, police AI |
| `src/player.js` | player, cameras |
| `src/missions.js` | missions, heat, population, pickups |
| `src/hud.js` | the interface |
| `src/audio.js` | synthesised sound |
| `src/main.js` | wiring, menus, saves |
