let currentRoomId = 'sala-1';
let store = null;
let currentState = null;
let spyMode = false;
let answerKeyReturnFocus = null;

const byId = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  initRoomTabs();
  initControls();
  initAnswerKeyModal();
  switchRoom('sala-1');
});

function initRoomTabs() {
  document.querySelectorAll('.room-tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.room-tab').forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-pressed', String(active));
      });
      switchRoom(button.dataset.room);
    });
  });
}

function switchRoom(roomId) {
  if (store) store.destroy();
  closeAnswerKey();
  currentRoomId = roomId;
  currentState = null;
  spyMode = false;
  updateSpyButton();
  store = new RoomStore(roomId);

  const playerUrl = new URL(`${roomId}.html`, window.location.href).href;
  byId('playerLinkCode').textContent = playerUrl;
  byId('openPlayerTabBtn').href = `${roomId}.html`;

  store.subscribe((state) => {
    if (state.roomId !== currentRoomId) return;
    currentState = state;
    renderHostView(state);
  });
}

function initControls() {
  byId('startGameBtn').addEventListener('click', startGame);

  byId('toggleSpyBtn').addEventListener('click', () => {
    spyMode = !spyMode;
    updateSpyButton();
    if (currentState) renderHostView(currentState);
  });

  byId('lockBoardBtn').addEventListener('click', async () => {
    if (!currentState || currentState.status !== 'playing') return;
    try {
      const updated = await store.updateState((state) => {
        state.locked = !state.locked;
        return state;
      });
      showToast(updated?.locked ? 'Tabuleiro travado para a equipe.' : 'Tabuleiro liberado para alterações.');
    } catch (error) {
      console.error('Não foi possível alterar o bloqueio do tabuleiro:', error);
      showToast('Não foi possível atualizar o tabuleiro. Verifique a conexão.');
    }
  });

  byId('revealBtn').addEventListener('click', revealCards);
  byId('showAnswerKeyBtn').addEventListener('click', openAnswerKey);

  byId('resetRoomBtn').addEventListener('click', async () => {
    const confirmed = window.confirm(`Deseja realmente resetar a ${currentRoomId.toUpperCase()}? Todos os participantes e posições desta sala serão removidos.`);
    if (!confirmed) return;
    try {
      await store.setState(store.getDefaultState());
      spyMode = false;
      updateSpyButton();
      closeAnswerKey();
      showToast('Sala resetada. Uma nova rodada pode ser preparada.');
    } catch (error) {
      console.error('Não foi possível resetar a sala:', error);
      showToast('Não foi possível resetar a sala. Verifique a conexão.');
    }
  });

  byId('copyLinkBtn').addEventListener('click', copyPlayerLink);
}

async function startGame() {
  const count = Number.parseInt(byId('cardCountInput').value, 10);
  if (!Number.isInteger(count) || count < 2 || count > DECK_CONFIG.maxCards) {
    showToast(`Escolha uma quantidade entre 2 e ${DECK_CONFIG.maxCards} cartas.`);
    byId('cardCountInput').focus();
    return;
  }

  const playerCount = Object.keys((currentState && currentState.players) || {}).length;
  if (playerCount === 0) {
    showToast('Aguarde pelo menos um participante entrar na sala antes de distribuir.');
    return;
  }

  if (currentState && currentState.status !== 'waiting') {
    const confirmed = window.confirm('Iniciar uma nova rodada vai sortear novamente as cartas e limpar as posições atuais. Deseja continuar?');
    if (!confirmed) return;
  }

  // Sorteia fora da transação: o Firebase pode executar o callback mais de uma vez.
  const shuffledCards = shuffleArray(Array.from({ length: count }, (_, index) => index + 1));
  try {
    await store.updateState((state) => {
      state.totalCards = count;
      state.status = 'playing';
      state.locked = false;

      const playerIds = Object.keys(state.players || {});
      playerIds.forEach((playerId, index) => {
        const player = state.players[playerId];
        player.cardNumber = index < shuffledCards.length ? shuffledCards[index] : null;
        player.slotIndex = null;
      });
      return state;
    });

    spyMode = false;
    updateSpyButton();
    closeAnswerKey();

    if (playerCount < count) {
      showToast(`Rodada iniciada com ${playerCount} participante(s). ${count - playerCount} carta(s) ficarão sem distribuição.`);
    } else if (playerCount > count) {
      showToast(`Rodada iniciada. ${playerCount - count} participante(s) ficarão sem carta.`);
    } else {
      showToast(`Rodada iniciada na ${currentRoomId.toUpperCase()}! As imagens foram distribuídas.`);
    }
  } catch (error) {
    console.error('Não foi possível iniciar a rodada:', error);
    showToast('Falha ao distribuir as cartas. Verifique a conexão e tente novamente.');
  }
}

async function revealCards() {
  if (!currentState || currentState.status !== 'playing') return;
  const players = Object.values(currentState.players || {});
  const placedCount = players.filter((player) => hasSlot(player.slotIndex)).length;
  const totalCards = Number(currentState.totalCards) || 0;

  if (placedCount < totalCards) {
    const confirmed = window.confirm(`A equipe preencheu ${placedCount} de ${totalCards} posições. Deseja revelar mesmo assim? Depois da revelação, você poderá abrir o quadro com a sequência correta completa.`);
    if (!confirmed) return;
  } else {
    const confirmed = window.confirm('Revelar as cartas para todos os participantes agora?');
    if (!confirmed) return;
  }

  try {
    await store.updateState((state) => {
      state.status = 'revealed';
      state.locked = true;
      return state;
    });
    spyMode = false;
    updateSpyButton();
    showToast('Cartas reveladas! Você já pode abrir a sequência correta completa.');
  } catch (error) {
    console.error('Não foi possível revelar as cartas:', error);
    showToast('Não foi possível revelar as cartas. Verifique a conexão.');
  }
}

function updateSpyButton() {
  const button = byId('toggleSpyBtn');
  button.textContent = spyMode ? 'Ocultar gabarito' : '◉ Ver gabarito';
  button.setAttribute('aria-pressed', String(spyMode));
  button.classList.toggle('is-active', spyMode);
}

async function copyPlayerLink() {
  const link = byId('playerLinkCode').textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(link);
    } else {
      const temp = document.createElement('textarea');
      temp.value = link;
      temp.setAttribute('readonly', '');
      temp.style.position = 'absolute';
      temp.style.left = '-9999px';
      document.body.appendChild(temp);
      temp.select();
      const copied = document.execCommand('copy');
      temp.remove();
      if (!copied) throw new Error('A cópia não foi autorizada pelo navegador.');
    }
    showToast('Link da sala copiado. Envie aos participantes.');
  } catch (error) {
    console.error('Falha ao copiar link:', error);
    showToast('Não foi possível copiar automaticamente. Selecione e copie o link exibido.');
  }
}

function renderHostView(state) {
  const players = Object.values(state.players || {});
  const totalCards = Math.max(2, Math.min(30, Number(state.totalCards) || 10));
  const placedCount = players.filter((player) => hasSlot(player.slotIndex)).length;
  const progress = Math.min(100, (placedCount / totalCards) * 100);
  const isRevealed = state.status === 'revealed';
  const isPlaying = state.status === 'playing';

  byId('roomTitleDisplay').textContent = `Controle da ${currentRoomId.toUpperCase()}`;
  byId('playersCountBadge').textContent = `${players.length} participante${players.length === 1 ? '' : 's'}`;
  byId('placementProgressText').textContent = `${placedCount} de ${totalCards} posições preenchidas`;
  byId('placementProgressBar').style.width = `${progress}%`;

  const statusBadge = byId('roomStatusBadge');
  statusBadge.className = `badge badge-status ${state.status || 'waiting'}`;
  const labels = {
    waiting: 'Aguardando início',
    playing: state.locked ? 'Tabuleiro travado' : 'Rodada em andamento',
    revealed: 'Cartas reveladas'
  };
  statusBadge.textContent = labels[state.status] || 'Status da sala';

  if (document.activeElement !== byId('cardCountInput')) {
    byId('cardCountInput').value = totalCards;
  }

  const lockButton = byId('lockBoardBtn');
  lockButton.disabled = !isPlaying;
  lockButton.textContent = state.locked ? 'Destravar tabuleiro' : 'Travar tabuleiro';
  lockButton.classList.toggle('is-active', Boolean(state.locked));

  byId('toggleSpyBtn').disabled = !isPlaying;
  byId('revealBtn').disabled = !isPlaying;
  byId('revealBtn').textContent = isRevealed ? 'Cartas reveladas' : 'Revelar cartas';
  byId('showAnswerKeyBtn').hidden = !isRevealed;
  byId('showAnswerKeyBtn').disabled = !isRevealed;

  renderRoster(players, state);
  renderHostBoard(players, totalCards, isRevealed);
  renderScore(players, totalCards, isRevealed);
}

function renderRoster(players, state) {
  const roster = byId('playersRoster');
  roster.replaceChildren();

  if (players.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-roster';
    empty.textContent = `Aguardando os participantes entrarem em ${currentRoomId}.html.`;
    roster.appendChild(empty);
    return;
  }

  players.forEach((player) => {
    const pill = document.createElement('span');
    pill.className = `player-pill${hasSlot(player.slotIndex) ? ' placed' : ''}`;

    const name = document.createElement('span');
    name.className = 'player-pill-name';
    name.textContent = `● ${player.name || 'Participante'}`;

    const card = document.createElement('small');
    const canSeeNumber = spyMode || state.status === 'revealed';
    card.textContent = player.cardNumber ? (canSeeNumber ? `Carta #${player.cardNumber}` : 'Carta secreta') : 'Sem carta';

    pill.append(name, card);
    if (hasSlot(player.slotIndex)) {
      const position = document.createElement('strong');
      position.textContent = `Pos. ${player.slotIndex + 1}`;
      pill.appendChild(position);
    }

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'kick-btn';
    removeButton.textContent = '×';
    removeButton.title = `Remover ${player.name || 'participante'} da sala`;
    removeButton.setAttribute('aria-label', `Remover ${player.name || 'participante'} da sala`);
    removeButton.addEventListener('click', () => removePlayer(player.id, player.name));
    pill.appendChild(removeButton);
    roster.appendChild(pill);
  });
}

async function removePlayer(playerId, playerName) {
  if (!playerId) return;
  if (!window.confirm(`Remover "${playerName || 'participante'}" desta sala?`)) return;
  try {
    await store.updateState((state) => {
      if (state.players && state.players[playerId]) delete state.players[playerId];
      return state;
    });
    showToast(`${playerName || 'Participante'} removido da sala.`);
  } catch (error) {
    console.error('Não foi possível remover participante:', error);
    showToast('Não foi possível remover o participante. Verifique a conexão.');
  }
}

function renderHostBoard(players, totalCards, isRevealed) {
  const grid = byId('hostTimelineGrid');
  grid.replaceChildren();

  for (let index = 0; index < totalCards; index += 1) {
    const occupant = players.find((player) => player.slotIndex === index);
    const isCorrect = Boolean(isRevealed && occupant && occupant.cardNumber === index + 1);
    const isWrong = Boolean(isRevealed && occupant && occupant.cardNumber !== index + 1);
    const slot = document.createElement('article');
    slot.className = `slot-card${occupant ? ' occupied' : ''}${isCorrect ? ' correct' : ''}${isWrong ? ' wrong' : ''}`;

    const header = createSlotHeader(index, isRevealed && occupant ? (isCorrect ? '✓ Correta' : `Era #${occupant.cardNumber}`) : (spyMode && occupant ? `Gabarito #${occupant.cardNumber}` : ''));
    const preview = document.createElement('div');
    preview.className = `slot-preview${occupant ? '' : ' empty-preview'}`;

    if (occupant && occupant.cardNumber) {
      if (isRevealed || spyMode) {
        preview.appendChild(createZoomableImage(DECK_CONFIG.getCardUrl(occupant.cardNumber), `Carta ${occupant.cardNumber} — ${occupant.name || 'Participante'}`));
      } else {
        preview.appendChild(createCardBack('CARTA POSICIONADA', 'Oculta até a revelação'));
      }
    } else {
      const emptyLabel = document.createElement('span');
      emptyLabel.className = 'slot-empty-label';
      emptyLabel.textContent = occupant ? 'Carta não distribuída' : 'Posição livre';
      preview.appendChild(emptyLabel);
    }

    const playerName = document.createElement('div');
    playerName.className = 'slot-player-name';
    playerName.textContent = occupant ? `● ${occupant.name || 'Participante'}` : 'Aguardando participante';
    slot.append(header, preview, playerName);
    grid.appendChild(slot);
  }
}

function createSlotHeader(index, statusText) {
  const header = document.createElement('div');
  header.className = 'slot-header';
  const label = document.createElement('span');
  label.className = 'slot-index-badge';
  label.textContent = `POSIÇÃO ${String(index + 1).padStart(2, '0')}`;
  header.appendChild(label);
  if (statusText) {
    const status = document.createElement('span');
    status.className = 'slot-hint-tag';
    status.textContent = statusText;
    if (statusText.includes('Correta')) status.style.color = 'var(--green)';
    else if (statusText.startsWith('Era')) status.style.color = 'var(--red)';
    else status.style.color = 'var(--orange-dark)';
    header.appendChild(status);
  }
  return header;
}

function createCardBack(title, subtitle) {
  const back = document.createElement('div');
  back.className = 'card-back';
  const heading = document.createElement('span');
  heading.textContent = title;
  const detail = document.createElement('small');
  detail.textContent = subtitle;
  back.append(heading, detail);
  return back;
}

function createZoomableImage(src, altText) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'image-zoom-button';
  button.setAttribute('aria-label', `Ampliar ${altText}`);
  const image = document.createElement('img');
  image.src = src;
  image.alt = altText;
  image.loading = 'lazy';
  image.onerror = () => setFallbackImage(image, altText);
  button.appendChild(image);
  button.addEventListener('click', () => openImageLightbox(image.src, altText));
  return button;
}

function setFallbackImage(image, label) {
  image.onerror = null;
  image.src = `https://placehold.co/500x500/17283e/ffffff?text=${encodeURIComponent(label || 'Imagem indisponivel')}`;
}

function renderScore(players, totalCards, isRevealed) {
  const target = byId('scoreSummaryBadge');
  target.replaceChildren();
  if (!isRevealed) return;

  const correctCount = players.filter((player) => hasSlot(player.slotIndex) && player.cardNumber === player.slotIndex + 1).length;
  const badge = document.createElement('span');
  badge.className = 'score-badge';
  badge.textContent = `✓ ${correctCount} de ${totalCards} posições corretas`;
  target.appendChild(badge);
}

function initAnswerKeyModal() {
  const modal = byId('answerKeyModal');
  byId('closeAnswerKeyBtn').addEventListener('click', closeAnswerKey);
  byId('closeAnswerKeyFooterBtn').addEventListener('click', closeAnswerKey);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeAnswerKey();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeAnswerKey();
  });
}

function openAnswerKey() {
  if (!currentState || currentState.status !== 'revealed') {
    showToast('A sequência correta fica disponível depois da revelação.');
    return;
  }

  const totalCards = Math.max(2, Math.min(30, Number(currentState.totalCards) || 10));
  renderAnswerKey(totalCards);

  const modal = byId('answerKeyModal');
  answerKeyReturnFocus = document.activeElement;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  byId('closeAnswerKeyBtn').focus();
}

function closeAnswerKey() {
  const modal = byId('answerKeyModal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  if (answerKeyReturnFocus && typeof answerKeyReturnFocus.focus === 'function') answerKeyReturnFocus.focus();
  answerKeyReturnFocus = null;
}

function renderAnswerKey(totalCards) {
  const grid = byId('answerKeyGrid');
  grid.replaceChildren();
  byId('answerKeyMeta').textContent = `${totalCards} imagens · Ordem de referência completa · Da posição 1 até a posição ${totalCards}`;

  // O gabarito é gerado a partir da numeração oficial do baralho, independentemente
  // de quantos participantes conseguiram ocupar as posições durante a rodada.
  for (let index = 1; index <= totalCards; index += 1) {
    const card = document.createElement('article');
    card.className = 'answer-key-card';

    const header = document.createElement('div');
    header.className = 'answer-key-card-header';
    const position = document.createElement('span');
    position.className = 'answer-key-position';
    position.textContent = `POSIÇÃO ${String(index).padStart(2, '0')}`;
    header.appendChild(position);

    if (index === 1 || index === totalCards) {
      const edge = document.createElement('span');
      edge.className = 'answer-key-edge';
      edge.textContent = index === 1 ? 'Mais detalhe' : 'Mais ampla';
      header.appendChild(edge);
    }

    const imageButton = document.createElement('button');
    imageButton.type = 'button';
    imageButton.className = 'answer-key-image';
    imageButton.setAttribute('aria-label', `Ampliar imagem da posição ${index}`);
    const image = document.createElement('img');
    image.src = DECK_CONFIG.getCardUrl(index);
    image.alt = `Imagem correta da posição ${index}`;
    image.loading = 'lazy';
    image.onerror = () => setFallbackImage(image, `Carta ${index}`);
    imageButton.appendChild(image);
    imageButton.addEventListener('click', () => openImageLightbox(image.src, `Posição ${index} — Carta ${index}`));

    const footer = document.createElement('div');
    footer.className = 'answer-key-card-footer';
    footer.textContent = `Carta #${index}`;
    card.append(header, imageButton, footer);
    grid.appendChild(card);
  }
}

function shuffleArray(array) {
  const result = [...array];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function hasSlot(slotIndex) {
  return slotIndex !== null && slotIndex !== undefined;
}
