# Net Worth Tracker

Prywatny tracker wartości netto działający lokalnie w jednym kontenerze.
FastAPI, SQLite, responsywny interfejs i automatyczny backup bez zewnętrznej
bazy danych. Nowa instalacja rozpoczyna pracę z pustą bazą.

## Funkcje

- aktywa i zobowiązania z edycją waluty, archiwizacją i usuwaniem kont;
- snapshoty z filtrowaną i stronicowaną historią, interaktywnymi wykresami kont oraz notatkami i kursem NBP;
- pełna aktywność z filtrowaniem dat, kont i źródeł oraz stronicowaniem;
- dokładne kwoty w historii i czytelnie zaokrąglone podsumowanie dashboardu;
- globalna zmiana wartości netto liczona między spójnymi punktami czasu;
- panel statystyk z trendami 30 dni/6 miesięcy/12 miesięcy, średnim tempem, najlepszym miesiącem, zmianą zadłużenia, rekordem i prognozą;
- raporty miesięczne i roczne ograniczone do rzeczywistego okresu danych oraz poprawne porównania wartości ujemnych;
- cele finansowe z pozostałą kwotą, analizą tempa, statusem względem planu, prognozowanym terminem i wykresem rzeczywistość–plan;
- aktywa vs zobowiązania i udziały procentowe;
- PLN, EUR, USD, GBP i CHF z trwałym cache NBP; dashboard i raporty działają bez zapytań sieciowych;
- eksport/import JSON i eksport CSV;
- idempotentny endpoint `POST /api/sync` do integracji z Actual Budget i n8n;
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
