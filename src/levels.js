// Level definitions. Each level is generated procedurally from its seed, so the
// layout is identical every time you play it (fair best times).
export const LEVELS = [
  {
    id: 'village', name: 'Village', blurb: 'Sunny lanes and a cheeky pup. A gentle warm-up.',
    seed: 1337, lines: [5, 5], spacing: [15, 21], widths: [3.8, 5.2], narrowChance: 0.1,
    removeFrac: 0.2, stubChance: 0.7, fields: 1, orchardFields: 0, dirtRoads: 0, market: false,
    dog: { speed: 7.6, sprint: 1.28, erratic: 0.25, stamina: 42, deadEnd: 0.18 },
    par: 55,
  },
  {
    id: 'market', name: 'Market Alleys', blurb: 'Narrow alleys, crates and awnings. The pup loves gaps.',
    seed: 4242, lines: [7, 6], spacing: [13, 19], widths: [3.0, 4.8], narrowChance: 0.25,
    removeFrac: 0.26, stubChance: 0.75, fields: 1, orchardFields: 0, dirtRoads: 0, market: true,
    dog: { speed: 8.8, sprint: 1.34, erratic: 0.45, stamina: 50, deadEnd: 0.24 },
    par: 60,
  },
  {
    id: 'orchard', name: 'Orchard Run', blurb: 'Dirt tracks, bumpy fields and a fast, tricky pup.',
    seed: 777, lines: [8, 7], spacing: [15, 23], widths: [3.6, 5.0], narrowChance: 0.15,
    removeFrac: 0.24, stubChance: 0.7, fields: 3, orchardFields: 3, dirtRoads: 0.3, market: false,
    dog: { speed: 9.8, sprint: 1.38, erratic: 0.6, stamina: 50, deadEnd: 0.28 },
    par: 95,
  },
];
export function starsFor(time, par) {
  if (time <= par) return 3;
  if (time <= par * 1.5) return 2;
  return 1;
}
