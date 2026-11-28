# Sundown City

An open-world third-person action game made with [kimi/game](../../README.md) on three.js. Everything is made in code: the city, its people, cars, weapons, sounds and music. It runs offline, as a desktop app or inside KimiLM.

The city, its brands and its gang are fictional.

## The game

- **The city:**
  - An 8 × 8 grid of blocks: glass towers, flats, shop rows, parks, a plaza, compounds, a parking garage, and Viper Tower, the gang's base.
  - You can walk into the shops, the safehouse, the warehouses and the tower lobby.
  - The garage has a ramp up to a roof you can drive onto and jump off.
  - Traffic keeps right.
- **Day and night:**
  - A 16-minute day with a moving sun and long shadows.
  - Lit windows, street lamps and headlights at night.
- **Getting around:** on foot, or by stealing any car, SUV, van (a minibus with painted livery) or motorbike.
  - The handbrake drifts, ramps launch you, and crashes do damage.
  - A wrecked vehicle burns and explodes.
- **Weapons:**
  - Pistol, assault rifle, pump shotgun, a sniper with a 7× scope, a rocket launcher, and grenades.
  - Recoil, spread, head shots, tracers, impacts, bullet holes, and explosions with light, fire and smoke.
- **People:**
  - Civilians walk the sidewalks and run when shooting starts.
  - The Vipers gang spots you by sight and sound. They take cover, peek and shoot, flank, throw grenades and fall back when hurt.
  - The police come when your heat rises (★ to ★★★★★) and also fight the gang.
- **Six missions:**
  1. Homecoming
  2. Two Wheels
  3. The Warehouse
  4. High Ground (sniping from the garage roof)
  5. Convoy (armoured cars and rockets)
  6. Viper Tower

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

Quality is set automatically. While you play it moves down a ladder that lowers the resolution (to 50 % at the least) before it drops effects. It remembers where your machine settled for the next start. You can also choose it in Settings:

| Quality | What you get |
|---|---|
| Low | No sun shadows (contact shadows only), FXAA, 170 m view, plain windows |
| Medium | 1024 shadows redrawn every other frame, half-resolution bloom, FXAA, rooms behind windows, 260 m view |
| High | 2048 shadows, 4× MSAA, bloom, 360 m view |
| Ultra | 4096 shadows, ambient occlusion (GTAO), 520 m view |

Every level has:
- **Baked city lighting:** ambient occlusion where walls, kerbs and trees meet the ground, and the pools of light under the street lamps, baked into one texture at load, the way games bake lightmaps.
- **Height fog** with the sun scattered in it, drawn once from the depth buffer.
- Filmic tone mapping and colour grading in the same pass.
- Reflections from the sky, puddles on the roads, contact shadows under cars and people.

From Medium up, every window has a room behind it. This is interior mapping: the view ray is cast into a box behind the glass, so there are no extra triangles.

### Performance (0.2)

The work went into drawing less:
- **Instances:** towers, trees, lamps and props are engine instances, culled per copy, so only what is in view (or close enough to throw a shadow into it) is drawn.
- **Static geometry:** merged by material in 144 m cells.
- **Vehicles:** each is three meshes (paint, glass, details). The lights are vertex channels with per-car uniforms, and all tyres and rims are two instanced meshes for the whole city.
- **Guns:** each is built once and shared.
- **Lights:** each level has a fixed number of real lights (each one costs every lit pixel). Street lamp light is baked into the ground.
- **Noise:** comes from a small mipmapped texture instead of being worked out per pixel.

Against 0.1 at the same spot: 55–65 % fewer draw calls and 70–85 % fewer triangles. In the sandbox's software renderer, frames also took 31 % less time at Medium and 19 % less at High. F3 shows where time goes on your machine: CPU draw time, GPU time (when the browser allows timer queries), the resolution scale, and instances drawn.

## Play it

- **Desktop:** download it from the releases of this repository (`sundown-city-v…`).
  - **Windows:** run `sundown-city-…-windows-x64-setup.exe`, or unzip the `.zip`.
  - **Linux:** run the `.AppImage`.
  - **KimiOS, Fedora Silverblue or anywhere without FUSE:** download the `.tar.gz` and `install-linux.sh`, then run:
    ```sh
    sh install-linux.sh sundown-city-0.2.0-linux-x64.tar.gz
    ```
    This puts the game in your apps menu. `sh install-linux.sh --remove` uninstalls it.
- **In a browser:** open `dist/play/sundown-city.html`. It is one file with nothing to install.
- **In KimiLM (2.40.0 and later):** Games → add the example **Sundown City**.

## Build

```sh
npm ci && npm run build            # at the repository root: engine, examples, dist/play/sundown-city.html
cd games/sundown-city/desktop
npm install && npm run dist        # the desktop app for this system (dist/)
npm start                          # or run it without packaging
```

The workflow **Sundown City desktop** builds Windows and Linux on GitHub and publishes a release. Run it from Actions, or push a tag `sundown-city-v<version>`.

`npm run build` also writes `games/sundown-city/build/kimilm/`. That is the KimiLM version, where `three` and `kimi/game` come from KimiLM's import map.

### Code

| File | What it does |
|---|---|
| `src/layout.js` | the city plan |
| `src/materials.js` | ground and facade shaders (window interiors), the baked city map (AO and lamp light), noise and canvas textures |
| `src/world.js` | buildings, interiors, props, colliders, surfaces, cover, the navigation grid (A*) |
| `src/sky.js` | sky, sun, moon, day and night, reflections |
| `src/render.js` | the frame: scene at adaptive resolution, bloom, then one pass for fog, tone mapping, grading and sharpening, then FXAA |
| `src/characters.js` | skinned people with procedural animation, weapon models |
| `src/weapons.js` | guns, projectiles, damage |
| `src/vehicles.js` | vehicles, driving, traffic |
| `src/npc.js` | civilians, gang, police AI |
| `src/player.js` | player, cameras |
| `src/missions.js` | missions, heat, population, pickups |
| `src/hud.js` | the interface |
| `src/audio.js` | synthesised sound |
| `src/main.js` | wiring, menus, saves |
