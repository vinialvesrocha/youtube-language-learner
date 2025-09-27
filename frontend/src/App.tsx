import React, { useState, useEffect, useRef } from 'react';
import ReactPlayer from 'react-player';
import { Navbar, Container, Form, Button, InputGroup, Spinner, Alert, Modal, Card, Badge, ListGroup } from 'react-bootstrap';
import './App.css';

// --- Interfaces e Funções Helper ---
interface Subtitle {
  start: string;
  end: string;
  text: string;
}

interface Flashcard {
  id: string;
  english_sentence: string;
  portuguese_translation: string;
  term_translation: string;
}

interface ConfirmationCard {
  flashcard: Flashcard;
  is_duplicate: boolean;
}

interface Video {
  videoUrl: string;
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string;
  subtitles: Subtitle[];
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
  const [customThemes, setCustomThemes] = useState('');
  const [videoHistory, setVideoHistory] = useState<Video[]>([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Estado do Player e Legendas
  const [videoId, setVideoId] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState('');
  const playerRef = useRef<any>(null);
  const [playing, setPlaying] = useState(false); // Re-added playing state
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const [editingCardIndex, setEditingCardIndex] = useState<number | null>(null);
  const [editingCardContent, setEditingCardContent] = useState<Flashcard | null>(null);
  const [isGeneratingMore, setIsGeneratingMore] = useState({ in_context: false, out_of_context: false });
  const [inContextCount, setInContextCount] = useState(2);

  // Efeito para carregar dados do localStorage na inicialização
  useEffect(() => {
    const savedThemes = localStorage.getItem('customThemes');
    if (savedThemes) {
      setCustomThemes(savedThemes);
    }
    const savedHistory = localStorage.getItem('videoHistory');
    if (savedHistory) {
      setVideoHistory(JSON.parse(savedHistory));
    }
    setIsInitialLoad(false);
  }, []);

  // Efeito para salvar temas no localStorage
  useEffect(() => {
    if (!isInitialLoad) {
      localStorage.setItem('customThemes', customThemes);
    }
  }, [customThemes, isInitialLoad]);

  // Efeito para salvar histórico no localStorage
  useEffect(() => {
    localStorage.setItem('videoHistory', JSON.stringify(videoHistory));
  }, [videoHistory, isInitialLoad]);

  // Efeito para tocar/pausar com a barra de espaço
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignora se estiver digitando em um input ou textarea
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return;
      }

      // Verifica se a tecla é a barra de espaço
      if (event.code === 'Space' && playerRef.current) {
        event.preventDefault(); // Previne o scroll da página
        setPlaying(prevPlaying => !prevPlaying);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Limpa o event listener ao desmontar o componente
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // A dependência do player foi removida pois a ref não muda

  // Efeito para buscar legenda atual
  useEffect(() => {
    if (!playerRef.current || !subtitles.length || !playing) { // Changed player to playerRef.current and added playing
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
    };

    const updateSubtitle = () => {
      if (!playerRef.current) return;
      const currentTime = playerRef.current.getCurrentTime();
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
  }, [playerRef.current, subtitles, currentSubtitle, playing]); // Changed dependencies

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
    setPlaying(true); // Auto-play
    console.log('handleProcessVideo - videoId:', id, 'videoUrl:', videoUrl, 'playing:', true); // Added console.log
    try {

      // Adiciona ao histórico
      const newVideo: Video = {
        videoUrl: videoUrl,
        videoId: data.video_id,
        videoTitle: data.video_title,
        thumbnailUrl: `https://img.youtube.com/vi/${data.video_id}/mqdefault.jpg`,
        subtitles: data.subtitles,
      };

      // Evita adicionar duplicatas
      if (!videoHistory.some(v => v.videoId === newVideo.videoId)) {
        setVideoHistory(prev => [newVideo, ...prev]);
      }
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido.');
      setVideoId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVttFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Get video ID from URL input
    const id = getYouTubeId(videoUrl);
    if (!id) {
      setError('Por favor, insira uma URL de vídeo válida antes de subir a legenda.');
      // Clear the file input so the user can try again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setIsLoading(true);
    setError('');
    setSubtitles([]);
    setCurrentSubtitle('');
    setSelectedWords([]);
    setVideoId(id); // Set the video ID to load the player

    const reader = new FileReader();
    reader.onload = async (e) => {
        const content = e.target?.result;
        if (typeof content !== 'string') {
            setError('Não foi possível ler o arquivo VTT.');
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('http://localhost:8000/api/process-vtt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vtt_content: content }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Erro ao processar o arquivo VTT.');
            }

            const data = await response.json();
            setSubtitles(data.subtitles);

            // Adiciona ao histórico
            const newVideo: Video = {
              videoUrl: videoUrl, // A URL que já estava no input
              videoId: id,      // O ID extraído da URL
              videoTitle: videoUrl, // Usa a URL como título, já que não temos o título real
              thumbnailUrl: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
              subtitles: data.subtitles,
            };

            // Evita adicionar duplicatas
            if (!videoHistory.some(v => v.videoId === newVideo.videoId)) {
              setVideoHistory(prev => [newVideo, ...prev]);
            }
        } catch (err: any) {
            setError(err.message || 'Erro desconhecido ao processar o arquivo.');
        } finally {
            setIsLoading(false);
        }
    };
    reader.onerror = () => {
        setError('Erro ao ler o arquivo.');
        setIsLoading(false);
    };
    reader.readAsText(file);
  };

  const handleLoadFromHistory = (video: Video) => {
    setError('');
    setVideoUrl(video.videoUrl);
    setVideoId(video.videoId);
    setSubtitles(video.subtitles);
    setCurrentSubtitle('');
    setSelectedWords([]);
    setPlaying(true); // Auto-play
    console.log('handleLoadFromHistory - videoId:', video.videoId, 'videoUrl:', video.videoUrl, 'playing:', true); // Added console.log
    // Rola a página para o player de vídeo
    setTimeout(() => {
      const playerElement = document.querySelector('.player-wrapper');
      playerElement?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
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
    setInContextCount(2); // Reseta a contagem

    const currentIndex = subtitles.findIndex(sub => sub.text === currentSubtitle);
    const previousSubtitle = currentIndex > 0 ? subtitles[currentIndex - 1].text : '';
    const nextSubtitle = currentIndex < subtitles.length - 1 ? subtitles[currentIndex + 1].text : '';

    const themesArray = customThemes.split(',').map(t => t.trim()).filter(t => t);

    try {
      const response = await fetch('http://localhost:8000/api/generate-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words: selectedWords,
          previous_subtitle: previousSubtitle,
          current_subtitle: currentSubtitle,
          next_subtitle: nextSubtitle,
          custom_themes: themesArray.length > 0 ? themesArray : undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Erro ao gerar flashcards.');
      }
      const data = await response.json();
      const flashcardsWithId = data.flashcards.map((card: Omit<Flashcard, 'id'>, index: number) => ({
        ...card,
        id: `temp-id-${index}-${Date.now()}`
      }));
      setGeneratedFlashcards(flashcardsWithId);
    } catch (err: any) {
      setFlashcardError(err.message || 'Não foi possível conectar ao servidor.');
    } finally {
      setIsFlashcardLoading(false);
    }
  };

  const handleFlashcardSelection = (card: Flashcard) => {
    setSelectedFlashcards(prev => {
      const isSelected = prev.some(selectedCard => selectedCard.id === card.id);
      if (isSelected) {
        return prev.filter(selectedCard => selectedCard.id !== card.id);
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

  const handleEditCard = (index: number) => {
    setEditingCardIndex(index);
    setEditingCardContent(generatedFlashcards[index]);
  };

  const handleCancelEdit = () => {
    setEditingCardIndex(null);
    setEditingCardContent(null);
  };

  const handleSaveCard = () => {
    if (editingCardIndex === null || !editingCardContent) return;

    const updatedFlashcards = [...generatedFlashcards];
    updatedFlashcards[editingCardIndex] = editingCardContent;
    setGeneratedFlashcards(updatedFlashcards);

    // Atualiza também o card selecionado, se for o caso
    const isSelected = selectedFlashcards.some(card => card.id === editingCardContent.id);
    if (isSelected) {
        const updatedSelected = selectedFlashcards.map(card => 
            card.id === editingCardContent.id ? editingCardContent : card
        );
        setSelectedFlashcards(updatedSelected);
    }

    handleCancelEdit();
  };

  const handleEditingCardChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingCardContent) return;
    const { name, value } = e.target;
    setEditingCardContent({ ...editingCardContent, [name]: value });
  };

  const handleGenerateMore = async (contextType: 'in_context' | 'out_of_context') => {
    setIsGeneratingMore(prev => ({ ...prev, [contextType]: true }));
    setFlashcardError('');

    const currentIndex = subtitles.findIndex(sub => sub.text === currentSubtitle);
    const previousSubtitle = currentIndex > 0 ? subtitles[currentIndex - 1].text : '';
    const nextSubtitle = currentIndex < subtitles.length - 1 ? subtitles[currentIndex + 1].text : '';

    const themesArray = customThemes.split(',').map(t => t.trim()).filter(t => t);

    try {
      const response = await fetch('http://localhost:8000/api/generate-more-flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words: selectedWords,
          previous_subtitle: previousSubtitle,
          current_subtitle: currentSubtitle,
          next_subtitle: nextSubtitle,
          existing_flashcards: generatedFlashcards,
          context_type: contextType,
          custom_themes: themesArray.length > 0 ? themesArray : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Erro ao gerar mais flashcards.');
      }

      const data = await response.json();
      const newFlashcards = data.flashcards.map((card: Omit<Flashcard, 'id'>, index: number) => ({
        ...card,
        id: `temp-id-more-${contextType}-${index}-${Date.now()}`
      }));

      if (contextType === 'in_context') {
        const newGenerated = [...generatedFlashcards];
        newGenerated.splice(inContextCount, 0, ...newFlashcards);
        setGeneratedFlashcards(newGenerated);
        setInContextCount(prev => prev + newFlashcards.length);
      } else {
        setGeneratedFlashcards(prev => [...prev, ...newFlashcards]);
      }

    } catch (err: any) {
      setFlashcardError(err.message || 'Não foi possível conectar ao servidor.');
    } finally {
      setIsGeneratingMore(prev => ({ ...prev, [contextType]: false }));
    }
  };

  const opts: YouTubeProps['opts'] = {
    playerVars: {
      autoplay: 0,
      rel: 0, // Não mostrar vídeos relacionados ao pausar
    },
  };

  const renderModalContent = () => {
    switch (modalStep) {
      case 'selection':
        const inContextCards = generatedFlashcards.slice(0, inContextCount);
        const outOfContextCards = generatedFlashcards.slice(inContextCount);

        return (
          <Form>
            <h5>Contexto do Vídeo</h5>
            {inContextCards.map((card, index) => (
              <Card key={card.id} className="mb-3">
                <Card.Body>
                  {editingCardIndex === index && editingCardContent ? (
                    <>
                      <Form.Group className="mb-2"><Form.Label><small>Frase em Inglês</small></Form.Label><Form.Control as="textarea" rows={2} name="english_sentence" value={editingCardContent.english_sentence} onChange={handleEditingCardChange} /></Form.Group>
                      <Form.Group className="mb-2"><Form.Label><small>Tradução da Frase</small></Form.Label><Form.Control as="textarea" rows={2} name="portuguese_translation" value={editingCardContent.portuguese_translation} onChange={handleEditingCardChange} /></Form.Group>
                      <Form.Group className="mb-3"><Form.Label><small>Tradução do Termo</small></Form.Label><Form.Control type="text" name="term_translation" value={editingCardContent.term_translation} onChange={handleEditingCardChange} /></Form.Group>
                      <div className="d-flex justify-content-end"><Button variant="secondary" size="sm" onClick={handleCancelEdit} className="me-2">Cancelar</Button><Button variant="primary" size="sm" onClick={handleSaveCard}>Salvar</Button></div>
                    </>
                  ) : (
                    <div className="d-flex justify-content-between align-items-start">
                      <div className="flex-grow-1"><Badge bg="primary" className="mb-2">Contexto do Vídeo</Badge><Card.Text dangerouslySetInnerHTML={{ __html: `<strong>Inglês:</strong> ${card.english_sentence}` }} /><Card.Text className="text-muted" dangerouslySetInnerHTML={{ __html: `<strong>Português:</strong> ${card.portuguese_translation}` }} /><small className="text-info">Tradução do Termo: {card.term_translation}</small></div>
                      <div className="d-flex flex-column align-items-end ms-3"><Form.Check type="checkbox" id={`flashcard-check-${index}`} className="flex-shrink-0 mb-2" onChange={() => handleFlashcardSelection(card)} checked={selectedFlashcards.some(sc => sc.id === card.id)} disabled={editingCardIndex !== null} /><Button variant="outline-secondary" size="sm" onClick={() => handleEditCard(index)} disabled={editingCardIndex !== null}>Editar</Button></div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            ))}
            <div className="d-grid mb-4">
                <Button variant="light" onClick={() => handleGenerateMore('in_context')} disabled={isGeneratingMore.in_context || editingCardIndex !== null}>
                    {isGeneratingMore.in_context ? <Spinner size="sm" /> : 'Gerar mais 2 exemplos contextuais'}
                </Button>
            </div>

            <h5>Outros Contextos</h5>
            {outOfContextCards.map((card, index) => (
                <Card key={card.id} className="mb-3">
                    <Card.Body>
                        {editingCardIndex === (index + inContextCount) && editingCardContent ? (
                            <>
                                <Form.Group className="mb-2"><Form.Label><small>Frase em Inglês</small></Form.Label><Form.Control as="textarea" rows={2} name="english_sentence" value={editingCardContent.english_sentence} onChange={handleEditingCardChange} /></Form.Group>
                                <Form.Group className="mb-2"><Form.Label><small>Tradução da Frase</small></Form.Label><Form.Control as="textarea" rows={2} name="portuguese_translation" value={editingCardContent.portuguese_translation} onChange={handleEditingCardChange} /></Form.Group>
                                <Form.Group className="mb-3"><Form.Label><small>Tradução do Termo</small></Form.Label><Form.Control type="text" name="term_translation" value={editingCardContent.term_translation} onChange={handleEditingCardChange} /></Form.Group>
                                <div className="d-flex justify-content-end"><Button variant="secondary" size="sm" onClick={handleCancelEdit} className="me-2">Cancelar</Button><Button variant="primary" size="sm" onClick={handleSaveCard}>Salvar</Button></div>
                            </>
                        ) : (
                            <div className="d-flex justify-content-between align-items-start">
                                <div className="flex-grow-1"><Badge bg="secondary" className="mb-2">Outros Contextos</Badge><Card.Text dangerouslySetInnerHTML={{ __html: `<strong>Inglês:</strong> ${card.english_sentence}` }} /><Card.Text className="text-muted" dangerouslySetInnerHTML={{ __html: `<strong>Português:</strong> ${card.portuguese_translation}` }} /><small className="text-info">Tradução do Termo: {card.term_translation}</small></div>
                                <div className="d-flex flex-column align-items-end ms-3"><Form.Check type="checkbox" id={`flashcard-check-${index + inContextCount}`} className="flex-shrink-0 mb-2" onChange={() => handleFlashcardSelection(card)} checked={selectedFlashcards.some(sc => sc.id === card.id)} disabled={editingCardIndex !== null} /><Button variant="outline-secondary" size="sm" onClick={() => handleEditCard(index + inContextCount)} disabled={editingCardIndex !== null}>Editar</Button></div>
                            </div>
                        )}
                    </Card.Body>
                </Card>
            ))}
            <div className="d-grid">
                <Button variant="light" onClick={() => handleGenerateMore('out_of_context')} disabled={isGeneratingMore.out_of_context || editingCardIndex !== null}>
                    {isGeneratingMore.out_of_context ? <Spinner size="sm" /> : 'Gerar mais 2 exemplos diversos'}
                </Button>
            </div>
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
                  <Card.Text className="text-muted" dangerouslySetInnerHTML={{ __html: `<strong>Português:</strong> ${item.flashcard.portuguese_translation}` }} />
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
          <Form.Group className="mb-3">
            <Form.Label>Temas de Interesse (opcional)</Form.Label>
            <Form.Control
              type="text"
              placeholder="Ex: tecnologia, história, culinária..."
              value={customThemes}
              onChange={(e) => setCustomThemes(e.target.value)}
              disabled={isLoading}
            />
            <Form.Text className="text-muted">
              Separe os temas com vírgulas para gerar exemplos de seu interesse.
            </Form.Text>
          </Form.Group>
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
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
              Subir VTT
            </Button>
          </InputGroup>
          <Form.Control
            type="file"
            accept=".vtt"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleVttFileSelect}
          />
          {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
        </div>

        {videoHistory.length > 0 && (
          <div className="mb-4 p-4 border rounded">
            <h5 className="mb-3">Histórico</h5>
            <ListGroup variant="flush">
              {videoHistory.map(video => (
                <ListGroup.Item key={video.videoId} className="d-flex justify-content-between align-items-center">
                  <img src={video.thumbnailUrl} alt={`Thumbnail for ${video.videoTitle}`} className="me-3 img-thumbnail" style={{ width: '120px' }} />
                  <div className="flex-grow-1">
                    {video.videoTitle}
                  </div>
                  <Button variant="outline-secondary" size="sm" onClick={() => handleLoadFromHistory(video)}>
                    Carregar
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>
        )}

        {videoId && (
          <div className="player-wrapper">
            <ReactPlayer
              ref={playerRef}
              // @ts-ignore
              url={videoUrl}
              playing={playing}
              controls
              width="100%"
              height="100%"
              className="react-player"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onProgress={(state: any) => { // Explicitly type state as any
                const { playedSeconds } = state;
                const currentSub = subtitles.find(sub => {
                  const startTime = timeToSeconds(sub.start);
                  const endTime = timeToSeconds(sub.end);
                  return playedSeconds >= startTime && playedSeconds <= endTime;
                });
                const newSubtitleText = currentSub ? currentSub.text : '';
                if (newSubtitleText !== currentSubtitle) {
                  setCurrentSubtitle(newSubtitleText);
                  setSelectedWords([]); // Clear selection when subtitle changes
                }
              }}
              onError={(e) => console.error('ReactPlayer Error:', e)} // Added onError
              // @ts-ignore
              config={{
                youtube: {
                  playsinline: 1,
                  modestbranding: 1,
                  // Add other playerVars if needed
                }
              }}
            />
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