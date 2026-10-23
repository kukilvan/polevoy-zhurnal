// Участники проекта: имена, приглашения, удаление (с предложением откатить правки участника).
import { h, formModal, confirmDialog, toast } from '../ui.js';
import { state, getRepo, currentProject } from '../store.js';
import { connection, connectLink, APP_NAME } from '../../edition.js';

export const memberKey = (email) => String(email).toLowerCase().replace(/\./g, '_');
export const memberName = (p, email) => p.memberNames?.[memberKey(email)] || '';
// Имя (или почта) автора по uid: участники, а также убранные
export function memberNameByUid(p, uid) {
  if (!uid) return '';
  const i = (p.memberUids || []).indexOf(uid);
  const email = i >= 0 ? (p.memberEmails || [])[i] : (p.removedMembers || {})[uid];
  return email ? (memberName(p, email) || email) : '';
}
export const memberLabel = (p, email) => { const n = memberName(p, email); return n ? `${n} · ${email}` : String(email); };

export function inviteForm(p) {
  formModal({
    title: 'Пригласить в проект', submitLabel: 'Пригласить',
    fields: [{ key: 'email', label: 'Почта Google коллеги', required: true, hint: 'Коллега входит в приложение этой почтой и принимает приглашение. Права у всех равные.' }],
    onSubmit: (v) => {
      try { getRepo().invite(p, v.email); } catch (e) { toast(e.message); return false; }
      toast('Приглашение отправлено — пусть коллега откроет приложение');
    },
  });
}

function memberForm(p, email, ui) {
  const repo = getRepo(); const canManage = repo.isCreator(p); const me = String(repo.user.email || '').toLowerCase();
  const isMe = String(email).toLowerCase() === me;
  formModal({
    title: isMe ? `${email} (вы)` : email,
    fields: [{ key: 'name', label: 'Имя (видно всем в проекте)', hint: 'Например: Марина, Саша. Пусто — показывается только почта.' }],
    values: { name: memberName(p, email) },
    extra: isMe || !canManage ? [] : [{ label: 'Убрать из проекта', kind: 'danger', onClick: async () => {
      const who = memberName(p, email) || email;
      if (!(await confirmDialog(`Убрать «${who}» из проекта? Он потеряет доступ, а его прошлые правки останутся в данных.`, { yes: 'Убрать', danger: true }))) return false;
      let uid;
      try { uid = repo.removeMember(p, email); } catch (e) { toast(e.message); return false; }
      toast(`${who} убран из проекта`);
      if (await confirmDialog(`Откатить изменения, внесённые «${who}»? Откроется «Откат записей» с выбранным участником.`, { yes: 'Перейти к откату', no: 'Не нужно' })) {
        state.historyPreselect = uid; ui.open('history');
      }
      return true;
    } }],
    onSubmit: (v) => { repo.renameMember(p, email, v.name || ''); toast('Сохранено'); },
  });
}

export function membersView(ui) {
  const p = currentProject(); const repo = getRepo();
  const me = String(repo.user.email || '').toLowerCase();
  const invited = p.invitedEmails || []; const canManage = repo.isCreator(p);
  return h('div', {},
    h('div', { class: 'mut', style: { marginBottom: '10px' } }, 'Правки данных доступны всем участникам; приглашает и убирает участников только создатель проекта. Нажмите на участника, чтобы подписать его именем или убрать из проекта.'),
    h('div', { class: 'card', style: { padding: 0 } }, (p.memberEmails || []).map((e) => {
      const n = memberName(p, e); const isMe = String(e).toLowerCase() === me;
      return h('div', { class: 'item', onclick: () => memberForm(p, e, ui) },
        h('div', { class: 'name' }, n || e, h('div', { class: 'sub' }, `${n ? `${e}` : 'без имени'}${isMe ? ' · это вы' : ''}`)));
    })),
    invited.length ? h('div', { class: 'card', style: { padding: 0 } },
      h('div', { class: 'group', style: { padding: '10px 14px 4px' } }, 'Приглашены, ещё не вошли'),
      invited.map((e) => h('div', { class: 'item' }, h('div', { class: 'name' }, e),
        !canManage ? null : h('button', { class: 'sec', style: { flex: 'none' }, onclick: async () => {
          if (await confirmDialog(`Отозвать приглашение для ${e}?`, { yes: 'Отозвать', danger: true })) repo.cancelInvite(p, e);
        } }, '✕')))) : null,
    canManage ? h('div', { class: 'btns' }, h('button', { onclick: () => inviteForm(p) }, '➕ Пригласить коллегу')) : h('div', { class: 'mut', style: { margin: '10px 2px' } }, 'Приглашать и убирать участников может только создатель проекта.'),
    connection() ? linkCard() : null);
}

// Ссылка подключения: коллега открывает её — приложение подключается к этой же базе (мастер настройки ему не нужен)
export function linkCard() {
  const url = connectLink();
  const text = `Приложение «${APP_NAME}». Откройте ссылку, войдите своим Google-аккаунтом и примите приглашение в проект:\n${url}`;
  return h('div', { class: 'card' },
    h('b', {}, '🔗 Ссылка для подключения'),
    h('div', { class: 'mut', style: { margin: '4px 0 8px' } }, 'Пригласите коллегу по почте (кнопка выше) и отправьте ему эту ссылку. Она подключает приложение к вашей базе; проекты он увидит только те, куда приглашён.'),
    h('div', { class: 'btns' },
      h('button', { class: 'sec', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Ссылка скопирована'); } catch { toast('Не удалось скопировать'); } } }, '📋 Скопировать'),
      h('button', { class: 'sec', onclick: () => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank') }, '💬 WhatsApp')));
}
