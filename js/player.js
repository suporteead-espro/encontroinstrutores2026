const ROOM_ID = document.body.dataset.room;
const store = new RoomStore(ROOM_ID);

let playerId = sessionStorage.getItem(`zoom_pid_${ROOM_ID}`);
if (!playerId) {
  playerId = `p_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(`zoom_pid_${ROOM_ID}`, playerId);
}

let shieldActive = false;
let lastCardNumber = null;
const byId = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  byId('roomBadge').textContent = ROOM_ID.toUpperCase();
  initPlayerControls();
  store.subscribe(renderPlayerView);
});

function initPlayerControls() {
  byId('joinForm').addEventListener('submit', joinRoom);

  byId('toggleShieldBtn').addEventListener('click', () => {
    shieldActive = !shieldActive;
    updateShieldUI();
  });

  const secretImage = byId('secretCardImg');
  secretImage.addEventListener('click', () => {
    if (!shieldActive && secretImage.src) openImageLightbox(secretImage.src, 'Sua imagem secreta');
  });
  secretImage.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !shieldActive) {
      event.preventDefault();
      if (secretImage.src) openImageLightbox(secretImage.src, 'Sua imagem secreta');
    }
  });

  byId('leaveRoomBtn').addEventListener('click', leaveRoom);
}

async function joinRoom(event) {
  event.preventDefault();
  const input = byId('playerNameInput');
  const submitButton = byId('joinSubmitBtn');
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Entrando...';
  try {
    await store.updateState((state) => {
      if (!state.players) state.players = {};

      let assignedCard = null;
      if (state.status === 'playing') {
        // Não considera uma eventual entrada anterior do mesmo navegador como carta ocupada.
        const usedCards = new Set(
          Object.values(state.players)
            .filter((player) => player.id !== playerId)
            .map((player) => player.cardNumber)
            .filter((number) => Number.isInteger(number))
        );
        const availableCards = [];
        for (let cardNumber = 1; cardNumber <= state.totalCards; cardNumber += 1) {
          if (!usedCards.has(cardNumber)) availableCards.push(cardNumber);
        }
        if (availableCards.length > 0) {
          assignedCard = availableCards[Math.floor(Math.random() * availableCards.length)];
        }
      }

      const previousPlayer = state.players[playerId];
      state.players[playerId] = {
        id: playerId,
        name,
        cardNumber: previousPlayer?.cardNumber ?? assignedCard,
        slotIndex: previousPlayer?.slotIndex ?? null
      };
      return state;
    });
  } catch (error) {
    console.error('Não foi possível entrar na sala:', error);
    showToast('Não foi possível entrar na sala. Verifique a conexão e tente novamente.');
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Entrar na sala <span aria-hidden="true">→</span>';
  }
}

async function leaveRoom() {
  try {
    await store.updateState((state) => {
      if (state.players && state.players[playerId]) delete state.players[playerId];
      return state;
    });
    shieldActive = false;
    lastCardNumber = null;
    updateShieldUI();
  } catch (error) {
    console.error('Não foi possível sair da sala:', error);
    showToast('Não foi possível sair da sala. Verifique a conexão.');
  }
}

function renderPlayerView(state) {
  const me = state.players ? state.players[playerId] : null;
  const joinScreen = byId('joinScreen');
  const gameScreen = byId('gameScreen');
  const headerRight = byId('playerHeaderRight');

  if (!me) {
    joinScreen.hidden = false;
    gameScreen.hidden = true;
    headerRight.hidden = true;
    return;
  }

  joinScreen.hidden = true;
  gameScreen.hidden = false;
  headerRight.hidden = false;
  byId('playerNameHeader').textContent = `● ${me.name || 'Participante'}`;

  renderPlayerStatus(state);
  renderSecretCard(me, state);
  renderPlayerBoard(state, me);
}

function renderPlayerStatus(state) {
  const banner = byId('boardStatusBanner');
  banner.replaceChildren();
  banner.className = 'status-banner';

  if (state.status === 'revealed') {
    const players = Object.values(state.players || {});
    const correctCount = players.filter((player) => hasSlot(player.slotIndex) && player.cardNumber === player.slotIndex + 1).length;
    banner.classList.add('revealed');
    const title = document.createElement('strong');
    title.textContent = '✓ Cartas reveladas pelo facilitador';
    const score = document.createElement('span');
    score.textContent = `Pontuação da equipe: ${correctCount} de ${state.totalCards}`;
    banner.append(title, score);
    banner.hidden = false;
  } else if (state.locked) {
    banner.classList.add('locked');
    banner.textContent = 'Tabuleiro travado pelo facilitador. As posições não podem ser alteradas neste momento.';
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function renderSecretCard(me, state) {
  const frame = byId('secretImageFrame');
  const image = byId('secretCardImg');
  const status = byId('secretCardStatus');
  const shieldButton = byId('toggleShieldBtn');

  if (me.cardNumber) {
    frame.hidden = false;
    shieldButton.hidden = false;
    if (lastCardNumber !== me.cardNumber) {
      lastCardNumber = me.cardNumber;
      image.src = DECK_CONFIG.getCardUrl(me.cardNumber);
      image.onerror = () => setFallbackImage(image, 'Sua carta');
    }

    status.textContent = hasSlot(me.slotIndex)
      ? `Sua imagem está na posição ${me.slotIndex + 1}. Converse com a equipe para validar a sequência.`
      : 'Descreva o que você observa sem mostrar a tela. Depois, escolha uma posição no tabuleiro.';
  } else {
    frame.hidden = true;
    shieldButton.hidden = true;
    lastCardNumber = null;
    status.textContent = state.status === 'waiting'
      ? 'Aguardando o facilitador iniciar a rodada e distribuir as imagens.'
      : state.status === 'revealed'
        ? 'A rodada foi encerrada. Acompanhe a sequência construída pela equipe.'
        : 'Todas as imagens disponíveis já foram distribuídas. Acompanhe a equipe.';
  }
  updateShieldUI();
}

function updateShieldUI() {
  const frame = byId('secretImageFrame');
  const button = byId('toggleShieldBtn');
  frame.classList.toggle('hidden-shield', shieldActive);
  button.textContent = shieldActive ? 'Mostrar minha imagem' : '🙈 Ocultar minha imagem';
  button.setAttribute('aria-pressed', String(shieldActive));
}

function renderPlayerBoard(state, me) {
  const grid = byId('playerTimelineGrid');
  grid.replaceChildren();
  const players = Object.values(state.players || {});
  const totalCards = Math.max(2, Math.min(30, Number(state.totalCards) || 10));
  const isRevealed = state.status === 'revealed';

  for (let index = 0; index < totalCards; index += 1) {
    const occupant = players.find((player) => player.slotIndex === index);
    const isMine = Boolean(occupant && occupant.id === playerId);
    const isCorrect = Boolean(isRevealed && occupant && occupant.cardNumber === index + 1);
    const isWrong = Boolean(isRevealed && occupant && occupant.cardNumber !== index + 1);

    const slot = document.createElement('article');
    slot.className = `slot-card${occupant ? ' occupied' : ''}${isMine ? ' is-mine' : ''}${isCorrect ? ' correct' : ''}${isWrong ? ' wrong' : ''}`;
    slot.appendChild(createSlotHeader(index, isRevealed && occupant ? (isCorrect ? '✓ Correta' : `Era #${occupant.cardNumber}`) : ''));

    const preview = document.createElement('div');
    preview.className = `slot-preview${occupant ? '' : ' empty-preview'}`;
    if (occupant) {
      if (isRevealed && occupant.cardNumber) {
        preview.appendChild(createZoomableImage(DECK_CONFIG.getCardUrl(occupant.cardNumber), `Carta ${occupant.cardNumber}`));
      } else {
        preview.appendChild(createCardBack(isMine ? 'SUA IMAGEM' : 'IMAGEM SECRETA', isMine ? 'Você está aqui' : 'Oculta até a revelação', isMine));
      }
    } else {
      const label = document.createElement('span');
      label.className = 'slot-empty-label';
      label.textContent = 'Posição livre';
      preview.appendChild(label);
    }
    slot.appendChild(preview);

    const playerName = document.createElement('div');
    playerName.className = 'slot-player-name';
    playerName.textContent = occupant ? `● ${occupant.name || 'Participante'}` : 'Aguardando participante';
    slot.appendChild(playerName);

    if (!isRevealed && !state.locked && me.cardNumber) {
      const actionWrapper = document.createElement('div');
      actionWrapper.className = 'slot-action';
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = `btn btn-block ${isMine || !occupant ? 'btn-primary' : 'btn-secondary'}`;
      actionButton.textContent = isMine ? 'Remover daqui' : occupant ? 'Trocar posição' : 'Colocar aqui';
      actionButton.addEventListener('click', () => claimSlot(isMine ? null : index, actionButton));
      actionWrapper.appendChild(actionButton);
      slot.appendChild(actionWrapper);
    }

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
    status.style.color = statusText.includes('Correta') ? 'var(--green)' : 'var(--red)';
    header.appendChild(status);
  }
  return header;
}

function createCardBack(title, subtitle, mine = false) {
  const back = document.createElement('div');
  back.className = `card-back${mine ? ' mine' : ''}`;
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

async function claimSlot(targetIndex, button) {
  if (button) button.disabled = true;
  try {
    await store.updateState((state) => {
      if (state.locked || state.status === 'revealed') return state;
      if (!state.players || !state.players[playerId]) return state;
      if (targetIndex !== null && (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= state.totalCards)) return state;

      const me = state.players[playerId];
      const previousSlot = me.slotIndex;
      if (targetIndex === null) {
        me.slotIndex = null;
        return state;
      }

      const otherPlayer = Object.values(state.players).find((player) => player.slotIndex === targetIndex && player.id !== playerId);
      if (otherPlayer) otherPlayer.slotIndex = hasSlot(previousSlot) ? previousSlot : null;
      me.slotIndex = targetIndex;
      return state;
    });
  } catch (error) {
    console.error('Não foi possível atualizar a posição:', error);
    showToast('Não foi possível atualizar sua posição. Verifique a conexão.');
  } finally {
    if (button) button.disabled = false;
  }
}

function hasSlot(slotIndex) {
  return slotIndex !== null && slotIndex !== undefined;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}
