# Net Worth Tracker

Prywatny tracker wartości netto działający lokalnie w jednym kontenerze.
FastAPI, SQLite, responsywny interfejs i automatyczny backup bez zewnętrznej
bazy danych. Nowa instalacja rozpoczyna pracę z pustą bazą.

## Funkcje

- aktywa i zobowiązania z edycją waluty, archiwizacją i usuwaniem kont;
- snapshoty z historią, wykresami, notatkami oraz kursem i datą tabeli NBP;
- raporty miesięczne i roczne oraz porównania r/r;
- cele finansowe liczone od wartości początkowej, także dla ujemnej wartości netto;
- aktywa vs zobowiązania i udziały procentowe;
- PLN, EUR, USD, GBP i CHF z historycznymi kursami NBP oraz poprawną obsługą weekendów i świąt;
- eksport/import JSON i eksport CSV;
- cron backupujący SQLite do folderu hosta.

## Docker Compose

```yaml
services:
  networthtracker:
    image: kpa90/networthtracker:latest
    container_name: networthtracker
    restart: unless-stopped
    ports:
      - "3000:8000"
    environment:
      DATABASE_URL: sqlite:////data/networth.db
      LOAD_DEMO_DATA: "false"
      BACKUP_CRON: "0 3 * * *"
      BACKUP_RETENTION_DAYS: "7"
      RUN_BACKUP_ON_START: "true"
      TZ: Europe/Warsaw
    volumes:
      - networthtracker_v2_data:/data
      - ./backups:/backups

volumes:
  networthtracker_v2_data:
```

Po uruchomieniu otwórz `http://localhost:3000`.

## Platformy

- `linux/amd64`
- `linux/arm64`

Pełna dokumentacja:
[github.com/kacperpaluch/networthtracker](https://github.com/kacperpaluch/networthtracker)
