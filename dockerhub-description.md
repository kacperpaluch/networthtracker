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
- **Sync API** — `POST /api/sync` do integracji z n8n lub innymi automatyzacjami
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

## Sync API (integracja z n8n)

```json
POST /api/sync
[
  {"date": "2026-06-04", "account_name": "mBank", "value": 12500.00},
  {"date": "2026-06-04", "account_name": "Oszczędności", "value": 45000.00}
]
```

Endpoint tworzy lub aktualizuje snapshot dla danej daty. Nazwy kont dopasowywane case-insensitively. Nieznane konta zwracają błąd w polu `errors`, pozostałe i tak się zapisują.

## Platformy

`linux/amd64` + `linux/arm64` (Raspberry Pi, Orange Pi itp.)

## Stack

Python 3.12 · FastAPI · SQLite · APScheduler · Vanilla JS · Chart.js
