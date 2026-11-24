# Characters and cosmetic slots

Every humanoid in the game (remote players, turned players, infected, AI zombies, the race ghost) is the same procedural character: original geometry built in code, no model files. Code: `apps/web/src/lib/render/character/`. The models are visual only. Hulls, eye heights and hitboxes are unchanged, and the poses are tested against them (`character.test.ts`): 72 units standing, 54 ducked, zombie and infected heads on the shared head hitbox.

| File | Covers |
| --- | --- |
| `skeleton.ts` | Bones, bind pose (A-pose, facing +X, feet at y = 0), sockets, flat bone matrices |
| `mesh-kit.ts` | `PartBuilder`: lofts, ellipsoids, boxes, weights, palette indices (`PAL`), LOD picks |
| `body.ts` | Head, face, 5 hair styles, neck, arms, hands, claws, shins (body regions) |
| `outfit.ts` | Default tee, trousers, sneakers, plus reusable torso, sleeve, leg and seat builders |
| `items.ts` | Client item meshes: `registerItemMesh`, `ItemMesh` |
| `shop-items.ts` | Meshes of the shop's items, and helpers shared with `common/` |
| `basic/`, `common/`, `uncommon/`, `rare/`, `epic/` | Meshes of the other items, one file per item, listed in their `index.ts` |
| `preview.ts` | Shop turntable and item pictures (own small WebGL context) |
| `geometry.ts` | Merges the parts of a look into one shared, reference-counted geometry per LOD |
| `material.ts` | One Lambert-based material per character: palette, baked shade, rim light |
| `effects.ts` | Auras and flames of the `effect` slot |
| `animator.ts` | Procedural animation |
| `held.ts` | Third-person weapons (grip space) |
| `model.ts` | `CharacterModel`, `applyLoadout`, roles, persons, LOD |
| `crowd.ts`, `motion.ts` | On-screen test and distances per frame; velocity from positions |
| `samples.ts`, `gallery.ts` | Dev and test only, never in production builds |

## Cosmetic slots

Data, shared by server and client (`packages/shared/src/cosmetics.ts`):

```ts
COSMETIC_SLOTS                 // ['hat', 'glasses', 'top', 'bottom', 'shoes', 'effect']
type Loadout                   // Record<CosmeticSlot, string | null>; null = the slot's default
interface CosmeticItem         // { id, slot, name, isDefault?, rarity? }
RARITIES                       // { basic, common, uncommon, rare, epic: { name, color, price } }; price null = loot only
LOOTBOX                        // name, price, odds (weights), refund; amounts in tenths of a coin
lootItems(), lootChances(), rollLoot(rand)  // what a loot box holds and picks
shopItems(), cosmeticPrice(i)  // items with a rarity are for sale
registerCosmetic(item)         // add an item (throws on a duplicate id)
getCosmetic(id), listCosmetics(slot?), defaultItem(slot)
emptyLoadout()                 // the default look
sanitizeLoadout(untrusted)     // always a valid Loadout; use it on everything received or stored
```

The registry holds `top_default`, `bottom_default`, `shoes_default` and the shop's items (`SHOP_ITEMS`). Hat and glasses are empty by default. Buying, storage and messages: [economy.md](economy.md#shop). Guests wear the default look. Both ends run `sanitizeLoadout` on everything received or stored, so an item the other side does not know is simply not worn.

| Slot | Items (Basic, 30 coins; all others only come from loot boxes) |
| --- | --- |
| hat | Breakline cap, Pom beanie, Straw hat; Common: Fry cook hat, Palm bucket hat, Trilby, Wave bandana, Newsboy cap, Backwards snapback, Headphones, Trapper hat; Uncommon: Shark bite hat, Propeller cap; Epic: Dark lord helmet, Clown prince mask |
| glasses | Glare shades, Round shades, Slim shades; Common: Gold aviators, Sport wraps, Cat-eye shades, Reading glasses, Shutter shades; Uncommon: Pixel shades, Googly eye glasses; Rare: Executive shades |
| top | Sunset tee, Half-and-half tee, Checker tee; Common: Zip hoodie, Floral shirt, Varsity jacket, Denim jacket, Flannel shirt, Rugby shirt, Puffer jacket; Uncommon: Skeleton hoodie, Astronaut jacket; Rare: Tailored suit jacket |
| bottom | Boardshorts, Joggers, Cargo pants; Common: Cuffed jeans, Track pants, Corduroy pants, Court shorts, Plaid golf trousers, Patchwork jeans; Uncommon: Lava pants, Robot legs; Rare: Tailored suit trousers |
| shoes | High-tops, Beach slides, Trail boots, Slip-ons, Canvas low-tops, Garden clogs; Common: Pulse runners, Chelsea boots, Penny loafers, Skate shoes, Rain boots; Uncommon: Rubber duck slippers, Rocket boots; Rare: Polished oxfords |
| effect | Rare: Blue, Yellow, Red, Purple, Black, Orange, Pink, White, Green and Gray aura; Epic: Living flame |

The own player is never drawn in the game, except as the shop preview and as the race ghost of an own run (your PB, or your record), which wears what you wear now.

Drawing (`apps/web/src/lib/render/character/`):

```ts
applyLoadout(model, loadout)                     // model.ts; unknown ids and wrong slots draw the default
renderer.players.setLoadout(playerId, loadout)   // players.ts; kept across map changes, dropped when the player leaves
registerItemMesh(id, { hides?, colors, build })  // items.ts
```

### Adding an item

1. One line in `SHOP_ITEMS` in `packages/shared/src/cosmetics.ts`: `{ id, slot, name, rarity }`. The id is stored in players' databases: never rename, reuse or remove one. For a new rarity, add it to `RARITIES` (name, colour, price).
2. `registerItemMesh(id, mesh)` in `apps/web/src/lib/render/character/shop-items.ts` (Basic), or its own file in `common/` with a line in `common/index.ts`.
3. Look at it in the [gallery](#dev-gallery) from the front and back, crouched, running, surfing, with every hair style (hats) and with every other bottom or pair of shoes, and as IT, infected and zombie.
4. Update the counts in `cosmetics.test.ts` and `character.test.ts` (they also check the mesh, its budget, its winding and its palette), and the table above.

The shop lists, sells, previews and syncs the item without further changes. A client that does not know an item draws the default; a server that does not know it does not sell it.

```ts
registerItemMesh('cap_red', {
	hides: ['hair'],                           // body regions it covers
	colors: [0xb02020, 0xffffff, 0x222222],    // palette A, B, C, D of the slot
	build(b) {
		b.socket('hat', () => {
			b.loft([...], { seg: b.pick(20, 12, 8), pal: PAL.hatA, capEnd: true });
		});
	}
});
```

- **`hides`** takes body regions: `hair` (swaps to flattened hair, so nothing pokes through a hat), `neck`, `upperArms`, `forearms`, `hands`, `shins`. The default trousers hide the shins. Torso and thighs exist only as clothes, so every top and bottom must cover them.
- **`colors`** are up to four colours, or a function of the player's tint. Geometry stores a palette index per vertex (`PAL.hatA` … `PAL.glassesD`); use the four of your own slot, or `PAL.skin`.
- **`build`** runs once per LOD (`b.lod` 0, 1, 2). Use `b.pick(near, mid, far)` for segment counts and drop small details at LOD 1 and 2. The result is cached and shared by everyone wearing the item. It is merged into the body, so an item adds no draw call.
- **Rigid items** (hat, glasses) go inside `b.socket(name, fn)`: coordinates are then local to the socket and move with its bone. **Clothes** use model coordinates of the bind pose and skin weights: `torsoRings`/`torsoWeights`, `buildSleeve`/`armWeights`, `buildSeat` and `buildLeg`/`legWeights` in `outfit.ts` and `body.ts` follow the joints without gaps.
- **Shoes and trousers** overlap: shafts use `legWeights` like the trousers and stay inside them (radius at most 2.9; joggers are the tightest). `buildShoeBase`, `buildLaces`, `buildLeg` (`fit`, `stripe`) and `buildCollar` in `outfit.ts` are shared with the default clothes.
- Patterns are per quad (`palAt`): put rings on the edges of stripes. Capped lofts need `pal`, or the cap gets the skin colour.
- `samples.ts` has a worked example for every slot (cap, sunglasses, long sleeve, shorts, boots).

### Sockets

| Socket | Bone | Origin | Axes |
| --- | --- | --- | --- |
| `hat` | head | Centre of the head at band height (y 68.4). The head is about 4.3 forward, 5.2 back, 4.1 to each side there; hair adds up to 1.5 unless hidden. The crown is at +3.3. | Model |
| `glasses` | head | Bridge of the nose. Eyes are at z = ±1.75, ears at x = −5.6, z = ±4.1. | Model |
| `handR`, `handL` | hand | Centre of the fist | X along the fingers, Y to the thumb |
| `back` | chest | Between the shoulder blades | Model |

`model.attach(socket, object)` hangs a separate mesh on a socket (held weapons). The model does not dispose attached objects.

## Effects

The `effect` slot puts a glow or fire over the whole body (`effects.ts`; loot only: ten Rare auras, the Epic "Living flame"). It is not part of the body geometry: a shell that shares the character's geometry and skeleton and shows only as a halo around the outline, and camera-facing flame quads instanced on the bones. Two more draw calls per wearer, animated in the shaders, premultiplied blending (`solid`: 0 light, 1 smoke, for black and gray). Flames trail the movement, thin out from 700 u and are gone at 2,400 u; the halo fades out at 4,000 u.

To add one: a `SHOP_ITEMS` line with `slot: 'effect'` and an entry in `EFFECTS`.

Not drawn: on role looks (IT, seeker, zombies, infected: they must read), on the race ghost, and for anyone in Hide and Seek (it would give hiders away).

## Roles

`model.setRole('none' | 'it' | 'seeker' | 'zombie' | 'infected' | 'alpha' | 'ghost')`. A role overrides the palette of `top`, `bottom`, `shoes` and `hat` (and skin, hair and eyes for zombie looks), whatever is worn, so it reads at any distance; the shapes stay. IT and seekers are bright red. Zombies, infected and Patient Zero have glowing, unfogged eyes, so their glasses are not drawn. Posture (hunch, zombie arms) follows the role. The loadout comes back when the role ends.

Without a role, each player id has a stable person: tee and trouser tint (the old player hue), skin tone, hair colour and hair style.

## Animation

Computed every frame from velocity, view angles, ground and duck flags; nothing extra is networked.

- **Legs:** two-bone IK. The gait phase advances with the distance travelled, so planted feet move exactly against the body (tested at 250 u/s in five directions). The hips turn towards the direction of travel; backwards running mirrors it. Standing feet stay put until the player has turned about 45°, then step around.
- **Crouch, air, landing:** blended; the leading leg alternates per jump, landings dip with the fall speed.
- **Surf:** airborne players and the ghost touching a 45°+ ramp (a short hull trace in `game.ts`, `rampUnder`) take a sideways stance on the ramp plane, arms out.
- **Aim and held items:** head, spine and arms follow the pitch. Weapons come from the mode state (Zombie Run and Infected weapons, the hide and seek seeker's knife); both hands are placed by IK. Shots and swings from `shot`/`swing` events give recoil, slashes and claw swipes (`players.act`).

## Cost

One draw call per character (plus the name tag, one for a held item, and two for an effect). About 7,200 / 2,700 / 1,100 triangles at LOD 0 / 1 / 2, up to 16,700 / 5,400 / 2,300 in the heaviest items (switch at about 700 and 1,950 units, closer in a crowd: `crowdScale`). Far characters animate on every 2nd to 4th frame and off-screen ones not at all. Bones are not scene objects. Geometry is shared per look and freed with its last user.

## Dev gallery

`http://localhost:5173/?characters` (dev builds only) shows a character without the game. Script it from the console or browser automation:

```js
__gallery.show([{ id: 1, samples: true }, { id: 2, z: 36, role: 'it', held: 'knife', motion: { vx: 250 } }]);
__gallery.show([{ id: 3, loadout: { hat: 'hat_cap', shoes: 'shoes_boots' }, motion: { ducked: true } }]);
__gallery.view(20, 40, 200); // orbit angle, look-at height, distance
__gallery.pause(); __gallery.step(1 / 60, 30);
```
