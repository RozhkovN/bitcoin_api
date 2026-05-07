# bitcoin_api

## Docker

Приложение поднимает и frontend, и backend в одном процессе на одном порту.

По умолчанию используется порт `3400`.

### Запуск через docker compose

```bash
docker compose up -d --build
```

Проверка:

- `http://SERVER_IP:3400`
- BTC preset: `http://SERVER_IP:3400/p/btc` (подставляет адрес в форму)
- ETH preset: `http://SERVER_IP:3400/p/eth` (подставляет адрес в форму)

Остановка:

```bash
docker compose down
```

### Если нужен порт 8400

Можно поменять проброс порта в `docker-compose.yml`:

```yaml
ports:
  - "8400:3400"
```

Тогда приложение будет доступно по `http://SERVER_IP:8400`.
