# Полевой журнал

PWA-приложение для монтажника слаботочных систем: объекты, точки, ежедневные работы, «дохи» на русском и иврите.
Работает офлайн, ставится на экран «Домой» на iPhone, открывается на Windows.

- Стек: Vite + Firebase (Auth + Firestore с офлайн-кэшем), публикация через GitHub Pages.
- Адрес: https://kukilvan.github.io/polevoy-zhurnal/
- Настройки Firebase в `src/firebase-config.js` публичные. Данные защищены правилами `firestore.rules`.
- Рабочие данные и ключи сервисных аккаунтов в репозиторий не кладём.

## Разработка
```
npm install
npm run dev      # локально
npm run build    # сборка в dist/
```
