// Правила базы для открытой версии получаются из правил своей версии (firestore.rules), чтобы они никогда не расходились:
// почта администратора не вшита, а берётся из документа meta/admin, который первый вошедший создаёт один раз.
const ADMIN_LINE = /function poolAdmin\(\) \{[^\n]*\}/;
export function openRules(rules) {
  if (!ADMIN_LINE.test(rules)) throw new Error('В firestore.rules не найдена функция poolAdmin()');
  const out = rules.replace(ADMIN_LINE, [
    'function poolAdmin() { return signedIn() && exists(/databases/$(database)/documents/meta/admin)',
    '      && request.auth.token.email.lower() == get(/databases/$(database)/documents/meta/admin).data.email; }',
    '    // Администратор базы — первый вошедший: документ создаётся один раз и больше не меняется',
    '    match /meta/admin {',
    '      allow read: if signedIn();',
    '      allow create: if signedIn() && request.resource.data.email == request.auth.token.email.lower();',
    '      allow update, delete: if false;',
    '    }',
  ].join('\n'));
  if (/@gmail\.com/.test(out)) throw new Error('В правилах открытой версии осталась чья-то почта');
  return out;
}
