import { freezeLayout, type Link } from '@zettelkasten/core';

// Layout inicial da galáxia, fora da thread principal: com alguns milhares de
// zettels a simulação leva segundos. Devolve tuplas [id, x, y] — menos bytes
// no postMessage que objetos.
self.addEventListener('message', (event: MessageEvent<{ ids: string[]; links: Link[] }>) => {
  const { ids, links } = event.data;
  const out = freezeLayout(ids, links);
  const positions: [string, number, number][] = [];
  for (const [id, p] of out) positions.push([id, p.x, p.y]);
  self.postMessage({ positions });
});
