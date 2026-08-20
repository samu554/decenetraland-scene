# Rolling System Audio Recorder con trascrizione CSV

Il modulo:

- acquisisce l'audio condiviso dal browser;
- conserva in memoria al massimo gli ultimi 60 secondi;
- ogni 20 secondi genera un WAV mono PCM valido;
- trascrive localmente l'audio con `faster-whisper`;
- salva il testo nuovo in un CSV con colonne `timestamp` e `text`;
- evita di salvare più volte i 40 secondi sovrapposti tra due finestre consecutive.

## File principali

- `pcm-capture-processor.js`: AudioWorklet che converte l'ingresso in PCM mono.
- `rollingSystemAudioRecorder.ts`: buffer circolare e invio HTTP.
- `example.ts`: esempio di integrazione con due pulsanti.
- `index.html`: pagina dimostrativa.
- `transcription_receiver.py`: FastAPI, Whisper e scrittura dei CSV.

## Installazione su Windows PowerShell

Dalla cartella del modulo:

```powershell
py -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn transcription_receiver:app --reload --port 8000
```

Apri:

- stato server: `http://127.0.0.1:8000/`
- documentazione API: `http://127.0.0.1:8000/docs`

Alla prima trascrizione `faster-whisper` scarica il modello configurato. Il modello
predefinito è `small`, eseguito su CPU con quantizzazione `int8`.

## CSV generati

Per ogni `session_id` viene creato un file separato:

```text
transcriptions/<session_id>.csv
```

Esempio:

```csv
timestamp,text
2026-07-23T15:41:20.357+00:00,Ciao e benvenuti nel test.
2026-07-23T15:41:25.912+00:00,Ora osservate il grafico davanti a voi.
```

Il CSV usa UTF-8 con BOM per essere aperto correttamente anche con Excel su Windows.

Il file può essere scaricato anche tramite:

```text
http://127.0.0.1:8000/transcriptions/<session_id>.csv
```

L'ID usato dall'esempio è simile a `test-1784812345678` e viene mostrato nella
console del browser insieme alla risposta del server.

## Come vengono evitati i duplicati

Ogni richiesta contiene fino agli ultimi 60 secondi, ma il frontend comunica anche
quanti secondi sono realmente nuovi rispetto all'ultimo invio riuscito. Whisper usa
i timestamp delle singole parole e il server aggiunge al CSV soltanto la porzione
nuova. Anche l'invio finale eseguito quando si preme **Ferma registrazione** salva
soltanto l'audio trascorso dall'ultimo invio.

## Configurazione del modello

Le impostazioni possono essere cambiate prima dell'avvio del server:

```powershell
$env:WHISPER_MODEL="small"
$env:WHISPER_LANGUAGE="it"
$env:WHISPER_DEVICE="cpu"
$env:WHISPER_COMPUTE_TYPE="int8"
python -m uvicorn transcription_receiver:app --reload --port 8000
```

Per il rilevamento automatico della lingua:

```powershell
$env:WHISPER_LANGUAGE=""
```

Modelli più grandi possono essere più accurati ma richiedono più memoria e tempo.

## Avvio frontend con Vite

Copia:

- `rollingSystemAudioRecorder.ts` ed `example.ts` in `src/`;
- `pcm-capture-processor.js` in `public/`;
- `index.html` nella radice del progetto.

Poi avvia la pagina tramite HTTPS oppure localhost. La cattura deve partire da un
clic dell'utente.

Quando premi **Avvia registrazione audio**:

1. seleziona la scheda, finestra o schermo corretto;
2. abilita la casella per condividere l'audio;
3. non chiudere la condivisione finché il test non è terminato.
