# Net Worth Tracker

[![Docker Hub](https://img.shields.io/docker/pulls/kpa90/networthtracker?logo=docker&label=Docker+Hub)](https://hub.docker.com/r/kpa90/networthtracker)

Prywatna aplikacja do śledzenia wartości netto. Rejestruje okresowe salda
aktywów i zobowiązań, pokazuje historię, raporty oraz postęp celów finansowych.
Całość działa lokalnie w jednym kontenerze i zapisuje dane w SQLite.

## Najważniejsze funkcje

- konta aktywów i zobowiązań z archiwizacją i usuwaniem;
- osobny harmonogram aktualizacji każdego konta;
- przypomnienia i oznaczenia nieaktualnych kont;
- snapshoty salda z datą, notatką i wyróżnieniem istotnej zmiany;
- historia konta z interaktywnym wykresem, zakresami 3M/6M/1R/MAX, filtrem dat, stronicowaniem oraz korektą i usuwaniem wpisów;
- pełna aktywność z filtrowaniem dat, kont i źródeł oraz stronicowaniem;
- dashboard wartości netto, aktywów, zadłużenia i alokacji, z wykresem 6M/1R/MAX oraz dokładnymi wartościami po najechaniu;
- statystyki zmian za 30 dni, 6 i 12 miesięcy, średniego tempa miesięcznego, najlepszego miesiąca, zadłużenia, rekordu oraz prognozy wartości netto;
- raport miesięczny ze zmianą m/m procentową i kwotową, raport roczny od pierwszego rzeczywistego miesiąca danych i porównania rok do roku;
- rozbudowane cele finansowe z kwotą pozostałą do celu, tempem rzeczywistym i wymaganym, statusem względem planu, prognozą terminu oraz wykresem rzeczywistość–plan;
- wszystkie kwoty przechowywane bezpośrednio w PLN;
- idempotentna synchronizacja sald z Actual Budget i n8n;
- ustawienia formatu dat;
- eksport i import JSON oraz eksport historii do CSV;
- automatyczne kopie SQLite przez cron;
- czytelny interfejs: kwoty w kolumnach nie skaczą, kontrast tekstu spełnia WCAG AA, nawigacja klawiaturą ma widoczny focus, a animacje respektują systemowe ograniczenie ruchu.

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

## Waluta

Worthly przechowuje i prezentuje wszystkie kwoty bezpośrednio w PLN. Wycenę
kont walutowych należy wykonać po stronie Actual Budget przed synchronizacją.
Aplikacja nie łączy się z NBP i nie utrzymuje własnego cache kursów. Przy
pierwszym uruchomieniu wersji 1.6 istniejące konta walutowe są jednorazowo
przeliczane do PLN według kursu zapisanego wcześniej przy każdym snapshocie.

Główne sumy na dashboardzie są zaokrąglane do pełnych jednostek waluty, żeby
pozostały czytelne. Widoki kont i raportów pokazują część dziesiętną, gdy jest
potrzebna, a Aktywność i historia kont zawsze prezentują dokładne kwoty z dwoma
miejscami po przecinku.

Zakresy wykresu wartości netto są liczone kalendarzowo: `6M` obejmuje ostatnie
6 miesięcy, `1R` ostatnie 12 miesięcy, a `MAX` całą dostępną historię. Oś czasu
używa etykiet `RRRR-MM`, maksymalnie jednej na miesiąc, a najechanie na linię
pokazuje pełną datę i dokładną wartość punktu. Zmiany procentowe zachowują
kierunek także przy ujemnej wartości netto — pogłębienie zadłużenia jest
spadkiem, nie dodatnim wynikiem.

Zmiana prezentowana w podsumowaniu dashboardu porównuje dwa ostatnie globalne
punkty osi czasu. Nie sumuje zmian kont wykonanych w różnych terminach.
Snapshoty, wpisy synchronizacji i importy z datą przyszłą są odrzucane, aby
dashboard i raporty korzystały z tego samego zakresu danych.

Blok statystyk jest wyliczany wyłącznie z zapisanej osi czasu. Średni miesięczny
przyrost korzysta z maksymalnie 12 ostatnich zmian miesiąc do miesiąca, a
prognoza wartości za rok jest prostą ekstrapolacją tego tempa. Brak pełnego
okresu historycznego jest prezentowany jako brak danych, zamiast sztucznie
przyjmowanej wartości zerowej. Statystyki nie pokazują stopy oszczędności,
ponieważ aplikacja przechowuje salda, a nie komplet przychodów i wydatków.

Karta celu porównuje procent osiągniętej zmiany wartości netto z procentem
czasu, który upłynął od daty startu do terminu. Status „przed planem” lub „za
planem” używa tolerancji 3 punktów procentowych. Tempo miesięczne jest liczone
od dnia startu celu, wymagane tempo z pozostałej kwoty i czasu, a prognozowana
data zakłada utrzymanie dotychczasowego średniego tempa. Są to prognozy liniowe,
nie gwarancje wyniku inwestycyjnego.

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
- data wcześniejsza niż najstarszy datą snapshot konta jest pomijana;
- brakujące, zarchiwizowane lub niejednoznaczne konto trafia do `errors` i nie
  zatrzymuje pozostałych elementów paczki.

Przykładowa odpowiedź:

```json
{
  "created": 1,
  "updated": 2,
  "unchanged": 4,
  "skipped": 1,
  "synced": [
    {
      "date": "2026-07-26",
      "account_name": "PKO Konsolidacja",
      "currency": "PLN",
      "action": "updated"
    }
  ],
  "ignored": [
    {
      "date": "2026-07-25",
      "account_name": "PKO Konsolidacja",
      "currency": "PLN",
      "reason": "before_tracking_start",
      "tracking_start_date": "2026-07-26"
    }
  ],
  "errors": []
}
```

Workflow może codziennie przesyłać ponownie np. siedem ostatnich dni. Dzięki
upsertowi transakcja dodana z opóźnieniem do Actual Budget skoryguje historię,
a niezmienione salda nie utworzą duplikatów. Granicą historii jest najstarsza
data snapshotu konta, niezależnie od kolejności jego utworzenia. Synchronizacja
nie dopisze sald sprzed tej daty. `value` musi być nieujemną, skończoną kwotą
PLN. Opcjonalne pole `currency` może mieć wyłącznie wartość `PLN`; można je też
pominąć. Wpływ zobowiązań na wartość netto wynika z typu konta.

Workflow powinien najpierw zaktualizować wycenę PLN w Actual Budget, a dopiero
potem przesłać saldo do Worthly. Actual pozostaje dzięki temu jedynym miejscem
odpowiedzialnym za przeliczanie walut.

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
