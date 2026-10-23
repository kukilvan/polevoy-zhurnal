// Перевод интерфейса: проверка tr() на типичных строках (значки, кавычки в названиях, числа в скобках, шаблоны).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('../src/i18n/', import.meta.url);
async function load(lang) {
  globalThis.localStorage = { getItem: () => lang, setItem() {} };
  const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
  const src = read('index.js')
    .replace("import en from './en.json';", `const en = ${read('en.json')};`)
    .replace("import he from './he.json';", `const he = ${read('he.json')};`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-')), `i18n-${lang}.mjs`);
  fs.writeFileSync(file, src);
  return import(file);
}

test('i18n: английский', async () => {
  const { tr } = await load('en');
  assert.equal(tr('👋 Знакомство'), '👋 Introduction');
  assert.equal(tr('1️⃣ Шаг 1. Добавить точки'), '1️⃣ Step 1. Add points');
  assert.equal(tr('Установка камеры (8)'), 'Camera installation (8)');
  assert.equal(tr('test@example.com (вы)'), 'test@example.com (you)');
  assert.equal(tr('точек cat7: 8 (портов 8) · расставлено 0 из 8 · плана ещё нет'), 'cat7 points: 8 (ports 8) · placed 0 of 8 · no plan yet');
  assert.equal(tr('45 м на 1 кабель (всего 45 м)'), '45 m per cable (total 45 m)');
  assert.equal(tr('Google Таблицы проекта «Демо-проект «Офис»»'), 'Google Sheets of project “Demo project “Office””');
  assert.equal(tr('Октябрь 2026'), 'October 2026');
  assert.equal(tr('  Понятно '), '  Got it ');
  assert.equal(tr('ABC-12'), 'ABC-12');
});

test('i18n: иврит', async () => {
  const { tr, isRtl } = await load('he');
  assert.equal(isRtl(), true);
  assert.equal(tr('Новый: шкаф'), 'חדש: ארון');
  assert.equal(tr('Установка камеры (8)'), 'התקנת מצלמה (8)');
});
