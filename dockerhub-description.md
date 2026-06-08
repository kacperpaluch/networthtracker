# Net Worth Tracker

Osobista aplikacja webowa do śledzenia wartości netto majątku w czasie. Rejestruje salda kont bankowych, inwestycji i zobowiązań w formie snapshotów i wizualizuje trendy.

## Funkcjonalności

- **Dashboard** z kartami: wartość netto, aktywa, zobowiązania, zmiana YTD
- **Wykresy**: liniowy net worth (z SMA + projekcją), słupkowy miesięcznych zmian, stacked area rozbicia na konta, donut alokacji aktywów
- **Waterfall chart**: wpływ poszczególnych kont na zmianę net worth
- **Porównanie okresów** (miesiąc / kwartał / rok / własne daty) z waterfall
- **Trendy**: śr. miesięczna zmiana, CAGR, zmienność, najlepszy/najgorszy miesiąc, tempo wzrostu per konto
- **Cele finansowe**: timeline wielu celów z datami, kwotami i paskami postępu
- **Struktura majątku**: procent kont w aktywach, wskaźnik D/A
- **Historia snapshotów**: tabela ze sparkline (mini wykres trendu) i rozwijanymi detalami
- **Zarządzanie kontami**: dodawanie, edycja, archiwizacja
- **Backup**: automatyczny wg cron, ręczny z UI, przywracanie z pliku
- **Sync API** — `POST /api/sync` do integracji z n8n
- **Eksport / Import** JSON
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

## Cele finansowe (milestones)

```json
POST /api/milestones
{"target_date": "2027-06-01", "target_value": 0, "label": "Zero długu!"}
```

## Platformy

`linux/amd64` + `linux/arm64` (Raspberry Pi, Orange Pi)

## Stack

Python 3.12 · FastAPI · SQLite · APScheduler · Chart.js 4.4 · Vanilla JS
