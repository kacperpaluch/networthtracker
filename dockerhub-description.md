# Net Worth Tracker

Osobista aplikacja webowa do śledzenia wartości netto majątku w czasie. Rejestruje salda kont bankowych, inwestycji i zobowiązań w formie snapshotów i wizualizuje trendy.

## Funkcjonalności

- Dashboard z kartami: wartość netto, aktywa, zobowiązania, zmiana YTD
- Wykresy: liniowy wykres wartości netto + rozbicie na konta (stacked area)
- Porównanie okresów (miesiąc / kwartał / rok lub własne daty)
- Trendy: średnia miesięczna zmiana, CAGR
- Struktura majątku: procent każdego konta, wskaźnik D/A
- Historia snapshotów z rozwijanymi detalami
- Zarządzanie kontami: dodawanie, edycja, archiwizacja
- Backup: automatyczny wg harmonogramu cron, ręczny z UI, przywracanie
- Eksport / Import danych w formacie JSON
- Responsywny ciemny motyw (dark mode)

## Uruchomienie

```yaml
services:
  networthtracker:
    image: kpa90/networthtracker:latest
    container_name: networthtracker
    ports:
      - "8026:8000"
    volumes:
      - /opt/networthtracker/data:/app/data
    environment:
      DB_PATH: /app/data/networth.db
    restart: unless-stopped
```

```bash
docker compose up -d
```

Aplikacja dostępna pod: `http://<host>:8026`

## Zmienne środowiskowe

| Zmienna | Domyślna | Opis |
|---|---|---|
| `DB_PATH` | `data/networth.db` | Ścieżka do pliku bazy SQLite |
| `BACKUP_DIR` | `<katalog DB>/backups` | Katalog na pliki backup |
| `BACKUP_KEEP` | `30` | Liczba zachowywanych automatycznych backupów |

## Platformy

`linux/amd64` + `linux/arm64` (Raspberry Pi, Orange Pi itp.)

## Stack

Python 3.12 · FastAPI · SQLite · APScheduler · Vanilla JS · Chart.js
