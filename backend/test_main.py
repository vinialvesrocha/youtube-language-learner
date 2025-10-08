import pytest
from main import get_base_term
import spacy

# Carrega o modelo de linguagem do spaCy uma vez para todos os testes
nlp = spacy.load("en_core_web_sm")

# Casos de teste parametrizados
# formato: (entrada, saida_esperada)
test_cases = [
    # Verbos regulares
    ("running", "run"),
    ("jumps", "jump"),
    ("jumped", "jump"),

    # Verbos irregulares (que antes falhavam)
    ("was", "be"),
    ("went", "go"),
    ("had", "have"),
    ("took", "take"),
    ("saw", "see"),

    # Verbos frasais (o bug principal)
    ("gets up", "get up"),
    ("got up", "get up"),
    ("woke up", "wake up"),
    ("wakes up", "wake up"),

    # Casos com maiúsculas
    ("Running", "run"),
    ("GOT UP", "get up"),

    # Casos com pontuação
    ("run.", "run ."), # spaCy trata pontuação como tokens separados
    ("gets up!", "get up !"),

    # Expressões mais longas
    ("He went to the store", "he go to the store"),
    ("She is running fast", "she be run fast"),
]

@pytest.mark.parametrize("input_term, expected_lemma", test_cases)
def test_get_base_term(input_term, expected_lemma):
    """Testa a função get_base_term com vários casos."""
    assert get_base_term(input_term) == expected_lemma

def test_get_base_term_bug_specific():
    """ Teste específico para o bug original para garantir que 'got up' se torna 'get up'. """
    # Com o código antigo, a saída seria "got up"
    # Com o código novo, a saída esperada é "get up"
    assert get_base_term("got up") == "get up"
    assert get_base_term("gets up") == "get up"
