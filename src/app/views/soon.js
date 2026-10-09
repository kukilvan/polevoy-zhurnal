import { h } from '../ui.js';
const NAMES = { todos: 'Дела', journal: 'Журнал', doh: 'Дохот' };
export const soonView = (tab) => h('div', { class: 'card' }, h('b', {}, NAMES[tab] || 'Раздел'),
  h('div', { class: 'mut', style: { marginTop: '6px' } }, 'Этот раздел ещё переносится из AppSheet и появится в одном из ближайших обновлений.'));
