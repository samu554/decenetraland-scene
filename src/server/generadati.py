import json
import random

def generate_gradual_data(num_points=100, start_value=5.0, min_val=0.0, max_val=10.0, step=0.3):
    """
    Genera una lista di dizionari con valori che cambiano gradualmente.
    Ogni valore cambia di un piccolo delta casuale compreso tra -step/2 e +step/2.
    """
    data = []
    value = start_value

    for i in range(1, num_points + 1):
        # variazione graduale
        delta = random.uniform(-step / 2, step / 2)
        value += delta

        # limiti tra 0 e 10
        value = max(min_val, min(max_val, value))

        # aggiungi al dataset
        data.append({
            "id": i,
            "value": round(value, 2)
        })

    return data


if __name__ == "__main__":
    # genera i dati
    dataset = generate_gradual_data(
        num_points=1000,
        start_value=5.0,  # valore iniziale
        min_val=0.0,
        max_val=10.0,
        step=0.4          # più alto = variazioni più ampie
    )

    # salva su file
    with open("data.json", "w") as f:
        json.dump(dataset, f, indent=2)

    print(f"✅ Creato file data.json con {len(dataset)} righe.")
