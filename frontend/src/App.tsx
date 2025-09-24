import React, { useState, useEffect, useRef } from 'react';
import YouTube, { YouTubeProps } from 'react-youtube';
import { Navbar, Container, Form, Button, InputGroup, Spinner, Alert, Modal, Card, Badge } from 'react-bootstrap';
import './App.css';

// --- Interfaces e Funções Helper ---
interface Subtitle {
  start: string;
  end: string;
  text: string;
}

interface Flashcard {
  english_sentence: string;
  portuguese_translation: string;
  term_translation: string;
}

interface ConfirmationCard {
  flashcard: Flashcard;
  is_duplicate: boolean;
}

const getYouTubeId = (url: string): string | null => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

const timeToSeconds = (time: string): number => {
  if (!time) return 0;
  const parts = time.split(':');
  if (parts.length !== 3) return 0;
  const secondsParts = parts[2].split('.');
  if (secondsParts.length !== 2) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(secondsParts[0], 10);
  const milliseconds = parseInt(secondsParts[1], 10);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

// --- Componente Principal ---
function App() {
  // Estado da UI
  const [videoUrl, setVideoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Estado do Player e Legendas
  const [videoId, setVideoId] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState('');
  const [player, setPlayer] = useState<any | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Estado para seleção de palavras e flashcards
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [showFlashcardModal, setShowFlashcardModal] = useState(false);
  const [isFlashcardLoading, setIsFlashcardLoading] = useState(false);
  const [generatedFlashcards, setGeneratedFlashcards] = useState<Flashcard[]>([]);
  const [selectedFlashcards, setSelectedFlashcards] = useState<Flashcard[]>([]);
  const [flashcardError, setFlashcardError] = useState('');
  
  // Estado do fluxo do Anki
  type ModalStep = 'selection' | 'checking' | 'confirmation' | 'sending' | 'done';
  const [modalStep, setModalStep] = useState<ModalStep>('selection');
  const [isProcessingAnki, setIsProcessingAnki] = useState(false);
  const [ankiStatusMessage, setAnkiStatusMessage] = useState('');
  const [cardsForConfirmation, setCardsForConfirmation] = useState<ConfirmationCard[]>([]);


  // Efeito para buscar legenda atual
  useEffect(() => {
    if (!player || !subtitles.length) return;

    const updateSubtitle = () => {
      const currentTime = player.getCurrentTime();
      if (typeof currentTime !== 'number') return;

      const currentSub = subtitles.find(sub => {
        const startTime = timeToSeconds(sub.start);
        const endTime = timeToSeconds(sub.end);
        return currentTime >= startTime && currentTime <= endTime;
      });
      
      const newSubtitleText = currentSub ? currentSub.text : '';
      if (newSubtitleText !== currentSubtitle) {
        setCurrentSubtitle(newSubtitleText);
        setSelectedWords([]); // Limpa a seleção ao mudar a legenda
      }
    };

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(updateSubtitle, 250);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [player, subtitles, currentSubtitle]);

  const handleProcessVideo = async () => {
    const id = getYouTubeId(videoUrl);
    if (!id) {
      setError('URL do YouTube inválida.');
      setVideoId(null);
      return;
    }

    setIsLoading(true);
    setError('');
    setSubtitles([]);
    setCurrentSubtitle('');
    setSelectedWords([]);
    setVideoId(id);

    try {
      const response = await fetch('http://localhost:8000/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: videoUrl }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Erro no servidor.');
      }
      const data = await response.json();
      setSubtitles(data.subtitles);
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido.');
      setVideoId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    setPlayer(event.target);
  };

  const handleWordClick = (word: string) => {
    const cleanedWord = word.replace(/[.,!?"“]/g, '').trim();
    if (!cleanedWord) return;

    // Lógica para permitir apenas uma palavra ou expressão contígua
    const subtitleWords = currentSubtitle.split(/\s+/);
    const wordIndex = subtitleWords.findIndex(w => w.replace(/[.,!?"“]/g, '').trim() === cleanedWord)

    if (selectedWords.length > 0) {
        const lastWord = selectedWords[selectedWords.length - 1];
        const lastWordIndex = subtitleWords.findIndex(w => w.replace(/[.,!?"“]/g, '').trim() === lastWord);
        if (wordIndex === lastWordIndex + 1) {
            setSelectedWords(prev => [...prev, cleanedWord]);
        } else {
            setSelectedWords([cleanedWord]);
        }
    } else {
        setSelectedWords([cleanedWord]);
    }
  };

  const handleCreateFlashcards = async () => {
    setIsFlashcardLoading(true);
    setFlashcardError('');
    setGeneratedFlashcards([]);
    setSelectedFlashcards([]);
    setAnkiStatusMessage('');
    setModalStep('selection');
    setShowFlashcardModal(true);

    try {
      const response = await fetch('http://localhost:8000/api/generate-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: selectedWords }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Erro ao gerar flashcards.');
      }
      const data = await response.json();
      setGeneratedFlashcards(data.flashcards);
    } catch (err: any) {
      setFlashcardError(err.message || 'Não foi possível conectar ao servidor.');
    } finally {
      setIsFlashcardLoading(false);
    }
  };

  const handleFlashcardSelection = (card: Flashcard) => {
    setSelectedFlashcards(prev => {
      const isSelected = prev.some(
        selectedCard => selectedCard.english_sentence === card.english_sentence
      );
      if (isSelected) {
        return prev.filter(
          selectedCard => selectedCard.english_sentence !== card.english_sentence
        );
      } else {
        return [...prev, card];
      }
    });
  };

  const handleDuplicateCheck = async () => {
    setIsProcessingAnki(true);
    setAnkiStatusMessage('');
    setFlashcardError('');
    setModalStep('checking');

    try {
      const response = await fetch('http://localhost:8000/api/check-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: selectedWords, flashcards: selectedFlashcards }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Erro ao verificar duplicatas.');
      }
      const data = await response.json();
      setCardsForConfirmation(data.duplication_status);
      setModalStep('confirmation');
    } catch (err: any) {
      setFlashcardError(err.message || 'Falha na verificação de duplicatas.');
      setModalStep('selection'); // Volta para a seleção em caso de erro
    } finally {
      setIsProcessingAnki(false);
    }
  };

  const handleConfirmAndAdd = async () => {
    setIsProcessingAnki(true);
    setAnkiStatusMessage('');
    setModalStep('sending');

    const newCards = cardsForConfirmation
      .filter(c => !c.is_duplicate)
      .map(c => c.flashcard);

    if (newCards.length === 0) {
        setAnkiStatusMessage("Nenhum card novo para adicionar.");
        setModalStep('done');
        setIsProcessingAnki(false);
        return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/send-to-anki', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: selectedWords, flashcards: newCards }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Erro ao enviar para o Anki.');
      }
      const data = await response.json();
      setAnkiStatusMessage(data.message || 'Enviado com sucesso!');
    } catch (err: any) {
      setAnkiStatusMessage(err.message || 'Falha no envio para o Anki.');
    } finally {
      setModalStep('done');
      setIsProcessingAnki(false);
    }
  };

  const opts: YouTubeProps['opts'] = {
    playerVars: {
      autoplay: 0,
    },
  };

  const renderModalContent = () => {
    switch (modalStep) {
      case 'selection':
        return (
          <Form>
            {generatedFlashcards.map((card, index) => (
              <Card key={index} className="mb-3">
                <Card.Body className="d-flex align-items-center">
                  <Form.Check
                    type="checkbox"
                    id={`flashcard-check-${index}`}
                    className="me-3"
                    onChange={() => handleFlashcardSelection(card)}
                    checked={selectedFlashcards.some(sc => sc.english_sentence === card.english_sentence)}
                  />
                  <div>
                    <Card.Text dangerouslySetInnerHTML={{ __html: `<strong>Inglês:</strong> ${card.english_sentence}` }} />
                    <Card.Text className="text-muted"><strong>Português:</strong> {card.portuguese_translation}</Card.Text>
                    <small className="text-info">Tradução do Termo: {card.term_translation}</small>
                  </div>
                </Card.Body>
              </Card>
            ))}
          </Form>
        );
      case 'checking':
      case 'sending':
        return <div className="text-center"><Spinner /> <p>{modalStep === 'checking' ? 'Verificando duplicatas...' : 'Enviando para o Anki...'}</p></div>;
      case 'confirmation':
        const newCardCount = cardsForConfirmation.filter(c => !c.is_duplicate).length;
        return (
          <div>
            <Alert variant="info">
                {newCardCount > 0 ? `Serão adicionados ${newCardCount} novos cards.` : 'Nenhum card novo para adicionar.'} 
                Os cards marcados como "DUPLICATA" já existem no seu deck e serão ignorados.
            </Alert>
            {cardsForConfirmation.map((item, index) => (
              <Card key={index} className={`mb-3 ${item.is_duplicate ? 'duplicate-card' : ''}`}>
                <Card.Body>
                  {item.is_duplicate && <Badge bg="warning" className="mb-2">DUPLICATA</Badge>}
                  <Card.Text dangerouslySetInnerHTML={{ __html: `<strong>Inglês:</strong> ${item.flashcard.english_sentence}` }} />
                  <Card.Text className="text-muted"><strong>Português:</strong> {item.flashcard.portuguese_translation}</Card.Text>
                  <small className="text-info">Tradução do Termo: {item.flashcard.term_translation}</small>
                </Card.Body>
              </Card>
            ))}
          </div>
        );
      case 'done':
        return <Alert variant={flashcardError ? 'danger' : 'success'}>{ankiStatusMessage || flashcardError}</Alert>;
      default:
        return null;
    }
  }

  const renderModalFooter = () => {
    switch (modalStep) {
      case 'selection':
        return (
          <>
            <Button variant="secondary" onClick={() => setShowFlashcardModal(false)}>Fechar</Button>
            <Button variant="primary" onClick={handleDuplicateCheck} disabled={selectedFlashcards.length === 0 || isProcessingAnki}>
              Enviar para o Anki
            </Button>
          </>
        );
      case 'confirmation':
        const newCardCount = cardsForConfirmation.filter(c => !c.is_duplicate).length;
        return (
          <>
            <Button variant="secondary" onClick={() => setModalStep('selection')}>Voltar</Button>
            <Button variant="primary" onClick={handleConfirmAndAdd} disabled={newCardCount === 0 || isProcessingAnki}>
              Confirmar e Adicionar
            </Button>
          </>
        );
      case 'done':
        return <Button variant="secondary" onClick={() => setShowFlashcardModal(false)}>Fechar</Button>; 
      default:
        return <Button variant="secondary" onClick={() => setShowFlashcardModal(false)} disabled>Fechar</Button>;
    }
  }

  return (
    <>
      <Navbar bg="dark" variant="dark"><Container><Navbar.Brand>YouTube Language Learner</Navbar.Brand></Container></Navbar>
      <Container className="mt-4 pb-5"> {/* Padding bottom para não sobrepor o botão */}
        <div className="mb-4 p-4 border rounded">
          <InputGroup>
            <Form.Control
              placeholder="Cole a URL de um vídeo do YouTube..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={isLoading}
            />
            <Button variant="primary" onClick={handleProcessVideo} disabled={isLoading}>
              {isLoading ? <Spinner size="sm" /> : 'Processar'}
            </Button>
          </InputGroup>
          {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
        </div>

        {videoId && (
          <div className="player-wrapper">
            <YouTube videoId={videoId} opts={opts} onReady={onPlayerReady} className="react-player" />
          </div>
        )}

        <div className="subtitle-display-area">
          <p className="current-subtitle-text">
            {currentSubtitle ? (
              currentSubtitle.split(/(\s+)/).map((word, index) => {
                const cleanedWord = word.replace(/[.,!?"“]/g, '').trim();
                const isSelected = cleanedWord && selectedWords.includes(cleanedWord);
                return (
                  <span
                    key={index}
                    className={isSelected ? 'selected-word' : 'clickable-word'}
                    onClick={() => handleWordClick(word)}
                  >
                    {word}
                  </span>
                );
              })
            ) : (
              ' '
            )}
          </p>
        </div>

        {selectedWords.length > 0 && (
          <div className="flashcard-button-container">
            <Button variant="success" onClick={handleCreateFlashcards} disabled={isFlashcardLoading}>
              {isFlashcardLoading ? <Spinner size="sm" /> : `Criar Flashcard para: "${selectedWords.join(' ')}"`}
            </Button>
          </div>
        )}
      </Container>

      <Modal show={showFlashcardModal} onHide={() => setShowFlashcardModal(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Flashcards para "{selectedWords.join(' ')}"</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {isFlashcardLoading && <div className="text-center"><Spinner /> <p>Gerando exemplos...</p></div>}
          {flashcardError && <Alert variant="danger">{flashcardError}</Alert>}
          {!isFlashcardLoading && !flashcardError && renderModalContent()}
        </Modal.Body>
        <Modal.Footer>
          {renderModalFooter()}
        </Modal.Footer>
      </Modal>
    </>
  );
}

export default App;
