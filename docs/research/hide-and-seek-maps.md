# Hide and seek maps: research and design spec

Research for the hide and seek gamemode map (`hns_lido`). Part 1 is what
CS:GO / CS2 hide-and-seek maps are like, part 2 the design spec for our map,
part 3 the measurable quality checklist the map tests enforce.

## 1. Research

### Sources

- Gamers Decide, "[Top 10] CS:GO Best Hide and Seek Maps":
  https://gamersdecide.com/articles/csgo-best-hide-and-seek-maps
- Profilerr, "CS:GO hide and seek: 5 best maps and how to set up a server":
  https://profilerr.net/csgo-hide-and-seek-5-best-maps-and-how-to-set-up-a-server/
- Profilerr, "CS2 hide and seek best maps": https://profilerr.net/cs2-hide-and-seek-best-maps/
- PCGamesN, "This fan-made CS:GO map lets you play hide-and-seek in a swish and sneaky pad":
  https://www.pcgamesn.com/counter-strike-global-offensive/csgo-map-hide-and-seek
- esports.net, "How to play Counter-Strike Hide and Seek":
  https://www.esports.net/news/counter-strike/how-to-play-cs-hide-and-seek/
- Steam Workshop: Dust2 hide and seek changelog ("expanded the map, added
  secrets, more spots, especially teleport spots"; fix for an invisible cube
  trapping players in spawn): https://steamcommunity.com/sharedfiles/filedetails/changelog/1418938018
- Steam Workshop: HideAndSeek Backhouse changelog ("Added teleporters to the
  map - 5 pcs", later 3 more teleports + 3 secret hiding places + a minigame;
  the teleporter opens 60 s after round start):
  https://steamcommunity.com/sharedfiles/filedetails/changelog/1433080503
- Steam Workshop: Inferno hide and seek ("spots that are just sections of a
  wall without collisions", "press E to open a door or reveal a hidden room",
  "teleports that are hidden spots or objects"):
  https://steamcommunity.com/sharedfiles/filedetails/?id=2445282334
- Steam Workshop discussion, Seek Bank secrets (picnic-table alley, "area
  behind the left fence can be noclipped through. You should come out through
  a fake wall", walk-through vending machine):
  https://steamcommunity.com/workshop/filedetails/discussion/695504443/357288572124391491
- Steam Workshop comments on Country House / Hotel hide and seek maps ("lots of
  very creative secrets"; "it's kind of boring if the seekers know every place
  to hide, exploring is the fun part"; how to reach the roof of the lobby):
  https://steamcommunity.com/sharedfiles/filedetails/comments/142097622 ,
  https://steamcommunity.com/sharedfiles/filedetails/comments/679613098
- AlliedModders, SM: Hide and Seek (the CS:S origin of the mode, seekers vs
  hiders, freeze/blind at round start): https://forums.alliedmods.net/showthread.php?p=1162319
- sm-PropHunt (seekers start blinded and immobile during a countdown,
  `ph_freezects`): https://github.com/SHAREN/sm-PropHunt
- Valve Developer Community, `func_illusionary` (the Hammer entity behind
  "fake" walls: a brush that renders but has no collision) and
  `trigger_teleport`: https://developer.valvesoftware.com/wiki/Func_illusionary

Steam Workshop pages rate-limited automated reads during this research; the
quotes above come from the search-index excerpts of those pages.

### How the mode plays

- Two teams: hiders (CT in most servers) and seekers (T). Seekers are frozen
  and blinded at their spawn for a hiding phase (typically 30-60 s; Minecraft
  village map: seekers wait 30 s "in a tiny wooden box"), then hunt with
  knives. Rounds are short (matches of 8-10 min); hiders win by surviving the
  round timer.
- Servers often add fall-damage off, slight speed boosts and a few grenades
  (flash / decoy) for hiders to escape a chase (Frugo castle map).
- The fun is exploration: maps reward players who learn secrets, but a spot
  every seeker knows is no longer a spot, so good maps have many more spots
  than a seeker can check in one round.

### What the maps are like

- **Setting**: a recognisable place packed with everyday furniture: hotels
  (lobby, bedrooms, conference room, pool, playground), houses with gardens,
  garages, empty pools and jungle gyms, offices (vents, break rooms, copy
  machines, underground car park), schools/colleges (classrooms, auditorium,
  cafeteria, sports court, car park, rooftop), villages (snowy houses,
  fireplaces, roofs), castles (walkable walls), spaceships (three levels).
- **Indoor/outdoor mix**: almost every top map mixes both: a main building
  plus gardens/yards, car parks, pools, beaches, woods. Pure-indoor maps
  compensate with vents and several floors.
- **Size**: "medium" to "large"; large maps (college, hotel, Friday-13th woods)
  have several buildings and outdoor areas. From play experience these are
  roughly 4000-10000 units across; a seeker needs on the order of a minute to
  run from one end to the other, and cannot check every room in a round.
- **Prop density**: very high. Rooms are furnished (beds, wardrobes,
  couches, desks, chairs, shelves, kitchen units, bathrooms, vending
  machines, reception desks), outdoors has cars, trees, hedges, fences,
  crates, barrels, playground frames, umbrellas and sunbeds. Props are cover,
  climbing aids (crate → shelf → roof) and hiding spots in themselves.
- **Verticality**: upstairs bedrooms, rooftops, ceilings, treetops, telephone
  lines, under-floor crawlspaces, basements, sewers. Roofs are reached by
  climbing props (no ladders in our engine: stacked crates, bins, cars,
  awnings, stairs).
- **Secrets** (the core of the genre):
  - fake walls / walk-through props: sections of wall, fences or vending
    machines without collision, often hiding a small room;
  - hidden rooms behind them, under stairs, behind fireplaces, inside
    wardrobes, in ceiling voids;
  - teleporters: hidden spots or objects that move you elsewhere (Backhouse
    added 5, then 3 more; Dust2 HNS added "especially teleport spots");
  - trapdoors / manholes to basements and sewers;
  - vents and crawlspaces (duck-only);
  - parkour-only spots: high ledges reached with a precise crouch-jump chain;
  - dark corners and visual camouflage (matching colours).
- **Seeker cage**: a small closed room where seekers wait during the hiding
  phase, often decorated with details/easter eggs, near the centre so no part
  of the map is safe just by distance.
- **Chase loops**: hiders who are found run. Maps need loops (around a
  building, through two doors, up stairs and down a different way), multiple
  exits from rooms and drops from roofs, so a found hider is not instantly
  dead.
- **Fairness / known bugs**: map authors fix spots that trap players (Dust2
  HNS: "invisible cube trapping players in T spawn"), out-of-map exploits and
  places seekers cannot reach. Every spot must be reachable by a seeker who
  knows it.

## 2. Design spec: hns_lido

An original seaside holiday resort ("Lido Bay") in a cove: enclosed by cliffs
on three sides and a sea wall/breakwater in the south. Daytime-to-sunset
light, lots of distinct materials.

Areas (north = +y):

- **Grand Hotel** (north-west): 3 storeys + basement + roof terrace. Lobby
  with reception, lounge, restaurant and kitchen; corridors of guest rooms
  (bed, wardrobe, desk, bathroom); service stairs and main stairs; laundry and
  boiler room in the basement; ceiling vent crawlspace; roof with water tanks,
  AC units and a sign.
- **Car park** (north-east): 2-deck parking garage with a stair core and a
  roof deck, cars, barriers, a ticket booth; a service tunnel crawlspace.
- **Pool club** (east): sunken pool with see-through water, diving tower,
  water slide, pool house with changing rooms and a bar, sunbeds.
- **Old town** (west): a lane of 2-storey shops/houses with flats upstairs,
  market stalls, a chapel with a bell tower, an alley with bins and crates.
- **Plaza** (centre): fountain, kiosks, benches, trees; the **seeker cage**
  (the lifeguard/security office) sits in the plaza.
- **Beach** (south): sand, beach huts, lifeguard tower, umbrellas, sunbeds,
  volleyball net, beach bar; a **pier** running out to sea with a pier
  pavilion; a **lighthouse** on the rocks in the south-west; a boathouse.
- **Cliff path / woods** (edges): trees, rocks, a maintenance shed, a water
  tower.

Rules for the build:

- Hull 32×32×72 (duck 54), step 18, jump ≈ 56, crouch-jump ≈ 65. Doors ≥ 64
  wide × ≥ 96 tall, corridors ≥ 96 wide, stairs ≤ 18 per step, crawlspaces
  56-64 tall (duck only), openings on a 16-unit grid.
- Secrets use `solid: false` brushes (fake walls/props, look identical) and
  teleport zones with `dest`; every hidden teleporter has a way back
  (return teleporter or walkable route).
- Enclosed: cliff/sea walls far taller than anything climbable; a teleport
  under the map returns fall-outs to spawn.

## 3. Quality checklist (enforced by `hns_lido.test.ts`)

| Item | Target | hns_lido |
| --- | --- | --- |
| Playable footprint | ≥ 8192 × 7168 units | 9216 × 7680 |
| Crossing route (farthest walkable pair, real nav graph) | ≥ 11250 units (≥ 45 s at the 250 u/s knife run speed) and ≤ 22500 (≤ 90 s) | ~14 160 (~57 s) |
| Brushes total | ≥ 3000 | ~11 900 |
| Prop brushes (furniture, vehicles, trees, crates…) | ≥ 1200 | ~9 350 |
| Enterable buildings | ≥ 10 | 34 |
| Rooms (enclosed spaces with a ceiling) | ≥ 40 | 139 recorded |
| Vertical levels | ≥ 5 (basement, ground, 1st, 2nd, roofs/tower) | basement −192, ground, 192, 384, 576 (+ belfry 480, lighthouse 576) |
| Secret spots (declared, each with a position) | ≥ 30 | 55 |
| … of which behind/inside clip-through brushes | ≥ 12 | 25 |
| … roof-only / high-ledge spots | ≥ 5 | 17 |
| … crouch-jump-chain spots | ≥ 3 | 5 (tested with `playerMove`) |
| … inside-a-prop spots (hollow fake props) | ≥ 4 | 12 |
| Clip-through (`solid: false`) brushes | ≥ 25 | 123 in the arena |
| Teleporters (zones with `dest`) | ≥ 10, ≥ 5 hidden, ≥ 2 visible pairs | 16, 12 hidden, 2 visible pairs |
| Crawlspaces/vents (stand hull blocked, duck passes) | ≥ 5 | 5 |
| Crawlspaces crawled end to end both ways with the real movement (`playerMove`) | all | 5 / 5 |
| Inside-a-prop spots and the arcade teleporter entered with the real movement (a solid floor lip under a low lid blocks the Source step-up, which needs hull + 18 headroom) | all | 12 / 12 + arcade |
| Chase loops (cycles through ≥ 2 doors/levels) | ≥ 8 (documented) | 17 |
| Hider spawns / seeker spawns | ≥ 12 / ≥ 4 (seekers inside the cage) | 16 / 4 |
| Every secret spot reachable from hider spawns and from the cage | yes (nav graph) | yes |
| No trap: every reachable place can walk/teleport back to the cage | yes (reverse nav graph) | yes |
| Nothing reachable outside the boundary | yes | yes |
| Teleport destinations free, on ground, reachable | yes | yes |
| Non-solid brushes have no collision | yes (traces pass) | yes |
| Collision build time | < 1 s | ~0.3 s (138k triangles) |
