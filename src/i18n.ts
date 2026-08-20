export type UiLanguage = 'en' | 'it'

type LanguageChangeListener = (language: UiLanguage) => void

let currentLanguage: UiLanguage = 'en'
const languageChangeListeners = new Set<LanguageChangeListener>()

export function getLanguage(): UiLanguage {
  return currentLanguage
}

export function setLanguage(language: UiLanguage) {
  if (language === currentLanguage) return
  currentLanguage = language

  for (const listener of languageChangeListeners) {
    listener(currentLanguage)
  }
}

export function toggleLanguage() {
  setLanguage(currentLanguage === 'en' ? 'it' : 'en')
}

export function onLanguageChange(listener: LanguageChangeListener) {
  languageChangeListeners.add(listener)
  return () => languageChangeListeners.delete(listener)
}

export function t(english: string, italian: string) {
  return currentLanguage === 'it' ? italian : english
}

const ITALIAN_TEXT: Record<string, string> = {
  // Common graph labels
  'Sentiment emoji': 'Emoji del sentimento',
  'Sentiment emoji/image': 'Emoji/immagine del sentimento',
  'sentiment emoji/image': 'emoji/immagine del sentimento',
  'Sentiment image': 'Immagine del sentimento',
  'sentiment image': 'immagine del sentimento',
  'Sentiment light': 'Luce del sentimento',
  'sentiment light': 'luce del sentimento',
  'Simple donut': 'Grafico ad anello semplice',
  'simple donut chart': 'grafico ad anello semplice',
  'Sentiment meter': 'Indicatore del sentimento',
  'Sentiment bar': 'Barra del sentimento',
  'sentiment bar/meter': 'barra/indicatore del sentimento',
  'Tricolor donut': 'Grafico ad anello tricolore',
  '3-color donut': 'Grafico ad anello a 3 colori',
  'three-colour donut chart': 'grafico ad anello a tre colori',
  'Bar chart': 'Grafico a barre',
  'Temporal bar chart': 'Grafico temporale a barre',
  'temporal bar chart': 'grafico temporale a barre',
  'Heatmap': 'Mappa di calore',
  'heatmap': 'mappa di calore',
  'Simple donut vs Sentiment meter': 'Grafico ad anello semplice vs indicatore del sentimento',
  'the questionnaire screen': 'la schermata del questionario',
  'Awful': 'Pessimo',
  'Bad': 'Negativo',
  'Neutral': 'Neutro',
  'Good': 'Positivo',
  'Great': 'Ottimo',
  'Negative': 'Negativo',
  'Positive': 'Positivo',
  'Unclear': 'Non chiaro',
  'Category 1 - Test 1.1': 'Categoria 1 - Test 1.1',
  'Category 1 - Test 1.2': 'Categoria 1 - Test 1.2',
  'Category 3 - Test 3.1': 'Categoria 3 - Test 3.1',
  'Category 3 - Test 3.2': 'Categoria 3 - Test 3.2',
  'Inter-class Test 1 - Variant A': 'Test inter-classe 1 - Variante A',
  'Inter-class Test 1 - Variant B': 'Test inter-classe 1 - Variante B',
  'Inter-class Test 2 - Variant A': 'Test inter-classe 2 - Variante A',
  'Inter-class Test 2 - Variant B': 'Test inter-classe 2 - Variante B',
  'Inter-class Test 3 - Variant A': 'Test inter-classe 3 - Variante A',
  'Inter-class Test 3 - Variant B': 'Test inter-classe 3 - Variante B',
  'Inter-class Test 1 - final comparison': 'Test inter-classe 1 - confronto finale',
  'Inter-class Test 2 - final comparison': 'Test inter-classe 2 - confronto finale',
  'Inter-class Test 3 - final comparison': 'Test inter-classe 3 - confronto finale',
  'Inter 1 final': 'Inter 1 finale',
  'Inter 2 final': 'Inter 2 finale',
  'Inter 3 final': 'Inter 3 finale',

  // Intro titles
  'Complete all tests': 'Completa tutti i test',
  'Intra-class Test 1.1 - immediate sentiment recognition': 'Test intra-classe 1.1 - riconoscimento immediato del sentimento',
  'Intra-class Test 1.2 - numeric interpretation': 'Test intra-classe 1.2 - interpretazione numerica',
  'Intra-class Test 2 - sentiment composition': 'Test intra-classe 2 - composizione del sentimento',
  'Intra-class Test 3.1 - precise value estimation': 'Test intra-classe 3.1 - stima precisa del valore',
  'Intra-class Test 3.2 - comparison between values': 'Test intra-classe 3.2 - confronto tra valori',
  'Intra-class Test 4 - temporal sentiment reading': 'Test intra-classe 4 - lettura temporale del sentimento',
  'Inter-class test': 'Test inter-classe',

  // Intro descriptions and instructions
  'You will complete the full sequence of tests using the GUI controls.': 'Completerai l’intera sequenza di test utilizzando i controlli della GUI.',
  'Follow the instructions shown during each test.': 'Segui le istruzioni mostrate durante ogni test.',
  'Answer using the GUI controls when they appear.': 'Rispondi utilizzando i controlli della GUI quando compaiono.',
  'The sequence will continue automatically from one test to the next whenever possible.': 'La sequenza passerà automaticamente da un test al successivo quando possibile.',
  'Press Start when you are ready to begin the full flow.': 'Premi Avvia quando sei pronto a iniziare l’intero percorso.',
  'Choose the sentiment label that best describes what the element is communicating.': 'Scegli l’etichetta di sentimento che descrive meglio ciò che l’elemento comunica.',
  'Rely on your first interpretation.': 'Basati sulla tua prima interpretazione.',
  'Press Start when you are ready to begin.': 'Premi Avvia quando sei pronto a iniziare.',
  'Assign a value from 0 to 10 to the sentiment you perceive.': 'Assegna un valore da 0 a 10 al sentimento che percepisci.',
  'Use the number that best represents your interpretation of the visual feedback.': 'Usa il numero che rappresenta meglio la tua interpretazione del feedback visivo.',
  'Identify the dominant sentiment class: positive, neutral, negative or unclear.': 'Individua la classe di sentimento dominante: positiva, neutra, negativa o non chiara.',
  'Estimate the percentage of positive, neutral and negative messages.': 'Stima la percentuale di messaggi positivi, neutri e negativi.',
  'Use the chart to read the distribution between the three classes.': 'Usa il grafico per leggere la distribuzione tra le tre classi.',
  'Enter the value you think it indicates on a 0-10 scale.': 'Inserisci il valore che ritieni indicato su una scala da 0 a 10.',
  'Use one decimal digit when needed.': 'Usa una cifra decimale quando necessario.',
  'Look at both visualizations displayed in the scene.': 'Osserva entrambe le visualizzazioni mostrate nella scena.',
  'Select which one indicates a more positive sentiment.': 'Seleziona quale indica un sentimento più positivo.',
  'Estimate how far apart the two values are.': 'Stima la distanza tra i due valori.',
  'Decide whether the conversation is improving, worsening or remaining stable.': 'Decidi se la conversazione sta migliorando, peggiorando o rimanendo stabile.',
  'Report whether there are significant moments, peaks or anomalies.': 'Indica se sono presenti momenti significativi, picchi o anomalie.',
  'Read each statement carefully.': 'Leggi attentamente ogni affermazione.',
  'Answer using the 1-5 Likert scale shown in the GUI.': 'Rispondi usando la scala Likert da 1 a 5 mostrata nella GUI.',
  'Base your answers on the two variants you observed, not on a single scenario only.': 'Basa le risposte sulle due varianti osservate, non su un solo scenario.',
  'Press Start to open the final scale.': 'Premi Avvia per aprire la scala finale.',
  'Track the general sentiment trend during the playback.': 'Segui l’andamento generale del sentimento durante la riproduzione.',
  'At the end, answer the GUI questions about the trend and any significant changes.': 'Alla fine, rispondi alle domande della GUI sull’andamento e sugli eventuali cambiamenti significativi.',
  'Press Start when you are ready to begin the simulation.': 'Premi Avvia quando sei pronto a iniziare la simulazione.',
  'Observe the visualizations in the scene.': 'Osserva le visualizzazioni nella scena.',
  'Use the GUI to answer the questions when prompted.': 'Usa la GUI per rispondere alle domande quando richiesto.',

  // Inter-class runtime texts
  'This simulation is accelerated compared with the intended use to make testing easier.': 'Questa simulazione è accelerata rispetto all’uso previsto per facilitare il test.',
  '1 = Strongly disagree, 5 = Strongly agree.': '1 = Fortemente in disaccordo, 5 = Fortemente d’accordo.',
  'Answer these 3 questions only after completing both variants A and B. Every statement is phrased as Variant A being better than Variant B.': 'Rispondi a queste 3 domande solo dopo aver completato entrambe le varianti A e B. Ogni affermazione è formulata considerando la Variante A migliore della Variante B.',

  // Variant Likert questions
  'I clearly understood the current sentiment value.': 'Ho compreso chiaramente il valore attuale del sentimento.',
  'The visualizations were easy to read in the 3D virtual environment.': 'Le visualizzazioni erano facili da leggere nell’ambiente virtuale 3D.',
  'I felt confident in my answer about the conversation trend.': 'Mi sono sentito sicuro della mia risposta sull’andamento della conversazione.',
  'I clearly understood the composition of positive, neutral, and negative messages.': 'Ho compreso chiaramente la composizione dei messaggi positivi, neutri e negativi.',
  'I clearly understood whether the sentiment was improving, worsening, or staying stable.': 'Ho compreso chiaramente se il sentimento stava migliorando, peggiorando o rimanendo stabile.',

  // Comparative Likert questions
  'In terms of quickly understanding the current sentiment, Variant A is better than Variant B.': 'Per comprendere rapidamente il sentimento attuale, la Variante A è migliore della Variante B.',
  'In terms of precisely estimating the current sentiment value, Variant A is better than Variant B.': 'Per stimare con precisione il valore attuale del sentimento, la Variante A è migliore della Variante B.',
  'In terms of monitoring a conversation in real time, Variant A is better than Variant B.': 'Per monitorare una conversazione in tempo reale, la Variante A è migliore della Variante B.',
  'In terms of understanding the dominant sentiment, Variant A is better than Variant B.': 'Per comprendere il sentimento dominante, la Variante A è migliore della Variante B.',
  'In terms of distinguishing a neutral conversation from a polarized one, Variant A is better than Variant B.': 'Per distinguere una conversazione neutra da una polarizzata, la Variante A è migliore della Variante B.',
  'In terms of understanding the conversation quickly without too much visual information, Variant A is better than Variant B.': 'Per comprendere rapidamente la conversazione senza troppe informazioni visive, la Variante A è migliore della Variante B.',
  'In terms of understanding the evolution of sentiment over time, Variant A is better than Variant B.': 'Per comprendere l’evoluzione del sentimento nel tempo, la Variante A è migliore della Variante B.',
  'In terms of identifying critical moments or anomalies, Variant A is better than Variant B.': 'Per individuare momenti critici o anomalie, la Variante A è migliore della Variante B.',
  'In terms of understanding the current overall state of the conversation, Variant A is better than Variant B.': 'Per comprendere lo stato generale attuale della conversazione, la Variante A è migliore della Variante B.',

  // Scenario labels
  'Stable positive - no anomaly': 'Positivo stabile - nessuna anomalia',
  'Stable positive - with anomaly': 'Positivo stabile - con anomalia',
  'Sudden drop - no anomaly': 'Calo improvviso - nessuna anomalia',
  'Sudden drop - with anomaly': 'Calo improvviso - con anomalia',
  'Gradual improvement - no anomaly': 'Miglioramento graduale - nessuna anomalia',
  'Gradual improvement - with anomaly': 'Miglioramento graduale - con anomalia',
  'Polarized - no anomaly': 'Polarizzata - nessuna anomalia',
  'Polarized - with anomaly': 'Polarizzata - con anomalia',
  'Uniform improvement': 'Miglioramento uniforme',
  'Uniform worsening': 'Peggioramento uniforme',
  'Stable with low noise': 'Stabile con poco rumore',
  'Stable with high noise': 'Stabile con molto rumore',
  'Improvement with an isolated negative spike': 'Miglioramento con un picco negativo isolato',
  'Periodic oscillation': 'Oscillazione periodica',

  // Board
  'Configure test': 'Configura test',
  'Choose the mode:': 'Scegli la modalità:',
  'Run all tests': 'Esegui tutti i test',
  'Intra-class': 'Intra-classe',
  'Inter-class': 'Inter-classe',
  'Hide all': 'Nascondi tutto',
  'Visualizations\nhidden.': 'Visualizzazioni\nnascoste.',
  '< Back': '< Indietro',
  'Choose the comparison\nbetween categories:': 'Scegli il confronto\ntra categorie:',
  'Inter - Test 1': 'Inter - Test 1',
  'Inter - Test 2': 'Inter - Test 2',
  'Inter - Test 3': 'Inter - Test 3',
  'Temporal chart +\ncurrent value reading.\nA: emoji + bars\nB: sentiment meter + bars': 'Grafico temporale +\nlettura del valore attuale.\nA: emoji + barre\nB: indicatore + barre',
  'Aggregate trend\nversus sentiment composition.\nA: emoji + bars\nB: 3-color donut + bars': 'Andamento aggregato\nrispetto alla composizione.\nA: emoji + barre\nB: anello a 3 colori + barre',
  'Current-state charts\nversus temporal context.\nA: meter + 3-color donut\nB: bars only': 'Grafici dello stato attuale\nrispetto al contesto temporale.\nA: indicatore + anello a 3 colori\nB: solo barre',
  'Case A': 'Caso A',
  'Case B': 'Caso B',
  'Final Likert': 'Likert finale',
  'Choose the category:': 'Scegli la categoria:',
  'Cat.1 Indicators': 'Cat.1 Indicatori',
  'Cat.2 Composition': 'Cat.2 Composizione',
  'Cat.3 Quantitative': 'Cat.3 Quantitativa',
  'Cat.4 Temporal': 'Cat.4 Temporale',
  'Cat.1 - Indicators': 'Cat.1 - Indicatori',
  '1.1: classify the sentiment.\n1.2: assign a 0-10 value.\nCharts: emoji, light, donut and meter.': '1.1: classifica il sentimento.\n1.2: assegna un valore 0-10.\nGrafici: emoji, luce, anello e indicatore.',
  'Cat.2 - Composition': 'Cat.2 - Composizione',
  'Estimate the dominant class and %\nof the three classes.\nChart: 3-color donut.': 'Stima la classe dominante e la %\ndelle tre classi.\nGrafico: anello a 3 colori.',
  'Start test': 'Avvia test',
  'Cat.3 - Quantitative': 'Cat.3 - Quantitativa',
  '3.1: estimate the value (0-10).\n3.2: choose the higher value\nand estimate the distance.\nCharts: donut + meter.': '3.1: stima il valore (0-10).\n3.2: scegli il valore maggiore\ne stima la distanza.\nGrafici: anello + indicatore.',
  'Cat.3 - Donut': 'Cat.3 - Anello',
  'Cat.3 - Meter': 'Cat.3 - Indicatore',
  'Cat.4 - Temporal': 'Cat.4 - Temporale',
  'Read the trend and report\nwhether anomalies are present.\nCharts: bars + heatmap.': 'Leggi l’andamento e indica\nse sono presenti anomalie.\nGrafici: barre + mappa di calore.',
  'Test configured': 'Test configurato',
  'Configuration applied.\nClick the board to\nchange scenario.': 'Configurazione applicata.\nClicca sulla board per\ncambiare scenario.',
  'Change test': 'Cambia test',
  'Repeating a test overwrites the previous result.': 'Ripetere un test sovrascrive il risultato precedente.',
}

function localizeCommaSeparatedGraphs(text: string) {
  return text
    .split(', ')
    .map((part) => ITALIAN_TEXT[part] ?? part)
    .join(', ')
}

export function localizeText(text: string): string {
  if (currentLanguage === 'en' || !text) return text

  const exact = ITALIAN_TEXT[text]
  if (exact) return exact

  let match = text.match(/^You will complete this test using: (.+)\.$/)
  if (match) return `Completerai questo test utilizzando: ${localizeCommaSeparatedGraphs(match[1])}.`

  match = text.match(/^Look at the visualization shown in the scene: (.+)\.$/)
  if (match) return `Osserva la visualizzazione mostrata nella scena: ${localizeCommaSeparatedGraphs(match[1])}.`

  match = text.match(/^Observe the visualization shown in the scene: (.+)\.$/)
  if (match) return `Osserva la visualizzazione mostrata nella scena: ${localizeCommaSeparatedGraphs(match[1])}.`

  match = text.match(/^Observe the temporal visualization shown in the scene: (.+)\.$/)
  if (match) return `Osserva la visualizzazione temporale mostrata nella scena: ${localizeCommaSeparatedGraphs(match[1])}.`

  match = text.match(/^Inter-class Test (\d+) - final Likert scale$/)
  if (match) return `Test inter-classe ${match[1]} - scala Likert finale`

  match = text.match(/^Inter-class Test (\d+) - Variant ([AB]) - meeting simulation$/)
  if (match) return `Test inter-classe ${match[1]} - Variante ${match[2]} - simulazione della riunione`

  match = text.match(/^You will complete Variant ([AB]) using: (.+)\.$/)
  if (match) return `Completerai la Variante ${match[1]} utilizzando: ${localizeCommaSeparatedGraphs(match[2])}.`

  match = text.match(/^Current variant: Variant ([AB])\.$/)
  if (match) return `Variante attuale: Variante ${match[1]}.`

  match = text.match(/^Use the visualization combination selected for this variant: (.+)\.$/)
  if (match) return `Usa la combinazione di visualizzazioni selezionata per questa variante: ${localizeCommaSeparatedGraphs(match[1])}.`

  match = text.match(/^Variant ([AB]): (.+)\.$/)
  if (match) return `Variante ${match[1]}: ${localizeCommaSeparatedGraphs(match[2])}.`

  match = text.match(/^You will complete the final questionnaire using the 1-5 Likert scale in the GUI\. Variant A uses: (.+)\. Variant B uses: (.+)\.$/)
  if (match) {
    return `Completerai il questionario finale usando la scala Likert da 1 a 5 nella GUI. La Variante A usa: ${localizeCommaSeparatedGraphs(match[1])}. La Variante B usa: ${localizeCommaSeparatedGraphs(match[2])}.`
  }

  match = text.match(/^Inter-class Test (\d+) - Variant ([AB]) questionnaire$/)
  if (match) return `Test inter-classe ${match[1]} - questionario Variante ${match[2]}`

  match = text.match(/^Please answer these 3 questions for Variant ([AB]) before continuing\.$/)
  if (match) return `Rispondi a queste 3 domande sulla Variante ${match[1]} prima di continuare.`

  match = text.match(/^Inter-class Test (\d+) - final comparison$/)
  if (match) return `Test inter-classe ${match[1]} - confronto finale`

  match = text.match(/^(.+) vs (.+)$/)
  if (match) return `${localizeText(match[1])} vs ${localizeText(match[2])}`

  match = text.match(/^Completed tests fetch error: (.+)$/)
  if (match) return `Errore nel recupero dei test completati: ${match[1]}`

  if (text === 'Completed tests fetch failed.') return 'Recupero dei test completati non riuscito.'
  if (text === 'Address not available yet.') return 'Indirizzo non ancora disponibile.'

  return text
}

export function localizeTextList(values: string[]) {
  return values.map(localizeText)
}
