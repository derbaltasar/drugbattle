(function(){
  // Verbindung: benutze window.SERVER_URL wenn gesetzt, sonst gleiche Origin
  const serverUrl = window.SERVER_URL || location.origin;
  const socket = io(serverUrl);

  // UI Elemente
  const joinScreen = document.getElementById('join-screen');
  const gameScreen = document.getElementById('game');
  const joinBtn = document.getElementById('joinBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const nameInput = document.getElementById('name');
  const roomInput = document.getElementById('room');
  const playerNameEl = document.getElementById('player-name');
  const playerCashEl = document.getElementById('player-cash');
  const marketBody = document.getElementById('market-body');
  const invList = document.getElementById('inv-list');
  const messages = document.getElementById('messages');

  const openSettingsBtn = document.getElementById('open-settings');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsBtn = document.getElementById('close-settings');
  const saveSettingsBtn = document.getElementById('save-settings');
  const settingStartMoney = document.getElementById('setting-startMoney');
  const settingTickMs = document.getElementById('setting-tickMs');
  const moneyTargetSlider = document.getElementById('setting-moneyTarget');
  const moneyTargetVal = document.getElementById('moneyTargetVal');
  const timeTargetSlider = document.getElementById('setting-timeTargetSec');
  const timeTargetVal = document.getElementById('timeTargetVal');
  const winMoneyRadio = document.getElementById('win-money');
  const winTimeRadio = document.getElementById('win-time');

  let myState = null;
  let marketState = null;
  let currentSettings = null;

  function fmt(n){
    if (typeof n === 'number') return n.toLocaleString('de-DE');
    return n;
  }

  function log(msg, cls='') {
    const el = document.createElement('div');
    el.textContent = msg;
    if (cls) el.className = cls;
    messages.prepend(el);
  }

  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Spieler';
    const room = roomInput.value.trim() || 'main';
    socket.emit('join', { name, room });
  });

  leaveBtn && leaveBtn.addEventListener('click', () => {
    location.reload();
  });

  openSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });
  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  moneyTargetSlider.addEventListener('input', () => {
    moneyTargetVal.textContent = fmt(Number(moneyTargetSlider.value));
  });
  timeTargetSlider.addEventListener('input', () => {
    timeTargetVal.textContent = fmt(Number(timeTargetSlider.value));
  });

  saveSettingsBtn.addEventListener('click', () => {
    const newSettings = {
      startMoney: Number(settingStartMoney.value) || 1000,
      tickMs: Number(settingTickMs.value) || 1000,
      winByMoney: winMoneyRadio.checked,
      moneyTarget: Number(moneyTargetSlider.value) || 100000,
      timeTargetSec: Number(timeTargetSlider.value) || 3600
    };
    socket.emit('updateSettings', newSettings);
    settingsModal.classList.add('hidden');
  });

  socket.on('joined', ({ id, yourState, public: pub, settings }) => {
    myState = yourState;
    marketState = pub;
    currentSettings = settings;
    joinScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    renderAll();
    log('Mit dem Server verbunden. Willkommen ' + myState.name);
    // Fill settings modal with current settings
    settingStartMoney.value = settings.startMoney || 1000;
    settingTickMs.value = settings.tickMs || 1000;
    moneyTargetSlider.value = settings.moneyTarget || 100000;
    moneyTargetVal.textContent = fmt(Number(moneyTargetSlider.value));
    timeTargetSlider.value = settings.timeTargetSec || 3600;
    timeTargetVal.textContent = fmt(Number(timeTargetSlider.value));
    if (settings.winByMoney) { winMoneyRadio.checked = true; } else { winTimeRadio.checked = true; }
  });

  socket.on('marketUpdate', (pub) => {
    marketState = pub;
    renderMarket();
    renderPlayersHeader();
  });

  socket.on('actionResult', (res) => {
    if (res.ok) {
      myState = res.yourState || myState;
      renderAll();
      log(res.message, 'small-muted');
    } else {
      log('Fehler: ' + res.message, 'small-muted');
    }
  });

  socket.on('state', ({ yourState, public: pub, settings }) => {
    myState = yourState;
    marketState = pub;
    currentSettings = settings;
    renderAll();
  });

  socket.on('settingsUpdated', (settings) => {
    currentSettings = settings;
    log('Einstellungen aktualisiert', 'small-muted');
  });

  socket.on('gameOver', (data) => {
    log('Spielende! Gewinner: ' + data.winner + ' (' + data.cash + '€) – Grund: ' + data.reason, 'small-muted');
    alert('Spielende! Gewinner: ' + data.winner + ' (' + data.cash + '€)');
  });

  function renderAll() {
    renderPlayersHeader();
    renderMarket();
    renderInventory();
  }

  function renderPlayersHeader() {
    if (!myState) return;
    playerNameEl.textContent = myState.name;
    playerCashEl.textContent = (myState.cash || 0).toFixed(2);
  }

  function renderMarket() {
    marketBody.innerHTML = '';
    if (!marketState) return;
    marketState.drugs.forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div><strong>${d.name}</strong></div>
          <div class="small-muted">${d.min}€ - ${d.max}€</div>
        </td>
        <td>${Number(d.price).toFixed(2)} €</td>
        <td>
          <input type="number" min="1" value="1" id="qty-${d.id}" style="width:70px" />
          <button class="small" data-buy="${d.id}">Kaufen</button>
          <button class="small" data-sell="${d.id}">Verkaufen</button>
        </td>
      `;
      marketBody.appendChild(tr);
    });

    // Buttons: Delegation
    marketBody.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const buyId = btn.getAttribute('data-buy');
        const sellId = btn.getAttribute('data-sell');
        const id = buyId || sellId;
        const qtyInput = document.getElementById('qty-' + id);
        const qty = Number(qtyInput.value || 0);
        if (buyId) {
          socket.emit('buy', { drugId: id, qty });
        } else {
          socket.emit('sell', { drugId: id, qty });
        }
      };
    });
  }

  function renderInventory() {
    invList.innerHTML = '';
    if (!myState) return;
    const inv = myState.inventory || {};
    for (const [id, qty] of Object.entries(inv)) {
      const li = document.createElement('li');
      li.className = 'inv-item';
      const drugName = marketState && marketState.drugs.find(d => d.id === id)?.name || id;
      li.innerHTML = `<span>${drugName}</span><span>${qty} Stück</span>`;
      invList.appendChild(li);
    }
  }

  // Wenn neu verbunden, Anfrage des Zustandes
  socket.on('connect', () => {
    socket.emit('requestState');
  });
})();
