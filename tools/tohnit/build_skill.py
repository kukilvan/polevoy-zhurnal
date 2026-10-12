# Собирает SKILL.md (навык для Claude) из skill_head.md + library.md + tohnit.py
import os
d = os.path.dirname(os.path.abspath(__file__))
head = open(os.path.join(d, 'skill_head.md')).read()
lib = open(os.path.join(d, 'library.md')).read().replace('# Библиотека обозначений на тохнитах (слаботочка, Израиль)', '## Библиотека обозначений')
code = open(os.path.join(d, 'tohnit.py')).read()
open(os.path.join(d, 'SKILL.md'), 'w').write(head + '\n' + lib)  # сам скрипт скачивается с GitHub (или прикрепляется), в навык не вставляется
print('SKILL.md собран')
