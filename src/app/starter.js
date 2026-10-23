// Новая база (открытая версия): администратор при первом входе получает стартовый набор общего пула —
// типы точек, устройства, кабели, работы и конфигурации дверей (копия пула Ивана, src/data/starter-pool.json).
import starter from '../data/starter-pool.json';
import { getRepo } from './store.js';
import { isPoolAdmin, poolReady, poolHasData, onPool } from './pool.js';
import { toast } from './ui.js';
import { info } from '../log.js';

let done = false;
export function seedStarterPool() {
  if (done) return;
  const kinds = Object.entries(starter.pool || {}).filter(([, list]) => list.length);
  if (!kinds.length) return;
  const tryNow = () => {
    if (done || !poolReady() || !getRepo()) return;
    done = true; off();
    if (!isPoolAdmin() || poolHasData()) return;
    const ops = kinds.flatMap(([coll, list]) => list.map(({ id, ...data }) => ({ coll, id, data: { ...data, deleted: false } })));
    for (let i = 0; i < ops.length; i += 400) getRepo().savePool(ops.slice(i, i + 400));
    info(`Стартовый набор записан в общий пул: ${ops.length}`);
    toast(`Загружен стартовый набор (${ops.length}): типы точек, устройства, кабели, работы, конфигурации дверей. Лишнее можно убрать в «Ещё → Общий пул»`);
  };
  const off = onPool(tryNow);
  tryNow();
}
