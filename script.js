// configuration : 5 columns × 5 rows visible
const COLS = 5;
const ROWS = 5;
const REEL_SIZE = 60; // length of each reel sequence

// --- RTP controller ---------------------------------
const DESIRED_RTP = 0.96;
const SPIN_COST = 10; // kept for compatibility but spin cost used dynamically from betAmount below
let totalBets = 0;
let totalPayout = 0;
// ----------------------------------------------------

// adjustable bet per spin (UI controls update this)
let betAmount = SPIN_COST; // betAmount = cost of a spin
const MIN_BET = 0.1;
const MAX_BET = 100;
const BET_STEP = 0.1;

// Maximum win cap
const MAX_WIN_PER_BONUS = 5000; // 5000× the bet amount per bonus round

// --- Symbols: rebalanced weights and values (lower payouts, rarer big wins) ---
const symbols = [
  // name, image, value (relative payout unit), weight (occurrence frequency)
  { name: "Tralalero Tralal", image: "images/tralalero.png", value: 0.8, weight: 3 },   // reduced from 1.2
  { name: "Bombardiro Crocodilo", image: "images/bombardiro.png", value: 0.5, weight: 6 }, // reduced from 0.8
  { name: "Tung Tung Tung Sahur", image: "images/tungtung.png", value: 0.35, weight: 8 }, // reduced from 0.6
  { name: "Lirilì Larilà", image: "images/lirili.png", value: 0.25, weight: 12 },        // reduced from 0.4
  { name: "Brr Brr Patapim", image: "images/patapim.png", value: 0.18, weight: 18 },     // reduced from 0.25
  { name: "Chimpanzini Bananini", image: "images/chimpanzini.png", value: 0.12, weight: 22 }, // reduced from 0.18
  { name: "Capuccino Assassino", image: "images/capuccino.png", value: 0.08, weight: 25 },    // reduced from 0.12
  // bonus star: reduced from weight 6 to 3 for ~1 in 200 trigger rate
  { name: "Bonus Star", image: "images/bonus.png", value: 0, weight: 3 }
];

let spinButton = document.getElementById("spinButton");
// ensure result div exists and is placed right after the table so win text is visible
let resultDiv = document.getElementById("result");
if (!resultDiv) {
  resultDiv = document.createElement("div");
  resultDiv.id = "result";
  // lightweight visual defaults
  resultDiv.style.textAlign = "center";
  resultDiv.style.minHeight = "28px";
  resultDiv.style.fontWeight = "700";
  resultDiv.style.marginTop = "8px";
  // place right after the table if possible
  if (table && table.parentNode) table.parentNode.insertBefore(resultDiv, table.nextSibling);
  else document.body.appendChild(resultDiv);
}
let balance = 500; // starting money

// BONUS state
let bonusActive = false;
let freeSpins = 0;
let bonusConnections = 0; // increments each time you get a winning "connection" in free spins
const BONUS_FREE_SPINS = 10;
// const BONUS_BUY_COST = 500;  // no longer use fixed constant
// limits / modifiers
const MAX_BONUS_STAR_IN_GRID = 3;
const BONUS_RARITY_MULTIPLIER = 20; // make retriggering much harder: 2000% more rare -> factor 20

// new: guarantee next spin will produce a bonus (and optionally be free)
let guaranteeBonusNextSpin = false;
let guaranteeBonusSpinIsFree = false;

// find or create table
let table = document.getElementById("myTable");
if (!table) {
  table = document.createElement("table");
  table.id = "myTable";
  document.body.appendChild(table);
}

// attach spin handler
if (spinButton) {
  spinButton.addEventListener("click", () => {
    spin().catch(() => {});
  });
}

// build grid and keep references to each cell per column
const columns = Array.from({ length: COLS }, () => []);
function buildGrid() {
  table.innerHTML = "";
  for (let r = 0; r < ROWS; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < COLS; c++) {
      const td = document.createElement("td");
      td.innerHTML = '<div class="cell-content" data-col="' + c + '" data-row="' + r + '"></div>';
      tr.appendChild(td);
      columns[c][r] = td.querySelector(".cell-content");
    }
    table.appendChild(tr);
  }
}
buildGrid();

/* balance display */
function createBalanceDiv() {
  let bd = document.getElementById("balance");
  if (!bd) {
    bd = document.createElement("div");
    bd.id = "balance";
    bd.style.margin = "8px 0";
    bd.style.fontSize = "37.5px";
    bd.style.fontWeight = "600";
    bd.style.color = "#FFD700";
    // insert above the table for visibility (can be repositioned by other code)
    table.parentNode ? table.parentNode.insertBefore(bd, table) : document.body.insertBefore(bd, table);
  }
  return bd;
}
const balanceDiv = createBalanceDiv();
// format numbers using comma as decimal separator, keep two decimals but trim trailing ",00"
function formatNumber(n) {
  if (typeof n !== 'number' || !isFinite(n)) return String(n);
  const s = n.toFixed(2);
  // trim trailing ,00 or ,x0 if desired (keep two decimals by default)
  return s.replace('.', ',').replace(/,00$/, ',00'); // keep two decimals but use comma
}
function updateBalanceDisplay() {
  if (!balanceDiv) return;
  balanceDiv.textContent = `Balance: ${formatNumber(balance)}`;
}
updateBalanceDisplay();

// Bet controls UI
let betDiv = null;
function createBetControls() {
  if (betDiv) return betDiv;
  betDiv = document.createElement('div');
  betDiv.id = 'betControls';
  betDiv.style.display = 'flex';
  betDiv.style.alignItems = 'center';
  betDiv.style.gap = '8px';
  betDiv.style.margin = '8px 0';

  // predefined selectable bet options (scroll roll)
  const BET_OPTIONS = [0.1, 0.2, 0.4, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 10, 15, 20, 25, 30, 40, 50, 75, 100];

  const label = document.createElement('label');
  label.htmlFor = 'betSelect';
  label.textContent = 'Bet:';
  label.style.fontSize = '18px';
  label.style.fontWeight = '700';
  label.style.color = '#fff';

  const select = document.createElement('select');
  select.id = 'betSelect';
  select.style.padding = '6px 8px';
  select.style.fontSize = '16px';
  select.style.borderRadius = '6px';
  select.style.background = '#222';
  select.style.color = '#fff';
  select.style.border = '1px solid #444';
  select.style.cursor = 'pointer';
  // fixed width so the control doesn't change layout when opened
  select.style.width = '120px';
  select.size = 1; // keep collapsed; rely on native dropdown overlay

  // populate options
  BET_OPTIONS.forEach(v => {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = formatNumber(v);
    select.appendChild(opt);
  });

  // choose initial selection closest to current betAmount
  let initialIndex = BET_OPTIONS.indexOf(betAmount);
  if (initialIndex === -1) {
    initialIndex = 0;
    for (let i = 0; i < BET_OPTIONS.length; i++) {
      if (BET_OPTIONS[i] >= betAmount) { initialIndex = i; break; }
    }
  }
  select.selectedIndex = initialIndex;
  betAmount = BET_OPTIONS[select.selectedIndex];

  const txt = document.createElement('div');
  txt.id = 'betAmountText';
  txt.style.fontSize = '20px';
  txt.style.fontWeight = '700';
  txt.style.color = '#ffffff';
  // show only the numeric amount (no "Bet:" prefix)
  txt.textContent = formatNumber(betAmount);

  // Use native dropdown overlay: update bet on change and collapse focus
  select.addEventListener('change', () => {
    const val = parseFloat(select.value);
    if (!isNaN(val)) {
      betAmount = val;
      txt.textContent = formatNumber(betAmount);
      updateBetDisplay(); // keep other UI updated
    }
    // remove focus so native overlay closes reliably
    select.blur();
  });

  // remove previous manual size toggling / outside listeners — rely on native behavior

  betDiv.appendChild(label);
  betDiv.appendChild(select);
  betDiv.appendChild(txt);

  // insert bet controls under the balance (same as before)
  balanceDiv.parentNode ? balanceDiv.parentNode.insertBefore(betDiv, balanceDiv.nextSibling) : document.body.appendChild(betDiv);
  return betDiv;
}

function updateBetDisplay() {
  const el = document.getElementById('betAmountText');
  if (el) el.textContent = formatNumber(betAmount); // show only the numeric amount
  const costEl = document.getElementById('spinCostText');
  if (costEl) costEl.textContent = `Cost: ${formatNumber(betAmount)}`;
  // update buy-bonus button text if present (cost = 100 × betAmount)
  const buyBtn = document.getElementById('buyBonusButton');
  if (buyBtn) buyBtn.textContent = `Bonus Buy (${formatNumber(betAmount * 100)})`;
}
createBetControls();
updateBetDisplay();

// NEW: Auto-spin functionality
let autoSpinCount = 0;
let autoSpinActive = false;
let autoSpinDiv = null;

function createAutoSpinControls() {
  if (autoSpinDiv) return autoSpinDiv;

  autoSpinDiv = document.createElement('div');
  autoSpinDiv.id = 'autoSpinControls';
  autoSpinDiv.style.display = 'flex';
  autoSpinDiv.style.alignItems = 'center';
  autoSpinDiv.style.gap = '8px';
  autoSpinDiv.style.margin = '8px 0';

  const label = document.createElement('label');
  label.htmlFor = 'autoSpinSelect';
  label.textContent = 'Auto Spin:';
  label.style.fontSize = '18px';
  label.style.fontWeight = '700';
  label.style.color = '#fff';

  // Select dropdown with predefined auto-spin options
  const select = document.createElement('select');
  select.id = 'autoSpinSelect';
  select.style.padding = '6px 8px';
  select.style.fontSize = '16px';
  select.style.borderRadius = '6px';
  select.style.background = '#222';
  select.style.color = '#fff';
  select.style.border = '1px solid #444';
  select.style.cursor = 'pointer';
  select.style.width = '100px';

  const autoSpinOptions = [10, 25, 50, 100, 250, 500, 1000];
  autoSpinOptions.forEach(num => {
    const opt = document.createElement('option');
    opt.value = String(num);
    opt.textContent = String(num);
    select.appendChild(opt);
  });

  // Start/Stop button
  const startBtn = document.createElement('button');
  startBtn.id = 'autoSpinButton';
  startBtn.textContent = 'Start';
  startBtn.style.padding = '8px 16px';
  startBtn.style.fontSize = '16px';
  startBtn.style.borderRadius = '6px';
  startBtn.style.background = '#4CAF50';
  startBtn.style.color = '#fff';
  startBtn.style.border = 'none';
  startBtn.style.cursor = 'pointer';
  startBtn.style.fontWeight = '700';

  // Counter display
  const counter = document.createElement('div');
  counter.id = 'autoSpinCounter';
  counter.style.fontSize = '16px';
  counter.style.fontWeight = '700';
  counter.style.color = '#FFD700';
  counter.style.display = 'none';
  counter.textContent = '';

  startBtn.addEventListener('click', () => {
    if (autoSpinActive) {
      // Stop auto-spin
      stopAutoSpin();
    } else {
      // Start auto-spin
      const count = parseInt(select.value, 10);
      if (!isNaN(count) && count > 0) {
        startAutoSpin(count);
      }
    }
  });

  autoSpinDiv.appendChild(label);
  autoSpinDiv.appendChild(select);
  autoSpinDiv.appendChild(startBtn);
  autoSpinDiv.appendChild(counter);

  // Insert after bet controls
  const betControls = document.getElementById('betControls');
  if (betControls && betControls.parentNode) {
    betControls.parentNode.insertBefore(autoSpinDiv, betControls.nextSibling);
  } else {
    balanceDiv.parentNode ? balanceDiv.parentNode.appendChild(autoSpinDiv) : document.body.appendChild(autoSpinDiv);
  }

  return autoSpinDiv;
}

function updateAutoSpinCounter() {
  const counter = document.getElementById('autoSpinCounter');
  if (counter && autoSpinActive) {
    counter.textContent = `Remaining: ${autoSpinCount}`;
    counter.style.display = 'block';
  } else if (counter) {
    counter.style.display = 'none';
  }
}

async function startAutoSpin(count) {
  autoSpinCount = count;
  autoSpinActive = true;

  const btn = document.getElementById('autoSpinButton');
  const select = document.getElementById('autoSpinSelect');
  
  if (btn) {
    btn.textContent = 'Stop';
    btn.style.background = '#f44336';
  }
  if (select) select.disabled = true;

  updateAutoSpinCounter();

  // Run auto-spins
  while (autoSpinActive && autoSpinCount > 0) {
    // Check if player has enough balance (skip if in bonus free spins)
    const isInFreeSpins = bonusActive && freeSpins > 0;
    if (!isInFreeSpins && balance < betAmount) {
      if (resultDiv) {
        resultDiv.textContent = "Auto-spin stopped: Insufficient funds";
        resultDiv.style.color = "#ff6666";
      }
      break;
    }

    await spin();
    autoSpinCount--;
    updateAutoSpinCounter();

    // Small delay between spins (adjust as needed)
    if (autoSpinActive && autoSpinCount > 0) {
      // Shorter delay in turbo mode
      const delayMs = turboMode ? 100 : 500;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  stopAutoSpin();
}

function stopAutoSpin() {
  autoSpinActive = false;
  autoSpinCount = 0;

  const btn = document.getElementById('autoSpinButton');
  const select = document.getElementById('autoSpinSelect');
  const counter = document.getElementById('autoSpinCounter');

  if (btn) {
    btn.textContent = 'Start';
    btn.style.background = '#4CAF50';
  }
  if (select) select.disabled = false;
  if (counter) counter.style.display = 'none';
}

createAutoSpinControls();

// NEW: Turbo/Fast Spin mode
let turboMode = false;
let turboButton = null;

function createTurboButton() {
  if (turboButton) return turboButton;

  turboButton = document.createElement('button');
  turboButton.id = 'turboButton';
  turboButton.innerHTML = '⚡'; // thunder/lightning bolt
  turboButton.style.padding = '8px 16px';
  turboButton.style.fontSize = '20px';
  turboButton.style.borderRadius = '6px';
  turboButton.style.background = '#555';
  turboButton.style.color = '#fff';
  turboButton.style.border = '2px solid #888';
  turboButton.style.cursor = 'pointer';
  turboButton.style.fontWeight = '700';
  turboButton.style.margin = '8px 0';
  turboButton.title = 'Toggle Turbo Mode (faster spins)';

  turboButton.addEventListener('click', () => {
    turboMode = !turboMode;
    if (turboMode) {
      turboButton.style.background = '#FF6600';
      turboButton.style.borderColor = '#FF9933';
    } else {
      turboButton.style.background = '#555';
      turboButton.style.borderColor = '#888';
    }
  });

  // Insert after auto-spin controls
  const autoSpinControls = document.getElementById('autoSpinControls');
  if (autoSpinControls && autoSpinControls.parentNode) {
    autoSpinControls.parentNode.insertBefore(turboButton, autoSpinControls.nextSibling);
  } else {
    balanceDiv.parentNode ? balanceDiv.parentNode.appendChild(turboButton) : document.body.appendChild(turboButton);
  }

  return turboButton;
}

createTurboButton();

// NEW: Special Spin mode (5x more chance for bonus, costs 3x bet)
let specialSpinButton = null;
let specialSpinMode = false;

function createSpecialSpinButton() {
  if (specialSpinButton) return specialSpinButton;

  specialSpinButton = document.createElement('button');
  specialSpinButton.id = 'specialSpinButton';
  specialSpinButton.textContent = '⭐ Special Spin (3x cost)';
  specialSpinButton.style.padding = '10px 18px';
  specialSpinButton.style.fontSize = '16px';
  specialSpinButton.style.borderRadius = '6px';
  specialSpinButton.style.background = '#9C27B0';
  specialSpinButton.style.color = '#fff';
  specialSpinButton.style.border = '2px solid #BA68C8';
  specialSpinButton.style.cursor = 'pointer';
  specialSpinButton.style.fontWeight = '700';
  specialSpinButton.style.margin = '8px 0';
  specialSpinButton.title = 'Special Spin: 5x more chance for bonus, costs 3x bet amount';

  specialSpinButton.addEventListener('click', () => {
    // Toggle special spin mode on/off
    specialSpinMode = !specialSpinMode;
    
    if (specialSpinMode) {
      // Activated: change button appearance
      specialSpinButton.style.background = '#FF6600';
      specialSpinButton.style.borderColor = '#FF9933';
      specialSpinButton.textContent = '⭐ Special Spin: ON (3x cost)';
    } else {
      // Deactivated: restore original appearance
      specialSpinButton.style.background = '#9C27B0';
      specialSpinButton.style.borderColor = '#BA68C8';
      specialSpinButton.textContent = '⭐ Special Spin (3x cost)';
    }
  });

  // Insert after turbo button
  const turboBtn = document.getElementById('turboButton');
  if (turboBtn && turboBtn.parentNode) {
    turboBtn.parentNode.insertBefore(specialSpinButton, turboBtn.nextSibling);
  } else {
    balanceDiv.parentNode ? balanceDiv.parentNode.appendChild(specialSpinButton) : document.body.appendChild(specialSpinButton);
  }

  return specialSpinButton;
}

createSpecialSpinButton();

// NEW: Info button with help/rules panel
let infoButton = null;
let infoPanel = null;

function createInfoButton() {
  if (infoButton) return infoButton;

  infoButton = document.createElement('button');
  infoButton.id = 'infoButton';
  infoButton.innerHTML = 'ℹ️';
  infoButton.style.padding = '8px 16px';
  infoButton.style.fontSize = '20px';
  infoButton.style.borderRadius = '6px';
  infoButton.style.background = '#2196F3';
  infoButton.style.color = '#fff';
  infoButton.style.border = '2px solid #64B5F6';
  infoButton.style.cursor = 'pointer';
  infoButton.style.fontWeight = '700';
  infoButton.style.margin = '8px 0';
  infoButton.title = 'Show game rules and information';

  infoButton.addEventListener('click', () => {
    toggleInfoPanel();
  });

  // Insert after special spin button
  const specialBtn = document.getElementById('specialSpinButton');
  if (specialBtn && specialBtn.parentNode) {
    specialBtn.parentNode.insertBefore(infoButton, specialBtn.nextSibling);
  } else {
    balanceDiv.parentNode ? balanceDiv.parentNode.appendChild(infoButton) : document.body.appendChild(infoButton);
  }

  return infoButton;
}

function createInfoPanel() {
  if (infoPanel) return infoPanel;

  infoPanel = document.createElement('div');
  infoPanel.id = 'infoPanel';
  infoPanel.style.position = 'fixed';
  infoPanel.style.top = '50%';
  infoPanel.style.left = '50%';
  infoPanel.style.transform = 'translate(-50%, -50%)';
  infoPanel.style.width = '90%';
  infoPanel.style.maxWidth = '600px';
  infoPanel.style.maxHeight = '80vh';
  infoPanel.style.background = '#1a1a1a';
  infoPanel.style.color = '#fff';
  infoPanel.style.padding = '20px';
  infoPanel.style.borderRadius = '12px';
  infoPanel.style.boxShadow = '0 8px 32px rgba(0,0,0,0.8)';
  infoPanel.style.zIndex = 99999;
  infoPanel.style.display = 'none';
  infoPanel.style.overflowY = 'auto';
  infoPanel.style.border = '3px solid #FFD700';

  // Close button (X)
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '✖';
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '10px';
  closeBtn.style.right = '10px';
  closeBtn.style.background = '#f44336';
  closeBtn.style.color = '#fff';
  closeBtn.style.border = 'none';
  closeBtn.style.borderRadius = '50%';
  closeBtn.style.width = '32px';
  closeBtn.style.height = '32px';
  closeBtn.style.fontSize = '18px';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontWeight = '700';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', () => {
    hideInfoPanel();
  });

  // Content
  const content = document.createElement('div');
  content.style.marginTop = '20px';
  content.innerHTML = `
    <h2 style="color: #FFD700; margin-top: 0;">🎰 Machine à Sous Brainrot - Rules & Info</h2>
    
    <h3 style="color: #FF9933;">🎮 How to Play</h3>
    <ul style="line-height: 1.8;">
      <li><strong>Select Bet:</strong> Choose your bet amount from the dropdown (0.1 to 100)</li>
      <li><strong>Spin:</strong> Click SPIN button to play. Click again during spin for instant stop</li>
      <li><strong>Win:</strong> Get 3+ matching symbols in consecutive columns starting from the left</li>
      <li><strong>Balance:</strong> You start with 500. Wins are added to your balance</li>
    </ul>

    <h3 style="color: #FF9933;">⭐ Bonus Feature</h3>
    <ul style="line-height: 1.8;">
      <li><strong>Trigger:</strong> Land 3+ Bonus Star symbols anywhere on the grid (~1 in 200 spins)</li>
      <li><strong>Free Spins:</strong> Get ${BONUS_FREE_SPINS} free spins when bonus triggers</li>
      <li><strong>Multiplier:</strong> Each win during bonus increases multiplier (x1, x2, x3...)</li>
      <li><strong>Retrigger:</strong> Get 3+ Bonus Stars during bonus to win +4 free spins</li>
      <li><strong>Bonus Buy:</strong> Pay 100× your bet to instantly trigger the bonus</li>
    </ul>

    <h3 style="color: #FF9933;">🎯 Special Features</h3>
    <ul style="line-height: 1.8;">
      <li><strong>⚡ Turbo Mode:</strong> Toggle faster spins (200-400ms vs 1000-1800ms)</li>
      <li><strong>⭐ Special Spin:</strong> Costs 3× bet, gives 5× more chance for bonus trigger</li>
      <li><strong>🔄 Auto Spin:</strong> Select number of spins (10-1000) and let it run automatically</li>
      <li><strong>Instant Stop:</strong> Click SPIN again during a spin to stop all reels immediately</li>
    </ul>

    <h3 style="color: #FF9933;">💰 Symbols & Payouts</h3>
    <ul style="line-height: 1.8;">
      <li><strong>Tralalero Tralal:</strong> Highest value (1.2×)</li>
      <li><strong>Bombardiro Crocodilo:</strong> High value (0.8×)</li>
      <li><strong>Tung Tung Tung Sahur:</strong> Medium value (0.6×)</li>
      <li><strong>Lirilì Larilà:</strong> Medium value (0.4×)</li>
      <li><strong>Brr Brr Patapim:</strong> Low value (0.25×)</li>
      <li><strong>Chimpanzini Bananini:</strong> Low value (0.18×)</li>
      <li><strong>Capuccino Assassino:</strong> Lowest value (0.12×)</li>
      <li><strong>Bonus Star:</strong> Scatter symbol (triggers bonus)</li>
    </ul>

    <h3 style="color: #FF9933;">📊 Payout Rules</h3>
    <ul style="line-height: 1.8;">
      <li><strong>3 consecutive columns:</strong> Base payout × 1.0</li>
      <li><strong>4 consecutive columns:</strong> Base payout × 1.6</li>
      <li><strong>5 consecutive columns:</strong> Base payout × 2.6</li>
      <li><strong>Multiple symbols:</strong> Count all instances in the connection</li>
      <li><strong>Bet scaling:</strong> All wins scale proportionally with your bet</li>
    </ul>

    <h3 style="color: #FF9933;">ℹ️ Additional Info</h3>
    <ul style="line-height: 1.8;">
      <li><strong>RTP:</strong> Target ${(DESIRED_RTP * 100).toFixed(1)}% return to player</li>
      <li><strong>Grid:</strong> ${COLS} columns × ${ROWS} rows</li>
      <li><strong>Auto-stop:</strong> Auto-spin stops when bonus triggers or balance too low</li>
      <li><strong>Decimal separator:</strong> Numbers display with comma (European format)</li>
    </ul>

    <p style="color: #FFD700; font-weight: 700; margin-top: 20px; text-align: center;">
      Good luck and have fun! 🎰✨
    </p>
  `;

  infoPanel.appendChild(closeBtn);
  infoPanel.appendChild(content);
  document.body.appendChild(infoPanel);

  return infoPanel;
}

function toggleInfoPanel() {
  const panel = createInfoPanel();
  if (panel.style.display === 'none' || !panel.style.display) {
    showInfoPanel();
  } else {
    hideInfoPanel();
  }
}

function showInfoPanel() {
  const panel = createInfoPanel();
  panel.style.display = 'block';
}

function hideInfoPanel() {
  if (infoPanel) {
    infoPanel.style.display = 'none';
  }
}

createInfoButton();

/* bonus info display */
function createBonusDiv() {
  let bd = document.getElementById("bonusInfo");
  if (!bd) {
    bd = document.createElement("div");
    bd.id = "bonusInfo";
    bd.style.fontSize = "18px";
    bd.style.color = "#FFD700";
    bd.style.fontWeight = "600";
    bd.style.marginTop = "6px";
    table.parentNode ? table.parentNode.insertBefore(bd, table) : document.body.insertBefore(bd, table);
  }
  return bd;
}
const bonusDiv = createBonusDiv();
function updateBonusDisplay() {
  if (!bonusDiv) return;
  if (bonusActive && freeSpins > 0) {
    bonusDiv.textContent = `BONUS: ${freeSpins} free spins • Multiplier: x${1 + bonusConnections}`;
  } else {
    bonusDiv.textContent = "";
  }
}
updateBonusDisplay();

/* buy-bonus button (left of table) */
function createBuyBonusButton() {
  let btn = document.getElementById("buyBonusButton");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "buyBonusButton";
    // show dynamic cost (100 × current bet)
    btn.textContent = `Bonus Buy (${formatNumber(betAmount * 100)})`;
    btn.style.position = "absolute";
    btn.style.zIndex = 9999;
    btn.style.padding = "8px 12px";
    btn.style.background = "#ffcc33";
    btn.style.border = "none";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    document.body.appendChild(btn);

    btn.addEventListener("click", () => {
      const cost = Math.round(betAmount * 100 * 100) / 100; // round to 2 decimals
      if (balance < cost) {
        if (resultDiv) { resultDiv.textContent = "Not enough money to buy bonus"; resultDiv.style.color = "#ff6666"; }
        return;
      }
      // pay for bonus buy
      balance -= cost;
      updateBalanceDisplay();

      // guarantee the next spin will contain 3 Bonus Star symbols so the bonus triggers 100%
      guaranteeBonusNextSpin = true;
      guaranteeBonusSpinIsFree = true; // don't charge the spin on top of the buy
      if (resultDiv) { resultDiv.textContent = `Bonus bought — performing guaranteed bonus spin...`; resultDiv.style.color = "#FFD700"; }
      // trigger a spin immediately (will detect guaranteeBonusNextSpin)
      spin().catch(() => {});
    });
  } else {
    // refresh displayed cost if button already exists
    btn.textContent = `Bonus Buy (${formatNumber(betAmount * 100)})`;
  }
  positionBuyButton();
  return btn;
}
createBuyBonusButton();

function positionBuyButton() {
  const btn = document.getElementById("buyBonusButton");
  if (!btn || !table) return;
  const rect = table.getBoundingClientRect();
  // place button to the left-middle of the table with a small gap
  btn.style.left = Math.max(8, rect.left - 120) + "px";
  btn.style.top = (rect.top + rect.height / 2 - (btn.offsetHeight || 20) / 2) + window.scrollY + "px";
}
window.addEventListener("resize", positionBuyButton);
window.addEventListener("scroll", positionBuyButton);

// --- weights for random selection ---
// build weighted list from explicit symbol weights
let weightedList = [];
function computeWeights() {
  weightedList = symbols.map(s => ({ sym: s, w: (typeof s.weight === 'number' ? s.weight : 1) }));
  // no need to normalize here; getRandomSymbol will use the raw weights
}
computeWeights();

function getRandomSymbol(excludeNames = []) {
  // build pool filtered by excludes
  const pool = weightedList.filter(it => !excludeNames.includes(it.sym.name));
  if (pool.length === 0) return symbols.find(s => !excludeNames.includes(s.name)) || symbols[0];

  // Special Spin mode: increase Bonus Star weight by 5x (unless excluded)
  const adjusted = pool.map(it => {
    let w = it.w;
    if (specialSpinMode && it.sym.name === "Bonus Star") {
      w = w * 5; // 5x more likely during special spin
    }
    // Keep existing bonus rarity logic if in bonus mode
    if (bonusActive && it.sym.name === "Bonus Star") {
      w = w / BONUS_RARITY_MULTIPLIER;
    }
    return { sym: it.sym, w };
  });

  const totalWeight = adjusted.reduce((sum, it) => sum + it.w, 0);
  let rnd = Math.random() * totalWeight;
  for (const it of adjusted) {
    if (rnd < it.w) {
      return it.sym;
    }
    rnd -= it.w;
  }
  // fallback (shouldn't happen)
  return adjusted[adjusted.length - 1].sym;
}

// build fixed reels for each column (sequence of symbols)
const reels = Array.from({ length: COLS }, () => []);
function buildReels() {
  for (let c = 0; c < COLS; c++) {
    const reel = [];
    for (let i = 0; i < REEL_SIZE; i++) {
      reel.push(getRandomSymbol().name);
    }
    reels[c] = reel;
  }
}
buildReels();

function symbolByName(name) {
  return symbols.find(s => s.name === name) || symbols[0];
}

function displaySymbolInCell(cellEl, symbol) {
  cellEl.innerHTML = '<img src="' + symbol.image + '" alt="' + symbol.name + '">';
}

// Connection multipliers - reduce these for lower payouts
const connMultiplier = { 3: 2.0, 4: 3.5, 5: 6.0 }; // more balanced for profit

/* Replace the single-best evaluateBestCombo with a new evaluator that returns ALL valid connections.
   Also keep a small wrapper evaluateBestCombo for compatibility (returns the highest paying connection). */
function evaluateAllCombos(finalGrid) {
  // finalGrid is array by column: finalGrid[col][row]
  const symbolMap = Object.fromEntries(symbols.map(s => [s.name, s]));
  const combos = [];

  for (const sym of symbols) {
    const name = sym.name;

    // require that the connection must start on the leftmost reel (col 0)
    const firstCol = finalGrid[0] || [];
    const hasInFirstCol = firstCol.reduce((acc, v) => acc + (v === name ? 1 : 0), 0);
    if (hasInFirstCol === 0) continue; // can't start a valid connection

    let length = 0;
    let totalCount = 0;
    const positions = []; // collect { c, r } for all instances in consecutive columns

    // count consecutive columns starting from col 0, stop at the first column with zero instances
    for (let c = 0; c < COLS; c++) {
      const col = finalGrid[c] || [];
      const rowsWith = [];
      for (let r = 0; r < ROWS; r++) {
        if (col[r] === name) rowsWith.push(r);
      }

      if (rowsWith.length > 0) {
        length++;
        totalCount += rowsWith.length;
        // add all instances in this column to positions
        rowsWith.forEach(r => positions.push({ c, r }));
      } else {
        break; // stop at first gap (connection must be consecutive)
      }
    }

    if (length >= 3) {
      const mult = connMultiplier[length] || connMultiplier[3];
      const val = Number(symbolMap[name] && symbolMap[name].value) || 0;
      const reward = Math.round(totalCount * val * mult); // no x10 scaling
      combos.push({ name, count: totalCount, length, mult, value: val, reward, positions });
    }
  }

  return combos; // possibly empty
}

// compatibility wrapper: returns the best single combo (used elsewhere if needed)
function evaluateBestCombo(finalGrid) {
  const combos = evaluateAllCombos(finalGrid);
  if (!combos || combos.length === 0) return null;
  return combos.reduce((best, c) => (!best || c.reward > best.reward) ? c : best, null);
}

/* ensure spin button exists
if (!spinButton) {
  spinButton = document.createElement("button");
  spinButton.id = "spinButton";
  spinButton.textContent = "SPIN";
  spinButton.style.marginTop = "12px";
  table.parentNode ? table.parentNode.insertBefore(spinButton, table.nextSibling) : document.body.appendChild(spinButton);
  spinButton = document.getElementById("spinButton");
}*/

/* simple animateWin stub (CSS classes should be in CSS file) */
function animateWin(symbolName) {
  const imgs = Array.from(document.querySelectorAll('#myTable .cell-content img')).filter(img => img.alt === symbolName);
  if (!imgs.length) return;
  imgs.forEach(img => {
    img.classList.add('win-glow');
  });
  setTimeout(() => imgs.forEach(img => img.classList.remove('win-glow')), 1200);
}

// new: animate only the image elements at the given positions (array of {c,r})
function animateWinPositions(positions) {
  if (!positions || !positions.length) return;
  const imgs = [];
  positions.forEach(p => {
    const col = columns[p.c];
    if (!col) return;
    const cell = col[p.r];
    if (!cell) return;
    const img = cell.querySelector('img');
    if (img) imgs.push(img);
  });
  if (!imgs.length) return;

  // add glow to only the connected instances
  imgs.forEach(img => img.classList.add('win-glow'));

  // optional: small timeout to remove glow (match existing timing)
  setTimeout(() => {
    imgs.forEach(img => img.classList.remove('win-glow'));
  }, 1200);
}

// NEW: track bonus-session total and summary UI
let currentBonusTotal = 0;
let bonusSummaryDiv = null;
function createBonusSummaryDiv() {
  if (bonusSummaryDiv) return bonusSummaryDiv;
  bonusSummaryDiv = document.createElement('div');
  bonusSummaryDiv.id = 'bonusSummary';
  bonusSummaryDiv.style.position = 'absolute';
  bonusSummaryDiv.style.zIndex = 10000;
  bonusSummaryDiv.style.background = '#222';
  bonusSummaryDiv.style.color = '#FFD700';
  bonusSummaryDiv.style.padding = '10px 14px';
  bonusSummaryDiv.style.borderRadius = '8px';
  bonusSummaryDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
  bonusSummaryDiv.style.cursor = 'pointer';
  bonusSummaryDiv.style.fontWeight = '700';
  bonusSummaryDiv.style.display = 'none';
  bonusSummaryDiv.addEventListener('click', hideBonusSummary);
  document.body.appendChild(bonusSummaryDiv);
  positionBonusSummary();
  window.addEventListener('resize', positionBonusSummary);
  window.addEventListener('scroll', positionBonusSummary);
  return bonusSummaryDiv;
}
function positionBonusSummary() {
  const div = createBonusSummaryDiv();
  if (!table || !div) return;
  const rect = table.getBoundingClientRect();

  // center the summary in the middle of the table (both horizontally and vertically)
  // ensure the element has been measured (offsetWidth/offsetHeight). If it's not visible yet,
  // temporarily show it off-screen to measure, then position correctly.
  const wasDisplayed = div.style.display === 'block';
  if (!wasDisplayed) {
    div.style.visibility = 'hidden';
    div.style.display = 'block';
  }

  const left = rect.left + (rect.width / 2) - (div.offsetWidth / 2) + window.scrollX;
  const top = rect.top + (rect.height / 2) - (div.offsetHeight / 2) + window.scrollY;

  div.style.left = `${Math.max(0, left)}px`;
  div.style.top = `${Math.max(0, top)}px`;
  div.style.zIndex = 10000;

  if (!wasDisplayed) {
    // restore visibility so showBonusSummary controls display
    div.style.display = 'none';
    div.style.visibility = '';
  }
}
function showBonusSummary(amount) {
  const div = createBonusSummaryDiv();
  div.textContent = `BONUS finished — total won: ${formatNumber(amount)}`;
  div.style.display = 'block';
  positionBonusSummary();
}
function hideBonusSummary() {
  if (!bonusSummaryDiv) return;
  bonusSummaryDiv.style.display = 'none';
}

// ensure summary element exists now (no visible until used)
createBonusSummaryDiv();

// NEW: track spin state for instant-stop feature
let isSpinning = false;
let instantStopRequested = false;

// MAIN SPIN
async function spin() {
  // If already spinning and user clicks again, request instant stop
  if (isSpinning) {
    instantStopRequested = true;
    return;
  }

  // hide summary if present when user starts a new spin or clicks the text
  hideBonusSummary();

  if (resultDiv) resultDiv.textContent = "";
  if (spinButton) spinButton.disabled = false; // keep enabled for instant-stop

  isSpinning = true;
  instantStopRequested = false;

  const isFreeSpin = (bonusActive && freeSpins > 0);

  // honor buy-guarantee: if the buy set the next spin as guaranteed, treat that specially
  const isGuaranteedBuySpin = !!guaranteeBonusNextSpin;
  const skipCostThisSpin = !!guaranteeBonusSpinIsFree;

  // Use betAmount as the cost of a spin (3x if special mode is active)
  const spinCost = specialSpinMode ? Math.round(betAmount * 3 * 100) / 100 : betAmount;
  
  if (!isFreeSpin && !skipCostThisSpin && balance < spinCost) {
    if (resultDiv) {
      resultDiv.textContent = "Insufficient funds";
      resultDiv.style.color = "#ff6666";
    }
    isSpinning = false;
    if (spinButton) spinButton.disabled = false;
    return 0;
  }

  // charge player for spin unless it's a free spin or a buy-guaranteed free spin
  if (!isFreeSpin && !skipCostThisSpin) {
    balance -= spinCost;
    updateBalanceDisplay();
    totalBets += spinCost;
  }

  const finalGrid = Array.from({ length: COLS }, () => Array(ROWS).fill(null));
  const intervals = [];
  const columnStopped = Array(COLS).fill(false);

  // NEW: Pre-calculate final positions and guarantee 3 scatters for bonus buy
  const finalPositions = Array.from({ length: COLS }, () => Math.floor(Math.random() * REEL_SIZE));
  
  // If bonus buy, ensure exactly 3 Bonus Stars will appear in the final grid
  if (isGuaranteedBuySpin) {
    // Pick 3 random positions (different columns preferred)
    const scatterPositions = [];
    const availableCols = Array.from({ length: COLS }, (_, i) => i);
    
    // Shuffle columns
    for (let i = availableCols.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [availableCols[i], availableCols[j]] = [availableCols[j], availableCols[i]];
    }
    
    // Take first 3 columns and pick random row in each
    for (let i = 0; i < 3; i++) {
      const col = availableCols[i];
      const row = Math.floor(Math.random() * ROWS);
      scatterPositions.push({ c: col, r: row });
    }
    
    // Now modify the reels at finalPositions to place Bonus Stars at those exact positions
    scatterPositions.forEach(pos => {
      const reelIdx = (finalPositions[pos.c] + pos.r) % REEL_SIZE;
      // Temporarily override this position in the reel
      reels[pos.c][reelIdx] = "Bonus Star";
    });
  }

  for (let c = 0; c < COLS; c++) {
    let current = Math.floor(Math.random() * REEL_SIZE);
    const spinTime = turboMode 
      ? 200 + c * 50 + Math.floor(Math.random() * 100)
      : 1000 + c * 300 + Math.floor(Math.random() * 400);
    const rate = turboMode 
      ? 15 + Math.floor(Math.random() * 10)
      : 40 + Math.floor(Math.random() * 30);

    const finalStart = finalPositions[c]; // use pre-calculated position

    intervals[c] = setInterval(() => {
      // check if instant stop requested
      if (instantStopRequested && !columnStopped[c]) {
        clearInterval(intervals[c]);
        // immediately show final result
        for (let r = 0; r < ROWS; r++) {
          const idx = (finalStart + r) % REEL_SIZE;
          const name = reels[c][idx];
          finalGrid[c][r] = name;
          displaySymbolInCell(columns[c][r], symbolByName(name));
        }
        // enforce at most one Bonus Star per column
        const bonusRows = [];
        for (let r = 0; r < ROWS; r++) if (finalGrid[c][r] === "Bonus Star") bonusRows.push(r);
        if (bonusRows.length > 1) {
          for (let i = 1; i < bonusRows.length; i++) {
            const rr = bonusRows[i];
            const replacement = getRandomSymbol(["Bonus Star"]).name;
            finalGrid[c][rr] = replacement;
            displaySymbolInCell(columns[c][rr], symbolByName(replacement));
          }
        }
        columnStopped[c] = true;
        return;
      }

      current = (current + 1) % REEL_SIZE;
      for (let r = 0; r < ROWS; r++) {
        const idx = (current + r) % REEL_SIZE;
        const name = reels[c][idx];
        displaySymbolInCell(columns[c][r], symbolByName(name));
      }
    }, rate);

    setTimeout(() => {
      if (columnStopped[c]) return; // already stopped by instant-stop
      clearInterval(intervals[c]);
      for (let r = 0; r < ROWS; r++) {
        const idx = (finalStart + r) % REEL_SIZE;
        const name = reels[c][idx];
        finalGrid[c][r] = name;
        displaySymbolInCell(columns[c][r], symbolByName(name));
      }

      // enforce at most one Bonus Star per column
      const bonusRows = [];
      for (let r = 0; r < ROWS; r++) if (finalGrid[c][r] === "Bonus Star") bonusRows.push(r);
      if (bonusRows.length > 1) {
        for (let i = 1; i < bonusRows.length; i++) {
          const rr = bonusRows[i];
          const replacement = getRandomSymbol(["Bonus Star"]).name;
          finalGrid[c][rr] = replacement;
          const cellEl = columns[c][rr];
          displaySymbolInCell(cellEl, symbolByName(replacement));
        }
      }
      columnStopped[c] = true;
    }, spinTime);
  }

  // wait for either natural spin completion or instant-stop
  await new Promise(resolve => {
    const checkComplete = setInterval(() => {
      if (columnStopped.every(stopped => stopped)) {
        clearInterval(checkComplete);
        resolve();
      }
    }, 50);
  });

  // Reset guarantee flags AFTER grid is finalized
  if (isGuaranteedBuySpin) {
    guaranteeBonusNextSpin = false;
    guaranteeBonusSpinIsFree = false;
  }

  // remember if we were in bonus BEFORE this spin started
  const wasBonusActive = bonusActive && freeSpins > 0;

  // evaluate all winning combinations
  const allCombos = evaluateAllCombos(finalGrid);
  let totalWin = 0;

  if (allCombos && allCombos.length > 0) {
    const parts = [];
    const betScale = (SPIN_COST > 0) ? (betAmount / SPIN_COST) : 1;
 
    allCombos.forEach(combo => {
      let baseReward = combo.reward;
      // scale reward proportionally to the current bet first
      const reward = Math.round(baseReward * betScale * 100) / 100;
      
      // apply bonus multiplier AFTER bet scaling (only during free spins)
      let finalReward = reward;
      if (bonusActive && isFreeSpin) {
        bonusConnections++;
        const multiplier = 1 + bonusConnections;
        finalReward = Math.round(reward * multiplier * 100) / 100;
      }
      
      totalWin += finalReward;
      totalPayout += finalReward;
      if (bonusActive && isFreeSpin) currentBonusTotal += finalReward;

      animateWinPositions(combo.positions);
      // show the final reward (with multiplier applied if in bonus)
      if (bonusActive && isFreeSpin) {
        parts.push(`${combo.count}× ${combo.name} → ${formatNumber(reward)} × ${1 + bonusConnections} = ${formatNumber(finalReward)}`);
      } else {
        parts.push(`${combo.count}× ${combo.name} → ${formatNumber(finalReward)}`);
      }
    });
 
    balance += totalWin;
    updateBalanceDisplay();

    if (resultDiv) {
      resultDiv.textContent = `WIN! ${parts.join(' + ')} → ${formatNumber(totalWin)}`;
      resultDiv.style.color = "#00ff00";
    }
  }

  // count Bonus Stars
  let bonusCount = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (finalGrid[c][r] === "Bonus Star") bonusCount++;
    }
  }

  if (!wasBonusActive && bonusCount >= 3) {
    bonusActive = true;
    freeSpins = BONUS_FREE_SPINS;
    bonusConnections = 0;
    currentBonusTotal = 0;
    hideBonusSummary();
    // Stop auto-spin when bonus is triggered
    if (autoSpinActive) {
      stopAutoSpin();
    }
    if (resultDiv) {
      resultDiv.textContent = `BONUS TRIGGERED! ${BONUS_FREE_SPINS} Free Spins!`;
      resultDiv.style.color = "#FFD700";
    }
  } else if (wasBonusActive && bonusCount >= 3) {
    freeSpins += 4;
    if (resultDiv) {
      resultDiv.textContent = `BONUS: +4 free spins!`;
      resultDiv.style.color = "#FFD700";
    }
  }

  if (isFreeSpin) {
    freeSpins--;
    if (freeSpins <= 0) {
      bonusActive = false;
      bonusConnections = 0;
      
      // Apply max win cap (5000× bet amount)
      const maxWinAmount = betAmount * MAX_WIN_PER_BONUS;
      if (currentBonusTotal > maxWinAmount) {
        const cappedAmount = Math.round(maxWinAmount * 100) / 100;
        // refund the excess to keep balance fair
        const excess = currentBonusTotal - cappedAmount;
        balance -= excess;
        updateBalanceDisplay();
        currentBonusTotal = cappedAmount;
        if (resultDiv) {
          resultDiv.textContent = `MAX WIN REACHED! ENVOIE PIED Bonus capped at ${formatNumber(maxWinAmount)} (${MAX_WIN_PER_BONUS}× bet)`;
          resultDiv.style.color = "#FF6600";
        }
      }
      
      showBonusSummary(currentBonusTotal);
      currentBonusTotal = 0;
    }
  }

  updateBonusDisplay();

  isSpinning = false;
  instantStopRequested = false;
  if (spinButton) spinButton.disabled = false;
  return totalWin;
}
