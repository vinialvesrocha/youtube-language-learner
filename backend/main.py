from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List
import yt_dlp
import webvtt
import os
import google.generativeai as genai
import requests
import json
import re
import spacy

import os

# --- Configuração do App e dos Modelos ---
# Garante que o diretório de downloads exista ANTES de montar o StaticFiles
if not os.path.exists("downloads"):
    os.makedirs("downloads")

app = FastAPI()

app.mount("/downloads", StaticFiles(directory="downloads"), name="downloads")

# Carrega o modelo de linguagem do spaCy
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("Modelo 'en_core_web_sm' não encontrado. Baixando agora...")
    spacy.cli.download("en_core_web_sm")
    nlp = spacy.load("en_core_web_sm")

# Configura a API do Gemini a partir de variáveis de ambiente
try:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("AVISO: A variável de ambiente GEMINI_API_KEY não foi definida.")
        # Permitir que o app inicie mesmo sem a chave para outros endpoints funcionarem
        genai.configure(api_key="FAKE_KEY_FOR_INITIALIZATION")
    else:
        genai.configure(api_key=api_key)
except Exception as e:
    print(f"Erro ao configurar a API do Gemini: {e}")

# --- CORS Middleware ---
origins = ["http://localhost:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Constantes e Listas ---
ANKI_CONNECT_URL = "http://localhost:8765"
DECK_NAME = "ENGLISH-A2"
MODEL_NAME = "YTLearner-Advanced" # Modelo de nota personalizado

# Lista de verbos irregulares comuns (em sua forma base) para não serem lematizados
# Adicionar formas passadas e de particípio para garantir que não sejam alteradas
IRREGULAR_VERBS = {
    "be", "was", "were", "been", "is", "are", "am",
    "buy", "bought",
    "go", "went", "gone",
    "do", "did", "done",
    "have", "had",
    "make", "made",
    "say", "said",
    "see", "saw", "seen",
    "take", "took", "taken",
    "get", "got", "gotten",
    "think", "thought",
    "know", "knew", "known",
    "come", "came",
    "find", "found",
    "give", "gave", "given",
    "tell", "told"
}

# --- Modelos de Dados (Pydantic) ---
class VideoRequest(BaseModel):
    video_url: str

class FlashcardRequest(BaseModel):
    words: List[str]

class GeneratedFlashcard(BaseModel):
    english_sentence: str
    portuguese_translation: str
    term_translation: str

class DuplicateCheckRequest(BaseModel):
    words: List[str]
    flashcards: List[GeneratedFlashcard]

class CardProcessingRequest(BaseModel):
    words: List[str]
    flashcards: List[GeneratedFlashcard]

# --- Funções Helper ---
def get_base_term(term: str) -> str:
    """Lematiza o termo, a menos que seja um verbo irregular conhecido."""
    lower_term = term.lower()
    if lower_term in IRREGULAR_VERBS:
        return lower_term
    
    doc = nlp(lower_term)
    # Pega o lema do primeiro token (considerando que 'term' é uma palavra ou expressão curta)
    base_form = doc[0].lemma_
    return base_form

# --- Endpoints ---
@app.get("/")
def read_root():
    return {"message": "API do Aplicativo de Idiomas funcionando!"}

@app.post("/api/generate-flashcards")
def generate_flashcards(request: FlashcardRequest):
    if not os.environ.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY") == "FAKE_KEY_FOR_INITIALIZATION":
        raise HTTPException(status_code=400, detail="A chave da API do Gemini não foi configurada no servidor.")

    model = genai.GenerativeModel('gemini-1.5-flash')
    term = " ".join(request.words)

    prompt = f"""
    Crie 3 flashcards para o seguinte termo ou expressão em inglês: "{term}".

    Para cada flashcard, forneça:
    1. Uma frase de exemplo em inglês, usando o termo. A frase deve ser simples e clara.
    2. A tradução completa dessa frase para o português brasileiro.
    3. A tradução específica do termo "{term}" DENTRO do contexto da frase, em português.

    Formate a sua resposta EXATAMENTE como um JSON contendo uma lista de objetos.
    Cada objeto deve ter as chaves "english_sentence", "portuguese_translation" e "term_translation".
    Não inclua nenhuma formatação extra, como markdown (`json` ou ```).

    Exemplo de formato de resposta para o termo "fast":
    [
        {{
            "english_sentence": "He is running fast.",
            "portuguese_translation": "Ele está correndo rápido.",
            "term_translation": "rápido"
        }},
        {{
            "english_sentence": "The monk will fast for a day.",
            "portuguese_translation": "O monge vai jejuar por um dia.",
            "term_translation": "jejuar"
        }}
    ]
    """

    try:
        response = model.generate_content(prompt)
        cleaned_response_text = response.text.strip().replace("```json", "").replace("```", "").strip()
        
        raw_flashcards = json.loads(cleaned_response_text)
        
        processed_flashcards = []
        for card in raw_flashcards:
            # Adiciona o negrito na palavra/termo selecionado
            sentence = card.get("english_sentence", "")
            # Usa regex para substituir a palavra/termo de forma case-insensitive
            bolded_sentence = re.sub(f"(?i)({re.escape(term)})", r"<b>\1</b>", sentence, 1)
            card["english_sentence"] = bolded_sentence
            processed_flashcards.append(card)

        return {"flashcards": processed_flashcards}

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Erro ao decodificar a resposta da IA. A resposta não foi um JSON válido.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar flashcards: {e}")

@app.post("/api/check-duplicates")
def check_duplicates(request: CardProcessingRequest):
    results = []
    base_term = get_base_term(" ".join(request.words))

    # Para cada card proposto, verificamos as duas condições de duplicata
    # Usar a ação "multi" do AnkiConnect é mais eficiente para múltiplas chamadas
    multi_actions = []
    for card in request.flashcards:
        unique_id = f"{base_term}({card.term_translation})"
        
        # Ação 1: Checar pelo nosso UniqueID no novo formato
        action1 = {
            "action": "findNotes",
            "params": {"query": f'deck:"{DECK_NAME}" UniqueID:"{unique_id}"'}
        }
        # Ação 2: Checar pelo termo no campo Front de notas "Basic"
        action2 = {
            "action": "findNotes",
            "params": {"query": f'deck:"{DECK_NAME}" note:Basic Front:"{base_term}"'}
        }
        multi_actions.append(action1)
        multi_actions.append(action2)

    payload = {
        "action": "multi",
        "version": 6,
        "params": {"actions": multi_actions}
    }

    try:
        response = requests.post(ANKI_CONNECT_URL, json=payload)
        response.raise_for_status()
        multi_response = response.json()

        if multi_response.get("error"):
            # Se a chamada múltipla falhar, por segurança, não marcamos como duplicata
            # e retornamos a lista original sem status de duplicata.
            return {"duplication_status": [{"flashcard": c.dict(), "is_duplicate": False} for c in request.flashcards]}

        # Processa os resultados em pares
        all_results = multi_response.get("result", [])
        for i, card in enumerate(request.flashcards):
            # Cada card tem 2 resultados de busca associados
            result_new_format = all_results[i * 2]
            result_basic_format = all_results[i * 2 + 1]
            
            is_duplicate = bool(result_new_format) or bool(result_basic_format)
            results.append({"flashcard": card.dict(), "is_duplicate": is_duplicate})

    except requests.exceptions.RequestException:
        # Se o Anki não estiver acessível, não podemos checar. Assumimos que não são duplicatas.
        return {"duplication_status": [{"flashcard": c.dict(), "is_duplicate": False} for c in request.flashcards]}
        
    return {"duplication_status": results}

@app.post("/api/send-to-anki")
def send_to_anki(request: CardProcessingRequest):
    notes_to_add = []
    base_term = get_base_term(" ".join(request.words))

    for card in request.flashcards:
        unique_id = f"{base_term}({card.term_translation})"
        note = {
            "deckName": DECK_NAME,
            "modelName": MODEL_NAME,
            "fields": {
                "UniqueID": unique_id,
                "Term": base_term,
                "Meaning": card.term_translation,
                "ExampleSentence": card.english_sentence,
                "ExampleTranslation": card.portuguese_translation
            },
            "tags": ["youtube_learner"]
        }
        notes_to_add.append(note)

    if not notes_to_add:
        return {"message": "Nenhum card novo para adicionar."}

    # Log para depuração
    print(f"DEBUG: Enviando para o Anki: {json.dumps(notes_to_add, indent=2)}")

    payload = {"action": "addNotes", "version": 6, "params": {"notes": notes_to_add}}

    try:
        response = requests.post(ANKI_CONNECT_URL, json=payload)
        response.raise_for_status()
        anki_response = response.json()

        if anki_response.get("error"):
            raise HTTPException(status_code=400, detail=f"Erro do AnkiConnect: {anki_response['error']}")

        # Lógica de erro corrigida: um erro é `None`, um sucesso é um ID numérico.
        anki_result = anki_response.get("result", [])
        errors_found = [item for item in anki_result if item is None]

        if errors_found:
            success_count = len(notes_to_add) - len(errors_found)
            error_message = f"{len(errors_found)} de {len(notes_to_add)} cartões falharam."
            if success_count > 0:
                error_message += f" {success_count} foram adicionados com sucesso."
            raise HTTPException(status_code=400, detail=error_message)

        return {"message": f"{len(notes_to_add)} flashcards foram enviados para o Anki com sucesso!"}

    except requests.exceptions.RequestException:
        raise HTTPException(status_code=503, detail="Conexão com o Anki falhou. Verifique se o Anki está aberto e o add-on AnkiConnect está instalado.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ocorreu um erro inesperado: {str(e)}")

@app.post("/api/process-video")
def process_video(request: VideoRequest):
    output_template = "downloads/%(id)s"
    
    if not os.path.exists('downloads'):
        os.makedirs('downloads')

    YDL_OPTIONS = {
        'writeautomaticsub': True,
        'sublangs': ['en'],
        'outtmpl': output_template,
        'skip_download': True,
        'nocheckcertificate': True,
        'ignoreerrors': True,  # Ignora erros de download para vídeos sem formatos padrão
    }

    subtitle_file_path = None

    try:
        with yt_dlp.YoutubeDL(YDL_OPTIONS) as ydl:
            info_dict = ydl.extract_info(request.video_url, download=False)

            # Se info_dict for None, yt-dlp falhou silenciosamente (devido a ignoreerrors)
            if info_dict is None:
                raise ValueError("Não foi possível extrair informações do vídeo. O vídeo pode não ter legendas ou ser um formato incompatível.")

            video_id = info_dict.get("id")
            video_title = info_dict.get("title")
            if not video_id:
                raise ValueError("Não foi possível obter o ID do vídeo.")

            # yt-dlp com skip_download não baixa o sub, então pegamos a URL e baixamos manualmente
            auto_captions = info_dict.get('automatic_captions', {})
            sub_info = auto_captions.get('en')
            if not sub_info:
                # Se não houver legendas automáticas, tenta as legendas manuais
                subtitles = info_dict.get('subtitles', {})
                sub_info = subtitles.get('en')
                if not sub_info:
                    raise FileNotFoundError("Nenhuma legenda em inglês (automática ou manual) encontrada.")
            
            vtt_url = None
            for sub in sub_info:
                if sub['ext'] == 'vtt':
                    vtt_url = sub['url']
                    break
            
            if not vtt_url:
                raise FileNotFoundError("Formato VTT da legenda não encontrado.")

            subtitle_content = requests.get(vtt_url).text
            
            # Salva o arquivo para consistência, mas poderia ser processado em memória
            subtitle_file_path = f"downloads/{video_id}.en.vtt"
            with open(subtitle_file_path, 'w', encoding='utf-8') as f:
                f.write(subtitle_content)

            captions = []
            # Usa StringIO para ler o conteúdo da string diretamente, sem reabrir o arquivo
            for caption in webvtt.read(subtitle_file_path):
                captions.append({
                    'start': caption.start,
                    'end': caption.end,
                    'text': caption.text.strip()
                })

            return {
                "message": "Legendas processadas com sucesso!",
                "video_id": video_id,
                "video_title": video_title,
                "subtitles": captions,
            }

    except Exception as e:
        # Adiciona mais detalhes ao log de erro no servidor
        print(f"Erro detalhado em process_video: {type(e).__name__} - {e}")
        raise HTTPException(status_code=500, detail=f"Falha ao processar o vídeo: {e}")
