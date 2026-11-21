DIAGNOSIS: CONFIRMED

До исправления PhotoSession и /statuses проверяли состояние capturing, которое сохраняется до finalize. Если после отправки JPEG закрыть вкладку до finalize, через 60 секунд строка показывает потерю связи. Граница контроля — начало передачи. Проверка регрессии — выдержать таймаут до finalize и проверить строку, счётчик проблем и поздний heartbeat.

Recurrence: no_prior_evidence
