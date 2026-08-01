# Net Worth Tracker

[![Docker Hub](https://img.shields.io/docker/pulls/kpa90/networthtracker?logo=docker&label=Docker+Hub)](https://hub.docker.com/r/kpa90/networthtracker)

Prywatna aplikacja do śledzenia wartości netto. Rejestruje okresowe salda
aktywów i zobowiązań, pokazuje historię, raporty oraz postęp celów finansowych.
Całość działa lokalnie w jednym kontenerze i zapisuje dane w SQLite.

## Najważniejsze funkcje

- konta aktywów i zobowiązań z edycją waluty, archiwizacją i usuwaniem;
- osobny harmonogram aktualizacji każdego konta;
- przypomnienia i oznaczenia nieaktualnych kont;
- snapshoty salda z datą, notatką i wyróżnieniem istotnej zmiany;
- historia konta z wykresem oraz korektą i usuwaniem wpisów;
- dashboard wartości netto, aktywów, zadłużenia i alokacji;
- raport miesięczny, raport roczny i porównania rok do roku;
- cele finansowe z terminem i postępem liczonym od wartości netto w chwili utworzenia, także dla wartości ujemnych;
- konta w PLN, EUR, USD, GBP i CHF;
- historyczne kursy średnie z NBP zapisywane przy snapshotach;
- idempotentna synchronizacja sald z Actual Budget i n8n;
- widoczna data ostatnich tabel NBP i ręczne pobranie najnowszych kursów;
- ustawienia waluty bazowej i formatu dat;
- eksport i import JSON oraz eksport historii do CSV;
- automatyczne kopie SQLite przez cron.

Nie ma logowania ani połączeń z bankami. Projekt zakłada jednego użytkownika
i uruchomienie w zaufanej sieci lokalnej.

## Uruchomienie

Obraz jest dostępny na
[Docker Hub](https://hub.docker.com/r/kpa90/networthtracker) dla
`linux/amd64` i `linux/arm64`.

```bash
mkdir networthtracker
cd networthtracker
curl -O https://raw.githubusercontent.com/kacperpaluch/networthtracker/main/docker-compose.yml
mkdir -p backups
docker compose up -d
```

Aplikacja będzie dostępna pod adresem:

```text
http://localhost:3000
```

Pierwsze uruchomienie tworzy pustą bazę. Jeśli chcesz jednorazowo rozpocząć
z przykładowymi kontami i roczną historią, ustaw `LOAD_DEMO_DATA=true` przed
pierwszym startem.

Compose używa nowego wolumenu `networthtracker_v2_data`. Poprzednia wersja
projektu miała inny schemat bazy, dlatego jej wolumen nie jest automatycznie
nadpisywany ani podłączany do nowej aplikacji.

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

Jeden kontener uruchamia FastAPI i systemowy cron. Baza znajduje się w named
volume, natomiast kopie są zwykłymi plikami w `./backups` na hoście.

## Konfiguracja

| Zmienna | Domyślna wartość | Znaczenie |
| --- | --- | --- |
| `APP_PORT` | `3000` | port hosta używany przez dołączony Compose |
| `DATABASE_URL` | `sqlite:////data/networth.db` | lokalizacja bazy |
| `LOAD_DEMO_DATA` | `false` | dodanie danych demonstracyjnych do pustej bazy |
| `BACKUP_DIR` | `./backups` | folder hosta mapowany przez Compose |
| `BACKUP_CRON` | `0 3 * * *` | harmonogram kopii |
| `BACKUP_RETENTION_DAYS` | `7` | liczba dni przechowywania kopii |
| `RUN_BACKUP_ON_START` | `true` | wykonanie kopii przy uruchomieniu |
| `TZ` | `Europe/Warsaw` | strefa czasowa crona |

Przykład uruchomienia na innym porcie:

```bash
APP_PORT=8026 docker compose up -d
```

## Backup i odtworzenie

Backup używa mechanizmu SQLite `.backup`, a następnie wykonuje
`PRAGMA integrity_check`. Dopiero poprawny plik otrzymuje nazwę:

```text
backups/networthtracker-RRRR-MM-DD_GG-MM-SS.db
```

Do ręcznego odtworzenia zatrzymaj kontener, zastąp plik `networth.db` w
wolumenie wybraną kopią i ponownie uruchom usługę. Eksport JSON z ustawień jest
prostszą metodą logicznego przenoszenia danych między instalacjami.

## Waluty

Kwota snapshotu pozostaje w walucie konta. Dla obcej waluty aplikacja pobiera
ostatni kurs średni NBP dostępny dla wskazanej daty i zapisuje go lokalnie.
Weekend lub święto korzysta z ostatniego wcześniejszego notowania. Zmiana
waluty bazowej wpływa na prezentację i raporty, ale nie zmienia oryginalnych
kwot. Aktywność pokazuje kurs oraz datę tabeli NBP użyte dla każdego snapshotu.

Pierwszy zapis wartości w obcej walucie wymaga dostępu kontenera do
`https://api.nbp.pl`.

## Synchronizacja z Actual Budget i n8n

Endpoint `POST /api/sync` przyjmuje tablicę sald historycznych. Konto jest
dopasowywane po nazwie bez uwzględniania wielkości liter. Nazwa musi
jednoznacznie wskazywać aktywne konto w Worthly.

```json
[
  {
    "date": "2026-07-26",
    "account_name": "PKO Konsolidacja",
    "value": 74564.8,
    "currency": "PLN"
  }
]
```

Synchronizacja jest idempotentna dla pary `konto + data`:

- brak snapshotu tworzy nowy wpis ze źródłem `actual-budget`;
- zmienione saldo aktualizuje istniejący wpis;
- identyczne saldo pozostaje bez zmian;
- brakujące, zarchiwizowane lub niejednoznaczne konto trafia do `errors` i nie
  zatrzymuje pozostałych elementów paczki.

Przykładowa odpowiedź:

```json
{
  "created": 1,
  "updated": 2,
  "unchanged": 4,
  "synced": [
    {
      "date": "2026-07-26",
      "account_name": "PKO Konsolidacja",
      "currency": "PLN",
      "action": "updated"
    }
  ],
  "errors": []
}
```

Workflow może codziennie przesyłać ponownie np. siedem ostatnich dni. Dzięki
upsertowi transakcja dodana z opóźnieniem do Actual Budget skoryguje historię,
a niezmienione salda nie utworzą duplikatów. `value` musi być nieujemną kwotą
w natywnej walucie konta Worthly. Opcjonalne pole `currency` jest porównywane
z walutą konta i chroni przed zapisaniem salda PLN jako liczby EUR lub USD.
Jeśli pole zostanie pominięte, API zakłada natywną walutę konta dla zgodności
ze starszymi integracjami. Wpływ zobowiązań na wartość netto wynika z typu konta.

W zalecanej konfiguracji integracji z Actual Budget wszystkie synchronizowane
konta Worthly, również te nazwane `USD` i `EUR`, mają walutę `PLN`. Osobny
workflow najpierw aktualizuje ich wycenę PLN w Actual, a dopiero potem workflow
Trackera przesyła salda z jawnym `"currency": "PLN"`. Dzięki temu jedna
integracja pozostaje źródłem prawdy i nie powiela logiki wyceny walut.

Istniejące konto walutowe można bezpiecznie przestawić na PLN przez:

```http
PATCH /api/accounts/{id}
Content-Type: application/json

{"currency": "PLN", "convert_amounts": true}
```

`convert_amounts` zachowuje historyczną wartość PLN: każda kwota jest najpierw
mnożona przez zapisany przy snapshocie `rate_to_pln`, a następnie przeliczana na
nową walutę. Bez tej flagi zmiana waluty zachowuje liczby kwot i służy do
poprawiania błędnie oznaczonej waluty.

## Rozwój lokalny

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
mkdir -p data
uvicorn app.main:app --reload
```

Testy:

```bash
PYTHONPATH=. pytest -q
```

Budowa obrazu:

```bash
docker build -t networthtracker:local .
```

Dokumentacja API jest dostępna pod `/docs`. Szczegóły architektury znajdują
się w [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md).

## Struktura

```text
app/                    FastAPI, modele, API i interfejs
  static/               JavaScript, CSS i grafiki
  templates/            szkielet HTML
scripts/                uruchomienie kontenera i backup
tests/                  testy API
docs/                   dokumentacja techniczna
Dockerfile
docker-compose.yml
requirements.txt
requirements-dev.txt
```
