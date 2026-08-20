import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// Serve per ricreare __dirname usando gli import ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Percorso del file CSV
const CSV_PATH = path.join(__dirname, "messages.csv");
const AUDIO_SENTIMENT_JSON_PATH = path.join(__dirname, "audio-sentiment.json");

let messages = [];

// ---------------------------------------------------------------------------
// Stato globale alert (discomfort)
// ---------------------------------------------------------------------------
const ALERT_WINDOW_MS = 11_000;   // finestra temporale in ms
const ALERT_THRESHOLD = 3;        // click necessari per attivare l'alert
const ALERT_DURATION_MS = 11_000; // quanto rimane attivo l'alert

let alertClickTimestamps = [];    // timestamp dei click nella finestra corrente
let alertActiveUntil = null;      // Date.now() + ALERT_DURATION_MS quando scatta

// middlewares
app.use(cors());
app.use(express.json());

// Legge il file JSON
app.get("/data.json", (req, res) => {
  const json = fs.readFileSync("data.json", "utf-8");
  res.setHeader("Content-Type", "application/json");
  res.send(json);
});

// Legge il file JSON
app.get("/todo.json", (req, res) => {
  const json = fs.readFileSync("todo.json", "utf-8");
  res.setHeader("Content-Type", "application/json");
  res.send(json);
});

// Legge il file JSON
app.get("/done.json", (req, res) => {
  const json = fs.readFileSync("done.json", "utf-8");
  res.setHeader("Content-Type", "application/json");
  res.send(json);
});

// ---------------------------------------------------------------------------
// Endpoint alert globale
// ---------------------------------------------------------------------------

// Registra un click di discomfort e valuta se attivare l'alert
app.post("/alert/click", (req, res) => {
  const now = Date.now();

  // Rimuove i click fuori dalla finestra temporale
  alertClickTimestamps = alertClickTimestamps.filter(
    (t) => now - t < ALERT_WINDOW_MS
  );

  alertClickTimestamps.push(now);

  let triggered = false;
  if (alertClickTimestamps.length >= ALERT_THRESHOLD) {
    alertActiveUntil = now + ALERT_DURATION_MS;
    alertClickTimestamps = []; // reset dopo lo scatto
    triggered = true;
    console.log(
      `[ALERT] Soglia raggiunta — alert attivo fino a ${new Date(
        alertActiveUntil
      ).toISOString()}`
    );
  }

  res.json({
    active: alertActiveUntil !== null && now < alertActiveUntil,
    count: alertClickTimestamps.length,
    triggered,
  });
});

// Restituisce lo stato corrente dell'alert
app.get("/alert/state", (req, res) => {
  const now = Date.now();
  const active = alertActiveUntil !== null && now < alertActiveUntil;

  // Auto-reset se il tempo è scaduto
  if (!active && alertActiveUntil !== null) {
    alertActiveUntil = null;
  }

  res.json({
    active,
    count: alertClickTimestamps.filter((t) => now - t < ALERT_WINDOW_MS).length,
    activeUntil: alertActiveUntil,
  });
});

// Reset manuale dell'alert
app.post("/alert/reset", (req, res) => {
  alertClickTimestamps = [];
  alertActiveUntil = null;
  console.log("[ALERT] Reset manuale");
  res.json({ message: "Alert resettato" });
});

// ---------------------------------------------------------------------------
// Endpoint data.json / todo.json / done.json
// ---------------------------------------------------------------------------

function getCurrentTimestamp() {
  return new Date().toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function normalizeDataRecordTimestamp(record) {
  const suppliedTimestamp = String(
    record.timestamp || ""
  ).trim();

  return {
    ...record,
    timestamp: /^\d{2}:\d{2}:\d{2}$/.test(suppliedTimestamp)
      ? suppliedTimestamp
      : getCurrentTimestamp(),
  };
}

app.post("/update", (req, res) => {
  const newData = req.body;

  if (!Array.isArray(newData)) {
    return res.status(400).json({
      error: "Expected an array",
    });
  }

  const normalizedData = newData.map((record) => {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record)
    ) {
      return record;
    }

    return normalizeDataRecordTimestamp(record);
  });

  fs.writeFileSync(
    path.join(__dirname, "data.json"),
    JSON.stringify(normalizedData, null, 2),
    "utf-8"
  );

  res.json({
    message: "Data updated",
    length: normalizedData.length,
  });
});

app.post("/add", (req, res) => {
  const newRecord = req.body;

  if (
    !newRecord ||
    typeof newRecord !== "object" ||
    Array.isArray(newRecord)
  ) {
    return res.status(400).json({
      error: "Expected a single object",
    });
  }

  const dataPath = path.join(
    __dirname,
    "data.json"
  );

  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(
      dataPath,
      JSON.stringify([], null, 2),
      "utf-8"
    );
  }

  const json = fs.readFileSync(
    dataPath,
    "utf-8"
  );

  const parsedData = JSON.parse(json);
  const data = Array.isArray(parsedData)
    ? parsedData
    : [];

  const savedRecord =
    normalizeDataRecordTimestamp(newRecord);

  data.push(savedRecord);

  fs.writeFileSync(
    dataPath,
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  res.json({
    message: "Record added",
    length: data.length,
    record: savedRecord,
  });
});

app.post("/reset", (req, res) => {
  try {
    fs.writeFileSync(
      path.join(__dirname, "data.json"),
      JSON.stringify([], null, 2),
      "utf-8"
    );

    fs.writeFileSync(
      AUDIO_SENTIMENT_JSON_PATH,
      JSON.stringify([], null, 2),
      "utf-8"
    );

    console.log(
      "[RESET] data.json e audio-sentiment.json resettati"
    );

    res.json({
      ok: true,
      message:
        "data.json e audio-sentiment.json resettati",
    });
  } catch (error) {
    console.error(
      "[RESET] Errore durante il reset:",
      error
    );

    res.status(500).json({
      error:
        "Impossibile resettare data.json e audio-sentiment.json",
    });
  }
});

// ---------------------------------------------------------------------------
// CSV messaggi chat
// ---------------------------------------------------------------------------

function escapeCsvValue(value) {
  if (value === undefined || value === null) return "";

  const stringValue = String(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Parsa una riga CSV rispettando i campi quotati.
 */
function parseCsvRow(row) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (inQuotes) {
      if (char === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }

  fields.push(current);
  return fields;
}

/**
 * Legge messages.csv e restituisce i messaggi nello stesso ordine in cui sono scritti.
 */
function readMessagesFromCsv() {
  if (!fs.existsSync(CSV_PATH)) return [];

  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length <= 1) return [];

  const header = parseCsvRow(lines[0]);
  const result = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvRow(lines[i]);
    if (fields.length < header.length) continue;

    const record = {};
    header.forEach((col, idx) => {
      record[col] = fields[idx] ?? "";
    });

    if (record.createdAt) {
      record.createdAt = Number(record.createdAt);
    }

    result.push(record);
  }

  return result;
}

function saveMessageToCsv(message) {
  const fileExists = fs.existsSync(CSV_PATH);

  if (!fileExists) {
    const header =
      ["id", "author", "address", "text", "timestamp", "createdAt"].join(",") +
      "\n";

    fs.writeFileSync(CSV_PATH, header);
  }

  const row =
    [
      escapeCsvValue(message.id),
      escapeCsvValue(message.author),
      escapeCsvValue(message.address),
      escapeCsvValue(message.text),
      escapeCsvValue(message.timestamp),
      escapeCsvValue(message.createdAt),
    ].join(",") + "\n";

  fs.appendFileSync(CSV_PATH, row);
}

app.post("/chat", (req, res) => {
  const message = req.body;

  messages.push(message);
  saveMessageToCsv(message);

  res.sendStatus(200);
});

// Restituisce i messaggi in memoria dalla sessione corrente
app.get("/messages", (req, res) => {
  res.json(messages);
});

// Resetta messages.csv
app.post("/messages/reset", (req, res) => {
  try {
    const header =
      ["id", "author", "address", "text", "timestamp", "createdAt"].join(",") +
      "\n";

    fs.writeFileSync(CSV_PATH, header);
    messages = [];

    res.json({ message: "messages.csv resettato" });
  } catch (err) {
    console.error("Errore reset CSV:", err);
    res.status(500).json({ error: "Impossibile resettare messages.csv" });
  }
});

// Legge e parsa messages.csv
app.get("/messages/csv", (req, res) => {
  try {
    const csvMessages = readMessagesFromCsv();
    res.json(csvMessages);
  } catch (err) {
    console.error("Errore lettura CSV:", err);
    res.status(500).json({ error: "Impossibile leggere messages.csv" });
  }
});

// ---------------------------------------------------------------------------
// JSON analisi sentimentale audio
// ---------------------------------------------------------------------------

/**
 * Crea audio-sentiment.json se non esiste.
 */
function ensureAudioSentimentJson() {
  if (!fs.existsSync(AUDIO_SENTIMENT_JSON_PATH)) {
    fs.writeFileSync(
      AUDIO_SENTIMENT_JSON_PATH,
      JSON.stringify([], null, 2),
      "utf-8"
    );
  }
}

/**
 * Legge i risultati audio già salvati.
 */
function readAudioSentimentJson() {
  ensureAudioSentimentJson();

  const content = fs
    .readFileSync(AUDIO_SENTIMENT_JSON_PATH, "utf-8")
    .trim();

  if (!content) {
    return [];
  }

  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(
      "[AUDIO SENTIMENT] Errore parsing audio-sentiment.json:",
      error
    );

    return [];
  }
}

/**
 * Sovrascrive audio-sentiment.json con l'array aggiornato.
 */
function writeAudioSentimentJson(results) {
  fs.writeFileSync(
    AUDIO_SENTIMENT_JSON_PATH,
    JSON.stringify(results, null, 2),
    "utf-8"
  );
}

/**
 * Calcola il prossimo ID progressivo.
 */
function getNextAudioSentimentId(results) {
  if (results.length === 0) {
    return 1;
  }

  const maximumId = results.reduce((maximum, result) => {
    const currentId = Number(result.id);

    if (!Number.isInteger(currentId)) {
      return maximum;
    }

    return Math.max(maximum, currentId);
  }, 0);

  return maximumId + 1;
}

/**
 * Riceve dal notebook il risultato degli ultimi 60 secondi.
 *
 * Formato richiesto:
 *
 * {
 *   "timestamp": "15:42:20",
 *   "value": 6.25,
 *   "labels": ["positive", "neutral"]
 * }
 */
app.post("/audio-analysis", (req, res) => {
  try {
    const result = req.body;

    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      return res.status(400).json({
        error: "Expected an analysis object",
      });
    }

    const timestamp = String(
      result.timestamp || ""
    ).trim();

    const value = Number(result.value);

    const labels = Array.isArray(result.labels)
      ? result.labels.map((label) =>
          String(label).trim().toLowerCase()
        )
      : [];

    if (!/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
      return res.status(400).json({
        error: "timestamp must use the HH:MM:SS format",
      });
    }

    if (!Number.isFinite(value)) {
      return res.status(400).json({
        error: "value must be a valid number",
      });
    }

    const allowedLabels = new Set([
      "positive",
      "neutral",
      "negative",
    ]);

    const invalidLabels = labels.filter(
      (label) => !allowedLabels.has(label)
    );

    if (invalidLabels.length > 0) {
      return res.status(400).json({
        error: "labels contains invalid values",
        invalidLabels,
      });
    }

    const results = readAudioSentimentJson();

    const savedResult = {
      id: getNextAudioSentimentId(results),
      timestamp,
      value,
      labels,
    };

    results.push(savedResult);
    writeAudioSentimentJson(results);

    console.log(
      `[AUDIO SENTIMENT] Record ${savedResult.id} salvato: ` +
        `${timestamp} - value=${value.toFixed(4)}`
    );

    res.json({
      ok: true,
      message: "Audio sentiment result saved",
      record: savedResult,
      file: path.basename(AUDIO_SENTIMENT_JSON_PATH),
    });
  } catch (error) {
    console.error(
      "[AUDIO SENTIMENT] Errore salvataggio:",
      error
    );

    res.status(500).json({
      error: "Impossibile salvare il risultato audio",
    });
  }
});

/**
 * Restituisce tutti i risultati dell'analisi audio.
 */
app.get("/audio-analysis/json", (req, res) => {
  try {
    const results = readAudioSentimentJson();
    res.json(results);
  } catch (error) {
    console.error(
      "[AUDIO SENTIMENT] Errore lettura JSON:",
      error
    );

    res.status(500).json({
      error: "Impossibile leggere audio-sentiment.json",
    });
  }
});

/**
 * Scarica direttamente audio-sentiment.json.
 */
app.get("/audio-analysis/download", (req, res) => {
  try {
    ensureAudioSentimentJson();

    res.download(
      AUDIO_SENTIMENT_JSON_PATH,
      "audio-sentiment.json"
    );
  } catch (error) {
    console.error(
      "[AUDIO SENTIMENT] Errore download JSON:",
      error
    );

    res.status(500).json({
      error: "Impossibile scaricare audio-sentiment.json",
    });
  }
});

/**
 * Resetta soltanto i risultati dell'analisi audio.
 */
app.post("/audio-analysis/reset", (req, res) => {
  try {
    writeAudioSentimentJson([]);

    res.json({
      ok: true,
      message: "audio-sentiment.json resettato",
    });
  } catch (error) {
    console.error(
      "[AUDIO SENTIMENT] Errore reset JSON:",
      error
    );

    res.status(500).json({
      error: "Impossibile resettare audio-sentiment.json",
    });
  }
});

// ---------------------------------------------------------------------------
// Endpoint esperimenti — salvataggio trial plan e risposte partecipanti
// ---------------------------------------------------------------------------

const EXPERIMENT_DIR = path.join(__dirname, "experiment-results");
const TRIAL_PLANS_JSONL_PATH = path.join(EXPERIMENT_DIR, "trial-plans.jsonl");
const RESPONSES_JSONL_PATH = path.join(EXPERIMENT_DIR, "responses.jsonl");

function ensureExperimentDir() {
  if (!fs.existsSync(EXPERIMENT_DIR)) {
    fs.mkdirSync(EXPERIMENT_DIR, { recursive: true });
  }
}

function safeFileName(value) {
  return String(value || "unknown")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function getResponseTestName(response) {
  const testNames = {
    "cat1-test-1-1": "Category 1 - Test 1.1",
    "cat1-test-1-2": "Category 1 - Test 1.2",

    "cat2-composition": "Category 2 - Composition",

    "cat3-test-3-1": "Category 3 - Test 3.1",
    "cat3-test-3-2": "Category 3 - Test 3.2",

    "cat4-temporal": "Category 4 - Temporal",

    "inter-test-1-a": "Inter-class Test 1 - Variant A",
    "inter-test-1-b": "Inter-class Test 1 - Variant B",
    "inter-test-1-final-likert": "Inter-class Test 1 - Final Likert",

    "inter-test-2-a": "Inter-class Test 2 - Variant A",
    "inter-test-2-b": "Inter-class Test 2 - Variant B",
    "inter-test-2-final-likert": "Inter-class Test 2 - Final Likert",

    "inter-test-3-a": "Inter-class Test 3 - Variant A",
    "inter-test-3-b": "Inter-class Test 3 - Variant B",
    "inter-test-3-final-likert": "Inter-class Test 3 - Final Likert",
  };

  return (
    response.testName ||
    response.testTitle ||
    testNames[response.testId] ||
    response.testId ||
    "unknown-test"
  );
}

function buildResponseFileName(response) {
  const testNameSafe = safeFileName(getResponseTestName(response));
  const addressSafe = safeFileName(
    response.address ||
      response.userAddress ||
      response.participantAddress ||
      response.playerAddress ||
      "unknown-address"
  );

  return `${testNameSafe} - ${addressSafe}.json`;
}

function readJsonArrayFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8").trim();

  if (!content) {
    return [];
  }

  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error(`[EXPERIMENT] Errore parsing JSON array da ${filePath}:`, err);
    return [];
  }
}

function writeJsonArrayFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// Salva il piano randomizzato dei trial del test
app.post("/experiment/trial-plan", (req, res) => {
  try {
    ensureExperimentDir();

    const plan = req.body;

    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      return res.status(400).json({ error: "Expected a trial plan object" });
    }

    if (!plan.runId) {
      return res.status(400).json({ error: "Missing runId" });
    }

    if (!Array.isArray(plan.trials)) {
      return res.status(400).json({ error: "Missing trials array" });
    }

    const savedPlan = {
      ...plan,
      createdAtServer: new Date().toISOString(),
    };

    const runIdSafe = safeFileName(plan.runId);
    const planPath = path.join(EXPERIMENT_DIR, `trial-plan-${runIdSafe}.json`);

    // File JSON della singola sessione
    fs.writeFileSync(planPath, JSON.stringify(savedPlan, null, 2), "utf-8");

    // File JSONL globale con tutti i trial plan
    fs.appendFileSync(
      TRIAL_PLANS_JSONL_PATH,
      JSON.stringify(savedPlan) + "\n",
      "utf-8"
    );

    console.log(`[EXPERIMENT] Trial plan salvato: ${planPath}`);

    res.json({
      ok: true,
      message: "Trial plan saved",
      runId: plan.runId,
      totalTrials: plan.trials.length,
    });
  } catch (err) {
    console.error("[EXPERIMENT] Errore salvataggio trial plan:", err);
    res.status(500).json({ error: "Impossibile salvare il trial plan" });
  }
});

// Salva una risposta del partecipante
app.post("/experiment/response", (req, res) => {
  try {
    ensureExperimentDir();

    const response = req.body;

    if (!response || typeof response !== "object" || Array.isArray(response)) {
      return res.status(400).json({ error: "Expected a response object" });
    }

    if (!response.runId) {
      return res.status(400).json({ error: "Missing runId" });
    }

    const expectedLabel = String(response.expectedLabel || "");
    const selectedLabel = String(response.selectedLabel || "");
    const isCorrect = expectedLabel === selectedLabel;

    const savedResponse = {
      ...response,
      isCorrect,
      accuracyType: response.accuracyType || (isCorrect ? "correct" : "wrong"),
      createdAtServer: new Date().toISOString(),
    };

    const runResponsesPath = path.join(
      EXPERIMENT_DIR,
      buildResponseFileName(response)
    );

    // File JSON del singolo test per partecipante.
    // Nome file: "nome del test - address.json".
    // Se la stessa persona ripete lo stesso test, il nuovo runId sovrascrive il tentativo precedente.
    const previousResponses = readJsonArrayFile(runResponsesPath);

    const runResponses = previousResponses.some(
      (item) => item.runId !== response.runId
    )
      ? []
      : previousResponses;

    runResponses.push(savedResponse);
    writeJsonArrayFile(runResponsesPath, runResponses);

    // File JSONL globale con tutte le risposte
    fs.appendFileSync(
      RESPONSES_JSONL_PATH,
      JSON.stringify(savedResponse) + "\n",
      "utf-8"
    );

    console.log(
      `[EXPERIMENT] Risposta salvata: ${
        savedResponse.testId || "unknown"
      } - trial ${savedResponse.trialIndex ?? "?"} - ${
        savedResponse.accuracyType
      }`
    );

    res.json({
      ok: true,
      message: "Response saved",
      isCorrect: savedResponse.isCorrect,
      accuracyType: savedResponse.accuracyType,
    });
  } catch (err) {
    console.error("[EXPERIMENT] Errore salvataggio risposta:", err);
    res.status(500).json({ error: "Impossibile salvare la risposta" });
  }
});

// Legge tutti i trial plan salvati
app.get("/experiment/trial-plans", (req, res) => {
  try {
    ensureExperimentDir();

    if (!fs.existsSync(TRIAL_PLANS_JSONL_PATH)) {
      return res.json([]);
    }

    const lines = fs
      .readFileSync(TRIAL_PLANS_JSONL_PATH, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0);

    res.json(lines.map((line) => JSON.parse(line)));
  } catch (err) {
    console.error("[EXPERIMENT] Errore lettura trial plans:", err);
    res.status(500).json({ error: "Impossibile leggere i trial plans" });
  }
});

// Legge tutte le risposte salvate
app.get("/experiment/responses", (req, res) => {
  try {
    ensureExperimentDir();

    if (!fs.existsSync(RESPONSES_JSONL_PATH)) {
      return res.json([]);
    }

    const lines = fs
      .readFileSync(RESPONSES_JSONL_PATH, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0);

    res.json(lines.map((line) => JSON.parse(line)));
  } catch (err) {
    console.error("[EXPERIMENT] Errore lettura risposte:", err);
    res.status(500).json({ error: "Impossibile leggere le risposte" });
  }
});

// Reset dei dati sperimentali
app.post("/experiment/reset", (req, res) => {
  try {
    ensureExperimentDir();

    fs.writeFileSync(TRIAL_PLANS_JSONL_PATH, "", "utf-8");
    fs.writeFileSync(RESPONSES_JSONL_PATH, "", "utf-8");

    const files = fs.readdirSync(EXPERIMENT_DIR);

    for (const file of files) {
      if (file.endsWith(".json")) {
        fs.unlinkSync(path.join(EXPERIMENT_DIR, file));
      }
    }

    console.log("[EXPERIMENT] Dati esperimenti resettati");

    res.json({ ok: true, message: "Experiment data reset" });
  } catch (err) {
    console.error("[EXPERIMENT] Errore reset esperimenti:", err);
    res.status(500).json({ error: "Impossibile resettare i dati esperimento" });
  }
});

const EXPERIMENT_RESULTS_DIR = path.join(__dirname, 'experiment-results')

const TEST_ID_ALIASES = {
  'cat1-test-1-1': 'test-1-1',
  'category1-test-1-1': 'test-1-1',
  'category-1-test-1-1': 'test-1-1',
  'category 1 - test 1.1': 'test-1-1',
  'category 1 test 1.1': 'test-1-1',
  'intra 1.1': 'test-1-1',

  'cat1-test-1-2': 'test-1-2',
  'category1-test-1-2': 'test-1-2',
  'category-1-test-1-2': 'test-1-2',
  'category 1 - test 1.2': 'test-1-2',
  'category 1 test 1.2': 'test-1-2',
  'intra 1.2': 'test-1-2',

  'cat2-test-composition': 'test-composition',
  'category2-test-composition': 'test-composition',
  'category-2-test-composition': 'test-composition',
  'composition-test': 'test-composition',
  'category 2 - composition': 'test-composition',
  'category 2 composition': 'test-composition',
  'category 2 - test composition': 'test-composition',
  'intra 2': 'test-composition',

  'cat3-test-3-1': 'test-3-1',
  'category3-test-3-1': 'test-3-1',
  'category-3-test-3-1': 'test-3-1',
  'category 3 - test 3.1': 'test-3-1',
  'category 3 test 3.1': 'test-3-1',
  'intra 3.1': 'test-3-1',

  'cat3-test-3-2': 'test-3-2',
  'category3-test-3-2': 'test-3-2',
  'category-3-test-3-2': 'test-3-2',
  'category 3 - test 3.2': 'test-3-2',
  'category 3 test 3.2': 'test-3-2',
  'intra 3.2': 'test-3-2',

  'cat4-test-temporal': 'test-temporal',
  'category4-test-temporal': 'test-temporal',
  'category-4-test-temporal': 'test-temporal',
  'temporal-test': 'test-temporal',
  'category 4 - temporal': 'test-temporal',
  'category 4 temporal': 'test-temporal',
  'category 4 - test temporal': 'test-temporal',
  'intra 4': 'test-temporal',

  'inter-class test 1a': 'inter-test-1-a',
  'inter test 1a': 'inter-test-1-a',
  'inter 1a': 'inter-test-1-a',

  'inter-class test 1b': 'inter-test-1-b',
  'inter test 1b': 'inter-test-1-b',
  'inter 1b': 'inter-test-1-b',

  'inter-class test 1 - final comparison': 'inter-test-1-final-likert',
  'inter test 1 final': 'inter-test-1-final-likert',
  'inter 1 final': 'inter-test-1-final-likert',

  'inter-class test 2a': 'inter-test-2-a',
  'inter test 2a': 'inter-test-2-a',
  'inter 2a': 'inter-test-2-a',

  'inter-class test 2b': 'inter-test-2-b',
  'inter test 2b': 'inter-test-2-b',
  'inter 2b': 'inter-test-2-b',

  'inter-class test 2 - final comparison': 'inter-test-2-final-likert',
  'inter test 2 final': 'inter-test-2-final-likert',
  'inter 2 final': 'inter-test-2-final-likert',

  'inter-class test 3a': 'inter-test-3-a',
  'inter test 3a': 'inter-test-3-a',
  'inter 3a': 'inter-test-3-a',

  'inter-class test 3b': 'inter-test-3-b',
  'inter test 3b': 'inter-test-3-b',
  'inter 3b': 'inter-test-3-b',

  'inter-class test 3 - final comparison': 'inter-test-3-final-likert',
  'inter test 3 final': 'inter-test-3-final-likert',
  'inter 3 final': 'inter-test-3-final-likert',
}

const KNOWN_TEST_IDS = new Set([
  'test-1-1',
  'test-1-2',
  'test-composition',
  'test-3-1',
  'test-3-2',
  'test-temporal',
  'inter-test-1-a',
  'inter-test-1-b',
  'inter-test-1-final-likert',
  'inter-test-2-a',
  'inter-test-2-b',
  'inter-test-2-final-likert',
  'inter-test-3-a',
  'inter-test-3-b',
  'inter-test-3-final-likert',
  'all-tests',
])

function normalizeAddressForCompare(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeTestId(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return TEST_ID_ALIASES[normalized] || normalized
}

function walkJsonFiles(dir) {
  if (!fs.existsSync(dir)) return []

  const result = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkJsonFiles(fullPath))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      result.push(fullPath)
    }
  }

  return result
}

function collectValuesByKey(value, keys, output = []) {
  if (!value || typeof value !== 'object') return output

  if (Array.isArray(value)) {
    for (const item of value) collectValuesByKey(item, keys, output)
    return output
  }

  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key)) output.push(child)
    collectValuesByKey(child, keys, output)
  }

  return output
}

function extractTestIdFromFileName(filePath) {
  const baseName = path.basename(filePath, '.json')
  const maybeTestName = baseName.includes(' - ')
    ? baseName.slice(0, baseName.lastIndexOf(' - '))
    : baseName

  const normalized = normalizeTestId(maybeTestName)
  return KNOWN_TEST_IDS.has(normalized) ? normalized : ''
}

function isOnlyTrialPlan(payload, filePath) {
  const lowerName = path.basename(filePath).toLowerCase()
  if (lowerName.includes('trial-plan')) return true

  // Trial-plan files contain the generated trials but not an answer/response.
  // They should not mark a test as completed by themselves.
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    Array.isArray(payload.trials) &&
    !payload.responseType &&
    !payload.answers &&
    !payload.selectedAnswer &&
    !payload.selectedLabel &&
    !payload.selectedValue &&
    !payload.isCorrect
  )
}

function resultBelongsToAddress(payload, filePath, requestedAddress) {
  const requested = normalizeAddressForCompare(requestedAddress)
  if (!requested) return false

  const addressValues = collectValuesByKey(payload, new Set([
    'address',
    'playerAddress',
    'userAddress',
    'walletAddress',
    'employee',
    'userId',
  ]))

  if (addressValues.some((value) => normalizeAddressForCompare(value) === requested)) {
    return true
  }

  // Fallback for files named like: "test-name - address.json".
  const normalizedFileName = normalizeAddressForCompare(path.basename(filePath))
  return normalizedFileName.includes(requested)
}

function extractCompletedTestIds(payload, filePath) {
  const ids = new Set()

  for (const value of collectValuesByKey(payload, new Set(['testId', 'test', 'testType']))) {
    const normalized = normalizeTestId(value)
    if (KNOWN_TEST_IDS.has(normalized)) ids.add(normalized)
  }

  const fromFileName = extractTestIdFromFileName(filePath)
  if (fromFileName) ids.add(fromFileName)

  return ids
}

app.get('/experiment/completed-tests/:address', (req, res) => {
  const address = req.params.address
  const completed = new Set()
  let filesChecked = 0

  try {
    const files = walkJsonFiles(EXPERIMENT_RESULTS_DIR)

    for (const filePath of files) {
      let payload
      try {
        payload = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      } catch (error) {
        console.log('[COMPLETED TESTS] Skipping invalid JSON:', filePath, error.message)
        continue
      }

      filesChecked++

      if (isOnlyTrialPlan(payload, filePath)) continue
      if (!resultBelongsToAddress(payload, filePath, address)) continue

      for (const testId of extractCompletedTestIds(payload, filePath)) {
        completed.add(testId)
      }
    }

    const completedTests = [...completed].sort()
    const completedMap = Object.fromEntries(completedTests.map((testId) => [testId, true]))

    res.json({
      address,
      completedTests,
      completedMap,
      filesChecked,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[COMPLETED TESTS] Error:', error)
    res.status(500).json({ error: 'Unable to read completed tests.' })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});